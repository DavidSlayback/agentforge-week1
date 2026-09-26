#!/bin/sh
# Deploy the committed HEAD to the Vultr VM and prove which SHA is running.
#
# Only a clean, committed tree ships (via git archive, which also stamps
# agentforge/BUILD_SHA and dashboard/BUILD_SHA). The previous AgentForge
# sources are moved to a timestamped backup on the VM so removed files cannot
# linger in the build.
#
# Required env: AGENTFORGE_DEPLOY_HOST (user@host), AGENTFORGE_DEPLOY_KEY
# (SSH private key path), AGENTFORGE_PUBLIC_URL (https://host, no trailing /).
# Optional: AGENTFORGE_DEPLOY_SERVICES (default "agentforge-w2"; the Week 1
# "agentforge" service is frozen and ships only when named explicitly; the
# patient dashboard port ships as "dashboard" and must report the SHA on
# /dashboard/health),
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
replaced="Dockerfile agentforge dashboard observability evals docs/agentforge"
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
# core.autocrlf=false: on a Windows host git archive would otherwise ship CRLF.
# shellcheck disable=SC2086 # paths is a deliberate word list
git -c core.autocrlf=false archive --format=tar "$sha" $paths | ssh_run "sudo tar -x -C $root"

compose="cd $root/deploy/vultr && docker compose --env-file $root/.env"

# The module dir is bind-mounted into OpenEMR, whose startup hardens webroot
# permissions to 500/400 on the assumption that apache (uid 1000) owns the
# files. Extracted as root, the module would become unreadable to apache and
# break both the W1 launcher and the W2 module API, so hand it to apache.
module_dir=$root/interface/modules/custom_modules/oe-module-agentforge
fix_module_perms() {
  ssh_run "sudo chown -R 1000:101 $module_dir && sudo find $module_dir -type d -exec chmod 755 {} + && sudo find $module_dir -type f -exec chmod 644 {} +"
}
fix_module_perms

# The Caddyfile is a single-file bind mount, so a changed file is only seen
# after the proxy is recreated. Do it first, so the new deny rules are live
# before any module or service change below.
caddy_after=$(ssh_run "sha256sum $root/deploy/vultr/Caddyfile | cut -d' ' -f1")
if [ "$caddy_before" != "$caddy_after" ]; then
  echo "Caddyfile changed; recreating proxy..."
  ssh_run "$compose up -d --no-deps --force-recreate proxy"
fi

if [ "${AGENTFORGE_DEPLOY_APPLY_MODULE_SQL:-}" = "1" ]; then
  echo "Applying oe-module-agentforge table.sql (CREATE TABLE IF NOT EXISTS)..."
  # MYSQL_PWD is read inside the mysql container from its own environment, so
  # the password never appears on this host or in a process argument list.
  ssh_run "$compose exec -T mysql sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" exec mariadb -uroot openemr' < $root/interface/modules/custom_modules/oe-module-agentforge/table.sql"
fi

if [ "${AGENTFORGE_DEPLOY_RECREATE_OPENEMR:-}" = "1" ]; then
  echo "Recreating openemr for module env changes..."
  ssh_run "$compose up -d --no-deps --wait openemr"
  fix_module_perms
fi

# Fail the deploy if apache cannot read the module (W1 launcher + W2 API).
ssh_run "docker exec -u apache vultr-openemr-1 test -r /var/www/localhost/htdocs/openemr/interface/modules/custom_modules/oe-module-agentforge/public/index.php" \
  || { echo "FAILED: apache cannot read oe-module-agentforge" >&2; exit 1; }

echo "Rebuilding: $services"
ssh_run "$compose up -d --build --no-deps $services"

for route in agentforge agentforge-w2 dashboard; do
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
