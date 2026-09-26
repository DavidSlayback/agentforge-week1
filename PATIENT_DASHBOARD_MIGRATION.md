# Patient dashboard migration: why React, what we gained, what it cost

## 1. Summary

- **What we ported:** OpenEMR's PHP patient dashboard (`demographics.php` and its fragments). That means OAuth2 sign-in, the persistent patient header, and the Allergies, Medical Problems, Medications, Prescriptions, Care Team and Vitals cards, all read-only, with no OpenEMR backend change ([MIGRATION-REACT.md §1](docs/legacy-audit/MIGRATION-REACT.md)).
- **Where it runs:** <https://dtstest.64.177.10.182.nip.io/dashboard/>. The deployed SHA is whatever `/dashboard/health` reports as `git_sha`; see that endpoint rather than a SHA written here, and read every claim below as valid only for the SHA it names. `node dashboard/scripts/live-check.mjs <url> <sha>` runs the 6 unauthenticated checks against it. Demo patients: MRN `DASH-SYN-01` (data-rich) and `DASH-SYN-02` (deceased).
- **Stack:** a React 19 + TypeScript + Vite single-page app (SPA), served same-origin by a Fastify (Node 24) backend-for-frontend (BFF). The BFF holds a confidential OpenEMR OAuth client. Both run in one container behind Caddy at `/dashboard/*` ([package.json](dashboard/package.json), [docker-compose.yml](deploy/vultr/docker-compose.yml), [Caddyfile](deploy/vultr/Caddyfile)).
- **What has been observed live:** the owner saw sign-in plus the header on `f8d7bdf`, and Allergies, Problems and Medications on `2246417` ([VERIFICATION.md, "Observed live"](docs/legacy-audit/VERIFICATION.md)). Prescriptions, Care Team (with member names) and Vitals were observed on `7b49460`, so **all seven sections have been observed on the public URL**.
- **Parity evidence:** side-by-side screenshots of the legacy and ported dashboards for three synthetic patients, with a per-section comparison and load timings, plus a layout comparison ([evidence/parity/](docs/legacy-audit/evidence/parity/README.md)).
- **Requirement hardening (slice 01-06-04, on branch `agentforge/w2-dashboard`, not yet merged, deployed or observed):**
  - the patient header is now a **sticky** identity bar: it stays at the top while the cards scroll, with scroll padding so focused elements are never hidden under it ([StickyHeader.test.tsx](dashboard/test/web/StickyHeader.test.tsx); [regression proof](docs/legacy-audit/evidence/slice-06-04-header-regression.txt));
  - the cards follow the **legacy arrangement**: Allergies, Medical Problems and Medications in one three-column row, Prescriptions and Care Team at full width, Vitals in the two-thirds left column, one column on phones ([Layout.test.tsx](dashboard/test/web/Layout.test.tsx));
  - Medications shows **dosage instructions** from FHIR `MedicationRequest`, joined to the REST list by uuid ([regression proof](docs/legacy-audit/evidence/slice-06-04-medications-regression.txt)). This needs the scope `user/MedicationRequest.rs`, which the production OAuth client was not registered with. Until the registration is updated, the card keeps its list and says the instructions couldn't be loaded.
- **Not yet done:** a manual keyboard and screen-reader pass ([arc](docs/legacy-audit/arcs/ARC-01-DASHBOARD.md)).

## 2. Why React + TypeScript + Vite and a Fastify BFF

### The scoring

Before scoring anything, we fixed eight dimensions and their weights (1–5, summing to 27, so the maximum is 135). We then scored five routes ([MIGRATION-OPTIONS.md](docs/legacy-audit/MIGRATION-OPTIONS.md)):

| Dimension (weight) | R0 PHP in place | **R1 React + BFF** | R2 SvelteKit | R3 Vue + BFF | R4 Next.js |
|---|---|---|---|---|---|
| Working by Sunday (5) | 10 | 20 | 20 | 20 | 15 |
| Defensibility (5) | 5 | 20 | 20 | 20 | 15 |
| BFF fit (4) | 4 | 16 | 20 | 16 | 16 |
| Familiarity (4) | 12 | 12 | 8 | 12 | 8 |
| Testability / gate fit (3) | 6 | 15 | 12 | 15 | 9 |
| Parity ergonomics (3) | 6 | 12 | 15 | 12 | 12 |
| Deploy fit (2) | 4 | 10 | 10 | 10 | 8 |
| Ecosystem (1) | 2 | 5 | 3 | 4 | 4 |
| **Total / 135** | **49** | **110** | **108** | **109** | **87** |

**It was a near-tie, and we say so.** Anything within 5% of the top score (104.5 or more) counts as tied, so R1, R3 and R2 are tied. R1 beats Vue by 1 point, and all of that point is the ecosystem dimension, which has weight 1. R1 beats SvelteKit by 2 points: SvelteKit wins on BFF fit and parity ergonomics, and R1 wins on familiarity, testability and ecosystem.

**Familiarity was an assumption, not a measurement.** The repo contains no fork-authored React, Vue or Svelte code. So we scored familiarity by how much of each route is plain Node + Zod + `node --test`, the stack of the existing `agentforge/` service. The sensitivity table shows that one sentence from the owner ("I know Vue well", or Svelte) would have flipped the result.

**How the tie was broken.** The owner had no preference, so the top score won ([AUDIT-STATE.md, Decisions 2026-09-25](docs/legacy-audit/AUDIT-STATE.md)). That choice mattered less than it looks. The parity rules, the upstream allow-list, the error mapping and the DTOs live in `dashboard/core/`, which has no framework and no I/O. A lint test enforces that boundary ([boundaries.test.ts](dashboard/test/lint/boundaries.test.ts)). The framework decision therefore only affects the component layer.

### Why a BFF and not a browser-only SPA

The audit settled this before any framework was scored ([modules/README.md](docs/legacy-audit/modules/README.md), [AGENT-BRIEF.md](docs/legacy-audit/AGENT-BRIEF.md)):

- **Public OAuth clients can't get `user/` scopes in OpenEMR** (M-2, catalog 8.01). A browser-only SPA would get no `/api/*` access, and it would be limited to one patient per authorization. The confidential client did obtain `user/` scopes, and its REST calls returned 200 ([VERIFICATION.md](docs/legacy-audit/VERIFICATION.md)).
- **CORS preflight always returns 404** (M-3, catalog 4.01, confirmed live). A cross-origin SPA can't send `Authorization` at all. Serving the SPA and the BFF from one origin avoids CORS altogether.
- **Tokens never reach the browser.** The browser holds only an HttpOnly session cookie (`Path=/dashboard`). Tokens and the client secret stay in BFF memory. A test asserts that no response body carries a token, the secret or a JWT, and that the cookie flags are correct ([security.test.ts](dashboard/test/bff/security.test.ts)).

## 3. What moving off PHP gained

Each gain below is tied to a catalog ID in [BUGS-MITIGATIONS.md](docs/legacy-audit/BUGS-MITIGATIONS.md) and to a test that fails when the behavior breaks.

| Gain | Legacy behavior (catalog ID) | Port behavior | Proof |
|---|---|---|---|
| **The patient is explicit in every request** | `set_pid` switches the session patient, writes an audit entry and runs CDR before authorization (3.01). Async fragments read whatever session patient exists at fetch time, so patient B's cards can render under patient A's header (5.04, 7.04) | No session patient. The route is `/dashboard/patients/:puuid`, every BFF and upstream call carries that id, and any row about another patient fails the card with `PATIENT_MISMATCH`. The SPA drops a late answer for the previous patient | [allergies.test.ts](dashboard/test/contract/allergies.test.ts) "a row about another patient fails the whole card"; [PatientHeader.test.tsx](dashboard/test/web/PatientHeader.test.tsx) "a late answer for the previous patient never renders under the new one" |
| **Escaping by default** | The Care Team card writes `note` and `provider_since` into `innerHTML`, a stored XSS (2.02). Twig autoescape is off (2.04) | JSX text binding only. ESLint makes `react/no-danger` an error and bans `innerHTML`. CSP is `script-src 'self'` | [CareTeamCard.test.tsx](dashboard/test/web/CareTeamCard.test.tsx) renders `<img src=x onerror=…>` in every field and asserts no `<img>` exists; [eslint.config.js](dashboard/eslint.config.js) |
| **Deleted vitals are never shown** | The legacy fragment joins `forms` on `form_id` alone, so pid 13 shows deleted set 28 as "most recent" (5.01, Critical, reproduced with SQL). FHIR vital-signs Observations include deleted sets marked `final` (5.02, Critical) | Vitals come from the REST per-encounter route, which filters `deleted=0 AND formdir='vitals'`. The allow-list has no FHIR `Observation` route, and a test fails if one is added | [slice-05-01-regression.txt](docs/legacy-audit/evidence/slice-05-01-regression.txt): switching to FHIR turned the hook red with 8 failing tests, including "never the deleted newer set 36" |
| **Strict error mapping** | `fetchHtml` has no error handling (6.05). REST validation errors come back as HTTP 200 (6.02). Error text can contain SQL (6.01) | One `CardResult` union with states ok / empty / forbidden / reauth / error. A 200 with `validationErrors` is an error, never "Nothing Recorded". A 500 body containing SQL reaches neither the DTO nor the logs | [allergies.test.ts](dashboard/test/contract/allergies.test.ts) "HTTP 200 with validationErrors is an error, never 'Nothing Recorded' (6.02)" and "a 500 carrying SQL text…"; [mapResponse.test.ts](dashboard/test/bff/mapResponse.test.ts) |
| **Tests the gate enforces** | The legacy dashboard path has no tests in the enforced gate. The hook runs no OpenEMR PHP checks (9.01) | **315 tests in 31 files** at the branch head with slice 01-06-04 (287 in 28 files at the deployed `7b49460`): 107 unit (core), 81 contract, 59 BFF, 65 component, 3 lint-boundary. `npm run check` (typecheck, lint, tests, build, bundle budget) runs in [`.githooks/pre-commit`](.githooks/pre-commit), mirrored in [`.gitlab-ci.yml`](.gitlab-ci.yml) | `npm run check --prefix dashboard`. There are 9 deliberate-regression files, one per slice from 01-01-01 to 01-05-01 plus two for 01-06-04, each showing the hook refuse the commit ([evidence/](docs/legacy-audit/evidence/)) |
| **Automated accessibility checks** | No accessibility tests exist in OpenEMR or AgentForge (7.12) | 8 of the 9 component test files run axe-core on the rendered states and assert zero violations (the ninth, the layout test, checks only CSS). `eslint-plugin-jsx-a11y` runs in lint. The axe `color-contrast` rule is disabled because jsdom has no layout, so contrast is left to the manual pass, **which has not been done yet** | [AllergiesCard.test.tsx](dashboard/test/web/AllergiesCard.test.tsx) `expectNoAxeViolations` |
| **A bundle budget in the gate** | — | **71.9 kB gzip JS** (237.4 kB raw) and 1.2 kB gzip CSS at the branch head (71.8 kB and 1.0 kB at `7b49460`), against a 150 kB JS budget that fails the build when exceeded. Here kB means 1,024 bytes; Vite prints 73.58 kB because it uses 1,000 | [bundle-report.mjs](dashboard/scripts/bundle-report.mjs), output of `npm run build` |
| **The SQL-injection sink is guarded** | `GET /api/prescription` writes query-parameter *names* into SQL (2.01, M-1) | 14 upstream routes, each with its exact allowed query keys. The Rx search sends exactly `patient_id` and a fixed `source_table`, the MedicationRequest search exactly `patient` and a fixed `intent`, and any other key throws before a request is built. `/bff/*` also refuses any query string with a 400 | [upstreamRoutes.ts](dashboard/core/upstreamRoutes.ts); [slice-03-01-regression.txt](docs/legacy-audit/evidence/slice-03-01-regression.txt) |

**Load time** (local laptop, DASH-SYN-01, 3 runs each; not production): the legacy dashboard reached network-idle in a median of 3.2 s (3.1–3.4 s). The port shows the patient header in a median of 2.6 s (2.2–2.7 s), and all seven sections have settled in 4.3 s (4.2–4.5 s) ([evidence/parity/README.md](docs/legacy-audit/evidence/parity/README.md)). So the port shows *who the patient is* sooner, but the full dashboard is about a second slower. That comes from one patient read per card, which checks every row belongs to the right patient, and from the vitals encounter scan. We don't claim a speed gain.

## 4. What it cost

### "FHIR API" wording versus REST, card by card

The brief says the clinical cards pull "live data from the FHIR API". We use FHIR where it can reproduce the PHP card and standard REST where it can't ([modules/README.md, "Per-card data source"](docs/legacy-audit/modules/README.md); owner decision "keep", [AUDIT-STATE.md](docs/legacy-audit/AUDIT-STATE.md)):

For every REST card we checked the FHIR resource against the legacy card and name the row or field where it diverges. Code is cited at tag `legacy-baseline`; the rows are the synthetic seed's.

| Card | Source | What we checked in FHIR, and where it diverges |
|---|---|---|
| Header | FHIR `Patient`, plus a REST patient read to resolve the integer `pid` | Uses FHIR. `Patient.active` is hard-coded `true`, so status is derived from `deceasedDateTime` |
| Care Team | FHIR `CareTeam` (+ `Practitioner`/`Organization` reads) | Uses FHIR. It is the only API for this card |
| Allergies | REST `/api/patient/:puuid/allergy` | FHIR `clinicalStatus` is `active` whenever `enddate` is null, even when `outcome = 1` (`FhirAllergyIntoleranceService.php:117-121`). DASH-SYN-01's **Latex** row (outcome 1, no end date) would read active in FHIR, but the PHP card hides it (5.08). FHIR `criticality` also collapses severity into 3 buckets and is null for code `1`, so the legacy "(1)" label is lost (5.18) |
| Medical Problems | REST `/api/patient/:puuid/medical_problem` | The FHIR `Condition` search always adds `activity = 1` (`FhirConditionProblemListItemService.php:123`), a column the PHP rule never reads. A problem with `activity = 0`, outcome 0 and no end date is on the legacy card and absent from FHIR, and no client-side filter can bring it back. For pid 13, 26 of the 39 rows FHIR returns are ended problems the PHP card hides. The `clinical-status` parameter targets a missing column (M-8) ([ISSUE-CARDS.md (c)](docs/legacy-audit/walkthroughs/ISSUE-CARDS.md)) |
| Medications | **Hybrid:** the list is REST `/api/patient/:pid/medication`; dosage instructions come from FHIR `MedicationRequest?patient=<puuid>&intent=plan`, joined by uuid (slice 01-06-04) | The list can't be FHIR. `MedicationRequest.status` comes from `activity` and `enddate` (`PrescriptionService.php:235-236`), never from `outcome`, so a medication marked resolved (`outcome = 1`) with no end date reads `active` in FHIR, but the PHP card hides it. No seeded medication has that combination, so this divergence comes from the code, not from a row. FHIR is the only API that carries `drug_dosage_instructions` (`FhirMedicationRequestService.php:253-266`), so the card uses it for exactly that field |
| Prescriptions | REST `/api/prescription` (allow-listed) | FHIR reports `dispenseRequest.numberOfRepeatsAllowed` as `refills ?? 0`, and `refills` is never selected (`FhirMedicationRequestService.php:319`, M-7). DASH-SYN-01's Lisinopril shows **3** refills on the legacy card and would read **0** in FHIR, which is wrong rather than missing. FHIR also mixes in medication-list rows and has no numeric dosage |
| Vitals | REST per-encounter vitals | FHIR vital-signs Observations include soft-deleted sets (5.02). DASH-SYN-01's deleted 2026-05-01 set would be the latest |

### Gaps shown as "Not available via API"

The port can't show these, because no API exposes them ([AGENT-BRIEF.md](docs/legacy-audit/AGENT-BRIEF.md), [MIGRATION-REACT.md §1, §2.6](docs/legacy-audit/MIGRATION-REACT.md)):

- **Refills** are never selected by the REST route (5.06). The Refills column reads "Not available via API", never 0.
- **Care Team member status and Note** have no FHIR field. **Inactive members are shown like active ones** (5.05 / M-6).
- **Active status** is derived from `deceasedDateTime`, because `Patient.active` is hard-coded `true` ([header.ts](dashboard/core/rules/header.ts)).
- **An OpenEMR API defect we hit during parity testing:** `GET /api/patient/:puuid/allergy` returns HTTP 500 for any allergy recorded by a real user, because the response carries raw binary uuids that break JSON encoding (catalog 5.29). The legacy PHP card is unaffected. The port shows its explicit error state, never "Nothing Recorded". For the demo, the synthetic allergies are recorded with no user.
  - **It can't affect any production patient today.** Production has no user-authored allergy rows (a read-only check during the 01-06-04 review), and neither has the local stack (a `SELECT` on `lists` joined to `users` returns 0). The first allergy a clinician records through the UI would trigger it, so a real deployment needs the one-line upstream fix.
  - **The FHIR `AllergyIntolerance` path would avoid it, at the cost of parity:** it would show the Latex row the legacy card hides and lose the "(1)" label (table above). We kept REST.
- **`lists_touch`** has no API, so every empty issue list reads "Nothing Recorded". The legacy page could say "No Known Allergies" (4.02).
- **Squad restriction and `hide_dashboard_cards`** don't exist in the API, so the port can't enforce them. We record them as access-model differences (3.04, 4.12).
- **The Rx dosage form** is not returned by the route (4.10). **Medication dosage instructions** (4.05) are not in the REST list either. Since slice 01-06-04 they are joined in from FHIR `MedicationRequest`. They are still missing in three cases, and the card notes the first two:
  - the FHIR read fails, for example because the client lacks `user/MedicationRequest.rs` (OpenEMR answers 401). The note then says the instructions "couldn't be loaded", and the card doesn't ask the user to sign in again;
  - a medication has no `intent=plan` MedicationRequest, for example because it is linked to a prescription (`lists_medication.prescription_id`, `PrescriptionService.php:260`). The note says for how many;
  - the instruction text is purely numeric. FHIR drops it (`is_numeric`, `FhirMedicationRequestService.php:265`), while the legacy card would print it. No note is shown, and we record the difference here.
- **Per-card ACLs differ from the legacy page.** Problems needs `encounters/notes` instead of `patients/med`, and Rx needs `patients/med` instead of `patients/rx`, so each card handles its own 403 (3.14).

### Care Team member names

OpenEMR's FHIR `CareTeam` carries no display names for members, only references. To get a name, we need a `Practitioner` read. That read returns only users who have an NPI, and the viewer must hold `admin/users` ([DEV-LOG.md, slice 01-04-01](docs/legacy-audit/DEV-LOG.md); [upstreamRoutes.ts](dashboard/core/upstreamRoutes.ts)). Without both, the Member column reads "Name unavailable", and the card still loads. For the demo, the owner granted exactly that on production:

- the seeded care-team member (the `admin` user) got a synthetic test NPI;
- a new narrow phpGACL ACL grants `view` on `admin/users` to the single `grader` account.

The change and its revert are in [prod-careteam-names.sql](docs/legacy-audit/seed/prod-careteam-names.sql) and [prod-careteam-names-revert.sql](docs/legacy-audit/seed/prod-careteam-names-revert.sql). A real deployment would need a deliberate role decision here: least privilege, or showing names.

### Legacy cards not ported

The legacy dashboard renders 22 cards ([ui/DASHBOARD-MAP.md §4](docs/legacy-audit/ui/DASHBOARD-MAP.md)). The port covers 6: Allergies, Medical Problems, Medications, Prescriptions, Care Team and Vitals. The header is not a card. The other 16 are listed below. The brief names five clinical cards plus one extra section. The owner agreed that those define done and that everything else is "not ported, with a reason" (A1, [REQUIREMENTS-TRACE.md](docs/legacy-audit/REQUIREMENTS-TRACE.md)). "API exists" means we found a read route for the card's data; those cards were deprioritized, not blocked. Route names are from `apis/routes/` at `legacy-baseline`.

| Legacy card | Read API? | Why not ported |
|---|---|---|
| Messages (the brief's "Patient Notes", `pnotes`) | **No read API.** REST has only `POST`/`PUT`/`DELETE /api/patient/:pid/message`, and the `message` scope is create/update/delete only | Out of brief scope (A1), and impossible without a backend change. It was our first choice for the extra section, so we picked Vitals instead |
| Treatment Intervention Preferences | API exists: FHIR `Observation` (treatment-intervention-preference) | Out of brief scope (A1); deprioritized |
| Care Experience Preferences | API exists: FHIR `Observation` (care-experience-preference) | Out of brief scope (A1); deprioritized |
| Demographics | API exists: FHIR `Patient`, REST `/api/patient/:puuid` | Out of brief scope (A1). The header shows the brief's five identity fields; the full layout-driven card was deprioritized |
| Billing | No read route found for the balance or billing note the card shows | Out of brief scope (A1) |
| Insurance | API exists: REST `/api/patient/:puuid/insurance`, FHIR `Coverage` | Out of brief scope (A1); deprioritized |
| Patient Reminders | No read route found | Out of brief scope (A1) |
| Disclosures | No read route found | Out of brief scope (A1) |
| Amendments | No read route found | Out of brief scope (A1) |
| Labs | API exists: FHIR `Observation` (laboratory), `DiagnosticReport`, REST `/api/procedure` | Out of brief scope (A1). It was a brief option for the extra section; we chose Vitals because the legacy Vitals card has a Critical defect the port fixes (5.01) |
| Patient Portal / API Access | No: it shows portal and API configuration, not patient data from an API | Out of brief scope (A1) |
| Clinical Reminders | No read route found (the CDR engine runs server-side) | Out of brief scope (A1) |
| Recall | No read route found (`medex_recalls`) | Out of brief scope (A1) |
| Appointments | API exists: REST `/api/patient/:pid/appointment`, FHIR `Appointment` | Out of brief scope (A1). It was a brief option for the extra section; we chose Vitals instead (see Labs) |
| Health Concerns | API exists: FHIR `Condition` (health-concern) | Out of brief scope (A1); deprioritized |
| Immunizations | API exists: FHIR `Immunization`, REST `/api/immunization` | Out of brief scope (A1). It was a brief option for the extra section; we chose Vitals instead (see Labs) |

### Other costs

- **Two artifacts in one container.** There are two builds, a dev proxy, and session, cookie and CSRF handling wired by hand ([MIGRATION-OPTIONS.md, R1 cons](docs/legacy-audit/MIGRATION-OPTIONS.md)).
- **Sessions live in memory.** A container restart signs everyone out. There is no refresh token (`offline_access` is never requested, 1.08), so users sign in again after the 1 h token life. The idle timeout is 30 min ([session.ts](dashboard/bff/src/auth/session.ts), [MIGRATION-REACT.md §2.3](docs/legacy-audit/MIGRATION-REACT.md)).
- **React has the largest runtime of the SPA options.** We scored this as R1's weakest defensibility point. We report the real 71.9 kB and don't claim a size win. We didn't build the Vue or Svelte versions, so we have no measured comparison.
- **Extra upstream calls.** Every card first reads the patient (`rest.patient.read`), one more call per card than a single PHP render (8.02). Medications makes one more, the FHIR `MedicationRequest` search, but only when at least one medication is active. Vitals then walks encounters newest-first until it finds a non-deleted set. The walk is capped at 50 encounters, and hitting the cap is an error, not "Nothing Recorded" (`VITALS_SCAN_LIMIT`). The walk trusts encounter-number order, which matches date order on every seeded patient but isn't enforced by the schema ([VITALS.md (c)](docs/legacy-audit/walkthroughs/VITALS.md)).
- **We accepted exposure to M-1.** The Rx card needs `user/prescription.rs`, and holding that scope makes the SQL-injection sink reachable with the BFF's token. Before the port, no enabled client had a prescription scope ([BUGS-MITIGATIONS.md 2.01](docs/legacy-audit/BUGS-MITIGATIONS.md)). We accepted this only together with the two-layer allow-list and its regression proof.
- **Patient Notes wasn't an option for the extra section.** It has no read API (the `message` scope is create/update/delete only), so we chose Vitals ([PLAN.md W2D-4](docs/agentforge/PLAN.md)).
- **Where we differ from legacy on purpose, or keep its quirks on purpose.**
  - Vitals shows the correct latest non-deleted set, not the legacy card's deleted one (5.01). Vitals shows units as the API returns them, with no computed metric secondary ([DEV-LOG.md, 01-05-01](docs/legacy-audit/DEV-LOG.md)).
  - We keep some legacy quirks bug-for-bug: Rx shows **all** rows, because the legacy `active` filter never fires (5.03). Allergy severity shows the raw code "(1)" when no label exists. Prescriptions keeps its own empty text, "None".
  - We didn't redesign the "wall of text" (7.10), because the brief forbids redesign.
  - **We keep the legacy layout, and the header now stays on screen.** The cards use the legacy arrangement (see §1). The identity bar is sticky. In the legacy app, the identity bar lives in the tabbed shell above the dashboard iframe, so it stays visible, but it shows only name, MRN and DOB (4.04). The port's sticky bar stays visible the same way and carries all five fields. On phones the bar wraps to about 100 px. The topbar with the app title and sign-out still scrolls away, so that two sticky bars don't take a quarter of the screen.

## 5. How parity was established

1. **An audit before any code.** Ten phases, from manual recon through a UI, module and data audit, walkthroughs, a 164-entry bug catalog (2 Critical, 18 High), route scoring and side quests. The code is cited at tag `legacy-baseline` ([AUDIT-STATE.md, Phase status](docs/legacy-audit/AUDIT-STATE.md)).
2. **A divergence table per card.** Each walkthrough's section (c) sets legacy behavior, API behavior and the port rule side by side ([ISSUE-CARDS](docs/legacy-audit/walkthroughs/ISSUE-CARDS.md), [PRESCRIPTIONS](docs/legacy-audit/walkthroughs/PRESCRIPTIONS.md), [CARE-TEAM](docs/legacy-audit/walkthroughs/CARE-TEAM.md), [VITALS](docs/legacy-audit/walkthroughs/VITALS.md), [SIGN-IN-AND-HEADER](docs/legacy-audit/walkthroughs/SIGN-IN-AND-HEADER.md)). The expected counts come from those tables: 13 of 39 problems for pid 13, 5 prescriptions in the order 66→62, and vitals set 27, never 28.
3. **Fixtures shaped from synthetic data.** The contract fixtures under [test/fixtures/shaped](dashboard/test/fixtures/) were built from read-only SELECTs on the local synthetic database, and each file's `_meta` says it is shaped, not recorded. Error cases are hand-built and labeled as such. Test patients are pids 13, 3 and 12, plus DASH-SYN-01 and DASH-SYN-02.
4. **A regression proof for each slice.** In each slice we broke one rule on purpose and showed the hook refuse the commit, then reverted ([evidence/slice-*.txt](docs/legacy-audit/evidence/)). The broken rules were header status, the active-issue boundary, the problem sort, medication 404-as-empty, the Rx allow-list, the Care Team team choice, the deleted vitals set, and (slice 01-06-04) the sticky header and the uuid join of dosage instructions.
5. **Checks by the owner on the public URL.** The owner signed in as `grader` and confirmed:
   - on `f8d7bdf`: DASH-SYN-01 shows Active and DASH-SYN-02 shows Deceased;
   - on `2246417`: severe allergies are highlighted, resolved or ended issues are hidden, and the empty states render.

   Both are recorded in [VERIFICATION.md](docs/legacy-audit/VERIFICATION.md). Rx, Care Team and Vitals were observed on `7b49460`. The screenshot pairs (W2D-5) are in [evidence/parity/](docs/legacy-audit/evidence/parity/README.md).
6. **A layout comparison (slice 01-06-04).** The port's card positions were measured against the legacy screenshots at 1280 px and 390 px. The run used the real BFF and the built SPA against the shaped pid 13 fixtures, not the live stack. The result is in [evidence/parity/README.md, "Layout"](docs/legacy-audit/evidence/parity/README.md). It isn't observed on the public URL yet.

## 6. What's next

The top three recommendations from [sidequests/README.md](docs/legacy-audit/sidequests/README.md), all for after the deadline:

1. **SQ-01: sort severe allergies to the top** (4.03). The owner named this directly. It is a client-side re-sort.
2. **SQ-02: vitals trend graphs** (7.10). This answers the "wall of text" complaint, and the REST per-encounter series already exists.
3. **SQ-30: add OpenEMR PHPStan, PHPCS and ESLint to `.githooks/pre-commit`** (9.01). Today the gate enforces the port's tests but not OpenEMR's own checks.
