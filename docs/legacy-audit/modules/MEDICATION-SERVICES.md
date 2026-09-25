# Medication services: the read paths behind the Medications (DB-05) and Prescriptions (DB-06) cards

This unit covers the code the port's SPA would call for the two medication
cards. Three API surfaces are involved, and they do not share one query:

- `GET /api/patient/:pid/medication` runs `ListService::getAll()`, which is a
  plain `SELECT * FROM lists`. It does not join `lists_medication`.
- `GET /api/prescription` runs `PrescriptionService::getAll()`, which is a
  `UNION` of `prescriptions` and `lists` (type `medication`), with no
  server-side patient contract.
- `GET /fhir/MedicationRequest` runs `FhirMedicationRequestService`, which
  reads the same `UNION` as `/api/prescription` and maps each row to a FHIR
  resource. It is the only one of the three that filters by patient through a
  documented, allow-listed search parameter.

The PHP cards use none of these. The Medications card calls
`PatientIssuesService::search()` (`lists` joined with `lists_medication`,
`ORDER BY lists.begdate`). The Prescriptions card calls
`Prescription::prescriptions_factory()`. See `ui/DEMOGRAPHICS-PART2-CARDS.md`
§Medications / §Prescriptions and `ui/PRESCRIPTION-TEMPLATES.md`.

**Source:**
- `src/Services/PrescriptionService.php` · 473 lines · no version header
- `src/Services/FHIR/FhirMedicationRequestService.php` · 596 lines · no version header
- `src/Services/ListService.php` · 238 lines (medication-relevant methods: `getAll`, `getOne`, `validate`, `insert`, `update`, `delete`)
- Controllers: `src/RestControllers/PrescriptionRestController.php` (159),
  `src/RestControllers/ListRestController.php` (`getAll` 109-113, `getOne` 160-164, `post`/`put`/`delete`),
  `src/RestControllers/FHIR/FhirMedicationRequestRestController.php` (`getOne` 115-119, `getAll` 205-220)
- Routes: `apis/routes/_rest_routes_standard.inc.php:298-328` (medication), `:664-680` (prescription);
  `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:470-492` (MedicationRequest)

**Audited by:** tier 3 · confidence high. SQL behavior was checked against the local
synthetic DB with read-only `SELECT`s, including the full `getBaseSql()` UNION run
as a derived table. Only counts are reported. No API call was made.

---

## API contract for the port

### Endpoint summary

| Route | Controller → service | ACL (user tokens) | OAuth scope | Patient scoping | Paging / sort | Envelope |
|---|---|---|---|---|---|---|
| `GET /api/patient/:pid/medication` | `ListRestController::getAll` → `ListService::getAll` | `patients/med` (`_rest_routes_standard.inc.php:299`) | `user/medication.rs` family (`ServerScopeListEntity.php:282`) | path `:pid` = **integer `patient_data.pid`**, not a uuid | none; fixed `ORDER BY date DESC`; query string ignored | **bare JSON array** (`RestControllerHelper::responseHandler`, `:156-168`) |
| `GET /api/patient/:pid/medication/:mid` | `ListRestController::getOne` → `ListService::getOne` | `patients/med` (`:320`) | same | `pid` + `type='medication'` + `id=:mid` (`ListService.php:181`) | n/a | bare JSON object |
| `GET /api/prescription` | `PrescriptionRestController::getAll` → `PrescriptionService::getAll` | `patients/med` (`:665`) | `user/prescription.*` (`ServerScopeListEntity.php:286`) | **none in the contract**; see Q2 | none; no `ORDER BY`; `_limit`/`_count`/`_sort` break the query (Finding 2) | `{validationErrors, internalErrors, data: [...], links}` (`RestControllerHelper.php:252-300`) |
| `GET /api/prescription/:uuid` | `PrescriptionRestController::getOne` | `patients/med` (`:669`) | same | none | n/a | same envelope, `data` = object; 404 when no row (`PrescriptionRestController.php:131-133`) |
| `GET /fhir/MedicationRequest` | `FhirMedicationRequestRestController::getAll` → `FhirServiceBase::getAll` → `PrescriptionService::getAll` | user token: `patients/med` (`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:476`); patient token: no ACL, forced to own `puuid` (`:472-474`) | `user/MedicationRequest.rs`, `patient/MedicationRequest.rs` | `patient=<uuid>` (allow-listed, `FhirMedicationRequestService.php:112`) | `_count`/`_sort`/`_offset` accepted but **ignored**; no next link (Finding 9) | FHIR `Bundle` with `type: collection` (not `searchset`) (`FhirResourcesService.php:39-43`) |
| `GET /fhir/MedicationRequest/:uuid` | `getOne` → `FhirServiceBase::getOne` | `:487` / patient bind `:485` | same | patient token bound | n/a | resource; 404 `[]` if not found (`RestControllerHelper.php:321-323`) |

### Q1. Medications card (DB-05)

**Endpoint:** `GET /api/patient/:pid/medication`. The route runs one query
(`ListService.php:50`):

```sql
SELECT * FROM lists WHERE pid=? AND type=? ORDER BY date DESC
```

**Fields returned:** every column of `lists`, as raw DB strings, with `uuid`
converted to its string form (`:56`). Verified column list (local schema):
`id, date, type, title, begdate, enddate, returndate, occurrence, classification,
referredby, extrainfo, diagnosis, activity, comments, pid, user, groupname,
outcome, destination, reinjury_id, injury_part, injury_type, injury_grade,
reaction, external_allergyid, erx_source, erx_uploaded, modifydate, severity_al,
external_id, subtype, list_option_id, uuid, verification, udi, udi_data`.

- `title`, `begdate`, `enddate` and `outcome` are present, so the card's filter
  (`outcome != 1 && (!enddate || enddate > now)`, `demographics.php:1110-1113`)
  can be reproduced on the client. `enddate` is a naive server-local
  `YYYY-MM-DD HH:MM:SS`. PHP compares it with `strtotime('now')` in the server's
  timezone, so the client must compare in that timezone too.
- **`drug_dosage_instructions` is NOT returned.** It is a column of
  `lists_medication`, not `lists`, and this query does not join
  `lists_medication`. This corrects `api/CLINICAL-CARDS.md` line 269 and
  `ui/CARD-TEMPLATES.md` line 500, and confirms
  `ui/DEMOGRAPHICS-PART2-CARDS.md` line 610.
- **Ordering:** by `lists.date` (the row's creation timestamp), newest first.
  The PHP card sorts by `begdate` ascending (`PatientIssuesService.php:211`,
  `ORDER BY lists.begdate`, which puts NULLs first). Locally, `DATE(date) <>
  DATE(begdate)` for 55 of 60 medication rows, and 5 rows have a NULL
  `begdate`. The client must re-sort by `begdate` ascending with NULLs first.
  Ties have no defined order in either system.
- **Empty list:** when the patient has no medication rows, the service returns
  `[]`. `responseHandler()` treats that as falsy and returns **HTTP 404 with an
  empty body** (`RestControllerHelper.php:158-166`). The client must map 404
  to the empty state. A non-existent or non-numeric `pid` also returns 404,
  so the client cannot tell the two cases apart.
- **Query parameters:** none are honored. The route never reads the query
  string (`_rest_routes_standard.inc.php:298-303`).
- **Getting `drug_dosage_instructions` from another endpoint:** the only API
  sources are `/api/prescription` rows with `source_table='lists'`, and FHIR
  `MedicationRequest.dosageInstruction.text` for the same rows. Join them on
  `uuid`: the lists branch uses `lists.uuid` as its `uuid` and FHIR `id`
  (`PrescriptionService.php:207`). There are two caveats. First, a `lists` row
  whose `lists_medication.prescription_id` is set is excluded from the UNION
  (`:260`), so its instructions are not available. Second, the FHIR path also
  drops purely numeric instructions (Finding 7). Locally `lists_medication` has
  0 rows, so every card row shows only its title and the gap is invisible in
  local data.
- **"None" vs "Nothing Recorded":** needs `lists_touch`, which is not
  available via the API (`modules/LEGACY-ROUTER-AND-LISTS.md` Finding 6).

**Local check:** 60 medication rows across 12 patients. Applying the card
filter leaves 8 rows (pid 13: 5 rows, 1 on the card; pid 3: 0 rows, so the
endpoint returns 404).

### Q2. Prescriptions card (DB-06)

**Endpoint:** `GET /api/prescription` (collection). No patient-scoped route
exists.

**How the client restricts results to one patient.** The controller passes
every query-string key and value straight to `FhirSearchWhereClauseBuilder`
(`PrescriptionRestController.php:154-156`). There, each key becomes a SQL
column name in an exact-match clause, `BINARY <key> = ?` with the value bound
(`FhirSearchWhereClauseBuilder.php:37-38`,
`SearchFieldStatementResolver.php:293`). The WHERE clause is appended to the
outer query, so a key filters only if it names an unambiguous column of one
of the FROM sources. Results for the plausible patient filters:

| Key | Result | Evidence |
|---|---|---|
| `patient.uuid` (the service's own branch, `PrescriptionService.php:58-69`) | **Cannot arrive over HTTP.** PHP rewrites `.` in query keys to `_`, and `patient_uuid` is not a column, so the query fails with a 500 (Finding 2). Even if reached internally, `patient.uuid` names a column the `patient` subquery does not have (it has `puuid`, `pid`). Dead code. | `:58-69`, `:308-313` |
| `puuid=<uuid string>` | **0 rows.** `puuid` is `binary(16)` and the bound value is the 36-character string. | local SQL: 0 matches for pid 13's uuid string |
| `pid=<integer>` | **Works, but by accident.** `pid` is a column of the joined `patient` subquery (`:309-311`), although it is not in the SELECT list. Locally, pid 13 gives 10 rows (5 `lists` + 5 `prescriptions`) and pid 3 gives 0 rows (HTTP 200, `data: []`). | local SQL on the extracted `getBaseSql()` |
| `source_table=prescriptions` | **Works.** Filters out the medication-list half of the UNION. `pid=13` plus this key gives 5 rows. | local SQL |

Recommendation for the port: call `GET /api/prescription?pid=<pid>&source_table=prescriptions`.
The client must then also drop any row whose `puuid` differs from the patient's
uuid. The `pid` filter is undocumented, and it rides on the same mechanism as
Finding 1, so an allow-list fix could remove it. The fallback, fetching
everything and filtering on `puuid` client-side, pulls every patient's rows
(116 locally), and the port should not do that (Finding 3).

**Fields present in each `data[]` row** (outer SELECT, `PrescriptionService.php:95-148`):

| Card need | Response key | Present? | Notes |
|---|---|---|---|
| drug | `drug` | yes | For `lists` rows this is `lists.title` (`:209`) |
| size | `prescription_drug_size` | yes (renamed) | `prescriptions.size` (`:169`); NULL for `lists` rows |
| unit | `unit` (code), `unit_title` (display) | yes | `COALESCE(prescriptions.unit, drugs.unit)` (`:166`), title from `drug_units` (`:281-289`). PHP uses `unit_array` from the same list. Locally `drug_id` is always 0, so the COALESCE never changes the value. |
| dosage | `dosage` | yes | raw `prescriptions.dosage` (`:185`); NULL for `lists` rows (`:239`) |
| form | — | **no** | `prescriptions.form` is never selected. `get_dosage_display()` appends `" in <form title> <interval title>"` when form **or** interval is set (`library/classes/Prescription.class.php:552-559`), so the Details text cannot be reproduced for any row with `form` set (1 of 56 rows locally). |
| interval | `interval`, `interval_title` | yes | `:167`, `:273-280` |
| quantity | `quantity` | yes | raw string; NULL for `lists` rows |
| refills | — | **no (confirmed)** | `refills` appears nowhere in `PrescriptionService.php`, not in the outer SELECT (`:95-148`) and not in the prescriptions branch (`:150-188`). The column exists (`int(11)`), and 1 of 56 local rows has a non-zero value. **Not available via API.** |
| date_added | `date_added` | yes | selected twice (`:106`, `:114`); the duplicate collapses to one key. Raw `YYYY-MM-DD HH:MM:SS`, which matches the card's "Filled" column. |
| date_modified | `date_modified` | yes | `:115` |
| active | `active` | yes | raw `prescriptions.active` (`:154`); for `lists` rows it is `lists.activity` (`:210`) |
| (extra) | `source_table`, `status`, `puuid`, `uuid`, `intent`, `intent_title`, `category*`, `rxnorm_drugcode`, `drugcode` (only when rxnorm is set), `route*`, `note`, `diagnosis`, adherence fields, `euuid`, `pruuid`, `request_intent_title` (synthetic, Finding 11) | | |

**Ordering:** the SQL has no `ORDER BY`. The client must sort by `active` DESC,
`date_modified` DESC with NULLs last, then `date_added` DESC. That matches
`Prescription.class.php:1242-1243`. Locally, 10 (patient, `date_modified`)
pairs are ties. MySQL order after the last key is undefined in PHP as well,
so the client should add a stable final tiebreak (for example `uuid`) and
document it.

**"Show ALL rows" decision:** implementable. The API applies no `active`
filter, so the client simply does not filter. One caveat: `DELETE
/api/prescription/:uuid` sets `active = 0` (`PrescriptionService.php:465-466`).
The PHP card still shows such rows, because of U-3, and so does the port under
the show-all decision. The API reports the same row as `status: stopped`.

**Details column:** `prescription_drug_size` + `unit_title` + `dosage`, plus
`" in " + <form title> + " " + interval_title` when form or interval is set.
Implementable only for rows where `form` is NULL or 0 **and** `interval` is
empty. When `interval` is set, the client cannot tell whether a form label is
missing from the text.

**Refills column:** not available via API. The client must show a documented
placeholder, not `0`.

**ACL difference:** the PHP card requires `patients/rx`
(`demographics.php:1098`), while every API route here requires `patients/med`.
Already recorded in `ui/DEMOGRAPHICS-PART2-CARDS.md` §Prescriptions.

### Q3. FHIR MedicationRequest

**Row source:** the same `getBaseSql()` UNION (`FhirMedicationRequestService.php:210-213`).
Allow-listed search params: `patient`, `intent`, `status`, `_id`,
`_lastUpdated` (`:109-123`). Any other key raises a `SearchFieldException`.
That becomes a validation message, which the controller ignores, so the
response is **HTTP 200 with an empty bundle** (Finding 9).

**Telling medication-list rows from prescriptions rows:** FHIR has no field
for this. `source_table` is never mapped (`parseOpenEMRRecord`, `:132-202`).
The usable proxies:

| Signal | `prescriptions` rows | `lists` rows | Reliable? |
|---|---|---|---|
| `intent` | `COALESCE(request_intent,'order')` (`PrescriptionService.php:156`) | `lists_medication.request_intent`, else `'plan'` (`:212`) | Heuristic only. Both columns are user-settable. Locally all 56 prescriptions have `request_intent` NULL, so they report `order`, and all 60 list rows report `plan`, because `lists_medication` is empty. |
| `medicationCodeableConcept.coding` (RxNorm) | present when `rxnorm_drugcode` is set (55 of 56 locally) | never, since `rxnorm_drugcode` is NULL (`:217`) | Not reliable: a prescription with no code looks like a list row. |
| `dispenseRequest.quantity`, `doseAndRate` | may be present | never, since quantity and size are NULL | Not reliable. |

**How status is derived:** the SQL computes it, and `populateStatus()` passes
it through (`FhirMedicationRequestService.php:508-516`):

- prescriptions (`PrescriptionService.php:180-184`): `end_date IS NOT NULL AND
  active='1'` → `completed`; `active='1'` → `active`; otherwise `stopped`.
- lists (`:234-238`): `enddate IS NOT NULL AND activity=1` → `completed`;
  `activity=1` → `active`; otherwise `stopped`. `outcome` is ignored.
- A future end date still yields `completed` (Finding 6). Locally the UNION
  returns: prescriptions 52 `completed` / 4 `active` / 0 `stopped`; lists 52
  `completed` / 7 `active` / 1 `stopped`.

**Can either card be reproduced from FHIR?**

- **Medications: no.** Neither `outcome` nor the `enddate` value is exposed:
  only `completed` status reveals that some end date exists. `begdate` is not
  exposed either. `authoredOn` for list rows is `lists.date`, not `begdate`
  (`:218`, `FhirMedicationRequestService.php:438-445`). A future-enddate row
  that the card shows appears as `completed`. An `outcome=1` row with no end
  date, which the card hides, appears as `active`. On today's local data,
  `intent=plan` combined with `status in (active, stopped)` happens to give
  the card's 8 rows, but that is a coincidence of the data, not a rule.
- **Prescriptions: partially.** Patient filtering is server-side and safe
  (`patient=`). `active` can be derived (`active`/`completed` ⇒ 1,
  `stopped` ⇒ 0). `date_modified` maps to `meta.lastUpdated` and
  `date_added` to `authoredOn`, both converted to UTC. Qty maps to
  `dispenseRequest.quantity`, but only when numeric, and truncated by
  `intval` (`:320-321`). Four things do not work:
  - Refills: `numberOfRepeatsAllowed` is **always 0** (`:319`). The value is
    wrong, not missing (Finding 4).
  - Details: `dosage` never reaches `dosageInstruction.text` when it is
    numeric. All 56 local prescriptions have a numeric `dosage` (Finding 7).
    `size` becomes an integer `doseQuantity`, with fractions truncated
    (`:291-292`). `form` is absent.
  - Drug: when an RxNorm code exists, `medicationCodeableConcept` has only
    `coding[].display`. That is the code-table description, or the `drug`
    text as a fallback (`PrescriptionService.php:349-359`). There is no
    `text`, so the display can differ from what the PHP card shows.
  - Filled: `authoredOn` is UTC ISO, while the card shows the raw local string.

  **Conclusion:** use `/api/prescription` for the Prescriptions card and
  `/api/patient/:pid/medication` for the Medications card. Use FHIR only to
  fill in `drug_dosage_instructions` for list rows, if that is wanted.

### Error shapes (what the SPA must handle)

| Endpoint | Condition | Status | Body |
|---|---|---|---|
| `/api/patient/:pid/medication` | no rows / unknown pid | 404 | empty |
| same | ACL denied | 403 | `AccessDeniedHttpException` → `{error, message, code}` (`RestConfig.php:192`, `ExceptionHandlerListener.php:50-55`) |
| `/api/prescription` | no rows | 200 | envelope with `data: []` |
| same | any query key that is not an unambiguous column (typos, `_limit`, `_count`, `_sort`, `_offset`) | **500** | `{error:"An error occurred", message:"Failed to execute statement. Error: … Statement: <full SQL>", code}` (Finding 2) |
| same | array-valued query param | 500 | `BadMethodCallException` message naming the key (`FhirSearchWhereClauseBuilder.php:40`) |
| `/api/prescription/:uuid` | uuid not in `prescriptions` (including every `lists`-branch uuid the collection returns) | 400 | `validationErrors` (`PrescriptionService.php:385-388`, Finding 10) |
| `/fhir/MedicationRequest` | unknown or invalid search param | **200** | empty `collection` bundle (Finding 9) |
| `/fhir/MedicationRequest/:uuid` | not found | 404 | `[]` |

---

## Purpose & lifecycle

Every request passes through the same stages. `apis/dispatch.php` handles it,
then the OAuth scope subscriber, then the route closure. The closure runs
`RestConfig::request_authorization_check()`, which calls
`AclMain::aclCheckCore()` with no access level (`RestConfig.php:180-194`).
Only then is the controller constructed. There is no session patient: every
patient identifier comes from the path or the query.

- `ListRestController` builds `ListService` in its constructor (`:59-62`).
  `ListService` is stateless.
- `PrescriptionRestController` builds `PrescriptionService` (`:29-32`). **The
  `PrescriptionService` constructor writes to the database.**
  `UuidRegistry::createMissingUuidsForTables()` backfills missing uuids in
  `prescriptions`, `patient_data`, `form_encounter`, `users` and `drugs`, in
  batched transactions, on every request, reads included
  (`PrescriptionService.php:41-42`; `UuidRegistry.php:229-234, 298-322`).
  `lists` is not in the list.
- `FhirMedicationRequestService` builds `PrescriptionService` lazily
  (`:565-571`), so FHIR reads trigger the same backfill.

## Layout / interface

### `PrescriptionService` (extends `BaseService`, table `prescriptions`)

| Method | Signature | Callers |
|---|---|---|
| `getAll` | `(array $search = [], $isAndCondition = true)` → `ProcessingResult` | `PrescriptionRestController::getAll` (`:156`), `FhirMedicationRequestService::searchForOpenEMRRecords` (`:212`) |
| `getBaseSql` | private, `(): string` | `getAll`, `getOne` |
| `getUuidFields` | `(): array` → `uuid, euuid, pruuid, drug_uuid, puuid, reporting_source_uuid` | `BaseService::createResultRecordFromDatabaseResult` (`BaseService.php:528-542`) |
| `createResultRecordFromDatabaseResult` | protected `($row)` | `getAll`, `getOne` |
| `getOne` | `(string $uuid): ProcessingResult` | `PrescriptionRestController::getOne` (`:129`) |
| `insert` | `(array $data): ProcessingResult` | `PrescriptionRestController::post` (`POST /api/prescription`) |
| `delete` | `(string $uuid): ProcessingResult` | `PrescriptionRestController::delete` (`DELETE /api/prescription/:uuid`) |

### `FhirMedicationRequestService` (extends `FhirServiceBase`)

Public: `parseOpenEMRRecord`, `createProvenanceResource`, `getProfileURIs`,
`getLastModifiedSearchField`, and one `populate*` method per element
(`populateReasonCodeAndReference`, `populateDosageInstruction`,
`populateDispenseRequest`, `populateMedicationAdherenceExtension`,
`populateReported`, `populateSubject`, `populateEncounter`,
`populateAuthoredOn`, `populateRequestor`, `populateMedication`,
`populateCategory`, `populateIntent`, `populateStatus`, `populateMeta`,
`populateId`, `populateNote`), plus getters and setters for its three
collaborators. Protected: `loadSearchParameters`, `searchForOpenEMRRecords`.
It does not override `searchForOpenEMRRecordsWithConfig`. That is why
`_count`/`_sort` are dropped (`FhirServiceBase.php:262-266, 313-316`).

### `ListService` (medication-relevant)

| Method | SQL | Caller for type `medication` |
|---|---|---|
| `getAll($pid, $list_type)` | `SELECT * FROM lists WHERE pid=? AND type=? ORDER BY date DESC` (`:50`) | `GET /api/patient/:pid/medication` |
| `getOne($pid, $list_type, $list_id)` | same plus `AND id=?` (`:181`) | `GET …/medication/:mid` |
| `validate($list)` | Particle validator: `title` 2-255, `type`, `pid` numeric, optional `begdate`/`enddate` as `Y-m-d H:i:s` (`:34-46`) | `post`, `put` |
| `insert($data)` | `INSERT INTO lists SET date=NOW(), activity=1, pid, type, title, begdate, enddate, diagnosis` (`:186-209`) | `POST …/medication` |
| `update($data)` | `UPDATE lists SET title, begdate, enddate, diagnosis WHERE id=?` (`:211-230`) | `PUT …/medication/:mid` |
| `delete($pid, $list_id, $list_type)` | `DELETE FROM lists WHERE pid=? AND id=? AND type=?` (`:232-237`) | `DELETE …/medication/:mid` |

## State

```text
PrescriptionService::$patientValidator   // readonly PatientValidator, used for uuid existence checks
FhirMedicationRequestService::$prescriptionService, $codeTypesService, $fhirOrganizationService  // lazy collaborators
ListService                              // no state
```

**Globals read:** `$_GET` (through `HttpRestRequest::getQueryParams()`, which
PHP has already parsed, `HttpRestRequest.php:199-202`; also read directly by
`RestControllerHelper::handleProcessingResult` to build links, `:232`);
`$_SERVER['REDIRECT_URL']` (bundle and link URLs); `OEGlobalsBag`
`site_addr_oath`; the session `authUser` (ACL check).
**Globals written:** none, although the service constructor writes to the database (uuid backfill).

## Logic

### `PrescriptionService::getBaseSql` (`:91-338`)

This is a `UNION` (distinct, not `UNION ALL`) of two branches, wrapped as
`combined_prescriptions` and left-joined to `list_options`
(`drug_route`, `drug_interval`, `drug_units`, `medication_adherence` ×2),
`patient_data` (`puuid`, `pid`), `form_encounter`, and `users` twice (NPI
holders only, for `pruuid` and `reporting_source_*`).

- **Prescriptions branch** (`:150-204`): `prescriptions` LEFT JOIN `drugs` on
  `drug_id`. The inline comment at `:192` notes that `drug_id` is usually 0,
  and locally it is 0 for all 56 rows. Also LEFT JOIN `lists_medication` on
  `prescription_id`. No filter: every patient, every `active` value.
  Selects `size AS prescription_drug_size` but not `refills` or `form`.
- **Lists branch** (`:206-260`): `lists` LEFT JOIN `users` by username, LEFT
  JOIN `lists_medication`, LEFT JOIN the first `issue_encounter` per
  (pid, list_id). `WHERE type='medication' AND
  lists_medication.prescription_id IS NULL`. It does not filter on
  `activity`, `outcome` or `enddate`. It does not select `outcome` or
  `begdate`.
- The outer SELECT lists `combined_prescriptions.date_added` twice
  (`:106`, `:114`). That is harmless in PHP, but the SQL cannot be wrapped
  as a derived table without editing it (MariaDB error 1060, seen during
  this audit).
- `end_date` is computed in both branches but not selected by the outer
  query. Only `status` carries it.
- The outer query has no `ORDER BY`, and neither caller adds one.

### `PrescriptionService::getAll` (`:56-85`)

1. If `$search['patient.uuid']` is set, the service validates that the uuid
   exists in `patient_data` and converts it to bytes (`:58-69`). This path is
   unreachable from HTTP (see Q2) and would fail in SQL if it were reached.
2. `FhirSearchWhereClauseBuilder::build($search)` turns each non-`ISearchField`
   primitive into `StringSearchField($key, $value, EXACT)` and emits
   `BINARY <key> = ?`. Nothing checks `$key` against a list of columns. This
   is the path Finding 1 is about.
3. `QueryUtils::sqlStatementThrowException()` runs the query. On failure it
   throws `SqlQueryException` with the full statement in the message
   (`QueryUtils.php:224-230`). This method catches nothing.
4. Each row goes through `createResultRecordFromDatabaseResult`.

### `createResultRecordFromDatabaseResult` (`:345-372`)

The parent converts uuid columns to strings. When `rxnorm_drugcode` is
non-empty, `addCoding()` looks up a description and falls back to `drug`
(`:349-360`). It then tests `$row['request_intent_title']`. The query never
selects that key (it selects `intent_title`), so for every prescriptions row
it adds `request_intent_title = 'Order'`, whatever the stored intent is, and
PHP raises an undefined-key warning. The `category_title` fix (`:366-369`)
can only fire if the stored title is `''`, because the SQL already
COALESCEs NULL to `'Home/Community'`.

### `getOne` (`:381-402`)

Validates the uuid against **`prescriptions` only** (`:385`), then runs
`getBaseSql() WHERE combined_prescriptions.uuid = ?`. A `lists`-branch uuid
fails validation with a 400. The comment at `:390-392` explains why the
service does not reuse `getAll(['_id'=>…])`.

### `insert` / `delete` (`:412-472`)

`insert` requires `drug` and `patient_id`, then builds the column list
through `BaseService::buildInsertColumns`. That method keeps only real
`prescriptions` columns (`BaseService.php:209-217`). It does not check that
`patient_id` exists. `delete` is a soft delete: `active = 0, date_modified =
NOW()`. Neither method is on the port's path. Both are reachable under
view-level `patients/med` (Finding 14).

### `FhirMedicationRequestService::parseOpenEMRRecord` (`:132-202`)

This calls the `populate*` methods in order. The ones that matter for parity:

- `populateStatus` / `populateIntent`: pass the SQL values through, falling
  back to `unknown` / `plan`.
- `populateMedication` (`:458-468`): uses the RxNorm coding when `drugcode`
  exists, otherwise sets `text = drug`.
- `populateDosageInstruction` (`:253-314`): exits early only if
  `drug_dosage_instructions`, `dosage` **and** `prescription_route` are all
  empty. `prescription_route` is never a key in the row: the SQL outputs
  `route`, `route_title` and `route_codes`. Text is
  `drug_dosage_instructions ?? dosage`, and it is used only when non-numeric.
  `??` does not fall back when the value is `''`. Timing text is
  `interval_notes ?? interval_title`, which differs from PHP's interval
  title. Dose quantity is `intval(size)` with `unit_title`.
- `populateDispenseRequest` (`:316-329`): `numberOfRepeatsAllowed =
  $dataRecord['refills'] ?? 0`, which is always 0. Quantity is
  `intval(quantity)`, labelled with the **dose** unit title.
- `populateAuthoredOn`: `date_added` converted to UTC. `populateMeta`:
  `date_modified` converted to UTC, or *now* when it is empty.
- `populateReported` / `populateRequestor`: fall back to the primary
  organization. When no primary organization exists, `populateReported` logs
  an error for each row (`:407-413`).

### `FhirMedicationRequestRestController::getAll` (`:205-220`)

Calls the service, wraps every result in a `FHIRBundleEntry`, and returns
`createBundle('Medication', …)` (bundle type `collection`, `total` = count).
It never checks `isValid()` or `hasInternalErrors()`, so validation and
internal errors both come back as a 200 with an empty bundle.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| `GET /api/patient/:pid/medication[/:mid]` | yes | `patients/med`, no level (`_rest_routes_standard.inc.php:299,320`) | No per-patient check, which is OpenEMR's model: any `patients/med` user can read any pid |
| `GET /api/prescription[/:uuid]` | yes | `patients/med` (`:665,669`) | PHP card uses `patients/rx` |
| `GET /fhir/MedicationRequest[/:uuid]`, user token | yes | `patients/med` (`:476,487`) | |
| same, patient token | yes | forced `puuidBind` (`:472-474, 483-485`, `ResourceServiceSearchTrait.php:91-96`) | no ACL call, by design |
| `POST/PUT/DELETE …/medication`, `POST/DELETE /api/prescription` | **partial** | `patients/med` **with no write level** (`:305-328, 672-679`) | view-level ACL plus a write scope is enough (Finding 14) |
| `PUT …/medication/:mid` row ownership | **missing** | `ListService::update` `WHERE id=?` only | Finding 13 |
| Query-string keys on `/api/prescription` | **missing** | no allow-list | Finding 1 |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `lists` (type medication) | yes | insert / update / hard delete | `ListService::getAll/getOne/insert/update/delete`; `getBaseSql` lists branch | no |
| `lists_medication` | yes | no (orphaned by `ListService::delete`) | `getBaseSql` (both branches) | n/a |
| `prescriptions` | yes | insert, soft delete, **uuid backfill on every construct** | `getBaseSql`, `insert`, `delete`, constructor | backfill: yes (batched); others: single statement |
| `patient_data`, `form_encounter`, `users`, `drugs` | yes | **uuid backfill on every construct** | constructor, `getBaseSql` joins | backfill: yes |
| `list_options` (`drug_route`, `drug_interval`, `drug_units`, `medication_adherence`) | yes | no | `getBaseSql` | n/a |
| `issue_encounter` | yes | no | `getBaseSql` lists branch | n/a |
| `uuid_registry` | yes | yes (backfill) | constructor | yes |
| code tables (RxNorm description lookup) | yes | no | `BaseService::addCoding` | n/a |

## Cross-links

- **Called by:** routes above; the PHP dashboard does **not** use this unit
  (`ui/DEMOGRAPHICS-PART2-CARDS.md` §Medications / §Prescriptions).
- **Calls into:** `FhirSearchWhereClauseBuilder`, `SearchFieldStatementResolver`,
  `QueryUtils`, `UuidRegistry`, `PatientValidator`, `CodeTypesService`,
  `FhirOrganizationService`, `FhirProvenanceService`, `RestControllerHelper`.
- **Related:** `api/CLINICAL-CARDS.md` DB-05/DB-06 (corrections below);
  `ui/PRESCRIPTION-TEMPLATES.md` (Details composition); `ui/README.md` U-3
  (dead `active` filter); `modules/LEGACY-ROUTER-AND-LISTS.md` Finding 3
  (the same "no write level" ACL pattern), Finding 6 (`lists_touch`);
  `modules/ALLERGY-SERVICES.md` / `CONDITION-SERVICES.md` (same
  `ExceptionHandlerListener` leak pattern).

### Corrections to earlier phases

| Earlier doc said | This audit found | Evidence |
|---|---|---|
| `/api/patient/:pid/medication` returns `drug_dosage_instructions` (`api/CLINICAL-CARDS.md:269`, `ui/CARD-TEMPLATES.md:500`) | It does not. The query is `SELECT * FROM lists`, and that column lives in `lists_medication`. | `ListService.php:50`; local schema |
| Medications title is field `drug` on standard REST (`CLINICAL-CARDS.md:268`) | `title` on `/api/patient/:pid/medication`; `drug` only on `/api/prescription` | `ListService.php:50`, `PrescriptionService.php:209` |
| Prescriptions card: "`GET /api/prescription` rows … for the patient" (`DEMOGRAPHICS-PART2-CARDS.md:619`) | The endpoint has no patient contract. It returns every patient's rows unless the client passes the accidental `pid` column filter. | Q2 |
| `refills` never selected (`CLINICAL-CARDS.md:273`) | **Confirmed.** On FHIR it is not merely missing: it is reported as `0`. | `PrescriptionService.php:95-188`, `FhirMedicationRequestService.php:319` |
| FHIR Details: `dosageInstruction.text` carries `dosage` (`CLINICAL-CARDS.md:271`) | Only when it is non-numeric. Every local prescription's dosage is numeric, so none carries it. | `FhirMedicationRequestService.php:264-266` |

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Security (SQL injection) | **High (verified)** | `GET /api/prescription` passes query-string parameter **names** into the SQL WHERE clause as column identifiers, with no allow-list. Values are bound; names are not. Impact: an authenticated caller with `patients/med` and a prescription scope can change the structure of the query, not just filter it. | `PrescriptionRestController.php:154-156` → `PrescriptionService.php:73-75` → `FhirSearchWhereClauseBuilder.php:37-38` → `SearchFieldStatementResolver.php:289-293` | Map query keys through a fixed search-definition allow-list (as the FHIR path does) and reject unknown keys with 400 |
| 2 | Security (information disclosure) | Medium | A failed query on this endpoint returns a 500 whose `message` holds the DB error and the full SQL statement. Any unknown key triggers it, including `_limit`/`_count`/`_sort`. Impact: discloses schema and query structure to API clients, which helps Finding 1. | `QueryUtils.php:226-230`; `ExceptionHandlerListener.php:50-55` | Return a generic body; keep statement and DB error in the server log only |
| 3 | Security (data minimization) / contract gap | Medium | `/api/prescription` has no patient parameter in its contract. The default call returns every patient's prescriptions and medication-list rows (116 rows across 12 patients locally). The only working patient filter is an accidental column (`pid`). Impact: a client showing one patient pulls practice-wide medication data. | `PrescriptionService.php:56-85, 308-313`; local SQL | Add a required, allow-listed patient parameter (uuid) to the standard route |
| 4 | Bug (clinical data) | **High (verified)** | `refills` is never selected, so FHIR `dispenseRequest.numberOfRepeatsAllowed` is **always 0**: a wrong value, not an absent one. `/api/prescription` omits refills entirely. | `PrescriptionService.php:95-148, 150-188` (no `refills`); `FhirMedicationRequestService.php:319` | Select `prescriptions.refills` (NULL for list rows); omit the element when it is NULL |
| 5 | Half-implemented | Medium | `/api/patient/:pid/medication` does not join `lists_medication` (no `drug_dosage_instructions`) and orders by creation `date` DESC instead of `begdate`. | `ListService.php:50` | Reuse `PatientIssuesService::search` for this route |
| 6 | Bug | Medium | `status` is `completed` whenever an end date is set and the row is active, **even if the end date is in the future**. List rows ignore `outcome`. FHIR status therefore disagrees with the Medications card and with clinical meaning (52 of 56 Rx and 52 of 60 meds are `completed` locally). | `PrescriptionService.php:180-184, 234-238` | Compare the end date with the current date; map `outcome` |
| 7 | Bug | Medium | `dosageInstruction.text` drops a numeric `dosage` (all 56 local rows), and `??` does not fall back when `drug_dosage_instructions` is `''`. The early-exit check reads a key (`prescription_route`) that never exists. | `FhirMedicationRequestService.php:255, 264-266` | Use an empty-aware fallback; build the text from `size`/`unit`/`dosage` when it is numeric |
| 8 | Bug | Medium | `/api/patient/:pid/medication` returns **404 with an empty body** for a patient with no medications. An unknown `pid` looks the same. The collection is a bare array, not the standard envelope. | `ListRestController.php:109-113`; `RestControllerHelper.php:158-166` | Return 200 `[]` for an empty collection |
| 9 | Bug | Medium | FHIR `getAll` ignores `ProcessingResult` errors, so an unknown or malformed search param returns **200 with an empty bundle**. `_count`/`_sort` are accepted and ignored, with no paging links; the bundle type is `collection`. | `FhirMedicationRequestRestController.php:205-220`; `FhirServiceBase.php:262-266, 313-316` | Use `handleFhirProcessingResult`-style error mapping; implement `searchForOpenEMRRecordsWithConfig` |
| 10 | Bug | Low | `GET /api/prescription/:uuid` validates the uuid against `prescriptions` only, so every `lists`-branch uuid the collection returns fails with a 400. | `PrescriptionService.php:385-388` | Validate against the UNION, or document that the collection mixes resources |
| 11 | Bug | Low | `createResultRecordFromDatabaseResult` reads the never-selected `request_intent_title`. Every prescriptions row gains a constant `request_intent_title: "Order"` plus an undefined-key warning. The `category_title` fix is almost always a no-op. | `PrescriptionService.php:363-369` vs `:102` | Read `intent_title`; drop the patch |
| 12 | Dead code | Low | The `patient.uuid` branch cannot be reached from HTTP (PHP rewrites `.` in query keys), and it names a column the joined subquery does not have. | `PrescriptionService.php:58-69, 308-313` | Replace it with a real `puuid` filter |
| 13 | Security (authorization) | Medium | `PUT /api/patient/:pid/medication/:mid` updates `lists` `WHERE id=?` only. Path `pid` and `type` are ignored. Impact: a client with medication write scope can modify any patient's issue row of any type (allergy, problem). | `ListService.php:211-229` | Add `pid` and `type` to the `WHERE` clause |
| 14 | Security (authorization) | Medium | Write routes (`POST/PUT/DELETE …/medication`, `POST/DELETE /api/prescription`) check `patients/med` with no `write` level. Impact: view-only ACL users with a write scope can change medication data. | `_rest_routes_standard.inc.php:305-328, 672-679`; `RestConfig.php:180-187` | Pass the `write`/`addonly` ACL level on mutating routes |
| 15 | Smell (write on read path) | Low | Constructing `PrescriptionService` backfills uuids across five tables in batched transactions on **every** request, GETs included. | `PrescriptionService.php:41-42`; `UuidRegistry.php:229-234, 298-322` | Move the backfill to install/upgrade |
| 16 | Bug | Low | FHIR quantity and dose values are `intval`-truncated (fractional size or quantity becomes an integer), and the dispense quantity carries the **dose** unit. | `FhirMedicationRequestService.php:291-293, 320-326` | Use decimal quantities; use a dispense unit |
| 17 | Bug (latent) | Low | `ListService::getAll` calls `uuidToString()` on `lists.uuid` unguarded. A row with a NULL uuid would throw, giving a 500. `lists` is not in any backfill here. 0 such rows locally. | `ListService.php:56` | Guard for NULL, or backfill `lists` |
| 18 | Bug | Low | `DELETE …/medication/:mid` hard-deletes the `lists` row and leaves its `lists_medication` row orphaned. | `ListService.php:232-236` | Soft-delete, or cascade |

High rows 1 and 4 were re-read at the cited lines after drafting. Both hold as
stated.

## Port notes

- **Must survive:**
  - The Medications filter `outcome != 1 && (!enddate || enddate > now)`,
    evaluated in server-local time, with the result sorted by `begdate` ASC
    (NULLs first). The client does all of this on the output of
    `/api/patient/:pid/medication`.
  - The Prescriptions show-all decision. Sort `active` DESC, `date_modified`
    DESC (NULLs last), `date_added` DESC, plus a documented stable tiebreak.
    Show "Filled" as the raw `date_added` string.
  - Details = `prescription_drug_size` + `unit_title` + `dosage`
    (+ `" in <form> <interval_title>"` when applicable). Rows with `form` set
    are a known gap.
- **Must not survive:**
  - Fetching `/api/prescription` without a patient filter.
  - Treating HTTP 404 from the medication route as an error.
  - Treating FHIR `numberOfRepeatsAllowed` as the refill count.
  - Using FHIR `status` as the Medications "active" rule.
  - Any client code that sends free-form keys to `/api/prescription` (send
    only `pid` and `source_table`).
  - Every patient-scoped response must be checked against the requested
    patient (`puuid`) before rendering (see U-11).
- **Not available via API:**
  - Refills (DB-06).
  - `form` label in Details.
  - `drug_dosage_instructions` for Medications rows, except through the FHIR
    or `/api/prescription` lists-branch join, and never for rows linked to a
    prescription.
  - `lists_touch` ("None" vs "Nothing Recorded").
- **Open questions:**
  - Will the owner accept the undocumented `pid` filter on `/api/prescription`
    until an allow-listed patient parameter exists, or should the port wait
    for that change? The port's no-backend-changes rule means the `pid`
    filter is the only server-side option.
  - Should Medications show `drug_dosage_instructions` through the FHIR join
    (one extra call), or accept title-only rows? Locally the question is
    moot: `lists_medication` is empty.
  - Which placeholder should the Refills column show: blank, "n/a", or a
    hidden column?
  - The SPA needs the integer `pid` for the medication route and the `pid`
    filter. Confirm the port's patient-resolution step returns it
    (`modules/PATIENT-SERVICES.md`).
