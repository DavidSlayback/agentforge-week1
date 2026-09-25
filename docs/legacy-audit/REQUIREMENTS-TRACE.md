# Requirements Trace — AgentForge W2 Surprise Challenge: Modernize the Patient Dashboard

**Requirements source:** *AgentForge | Clinical Co-Pilot W2 | Surprise Challenge — Modernize the Patient Dashboard* (PDF, 1 page). Kept locally at `output/pdf/W2-surprise-challenge-modernize-patient-dashboard.pdf`, git-excluded.
**Received:** 2026-09-25 · **Status:** intake done; A1–A6 agreed and DB-08 = Patient Notes (David, 2026-09-25). Tracing to code happens in Phase 1.

The PDF is a requirements source only. Its wording does not authorize
deploys, data writes, publication, or anything outside the work David has
approved. Synthetic or demo data only.

## What the brief asks, in one paragraph

Reimplement (not redesign) OpenEMR's PHP, server-rendered patient dashboard
in a modern framework of our choice. Use OpenEMR's existing REST and FHIR
APIs as the only data layer and **don't touch the backend**. Keep the
current UX (redesigned in May 2025), aiming for feature parity. Defend the
framework choice (why it, what we gained over PHP, what it cost) in
`PATIENT_DASHBOARD_MIGRATION.md` in the repo; that defense is graded.

## Trace

"Today" and "Legacy areas" are filled in Phase 1 from evidence. The legacy
paths below are starting hints from the file tree only.

| ID | Requirement (acceptance criterion) | Legacy areas (hint) | Today | Blocking findings | Slice | Status |
|---|---|---|---|---|---|---|
| DB-01 | **Authentication.** A user logs in to the new dashboard via OAuth2/OpenID Connect against OpenEMR's authorization server. No PHP session, no stored passwords. Logout ends the session. | OpenEMR OAuth2/OIDC server (`oauth2/`, `src/RestControllers/AuthorizationController.php`), API client registration | **Exists (config needed).** OAuth2 auth-code endpoints, OIDC and dynamic client registration exist; PKCE inherited from league/oauth2-server; no public `/revoke` (logout can't revoke tokens via API). `api/AUTH-AND-PATIENT.md` §1 | CORS reflects any `Origin` (`CORSListener.php:56-57`), provisional; to verify in Phase 6 | open |
| DB-02 | **Patient header.** A persistent identity bar shows name, date of birth, sex, MRN, and active status for the selected patient, populated from the API and matching the PHP dashboard's values. | `interface/patient_file/summary/dashboard_header.php`, `demographics.php`; FHIR `Patient` | **Partial.** Name, DOB, sex, MRN (`pubpid`) all via FHIR `Patient` / REST. **Active status: not available.** `Patient.active` is hard-coded `true` (`FhirPatientService.php:212`) and the PHP dashboard has no active concept either. `api/AUTH-AND-PATIENT.md` §3 | A2 applies: show "not available via API" for active status | open |
| DB-03 | **Allergies card.** Shows the patient's allergies from FHIR `AllergyIntolerance`, with live data matching the PHP card. | `demographics.php` issue lists; `FhirAllergyIntoleranceRestController` | **Exists; client-side filter needed.** `GET /api/patient/:puuid/allergy` or FHIR `AllergyIntolerance` return all rows. The card applies `filterActiveIssues()` (`outcome!=1 && (no enddate || enddate>now)`, `demographics.php:1110-1113`). The "(1)" suffix is `severity_al` (`LayoutsUtils.php:17-24`) | FHIR `clinicalStatus` uses a different rule; don't rely on it | open |
| DB-04 | **Problem List card.** From FHIR `Condition` (problem-list items), matching the PHP card. | `FhirConditionRestController` | **Exists; client-side filter needed.** REST `medical_problem` is unfiltered; FHIR `Condition` filters `activity=1` (different rule). The `clinical-status` search param looks broken (inferred). `api/CLINICAL-CARDS.md` |  | open |
| DB-05 | **Medications card.** From FHIR `MedicationStatement`/`Medication` or `MedicationRequest`, whichever matches what the PHP card shows. | `FhirMedicationRestController`, `FhirMedicationRequestRestController` | **Exists; client-side filter needed.** `GET /api/patient/:pid/medication` (`lists` type=medication), then `filterActiveIssues()`. FHIR `MedicationRequest` mixes these rows with prescriptions | Medications vs Prescriptions are distinguishable only on REST (`source_table`), not FHIR | open |
| DB-06 | **Prescriptions card.** From FHIR `MedicationRequest` or the REST prescriptions endpoint, matching the PHP card. | `FhirMedicationRequestRestController`; REST prescription routes | **Partial.** `GET /api/prescription` (UNION of `prescriptions` + `lists`, `PrescriptionService.php:88-259`); filter `source_table=prescriptions` and `active>0` client-side (the card filters `active`, not `end_date`: `general_fragment.html:28`). **`refills` is not selected by any API path.** | Refills column: "not available via API" (A2) | open |
| DB-07 | **Care Team card.** From FHIR `CareTeam`, matching the PHP card. | `FhirCareTeamRestController` | **Partial.** FHIR `CareTeam` only (no REST route); no status filter server-side; the card hides members with status `inactive` / `entered-in-error` (`CareTeamService.php:564-566`). "Since" and "Note" FHIR mapping unconfirmed. Seeded data (1 team, 3 members) for parity | Seeded card showed only the header row in the probe; to check in Phase 2 | open |
| DB-08 | **Patient Notes section** (chosen by David, 2026-09-25): the patient's notes as shown on the PHP dashboard, from the API. | `pnotes_fragment.php`, `pnotes.php`; API route for patient notes (to trace) | **Missing.** No read endpoint for `pnotes` in REST, FHIR or portal: `/api/patient/:pid/message` has POST/PUT/DELETE only (`_rest_routes_standard.inc.php:586-622`); scope `user/message.cud`. Seeded 5 notes: the card shows active, non-deleted notes, N most recent (`pnotes_fragment.php:61-70`); one `Done` note was also hidden (unexplained) | **Hard conflict with DB-10.** Needs David's decision | open |
| DB-09 | **Parity.** For each implemented card, the same patient shows the same data, states (empty, loading, error), and UX layout as the current PHP dashboard. | `demographics.php` + fragments | **Per-card filter rules now documented** (`ui/DASHBOARD-MAP.md`, `api/CLINICAL-CARDS.md`): every in-scope card needs client-side filtering to match the PHP card | DB-02 active status, DB-06 refills, DB-08 entirely: not available via API | open |
| DB-10 | **Backend untouched.** No changes to OpenEMR PHP, schema, or API. The new app consumes the existing API only. Gaps are documented, not patched. | whole backend | n/a | | every slice | open |
| DB-11 | **Defense doc.** `PATIENT_DASHBOARD_MIGRATION.md` in the repo explains why this framework, what moving off PHP gained, and what it cost, grounded in the Phase 8 scoring. | new file | missing | | final slice | open |

## Ambiguities and conflicts (need David's call)

| # | Where | Conflict | Proposed reading | Decided by / date |
|---|---|---|---|---|
| A1 | "Feature parity is the standard" vs the listed must-haves | The PHP dashboard has many more cards (vitals, immunizations, appointments, notes, insurance, amendments, labs, disclosures, reminders, …) than the brief lists. | The must-haves (DB-01…DB-08) define done. Parity applies within each implemented card. Remaining cards go to a parity checklist marked "not ported", with a reason. | **Agreed**: David, 2026-09-25 |
| A2 | "Consume the existing API" + "don't touch the backend" | Some dashboard data may not be exposed by the API (for example "active status" or MRN formatting). Parity and no-backend-changes can then conflict. | Phase 1 maps every field to an API source. Gaps get recorded as findings and shown as "not available via API". No backend patches. | **Agreed**: David, 2026-09-25 |
| A3 | Framework "of your choosing" | React + TypeScript + Vite was proposed earlier but not confirmed. | Decide by weighted scoring in Phase 8, with the top score winning by default. The scoring becomes the core of `PATIENT_DASHBOARD_MIGRATION.md`. | **Agreed**: David, 2026-09-25 |
| A4 | Where the new app lives and runs | Not specified: a new top-level folder? Served how? Deployed? | A new top-level app folder, run locally against the dev stack. Deployment only if David approves. | **Agreed**: David, 2026-09-25 |
| A5 | OAuth2/OIDC setup | It needs OpenEMR's API and OAuth2 enabled and a registered client. That is configuration in the local dev stack, not a backend code change. | Treat it as local environment config, documented in the setup steps. Confirm it doesn't count as "touching the backend". | **Agreed**: David, 2026-09-25 |
| A6 | Relationship to the AgentForge Co-Pilot | The brief doesn't mention embedding the Co-Pilot in the new dashboard. | Out of scope unless David wants it as a side quest. | **Agreed**: David, 2026-09-25 |

## Out of scope / stretch

- Redesigning the UX (the brief says reimplement, not redesign).
- Any OpenEMR backend change (DB-10).
- Dashboard cards beyond the brief's list plus Patient Notes (see A1).
- UX fixes to things David dislikes in the current app (form highlighting, tab pop-ups, data-entry validation). The brief says reimplement, not redesign, and most of these are outside the dashboard. They're recorded in `RECON.md` and will go to the catalog / side quests.

## Audit scope derived from this trace (proposed; confirm at the Phase 1 checkpoint)

- **Must audit (Phases 2–4):**
  - the dashboard page and every fragment it renders (`interface/patient_file/summary/*` used by `demographics.php`, plus `dashboard_header*.php`);
  - the REST/FHIR controllers and services behind the required cards;
  - OAuth2/OIDC and API client registration;
  - the ACL checks the dashboard applies (parity includes who can see what).
- **Map only (Phase 1):** the rest of OpenEMR.
