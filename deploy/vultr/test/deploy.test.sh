#!/bin/sh
# Offline tests for deploy/vultr/deploy.sh. No network and no VM: fake `ssh`,
# `sudo`, `docker` and `curl` on PATH run the "remote" side locally in a temp
# directory, against a throwaway git repo whose `staging` remote is a local bare
# repo. They pin the 2026-09-26 hardening:
#   - every SSH call carries the keepalive options;
#   - images are built before any container is replaced (build, then
#     `up -d --no-deps`, never `up --build`), and a failed build replaces nothing;
#   - the build runs detached and is polled, so a failed launch call or failed
#     status checks (a dropped session) do not abort the deploy;
#   - a build that never started, and a health endpoint that does not report the
#     SHA, both fail the deploy.
# What this cannot show: that setsid/nohup really survive an SSH reset on the
# VM. That rests on their documented semantics.
#
# Usage: sh deploy/vultr/test/deploy.test.sh   (exit 0 = all cases pass)
set -eu

# Run from .githooks/pre-commit, git exports GIT_DIR, GIT_INDEX_FILE and more,
# all pointing at the REAL repository. Left set, the throwaway repo's
# `git init` would reinitialize the real one: an early run of this test set
# core.bare=true in the real repo's config. Clear every such variable first.
for v in $(git rev-parse --local-env-vars); do unset "$v"; done

here=$(cd "$(dirname "$0")" && pwd)
deploy_src=$here/../deploy.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

failures=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1" >&2; failures=$((failures + 1)); }

# ---- Fakes ------------------------------------------------------------------
mkdir -p "$work/bin" "$work/home" "$work/vm/root" "$work/nohooks"

cat > "$work/bin/ssh" <<'FAKE'
#!/bin/sh
# Records argv, then runs the remote command locally (stdin passed through).
printf '%s\n' "$*" >> "$FAKE_LOG_DIR/ssh.log"
while [ $# -gt 0 ]; do
  case $1 in
    -i | -o) shift 2 ;;
    -*) shift ;;
    *) break ;;
  esac
done
shift # host
cmd=$*
case $cmd in
  *"nohup sh build.sh"*)
    if [ "${FAKE_SSH_SKIP_LAUNCH:-}" = 1 ]; then exit 255; fi
    sh -c "$cmd"
    # The session "resets" right after the build was started.
    if [ "${FAKE_SSH_DROP_LAUNCH:-}" = 1 ]; then exit 255; fi
    exit 0
    ;;
  *"echo running"*)
    n=$(cat "$FAKE_LOG_DIR/poll-failures" 2>/dev/null || echo 0)
    if [ "$n" -lt "${FAKE_SSH_FAIL_POLLS:-0}" ]; then
      echo $((n + 1)) > "$FAKE_LOG_DIR/poll-failures"
      echo "ssh: connect to host vm port 22: Connection reset by peer" >&2
      exit 255
    fi
    ;;
esac
exec sh -c "$cmd"
FAKE

cat > "$work/bin/sudo" <<'FAKE'
#!/bin/sh
# chown to apache's uid is meaningless here (and fails on some test hosts).
case $1 in chown) exit 0 ;; esac
exec "$@"
FAKE

cat > "$work/bin/docker" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_LOG_DIR/docker.log"
case " $* " in
  *" compose "*" build "*)
    sleep "${FAKE_BUILD_SECONDS:-1}"
    exit "${FAKE_BUILD_EXIT:-0}"
    ;;
esac
exit 0
FAKE

cat > "$work/bin/curl" <<'FAKE'
#!/bin/sh
printf '{"status":"ok","service":"fake","git_sha":"%s"}\n' "$FAKE_HEALTH_SHA"
FAKE
chmod +x "$work/bin/"*

# ---- Throwaway repo with every shipped path ---------------------------------
repo=$work/repo
mkdir -p "$repo/agentforge" "$repo/dashboard" "$repo/observability" "$repo/evals" \
  "$repo/docs/agentforge" "$repo/deploy/vultr" \
  "$repo/interface/modules/custom_modules/oe-module-agentforge/public"
for f in Dockerfile agentforge/f dashboard/f observability/f evals/f docs/agentforge/f \
  deploy/vultr/Caddyfile interface/modules/custom_modules/oe-module-agentforge/public/index.php; do
  echo synthetic > "$repo/$f"
done
# The checkout may be CRLF (core.autocrlf on Windows); the script under test is LF.
tr -d '\r' < "$deploy_src" > "$repo/deploy/vultr/deploy.sh"
git init -q "$repo"
g() { git -C "$repo" --git-dir="$repo/.git" --work-tree="$repo" -c core.autocrlf=false -c core.hooksPath="$work/nohooks" -c commit.gpgsign=false -c user.name=test -c user.email=test@example.invalid "$@"; }
g add -A
g commit -q -m "synthetic tree"
git init -q --bare "$work/staging.git"
g remote add staging "$work/staging.git"
g push -q staging HEAD:main
sha=$(g rev-parse HEAD)
# deploy.sh runs plain `git` in $repo: make sure that resolves to the throwaway repo.
if [ "$(cd "$repo" && git rev-list --count HEAD)" != 1 ] || [ "$(cd "$repo" && git rev-parse HEAD)" != "$sha" ]; then
  echo "deploy.sh tests: git in the throwaway repo does not resolve to it; refusing to run" >&2
  exit 1
fi
: > "$work/key"

# ---- Runner -----------------------------------------------------------------
# run_case NAME [VAR=value ...]: fresh logs and remote tmp; sets $out and $rc.
run_case() {
  name=$1
  shift
  logs=$work/logs-$name
  mkdir -p "$logs"
  rc=0
  out=$(
    cd "$repo" && env PATH="$work/bin:$PATH" HOME="$work/home" FAKE_LOG_DIR="$logs" \
      FAKE_HEALTH_SHA="$sha" \
      AGENTFORGE_DEPLOY_HOST=deploy@vm.invalid AGENTFORGE_DEPLOY_KEY="$work/key" \
      AGENTFORGE_PUBLIC_URL=https://vm.invalid AGENTFORGE_DEPLOY_SERVICES=dashboard \
      AGENTFORGE_DEPLOY_ROOT="$work/vm/root" AGENTFORGE_DEPLOY_REMOTE_TMP="$work/vmtmp-$name" \
      AGENTFORGE_DEPLOY_POLL_SECONDS=1 AGENTFORGE_DEPLOY_HEALTH_SLEEP_SECONDS=0 \
      "$@" sh deploy/vultr/deploy.sh 2>&1
  ) || rc=$?
  touch "$logs/docker.log" "$logs/ssh.log"
}

line_of() { grep -n -- "$2" "$1" | head -n 1 | cut -d: -f1; }

# 1. Happy path.
run_case happy
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "OK: /dashboard reports $sha"; then
  pass "happy path deploys and the SHA health loop passes"
else
  fail "happy path (rc=$rc): $out"
fi
if [ -s "$logs/ssh.log" ] && ! grep -v -- "-o ServerAliveInterval=15 -o ServerAliveCountMax=8" "$logs/ssh.log" | grep -q .; then
  pass "every ssh call ($(wc -l < "$logs/ssh.log" | tr -d ' ')) carries ServerAliveInterval=15 and ServerAliveCountMax=8"
else
  fail "an ssh call lacks the keepalive options: $(cat "$logs/ssh.log")"
fi
b=$(line_of "$logs/docker.log" " build dashboard")
u=$(line_of "$logs/docker.log" "up -d --no-deps dashboard")
if [ -n "$b" ] && [ -n "$u" ] && [ "$b" -lt "$u" ] && ! grep -q -- "--build" "$logs/docker.log"; then
  pass "the image is built before the container is replaced, and never with up --build"
else
  fail "build/up order (build line '$b', up line '$u'): $(cat "$logs/docker.log")"
fi
if ls "$work/vmtmp-happy"/agentforge-deploy-*/build.log >/dev/null 2>&1 &&
  grep -q "^0$" "$work/vmtmp-happy"/agentforge-deploy-*/exit; then
  pass "the runner ran detached, logged to build.log and wrote exit 0"
else
  fail "no build.log/exit marker under the remote tmp dir"
fi

# 2. The session drops right after the build starts, then 3 status checks fail.
run_case dropped FAKE_SSH_DROP_LAUNCH=1 FAKE_SSH_FAIL_POLLS=3
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "the SSH call that starts the build failed" &&
  [ "$(printf '%s\n' "$out" | grep -c "build status check over SSH failed")" -eq 3 ] &&
  [ "$(grep -c "up -d --no-deps dashboard" "$logs/docker.log")" -eq 1 ]; then
  pass "a dropped launch session and 3 failed polls do not abort the build or the deploy"
else
  fail "dropped session (rc=$rc): $out"
fi

# 3. The build fails: nothing is replaced and the deploy fails.
run_case buildfail FAKE_BUILD_EXIT=1
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -q "remote build/replace ended with 'exit 1'" &&
  grep -q " build dashboard" "$logs/docker.log" && ! grep -q " up " "$logs/docker.log"; then
  pass "a failed build replaces no container and fails the deploy"
else
  fail "failed build (rc=$rc): $out / $(cat "$logs/docker.log")"
fi

# 4. The build never starts: fail after 3 'missing' polls instead of waiting forever.
run_case neverstarted FAKE_SSH_SKIP_LAUNCH=1
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -q "the remote build never started" && ! grep -q " up " "$logs/docker.log"; then
  pass "a build that never started fails the deploy"
else
  fail "never started (rc=$rc): $out"
fi

# 5. The health endpoint reports another SHA: the deploy fails (unchanged success criterion).
run_case wrongsha FAKE_HEALTH_SHA=0000000000000000000000000000000000000000
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -q "FAILED: /dashboard/health does not report $sha"; then
  pass "a health endpoint that does not report the SHA fails the deploy"
else
  fail "wrong SHA (rc=$rc): $out"
fi

if [ "$failures" -ne 0 ]; then
  echo "deploy.sh tests: $failures failed" >&2
  exit 1
fi
echo "deploy.sh tests: all passed"
