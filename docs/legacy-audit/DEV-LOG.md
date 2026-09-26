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

## 2026-09-25 — Arc 01 / Story 01-02 / Slice 01-02-03 — Medications card

**Status:** ready-for-commit (committed on the branch; not merged, not deployed) · **Branch:** `agentforge/w2-dashboard` (owner instruction) · **SHA:** code at `eecda54`; no merge SHA yet

### Slice plan
Flow / requirement delivered: W2D-3 (Medications card), with the dosage-instructions gap shown and a source label that separates it from Prescriptions.
Legacy behavior replaced: `walkthroughs/ISSUE-CARDS.md` (Medications), `templates/patient/card/medication.html.twig`.
Layers touched: core (`dto` `MedicationRow`, `guards` `isMedicationRow`, `upstreamRoutes`) · bff (`upstream/mapResponse` opt-in 404 mapping, `upstream/schemas/medication`, `cards/medications`, `http/routes`) · web (`cards/MedicationsCard`, `App`) · tests · README.
Upstream route added to the allow-list: `rest.medication.list` (`/api/patient/{pid}/medication`; the path param is an integer pid that must parse as one, taken only from `rest.patient.read`; no query keys; scope `user/medication.rs`, ACL `patients/med`).
Catalog IDs: 6.04 (404 + empty body = no rows), 6.07 (a 500 is an error like any other), 7.25 (source label), 4.05 (dosage gap noted), 8.02 (one extra patient read per card; timing in 01-06-01).
Deliberate regression: map every 404 to error → expected red: pid 3 renders an error instead of "Nothing Recorded".
Acceptance check (a user can do this): pid 13 shows the single active medication; pid 3 shows the empty state, not an error.

### Worked on
- `mapUpstream` gained `notFoundEmptyBodyIsEmpty`, set by the Medications use case only: HTTP 404 with an empty body → empty. A 404 with a body, non-JSON text, a 404 on any other route (including the patient read) and any other status stay errors; each is a test.
- BFF `/dashboard/bff/patients/:puuid/medications`: `rest.patient.read` (pid) → `rest.medication.list` for that pid (bare array; `type` must be `medication`, every row's `pid` must be the resolved one) → `filterActiveIssues` → `sortByBegdateAsc` (the route itself orders by `date DESC`). `ok` carries the note "Dosage instructions: not available via API".
- SPA `MedicationsCard` ("Medications") under Medical Problems with the one-line source label "The patient's medication list (active entries); prescriptions are listed separately." and the footnote.
- Fixtures: `rest.medication.list` added to `patient-13` (5 rows, `ORDER BY date DESC, id DESC`: all 5 share one `date`), `patient-3` and `dash-syn-02` (404, empty body, as `responseHandler()` writes it), `dash-syn-01` (2 rows, one with a past enddate).
- Integration script: medications counts (pid 13: 1, pid 3: empty despite the 404, DASH-SYN-01: 1). It logs route ids and status codes only.

### Decisions
- The 404 mapping is opt-in per call, not per route id, so the header, allergy and problem calls cannot inherit it by accident; the mapper test asserts both the opt-in and the default.
- The footnote is shown with rows only (no rows, no dosage to miss).

### Tests
- Gate (`npm run check --prefix dashboard` + full `.githooks/pre-commit`, commit `eecda54`): 198 tests, all passing (+16): unit 70 · contract 40 (`medications` 7 new) · BFF 51 (`mapResponse` +1, `cardRoutes` +1; log redaction now drives all three issue cards and checks every allergy, problem and medication title and uuid is absent from the log) · lint-boundary 3 · component 34 (`MedicationsCard` 6 new, all with axe, 0 violations). Typecheck 0, lint 0, bundle 71.0 kB gzip JS.
- Deliberate regression: the medication 404-with-empty-body branch returns `bad-status` instead of `empty-success` → the hook refused the commit (exit 1, HEAD unchanged) with 4 red: contract `pid 3: the route answers 404 with an empty body, which is "Nothing Recorded", not an error (6.04)`, contract `DASH-SYN-02 (404, empty body) is empty; …`, HTTP `Medications: the upstream 404 with an empty body reaches the browser as "empty", never as an error`, mapper `404 with an empty body is empty only on a route that opts in (6.04); …` → reverted. Output: `docs/legacy-audit/evidence/slice-02-03-regression.txt`.
- Integration (local stack): `SKIPPED (no token)`.
- Live: not merged or deployed. **Wired, tested, not yet observed.**

### BUGS-MITIGATIONS.md updates
- None struck through (not merged).

### Open questions / follow-ups
- Window 2: pid 13 shows 1 row (not 5) with no dosage text and the footnote; pid 3 shows "Nothing Recorded" while the upstream status is 404 (the integration log records the status code).
- Story 01-02 is code-complete on the branch. Merge, deploy and the authenticated windows are the owner's; `DASHBOARD_OPENEMR_TZ` on the VM should be confirmed first (01-02-01 entry).

## 2026-09-25 — Arc 01 / Story 01-02 / Slice 01-02-02 — Medical Problems card

**Status:** ready-for-commit (committed on the branch; not merged, not deployed) · **Branch:** `agentforge/w2-dashboard` (owner instruction) · **SHA:** code at `fbadb5e`; no merge SHA yet

### Slice plan
Flow / requirement delivered: W2D-3 (Problem List card) with its own forbidden state.
Legacy behavior replaced: `walkthroughs/ISSUE-CARDS.md` (Medical Problems), `templates/patient/card/medical_problems.html.twig`.
Layers touched: core (`rules/issues` `sortByBegdateAsc` + `dedupeByUuid`, `dto` `ProblemRow`, `guards` `isProblemRow`, `upstreamRoutes`) · bff (`upstream/schemas/problem`, `cards/problems`, `http/routes`) · web (`cards/ProblemsCard`, `App`) · tests · README.
Upstream route added to the allow-list: `rest.problem.list` (`/api/patient/{puuid}/medical_problem`, no query keys, scope `user/medical_problem.rs`, ACL `encounters/notes`).
Catalog IDs: 5.08 (shared rule), 3.14 (this route's ACL is `encounters/notes`; the card handles its own 403), M-8 (REST, not FHIR `Condition`: the FHIR rule would show 39 rows for pid 13).
Deliberate regression: remove the sort → expected red: the order tests.
Acceptance check (a user can do this): pid 13 shows the same 13 problems as the legacy card, in the same order.

### Worked on
- `sortByBegdateAsc` (stable; null, `''` and missing first, like MySQL `ORDER BY lists.begdate`; a bare date sorts as midnight) and `dedupeByUuid` in `core/rules/issues.ts`.
- BFF `/dashboard/bff/patients/:puuid/problems`: `rest.patient.read` → `rest.problem.list` → per-row `puuid`/`pid` check → de-duplicate → `filterActiveIssues` → sort. The browser receives only the shown rows (13 for pid 13, not 39; asserted over HTTP in `test/bff/cardRoutes.test.ts`).
- SPA `ProblemsCard` ("Medical Problems", title-only rows) under Allergies, the legacy order.
- Fixtures: `rest.problem.list` added to `patient-13` (39 rows), `patient-3`, `dash-syn-01` (3 rows, one with a past enddate), `dash-syn-02` (none). `ConditionService::search()` has no `ORDER BY`, so the shaped rows are listed newest-id-first; locally id order equals begdate order, so an id-ordered fixture could not tell a sort from no sort (the `_meta` note says so).
- Integration script: problems counts (pid 13: 13, pid 3: empty, DASH-SYN-01: 2).

### Decisions
- **One row per problem uuid.** `ConditionService::search()` LEFT JOINs `issue_encounter`/`form_encounter` and does not de-duplicate, so a problem linked to N encounters comes back N times; the PHP card (`PatientIssuesService`) shows it once. Locally no problem is linked to an encounter (pid 13: 39 joined rows = 39 distinct), so the fan-out is covered by a hand-edited fixture case only.
- The 403 case is proved in contract and HTTP tests (the problems route 403s while Allergies returns `ok` from the same fake OpenEMR). It cannot be observed live with the admin role; that stays deferred to Arc 02 as the arc says.

### Tests
- Gate (`npm run check --prefix dashboard` + full `.githooks/pre-commit`, commit `fbadb5e`): 182 tests, all passing (+20): unit 69 · contract 33 (`problems` 8 new) · BFF 49 (`cardRoutes` +2; log redaction now also drives the problems card and checks every problem title and uuid is absent from the log) · lint-boundary 3 · component 28 (`ProblemsCard` 6 new, all with axe, 0 violations). Typecheck 0, lint 0, bundle 70.9 kB gzip JS.
- Deliberate regression: `sortByBegdateAsc()` comparator `a.k < b.k ? -1 : 1` → `a.index - b.index` (keeps API order) → the hook refused the commit (exit 1, HEAD unchanged) with 3 red: contract `pid 13: 13 of 39 rows, in begdate order …`, contract `DASH-SYN-01: … the other two are sorted by begdate`, and unit `sortByBegdateAsc … orders ascending …` → reverted. Output: `docs/legacy-audit/evidence/slice-02-02-regression.txt` (synthetic titles in the diffs redacted).
- Integration (local stack): `SKIPPED (no token)`.
- Live: not merged or deployed. **Wired, tested, not yet observed.**

### BUGS-MITIGATIONS.md updates
- None struck through (not merged).

### Open questions / follow-ups
- Window 2: pid 13 shows 13 rows in the order of `SELECT id, begdate FROM lists WHERE pid=13 AND type='medical_problem' AND outcome != 1 AND (enddate IS NULL OR enddate > NOW()) ORDER BY begdate`; pid 3 "Nothing Recorded".
- Hook output prints fixture titles when a contract test fails (vitest diffs). They are synthetic, but evidence files redact them; if that matters for CI logs later, compare by index instead of title.

## 2026-09-25 — Arc 01 / Story 01-02 / Slice 01-02-01 — Allergies card

**Status:** ready-for-commit (committed on the branch; not merged, not deployed) · **Branch:** `agentforge/w2-dashboard` (owner instruction) · **SHA:** code at `f83573c`; no merge SHA yet

### Slice plan
Flow / requirement delivered: W2D-3 (Allergies card) with distinct loading, empty, forbidden, error and sign-in-again states.
Legacy behavior replaced: `walkthroughs/ISSUE-CARDS.md` (Allergies), `templates/patient/card/allergies.html.twig`.
Layers touched: core (`rules/issues`, `dto` `AllergyRow`, `guards` `isAllergyRow`, `upstreamRoutes`) · bff (`clock.localDateTimeInZone`, `upstream/mapResponse` (`rest-array` shape, stricter envelope), `upstream/schemas/{issues,allergy,list}`, `cards/{patientRead,allergies}`, `http/routes` card-route helper) · web (`components/Card`, `cards/AllergiesCard`, `App`, `styles.css`) · tests · README.
Upstream routes added to the allow-list: `rest.allergy.list` (`/api/patient/{puuid}/allergy`, no query keys, `patients/med`), `rest.list.read` (`/api/list/severity_ccda`, a fixed literal: no parameters, no query keys, `lists/default`; the only route with `patientBinding: 'none'`, asserted by test).
Catalog IDs: 5.08, 5.18, 4.02, 7.05, 7.13 (4.03 no promote-to-top, kept).
Deliberate regression: `isActiveIssue()` compares with `>=` instead of `>` → expected red: the `filterActiveIssues` boundary cases.
Acceptance check (a user can do this): open pid 13 and see 2 allergies as in the legacy card, each "(1)"; open pid 3 and see "Nothing Recorded".

### Worked on
- `core/rules/issues.ts`: `isActiveIssue` / `filterActiveIssues` (PHP 8 loose `outcome != 1`, PHP `empty()` on `enddate`, strict `>` against now as a naive local time in `DASHBOARD_OPENEMR_TZ`), `isSevereAllergy`, `buildListLabels` (active options only, like `LayoutsUtils::getListItemTitle()`), `severityLabel` (title, else raw code, else "").
- BFF `/dashboard/bff/patients/:puuid/allergies`: `rest.patient.read` → `rest.allergy.list` → `rest.list.read` (only when a row is shown). Every row's `puuid` and `pid` must be the requested patient's, else `PATIENT_MISMATCH`.
- SPA: shared `Card` shell (title bar, collapse toggle with `aria-expanded`, default expanded, per-viewer `localStorage` behind try/catch; exactly one state rendered; forbidden reads "Not authorized for this section."). `AllergiesCard` renders "title (label)" in API order with the legacy tooltip and the `bg-warning`-style highlight on severe, life-threatening and fatal only.
- Fixtures (shaped, not recorded): `rest.allergy.list` added to `patient-13`, `patient-3`, `dash-syn-02`; new `dash-syn-01.json` (pid 14) and `list-severity-ccda.json`; values from read-only SELECT on the local synthetic DB; each file's `_meta` says so.
- `test/integration/header.it.ts` gained allergy count checks (pid 13: 2, pid 3: empty, DASH-SYN-01: 1). The arc named a separate `allergies.it.ts`; one opt-in script keeps one token and one command.

### Decisions
- **Every issue card resolves the patient first** (`rest.patient.read`) and calls no card route until that read succeeds (ISSUE-CARDS.md (b)1 and (e) last item). That also gives the `pid` for the per-row check and, in 01-02-03, for the Medications route. Cost: one extra upstream call per card (8.02 latency, measured in 01-06-01).
- **Severity labels are fetched once per card load, not cached across requests.** The playbook said "cached per process"; a process-wide cache would serve a label map fetched with one user's token (`lists/default`) to another user. Per load it is still one call, not the legacy per-row N+1. A failed lookup shows raw codes plus a visible note; the card stays `ok`.
- **No code → "()"**: a row with no `severity_al` renders "title ()" as the legacy template does (bug-for-bug, documented in `severityLabel`).
- **Stricter REST envelope mapping** (fail loudly): a 200 whose body is not an envelope, or an envelope with no `data` key or `data: null`, is now `SCHEMA_MISMATCH`; before, a missing `data` mapped to empty. No existing test depended on the old behavior.
- **Dates**: `begdate`/`enddate` must be `YYYY-MM-DD[ HH:MM:SS]`, `''` or null; anything else is `SCHEMA_MISMATCH`, so the rule never guesses a format. A MySQL zero date is accepted and, as in PHP, hides the row.
- **Timezone**: the local stack's PHP runs UTC (`date.timezone => UTC`, `gbl_time_zone` empty; checked 2026-09-25), matching `dashboard/.env.local` (`UTC`). The compose default is `America/Chicago`; production's PHP timezone is **not verified** (open question below).

### Tests
- Gate (`npm run check --prefix dashboard` + full `.githooks/pre-commit`, commit `f83573c`): 162 tests, all passing (+63 over the slice 01 baseline of 99): unit 65 (`issues` 31 new) · contract 25 (`allergies` 13 new) · BFF 47 (`cardRoutes` 4 new, `mapResponse` +2, log redaction now includes the allergy card) · lint-boundary 3 · component 22 (`AllergiesCard` 12 new, 7 with axe, 0 violations). Typecheck 0, lint 0, bundle 70.9 kB gzip JS (budget 150 kB).
- Deliberate regression: `return normalized > now` → `>=` in `isActiveIssue()` → the hook refused the commit (exit 1, HEAD unchanged) with 3 red: `enddate equal to now is hidden (strictly greater)`, `enddate today at midnight: shown just before midnight, hidden at midnight`, and the contract case `future and past enddates: only the future one stays` → reverted. Output: `docs/legacy-audit/evidence/slice-02-01-regression.txt`.
- Integration (local stack): `npm run test:integration --prefix dashboard` → `SKIPPED (no token)`. A skip, not a pass.
- Live: not merged or deployed. **Wired, tested, not yet observed.**

### BUGS-MITIGATIONS.md updates
- None struck through: entries are struck when the slice is merged.

### Open questions / follow-ups
- **Production timezone:** confirm the production OpenEMR PHP `date.timezone` / `gbl_time_zone` and set `DASHBOARD_OPENEMR_TZ` to match on the VM (the compose default `America/Chicago` is wrong if production PHP runs UTC like the local stack). Wrong zone shifts the enddate cut-off by the UTC offset.
- Owner sign-in (Window 1): pid 13 shows 2 rows, both "(1)", no highlight; pid 3 "Nothing Recorded"; DASH-SYN-01 shows 1 highlighted "(Severe)" row.

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

## 2026-09-25 ~20:15 CT — slice 01-01-01 observed live

David signed in as `grader` on the public URL and confirmed both headers. Slice 01 meets the AGENTS.md definition of done on `f8d7bdf`.
