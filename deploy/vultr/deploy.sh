#!/bin/sh
# Deploy the committed HEAD to the Vultr VM and prove which SHA is running.
#
# Only a clean, committed tree ships (via git archive, which also stamps
# agentforge/BUILD_SHA). The previous AgentForge sources are moved to a
# timestamped backup on the VM so removed files cannot linger in the build.
#
# Required env: AGENTFORGE_DEPLOY_HOST (user@host), AGENTFORGE_DEPLOY_KEY
# (SSH private key path), AGENTFORGE_PUBLIC_URL (https://host, no trailing /).
# Optional: AGENTFORGE_DEPLOY_SERVICES (default "agentforge agentforge-w2"),
# AGENTFORGE_DEPLOY_ALLOW_UNMERGED=1 to ship a commit not yet on staging/main.
set -eu

host=${AGENTFORGE_DEPLOY_HOST:?set AGENTFORGE_DEPLOY_HOST}
key=${AGENTFORGE_DEPLOY_KEY:?set AGENTFORGE_DEPLOY_KEY}
public_url=${AGENTFORGE_PUBLIC_URL:?set AGENTFORGE_PUBLIC_URL}
services=${AGENTFORGE_DEPLOY_SERVICES:-agentforge agentforge-w2}
root=/opt/agentforge-week1
paths="Dockerfile agentforge observability evals docs/agentforge deploy/vultr interface/modules/custom_modules/oe-module-agentforge"

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
ssh_run "set -e; b=~/agentforge-week1-backups/$stamp; mkdir -p \$b; cd $root; for p in $paths; do [ -e \$p ] && sudo mv \$p \$b/ || true; done"

echo "Shipping $sha..."
# shellcheck disable=SC2086 # paths is a deliberate word list
git archive --format=tar "$sha" $paths | ssh_run "sudo tar -x -C $root"

echo "Rebuilding: $services"
ssh_run "cd $root/deploy/vultr && docker compose --env-file $root/.env up -d --build --no-deps $services"

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
