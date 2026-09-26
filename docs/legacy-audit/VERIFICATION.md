# Verification ledger (Phase 6)

Every High / Critical-candidate claim from Phases 2–4, with how it's known.
Phase 6 scope (David, 2026-09-25): **no scripted live API checks and no
restricted-user checks.** Live evidence comes from the build's walking
skeleton; each walkthrough in [`walkthroughs/`](walkthroughs/) ends with the
checklist that slice will tick.

**Status key**
- **code**: re-read at the cited lines by a tier-3 reviewer.
- **code+SQL**: also reproduced with read-only SQL on the local synthetic DB.
- **live**: observed on the running local stack.
- **pending build**: to be confirmed by the walking skeleton.

## Legacy UI (Phase 2)

| ID | Claim | Status | Evidence |
|---|---|---|---|
| U-1 | Vitals card can show a **deleted** set as current (`forms` joined by id only) | **code+SQL** | `vitals_fragment.php:27`; pid 13 returns set 28 (deleted) instead of 27 |
| U-2 | Allergy–medication conflict `alert()` is a JS syntax error with 2 or more conflicts | code | `demographics.php:111-118` |
| U-3 | Rx `active` filter never fires; saving an edit re-activates a stopped Rx | code | `ORDataObject.php:137`, `Prescription.class.php:149` |
| U-4 | Care Team save has no write ACL | code | `CareTeamViewCard.php:47,124-147` |
| U-5 | Care Team stored XSS (`note`, `provider_since` → `innerHTML`) | code | `manage_care_team.html.twig:64-65,72-73` |
| U-6 | `set_pid` switches patient, audit and CDR before authorization | code | `demographics.php:84-94` vs `:1056` |
| U-7 | Identity JS emitted before the page ACL gate | code | `demographics.php:916-967` |
| U-8 | Fragment endpoints (vitals, `stats.php` immunizations, reminders) run no ACL check | code | `vitals_fragment.php:15-21`, `stats.php:273-314` |
| U-9 | Squad restriction hides only the header | code | `demographics.php:1068-1077` |
| U-10 | B-14: Add-prescription URL `controller.php??prescription` | code + **live** (David hit the error) | `general_list.html.twig:449`, `Controller.class.php:78` |
| U-11 | Async fragments carry no pid (mixed patients on a mid-load switch) | code | `demographics.php:494-513` |

## API / modules (Phase 3)

| ID | Claim | Status | Evidence |
|---|---|---|---|
| M-1 | Authenticated SQL injection via query-parameter names on `/api/prescription` | code; **production exposure checked by David: not reachable** (no enabled client has a prescription scope) | `PrescriptionService.php:56-77`; `AuthorizationListener.php:186-192` |
| M-2 | Public clients can't obtain `user/` scopes, so no `/api/*` | code; **live-consistent** (our confidential client obtained `user/` scopes and REST calls returned 200) | `AuthorizationController.php:324-330` |
| M-3 | CORS preflight returns 404, so a cross-origin SPA can't send `Authorization` | **live** (`OPTIONS` → 404, `Origin` reflected) | `CORSListener.php`, `RoutesExtensionListener.php:28` |
| M-4 | Confidential client not authenticated at `/token` when `client_secret` is omitted | code | `ClientRepository.php:185-221` |
| M-5 | FHIR vitals has no deleted filter | code+SQL | `VitalsService::search()`; `FhirObservationVitalsService.php:441` |
| M-6 | FHIR `CareTeam` exposes inactive members with no status | code+SQL | `FhirCareTeamService.php:345` vs `CareTeamService.php:177,215` |
| M-7 | `refills` never selected (FHIR says 0; REST omits it) | code | `PrescriptionService.php:95-188`, `FhirMedicationRequestService.php:319` |
| M-8 | FHIR `Condition` drops the coded diagnosis; `clinical-status` param targets a missing column | code | `FhirConditionProblemListItemService.php:129-181` |
| M-9 | 7 of 10 `controller.php` controllers have no ACL | code | `Controller.class.php:131-144`; 0 ACL calls per `C_*.class.php` |

## Resolved in Phase 6

| Question | Answer | Source |
|---|---|---|
| Does the BFF get a patient picker (one patient per login)? | No. The confidential client has `user/` scopes and no `launch/patient`; David's login went straight to consent, giving a user-context token | live (step 3), `walkthroughs/SIGN-IN-AND-HEADER.md` |
| Token response `scope` omits `api:oemr` / `api:fhir` | Cosmetic: both are present in the token's claims | **live** |
| `/api/patient?pubpid=13` filters? | No: returns all 13 patients (documented REST filters are dead) | **live** |
| Which key scopes `/api/prescription` to one patient? | Both `pid` (joined `patient_data`) and `patient_id` (UNION column) work. **The BFF allow-lists `patient_id` only**: no dependency on the join | `PrescriptionService.php:225,313`; tier-3 review |
| Does anything call `getVitalsForPatientEncounter()`? | Yes: `EncounterService::getVitals()` behind `GET /api/patient/:pid/encounter/:eid/vital` | `EncounterService.php:598-603` |
| Do REST vitals carry units? | Yes: a `<field>_unit` key per value | `VitalsService.php:249-283` |
| Can the "correct latest vitals set" rule be implemented? | Yes, via the REST per-encounter route (filters `deleted=0` and `formdir='vitals'`), not FHIR | `walkthroughs/VITALS.md` |

## Pending build (walking skeleton)

- Each walkthrough's "Live evidence" checklist: expected row counts for pid 13 and pid 3,
  filters, empty states, 404-as-empty for Medications, and HTTP-200 validation errors.
- ACL spread across the BFF's calls: `patients/med` (Allergies, Rx), `encounters/notes`
  (Problems list, vitals), `encounters/auth_a` (encounter list). The BFF's user role needs all three.
- Not testable with the current seed: deceased-patient header status (no deceased patient);
  the Medical Problems ACL mismatch (admin has both ACLs).

## Observed live on the public URL

| Date | SHA | What | Observer |
|---|---|---|---|
| 2026-09-25 | `f8d7bdf` | Slice 01: sign-in via the BFF (confidential client) + persistent header; DASH-SYN-01 → Active, DASH-SYN-02 → Deceased | David (`grader`, phone) |
