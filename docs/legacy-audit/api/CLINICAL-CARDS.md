# Clinical cards API map (DB-03..DB-08)

Phase 1 map, not a critique. Every claim below is read from source and cited
`path:line`. Guesses are marked **[guess]**. No PHP/docker/SQL was run; DB
facts are carried over from `RECON.md`/`REQUIREMENTS-TRACE.md` (Phase 0,
DB-verified) and not re-verified here.

Ground truth for "what the PHP card actually queries and filters" comes from
`interface/patient_file/summary/demographics.php`, which for DB-03..DB-06
calls the *same* `OpenEMR\Services\*` classes that back the REST/FHIR
controllers, then filters the PHP-side array before rendering. That means
the API and the PHP card literally share a data-access layer for those four
cards — the parity gap is entirely in the filtering/shaping, not the query.

---

## DB-03 Allergies

**PHP card.** `interface/patient_file/summary/demographics.php:1116-1118`:
```php
$allergyService = new AllergyIntoleranceService();
$_rawAllergies = filterActiveIssues($allergyService->getAll(['lists.pid' => $pid])->getData());
```
`filterActiveIssues` (`demographics.php:1110-1113`):
```php
function filterActiveIssues(array $i): array
{
    return array_filter($i, fn($_i): bool => ($_i['outcome'] != 1) && (empty($_i['enddate']) || (strtotime((string) $_i['enddate']) > strtotime('now'))));
}
```
So the PHP Allergies card **is filtered** (outcome != resolved AND (no
enddate OR enddate in the future)) — `RECON.md`'s DB-03 row doesn't mention
a filter, but the code applies the same `filterActiveIssues` used for
Medical Problems and Medications. This is a Phase 1 correction to Phase 0's
table, not a new bug.

**Endpoints** (both read `lists` where `type='allergy'`, table
`src/Services/AllergyIntoleranceService.php:27`):

| Endpoint | Controller | Service | SQL |
|---|---|---|---|
| `GET /fhir/AllergyIntolerance[/:uuid]` — route `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:73-95` | `src/RestControllers/FHIR/FhirAllergyIntoleranceRestController.php` | `src/Services/FHIR/FhirAllergyIntoleranceService.php` → `AllergyIntoleranceService::search()` | `src/Services/AllergyIntoleranceService.php:52-98` (joins `lists`, `list_options` reaction/verification, `patient_data`, `users`, `facility`) |
| `GET /api/allergy`, `GET /api/patient/:puuid/allergy[/:auuid]` — route `apis/routes/_rest_routes_standard.inc.php:253-296` | `src/RestControllers/AllergyIntoleranceRestController.php` | same `AllergyIntoleranceService` | same SQL |

**Default filtering.** `AllergyIntoleranceService::search()`
(`src/Services/AllergyIntoleranceService.php:44-138`) has **no** WHERE
clause on `enddate` or `outcome` beyond the caller-supplied search array —
it returns every `lists` row of `type='allergy'` for the patient, resolved
or not. Both API paths return the same unfiltered set; **neither applies
`filterActiveIssues`**. A client must replicate that filter itself to match
the card.

**Search parameters** (FHIR, `FhirAllergyIntoleranceService.php:59-71`):
`patient`, `_id`, `_lastUpdated`. No `clinical-status` param is registered,
so a FHIR client cannot ask the server to filter active vs. resolved.

**`clinicalStatus` derivation** (`src/Services/FHIR/FhirAllergyIntoleranceService.php:117-122`):
```php
$clinicalStatus = "inactive";
if ($dataRecord['outcome'] == '1' && isset($dataRecord['enddate'])) {
    $clinicalStatus = "resolved";
} elseif (!isset($dataRecord['enddate'])) {
    $clinicalStatus = "active";
}
```
Note this differs from the PHP filter: the PHP filter treats a *future*
`enddate` as still active; the FHIR mapping treats any set `enddate` as
non-active (`inactive` unless `outcome==1`). The two are not the same rule.

**Field mapping** (twig: `templates/patient/card/allergies.html.twig:39-46`
shows `title`, and `severity_al` rendered through
`getListItemTitle('severity_ccda', l.severity_al)` — RECON's "(1)" is this
title lookup falling back to the raw option code):

| Field on PHP card | DB column | FHIR element | Standard REST field | Match? |
|---|---|---|---|---|
| Allergy name | `lists.title` | `AllergyIntolerance.text` (narrative, `FhirAllergyIntoleranceService.php:221`) and `.code` if `diagnosis` coded | `title` | Partial — FHIR puts title in narrative text, not a coded display, unless `diagnosis` is populated |
| Severity | `lists.severity_al` | `AllergyIntolerance.criticality` (low/high/unable-to-assess only — coarser 3-value enum, `FhirAllergyIntoleranceService.php:138-152`) | `severity_al` (raw) | Partial — FHIR collapses OpenEMR's severity scale to 3 buckets |
| Reaction | `lists.reaction` (+ `list_options`) | `AllergyIntolerance.reaction[].manifestation` | `reaction`, `reaction_title` | Yes |

**Required scope.** Standard: `RestConfig::request_authorization_check($request, "patients", "med")` (`_rest_routes_standard.inc.php:254,260,266`); OAuth2 scope `user/allergy.cruds` or `patient/allergy.*` (standard) / `patient/AllergyIntolerance.rs` or `user/AllergyIntolerance.rs` (FHIR) per `Documentation/api/AUTHORIZATION.md:370,415,524`.

---

## DB-04 Medical Problems

**PHP card.** `demographics.php:1138,1142,1151`:
```php
$patIssueService = new PatientIssuesService();
$_rawPL = $patIssueService->search(['lists.pid' => $pid, 'lists.type' => 'medical_problem'])->getData();
...
'list' => filterActiveIssues($_rawPL),
```
Same `filterActiveIssues` as above. RECON's "12 of 38" / "9 of 38" open-row
counts are this filter's result — not literally "no `enddate`"; it's
`outcome != 1 AND (no enddate OR enddate in the future)`.

**Important: the PHP card's own service (`PatientIssuesService`) is NOT
wired to any REST or FHIR route.** It exists only for internal callers
(`grep -rn PatientIssuesService src/RestControllers apis/routes` — no
hits). The REST/FHIR surface for Medical Problems uses a *different*,
FHIR-only class, `ConditionService`, that queries the same `lists` table
but with a different, simpler SQL join.

| Endpoint | Controller | Service | SQL |
|---|---|---|---|
| `GET /api/medical_problem`, `GET /api/patient/:puuid/medical_problem[/:muuid]` — route `_rest_routes_standard.inc.php:209-231` | `src/RestControllers/ConditionRestController.php` | `src/Services/ConditionService.php` | `src/Services/ConditionService.php:42-94`, hardcodes `type='medical_problem'` (`:80`), **no `enddate`/`activity` filter** |
| `GET /fhir/Condition[/:uuid]` — route `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:167-176` | `FhirGenericRestController` wrapping `src/Services/FHIR/FhirConditionService.php` | Mapped-service dispatch to `FhirConditionProblemListItemService` (+`FhirConditionHealthConcernService`, `FhirConditionEncounterDiagnosisService`) by `category` | `src/Services/FHIR/Condition/FhirConditionProblemListItemService.php:129-181` |

**Default filtering differs between the two API surfaces:**
- Standard REST `/api/medical_problem` → `ConditionService::search()` — **no filter**, returns every `lists` row of `type='medical_problem'` regardless of `enddate`/`activity`/`outcome` (`src/Services/ConditionService.php:42-94`).
- FHIR `/fhir/Condition` (problem-list-item category, the default when no `category` param is given) filters at the SQL level to `activity = '1'` **and** excludes rows linked to an encounter via `issue_encounter` (`FhirConditionProblemListItemService.php:122-126`):
  ```php
  $openEMRSearchParameters['type'] = new StringSearchField('type', ['medical_problem'], SearchModifier::EXACT);
  $openEMRSearchParameters['activity'] = new StringSearchField('activity', ['1'], SearchModifier::EXACT);
  $openEMRSearchParameters['list_id'] = new TokenSearchField('list_id', [new TokenSearchValue(true)]);
  $openEMRSearchParameters['list_id']->setModifier(SearchModifier::MISSING);
  ```
  `activity` is a separate DB column from `enddate`; whether it tracks
  `enddate` 1:1 in this dataset is not verified here (would need a DB
  query, out of scope for this doc).

**`clinical-status` search param exists but its target column is
computed, not selected** (`FhirConditionProblemListItemService.php:94-206`):
the search parameter definition maps `clinical-status` → column
`clinical_status` (`:102`), but the raw SQL in `searchForOpenEMRRecords()`
(`:129-181`) has no `clinical_status` column — it's set on each row *after*
`QueryUtils::sqlStatementThrowException()` returns (`:196`,
`computeClinicalStatus()` at `src/Services/FHIR/Condition/Trait/FhirConditionTrait.php:102-118`).
If `FhirSearchWhereClauseBuilder::build()` is asked to filter on
`clinical_status` it would add a `WHERE clinical_status = ?` fragment to a
query that doesn't select that column — **this looks like it would error**,
not filter. Not executed/confirmed here; flagged as a mapping-level
observation only.

`computeClinicalStatus()` (`FhirConditionTrait.php:102-118`):
```php
if ($this->isClinicalStatusInactive($dataRecord)) { return 'inactive'; }       // enddate in the past
if ($dataRecord['occurrence'] == 1 || $dataRecord['outcome'] == 1) { return 'resolved'; }
elseif ($dataRecord['occurrence'] > 1) { return 'recurrence'; }
return 'active';
```

**Field mapping** (twig: `templates/patient/card/medical_problems.html.twig:19` — just `title`):

| Field on PHP card | DB column | FHIR element | Standard REST field | Match? |
|---|---|---|---|---|
| Problem title | `lists.title` | `Condition.code.text` "Problem" narrative (`populateCode`) | `title` | Yes |
| (filter) active/ended | `lists.enddate`, `outcome` | `Condition.clinicalStatus` (active/inactive/resolved/recurrence, different rule than PHP) | not derived — raw `enddate`/`outcome`/`activity` columns returned as-is | No — client must recompute |

**Required scope.** `RestConfig::request_authorization_check($request, "encounters", "notes")` for the un-scoped `/api/medical_problem` route, `"patients","med"` for the patient-scoped write/read-by-id routes (`_rest_routes_standard.inc.php:210,216,222,227`) **[note: the collection GET checks a different ACL section (`encounters`,`notes`) than the per-patient GET (`patients`,`med`) — as written, not investigated further]**; FHIR scope `patient/Condition.rs` / `user/Condition.rs` (`AUTHORIZATION.md:374,418`).

---

## DB-05 Medications vs. DB-06 Prescriptions — the union

This is the central finding for DB-05/DB-06. **`PrescriptionService::getBaseSql()`
(`src/Services/PrescriptionService.php:91-337`) is a `UNION` of the
`prescriptions` table and the `lists` table (`type='medication'`)**, and
this single unioned service backs *both* the standard REST
`/api/prescription` endpoint and FHIR `/fhir/MedicationRequest`. This
confirms the hint in `REQUIREMENTS-TRACE.md`: `FhirMedicationRequestService`
does union both source tables.

```php
// src/Services/PrescriptionService.php:149-260 (abridged)
FROM (
    SELECT prescriptions.uuid, 'prescriptions' AS 'source_table', prescriptions.drug, ...
    FROM prescriptions LEFT JOIN drugs ON prescriptions.drug_id = drugs.drug_id LEFT JOIN (...) meds ...
    UNION
    SELECT lists.uuid, 'lists' AS 'source_table', lists.title AS drug, activity AS active, lists.enddate AS end_date, ...
    FROM lists LEFT JOIN users ON users.username = lists.user LEFT JOIN lists_medication ON lists_medication.list_id = lists.id LEFT JOIN (...) issues_encounter ...
    WHERE type = 'medication' AND lists_medication.prescription_id IS NULL
) combined_prescriptions
LEFT JOIN routes_list ... LEFT JOIN intervals_list ... LEFT JOIN units_list ...
```
(`prescriptions.uuid` branch: `:150-204`; `lists` branch: `:206-260`, with
the `WHERE type = 'medication' AND lists_medication.prescription_id IS NULL`
guard at `:258-260` — this excludes `lists` medication rows that are
already linked to a prescription, to avoid representing the same
medication twice.)

Each branch computes its own `status` (`:180-184` for prescriptions,
`:234-238` for lists) from its own end/active column:
```php
// prescriptions branch
CASE WHEN prescriptions.end_date IS NOT NULL AND prescriptions.active = '1' THEN 'completed'
     WHEN prescriptions.active = '1' THEN 'active' ELSE 'stopped' END as 'status'
// lists branch
CASE WHEN lists.enddate IS NOT NULL AND lists.activity = 1 THEN 'completed'
     WHEN lists.activity = 1 THEN 'active' ELSE 'stopped' END as 'status'
```

**Can a client tell the two cards apart via the API?**

- **Standard REST `/api/prescription` — yes.** `source_table` (`'prescriptions'`
  or `'lists'`) survives into the response. `PrescriptionService::createResultRecordFromDatabaseResult()`
  reads `$row['source_table']` directly (`src/Services/PrescriptionService.php:363,366`),
  and `RestControllerHelper::createProcessingResultResponse()`
  (`src/RestControllers/RestControllerHelper.php:252-280`) serializes the
  full record array with no field whitelist — `source_table` is in the
  JSON.
- **FHIR `/fhir/MedicationRequest` — no.** `FhirMedicationRequestService::parseOpenEMRRecord()`
  (`src/Services/FHIR/FhirMedicationRequestService.php:132-202`) never
  reads `$dataRecord['source_table']`; it is dropped during FHIR mapping.
  The nearest FHIR-visible proxy is `MedicationRequest.intent`: `lists`
  rows default to `intent='plan'` (`:212`,
  `IF(lists_medication.request_intent IS NULL, 'plan', ...)`) while
  `prescriptions` rows default to `intent='order'` (`:156`,
  `COALESCE(prescriptions.request_intent, 'order')`) — a heuristic, not a
  guaranteed discriminator (either default can be overridden per-row via
  `lists_medication.request_intent` / `prescriptions.request_intent`).

**FHIR `Medication` and FHIR `MedicationStatement` do NOT carry patient
medication-list data at all:**
- `FhirMedicationService` (`src/Services/FHIR/FhirMedicationService.php:43-47,160-163`)
  delegates to `DrugService`, table `drugs` (`src/Services/DrugService.php:30`)
  — the drug **formulary/catalog**, not a patient's medication list.
- No `FhirMedicationStatementRestController`/service/route exists — only
  the generated data-model class `src/FHIR/R4/FHIRDomainResource/FHIRMedicationStatement.php`
  is present; `grep -rn MedicationStatement apis/routes src/RestControllers`
  finds no route.

**Endpoints:**

| Endpoint | Controller | Service | SQL |
|---|---|---|---|
| `GET /api/patient/:pid/medication[/:mid]` — route `_rest_routes_standard.inc.php:298-327` | `src/RestControllers/ListRestController.php` | `src/Services/ListService.php` | `SELECT * FROM lists WHERE pid=? AND type=? ORDER BY date DESC` (`src/Services/ListService.php:50`) — no `enddate` filter, no query-string search params at all |
| `GET /api/prescription[/:uuid]` — route `_rest_routes_standard.inc.php:664-670` | `src/RestControllers/PrescriptionRestController.php` | `PrescriptionService` (union above) | see above |
| `GET /fhir/MedicationRequest[/:uuid]` — route `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:470-489` | `src/RestControllers/FHIR/FhirMedicationRequestRestController.php` | `FhirMedicationRequestService` → `PrescriptionService::getAll()` | same union |
| `GET /fhir/Medication[/:uuid]` — route `:430-446` | `src/RestControllers/FHIR/FhirMedicationRestController.php` | `FhirMedicationService` → `DrugService` | `drugs` table (formulary, not patient data) |

**Default filtering.** None of the three patient-data endpoints
(`/api/patient/:pid/medication`, `/api/prescription`,
`/fhir/MedicationRequest`) filter out ended rows by default — all return
every row (active + ended/stopped/completed). The PHP Medications card
filters via `filterActiveIssues` (see DB-04); **the PHP Prescriptions card
filter is different and narrower than RECON's Phase-0 read**:

**Correction to RECON.md's DB-06 row.** RECON says Prescriptions shows
"all rows, including ones whose `end_date` has passed." The actual PHP
template filter (`templates/prescription/general_fragment.html:28`,
rendered via `controllers/C_Prescription.class.php:286-299` →
`Prescription::prescriptions_factory()`,
`library/classes/Prescription.class.php:1206-1246`) is:
```smarty
{foreach from=$prescriptions item=prescription}
{if $prescription->get_active() > 0}
```
i.e. it filters on `prescriptions.active = 1`
(`Prescription::get_active()` returns the raw `active` column,
`library/classes/Prescription.class.php:1032-1035`), **not** on
`end_date`. `prescriptions_factory()`'s own SQL has no filter at all
(`SELECT id FROM prescriptions WHERE patient_id = ?`,
`Prescription.class.php:1242-1243`). RECON's "4 of 5, including ended
ones" is consistent with this: in the Synthea test data, ended
prescriptions apparently still have `active=1`, so the `active`-only
filter happens to let them through. A faithful port needs `active=1`, not
an `end_date` check.

**Field mapping** (twig: `templates/patient/card/medication.html.twig:19-20` —
`title`, `drug_dosage_instructions`; Smarty:
`templates/prescription/general_fragment.html:19-35` — Drug, Details,
Qty, Refills, Filled):

| Field on PHP card | DB column | FHIR MedicationRequest element | Standard REST field | Match? |
|---|---|---|---|---|
| Medications: title | `lists.title` | `medicationCodeableConcept.text` (falls back to `drug` text, `populateMedication`, `:458-467`) | `drug` | Yes (renamed) |
| Medications: dosage instructions | `lists_medication.drug_dosage_instructions` | `dosageInstruction.text` (`populateDosageInstruction`, `:264-266`) | `drug_dosage_instructions` | Yes |
| Prescriptions: Drug | `prescriptions.drug` | `medicationCodeableConcept` | `drug` | Yes |
| Prescriptions: Details (=dosage) | `prescriptions.dosage` | not directly — `dosageInstruction.text` mixes `drug_dosage_instructions ?? dosage` (`:264`) | `dosage` | Partial — FHIR conflates dosage and drug_dosage_instructions into one text field |
| Prescriptions: Qty (=quantity) | `prescriptions.quantity` | `dispenseRequest.quantity` (`populateDispenseRequest`, `:320-327`) | `quantity` | Yes |
| Prescriptions: Refills | `prescriptions.refills` (a real column — used directly by the legacy `Prescription` class, `library/classes/Prescription.class.php:585-591` `get_refills()`) | `dispenseRequest.numberOfRepeatsAllowed` — **but `PrescriptionService::getBaseSql()` never selects a `refills` column** (confirmed: `grep -n refills src/Services/PrescriptionService.php` has no hits), so `FhirMedicationRequestService::populateDispenseRequest()`'s `$dataRecord['refills'] ?? 0` (`:319`) always falls to `0` | not exposed by `/api/prescription` either — same missing column | **No** — Refills is silently dropped by the union query on both the standard REST and FHIR paths |
| Prescriptions: Filled (=date_added) | `prescriptions.date_added` | `authoredOn` (`populateAuthoredOn`, `:438-445`) | `date_added` | Yes |

**Required scope.** `"patients","med"` for all three
(`_rest_routes_standard.inc.php:299,665,469` /
`_rest_routes_fhir_r4_us_core_3_1_0.inc.php` MedicationRequest block);
standard scopes `user/medication.cruds`, `user/prescription.rs`
(`AUTHORIZATION.md:538,542`); FHIR scopes `patient/MedicationRequest.rs` /
`user/MedicationRequest.rs`, `patient/Medication.rs` / `user/Medication.rs`
(`:382-383,426-427`).

---

## DB-07 Care Team

**PHP card.** `demographics.php:1252-1276` renders `CareTeamViewCard`
(`src/Patient/Cards/CareTeamViewCard.php`), which uses
`src/Services/CareTeamService.php` — the **same service class** the FHIR
controller uses.

**Endpoint:**

| Endpoint | Controller | Service | SQL |
|---|---|---|---|
| `GET /fhir/CareTeam[/:uuid]` — route `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:142-165` | `src/RestControllers/FHIR/FhirCareTeamRestController.php` | `src/Services/FHIR/FhirCareTeamService.php` → `CareTeamService` | `src/Services/CareTeamService.php:83-121` (`care_teams` + `patient_data` + `list_options`), members via `getCareTeamProviders()`/`getCareTeamFacilities()`/`getCareTeamContacts()` |

No standard (`/api/`) route exists for Care Team — `grep -n
"care_team|CareTeam" _rest_routes_standard.inc.php` has no hits; FHIR is
the only API surface.

**Tables read** — confirms `REQUIREMENTS-TRACE.md`'s hint: `care_teams`
(`CareTeamService.php:35`, `:87-105`) and `care_team_member`
(`:36`, `:174-190` `getCareTeamProviders()`; similar joins exist for
facilities/contacts further in the file, not fully read for this doc).

```php
// src/Services/CareTeamService.php:87-105
FROM care_teams ct
JOIN (SELECT uuid AS puuid, pid AS patient_id FROM patient_data) AS pd ON ct.pid = pd.patient_id
LEFT JOIN list_options lo ON lo.option_id = ct.status AND lo.list_id = 'Care_Team_Status'
```
```php
// src/Services/CareTeamService.php:184-190 (provider participants)
SELECT DISTINCT ctm.care_team_id, ctm.user_id, ctm.role, ctm.facility_id, ctm.provider_since, ctm.status, ctm.note,
       u.uuid as provider_uuid, u.fname, u.lname, u.physician_type,
       lo1.title as role_title, lo2.title as physician_type_title,
       f.uuid as facility_uuid, f.name as facility_name, lo2.codes as physician_type_codes
FROM care_team_member ctm
JOIN users u ON ctm.user_id = u.id
LEFT JOIN facility f ON ctm.facility_id = f.id
LEFT JOIN list_options lo1 ON lo1.option_id = ctm.role AND lo1.list_id = 'care_team_roles'
LEFT JOIN list_options lo2 ON lo2.option_id = u.physician_type AND lo2.list_id = 'physician_type'
```

**Participants/roles exposed.** `FhirCareTeamService::parseOpenEMRRecord()`
(`src/Services/FHIR/FhirCareTeamService.php:103-157`) adds three kinds of
participant: providers (`populateProviderTeamMembers`), facilities
(`populateFacilityTeamMembers`), and related persons/contacts
(`populateRelatedPersonTeamMembers`) — plus a managing organization. A
patient-self participant is explicitly disabled (`:148-150`, commented out
— "inferno is having issues with the subject not validating"). Roles are
mapped to SNOMED CT codes via a fixed lookup table
(`getRoleMappings()`, `:159-179`, e.g. `physician` → `158965000`), falling
back to a generic "Healthcare professional" code (`223366009`) when the
stored `role` string isn't in that table.

**Default filtering.** `CareTeamService::search()`/`getAll()`
(`:59-159`) apply **no default status filter** — a search with just `pid`
returns care teams in every status (`active`, `inactive`, `proposed`,
`suspended`, `entered-in-error`). There is a separate helper,
`hasActiveCareTeam()` (referenced at `CareTeamViewCard.php:119`, backed by
a `SELECT COUNT(*) ... WHERE pid = ? AND (status = 'active' OR status IS
NULL)` query at `CareTeamService.php:369`), used only for a boolean
"has an active team" flag on the card, not for filtering the member list
itself.

**Search parameters** (`FhirCareTeamService.php:80-88`): `patient`,
`status`, `_id`, `_lastUpdated`. `status` maps directly to the
`ct.status`/`care_team_status` selected column, so — unlike the Condition
`clinical-status` case — this one should actually filter correctly.

**Field mapping:**

| Field on PHP card (8-col header: Type, Member, Role, Facility, Since, Status, Note, Remove) | DB column | FHIR CareTeam element | Match? |
|---|---|---|---|
| Member | `care_team_member.user_id` → `users.fname/lname` | `CareTeam.participant.member` (Practitioner reference) | Yes |
| Role | `care_team_member.role` (+ `list_options`) | `CareTeam.participant.role` (SNOMED CT) | Partial — free-text role list vs. fixed SNOMED map |
| Facility | `care_team_member.facility_id` → `facility.name` | via `populateFacilityTeamMembers` (Organization participant) | Yes |
| Since | `care_team_member.provider_since` | not confirmed — `CareTeamParticipant.period` exists in FHIR R4 but population wasn't traced in `populateProviderTeamMembers` (not fully read) | **Not confirmed — flagged** |
| Status (team) | `care_teams.status` | `CareTeam.status` | Yes |
| Note | `care_team_member.note` | not confirmed — not traced | **Not confirmed — flagged** |

No test patient has Care Team rows (`RECON.md` line 59), so none of this
could be cross-checked against live data in Phase 0 or here.

**Required scope.** `RestConfig::request_authorization_check($request,
"patients", "med")` (`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:150,161`);
FHIR scope `patient/CareTeam.rs` / `user/CareTeam.rs`
(`AUTHORIZATION.md:373,417`).

---

## DB-08 Patient Notes

**No read API exists for `pnotes`.** Searched
`src/RestControllers/MessageRestController.php`,
`src/Services/MessageService.php`, `apis/routes/_rest_routes_standard.inc.php`,
`apis/routes/_rest_routes_portal.inc.php`, and
`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php` — the only routes
touching messages are:

```
POST   /api/patient/:pid/message        _rest_routes_standard.inc.php:586
PUT    /api/patient/:pid/message/:mid   _rest_routes_standard.inc.php:615
DELETE /api/patient/:pid/message/:mid   _rest_routes_standard.inc.php:622
```

There is **no `GET /api/patient/:pid/message`** and no
`GET /api/message` route. `MessageRestController`
(`src/RestControllers/MessageRestController.php:40-172`) has exactly three
public methods — `put`, `post`, `delete` — no `getAll`/`getOne`.
`MessageService` (`src/Services/MessageService.php:44-116`) only
`insert`s/`update`s/soft-deletes against `pnotes`; no `SELECT ... FROM
pnotes` for listing (the one `SELECT body FROM pnotes` at `:82` is a
pre-update existence/ownership check, not a list operation).

This is corroborated by the OAuth2 scope documentation itself:
```
# Documentation/api/AUTHORIZATION.md:539
user/message.cud
```
`.cud` — create/update/delete only, no `r`. The scope needed to read
messages doesn't exist in this API.

**FHIR has no resource for it either.**
- `FhirDocumentReferenceService` (`src/Services/FHIR/FhirDocumentReferenceService.php`)
  reads the `documents` table (uploaded files: `src/Services/DocumentService.php:105`
  `FROM documents doc`), unrelated to `pnotes`.
- No `Communication` route/controller/service exists —
  `src/FHIR/R4/FHIRDomainResource/FHIRCommunication.php` is present as a
  generated data-model class only; `grep -rn Communication
  apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php` has no hits, and
  no `FhirCommunicationRestController`/`FhirCommunicationService` exists
  anywhere in `src/`.
- `grep -rn pnotes src/ apis/` (excluding vendor) only matches
  `MessageService.php` (insert/update/delete), `EventAuditLogger.php`
  (audit-log table-name mapping, not a data endpoint), and a changelog
  string in `CreateReleaseChangelogCommand.php` — confirming `pnotes` has
  no other code path anywhere in `src/` or `apis/`.

**Conclusion: not found after searching
`src/RestControllers/MessageRestController.php`,
`src/Services/MessageService.php`,
`apis/routes/_rest_routes_standard.inc.php`,
`apis/routes/_rest_routes_portal.inc.php`,
`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`,
`Documentation/api/AUTHORIZATION.md`, and all FHIR `Fhir*Service`/`Fhir*RestController`
classes under `src/Services/FHIR` and `src/RestControllers/FHIR`.** There is
no API path — standard or FHIR — that can read `pnotes`. This is a hard
gap against DB-10 ("consume the existing API only... gaps are documented,
not patched"): the Patient Notes / Messages card cannot be ported without
either a backend change (out of scope) or being dropped/stubbed with the
gap called out explicitly.

No test patient has `pnotes` rows either (`RECON.md` line 59), so this
would be unverifiable against live data even if a read endpoint existed.

---

## Summary

| Req | Best endpoint | Can reproduce the PHP card's filter via API? | Fields not available via API |
|---|---|---|---|
| DB-03 Allergies | `GET /fhir/AllergyIntolerance` or `GET /api/patient/:puuid/allergy` (same service/SQL either way) | **Partial.** Endpoint returns all rows (active+resolved); client must re-implement `outcome!=1 && (no enddate OR enddate>now)` itself — the FHIR `clinicalStatus` mapping uses a *different* rule, so don't rely on it for the filter | None found missing; severity is coarsened to 3 buckets in FHIR only (raw `severity_al` still available via standard REST) |
| DB-04 Medical Problems | `GET /api/patient/:puuid/medical_problem` (unfiltered, matches PHP's own filter needs) or `GET /fhir/Condition` (server-side `activity=1` filter, different semantics) | **Partial.** Standard REST: no filter, client must apply `filterActiveIssues` logic itself. FHIR: partially filtered server-side (`activity=1`) but by a different rule than the PHP card, and the `clinical-status` search param looks unusable (WHERE on a non-existent SQL column) | None found missing |
| DB-05 Medications (`lists` type=medication) | `GET /api/patient/:pid/medication` (direct, only path that isn't unioned with prescriptions) | **Partial.** No `enddate` filter server-side; client applies `filterActiveIssues`. FHIR MedicationRequest also carries these rows but mixed in with `prescriptions` rows and only distinguishable by the `intent` heuristic | None found missing on the standard REST path |
| DB-06 Prescriptions | `GET /api/prescription` (has `source_table` to isolate `prescriptions`-only rows) | **Partial.** No filter server-side (all statuses returned); client applies `active=1` (not `end_date`) to match the PHP template's actual filter | `refills` — confirmed missing from `PrescriptionService::getBaseSql()`'s SELECT list, so it is `0`/absent on every row via both `/api/prescription` and `/fhir/MedicationRequest`, even though the PHP card's own "Refills" column reads a real, populated `prescriptions.refills` DB value |
| DB-07 Care Team | `GET /fhir/CareTeam` (only API surface; no standard REST route) | **Partial.** No default status filter (all statuses returned); "has active team" boolean logic (`status='active' OR NULL`) is not exposed as a list filter, only as a separate count | "Since" (`provider_since`) and "Note" fields not confirmed mapped to FHIR elements (not fully traced); no test data existed to verify empty/populated states either way |
| DB-08 Patient Notes | **None** | **No.** No GET route exists in standard REST, FHIR, or the portal API for `pnotes` (`user/message.cud` scope confirms write-only by design) | Everything — the entire card's data source is unreachable via the API |

Confidence: high
Escalate: DB-08 has no read path in the existing API at all (not a filtering
gap — a missing endpoint), which conflicts with "consume the existing API
only" (DB-10) for that specific card. This needs David's call on how to
handle the card (drop it with a documented reason per A1, or something
else) before Phase 2 implementation planning for DB-08 proceeds. Also
flagging one lower-confidence item inline above for a follow-up look, not
a full escalation: the Condition `clinical-status` search param appears to
target a computed (non-selected) SQL column and would likely error rather
than filter — inferred from reading the query, not confirmed by running it.
