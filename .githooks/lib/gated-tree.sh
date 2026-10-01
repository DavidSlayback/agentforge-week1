# Sourced by .githooks/pre-commit and .githooks/pre-push (not a hook itself).
#
# The gates run on the working tree. A commit records the index and a push
# sends commits, so an unstaged edit or an untracked file under a gated path
# could make the gates pass on code that is not what gets committed or
# pushed. Rather than copy the index into a temp tree (and reinstall
# node_modules there), the hooks refuse until the working tree matches what
# is being committed or pushed. Never stash to work around this: the stash
# stack is shared by every worktree of this clone.

# Paths whose content the hooks' tests and gates read.
AGENTFORGE_GATED_PATHS="agentforge evals observability dashboard deploy/vultr interface/modules/custom_modules/oe-module-agentforge docs/agentforge/fixtures docs/agentforge/evidence docs/agentforge/schemas Dockerfile .githooks .gitlab-ci.yml"

# $1: "index" (pre-commit: working tree must equal the index) or "head"
# (pre-push: working tree and index must equal HEAD). Exits 1 with the list.
require_gated_tree_matches() {
  # shellcheck disable=SC2086
  if [ "$1" = head ]; then
    differing=$(git diff HEAD --name-only -- $AGENTFORGE_GATED_PATHS)
  else
    differing=$(git diff --name-only -- $AGENTFORGE_GATED_PATHS)
  fi
  # shellcheck disable=SC2086
  untracked=$(git ls-files --others --exclude-standard -- $AGENTFORGE_GATED_PATHS)
  if [ -z "$differing$untracked" ]; then
    return 0
  fi
  if [ "$1" = head ]; then
    echo "AgentForge gate: the working tree differs from HEAD under gated paths, so the gates would not test what is pushed." >&2
  else
    echo "AgentForge gate: unstaged or untracked files under gated paths, so the gates would not test what is committed." >&2
  fi
  [ -n "$differing" ] && printf '  modified: %s\n' $differing >&2
  [ -n "$untracked" ] && printf '  untracked: %s\n' $untracked >&2
  echo "Stage them (git add), discard them, or add them to .gitignore, then retry. Do not use git stash: the stash stack is shared across worktrees." >&2
  exit 1
}
