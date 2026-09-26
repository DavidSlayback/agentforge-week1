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

## 2026-09-25 — Arc 01 / Story 01-01 / Slice 01-01-01 — Walking skeleton (local part): sign-in via BFF + persistent header

**Status:** ready-for-commit (committed on the branch; not merged, not deployed) · **Branch:** `agentforge/w2-dashboard` (owner instruction; the playbook's `slice/01-01-01-walking-skeleton` branch was not used) · **SHA:** code at `5baf5fd`; no merge SHA yet

### Slice plan
Flow / requirement delivered: W2D-1 (sign-in / sign-out through OpenEMR's OAuth2 server via the BFF), W2D-2 (persistent header: name, DOB with age, sex, MRN, status), W2D-8 (no PHP change).
Legacy behavior replaced: `ui/DASHBOARD-HEADER.md`, `walkthroughs/SIGN-IN-AND-HEADER.md`.
Layers touched: core (`ids`, `cardResult`, `dto`, `format`, `guards`, `rules/header`, `upstreamRoutes`) · bff (`config`, `buildInfo`, `clock`, `auth/{oauth,session}`, `upstream/{client,mapResponse,schemas/patient}`, `cards/{header,patientLookup}`, `http/{routes,security,health,static}`, `server`) · web (`App`, `api`, `useCard`, `components/{PatientHeader,States}`) · tests · deploy (compose, Caddy, `deploy.sh`, README, SHA stamping) · gate (hook + CI).
Upstream routes added to the allow-list: `fhir.patient.read`, `rest.patient.read`, `fhir.patient.search` (query key `identifier` = MRN only).
Catalog IDs: 8.01, 4.01, 3.01, 3.02, 3.13, 3.16, 4.04, 4.06, 5.04, 5.09, 6.01, 6.05, 7.03, 7.04, 7.09, 7.17, 7.18, 8.06, 2.04 (lint ban + JSX); BFF rules 1.01, 1.02, 1.03, 1.04, 1.06, 1.08, 1.11, 2.03, 6.02, 6.03, 9.01, 9.03, 9.04, 10.01, 10.04.
Deliberate regression: `core/rules/header.ts` reads `Patient.active` → expected red: the pid 12 "Deceased" test and the `active: false` case.
Acceptance check (a user can do this): sign in, open pid 13 by link or MRN, see the correct header, sign out, and be signed out.

### Worked on
- New `dashboard/` package per `MIGRATION-REACT.md` §3 (commits `9086e30`, `8e463e7`, `9e14539`): pure `core/`, Fastify BFF, React SPA, Vitest suites, `Dockerfile` (its build stage runs `npm run check`), `README.md`, `scripts/{bundle-report,live-check,dev}.mjs`.
- Gate (`12de1be`): one step in `.githooks/pre-commit` (install when stale, then `npm run check --prefix dashboard`), inserted after the unit suites and before the W2 eval gate; no existing line changed. Mirrored as the `dashboard-check` job in `.gitlab-ci.yml`.
- Deploy config (`5baf5fd`, **not deployed**): `dashboard` compose service (not in `proxy.depends_on`), `handle /dashboard/*` + `redir /dashboard` in all three Caddy site blocks, `deploy.sh` ships `dashboard` and adds it to the SHA health loop, `deploy/vultr/README.md` lists the variables. `.gitattributes`: `dashboard/BUILD_SHA export-subst`, `dashboard/** text=auto eol=lf`; `git archive HEAD dashboard` stamps `BUILD_SHA` with the commit (checked at `5baf5fd`).
- Local OAuth client (HD-2): registered a new confidential client "AgentForge Dashboard (local dev)" on the **local** OpenEMR through `POST https://localhost:9300/oauth2/default/registration` (redirect `http://localhost:8790/dashboard/callback`, one post-logout URI `http://localhost:8790/dashboard/`, the §2.3 scope string), then enabled it with `UPDATE oauth_clients SET is_enabled=1` on the local DB only. Client id and secret are in the gitignored `dashboard/.env.local`; the secret was never printed.

### Decisions
- **OAuth library:** hand-rolled `fetch` + `jose` (the playbook's named fallback) instead of `openid-client`. Every OpenEMR call goes through the injected `fetch`, so the whole flow runs in tests against a mocked token endpoint and JWKS.
- **`DASHBOARD_OAUTH_ISSUER` is the full issuer** (`<site_addr_oath>/oauth2/default`, the id token `iss` and the discovery `issuer`), not the bare origin. Authorize and end-session URLs hang off it; `/token` and JWKS use `DASHBOARD_OPENEMR_INTERNAL_URL` plus the issuer path.
- **Patient selection by MRN** (owner instruction for this slice; the playbook listed patient search as out of scope): `GET /dashboard/bff/patients/by-mrn/:mrn` → `fhir.patient.search?identifier=<mrn>`. Only entries whose `PT` identifier equals the MRN count (the FHIR token search also matches `ss`); 0 → "not found", 2+ → `AMBIGUOUS_MRN` error. The patient view stays keyed by uuid.
- **Status rule:** Deceased iff `deceasedDateTime` is present or `deceasedBoolean === true` (OpenEMR writes `deceasedBoolean: false` for the living, `FhirPatientService.php:741-752`). `Patient.active` is parsed but never read.
- **Age:** one formatter following `PatientService::getPatientAge()` (years above 24 months, else months) for both "Age" and "Age at death" (7.17).
- **Fixtures are shaped, not recorded.** No local token exists without a human sign-in, so `test/fixtures/shaped/*.json` take their values from read-only SELECT on the local synthetic DB (pids 3, 12, 13 and DASH-SYN-02 = local pid 15) and their structure from `FhirPatientService::parseOpenEMRRecord()` and the REST envelope; each file's `_meta` says so. `npm run test:integration -- --record` writes recorded responses once the owner supplies a token.
- **Accessibility tests use `axe-core` directly** (`vitest-axe` is 0.1.0 and unmaintained). The color-contrast rule is off in jsdom (no layout or canvas) and moves to the manual pass in 01-06-01.
- CSP `form-action` also allows the issuer origin when it differs from the public origin (locally 8790 vs 9300), because browsers apply `form-action` to the 303 that answers the sign-out POST. In production both are one origin and it is `'self'` only.

### Tests
- Gate (`npm run check --prefix dashboard` + full `.githooks/pre-commit`): 99 tests, all passing: unit 33 (`test/core`) · contract 12 · BFF 41 (`fastify.inject`: auth 12, security 11, health/config 7, mapper 10, log redaction 1) · lint-boundary 3 · component 10 (6 with axe, 0 violations). Typecheck 0 errors, lint 0 problems, bundle 70.3 kB gzip JS (budget 150 kB), 0.6 kB CSS. The full hook passed on every commit from `12de1be` on (e.g. `976f748`, `5baf5fd`). The Docker image also builds locally (`docker build -f dashboard/Dockerfile .`; its build stage ran the same 99 tests) and serves `/dashboard/health` and the SPA.
- Deliberate regression: `deriveStatus()` changed to `patient.active === false ? 'Deceased' : 'Active'` → the hook refused the commit with 7 red tests, including `header parity … pid 12 (deceasedDateTime set) is Deceased with "Age at death"`, `… active:false with no deceased fields is still Active (Patient.active is ignored)`, the pid 12 contract case and the BFF DTO case → reverted; the next commit (`976f748`) passed the full hook. Output: `docs/legacy-audit/evidence/slice-01-regression.txt`.
- Integration (local stack): `npm run test:integration --prefix dashboard` → `SKIPPED (no token)`. A skip, not a pass.
- Live (local, unauthenticated): `node dashboard/scripts/live-check.mjs http://localhost:8790 any` → PASS, 6/6 (health `git_sha` = `unversioned` from a plain checkout, SPA with CSP, session unauthenticated, card route 401, query string 400, `/login` 302 with S256, state, nonce, the exact scopes and the cookie flags). Following the authorize URL reached OpenEMR's OAuth2 login page ("OpenEMR Authorization"), not the core login. No credentials were entered.
- Live (public): not deployed, and `live-check.mjs` not run against the public URL. Authenticated checklist: **not yet observed** (the owner must sign in, locally and in Window 1).

### BUGS-MITIGATIONS.md updates
- None struck through yet: entries are struck when the slice is merged, and this slice is not merged.

### Open questions / follow-ups
- **Owner sign-in (local):** run `npm run dev --prefix dashboard`, open `http://localhost:8790/dashboard/`, sign in, open DASH-SYN-01 / pid 13, pid 3 and pid 12 / DASH-SYN-02, then sign out. With a token from that session, run `DASHBOARD_IT_ACCESS_TOKEN=… npm run test:integration --prefix dashboard -- --record`.
- **Before the next deploy of any service**, the VM `.env` needs the required `DASHBOARD_*` values (HD-4). The compose file now uses `${VAR:?}` for them, and Compose refuses to interpolate the file without them.
- R-3 (issuer/host split) stays untested until the first production sign-in. The fallback is to point `DASHBOARD_OPENEMR_INTERNAL_URL` at the public origin.
- The nonce check assumes OpenEMR's id token carries the `nonce` stored in the authorization session (`IdTokenSMARTResponse.php:172-175`). If the first real sign-in fails with reason `id-token` in the BFF log, check that first.
- The Caddyfile was not validated with the `caddy` binary locally (the image is not present); `docker compose config` accepts the compose file.
- `DASHBOARD_OPENEMR_TZ` stays a placeholder until 01-02-01 (the local stack's PHP runs UTC).

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

## 2026-09-25 ~20:00 CT — slice 01-01-01 deployed (f8d7bdf)

Merged to main via MR !81, then MR !82 fixed a BUILD_SHA test that failed on the git-archive tree (the production image build runs the suite). Production client registered and enabled; env written on the VM. Public checks without login pass. Status: **wired, tested, deployed; human sign-in not yet observed** (grader login by David).
