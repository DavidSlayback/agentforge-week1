# Development Log

This is the append-only journal of the patient dashboard port (route R1:
React + TypeScript + Vite SPA with a Node/Fastify BFF). It holds one entry per
slice, **newest first**. Any session, human or LLM, resumes work by reading
the most recent 5–10 entries plus the active arc file
([`arcs/ARC-01-DASHBOARD.md`](arcs/ARC-01-DASHBOARD.md)) and the playbook
([`MIGRATION-REACT.md`](MIGRATION-REACT.md)).

Requirement status of record is `docs/agentforge/PLAN.md` (W2D-1…W2D-8). This
log records how each slice got there.

**Conventions**
- The newest entry goes at the top, directly under the marker line below.
- Entries are immutable once written. Corrections go in a new entry that
  references the corrected one.
- Status values: `ready-for-commit` | `in-progress` | `blocked` | `merged`.
  An entry that is merged but not yet observed on the public URL says so in
  its "Tests" block (AGENTS.md "done" rule).
- Add an arc-completion entry at the end of each arc, before the first entry
  of the next arc.
- **PHI:** entries hold synthetic-data counts, ids, route names and status
  codes only. They never hold names, DOBs or clinical values.

**Slice entry template**

```markdown
## YYYY-MM-DD — Arc NN / Story NN-SS / Slice NN-SS-LL — <short title>

**Status:** ready-for-commit · **Branch:** `slice/NN-SS-LL-<name>` · **SHA:** <merge sha, once merged>

### Slice plan
(the MIGRATION-REACT.md §13 block)
### Worked on
### Decisions
### Tests
- Gate (`npm run check --prefix dashboard` + full `.githooks/pre-commit`): unit <n> · contract <n> · bff <n> · component <n> · axe <n> — all passing
- Deliberate regression: <the break> → red test(s): <names> → reverted
- Integration (local stack): <n> passing | SKIPPED (no token)
- Live: `live-check.mjs` <PASS/FAIL> at <sha> · authenticated checklist: <observed in window N | not yet observed>
### BUGS-MITIGATIONS.md updates
- <IDs struck through>
### Open questions / follow-ups
```

**Arc completion template**

```markdown
## YYYY-MM-DD — Arc NN complete: <name>

### Delivered
### Catalog entries resolved
### Retrospective
- Went well / didn't / change for next arc
```

---

<!-- New entries go below this line, newest first. -->

## 2026-09-25 — Arc 01 / planning — Route chosen, playbook written, no code yet

**Status:** ready-for-commit · **Branch:** `agentforge/w2-dashboard` (audit docs; draft MR staging !81) · **SHA:** n/a (docs only)

### Worked on
- Phase 8 Part B of the legacy-conversion audit. Wrote the migration playbook
  [`MIGRATION-REACT.md`](MIGRATION-REACT.md), the arc
  [`arcs/ARC-01-DASHBOARD.md`](arcs/ARC-01-DASHBOARD.md) (10 slices, walking
  skeleton first, with a Saturday 12:00 CT checkpoint), and this log.
- **No application code exists yet.** No `dashboard/` folder, no hook
  change, no deploy change.

### Decisions
- **Route R1** (David, 2026-09-25): React + TypeScript + Vite SPA with a Node
  (Fastify) BFF holding a confidential OAuth client, same-origin behind Caddy.
  - The weighted score was 110/135, a near-tie with Vue at 109 and SvelteKit
    at 108. David had no preference, so the top score won
    (`MIGRATION-OPTIONS.md`, `AUDIT-STATE.md` Decisions).
- **Data sources ("keep")**: FHIR-first, standard REST where FHIR can't match
  the PHP card.
  - REST: Allergies, Problems, Medications, Prescriptions, and Vitals per
    encounter.
  - FHIR: Header, Care Team.
- **App folder (A4): `dashboard/`**. It is one npm package: `core/` (pure
  parity rules and the allow-list), `bff/` (Fastify) and `web/` (React).
  - It is served at `/dashboard/` through a Caddy `handle` block, not
    `handle_path`: the app owns its prefix.
  - It runs as a new compose service `dashboard` on port 8790 and reports
    `git_sha` from `dashboard/BUILD_SHA` (export-subst).
  - `deploy.sh`'s health loop gains `dashboard`.
- **Gate:** `npm run check --prefix dashboard` goes into `.githooks/pre-commit`
  (additions only), mirrored as a `dashboard-check` job in `.gitlab-ci.yml`.
  The check covers typecheck, lint, Vitest (unit, contract, BFF, component
  and axe) and build with a bundle budget.
- **Security rules fixed up front**
  - The BFF can only build OpenEMR URLs from an allow-list table.
    `/api/prescription` accepts only `patient_id` and
    `source_table=prescriptions` (M-1 / 2.01).
  - HTTP-200 validation errors and unexpected empty FHIR bundles are errors.
  - Upstream error text is never rendered or logged.
  - Cookies are `HttpOnly`, `SameSite=Lax`, `Path=/dashboard`, and `Secure`
    in production.
  - `offline_access` is never requested.
- **`patient_id`, not `pid`, is the Rx patient key.** This supersedes the
  wording in `walkthroughs/PRESCRIPTIONS.md` (playbook §16, C-9).

### Tests
- None. There is no code. The gate is unchanged and existing suites are
  untouched.

### BUGS-MITIGATIONS.md updates
- None struck through. Every "design out in port" entry and every
  Architectural Smell (8.01–8.15) is mapped to a design decision and a slice
  in `MIGRATION-REACT.md` §2.6.

### Open questions / follow-ups (David)
- HD-1…HD-8 (`MIGRATION-REACT.md` §15):
  - deploy approval (A4);
  - the local client redirect URI;
  - enabling `rest_fhir_api` on production;
  - the production confidential client, including explicit approval of
    `user/prescription.rs`;
  - a grader demo login;
  - the `api_log_option` and `site_addr_oath` checks;
  - whether the local-only synthetic seeds go to production;
  - merging this audit branch to `main` before slice 01-01-01 branches.
- Conflicts C-1…C-10 with `PLAN.md` and `AGENTS.md` (`MIGRATION-REACT.md`
  §16). The most pressing are C-1 and C-2 (the FHIR wording in W2D-3 and
  W2D-4) and C-6 (this log and the arc file set against the "one plan file"
  rule).
