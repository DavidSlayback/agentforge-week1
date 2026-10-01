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

## 2026-10-01 — W3 hardening, lane H4 — patient dashboard review findings

**Status:** ready-for-commit (committed on the lane branch; not merged, not deployed) · **Branch:** `agentforge/w3h-h4` · **SHA:** code at `050c87ee`; no merge SHA yet

Lane H4 of the W3 hardening plan (`docs/agentforge/PLAN.md`, "W3 hardening"),
from the 2026-10-01 repository review. Corrects, without editing, the 01-02-01
entry's open question on the production timezone and the 01-05-01 Vitals
wording.

### Worked on
- **Encoded-path guard bypass (major).** `http/security.ts` matched the raw
  URL against `/dashboard/bff/` while the router decodes the path, so
  `GET /dashboard/%62ff/patients/<uuid>/header?_sort=x` with
  `Sec-Fetch-Site: cross-site` returned 200 with the header DTO and no
  `Cache-Control: no-store`. Both hooks now key on `req.routeOptions.url`, the
  route the router matched. `static.ts` checked: its raw-URL test only decides
  whether a 404 under `/patients/` gets `index.html`; an encoded spelling gets
  the JSON 404 instead, so it fails closed and was left as is.
- **Timezone (major).** `DASHBOARD_OPENEMR_TZ` is required in `config.ts`
  (an IANA name; a bare offset is refused) and in the compose file
  (`${DASHBOARD_OPENEMR_TZ:?…}`); the `America/Chicago` placeholder is gone.
  Rule, from `interface/globals.php:509-518`: `gbl_time_zone` if non-empty,
  else php.ini `date.timezone`, else `UTC`; MySQL sessions follow PHP's offset.
  The VM commands are in `deploy/vultr/README.md`. Local: `UTC`.
- **Lab Results vs Vitals (rubric honesty).** `PATIENT_DASHBOARD_MIGRATION.md`
  now records that the 2026-09-24 parity spec and `PLAN.md` W2D-4 named Lab
  Results, that the decision record covers Notes → Vitals only, and that no
  record says why Lab Results was not taken back up. Not built.
- **`/login`**: pending transactions capped at 5000 (oldest evicted), expiry
  sweep at most once per 60 s. **`returnTo`**: dot segments refused in every
  decoding. **id token**: `requiredClaims: ['exp', 'iat', 'sub']`.
- **Vitals**: 10 s load deadline (`VITALS_DEADLINE`) through an `AbortSignal`
  on every call of the load; README wording now states the encounter-number
  order caveat. **Upstream bodies**: streamed, capped at 2 MiB
  (`UPSTREAM_BODY_TOO_LARGE`).
- **SPA**: `RenderErrorBoundary` per card (inside `Card`) and at the root.
- **`@fastify/static`** 8.3.0 → 10.1.5; no code change was needed.

### Decisions
- Eviction rather than 503 when the login store is full: a flood then costs
  the oldest pending sign-ins a retry, instead of blocking every sign-in.
- New error codes `UPSTREAM_BODY_TOO_LARGE` and `VITALS_DEADLINE` render
  through the existing error state ("Couldn't load … (CODE)"). A render error
  shows "Couldn't display <card> (RENDER_ERROR)" and never the error text
  (`assertNever` stringifies the failing value).

### Tests
- Gate (`npm run check --prefix dashboard` + full `.githooks/pre-commit`,
  commit `050c87ee`): 355 tests in 36 files, all passing (+20 over 335):
  core 107 · contract 83 · BFF 81 · component 81 · lint-boundary 3. Typecheck
  0, lint 0, bundle 72.5 kB gzip JS, 1.3 kB CSS (budget 150 kB).
- Deliberate regression: the raw-URL prefix match restored in `security.ts`
  → the hook refused the commit (exit 1, HEAD unchanged) with 1 red,
  "applies the /bff guards to every encoding of the path the router decodes"
  → reverted. One break per fix, each with its named red test, plus the
  red-before-green runs and the `/login` bench (40k creates: 9.9 s and 16.7 MB
  before, 0.38 s and 2.6 MB after):
  [`evidence/w3-h4-regression.txt`](evidence/w3-h4-regression.txt).
- `npm audit --omit=dev`: 1 high before, 0 after.
- Integration (local stack): not run. Live: not deployed. **Implemented and
  tested; not wired on the VM** until `DASHBOARD_OPENEMR_TZ` is set there and
  the lane is merged and deployed.

### Open questions / follow-ups
- Set `DASHBOARD_OPENEMR_TZ` in `/opt/agentforge-week1/.env` from the
  `deploy/vultr/README.md` commands before the next deploy; Compose refuses
  to interpolate the file for every service while it is missing.
- `vitest` 3.2.7 has a moderate dev-only advisory (GHSA-82fw-gwwq-j7x9);
  the fix is a vitest major upgrade, not done here.

## 2026-09-26 (later) — Arc 01 / Story 01-06 / Slice 01-06-01 — Allergies finding: seed workaround, re-verified

**Status:** ready-for-commit (evidence + docs only; not merged, not deployed) · **Branch:** `agentforge/w2-dashboard` · **SHA:** no merge SHA yet

Correction/follow-up to the 01-06-01 entry directly below (that entry is left
unchanged per the append-only convention).

### Worked on
- Owner approved a seed-data workaround for the Allergies finding below: the
  DASH-SYN-01/DASH-SYN-02 allergy rows now have `lists.user = NULL` (local and
  production), instead of `user='admin'`.
- Re-ran the headless Playwright capture for the **port side only**,
  DASH-SYN-01 and DASH-SYN-02 (pid 3 and the legacy screenshots untouched —
  legacy was never affected). Replaced `port-dash-syn-01.png`,
  `port-dash-syn-02.png` and their `capture-data.json` entries.
- Updated `docs/legacy-audit/evidence/parity/README.md`: Allergies now shows
  as matching legacy for both patients (DASH-SYN-01: Penicillin (Severe)
  highlighted, Latex still hidden by the outcome filter; DASH-SYN-02: Sulfa
  drugs, not highlighted). The Findings section keeps the defect documented
  — reworded to "legacy API defect, worked around in seed data (allergies
  authored by no user); still present for any allergy authored by a real
  user" — rather than deleting it now that the symptom is gone for these two
  patients.

### Result
- **Allergies now loads successfully for both DASH-SYN-01 and DASH-SYN-02.**
  Confirmed live, same method as before: `data-state="ok"`, rendered text
  matches the legacy card exactly for both patients.
- The underlying `AllergyIntoleranceService::search()` defect (raw-binary
  `practitioner_uuid`/`organization_uuid` breaking `json_encode()`) is
  **unchanged** — it is only unreachable now for these two seeded patients
  because their allergy rows no longer have an authoring user that resolves
  through the `users`/`facility` join. It remains live for any patient whose
  allergy list has a row authored by a real user.

### Tests
- No `dashboard/` code changed; hook run covers the evidence-folder commit as
  before (docs/evidence only).

### Open questions / follow-ups
- Same as the original 01-06-01 entry (drills, a11y pass, `api_log_option`
  check not done in either pass), plus: decide whether
  `AllergyIntoleranceService::search()` gets a real code fix upstream at some
  point, independent of the seed workaround, since the defect still affects
  any real (non-seeded) patient with an allergy authored by a user with a
  matching `users`/`facility` row.

## 2026-09-26 — Arc 01 / Story 01-06 / Slice 01-06-01 — Parity evidence and hardening

**Status:** ready-for-commit (evidence + docs only; not merged, not deployed) · **Branch:** `agentforge/w2-dashboard` · **SHA:** no merge SHA yet

### Slice plan
Goal (arc): side-by-side screenshots (legacy vs port), load-time measurements, for
DASH-SYN-01, DASH-SYN-02 and pid 3, on the local stack. Catalog IDs: 7.08 (slow loads,
measured), part of 7.12 (a11y audit, deferred — see Open questions).

### Worked on
- Headless Playwright capture script (`docs/legacy-audit/probe/parity-capture.mjs`,
  scratch, not committed — same login flow as `probe-dashboard.mjs`), driven against
  the local legacy stack (port 8300/9300) and `npm run dev --prefix dashboard`
  (port 8790). Login credentials read from
  `docker/development-easy-light/docker-compose.yml` at run time, never printed.
- Captured full-page PNGs for all three patients on both dashboards, plus per-card
  state/row-count/header-text data and 3 timing runs, into
  `docs/legacy-audit/evidence/parity/` (`README.md`, `capture-data.json`, 6 PNGs).
- Wrote the per-patient, per-section parity table in that README, calling out every
  documented intended deviation (header sex/status, refills/dosage/care-team gaps,
  vitals soft-delete fix, empty-state wording) against what was actually observed.

### Findings
- **Unintended:** the Allergies card 500s live for both DASH-SYN-01 and DASH-SYN-02
  (route `rest.allergy.list`, reproduced on every capture run — 3+ loads each), turning
  into the card's generic `error` state. Traced to a real upstream defect in
  `AllergyIntoleranceService::search()`: two joined columns
  (`practitioner_uuid`, `organization_uuid`) are selected as raw `binary(16)` and never
  passed through `UuidRegistry::uuidToString()` before the response is JSON-encoded,
  so any allergy row whose `lists.user` matches a real username 500s
  ("Malformed UTF-8 characters", confirmed in the container's Apache error log). Data
  dependent: both dashboard seed patients have an allergy authored by `admin` (a real
  user), pid 3 has zero allergy rows so it never hits this path. Not fixed — out of
  scope for an evidence slice; the BFF's own handling of the upstream 500 (generic
  error state, correlation id, no upstream text) is correct. Full write-up in the
  evidence README's "Findings" section.
- No other unintended differences found across the three patients / six cards.

### Tests
- No code changed; the hook was not run for this slice (docs + evidence only).
- Live: legacy and port both reachable and exercised for all three patients on the
  local stack; not a public/deploy check (this slice doesn't touch `deploy/`).

### Timing (local laptop, not production; DASH-SYN-01, 3 runs each)
- Legacy full-page network-idle: median 3200 ms (range 3103–3352 ms).
- Port header-visible: median 2557 ms (range 2154–2654 ms).
- Port all-7-sections-settled: median 4287 ms (range 4157–4521 ms).

### BUGS-MITIGATIONS.md updates
- None struck through this slice (evidence gathering; the Allergies finding above is
  new and not yet in that catalog — flagging here per AGENTS.md "fail loudly", not
  filing a new catalog ID as part of this slice).

### Open questions / follow-ups
- The Allergies-card 500 (above) needs a decision: file a new catalog ID and either
  patch the upstream service (outside `dashboard/`, so outside this arc's normal
  scope) or document it as an accepted live gap in
  `PATIENT_DASHBOARD_MIGRATION.md` (01-06-02).
- Error-state drills (401/403/200-with-errors/404-empty), the manual keyboard/screen
  reader pass, and the `api_log_option` production config check (arc's other 01-06-01
  goals) were not done in this pass — this session's task was scoped to the
  screenshot/timing/README parity evidence only. Still open for a follow-up pass
  before the arc's own acceptance check is called fully met.

## 2026-09-25 — Arc 01 / Story 01-05 / Slice 01-05-01 — Vitals card via REST per encounter

**Status:** ready-for-commit (committed on the branch; not merged, not deployed) · **Branch:** `agentforge/w2-dashboard` (owner instruction; built without per-slice approval, owner-authorized) · **SHA:** code at `1d37a47` (+ `0f94550`, a test-order fix); no merge SHA yet

### Slice plan
Flow / requirement delivered: W2D-4 (Vitals, the additional section, DB-08): the latest **non-deleted** vitals set, kept in its legacy position after Care Team (7.24).
Legacy behavior replaced: `walkthroughs/VITALS.md`, `interface/patient_file/summary/vitals_fragment.php` + `interface/forms/vitals/report.php`.
Layers touched: core (`ids` `EncounterId`, `cardResult` `VITALS_SCAN_LIMIT`, `rules/vitals` `latestVitalsSet` + `isPediatric` + `phpNumberFormat` + `vitalsFields` + `MAX_ENCOUNTER_SCAN`, `dto` `VitalsDto`, `guards` `isVitalsDto`, `upstreamRoutes`) · bff (`upstream/mapResponse` opt-in `notFoundEmptyEnvelopeIsEmpty`, `upstream/schemas/{encounter,vital}`, `schemas/patient` `DOB`, `cards/patientRead` `birthDate`, `cards/vitals`, `http/routes`) · web (`cards/VitalsCard`, `App`, `styles.css`) · tests · README.
Upstream routes added to the allow-list: `rest.encounter.list` (`/api/patient/{puuid}/encounter`, no query keys, scope `user/encounter.rs`, ACL `encounters/auth_a`) and `rest.vital.list` (`/api/patient/{pid}/encounter/{eid}/vital`; `pid` from `rest.patient.read`, `eid` a positive integer from the encounter list (new param kind `eid`); no query keys; scope `user/vital.rs`, ACL `encounters/notes`). Both scopes were already in `OAUTH_SCOPE`. A new allow-list test asserts there is **no** FHIR `Observation` route (5.02).
Catalog IDs: 5.01 and 5.02 (Critical, designed out), 7.20 (explicit field list and order), 7.24 (legacy position kept), 5.09 (no session pid).
Deliberate regression: take the latest set across a merged FHIR vital-signs list that includes the deleted set → expected red: the "never set 36" contract test.
Acceptance check (a user can do this): DASH-SYN-01 shows the 2026-04-05 vitals, not the deleted 2026-05-01 set on the same encounter; pid 13 shows the 2026-04-05 set, not the deleted 2026-05-01 set the legacy card shows.

### Worked on
- R-4 resolved from the code before any mapping: the vitals route's `:eid` is matched against `form_encounter.encounter` (`VitalsService::search()` aliases it `eid`), and the encounter list serves the same column as `eid` (`EncounterService::search()`), newest first (`ORDER BY fe.eid DESC`). A patient with no encounters: the controller calls `handleProcessingResult(..., 404)`, but `ViewRendererListener` wraps the array in a 200 `JsonResponse`, so the wire carries HTTP 200 `data: []` (API-ROUTES Finding 3). An encounter with no live vitals: `responseHandler()` answers 404 with an empty body.
- BFF `/dashboard/bff/patients/:puuid/vitals`: `rest.patient.read` (pid, DOB) → `rest.encounter.list` (every row's `puuid` and `pid` checked; `eid` must parse; sorted newest first locally) → `rest.vital.list` per encounter until one has a set (every row's `puuid`, `pid` and `eid` checked) → `latestVitalsSet` (latest `date`, ties to the higher `id`) → `vitalsFields`. A failure on any call is the card's failure (403 → forbidden, 401 → reauth, other → error). More than 50 encounters with none of the first 50 holding a set → `VITALS_SCAN_LIMIT`; all encounters checked and none has a set → empty.
- `mapUpstream` gained `notFoundEmptyEnvelopeIsEmpty` (encounter list only): a 404 whose body is exactly `{validationErrors: [], internalErrors: [], data: []}` (plus `links`) is empty; any other 404 body is an error; a mapper test covers the opt-in and the default.
- `vitalsFields`: the `form_vitals` column order `report.php` iterates (BP, Height, Weight, Temperature, Temp Method, Pulse, Respiration, Note, BMI, BMI Status, Waist Circ, Head Circ, Oxygen Saturation, Oxygen Flow Rate, the pediatric percentiles, Inhaled Oxygen Concentration), the legacy labels, the skip rule (null, '', zero date, or numeric zero: `$value == "0.0"`), the legacy number formats (`floatval` for height/weight/temperature/circumferences, `number_format(…, 0)` for pulse, respiration, BMI and O2 saturation, 2 decimals for flow rate), and the unit label mapped from the API's `<field>_unit` (`degF` → "F", `/min` → "per min", …; an unknown code is shown as returned). BP shows only with both parts. Pediatric (age ≤ 20 or in months, from `patient_data.DOB` and today in `DASHBOARD_OPENEMR_TZ`) gets "See Growth-Chart" and the percentiles, as in the legacy card.
- SPA `VitalsCard` after Care Team: "Most recent vitals from: <date>" and a label/value list; a note says units are as the API returns them.
- Fixtures (shaped, not recorded): `rest.encounter.list` and `rest.vital.list:<eid>` added to `patient-13` (36 encounters; 367 → set 27 only), `dash-syn-01` (pid 14: encounters 370, 369, 368 → sets 35, 34, 33; the deleted set 36 on 370 is absent because the route filters it), `patient-3` (12 → set 14), `dash-syn-02` (no encounters: HTTP 200 `data: []`). Values from read-only SELECT. Hand-built `fhir-observation-vitals-dash-syn-01.json`: the panel Observations FHIR would return for pid 14, **including** the deleted set, served by the contract test so that a port which read FHIR would visibly show it.
- Integration script: the shown set's date is compared with the expected latest non-deleted set for pid 13, pid 3, DASH-SYN-01, and empty for DASH-SYN-02; only PASS/FAIL and the card kind are printed.

### Decisions
- **The correct latest set, from the REST per-encounter route** (owner decision, catalog 5.01): the route's `deleted=0 AND formdir='vitals'` is the only deleted filter any API path has. FHIR `Observation` is never called, and the allow-list test fails if an Observation route is ever added.
- **The walk trusts encounter-number order** (the route's own `ORDER BY`): the port cannot compare vitals dates across encounters without fetching them all. On every seeded patient encounter-number order equals date order; a newer vitals set on an older encounter would be missed (documented in `walkthroughs/VITALS.md` (c)).
- **Cap 50, fail loudly.** Hitting the cap with encounters left is `VITALS_SCAN_LIMIT` (a new `ErrorCode`), never "Nothing Recorded"; the cap is injectable so a test can use 2 and 3, and a separate test runs the production 50.
- **Units as returned** (owner decision): one unit system per the site's `units_of_measurement`; the legacy card's simultaneous metric secondary is not computed (the first item on the arc's cut list). BP shows the API's `mm[Hg]` unit, which the legacy card did not print.
- **Pediatric rule ported**: pid 3 is 19 years old, so the legacy card shows BMI Status "See Growth-Chart"; the port does too. `rest.patient.read` now also yields `DOB` (never logged), read only by this rule.
- `external_id` and `last_updated` are not shown (the legacy loop would print them when set; neither is a vital sign). Empty reads "Nothing Recorded" (decision 4.02); the legacy text was "No vitals have been documented."

### Tests
- Gate (`npm run check --prefix dashboard` + full `.githooks/pre-commit`, commits `1d37a47` and `0f94550`): 287 tests, all passing (+29): unit 101 (`vitals` 7 new, `upstreamRoutes` +2) · contract 71 (`vitals` 12 new) · BFF 56 (`cardRoutes` +1, `mapResponse` +1; log redaction now also drives the vitals card and checks every encounter uuid, vitals uuid, set date and note is absent from the log) · lint-boundary 3 · component 56 (`VitalsCard` 6 new, all with axe, 0 violations). Typecheck 0, lint 0, bundle 71.8 kB gzip JS.
- `0f94550` reorders the DASH-SYN-01 contract test so it asserts the shown set (never 2026-05-01, the 2026-04-05 set) before the outbound call list; the first regression run failed that test on the call list, which proved less than it should.
- Deliberate regression: a new `fhir.observation.vitals` route and, in `loadVitals`, the latest `effectiveDateTime` across the FHIR vital-signs Bundle → the hook refused the commit (exit 1, HEAD unchanged) with 8 red; the key one, contract `DASH-SYN-01: the latest NON-deleted set (35) … never the deleted newer set 36 (5.01 / 5.02)`, failed with `expected '2026-05-01 09:00:00' not to be '2026-05-01 09:00:00'` (the card showed the soft-deleted set); also unit `has no FHIR Observation route …` and HTTP `Vitals: DASH-SYN-01 reaches the browser as the non-deleted set 35 …` → reverted. Output: `docs/legacy-audit/evidence/slice-05-01-regression.txt`.
- Integration (local stack): `SKIPPED (no token)`.
- Live: not merged or deployed. **Wired, tested, not yet observed.**

### BUGS-MITIGATIONS.md updates
- None struck through (not merged).

### Open questions / follow-ups
- Window 2: pid 13 shows the 2026-04-05 set (height 67 in), not the deleted 2026-05-01 set; the legacy `vitals_fragment.php` query (read-only SQL) still returns set 28; pid 3 shows set 14 with "See Growth-Chart"; DASH-SYN-02 "Nothing Recorded"; DASH-SYN-01 the 2026-04-05 set.
- Production config (HD-5): the BFF user needs both `encounters/auth_a` (list) and `encounters/notes` (vitals); either one missing makes the card "Not authorized for this section".
- The zero-encounter wire status (200 vs 404) is from code reading; the integration run with a token will show which one the local stack sends (the card handles both).

## 2026-09-25 — Arc 01 / Story 01-04 / Slice 01-04-01 — Care Team card from FHIR

**Status:** ready-for-commit (committed on the branch; not merged, not deployed) · **Branch:** `agentforge/w2-dashboard` (owner instruction; built without per-slice approval, owner-authorized) · **SHA:** code at `3d3d719`; no merge SHA yet

### Slice plan
Flow / requirement delivered: W2D-3 (Care Team card) from FHIR `CareTeam` with a user-context token (production FHIR is enabled, owner 2026-09-25).
Legacy behavior replaced: `walkthroughs/CARE-TEAM.md`, `templates/patient/card/manage_care_team.html.twig` (view mode; the port is read-only).
Layers touched: core (`ids` `ResourceUuid`, `rules/careTeam` `chooseCareTeam` + `careTeamStatusTitle` + `parseRelativeReference`, `dto` `CareTeamDto`/`CareTeamMemberRow`, `guards` `isCareTeamDto`, `upstreamRoutes` + a `reference` binding kind) · bff (`upstream/schemas/careTeam`, `cards/careTeam`, `http/routes`) · web (`cards/CareTeamCard`, `App`, `styles.css`) · tests · README.
Upstream routes added to the allow-list: `fhir.careteam.search` (`/fhir/CareTeam`, query key exactly `patient` = the puuid; scope `user/CareTeam.rs`, ACL `patients/med`), `fhir.practitioner.read` and `fhir.organization.read` (`/fhir/Practitioner/{id}`, `/fhir/Organization/{id}`; one `resourceUuid` path parameter taken from the CareTeam response, no query keys; scopes `user/Practitioner.rs` / `user/Organization.rs`, ACL `admin/users`; `patientBinding: 'reference'`, which the allow-list test restricts to `*.read` routes with exactly one uuid parameter). All three scopes were already in `OAUTH_SCOPE`.
Catalog IDs: 2.02 (no `innerHTML`: JSX escaping, tested with a payload), 8.04, 8.05, 8.07, 7.14 (empty text added), 7.15 (names from the API, not a `<select>`), 8.15 (rows keyed by position), 5.05 / M-6 (inactive members shown), 4.07, 6.03.
Deliberate regression: pick the first team regardless of status → expected red: the team-selection cases.
Acceptance check (a user can do this): pid 13 shows the care team with its members and roles, the inactive member included, as the documented API gap requires.

### Worked on
- BFF `/dashboard/bff/patients/:puuid/care-team`: `rest.patient.read` → `fhir.careteam.search?patient=<puuid>` (Bundle; `total: 0` is empty only after that read) → every team's `subject` must be `Patient/<puuid>` → `chooseCareTeam` → member rows from Practitioner/RelatedPerson participants (a member reference that is not `Type/<uuid>`, or a Patient member, is `SCHEMA_MISMATCH`) → at most 20 name reads in parallel (`fhir.practitioner.read` per member, `fhir.organization.read` per distinct `onBehalfOf`).
- `chooseCareTeam`: skip `entered-in-error`, order by name case-insensitively with a missing name first (MySQL collation and NULL order), then the exact name, then the resource `id`; the first `active` team, else the first. The same team for every Bundle order (tested over all permutations).
- DTO: one `CareTeamDto` row per card (`teamName`, `statusTitle` from the 5 `Care_Team_Status` titles, `members`); members `{type: 'Provider' | 'Related Person', name | null, role, facility | null, since}`. Status and Note are not on the wire.
- SPA `CareTeamCard` under Prescriptions, the legacy order: team name with a status badge, then Type, Member, Role, Facility, Since, Status, Note; Status and Note cells read "Not available via API"; a null name or facility reads "Name unavailable".
- Fixtures (shaped, not recorded): `fhir.careteam.search`, `fhir.practitioner.read:<id>` (404, body `[]`) and `fhir.organization.read:<id>` (200) added to `patient-13` (1 team, 4 participants), `dash-syn-01` (1 team, admin as member, 2 participants), `patient-3` and `dash-syn-02` (`total: 0`). Hand-built `fhir-practitioner-200.json` (synthetic name) for the success path.
- Integration script: member counts (pid 13: 3, pid 3: empty, DASH-SYN-01: 1), printing counts only.

### Decisions
- **Deterministic team choice** (owner asked for it to be deterministic and documented): the legacy second key, `ctm.date_created`, is not in the FHIR resource, so the tiebreak after the name is the resource `id`. This can differ from the legacy card only when two non-error teams have the same name; no seeded patient has two teams.
- **Organization participants are not member rows.** `getCareTeamFacilities()` turns each member's facility into a participant; the legacy card has no such rows, so the port uses them only for the Facility column.
- **Names are best-effort, the card is not.** Both name routes need `admin/users`, and `PractitionerService::search()` serves only users with a non-empty NPI. None of the seeded care-team users has one (read-only SELECT on `users`), so locally every member name is "Name unavailable" and the card says why in a note. Production (pid 7/8) is not known. A failed name read never fails the card (MIGRATION-REACT §2.4). The REST alternative (`GET /api/user/:uuid`) serves any user but needs a `user/user.r` scope the client does not have; adding it is an owner decision (client re-registration), not made here.
- **Member order is the API's** (providers, then related persons); FHIR has no member date to reproduce the legacy `ORDER BY ctm.date_created`.
- **Empty is "Nothing Recorded"** (owner decision): the legacy card had no empty text at all (7.14). A chosen team with no member participants says "No members listed."
- **Patient read first, `rest.patient.read`**, like every other card, rather than `fhir.patient.read` as the playbook table named: it is the same precondition (the patient exists and this user may read it) and keeps one patient-resolution path.
- RelatedPerson names are not read (no allow-listed route); no seeded patient has a related-person member.

### Tests
- Gate (`npm run check --prefix dashboard` + full `.githooks/pre-commit`, commit `3d3d719`): 258 tests, all passing (+29): unit 92 (`careTeam` 8 new, `upstreamRoutes` +1) · contract 59 (`careTeam` 11 new) · BFF 54 (`cardRoutes` +1; log redaction now also drives the care-team card with a resolved Practitioner name and checks every team id, team name, member name and facility name is absent from the log) · lint-boundary 3 · component 50 (`CareTeamCard` 8 new, 6 with axe, 0 violations). Typecheck 0, lint 0, bundle 71.7 kB gzip JS.
- Deliberate regression: `chooseCareTeam()` returns `teams[0]` (Bundle order, any status) → the hook refused the commit (exit 1, HEAD unchanged) with 6 red, including contract `several teams (hand-built): the card shows the first active team by name, whatever the Bundle order` and unit `breaks a name tie by resource id, so the result is the same for every Bundle order` → reverted. Output: `docs/legacy-audit/evidence/slice-04-01-regression.txt`.
- Integration (local stack): `SKIPPED (no token)`.
- Live: not merged or deployed. **Wired, tested, not yet observed.**

### BUGS-MITIGATIONS.md updates
- None struck through (not merged).

### Open questions / follow-ups
- Window 2: pid 13 shows 1 team, 3 member rows (the inactive specialist included) with roles "Primary Care Provider", "Nurse", "Specialist", Member "Name unavailable" and Facility named; pid 3 "Nothing Recorded"; grep the recorded Bundle for any participant status key (expect none).
- **Member names (owner decision):** either give the seeded care-team users an NPI (data, local and production), or add `user/user.r` to the client and read `GET /api/user/:uuid` (config + one allow-listed route). Until then the Member column is honest but empty.
- The Practitioner/Organization 403 path for a non-admin clinician is tested in contract only (a 403 read → "Name unavailable"); not testable live with the admin role.

## 2026-09-25 — Arc 01 / Story 01-03 / Slice 01-03-01 — Prescriptions card, allow-listed

**Status:** ready-for-commit (committed on the branch; not merged, not deployed) · **Branch:** `agentforge/w2-dashboard` (owner instruction; built without per-slice approval, owner-authorized) · **SHA:** code at `959482e`; no merge SHA yet

### Slice plan
Flow / requirement delivered: W2D-3 (Prescriptions card) with the M-1 allow-list and its regression proof.
Legacy behavior replaced: `walkthroughs/PRESCRIPTIONS.md`, `templates/prescription/general_fragment.html` inside `templates/patient/card/rx.html.twig`.
Layers touched: core (`rules/prescriptions` `sortPrescriptions` + `prescriptionDetails`, `dto` `PrescriptionRow`, `guards` `isPrescriptionRow`, `upstreamRoutes`) · bff (`upstream/schemas/prescription`, `cards/prescriptions`, `http/routes`) · web (`cards/PrescriptionsCard`, `components/Card` + `States` `emptyText`, `App`, `styles.css`) · tests · README.
Upstream route added to the allow-list: `rest.prescription.search` (`/api/prescription`, no path parameters; query keys exactly `patient_id` (kind `pid`, the integer pid from `rest.patient.read` only) and `source_table` (fixed `prescriptions`, cannot be supplied); scope `user/prescription.rs`, ACL `patients/med`; `patientBinding: 'query'`).
Catalog IDs: 2.01 / M-1 (for our calls), 4.10 (form gap), 5.03 (show all rows), 5.06 / M-7 (refills gap), 8.13, 7.25 (source label).
Deliberate regression: the allow-list forwards an unknown query key → expected red: the allow-list test and the outbound-request contract test.
Acceptance check (a user can do this): pid 13 shows the same 5 prescriptions as the legacy card, in the same order; Refills is labelled unavailable.

### Worked on
- BFF `/dashboard/bff/patients/:puuid/prescriptions`: `rest.patient.read` (pid) → `rest.prescription.search?patient_id=<pid>&source_table=prescriptions` (REST envelope) → every row's `puuid` must be the requested patient's → `sortPrescriptions` → rows `{drug, details, quantity, refills: null, filled}` with two gap notes (refills, dosage form).
- `sortPrescriptions`: `active` DESC, `date_modified` DESC with NULLs last, `date_added` DESC (MySQL DESC semantics), then `uuid` ascending as the documented tiebreak; keeps every row.
- `prescriptionDetails`: `size` + unit title (no space), a space, `dosage`, plus " in <interval title>" only when `interval` is set (PHP `empty()`, so `"0"` counts as unset).
- SPA `PrescriptionsCard` under Medications, the legacy order: a table with Drug, Details, Qty, Refills, Filled; every Refills cell reads "Not available via API"; source label "Prescriptions written in OpenEMR, every status, …; the medication list is separate."; empty reads "None". `Card`/`NonDataState` gained an optional `emptyText` (default "Nothing Recorded").
- Fixtures (shaped, not recorded): `rest.prescription.search` added to `patient-13` (5 rows, ids 62–66), `dash-syn-01` (pid 14: 3 rows, one `active=0`), `patient-3` and `dash-syn-02` (HTTP 200, `data: []`). Rows are listed id-ascending (the query has no `ORDER BY`), so the sort is exercised. Values from read-only SELECT on `prescriptions`/`list_options`.
- Integration script: prescription counts (pid 13: 5, pid 3: empty, DASH-SYN-01: 3).

### Decisions
- **Empty text is "None"** (owner decision): it is the legacy Rx card's own string (`{xlt t='None'}`), not the "Nothing Recorded" of the issue cards. The arc's live-evidence line was updated to match.
- **Patient check on `puuid`.** The route's outer SELECT (`PrescriptionService::getBaseSql()`) has no `patient_id` or `pid` column, only `puuid` from the `patient_data` join, so each row's `puuid` must equal the requested uuid; a NULL `puuid` also fails (`PATIENT_MISMATCH`).
- **`source_table` is a schema literal.** A row from the `lists` branch is `SCHEMA_MISMATCH`: the BFF asked for prescriptions only.
- **Two layers against M-1.** `/bff/*` already refuses any query string (400, no upstream call; now also asserted for this route), and `buildUpstreamPath` throws on any key not on the route's list before a request is built. The regression proof removes the second layer and shows the gate go red without relying on the first.
- Quantity renders as stored, "" when NULL (the legacy template prints the empty default). Filled is the raw `date_added` string.

### Tests
- Gate (`npm run check --prefix dashboard` + full `.githooks/pre-commit`, commit `959482e`): 229 tests, all passing (+31): unit 83 (`prescriptions` 11 new, `upstreamRoutes` +2) · contract 48 (`prescriptions` 8 new) · BFF 53 (`cardRoutes` +2; log redaction now also drives the prescriptions card and checks every drug name and uuid is absent from the log) · lint-boundary 3 · component 42 (`PrescriptionsCard` 8 new, 6 with axe, 0 violations). Typecheck 0, lint 0, bundle 71.3 kB gzip JS.
- Deliberate regression: `buildUpstreamPath()` forwards a key that is not on the route's list instead of throwing → the hook refused the commit (exit 1, HEAD unchanged) with 6 red, including unit `rejects any client-supplied extra key on the prescription search: the route builds SQL from key NAMES (M-1 / 2.01)` and contract `a caller that adds any other query key never reaches OpenEMR (M-1): the client refuses before fetching` → reverted. Output: `docs/legacy-audit/evidence/slice-03-01-regression.txt`.
- Integration (local stack): `SKIPPED (no token)`.
- Live: not merged or deployed. **Wired, tested, not yet observed.**

### BUGS-MITIGATIONS.md updates
- None struck through (not merged).

### Open questions / follow-ups
- Window 2: pid 13 shows 5 rows in order 66 → 62 with no " in <form>" suffix and the Refills placeholder; pid 3 shows "None"; DASH-SYN-01 shows 3 rows with the inactive one last.
- The API ACL is `patients/med`, the legacy card's is `patients/rx`: a user can see one and not the other (walkthrough (c)); not testable with the admin role.
- The `form`-set Details case is not exercised by any seeded row (all `form` NULL or 0); it is a documented gap, not covered.

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

## 2026-09-26 — slice 01-06-04, requirement hardening (branch `agentforge/w2-dashboard`, not merged)

An independent compliance review of `main` (`660e091`) found gaps against the
brief and the AGENTS.md honesty rules. The owner authorized the slice without
per-slice approval. Status: **wired and tested; not merged, deployed or
observed.**

### Worked on
- **Persistent identity bar.** `.patient-header` scrolled away with the
  cards. It is now `position: sticky; top: 0` with an opaque background, a
  z-index above the cards, and `scroll-padding-top` (5 rem, 9 rem on phones)
  so focused elements are never hidden under it. The topbar still scrolls
  away. Test: `test/web/StickyHeader.test.tsx` (computed styles from the
  shipped stylesheet; the same element persists through card loading and
  error states, a header error and a patient switch). Regression proof:
  `evidence/slice-06-04-header-regression.txt` (sticky removed, 3 red,
  refused).
- **Medications dosage instructions from FHIR.** Checked in the code at
  `legacy-baseline`:
  - `intent` is an honored search parameter (`FhirMedicationRequestService.php:113`);
  - lists rows report `intent = 'plan'` (`PrescriptionService.php:212`) and prescriptions `order` (:156);
  - `dosageInstruction.text` is `drug_dosage_instructions` unless it is numeric (:253-266).

  New allow-listed route `fhir.medicationrequest.search`, with keys exactly
  `patient` and the fixed `intent=plan`, joined to the REST rows by uuid.
  Non-plan entries are ignored client-side too. The route is called only
  when a medication is active. A cross-patient entry gives `PATIENT_MISMATCH`.
  Any other failure keeps the list and adds a "couldn't be loaded" note,
  never reauth. **`OAUTH_SCOPE` gained `user/MedicationRequest.rs`.**
  OpenEMR silently drops scopes a client did not register
  (`ScopeRepository::finalizeScopes()`), so the production client needs its
  registration updated. Until then the route answers 401 (scope check,
  `HttpRestRouteHandler` maps `AccessDeniedException` to 401) and the card
  shows the note. Regression proof:
  `evidence/slice-06-04-medications-regression.txt` (join by position,
  3 red, refused).
- **Layout parity.** A CSS grid gives the legacy arrangement: three
  columns, Prescriptions and Care Team spanning all, Vitals spanning two;
  one column below 62 rem. Card bodies scroll horizontally on phones.
  Test: `test/web/Layout.test.tsx`. Measured against the legacy screenshot
  with the real BFF and SPA serving shaped fixtures (not live):
  `evidence/parity/README.md`, "Layout".
- **Docs.** `PATIENT_DASHBOARD_MIGRATION.md` gets a "Legacy cards not
  ported" table (16 cards with reasons and read-API availability), a
  concrete FHIR-divergence row per card, the 5.29 production scope note, and
  `/dashboard/health` instead of a hard-coded SHA. Also updated:
  `REQUIREMENTS-TRACE.md` statuses (DB-01…DB-11, and DB-02, DB-08 and the
  Out-of-scope line corrected), this arc (statuses, ticks and slice
  01-06-04), `PLAN.md` W2D-2/3/7/8, the parity README, `dashboard/README.md`,
  `MIGRATION-REACT.md` (scope list, allow-list row) and a pointer in the
  root `README.md`.

- **Error-state drills** (open since 01-06-01), as tests against mocked
  upstreams, not live. `test/support/drills.ts` defines six drills: 401,
  403, 200 with `validationErrors`, the medication 404-as-empty, a 404 on
  the patient read, and a 500 with SQL. `test/bff/drills.test.ts` pushes
  each through the real BFF and asserts the exact wire answer; a 401 also
  ends the session. `test/web/Drills.test.tsx` renders the same answers in
  the real cards: four distinct states, no upstream text, axe clean.
- Gate: 328 tests in 33 files (287 at `7b49460`).

### Checks
- Local DB (SELECT only): no `lists_medication` rows exist, so no synthetic
  medication carries instructions. The dosage-present case is a hand-built
  fixture, labelled as such. The local OAuth client also lacks
  `user/MedicationRequest.rs`. There are 0 allergy rows authored by a real
  user.
- `git diff --stat legacy-baseline HEAD -- '*.php' sql/` is empty (DB-10 / W2D-8).

### Open
- Update the production OAuth client registration with
  `user/MedicationRequest.rs` (owner). Then merge, deploy and observe the
  three items on the public URL.
- The manual keyboard and screen-reader pass. The new card-body horizontal
  scroll regions hold no focusable content; Chrome makes such scrollers
  keyboard-focusable, but this has not been checked by hand.

## 2026-09-26 ~06:55 CT — slice 01-06-04 deployed (a800e97) after a deploy-session reset

The SSH connection dropped mid-build and the dashboard was down for about 10 minutes (other services unaffected). Recovered by restarting the previous container, then building detached on the VM. Production reports `a800e97`; the v2 OAuth client (adds `user/MedicationRequest.rs`) is live and the old client is disabled. Awaiting David's observation on this SHA.

## 2026-09-26 ~07:40 CT — real-browser accessibility pass (local), five fixes (branch `agentforge/w2-dashboard`, not merged)

Owner-authorized pre-freeze work. Everything ran on the **local** stack with
synthetic patients. Status: **fixes wired and tested on the branch; not merged,
deployed or observed on the public URL.**

### Worked on
- **Local OAuth client v2.** The local client lacked `user/MedicationRequest.rs`.
  A new confidential client, "AgentForge Dashboard (local dev v2)", was
  registered on the local OpenEMR with the full `OAUTH_SCOPE` and enabled
  with `UPDATE oauth_clients SET is_enabled=1`, on the local DB only.
  - Its id and secret went into the gitignored `dashboard/.env.local`; they
    were never printed.
  - The old local client is still enabled, because another checkout may use it.
- **The pass.** `docs/legacy-audit/evidence/a11y/a11y-audit.mjs` drives
  headless Chromium 141 through the UI only, for DASH-SYN-01, DASH-SYN-02
  and pid 3. It signs in through OpenEMR's login with the documented local
  dev login, read at runtime and never printed. It covers:
  - axe-core 4.13, WCAG 2.2 AA plus best-practice, color-contrast included;
  - a Tab and Shift+Tab walk, recording focus visibility and any overlap
    with the sticky bar;
  - 390 px, 320 x 568, 200 % zoom and 400 % zoom (zoom emulated as a
    CSS-pixel viewport);
  - sign-out by keyboard.

  Before and after JSON, screenshots and the findings are in
  `evidence/a11y/README.md`.
- **Findings, each fixed with a test:**
  - **K-1, blocker: sign-out answered 403.** Under
    `Referrer-Policy: no-referrer`, Chromium sends `Origin: null` on the
    same-origin form POST, and the logout Origin check refuses it.
    - Fix: `strict-origin` in the header and the SPA meta tag (`f8c5ad7`).
    - Test: `test/bff/security.test.ts`.
    - Production (`a800e97`) likely has the same bug for Chromium users.
      David's phone sign-out succeeded, so his browser probably sent a real
      Origin. Not checked on the public URL.
  - **K-2: card bodies that scroll sideways were unnamed tab stops.**
    - Fix: while a body overflows it becomes `tabindex=0`,
      `role=region` and `aria-label="<card>, scrolls sideways"`.
  - **Z-1: at 400 % zoom (320 x 180) the sticky bar covered 70-86 % of the
    viewport.**
    - Fix: it is static on viewports 20 rem tall or less.
  - **K-3: the scroll padding (9 rem) was smaller than the bar at 320 px
    (155 px).**
    - Fix: the bar measures itself and sets `--sticky-header-offset`.
  - **A-1: demo links failed `target-size` (21 px).**
    - Fix: at least 24 px tall, spaced.

  K-2, Z-1, K-3 and A-1 are in `66260cd`, with tests in
  `test/web/A11y.test.tsx`.
- **After, on `66260cd`:** 0 axe violations on all five pages, all controls
  reached, a focus indicator at every stop, nothing obscured, no horizontal
  page scroll, and keyboard sign-out returns 303 and reaches the signed-out
  landing page.
- **Docs.** `MIGRATION-REACT.md` (the referrer policy), `dashboard/README.md`,
  `PATIENT_DASHBOARD_MIGRATION.md` §1 and the arc (01-06-01).

### Tests
- The gate has 335 tests in 34 files (328 before).
- Deliberate regressions went through the hook and were refused, then reverted
  (`evidence/a11y/regression.txt`):
  - K-1: the policy put back to `no-referrer` gave 2 red.
  - K-2: dropping the region's tab stop and role gave 1 red.

### Open
- A human screen-reader pass (NVDA/JAWS, VoiceOver), and keyboard passes in
  Firefox and Safari.
- Real browser zoom and forced colors.
- Merge, deploy and observe. First confirm K-1 on the public URL with a
  Chromium browser.
- Local dev note: a second, stale `npm run dev` tree from an earlier session
  held port 8790 and won the BFF restart race. It served a stale SPA and the
  old client. Both dev trees were stopped, and one clean server was run for
  the recorded runs.

## 2026-09-26 ~07:50 CT — `deploy.sh` hardened after the SSH-reset incident (branch `agentforge/w2-dashboard`, not merged)

Follow-up to the `a800e97` deploy incident above: the SSH session reset during
`up -d --build`, and the dashboard container was left removed, giving about
10 minutes of 502. Status: **wired and tested offline; not yet used for a real
deploy.**

### Worked on
- **Keepalives.** `deploy/vultr/deploy.sh` routes every SSH call through
  `ssh_run`, including the `git archive | tar` pipe and the polls. It now
  passes `ServerAliveInterval=15`, `ServerAliveCountMax=8` and
  `ConnectTimeout=20`.
- **Build first, then replace.** A runner script on the VM runs
  `docker compose build <services>`, then `up -d --no-deps <services>` only if
  every build succeeded. `up --build` is gone, so a failed build no longer
  touches the running containers.
- **Detached from SSH.**
  - The runner starts under `setsid nohup` (plain `nohup` without `setsid`).
    It writes to `/tmp/agentforge-deploy-<stamp>/build.log` and records its
    status atomically in `exit`.
  - The laptop polls every 10 s with short SSH calls. A failed launch call
    and up to 29 failed polls in a row are tolerated.
  - The deploy fails if the runner never starts (3 polls), after 30 failed
    polls, after 40 min, or on a non-zero status. It then prints the last 40
    log lines.
  - A run directory is never reused (`mkdir`, not `mkdir -p`), so an old
    exit marker cannot pass for a new run.
- **Unchanged.** The success criterion is still the SHA health loop. The
  clean-tree and `staging/main` checks, the backup, the Caddy recreate and
  the module readability check are also unchanged.
- **Test seams** (env, with the production defaults unchanged):
  `AGENTFORGE_DEPLOY_ROOT`, `_REMOTE_TMP`, `_POLL_SECONDS`,
  `_BUILD_TIMEOUT_SECONDS` and `_HEALTH_SLEEP_SECONDS`.
- **Docs.** `deploy/vultr/README.md` has a new section, "What `deploy.sh`
  does".

### Tests
- New `deploy/vultr/test/deploy.test.sh`, about 20 s on Windows Git Bash.
  - Fake `ssh`, `sudo`, `docker` and `curl` run the remote side locally,
    against a throwaway repo whose `staging` remote is a local bare repo.
  - 8 checks: the happy path; keepalives on every SSH call; build before
    `up --no-deps` and never `--build`; a detached runner with a log and an
    exit marker; a dropped launch session plus 3 failed polls still
    succeeding; a failed build replacing nothing and failing; a never-started
    build failing; a wrong SHA failing.
- It is added to `.githooks/pre-commit` and mirrored as the `deploy-script`
  job in `.gitlab-ci.yml` (alpine, with `git` and `coreutils`). The CI job has
  never run, because the project has no runner.
- **Deliberate regressions**, none committed:
  - dropping the keepalive options gave 1 red, run by hand. It was then
    committed through the hook, which refused it (exit 1, HEAD unchanged at
    `b3a3b91`), and reverted;
  - putting back the old attached `up -d --build` step gave 5 red, run by
    hand.
- `sh -n deploy/vultr/deploy.sh` passes. shellcheck is not installed here, so
  the script was reviewed by hand:
  - the remote command strings and `$services` are deliberately expanded on
    the client side (SC2029, SC2086);
  - every path in them is space-free;
  - the runner here-doc escapes the runtime `$` it needs;
  - every polled SSH call sits in an `if`, so `set -e` cannot abort on a
    dropped session.

### Incident while doing this (fixed)
- **What happened.** The first commit attempt ran the new test inside
  `.githooks/pre-commit`. Git had exported `GIT_DIR` and `GIT_INDEX_FILE`
  for the real repository, so the test's throwaway `git init` reinitialized
  the real shared git dir.
- **Damage.** It set `core.bare = true` in
  `C:/Users/david/repos/agentforge-week1/.git/config`. That config is shared
  by the main checkout and every worktree, so git commands in the checkouts
  failed ("must be run in a work tree"). The test's next git command failed
  on the same error and the test stopped, so nothing else ran.
- **Repair.** `core.bare` was set back to `false`, a few minutes later. The
  main checkout is back on `agentforge/w2-final`. The staged files in this
  worktree were intact.
- **Not known.** The prior `core.repositoryformatversion` was not recorded.
  It is 0 now, which works with the `worktreeConfig` extension the Codex
  worktrees use.
- **Prevention.** The test now unsets every `git rev-parse --local-env-vars`
  variable. It builds the throwaway repo with explicit `--git-dir` and
  `--work-tree`, and refuses to run unless plain `git` in that directory
  resolves to it. Checked with `GIT_DIR` and `GIT_INDEX_FILE` pointing at a
  decoy repository: all 8 checks pass and the decoy's config is byte-identical
  afterwards.

### Open
- The first real deploy with this script is the first observation that
  `setsid`/`nohup` survive an SSH reset on the VM. The offline test cannot
  show it.
- Check that `docker compose build agentforge` on the frozen, image-only W1
  service is a no-op there, as it is designed to be. It ships only when named
  explicitly.

## 2026-09-26 ~08:30 CT — interim deploys; freeze handed to E7

`6bfe98a` shipped the accessibility fixes (sign-out 403 in Chromium, scroll regions, header scroll padding, target size) and the detached, build-before-replace `deploy.sh`; the first real run had no downtime but exposed a pre-existing backup collision (`agentforge` vs `docs/agentforge`). Fixed and regression-proven (`evidence/deploy-backup-collision-regression.txt`), deployed as `abf81af`. The final freeze of both services from one SHA is slice E7 (W2 PRD session).
