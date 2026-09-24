#!/bin/sh
# Deploy the committed HEAD to the Vultr VM and prove which SHA is running.
#
# Only a clean, committed tree ships (via git archive, which also stamps
# agentforge/BUILD_SHA). The previous AgentForge sources are moved to a
# timestamped backup on the VM so removed files cannot linger in the build.
#
# Required env: AGENTFORGE_DEPLOY_HOST (user@host), AGENTFORGE_DEPLOY_KEY
# (SSH private key path), AGENTFORGE_PUBLIC_URL (https://host, no trailing /).
# Optional: AGENTFORGE_DEPLOY_SERVICES (default "agentforge-w2"; the Week 1
# "agentforge" service is frozen and ships only when named explicitly),
# AGENTFORGE_DEPLOY_ALLOW_UNMERGED=1 to ship a commit not yet on staging/main,
# AGENTFORGE_DEPLOY_APPLY_MODULE_SQL=1 to apply the idempotent
# oe-module-agentforge table.sql through the mysql container (its own env
# holds the credentials), AGENTFORGE_DEPLOY_RECREATE_OPENEMR=1 to recreate the
# openemr container so it picks up changed module env. The proxy is recreated
# automatically when the Caddyfile changed (it is a single-file bind mount).
set -eu

host=${AGENTFORGE_DEPLOY_HOST:?set AGENTFORGE_DEPLOY_HOST}
key=${AGENTFORGE_DEPLOY_KEY:?set AGENTFORGE_DEPLOY_KEY}
public_url=${AGENTFORGE_PUBLIC_URL:?set AGENTFORGE_PUBLIC_URL}
services=${AGENTFORGE_DEPLOY_SERVICES:-agentforge-w2}
root=/opt/agentforge-week1
# Build inputs are replaced wholesale so deleted files cannot linger in images.
replaced="Dockerfile agentforge observability evals docs/agentforge"
# These are bind-mounted into running containers (module dir, Caddyfile).
# Moving them would leave containers attached to the backup copy, so they are
# overwritten in place instead.
in_place="deploy/vultr interface/modules/custom_modules/oe-module-agentforge"
paths="$replaced $in_place"

cd "$(git rev-parse --show-toplevel)"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to deploy: uncommitted changes." >&2
  exit 1
fi
sha=$(git rev-parse HEAD)
git fetch --quiet staging main
if ! git merge-base --is-ancestor "$sha" staging/main; then
  if [ "${AGENTFORGE_DEPLOY_ALLOW_UNMERGED:-}" != "1" ]; then
    echo "Refusing to deploy: $sha is not on staging/main." >&2
    exit 1
  fi
  echo "WARNING: deploying $sha, which is not on staging/main." >&2
fi

ssh_run() { ssh -i "$key" -o BatchMode=yes "$host" "$@"; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
echo "Backing up current sources on the VM ($stamp)..."
ssh_run "set -e; b=~/agentforge-week1-backups/$stamp; mkdir -p \$b; cd $root; for p in $replaced; do [ -e \$p ] && sudo mv \$p \$b/ || true; done; for p in $in_place; do [ -e \$p ] && sudo cp -a --parents \$p \$b/ || true; done"

caddy_before=$(ssh_run "sha256sum $root/deploy/vultr/Caddyfile 2>/dev/null | cut -d' ' -f1" || true)

echo "Shipping $sha..."
# shellcheck disable=SC2086 # paths is a deliberate word list
git archive --format=tar "$sha" $paths | ssh_run "sudo tar -x -C $root"

compose="cd $root/deploy/vultr && docker compose --env-file $root/.env"

if [ "${AGENTFORGE_DEPLOY_APPLY_MODULE_SQL:-}" = "1" ]; then
  echo "Applying oe-module-agentforge table.sql (CREATE TABLE IF NOT EXISTS)..."
  # MYSQL_PWD is read inside the mysql container from its own environment, so
  # the password never appears on this host or in a process argument list.
  ssh_run "$compose exec -T mysql sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" exec mariadb -uroot openemr' < $root/interface/modules/custom_modules/oe-module-agentforge/table.sql"
fi

if [ "${AGENTFORGE_DEPLOY_RECREATE_OPENEMR:-}" = "1" ]; then
  echo "Recreating openemr for module env changes..."
  ssh_run "$compose up -d --no-deps --wait openemr"
fi

echo "Rebuilding: $services"
ssh_run "$compose up -d --build --no-deps $services"

caddy_after=$(ssh_run "sha256sum $root/deploy/vultr/Caddyfile | cut -d' ' -f1")
if [ "$caddy_before" != "$caddy_after" ]; then
  echo "Caddyfile changed; recreating proxy..."
  ssh_run "$compose up -d --no-deps --force-recreate proxy"
fi

for route in agentforge agentforge-w2; do
  case " $services " in *" $route "*) ;; *) continue ;; esac
  i=0
  until curl -fsS -m 10 "$public_url/$route/health" 2>/dev/null | grep -q "\"git_sha\":\"$sha\""; do
    i=$((i + 1))
    if [ "$i" -ge 30 ]; then
      echo "FAILED: /$route/health does not report $sha" >&2
      exit 1
    fi
    sleep 5
  done
  echo "OK: /$route reports $sha"
done
