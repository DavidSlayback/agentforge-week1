# Agent brief — patient dashboard port (legacy audit + build)

For coding agents (Claude Code, Codex, Cursor) working on the W2 surprise challenge:
port OpenEMR's PHP patient dashboard to a modern framework on OpenEMR's
existing REST/FHIR API. `AGENTS.md` still governs everything else. Read this
file and [`AUDIT-STATE.md`](AUDIT-STATE.md) before starting.

## Purpose and layout

This work is **in place**: the legacy code and the port share one repo.

- **Legacy baseline:** tag `legacy-baseline` = `3ccfe1d`. Audit docs cite code
  as `path:line@legacy-baseline`. **Do not change OpenEMR's backend** (PHP,
  schema, API) for this work (DB-10 / W2D-8). Configuration is allowed: enabling
  the API and registering an OAuth client.
- **Audit knowledge base:** `docs/legacy-audit/`
  - `RECON.md`, `BASELINE-ERRORS.md`, `REQUIREMENTS-TRACE.md` (DB-01…DB-11 ↔
    `docs/agentforge/PLAN.md` W2D-1…W2D-8), `PROJECT-MAP.md`
  - `ui/` (Phase 2), `modules/` (Phase 3), `data/` (Phase 4); each has a `README.md` catalog
  - `project/` (manifests, stack, CI), `api/` (Phase 1 maps; superseded in part by `modules/`)
  - `seed/`: local-only synthetic seed (marker `[seed:phase1]`); `probe/`: dashboard probe kit and results
- **The single plan** is `docs/agentforge/PLAN.md` (AGENTS.md). The audit is its
  evidence, not a second plan.
- **The new app** will live in a new top-level folder (A4), named in Phase 10.

## Build / run / test

- **Legacy app (local):** Docker Desktop, `docker/development-easy-light`,
  http://localhost:8300 (`admin` / `pass`, dev only). Container
  `agentforge-week1-openemr-1`; DB `agentforge-week1-mysql-1`.
- **PHP checks:** `MSYS_NO_PATHCONV=1 docker exec agentforge-week1-openemr-1 /root/devtools <check>`.
  The Windows checkout is CRLF (`core.autocrlf=true`), so byte-exact tests and
  PHPStan baselines fail on it. For a true result, run from an LF copy
  (`git checkout-index -a --prefix=/tmp/lf/` inside the container). See `BASELINE-ERRORS.md`.
- **Enforced gate:** `.githooks/pre-commit` (no GitLab runner). The port's tests
  must be added to it (it runs no OpenEMR PHP checks today).
- **Test patients:** pid 13 (data-rich, seeded Care Team, notes and vitals), pid 3 (empty-state).

## Load-bearing facts (from Phases 1–4)

- **Entry point.** `interface/patient_file/summary/demographics.php?set_pid=N`
  inside the tabbed shell's iframe. It switches the **session** patient before any
  authorization check, then gates on `patients/demo` at line 1056.
- **Navigation shape.** Shell + iframe + async fragments (`placeHtml`) that read
  the session patient. The identity bar lives in the shell (name, MRN, DOB only).
- **Defining architectural choice.** The session pid is implicit state. The port
  replaces it with an explicit patient id in every call.
- **Client model (decided).** **SPA + thin BFF** holding a **confidential** OAuth
  client (auth code + PKCE). Tokens stay server-side, and the SPA is served
  same-origin by the BFF. Why: public clients can't get `user/` scopes (no
  `/api/*`), and CORS preflight 404s cross-origin.
- **Data sources (FHIR-first, REST where FHIR can't match the card):** see
  `modules/README.md` "Per-card data source by client model", column B.
  - The header uses FHIR `Patient`. Derive active status from `deceasedDateTime`
    (`Patient.active` is always `true`).
  - Care Team uses FHIR `CareTeam`. Inactive members can't be hidden.
  - Allergies, Problems, Meds, Rx and Vitals use REST with client-side filters.
- **Parity rules (decided).**
  - Reproduce `filterActiveIssues()` (outcome ≠ 1 and enddate empty or future).
  - Rx shows **all** rows, sorted `active DESC, date_modified DESC, date_added DESC`.
  - Vitals shows the **correct** latest non-deleted set, which deliberately differs
    from the PHP join bug.
  - Allergies: highlight severe only.
  - Empty lists say "Nothing Recorded"; Prescriptions keeps its own legacy text, "None"
    (owner decision, slice 01-03-01).
  - Refills, Care Team member status and Note, `lists_touch`, squad and
    `hide_dashboard_cards` are "not available via API".
- **Ids.** Some REST routes take the integer `pid` or `eid`, others take uuids.
  The BFF gets `pid` from `GET /api/patient/:puuid` and `eid` from the encounter list.
- **Security model to respect.**
  - The BFF must send only **allow-listed** query keys (M-1: SQL injection
    through parameter names on `/api/prescription`).
  - Treat HTTP 200 validation errors and empty FHIR bundles as errors, not
    "Nothing Recorded".
  - API errors can leak SQL; never render API error text.
  - Refresh tokens are bearer credentials (M-4).
- **Soft delete.** `forms.deleted` (vitals, via `form_id` + `formdir`), `lists.activity`,
  `pnotes.deleted` and `activity`, `care_team_member.status`. Each path honours a
  different subset (see `data/SCHEMA.md`).
- **Display config with no API:** date format, age format, US units. The BFF/SPA sets these.

## Doc voice and conventions

Long-form prose; claims cite `path:line` (tag `legacy-baseline` when citing old
code); tables for catalogs; say what must and must not survive the port.
Verified findings are marked `(verified)`; tier-1/2 findings stay provisional
until a tier-3 check. Commits: Conventional Commits with the `Assisted-by`
trailer (CLAUDE.md). Keep `AUDIT-STATE.md` current at the end of every session.
Synthetic data only; never log names, DOBs or clinical values (AGENTS.md §PHI).
