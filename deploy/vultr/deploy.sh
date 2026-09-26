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
#
# The image build and the container replacement run detached on the VM
# (setsid + nohup; runner, log and exit marker in
# $AGENTFORGE_DEPLOY_REMOTE_TMP/agentforge-deploy-<stamp>/) and are polled with
# short SSH calls, so a dropped SSH session cannot abort them half-way. On
# 2026-09-26 the session reset during `up -d --build` and left the dashboard
# container removed (about 10 minutes of 502). Every image is built before any
# container is replaced, so a failed build leaves the running services up.
# Success is still decided only by the SHA health loop at the end.
#
# Tuning and test seams (deploy/vultr/test/deploy.test.sh):
# AGENTFORGE_DEPLOY_ROOT (default /opt/agentforge-week1),
# AGENTFORGE_DEPLOY_REMOTE_TMP (default /tmp),
# AGENTFORGE_DEPLOY_POLL_SECONDS (default 10),
# AGENTFORGE_DEPLOY_BUILD_TIMEOUT_SECONDS (default 2400),
# AGENTFORGE_DEPLOY_HEALTH_SLEEP_SECONDS (default 5).
set -eu

host=${AGENTFORGE_DEPLOY_HOST:?set AGENTFORGE_DEPLOY_HOST}
key=${AGENTFORGE_DEPLOY_KEY:?set AGENTFORGE_DEPLOY_KEY}
public_url=${AGENTFORGE_PUBLIC_URL:?set AGENTFORGE_PUBLIC_URL}
services=${AGENTFORGE_DEPLOY_SERVICES:-agentforge-w2}
root=${AGENTFORGE_DEPLOY_ROOT:-/opt/agentforge-week1}
remote_tmp=${AGENTFORGE_DEPLOY_REMOTE_TMP:-/tmp}
poll_seconds=${AGENTFORGE_DEPLOY_POLL_SECONDS:-10}
build_timeout=${AGENTFORGE_DEPLOY_BUILD_TIMEOUT_SECONDS:-2400}
health_sleep=${AGENTFORGE_DEPLOY_HEALTH_SLEEP_SECONDS:-5}
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

# Keepalives: a long step prints nothing over its session, so a NAT or
# firewall idle timer could drop it. The client probes every 15 s and gives up
# only after 8 missed replies (2 min). Every SSH call goes through here.
ssh_run() {
  ssh -i "$key" -o BatchMode=yes -o ConnectTimeout=20 \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "$host" "$@"
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
echo "Backing up current sources on the VM ($stamp)..."
ssh_run "set -e; b=~/agentforge-week1-backups/$stamp; mkdir -p \$b; cd $root; for p in $replaced; do if [ -e \$p ]; then sudo mkdir -p \$b/\$(dirname \$p) && sudo mv \$p \$b/\$p; fi; done; for p in $in_place; do [ -e \$p ] && sudo cp -a --parents \$p \$b/ || true; done"

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

# ---- Build, then replace: detached on the VM, polled from here -------------
# The runner script is written first, then started in its own session with its
# output in build.log. When it ends it writes its status to `exit` (atomically,
# via mv). Containers are replaced only if every image built.
run_dir=$remote_tmp/agentforge-deploy-$stamp
echo "Building on the VM, detached: $services (log: $run_dir/build.log)"
# A fresh directory per run: `mkdir` (not -p) refuses to reuse an old run's exit marker.
ssh_run "umask 077 && mkdir -p $remote_tmp && mkdir $run_dir && cat > $run_dir/build.sh" <<RUNNER
#!/bin/sh
# Written by deploy.sh for $sha ($stamp).
finish() { echo "\$1" > $run_dir/exit.tmp && mv $run_dir/exit.tmp $run_dir/exit; }
cd $root/deploy/vultr || { finish 1; exit 1; }
status=0
echo "build started \$(date -u +%Y-%m-%dT%H:%M:%SZ): $services"
docker compose --env-file $root/.env build $services || status=\$?
if [ "\$status" -eq 0 ]; then
  echo "build ok \$(date -u +%Y-%m-%dT%H:%M:%SZ); replacing containers"
  docker compose --env-file $root/.env up -d --no-deps $services || status=\$?
else
  echo "build FAILED (status \$status); running containers left untouched"
fi
echo "finished with status \$status \$(date -u +%Y-%m-%dT%H:%M:%SZ)"
finish "\$status"
RUNNER
# setsid gives the runner its own session and nohup makes it ignore SIGHUP, so
# it outlives this connection. build.log exists as soon as it has started. If
# this call itself fails, the poll below still finds out whether it started.
if ! ssh_run "cd $run_dir && if command -v setsid >/dev/null 2>&1; then setsid nohup sh build.sh >build.log 2>&1 </dev/null & else nohup sh build.sh >build.log 2>&1 </dev/null & fi"; then
  echo "WARNING: the SSH call that starts the build failed; polling to see whether it started." >&2
fi

waited=0
ssh_failures=0
not_started=0
while :; do
  if state=$(ssh_run "if [ -f $run_dir/exit ]; then echo \"exit \$(cat $run_dir/exit)\"; elif [ -f $run_dir/build.log ]; then echo running; else echo missing; fi"); then
    ssh_failures=0
    case $state in
      "exit 0")
        echo "Remote build and replace finished."
        break
        ;;
      exit*)
        echo "FAILED: remote build/replace ended with '$state'. Containers are replaced only after every image builds. Last lines of $run_dir/build.log:" >&2
        ssh_run "tail -n 40 $run_dir/build.log" >&2 || true
        exit 1
        ;;
      running) ;;
      *)
        not_started=$((not_started + 1))
        if [ "$not_started" -ge 3 ]; then
          echo "FAILED: the remote build never started ($run_dir on the VM)." >&2
          exit 1
        fi
        ;;
    esac
  else
    ssh_failures=$((ssh_failures + 1))
    echo "WARNING: build status check over SSH failed ($ssh_failures in a row); the build keeps running on the VM." >&2
    if [ "$ssh_failures" -ge 30 ]; then
      echo "FAILED: cannot reach the VM to check the build; see $run_dir/build.log there." >&2
      exit 1
    fi
  fi
  if [ "$waited" -ge "$build_timeout" ]; then
    echo "FAILED: the remote build is still running after ${build_timeout}s; see $run_dir/build.log on the VM." >&2
    exit 1
  fi
  sleep "$poll_seconds"
  waited=$((waited + poll_seconds))
done

for route in agentforge agentforge-w2 dashboard; do
  case " $services " in *" $route "*) ;; *) continue ;; esac
  i=0
  until curl -fsS -m 10 "$public_url/$route/health" 2>/dev/null | grep -q "\"git_sha\":\"$sha\""; do
    i=$((i + 1))
    if [ "$i" -ge 30 ]; then
      echo "FAILED: /$route/health does not report $sha" >&2
      exit 1
    fi
    sleep "$health_sleep"
  done
  echo "OK: /$route reports $sha"
done
