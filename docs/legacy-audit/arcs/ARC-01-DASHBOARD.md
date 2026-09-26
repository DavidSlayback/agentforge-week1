# Arc 01 — Patient dashboard port, to the deadline

**Status:** planned · **Depends on:** HD-1…HD-8 in
[`../MIGRATION-REACT.md`](../MIGRATION-REACT.md) §15 (per slice below) ·
**Estimated:** about 18.5 h of work, Fri 2026-09-25 evening → Sun 2026-09-27
09:00 CT. Freeze at 08:00 and deadline at 12:00 (`docs/agentforge/PLAN.md`).

Process, architecture, gates and deploy mechanics are in `MIGRATION-REACT.md`.
Requirement status of record is `docs/agentforge/PLAN.md` W2D-1…W2D-8. This
file holds the ordered slices, their acceptance checks and their time boxes.

## Goal

By the freeze, one SHA on GitLab `main` must be deployed with `/dashboard/`
live. At that SHA, a clinician can:
1. sign in through OpenEMR's OAuth2 server via the BFF, and sign out;
2. open a patient by uuid and see the persistent header (name, DOB, sex, MRN,
   active status);
3. see Allergies, Medical Problems, Medications, Prescriptions, Care Team and
   Vitals, each with live data and distinct loading, empty, error and
   forbidden states, matching the legacy dashboard except for the documented
   deviations.

`PATIENT_DASHBOARD_MIGRATION.md` defends the choice at the repo root.

## Out of scope

- Everything in `MIGRATION-REACT.md` §1 "Out of scope".
- Arc 02 (post-deadline side quests): the severe-allergy sort (4.03), patient
  search, restricted-user ACL tests, a zero-vitals test patient, upstream
  reports.

## Schedule at a glance (CT)

| When | Slice | Time box | Observation |
|---|---|---|---|
| Fri 19:00–23:30 | 01-01-01 walking skeleton, local part | 4.5 h | local only |
| Sat 08:00–10:00 | 01-01-01 walking skeleton, deploy part | 2.0 h | public (unauthenticated `live-check`) |
| Sat 10:00–11:45 | 01-02-01 Allergies | 1.75 h | — |
| **Sat 12:00** | **Checkpoint / circuit breaker** (below) | 0.25 h | **Window 1** (authenticated): 01-01-01, 01-02-01 |
| Sat 12:15–13:15 | 01-02-02 Problems | 1.0 h | — |
| Sat 13:15–14:15 | 01-02-03 Medications | 1.0 h | — |
| Sat 14:15–15:45 | 01-03-01 Prescriptions | 1.5 h | — |
| Sat 15:45–17:45 | 01-04-01 Care Team | 2.0 h | — |
| Sat 17:45–19:45 | 01-05-01 Vitals | 2.0 h | — |
| Sat 20:00–21:30 | 01-06-01 Parity evidence and hardening | 1.5 h | **Window 2** (authenticated): 01-02-02 … 01-05-01 |
| Sat 21:30–23:30 | 01-06-02 `PATIENT_DASHBOARD_MIGRATION.md` | 2.0 h | — |
| Sun 07:00–08:00 | Buffer; last merge before the freeze | 1.0 h | — |
| Sun 08:00–09:00 | 01-06-03 Freeze deploy and evidence (inside PLAN S11) | 1.0 h | **Window 3** (authenticated): everything at the freeze SHA |

**Scheduling rules**
- Start times shift with reality; durations don't.
- Stop and ask if a slice exceeds 150% of its box (PLAN.md).
- Every slice deploys after its merge and runs `live-check.mjs`
  unauthenticated.
- The authenticated card checks happen in the three observation windows,
  because David must sign in; agents may not type credentials.
- Until a slice's window, it is reported as `wired, tested, not yet observed`.

## Catalog items resolved in this arc

| ID | Title (short) | Resolved by slice |
|---|---|---|
| 8.01 | Public clients can't get `user/` scopes | 01-01-01 |
| 4.01 | CORS preflight dead | 01-01-01 |
| 3.01 | `set_pid` before authorization | 01-01-01 |
| 3.02 | Identity before the ACL gate | 01-01-01 |
| 3.13 | Unscoped collection routes | 01-01-01 |
| 3.16 | `set_pid` state change on GET | 01-01-01 |
| 4.04 | Identity bar has no sex/status | 01-01-01 |
| 4.06 | No route by integer pid | 01-01-01 |
| 5.04 | Fragments carry no patient id | 01-01-01 |
| 5.09 | `set_pid` not validated | 01-01-01 |
| 6.01 | Error text leaks SQL | 01-01-01 |
| 6.05 | `fetchHtml` has no error handling | 01-01-01 |
| 7.03 | Breaks outside the shell | 01-01-01 |
| 7.04 | Identity bar names the previous patient | 01-01-01 |
| 7.09 | Back-button navigation | 01-01-01 |
| 7.17 | Age formatting | 01-01-01 |
| 7.18 | Two name builders | 01-01-01 |
| 8.06 | Tabbed shell | 01-01-01 |
| 2.04 | Twig autoescape off (lint ban + JSX) | 01-01-01 |
| 5.08 | `filterActiveIssues` vs FHIR | 01-02-01 |
| 5.18 | FHIR criticality ≠ severe highlight | 01-02-01 |
| 4.02 | Empty-state wording | 01-02-01 |
| 7.05 | Collapse bound late | 01-02-01 |
| 7.13 | Collapse default first-user-wins | 01-02-01 |
| 6.04 | Medications 404 empty body | 01-02-03 |
| 7.25 | Meds vs Rx confusing (labels) | 01-02-03, 01-03-01 |
| 2.01 | SQLi through parameter names (M-1), for our calls | 01-03-01 |
| 8.13 | Two columns under one key | 01-03-01 |
| 2.02 | Care Team stored XSS | 01-04-01 |
| 8.04 | Care Team from embedded JSON | 01-04-01 |
| 7.14 | Care Team no empty state | 01-04-01 |
| 7.15 | Care Team names from `<select>` | 01-04-01 |
| 5.01 | Vitals deleted set (Critical) | 01-05-01 |
| 5.02 | FHIR vitals deleted sets (Critical) | 01-05-01 |
| 7.20 | Vitals `SELECT *` order | 01-05-01 |
| 7.24 | Vitals card position (decided: keep legacy order) | 01-05-01 |
| 7.08 | Slow loads (measured) | 01-06-01 |
| 7.12 | No accessibility tests | 01-01-01 (gate), 01-06-01 (audit) |
| 7.10 | Wall of text | **won't**: the brief forbids redesign (recorded in 01-06-02) |

The "port depends on it" rules (1.01–1.04, 1.06, 1.08, 1.11, 2.03, 3.14,
4.08–4.10, 5.03, 5.05, 5.06, 6.02, 6.03, 6.06, 6.07, 9.01, 9.03, 9.04, 10.01,
10.04) are enforced by the slices named in `MIGRATION-REACT.md` §2.6. They're
not struck through, because the legacy bug remains.

## Legacy behavior covered

- [`ui/DASHBOARD-HEADER.md`](../ui/DASHBOARD-HEADER.md), [`walkthroughs/SIGN-IN-AND-HEADER.md`](../walkthroughs/SIGN-IN-AND-HEADER.md) — sign-in and header
- [`ui/CARD-TEMPLATES.md`](../ui/CARD-TEMPLATES.md), [`walkthroughs/ISSUE-CARDS.md`](../walkthroughs/ISSUE-CARDS.md) — Allergies, Problems, Medications
- [`ui/PRESCRIPTION-TEMPLATES.md`](../ui/PRESCRIPTION-TEMPLATES.md), [`walkthroughs/PRESCRIPTIONS.md`](../walkthroughs/PRESCRIPTIONS.md) — Prescriptions
- [`ui/CARE-TEAM-CARD.md`](../ui/CARE-TEAM-CARD.md), [`walkthroughs/CARE-TEAM.md`](../walkthroughs/CARE-TEAM.md) — Care Team
- [`ui/VITALS-FRAGMENT.md`](../ui/VITALS-FRAGMENT.md), [`walkthroughs/VITALS.md`](../walkthroughs/VITALS.md) — Vitals

---

## Story 01-01 — Sign in and see the patient header (W2D-1, W2D-2, W2D-8)

### Slice 01-01-01 — Walking skeleton: sign-in via BFF + persistent header, deployed

- [ ] **Merged** · [ ] **Observed on the public URL**
- **Status (2026-09-25, local part, branch `agentforge/w2-dashboard`):**
  implemented and gated (`npm run check --prefix dashboard` in
  `.githooks/pre-commit` since `12de1be`; deliberate regression shown red,
  `docs/legacy-audit/evidence/slice-01-regression.txt`). Sign-in and the
  header are **wired, tested, not yet observed**: the compose service, Caddy
  route and `deploy.sh` health loop are committed but not merged or deployed,
  and no interactive sign-in has happened yet (the owner signs in; agents
  may not type credentials). Details: `DEV-LOG.md`, entry of 2026-09-25.
- **Time box:** 6.5 h in two parts.
  - Local part: Fri 19:00–23:30. Milestone: local sign-in and the pid 13
    header work, and the hook is green.
  - Deploy part: Sat 08:00–10:00.
- **Prerequisites:** HD-8 (the audit docs on `main`) and HD-2 (local client
  redirect) before starting. HD-1, HD-3, HD-4 and HD-6 before the deploy part.
- **Goal / flow delivered:** a user opens `/dashboard/`, clicks "Sign in with
  OpenEMR", and authenticates on OpenEMR's OAuth2 login and consent pages.
  They land back on `/dashboard/`, open
  `/dashboard/patients/<puuid of pid 13>`, and see the header: name, DOB (with
  age), sex, MRN and status. Sign-out returns them to `/dashboard/` signed out.
  The same code is deployed and `/dashboard/health` reports its SHA.
- **Layers touched**
  - **core:** `ids`, `cardResult`, `dto` (header), `upstreamRoutes`
    (`fhir.patient.read`, `rest.patient.read`), `rules/header`, `format`.
  - **bff:** `config`, `buildInfo`, `auth/*`, `upstream/{client,mapResponse}`,
    `upstream/schemas/patient`, `cards/header`, `http/*`.
  - **web:** `App`, `api`, `useCard`, `components/{PatientHeader,States}`, and
    a landing page with sign-in, sign-out and "Demo patients (configured)".
  - **deploy:** compose, Caddy, `deploy.sh`, SHA stamping.
  - **gate:** hook and CI.
- **Catalog IDs:** listed in the table above against 01-01-01. BFF rules:
  1.01, 1.02, 1.03, 1.04, 1.06, 1.08, 1.11, 2.03, 6.02 and 6.03 (mapper),
  9.01, 9.03, 9.04, 10.01, 10.04.
- **Files expected**
  - All of `dashboard/` scaffolding per `MIGRATION-REACT.md` §3: `package.json`
    and lockfile, `tsconfig*`, `eslint.config.js`, `vitest.config.ts`,
    `Dockerfile`, `BUILD_SHA`, `.gitignore`, `README.md`, and
    `scripts/{live-check,bundle-report}.mjs`.
  - `core/{ids,cardResult,dto,upstreamRoutes,format}.ts`,
    `core/rules/header.ts`.
  - `bff/src/{server,config,buildInfo}.ts`,
    `bff/src/auth/{oauth,session}.ts`,
    `bff/src/upstream/{client,mapResponse}.ts`,
    `bff/src/upstream/schemas/patient.ts`, `bff/src/cards/header.ts`,
    `bff/src/http/{routes,security,health,static}.ts`.
  - `web/{index.html,vite.config.ts}`,
    `web/src/{main,App}.tsx`, `web/src/{api,useCard}.ts`,
    `web/src/components/{PatientHeader,States}.tsx`, `web/src/styles.css`.
  - `test/core/{header,format,upstreamRoutes,mapResponse}.test.ts`,
    `test/bff/{auth,security,health,logRedaction}.test.ts`,
    `test/contract/header.test.ts`, `test/web/PatientHeader.test.tsx`,
    `test/fixtures/recorded/patient-{13,3,12}.*.json`,
    `test/fixtures/hand-built/*.json`, `test/integration/header.it.ts`.
  - Outside `dashboard/`: `.githooks/pre-commit`, `.gitlab-ci.yml`,
    `.gitattributes`, `deploy/vultr/{docker-compose.yml,Caddyfile,deploy.sh,README.md}`.
    Also `AGENTS.md` and `CLAUDE.md` scope lines (C-7), only with David's
    approval.
- **Test gate** (`npm run check --prefix dashboard` inside
  `.githooks/pre-commit`; the CI job mirrors it)
  - **Parity test:** a pid 12 fixture (with `deceasedDateTime`) gives status
    Deceased and "Age at death". Fixtures for pids 13 and 3 give Active. A
    hand-built fixture with `active: false` and no `deceasedDateTime` still
    gives Active.
  - **Contract:** the header use case issues exactly
    `GET /apis/default/fhir/Patient/{puuid}` and
    `GET /apis/default/api/patient/{puuid}` with no query keys. A pid mismatch
    between the two responses produces `PATIENT_MISMATCH`.
  - **BFF HTTP:**
    - cookie flags;
    - `/login` carries S256, `state`, `nonce`, the exact scopes and no
      `offline_access`;
    - no token in any response;
    - CSP and `no-store` headers;
    - `/bff/*` returns 401 without a session;
    - `/bff/*` rejects a query string;
    - logout's Origin check;
    - the compact `/health` JSON;
    - log redaction across the full flow.
  - **Component:** the header renders from its DTO; a late response for a
    previous puuid is discarded; `vitest-axe` is clean.
  - **Boundary lint:** a test proves that a `web → bff` import fails the lint.
  - **Deliberate regression:** change `rules/header.ts` to read
    `Patient.active`. Expected red: the pid 12 "Deceased" test and the
    `active: false` case. Capture the output, then revert.
- **Live evidence to collect** (`walkthroughs/SIGN-IN-AND-HEADER.md` (e))
  - [x] Local: `/authorize` carries the confidential `client_id`, S256,
    `state` and `nonce`, and reaches the OAuth2 login page (not the core
    login). Observed 2026-09-25 without credentials: the BFF's `/login`
    302 → `https://localhost:9300/oauth2/default/authorize` (307) →
    `/oauth2/default/provider/login`, page title "OpenEMR Authorization".
  - [ ] Local: login and consent → 302 to `/dashboard/callback` with `code`
    and the matching `state`. The BFF `/token` call includes the secret and
    returns an access token and an id token. **Wired, tested, not yet
    observed**: `test/bff/auth.test.ts` covers it against a mocked token
    endpoint and JWKS; needs the owner's local sign-in.
  - [ ] Local: pid 13 header shows name, DOB, sex, MRN, **Active**, with no
    missing-field fallback. pid 3 shows the same completeness and **Active**.
    pid 12 shows **Deceased**. **Tested against shaped fixtures, not yet
    observed** (`test/core/header.test.ts`, `test/contract/header.test.ts`;
    `npm run test:integration` checks it live once a token exists).
  - [ ] Local: `GET /api/patient/:puuid` for pid 13 returns `pid` (the
    "resolve pid once" claim). Tested (contract test asserts pid 13 is
    resolved from the shaped REST fixture); not yet observed live.
  - [ ] Local: after sign-out, a replay of the old access token (integration
    test, not the browser) gets `400 "Refresh Token revoked or logged out"`.
    The BFF session is gone either way.
  - [x] Review item: the client secret appears only in the BFF config. Grep
    `web/dist` for it and for `client_secret` and expect zero hits. Done
    2026-09-25 against the local client's secret: zero hits for both; no
    committed file contains it (it lives in the gitignored `dashboard/.env.local`).
  - [ ] Public: `live-check.mjs` passes. `/dashboard/health`
    `git_sha` = the merge SHA, and `deploy.sh`'s health loop printed
    `OK: /dashboard reports <sha>`.
  - [ ] Public (Window 1, David signs in): sign-in round trip; the header for
    the patients chosen under HD-7. Screenshot saved to
    `docs/agentforge/evidence/<sha>/dashboard/`.
- **Acceptance check (a user can do this):** sign in, open pid 13 by link, see
  the correct header, sign out, and be signed out. The same flow works on the
  public URL.
- **Circuit breaker:** if the local sign-in and header aren't working by Sat
  10:00, skip the deploy part until the checkpoint, and raise it at 12:00.

## Story 01-02 — Issue cards (W2D-3: Allergies, Problem List, Medications)

### Slice 01-02-01 — Allergies card

- [ ] **Merged** · [ ] **Observed**
- **Status (2026-09-25, branch `agentforge/w2-dashboard`, code at `f83573c`):**
  **wired, tested, not yet observed.** The BFF route and SPA card are built
  and gated (162 tests in the hook); the deliberate regression (`>` → `>=` in
  `isActiveIssue`) was refused by the hook with 3 red tests
  (`docs/legacy-audit/evidence/slice-02-01-regression.txt`). Not merged or
  deployed, so not yet on the deployed path. Deviations: the card resolves the
  patient (`rest.patient.read`) before calling the allergy route; severity
  labels are fetched per card load rather than cached per process; the
  integration checks live in `test/integration/header.it.ts`. Details:
  `DEV-LOG.md`, 01-02-01 entry.
- **Time box:** 1.75 h, Sat 10:00–11:45. This is the first card, so it also
  builds the shared `Card` shell (six states, collapse state kept in
  `localStorage` with try/catch) and the severity lookup.
- **Goal:** the Allergies card shows the active allergies. Each row gets its
  severity label with the raw-code fallback, and only
  severe/life-threatening/fatal rows are highlighted. The card keeps API
  order.
- **Catalog IDs:** 5.08, 5.18, 4.02, 7.05, 7.13 (4.03: no promote-to-top,
  recorded).
- **Files expected**
  - `core/rules/issues.ts` (`filterActiveIssues`, `sortByBegdateAsc`),
    `core/dto.ts` (`AllergyRow`), and in `core/upstreamRoutes.ts` the routes
    `rest.allergy.list` and `rest.list.read`.
  - `bff/src/upstream/schemas/{allergy,list}.ts`,
    `bff/src/cards/allergies.ts`.
  - `web/src/components/Card.tsx`, `web/src/cards/AllergiesCard.tsx`.
  - Tests: `test/core/issues.test.ts`, `test/contract/allergies.test.ts`,
    `test/web/AllergiesCard.test.tsx`, recorded fixtures for pids 13 and 3,
    and `test/integration/allergies.it.ts`.
- **Test gate**
  - [x] `filterActiveIssues` boundary table (MIGRATION-REACT §6.1), with the
    `DASHBOARD_OPENEMR_TZ` value confirmed from the stack (`test/core/issues.test.ts`;
    local PHP runs UTC, matching `.env.local`; production not yet confirmed).
  - [x] Contract: pid 13 gives 2 rows labelled "(1)" with no highlight; pid 3
    gives `empty` (`test/contract/allergies.test.ts`, shaped fixtures).
  - [x] Contract: `list/severity_ccda` failing → raw labels, and the card is still
    `ok`.
  - [x] Contract: 200 with `validationErrors` → `error`.
  - [x] Component: all six states; the exact text "Nothing Recorded"; axe clean
    (`test/web/AllergiesCard.test.tsx`).
  - [x] **Deliberate regression:** change the rule to `enddate >= now` (or drop
    the `outcome != 1` test). Expected red: the `filterActiveIssues` boundary
    cases. Done: 3 red, commit refused, reverted.
- **Live evidence** (`walkthroughs/ISSUE-CARDS.md` (e))
  - [ ] pid 13: exactly 2 rows, both "(1)", neither highlighted.
  - [ ] pid 3: "Nothing Recorded".
  - [ ] The BFF didn't call the allergy route before the patient read
    resolved (verified by the ordering of the contract test's fake-fetch
    calls, plus the local integration run). Contract part done
    (`pid 13: …` and `no allergy call until the patient read succeeds`);
    the integration run is still `SKIPPED (no token)`.
- **Acceptance check:** open pid 13 and see 2 allergies as in the legacy card.
  Open pid 3 and see "Nothing Recorded".

### Saturday 12:00 CT checkpoint (circuit breaker) — 15 min with David

**Must be true**
1. 01-01-01 is merged, deployed, and passes `live-check`, with `/dashboard/health`
   reporting the `main` SHA.
2. Window 1 is observed: David signs in on the public URL; the header and
   Allergies are checked.
3. 01-02-01 is merged or in review.
4. The hook is green on `main`, and both deliberate regressions are recorded
   in DEV-LOG.

**If sign-in plus the header doesn't work locally at 12:00**, stop and re-plan
with David (`MIGRATION-OPTIONS.md` R1 roadmap step 2). The options are:
- (a) reuse the Phase 6 token path for local development only, with no
  deploy change, while the OAuth flow is debugged;
- (b) drop to the fallback OAuth implementation (hand-rolled `fetch` + `jose`,
  §4);
- (c) re-scope the cards.

**If the skeleton works but is behind schedule**, cut in this order:
1. dual-unit display in Vitals (single unit plus a note);
2. Practitioner/Organization name fan-out in Care Team (fall back to the
   reference `display`, labelled);
3. screenshot pairs for pid 3 in 01-06-01 (keep pid 13);
4. the manual keyboard audit (keep automated axe).

**Never cut:** the allow-list and its regression proof, the error/empty
mapping, the hook wiring, SHA reporting, or `PATIENT_DASHBOARD_MIGRATION.md`.

Record the checkpoint outcome in DEV-LOG and `AUDIT-STATE.md`.

### Slice 01-02-02 — Medical Problems card

- [ ] **Merged** · [ ] **Observed**
- **Status (2026-09-25, branch `agentforge/w2-dashboard`, code at `fbadb5e`):**
  **wired, tested, not yet observed.** Built and gated (182 tests in the
  hook); the deliberate regression (sort removed) was refused by the hook with
  3 red tests (`docs/legacy-audit/evidence/slice-02-02-regression.txt`). Not
  merged or deployed. Addition: rows are de-duplicated by uuid (the REST route
  repeats a problem once per linked encounter; the PHP card does not).
  Details: `DEV-LOG.md`, 01-02-02 entry.
- **Time box:** 1.0 h, Sat 12:15–13:15.
- **Goal:** the Medical Problems card shows the PHP-active problems sorted by
  `begdate` ascending, NULLs first, title only.
- **Catalog IDs:** 5.08 (shared rule), 3.14 (this route's ACL is
  `encounters/notes`, so the card handles its own 403), M-8 (why not FHIR,
  for W2D-7).
- **Files expected:** in `core/upstreamRoutes.ts` the route
  `rest.problem.list`; `bff/src/upstream/schemas/problem.ts`,
  `bff/src/cards/problems.ts`, `web/src/cards/ProblemsCard.tsx`; tests
  `test/contract/problems.test.ts`, `test/web/ProblemsCard.test.tsx`;
  recorded fixtures; `test/integration/problems.it.ts`.
- **Test gate**
  - [x] Contract: pid 13 gives **13** rows in `begdate` order (checked against
    the fixture's own `begdate` values, not a hard-coded id list); pid 3 gives
    `empty`; 403 gives `forbidden` while the other cards stay `ok`
    (`test/contract/problems.test.ts`, `test/bff/cardRoutes.test.ts`).
  - [x] **Deliberate regression:** remove the sort, or filter on `activity`
    instead of `outcome`/`enddate`. Expected red: the order or count test
    (13 ≠ 39). Done (sort removed): 3 red, commit refused, reverted.
- **Live evidence**
  - [ ] pid 13: 13 rows, not 39.
  - [ ] pid 13: order matches `SELECT id, begdate … ORDER BY begdate ASC`
    (`walkthroughs/ISSUE-CARDS.md` (e)).
  - [ ] pid 3: "Nothing Recorded".
  - [ ] Not testable with the admin role: the `patients/med`-only 403 case.
    Recorded as deferred to Arc 02.
- **Acceptance check:** pid 13 shows the same 13 problems as the legacy card,
  in the same order.

### Slice 01-02-03 — Medications card

- [ ] **Merged** · [ ] **Observed**
- **Status (2026-09-25, branch `agentforge/w2-dashboard`, code at `eecda54`):**
  **wired, tested, not yet observed.** Built and gated (198 tests in the
  hook); the deliberate regression (every 404 mapped to error) was refused by
  the hook with 4 red tests
  (`docs/legacy-audit/evidence/slice-02-03-regression.txt`). Not merged or
  deployed. Details: `DEV-LOG.md`, 01-02-03 entry.
- **Time box:** 1.0 h, Sat 13:15–14:15.
- **Goal:** the Medications card shows PHP-active medications sorted by
  `begdate` ascending, title only. A footnote reads "Dosage instructions: not
  available via API". The card header has a one-line source label.
- **Catalog IDs:** 6.04, 6.07, 7.25, 4.05 (gap), 8.02 (latency noted).
- **Files expected:** in `core/upstreamRoutes.ts` the route
  `rest.medication.list` (takes `pid`); `bff/src/upstream/schemas/medication.ts`,
  `bff/src/cards/medications.ts` (reuses the `pid` from `rest.patient.read`),
  `web/src/cards/MedicationsCard.tsx`; tests, fixtures and
  `test/integration/medications.it.ts`.
- **Test gate**
  - [x] Contract: pid 13 gives **1** row. pid 3's recorded **404 with an empty
    body** gives `empty`. A 404 with a body, or a 404 on any other route,
    gives `error` (`test/contract/medications.test.ts`; the pid 3 404 is a
    shaped fixture, not a recording).
  - [x] **Deliberate regression:** map every 404 to `error`. Expected red: pid 3
    renders an error instead of "Nothing Recorded". Done: 4 red, commit
    refused, reverted.
- **Live evidence**
  - [ ] pid 13: 1 row (not 5), with no dosage text.
  - [ ] pid 3: "Nothing Recorded", although the raw upstream status is 404
    (seen in the integration log, which records the status code only).
- **Acceptance check:** pid 13 shows the single active medication; pid 3
  shows the empty state, not an error.

## Story 01-03 — Prescriptions (W2D-3)

### Slice 01-03-01 — Prescriptions card, allow-listed

- [ ] **Merged** · [ ] **Observed**
- **Status (2026-09-25, branch `agentforge/w2-dashboard`, code at `959482e`):**
  **wired, tested, not yet observed.** Built and gated (229 tests in the
  hook); the deliberate regression (the allow-list forwards an unknown key)
  was refused by the hook with 6 red tests
  (`docs/legacy-audit/evidence/slice-03-01-regression.txt`). Not merged or
  deployed. Deviations: empty reads "None" (the legacy Rx card's own text,
  owner decision), not "Nothing Recorded"; the patient check uses each row's
  `puuid`, because the route's outer SELECT has no `patient_id` column;
  Details appends " in <interval>" only (the API never selects `form`).
  Details: `DEV-LOG.md`, 01-03-01 entry.
- **Time box:** 1.5 h, Sat 14:15–15:45. Needs HD-4, which includes the
  `user/prescription.rs` approval.
- **Goal:** the Prescriptions card shows **all** prescription rows, sorted by
  `active` DESC, `date_modified` DESC, `date_added` DESC, then `uuid`. It has
  the Drug, Details, Qty, Refills ("Not available via API") and Filled
  columns. The BFF sends only `patient_id` and `source_table=prescriptions`.
- **Catalog IDs:** 2.01 (for our calls), 4.10, 5.03, 5.06, 8.13, 7.25.
- **Files expected:** in `core/upstreamRoutes.ts` the route
  `rest.prescription.search`; `core/rules/prescriptions.ts`,
  `bff/src/upstream/schemas/prescription.ts`,
  `bff/src/cards/prescriptions.ts`, `web/src/cards/PrescriptionsCard.tsx`;
  tests `test/core/prescriptions.test.ts`,
  `test/contract/prescriptions.test.ts`,
  `test/web/PrescriptionsCard.test.tsx`; fixtures;
  `test/integration/prescriptions.it.ts`.
- **Test gate**
  - [x] Core: the three-key sort, including hand-built cases where `active` and
    `date_modified` differ (pid 13 exercises only `date_added`); DASH-SYN-01
    (pid 14) also exercises both legs with shaped data
    (`test/core/prescriptions.test.ts`, `test/contract/prescriptions.test.ts`).
  - [x] Contract: the outbound URL is exactly
    `/apis/default/api/prescription?patient_id=<pid>&source_table=prescriptions`.
    pid 13 gives 5 rows in order 66, 65, 64, 63, 62. pid 3's 200 `[]` gives
    `empty`. A row with another patient's `puuid` (the rows carry no
    `patient_id`) gives `PATIENT_MISMATCH`.
  - [x] Component: every Refills cell reads "Not available via API", never `0` or
    blank; empty reads "None" (`test/web/PrescriptionsCard.test.tsx`).
  - [x] **Deliberate regression** (`walkthroughs/PRESCRIPTIONS.md` (e) item 7):
    let the BFF forward an arbitrary SPA query key into
    `rest.prescription.search`. Expected red: the allow-list test and the
    outbound-URL contract test. Done: 6 red, commit refused, reverted.
- **Live evidence** (`walkthroughs/PRESCRIPTIONS.md` (e), with `patient_id`
  in place of `pid` per C-9)
  - [ ] Outbound request carries exactly `patient_id` and `source_table`,
    confirmed from the integration log's route id and key list.
  - [ ] pid 13: 5 rows, all `source_table: prescriptions`, in date order
    66 → 62.
  - [ ] pid 3: HTTP 200 `[]` → "None" (the legacy Rx card's empty text; owner decision 2026-09-25).
  - [ ] Refills placeholder on all 5 rows.
  - [ ] No " in <form>" suffix. The `form`-set gap is noted as untested, not
    claimed covered.
  - [ ] A 401 or 403 drill maps to the reauth or forbidden state. This is
    done in 01-06-01.
- **Acceptance check:** pid 13 shows the same 5 prescriptions as the legacy
  card, in the same order; Refills is labelled unavailable.

## Story 01-04 — Care Team (W2D-3)

### Slice 01-04-01 — Care Team card from FHIR

- [ ] **Merged** · [ ] **Observed**
- **Time box:** 2.0 h, Sat 15:45–17:45. Needs HD-3 (FHIR enabled on
  production).
- **Goal:** the Care Team card shows the chosen team (first active by name,
  else first by name) with its status title. Each participant shows Type,
  Member name (from `Practitioner`/`Organization`), Role, Facility and Since.
  Status and Note read "Not available via API". An empty Bundle shows
  "Nothing Recorded".
- **Catalog IDs:** 2.02, 8.04, 8.05, 8.07, 7.14, 7.15, 8.15, 5.05 / M-6 (the
  documented break: 3 participants against the legacy 2), 4.07, 6.03.
- **Files expected:** in `core/upstreamRoutes.ts` the routes
  `fhir.careteam.search`, `fhir.practitioner.read` and
  `fhir.organization.read`; `core/rules/careTeam.ts`,
  `bff/src/upstream/schemas/careTeam.ts`, `bff/src/cards/careTeam.ts`,
  `web/src/cards/CareTeamCard.tsx`; tests `test/core/careTeam.test.ts`,
  `test/contract/careTeam.test.ts`, `test/web/CareTeamCard.test.tsx`
  (including a note containing `<img src=x onerror=…>` that renders as
  literal text); fixtures; `test/integration/careTeam.it.ts`.
- **Test gate**
  - Contract: pid 13 gives 1 team with **3** participants, and the roles
    "Primary Care Provider" and "Nurse" on the active members. pid 3's Bundle
    `total: 0` gives `empty`. An empty Bundle **without** a prior successful
    Patient read gives `error`. An `OperationOutcome` inside a 200 gives
    `error`.
  - Core: team selection with several teams (hand-built).
  - Component: the XSS payload renders as text, and axe is clean.
  - **Deliberate regression:** treat every empty Bundle as `empty`, or pick
    the first team regardless of status. Expected red: the "empty bundle
    without a patient read → error" case, or the team-selection case.
- **Live evidence** (`walkthroughs/CARE-TEAM.md` (e))
  - [ ] Port, pid 13: 1 CareTeam, `participant[]` = 3.
  - [ ] No status-like key on any participant (a grep of the recorded
    response, done in the integration run).
  - [ ] Roles read "Primary Care Provider" and "Nurse".
  - [ ] pid 3: `total: 0` → "Nothing Recorded".
  - [ ] Legacy, pid 13: 2 rows (the inactive specialist is hidden). Screenshot
    pair taken in 01-06-01 to show the documented break.
- **Acceptance check:** pid 13 shows the care team with named members and
  roles. The inactive member is visible, as the documented API gap requires.

## Story 01-05 — Vitals (W2D-4, the additional section)

### Slice 01-05-01 — Vitals card via REST per encounter

- [ ] **Merged** · [ ] **Observed**
- **Time box:** 2.0 h, Sat 17:45–19:45. The first 20 minutes resolve R-4
  against the local stack before any mapping code is written: the encounter
  list's 404 body shape, and whether `:eid` takes `eid` or `encounter`.
- **Goal:** the Vitals card shows the latest **non-deleted** vitals set, with
  an explicit field list and order and units from the `<field>_unit` keys.
  The metric secondary is computed client-side; it is the first item on the
  cut list. The card keeps its legacy position.
- **Catalog IDs:** 5.01 and 5.02 (both Critical), 7.20, 7.24 (decision: legacy
  order kept), 5.09.
- **Files expected:** in `core/upstreamRoutes.ts` the routes
  `rest.encounter.list` and `rest.vital.list`; `core/rules/vitals.ts` (pick
  plus the 50-encounter cap); `bff/src/upstream/schemas/{encounter,vital}.ts`,
  `bff/src/cards/vitals.ts`, `web/src/cards/VitalsCard.tsx`; tests
  `test/core/vitals.test.ts`, `test/contract/vitals.test.ts`,
  `test/web/VitalsCard.test.tsx`; fixtures;
  `test/integration/vitals.it.ts`.
- **Test gate**
  - Contract: pid 13 walks encounter 367 first and gets **set 27** from one
    call; it never returns set 28 and never calls an older encounter. pid 3
    gets **set 14** from encounter 12. A zero-encounter 404 (hand-built,
    matching the verified shape) gives `empty`. A 5xx on one encounter gives
    `error`, not `empty`. The cap is exceeded → `VITALS_SCAN_LIMIT` error.
  - **Deliberate regression:** replace the per-encounter pick with "latest by
    date across a merged list" that includes the FHIR-style deleted set 28
    (hand-built fixture). Alternatively, stop the walk at the first 5xx and
    return `empty`. Expected red: the pid 13 "set 27" or "5xx is error" test.
- **Live evidence** (`walkthroughs/VITALS.md` (e))
  - [ ] `GET /api/patient/<13>/encounter` returns 367 first (36 total).
  - [ ] `GET …/encounter/367/vital` returns exactly one row, `id=27`.
  - [ ] The legacy `vitals_fragment.php` query (read-only SQL) still returns
    28, which confirms the port genuinely diverges (deliberate deviation 5.01).
  - [ ] pid 3: set 14 shown, not "Nothing Recorded".
  - [ ] pid 13 height shows a plausible adult value (phase-1 seeded rows only;
    D-6).
  - [ ] Production config: the BFF user has both `encounters/auth_a` and
    `encounters/notes` (HD-5).
- **Acceptance check:** pid 13 shows the 2026-04-05 vitals, not the deleted
  2026-05-01 set that the legacy card shows.

## Story 01-06 — Parity evidence, defense and release (W2D-5, W2D-7, freeze)

### Slice 01-06-01 — Parity evidence and hardening

- [ ] **Merged** · [ ] **Observed**
- **Time box:** 1.5 h, Sat 20:00–21:30. Window 2 runs at the start: David
  signs in and the card checklists for 01-02-02 … 01-05-01 are ticked.
- **Goal**
  - Side-by-side screenshots, legacy dashboard against port, for pids 13 and 3
    (and 12 for the header), on the same stack (W2D-5).
  - Error-state drills through the BFF: 401 (expired or revoked token), 403
    (a card-level deny), 200 with errors (hand-built through the contract
    tests), and 404-empty.
  - A manual keyboard and screen-reader pass.
  - Timing: time-to-header and time-to-all-cards, compared with the legacy
    3.3–5.2 s network-idle (7.08).
  - The production config check for `api_log_option` (6.06).
- **Catalog IDs:** 7.08, 7.12, 6.06, W2D-5.
- **Files expected**
  - `docs/agentforge/evidence/<sha>/dashboard/`: PNG pairs (synthetic data
    only), `timing.json`, `live-check.json`, and `drills.md` (status codes and
    the states shown; no values).
  - `test/web/a11y.test.tsx`, if gaps were found.
- **Test gate:** the full hook. Any a11y fix gets a test.
  - **Deliberate regression:** remove an `aria-label` or heading level in
    `Card.tsx`. Expected red: the axe test.
- **Live evidence**
  - [ ] Screenshot pairs saved, and every visible difference is listed with
    its catalog ID or "not available via API".
  - [ ] The drills map to the documented states, and no upstream text is ever
    rendered.
  - [ ] Timing recorded (measured, not estimated).
- **Acceptance check:** a reviewer can open the evidence folder and see, per
  card, legacy and port side by side with the differences explained.

### Slice 01-06-02 — `PATIENT_DASHBOARD_MIGRATION.md` (graded, repo root)

- [ ] **Merged** · [ ] **Reconciled with the freeze SHA**
- **Time box:** 2.0 h, Sat 21:30–23:30.
- **Goal:** write the defense, tied to this implementation (PLAN W2D-7):
  1. Why React + TS + Vite + Fastify BFF: the weighted scoring (110/135), the
     near-tie, and what would have flipped it.
  2. What leaving PHP gained, **measured**:
     - an explicit patient id per call (3.01, 5.04, 7.04 designed out);
     - default escaping plus the lint ban (2.02, 2.04);
     - tokens server-side (8.01, M-4 posture);
     - the test counts in the enforced gate against zero before (9.01);
     - the bundle size from `bundle-report`;
     - axe results;
     - the timing from 01-06-01;
     - the two Critical vitals defects not inherited (5.01, 5.02).
  3. Tradeoffs:
     - two artifacts in one container;
     - React's runtime is the largest of the options;
     - hand-wired sessions, in memory;
     - a 1 h re-login with no refresh;
     - the API gaps: refills, Care Team status/note, `lists_touch`, squads,
       `hide_dashboard_cards`, dosage instructions, Rx `form`;
     - differing ACLs per card.
  4. **The FHIR-vs-REST defense per card**, with catalog IDs (R-1).
  5. The architecture diagram and the parity table per card: same /
     deliberate deviation / not available via API.
  6. The evidence links, with the SHA.
- **Catalog IDs:** documents every accepted gap and every "won't" (7.10,
  3.04, 4.12).
- **Files expected:** `PATIENT_DASHBOARD_MIGRATION.md` at the repo root;
  `docs/agentforge/PLAN.md` W2D-7 row.
- **Test gate:** the full hook (docs-only commits still run it).
  - **Honesty check:** every number in the doc cites a command, a test or an
    evidence file. Nothing is called "live" unless it was observed.
- **Acceptance check:** a grader reading only this file can say why this
  framework, what was gained, and what it cost, with numbers from this repo.

### Slice 01-06-03 — Freeze deploy and evidence (inside PLAN S11)

- [ ] **Done at the freeze SHA**
- **Time box:** 1.0 h, Sun 08:00–09:00. The last dashboard merge is by Sun
  08:00; Sun 07:00–08:00 is buffer.
- **Goal:** one freeze SHA on `main` is deployed with
  `AGENTFORGE_DEPLOY_SERVICES="agentforge-w2 dashboard"`. Both
  `/agentforge-w2/health` and `/dashboard/health` report it. Window 3: David
  signs in with the grader demo login (HD-5), and the full per-card checklist
  runs once more at this SHA.
- **Files expected**
  - `docs/agentforge/evidence/<freeze-sha>/dashboard/*`.
  - LEDGER rows W2D-1…W2D-5 and W2D-7 with PASS/FAIL/INCONCLUSIVE.
  - PLAN.md W2D rows updated.
  - `PATIENT_DASHBOARD_MIGRATION.md` SHA references updated.
  - DEV-LOG arc-completion entry; tag `dashboard-arc-01-complete`.
- **Test gate:** the hook is green on the freeze SHA, and `live-check.mjs`
  passes against the public URL.
- **Acceptance check:** at the freeze SHA a grader can sign in with the demo
  login and see every section working. Every W2D row has a LEDGER row naming
  that SHA.

## Definition of Done for this arc

- [ ] Every slice is merged and the hook is green on `main`. Each slice's
  deliberate regression is recorded in DEV-LOG.
- [ ] `/dashboard/health` and `/agentforge-w2/health` report the same freeze
  SHA.
- [ ] Every per-card live checklist above is ticked at that SHA. Local-only
  checks (pid-specific, per HD-7) are labelled as local.
- [ ] LEDGER rows W2D-1…W2D-5 and W2D-7 are PASS at the freeze SHA (W2D-6 and
  W2D-8 are cited).
- [ ] The catalog entries above are struck through in `BUGS-MITIGATIONS.md`
  with their slice IDs.
- [ ] `PATIENT_DASHBOARD_MIGRATION.md` is reconciled with the code at the
  freeze SHA.
- [ ] Tag `dashboard-arc-01-complete`, a retrospective entry in `DEV-LOG.md`,
  and `AUDIT-STATE.md` Phase 10 status updated. There is no `arcs/README.md`;
  this is the only arc.
