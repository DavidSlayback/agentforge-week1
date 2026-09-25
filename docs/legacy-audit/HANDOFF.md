# Handoff: cloud session → local Claude app session

**From:** the cloud session "Legacy codebase conversion workflow" (`session_01F5dW8KLbNoNq7j9QhS4kwQ`).
**To:** a **Local** Claude app session on David's laptop (Opus), in this repo.
**Why:** the cloud session runs on a cloud VM. It can't reach the laptop's
Docker stack (`localhost:8300`), the GitLab remotes, or the local worktrees.

Read this file first, then `AUDIT-STATE.md`. Everything below is also on
branch `claude/legacy-codebase-conversion-oc0jjg` (draft PR #85 on GitHub,
not for merging).

## What happened in the cloud session (short)

1. **Built the `legacy-conversion` skill** from the GauntletAI lecture
   *Reverse-Engineering a Legacy Codebase*.
   - It lives only in `david-brain`, at `skills/overlays/legacy-conversion/`
     (merged in david-brain PRs #5 and #6). There's also a project pack at
     `packs/projects/agentforge/`.
   - Locally it's synced into `~/.claude/skills` and `~/.codex/skills`. After
     `git pull` in david-brain, the symlinks pick up updates.
   - **It is not in this repo.** An earlier PR (#84) put a copy here by
     mistake and has been closed.
2. **The skill's defaults, set by David:**
   - it stops at every phase for David's approval;
   - in Phase 0, David runs and explores the app himself;
   - the "what's missing" check and the baseline errors come first;
   - in Phase 8 the highest score wins;
   - in Phase 10 the build is vertical slices, starting from a walking
     skeleton;
   - file reads go to cheaper parallel agents based on complexity tier.
3. **Local reference material, git-excluded via `.git/info/exclude`:**
   - `output/pdf/reverse-engineering-legacy-codebase-slides.pdf` (the
     lecture);
   - `output/pdf/W2-surprise-challenge-modernize-patient-dashboard.pdf`
     (the requirements).

   If they're missing from this checkout, ask David for them. Don't
   commit them.
4. **First test run of the skill: the W2 surprise challenge,** porting the
   OpenEMR patient dashboard to a modern framework on the REST/FHIR API with
   no backend changes. We're in **Phase 0**, checkpoint mode "every phase".
   See `AUDIT-STATE.md`, `REQUIREMENTS-TRACE.md`, `RECON.md` and
   `BASELINE-ERRORS.md`.

## Decisions David has already made (don't re-ask)

- **Scope:** the brief's cards only (header, Allergies, Problem List,
  Medications, Prescriptions, Care Team) plus **Patient Notes** as the
  extra section.
- **Agreed readings of the brief (A1–A6 in `REQUIREMENTS-TRACE.md`):**
  - parity applies within each card we port;
  - where the API lacks a field, show "not available via API" rather than
    patching the backend;
  - the framework is chosen by Phase 8 scoring;
  - the app lives in a new top-level folder;
  - OAuth2 setup is configuration, not a backend change;
  - the Co-Pilot is out of scope.
- **Probing:** a Claude probe and a Codex probe run alongside David's own
  run-through, for independent opinions.
- **No PowerShell hand-holding:** David works from the Claude app's Code tab.

## Immediate next steps (Phase 0: finish it, then stop at the checkpoint)

1. **Dashboard probe, as prober `claude-laptop`.** The stack is running with
   Synthea patients. Follow `probe/PROBE-BRIEF.md`. Get the probe and
   empty-state patient IDs from David, or from `phase0-setup.ps1`'s output.
2. **PHP baseline checks.** They couldn't run in the cloud because
   `composer install` was blocked. Run the read-only devtools through
   Docker:

   ```
   docker exec agentforge-week1-openemr-1 /root/devtools phpunit-isolated
   docker exec agentforge-week1-openemr-1 /root/devtools php-parserror
   docker exec agentforge-week1-openemr-1 /root/devtools psr12-report
   docker exec agentforge-week1-openemr-1 /root/devtools lint-javascript-report
   docker exec agentforge-week1-openemr-1 /root/devtools phpstan    # slow
   docker exec agentforge-week1-openemr-1 /root/devtools php-log
   ```

   Record the results in `BASELINE-ERRORS.md`. Don't run DB-backed suites
   until all the probes are done.
3. **Codex probe.** Give David the Codex prompt from the cloud session. In
   short: prober `codex`, follow `probe/PROBE-BRIEF.md`, run the checks
   above, write `probe/results/codex/NOTES.md` and `BASELINE.md`, commit
   nothing.
4. **Merge** David's notes, the `claude-laptop` probe and the Codex probe
   into `RECON.md`, showing where they disagree. Then present the
   **Phase 0 checkpoint**, using `checkpoints.md` from the skill, and stop.

## Repo reconciliation (David asked for this; do it before or alongside Phase 0)

**Goal:**
- fewer sources of truth;
- GitHub and GitLab in sync;
- Week 1 frozen exactly as submitted;
- one clear Week 2 development line.

**Rules:**
- **Inventory first, read-only.** Present the findings and a plan, and get
  David's approval before changing anything.
- Don't delete branches or worktrees, force-push, or change remote
  protections without explicit approval of that specific action.
- Never rewrite history on shared branches.

### What the cloud session could see (GitHub `origin` only)

- **No tags at all.** Nothing marks the Week 1 freeze point.
- **`origin/main`:** last commit 2026-09-22
  (`Merge pull request #75 … pre-visit-preparation`).
- **Week 2 work on GitHub:**
  - `davidslayback/w2-synthetic-scan-release`: 22 commits ahead of main,
    1 behind, last commit 09-23;
  - `agentforge-w2-regression-proof`: 9 ahead, 1 behind, 09-23.
- **Week 2 work on the laptop only:** `agentforge/w2-final`, not pushed, in
  a dirty worktree (from the other session's metadata).
- **Older branches, 51 behind main, that may or may not be superseded:**
  - `davidslayback/agentforge-stack-03-deploy-evidence` (84 ahead)
  - `afk/AF-08-resilience-foundation` (30 ahead)
  - `afk/AF-06-evaluator-surface` (19 ahead)
  - `afk/AF-04-safety-ui` (17 ahead)
  - `davidslayback/agentforge-checkpoint` (6 ahead)
  - `davidslayback/agentforge-architecture-contracts` (1 ahead)
  - `davidslayback/agentforge-diagrams` (0 ahead, so fully merged)
- **Dependabot:** 66 open branches.
- **Other remotes, per `docs/agentforge/CLEANUP_INVENTORY.md`:**
  - `gitlab`: the Gauntlet group project, protected, Developer-blocked;
  - `staging`: `davidslayback/agentforge-week1-staging`, which holds issues
    and draft MRs;
  - `upstream`: the Gauntlet OpenEMR base.
- **Other local state:**
  - `docs/agentforge/FINAL_PACKAGE.md` names GitLab issue #17 (with #18–#26)
    as the "source of record";
  - the laptop session flagged 4 stale Codex worktrees and a `C:/tmp` proof
    directory.

### Inventory to run locally (read-only)

1. `git remote -v`; `git fetch --all --tags`. For each remote, list the
   default branch, the heads, and the tags.
2. **Compare `origin/main` with the GitLab submission branch or branches.**
   Which commit was submitted for Week 1 final? Check the GitLab MRs and
   issue #17 and `FINAL_PACKAGE.md`.
3. **Worktrees:** list them with `git worktree list` and
   `openemr-cmd worktree list`. Record each one's branch, whether it's
   dirty, and its unpushed commits.
4. **For every non-main branch:** is its content already in the Week 1
   freeze point or in the Week 2 work? `git cherry` or a patch-id
   comparison, since squash merges hide it.
5. **Issue and MR trackers in use:** GitHub PRs vs GitLab staging issues
   and MRs.

### Recommended end state (confirm with David; these are proposals)

| Item | Proposal |
|---|---|
| Week 1 | Annotated tag `week1-final` on the exact commit submitted to GitLab for Week 1, pushed to **both** remotes. Optionally a protected `week1` branch at the same commit. Never moved again. |
| Week 2 | **One** integration line. Either `main` continues as Week 2 after the tag, or there's a separate `week2` branch. The two W2 GitHub branches, `agentforge/w2-final`, and the dashboard slices all consolidate into it through reviewed merges. |
| Remotes | One canonical remote for development, mirrored to the other with the same commits and tags. David picks which. The GitLab group project stays the submission target. |
| Trackers | One tracker for W2 work (GitLab staging issues or GitHub), with the other either linking to it or unused. |
| Worktrees | Keep only active ones. Remove stale ones with `openemr-cmd worktree remove` (never raw `git worktree`), after checking for unpushed work. |
| Branches | After confirming their content is captured, delete merged or superseded branches. Close or batch the dependabot branches. |
| Audit docs | `docs/legacy-audit/` goes onto the Week 2 line, pending David's Phase 0 decision. |

### Decisions to ask David (one batched question)

1. Which commit is the true Week 1 submission? (Propose the one found in
   the inventory.)
2. Should Week 2 develop on `main` after tagging, or on a separate `week2`
   branch?
3. Which remote is canonical for development (GitHub or GitLab staging),
   and should mirroring be one-way?
4. Which tracker is the source of record for W2 work?
5. Approve the specific branch and worktree deletions listed in the
   inventory.

## Appendix: Codex prober prompt

Paste this into Codex, run in this repo folder. Replace `<P>` (probe
patient pid) and `<E>` (empty-state pid).

```text
You're the "codex" prober for Phase 0 of a legacy-conversion audit of this OpenEMR repo. We're
preparing to port OpenEMR's PHP patient dashboard to a modern framework that uses only the
REST/FHIR API. Your job is to observe and report. Don't fix or change anything.
Read docs/legacy-audit/AUDIT-STATE.md, docs/legacy-audit/REQUIREMENTS-TRACE.md and
docs/legacy-audit/probe/PROBE-BRIEF.md. Do NOT read RECON.md or other probers' results first.
HARD RULES: read-only. Don't add, edit or delete OpenEMR data, don't change settings, and don't
run dev-reset/dev-install/restore/*-fix/rector-process/phpstan-generate/update-*-fixtures. Local
stack only: http://localhost:8300 (admin/pass), synthetic data only. No commits, pushes or PRs.
Write only under docs/legacy-audit/probe/results/codex/. Stick to observations; mark guesses.
TASK A: follow PROBE-BRIEF.md. cd docs/legacy-audit/probe; npm run setup;
node probe-dashboard.mjs --pid <P> --empty-pid <E> --label codex. Then explore by hand: the
dashboard at http://localhost:8300/interface/patient_file/summary/demographics.php?set_pid=<P>,
and the same patient via Patient > Finder. Cover the header, Allergies, Problem List,
Medications, Prescriptions, Care Team, Patient Notes, the empty state and every other card.
Don't click anything that saves.
TASK B: read-only PHP checks (container usually agentforge-week1-openemr-1; check docker ps):
devtools phpunit-isolated, php-parserror, psr12-report, lint-javascript-report, phpstan (skip if
it takes more than 20 min), php-log, each via docker exec <container> /root/devtools <cmd>.
Record pass/fail counts and the first ~20 distinct errors. No DB-backed suites.
OUTPUT under docs/legacy-audit/probe/results/codex/:
- NOTES.md, using the template in PROBE-BRIEF.md step 3;
- BASELINE.md, with | Check | Command | Result | Notes |, then failures numbered C-01…;
- leave summary.json and cards-*.json where the script wrote them.
Finish with a 5-bullet summary and the paths to those files.
```
