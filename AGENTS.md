# AgentForge agent rules

AgentForge is the AI layer (`agentforge/`, `evals/`, `observability/`, `deploy/vultr/`,
plus the W2 dashboard port in `dashboard/`)
in this OpenEMR fork. These rules exist because earlier work reported unfinished
features as done. They override convenience.

## Source of truth

- Requirements: `.scratch/assignments/w1.txt` and `w2.txt` (text of the local,
  gitignored assignment PDFs). Read the relevant section before planning.
- W2 surprise challenge (patient dashboard port): read
  `docs/legacy-audit/AGENT-BRIEF.md` first. It holds the decided client model,
  per-card data sources and parity rules, backed by the audit in `docs/legacy-audit/`.
- Hard-gate wording is literal. `./W2_ARCHITECTURE.md` means the repo root. A
  named field such as `page_or_section` means that exact key. "Required" means
  it is not optional.
- One plan file: `docs/agentforge/PLAN.md`. Update it; do not create another
  plan, checkpoint or status doc.

## One branch, one deployed SHA

- Integrate on one branch, merge to GitLab `main` (`staging` remote), and deploy
  only from `main`. Do not keep "proof" or "release" branches that never merge.
- The deployed service must report its git SHA. Evidence is valid only for the
  SHA it names.
- The GitLab project has no CI runner (owner decision, 2026-09-24), so the
  enforced gate is `.githooks/pre-commit` (`git config --local core.hooksPath
  .githooks`). `.gitlab-ci.yml` mirrors it and must stay in sync. GitHub
  workflows under `.github/` do not run on GitLab. Never delete or weaken
  either gate to get a change through.

## What "done" means

A requirement is done only when all three hold, for the same SHA:

1. The deployed code path calls it. An adapter, flag or mode that exists but is
   off in `deploy/vultr/docker-compose.yml` does not count.
2. A test or eval exercises that deployed path and fails when you break it.
   Before claiming coverage, make one small deliberate regression and show the
   gate fail.
3. It is observed working on the public URL.

Otherwise, report it as `implemented, not wired`, `wired, untested` or
`not done`. Say which.

## Honesty in code and docs

- Do not give a simulation the name of the real thing. Word overlap is not
  dense retrieval. A score sum is not a reranker. An in-memory map is not
  OpenEMR persistence. Fixture data is not `openemr-live`. If you must
  simulate, name it as a simulation in code, API output and docs.
- Production code (`src/`) must never read eval expectations (`expected`,
  golden answers). Detect conditions from the data itself.
- Verification must check every claim (`every`), not just one (`some`).
- Fail loudly. Zero extracted facts, a document-type mismatch, or a patient
  mismatch is never `READY`.
- When code changes, fix or delete every doc sentence it contradicts
  (README, root docs, `START_HERE.md`). Status claims cite a command, test or
  URL.

## PHI

Synthetic data only. Never log raw names, DOBs, document text, prompts or
extracted values. Redaction is tested against a real workflow trace, not a
hand-built one.

## Commands

```bash
npm test --prefix agentforge            # unit tests
npm run eval:gate --prefix agentforge   # W2 50-case gate; must exit 1 on regression
```

On Windows Git Bash, set `MSYS_NO_PATHCONV=1` before `git show <ref>:<path>`, or
the path is mangled and the file appears to be missing.
