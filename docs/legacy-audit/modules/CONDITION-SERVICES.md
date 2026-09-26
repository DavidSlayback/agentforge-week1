# Medical Problems module cluster (DB-04) — ConditionService, FhirConditionService, PatientIssuesService, ConditionRestController

This is the module-layer read/write path behind the Medical Problems card
(DB-04). It covers the standard-REST stack the port must actually call
(`ConditionRestController` → `ConditionService`, table `lists`), the
FHIR stack (`FhirConditionService` → three mapped category services →
raw SQL, same table), and `PatientIssuesService` — the service the PHP
card itself uses, which turns out **not to be reachable from any API
route**. All four classes read/write the same `lists` table with
`type='medical_problem'`, but each has its own SQL, its own filter, and
its own ORDER BY (or lack of one). The gap between what the PHP card
shows and what a client can get from the API is entirely in this
divergence, not in any single bug.

**Source:**
- `src/Services/ConditionService.php` · 326 lines (standard-REST service; PROJECT-MAP/CLINICAL-CARDS cited 286 — corrected here)
- `src/RestControllers/ConditionRestController.php` · 308 lines
- `src/Services/FHIR/FhirConditionService.php` · 148 lines (PROJECT-MAP cited 134 — corrected)
- `src/Services/FHIR/Condition/FhirConditionProblemListItemService.php` · 292 lines
- `src/Services/FHIR/Condition/FhirConditionHealthConcernService.php` · 324 lines
- `src/Services/FHIR/Condition/FhirConditionEncounterDiagnosisService.php` · 399 lines
- `src/Services/FHIR/Condition/Trait/FhirConditionTrait.php` · 256 lines
- `src/RestControllers/FHIR/FhirConditionRestController.php` · 222 lines (`@deprecated`, dead — see Finding 9)
- `src/Services/PatientIssuesService.php` · 334 lines (PROJECT-MAP cited 300 — corrected; read paths only per brief, but write paths were read incidentally and are noted)
- `src/RestControllers/FHIR/FhirGenericRestController.php` · 150 lines (shared dispatcher for `/fhir/Condition`, read for search-param wiring)
- `src/Services/FHIR/FhirServiceBase.php` · 335 lines, `src/Services/Search/FhirSearchWhereClauseBuilder.php` · 68 lines, `src/Services/Search/SearchFieldStatementResolver.php` (read for the `clinical-status` question)

No version headers on any of these files. Git SHA `44e237a`, worktree `agentforge/w2-dashboard`, this checkout.
**Audited by:** tier 2 · confidence high · escalated: yes on two items (see Findings 1, 6)

## Purpose & lifecycle

Three independent request paths converge on the `lists` table:

1. **Standard REST, patient-scoped list** — `GET /api/patient/:puuid/medical_problem`
   → route closure (`apis/routes/_rest_routes_standard.inc.php:221-224`) →
   `ConditionRestController::getAll(['puuid' => $puuid])` →
   `ConditionService::getAll()` → `ConditionService::search()`. This is
   **the endpoint the port must call** for DB-04 (see "API contract" below).
2. **Standard REST, unscoped list/read** — `GET /api/medical_problem[/:muuid]`
   (`:209-219`), same controller/service, no patient binding — returns
   across all patients the caller can see (see Finding 6).
3. **FHIR** — `GET /fhir/Condition[/:uuid]` (`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:167-175`)
   → `FhirGenericRestController` (ACL `patients/med` added via
   `addAclRestrictions`) → `FhirConditionService::getAll()`, which is a
   **fan-out dispatcher**, not a single query: it holds three "mapped"
   sub-services (`FhirConditionEncounterDiagnosisService`,
   `FhirConditionProblemListItemService`, `FhirConditionHealthConcernService`,
   registered in that order in the constructor,
   `FhirConditionService.php:49-52`) and either narrows to the services
   matching a `category` search param, or — if none is given — **queries
   all three and merges the results** (`FhirConditionService.php:108-111`,
   Finding 3). Each sub-service builds its **own** raw SQL against `lists`
   (none of them call the `ConditionService` instance they hold — Finding 9).

`PatientIssuesService` — the class the PHP Medical Problems card actually
calls (`demographics.php:1142`, confirmed in `ui/DEMOGRAPHICS-PART2-CARDS.md`)
— has **no caller anywhere in `src/RestControllers` or `apis/routes`**
(confirmed by `grep -rln PatientIssuesService src/RestControllers apis/routes`
→ no hits). Its only other caller in `src/` is
`src/Services/Cda/CdaTemplateImportDispose.php` (CDA import, not a read
API). This reconfirms Phase 1's finding and closes the question: **there
is no way to get the PHP card's exact query (LEFT JOIN `lists_medication`,
`ORDER BY lists.begdate`) from the API.** A port must use `ConditionService`
(standard REST) or the FHIR problem-list-item service, both of which query
`lists` differently (see "Data touches").

## Layout / interface

**`ConditionService`** (`src/Services/ConditionService.php`)
- `search(array $search, $isAndCondition = true): ProcessingResult` — the query, line 42-94
- `getAll(array $search = [], $isAndCondition = true, $puuidBind = null): ProcessingResult` — line 121-179, wraps `search()`, validates `puuid`/`condition_uuid` as uuids first
- `getOne($uuid, $puuidBind = null): ProcessingResult` — line 188-195
- `insert($data)`, `update($uuid, $data)`, `delete($puuid, $uuid)` — lines 205-325, all force `type='medical_problem'`
- `getUuidFields(): array` — line 96-99

**`ConditionRestController`** (`src/RestControllers/ConditionRestController.php`)
- `getOne($uuid)` — line 74-83, 404 if empty, else 200
- `getAll($search = [])` — line 190-194, **ignores its `$search` default entirely when called by the collection route** (see below)
- `post($puuid, $data)`, `put($puuid, $uuid, $data)`, `delete($puuid, $uuid)` — lines 225-307, whitelist `title`, `begdate`, `enddate`, `diagnosis` (`WHITELISTED_FIELDS`, line 38-43)

**`FhirConditionService`** (`src/Services/FHIR/FhirConditionService.php`)
- `getAll($fhirSearchParameters, $puuidBind = null): ProcessingResult` — line 82-120, the fan-out described above
- `loadSearchParameters()` — line 68-75: `patient`, `_id`, `_lastUpdated` only (no `category` in the FHIR-parameter map itself — `category` is read directly off the raw `$fhirSearchParameters` array before translation, line 93-107, so it bypasses the normal `ServiceField` mapping)

**`FhirConditionProblemListItemService`** — `searchForOpenEMRRecords()` line 115-206 builds its own SQL (below); `loadSearchParameters()` line 94-106 adds `code`, `category`, `clinical-status`, `verification-status`, `onset-date`.

**`FhirConditionHealthConcernService`** — same shape, `type='health_concern'`, `subtype` search field instead of `category`/`clinical-status` (no `clinical-status` param registered here at all).

**`FhirConditionEncounterDiagnosisService`** — same shape, `type='medical_problem'` **INNER JOIN**ed to `issue_encounter`+`form_encounter` (so only rows linked to an encounter).

**`PatientIssuesService`** (read paths) — `search($search, $isAndCondition = true): ProcessingResult` (line 171-222, the PHP card's own query), `getOneById($issueId)`, `getAllIssues()`, `getActiveIssues(int $pid): ProcessingResult` (line 89-100, dead — see Finding 8).

## State

No module-level mutable state in any of these classes; each is stateless
per request except the constructed collaborator objects (`$conditionValidator`,
the three mapped `Fhir*` sub-service instances held by `FhirConditionService`,
and the never-invoked `$conditionService` held by two of the sub-services —
Finding 9). No globals read or written by any class in this cluster
(no `$GLOBALS`, no `$_SESSION`) — session/patient context arrives already
resolved as `$puuidBind` / `puuid` search values from the caller.

## Logic

### `ConditionService::search()` (`:42-94`) — the standard-REST query

```php
SELECT lists.*, lists.pid AS patient_id, lists.title,
    encounter.uuid as encounter_uuid, patient.puuid, patient.patient_uuid,
    condition_ids.condition_uuid, condition_ids.last_updated_time,
    verification.title as verification_title,
    provider.provider_id, provider.provider_npi, provider.provider_uuid, provider.provider_username
FROM lists
    INNER JOIN (SELECT lists.uuid AS condition_uuid, lists.modifydate AS last_updated_time FROM lists) condition_ids
        ON lists.uuid = condition_ids.condition_uuid
    LEFT JOIN list_options AS verification ON verification.option_id = lists.verification AND verification.list_id = 'condition-verification'
    RIGHT JOIN (SELECT patient_data.uuid AS puuid, patient_data.pid, patient_data.uuid AS patient_uuid FROM patient_data) patient
        ON patient.pid = lists.pid
    LEFT JOIN issue_encounter AS issue ON issue.list_id = lists.id
    LEFT JOIN form_encounter AS encounter ON encounter.encounter = issue.encounter
    LEFT JOIN (SELECT id AS provider_id, uuid AS provider_uuid, npi AS provider_npi, username AS provider_username FROM users) provider
        ON lists.user = provider.provider_username
```
then `type='medical_problem'` is force-added as an EXACT `StringSearchField`
(`:80`) and the caller's search array becomes the rest of the WHERE clause
via `FhirSearchWhereClauseBuilder::build()`. **No `ORDER BY` at all** — row
order is whatever MySQL returns for this 5-way join, which is not the
`begdate ASC` order the PHP card uses (via `PatientIssuesService`, unreachable
here). **No `enddate`/`outcome`/`activity` filter** — this matches Phase 1's
claim exactly: the endpoint returns every `medical_problem` row for the
patient, resolved or not, ended or not. Confirmed locally: pid 13 has 39
rows in `lists` (`type='medical_problem'`), and this query returns all 39
(read-only SQL, see "Verification" below).

`createResultRecordFromDatabaseResult()` (`:101-108`) runs every row through
`addCoding()` (`BaseService.php:551-573`) if `diagnosis` is non-empty: it
splits on `;`, parses each `SYSTEM:code` token (e.g. `SNOMED-CT:40055000`,
confirmed format via read-only SQL on pid 13) through `CodeTypesService`,
and replaces the scalar `diagnosis` string with a keyed array
`{code, description, code_type, system}`. **This coding step is unique to
`ConditionService`** — see Finding 1 (FHIR problem-list items never get it).

The `issue`/`encounter` LEFT JOINs are per-row, not aggregated: a problem
linked to more than one `issue_encounter` row would repeat once per link.
Not observable on pid 13 (0 `medical_problem` rows are linked to any
encounter there — see "Verification"), but nothing in the query de-dupes
by `lists.id`/`uuid`, so it is a real risk for other patients (Finding 5,
not verified with data).

### `ConditionRestController::getAll()` and the two GET routes (Finding 2)

The class method signature is `getAll($search = [])` and its OpenAPI
annotations (`:88-189`) advertise `puuid`, `condition_uuid`, `title`,
`begdate`, `enddate`, `diagnosis` as query parameters on both
`GET /api/medical_problem` and `GET /api/patient/{puuid}/medical_problem`.
**Neither route closure forwards the request's query string.** Reading the
route file directly (`_rest_routes_standard.inc.php:209-224`):

```php
"GET /api/medical_problem" => function (HttpRestRequest $request) {
    RestConfig::request_authorization_check($request, "encounters", "notes");
    $return = (new ConditionRestController())->getAll();      // no args at all
    return $return;
},
"GET /api/patient/:puuid/medical_problem" => function ($puuid, HttpRestRequest $request) {
    RestConfig::request_authorization_check($request, "encounters", "notes");
    $return = (new ConditionRestController())->getAll(['puuid' => $puuid]);   // only puuid
    return $return;
},
```
`$request` is used only for the ACL check; `$request->getQueryParams()`
(or `->query->all()`) is never read. So `title`, `begdate`, `enddate`,
`diagnosis`, `condition_uuid` (on the collection route) are **documented
but dead** — a client cannot filter this endpoint by anything but `puuid`
(and, on the single-item route, `muuid`). This is the same shape as the
neighboring Allergy routes (`GET /api/allergy`, `GET /api/patient/:puuid/allergy`,
`:253-269`), so it is a pattern in this file, not unique to Condition.
There is also **no paging/`_sort`/`_count` support anywhere in this call
chain** — `ConditionService::search()` has no `LIMIT`/`OFFSET` handling and
the route never passes any.

### ACL mismatch on the exact endpoint the port needs (Finding 1, provisional High, Escalate)

`GET /api/patient/:puuid/medical_problem` — the endpoint that reproduces the
card — is gated by `RestConfig::request_authorization_check($request,
"encounters", "notes")` (`_rest_routes_standard.inc.php:222`), **not**
`patients/med`. Every other in-scope card's list endpoint uses `patients/med`
(Allergy `:254`; Medication `ListRestController` route; FHIR Condition
`patients/med` via `addAclRestrictions`, route `:169`). The PHP card itself
checks `aclCheckIssue('medical_problem')`, which resolves to `patients|med`
locally (`issue_types.aco_spec`, confirmed by Phase 2 read-only SQL,
`ui/DEMOGRAPHICS-PART2-CARDS.md:140`). Only the single-item routes
(`GET .../medical_problem/:muuid`, `POST`, `PUT`, `DELETE`,
`:226-251`) use `patients/med`. Net effect, both directions:
- A user with `patients/med` but not `encounters/notes` sees the card in
  the UI but **cannot** call the one list endpoint that reproduces it.
- A user with `encounters/notes` but not `patients/med` **can** list every
  patient's medical problems via `GET /api/medical_problem` (see Finding 6)
  or a specific patient's via the puuid route, without the ACL the UI
  requires to show the same data.
This is provisional (ACL semantics of `encounters/notes` vs `patients/med`
in this ACL system are not further traced here) — **Escalate: yes.**

### `FhirConditionService::getAll()` merges three categories by default (Finding 3)

```php
// FhirConditionService.php:93-110 (condensed)
if (isset($fhirSearchParameters['category'])) {
    $services = $this->getServiceListForCategory(new TokenSearchField('category', explode(",", $category)));
}
if (empty($services)) {
    $services = $this->getMappedServices();   // ALL THREE: EncounterDiagnosis, ProblemListItem, HealthConcern
}
$fhirSearchResult = $this->searchServices($services, $fhirSearchParameters, $puuidBind);
```
Without a `category` parameter, `GET /fhir/Condition?patient=<puuid>` queries
**all three** mapped services and unions the results
(`MappedServiceTrait::searchServices()`, each sub-service's `getAll()` called
in turn, `ProcessingResult`s merged). This means an un-filtered
`/fhir/Condition` call returns problem-list items **and** health concerns
**and** encounter-linked diagnoses together — a materially broader set than
the Medical Problems card (which is `type='medical_problem'` only, whether
or not it's linked to an encounter). **This corrects
`api/CLINICAL-CARDS.md`'s DB-04 section**, which describes the FHIR default
as "problem-list-item category, the default when no category param is
given" — that is not what the code does; problem-list-item is simply the
category whose SQL doesn't visibly diverge on the current dataset (see
"Verification": pid 13 has 0 `health_concern` rows and 0 encounter-linked
`medical_problem` rows, so the merged result happens to equal the
problem-list-item-only result there). **The port must pass
`category=http://terminology.hl7.org/CodeSystem/condition-category|problem-list-item`
explicitly**; relying on the unfiltered default is not equivalent to the
PHP card, and the divergence is invisible on this dataset only by
coincidence.

### `FhirConditionProblemListItemService::searchForOpenEMRRecords()` (`:115-206`) — the query the port should use

```sql
SELECT l.id, l.uuid, l.pid, l.condition_date, l.modifydate, l.type, l.title,
       l.begdate, l.enddate, l.diagnosis, l.activity, l.comments, l.occurrence,
       l.outcome, l.verification, pd.puuid, l.last_updated_time
FROM (SELECT id, uuid, pid, date AS condition_date, modifydate, type, title,
             begdate, enddate, diagnosis, activity, comments, occurrence,
             outcome, verification, COALESCE(modifydate, date) AS last_updated_time
      FROM lists) l
INNER JOIN (SELECT uuid AS puuid, pid AS patient_id FROM patient_data) pd ON l.pid = pd.patient_id
LEFT JOIN (SELECT list_id, pid AS issue_encounter_pid FROM issue_encounter) ie
    ON l.id = ie.list_id AND l.pid = ie.issue_encounter_pid
```
with `type='medical_problem'`, `activity='1'`, and `list_id` (from the `ie`
join) `IS NULL` added as EXACT/MISSING search fields (`:122-126`) — i.e.
**not linked to any encounter**. No `ORDER BY`. Row order is therefore also
undefined and does not match the card's `begdate ASC`.

Locally (read-only SQL, pid 13): all 39 `medical_problem` rows have
`activity=1` and none are linked via `issue_encounter`
(`linked_to_encounter_count = 0`), so this query returns all 39 rows — same
count as the unfiltered standard-REST path, for a different reason (here
because the `activity=1`/no-encounter-link filter happens not to exclude
anything on this data, not because there is no filter).

### `clinical-status` search param — confirmed, not just inferred, to error (Finding 4)

`FhirConditionProblemListItemService::loadSearchParameters()` (`:102`) maps
FHIR's `clinical-status` to OpenEMR column `clinical_status`. Tracing the
column through the actual query:
- `DESCRIBE lists` (read-only SQL) has **no `clinical_status` column** —
  status is computed in PHP, per-row, after the query returns
  (`computeClinicalStatus()`, `FhirConditionTrait.php:102-118`).
- Neither the `l` subselect, the `pd` (`patient_data`) subselect, nor the
  `ie` (`issue_encounter`) subselect in `searchForOpenEMRRecords()` (above)
  selects or aliases a `clinical_status` column.
- `SearchFieldStatementResolver::resolveTokenField()` (`:210-260`) emits
  the field name **unqualified and verbatim** as the SQL column reference
  (e.g. `clinical_status IN (?)` or the `IS NULL`/`IS NOT NULL` MISSING
  forms, `:224-233`) — there is no column-existence check before the
  fragment is spliced into the WHERE clause by
  `FhirSearchWhereClauseBuilder::build()`.
- The query runs through `QueryUtils::sqlStatementThrowException()`
  (`searchForOpenEMRRecords`, `FhirConditionProblemListItemService.php:187`),
  which throws on a SQL error rather than returning a `ProcessingResult`
  with a validation message.

**Confirmed: `GET /fhir/Condition?patient=<puuid>&clinical-status=active`
would issue a query referencing a column, `clinical_status`, that does not
exist anywhere in the query or the underlying table, and MySQL would
reject it** ("Unknown column 'clinical_status' in 'where clause'"). This
was not executed against the live API (per the brief's constraints — no
OAuth2 client exists yet), but the SQL was reconstructed and the column's
absence confirmed by `DESCRIBE lists` and by reading every table/subselect
in the query; there is no code path that could make `clinical_status` a
valid column reference here. `FhirServiceBase::getAll()`
(`:288-294`) only catches `SearchFieldException`, not a SQL exception, so
this would propagate as an uncaught exception past this layer — the
resulting HTTP status/body was not traced further (open question, not the
framework's normal 400 validation-error shape).
`FhirConditionEncounterDiagnosisService` avoids this entirely: its
`clinical-status`/`verification-status` search parameters are commented out
(`:91-93`), explicitly marked TODO. `FhirConditionHealthConcernService`
never registers `clinical-status` at all. **The bug is specific to the
problem-list-item service** — the one the port would use for DB-04.

### `_sort`/`_count`/`_offset` on `/fhir/Condition` are accepted but do nothing (Finding 7)

`FhirServiceBase`'s generic `createOpenEMRSearchParameters()` (used by every
FHIR resource, including each of the three Condition sub-services) parses
`_sort`, `_count`, `_offset` out of the FHIR query string into an internal
`_config` array (`ResourceServiceSearchTrait.php:53-64`, confirmed by
`grep`). When `_config` is set, `FhirServiceBase::getAll()` (`:262-266`)
calls `searchForOpenEMRRecordsWithConfig($oeSearchParameters, $searchConfig)`
instead of the plain search method. **None of the three Condition
sub-services override `searchForOpenEMRRecordsWithConfig()`** — only
`searchForOpenEMRRecords()` is overridden in each. The inherited default
(`FhirServiceBase.php:313-316`) is:
```php
protected function searchForOpenEMRRecordsWithConfig(array $openEMRSearchParameters, SearchQueryConfig $searchConfig): ProcessingResult
{
    return $this->searchForOpenEMRRecords($openEMRSearchParameters);
}
```
— the `$searchConfig` (sort order, limit, offset) is accepted as a
parameter and then silently dropped. A client that sends
`_sort=-onset-date&_count=10` gets no error and no sorting/limiting; it
gets every matching row, unsorted, exactly as if the params were absent.
Additionally, `FhirConditionService::getAll()` (the outer dispatcher) never
calls `createOpenEMRSearchParameters()` itself — it passes the raw FHIR
parameters straight to each sub-service's own `getAll()`, which does the
`_config` translation independently per sub-service; if a bundle result
paginated per-service made it back to the caller it was not confirmed here
(each sub-service's own `ProcessingResult::setPagination()` call happens
inside its own `getAll()`, but the outer `searchServices()` in
`MappedServiceTrait` merges results via `addProcessingResult()` — whether
pagination metadata survives that merge was not traced; open question).

### Diagnosis coding is dropped on the FHIR problem-list-item path (Finding 1 — data fidelity, provisional High, Escalate)

`ConditionService::createResultRecordFromDatabaseResult()` runs `diagnosis`
through `addCoding()` (see above), turning `SNOMED-CT:40055000` into a
structured `{code, description, code_type, system}` array. **This step
never happens for FHIR problem-list items.**
`FhirConditionProblemListItemService::searchForOpenEMRRecords()` builds its
own SQL and selects `l.diagnosis` as a raw column (see the query above);
the per-row loop (`:190-201`) converts `uuid`/`puuid` to string form and
computes `clinical_status`/`verification_status`/`category`, but never
touches `diagnosis`. It stays a plain string. Then
`FhirConditionTrait::populateCode()` (`:136-158`):
```php
if (!empty($dataRecord['diagnosis']) && is_array($dataRecord['diagnosis'])) {
    // build a coded CodeableConcept from $dataRecord['diagnosis']
} else {
    // Fallback to title if no structured diagnosis
    $diagnosisCode->setText($dataRecord['title'] ?? 'Problem');
}
```
Because `diagnosis` is always a string here, **the `is_array()` check is
always false**, and `Condition.code` is **always** the title-text fallback
— the coded ICD-10/SNOMED diagnosis is never present on
`/fhir/Condition` for problem-list items, no matter what is stored in
`lists.diagnosis`. Confirmed live on pid 13: all 39 `medical_problem` rows
have a non-empty `diagnosis` value (`SNOMED-CT:<code>` format, read-only
SQL) that the standard-REST endpoint returns as a coded structure and the
FHIR endpoint silently discards to plain text on every one of them. This
is not a filtering/parity question like the others in this doc — it is a
loss of clinically coded data on the primary interoperability surface, for
every patient, on the exact category (`problem-list-item`) the port needs.
Provisional High; **Escalate: yes** (data-integrity impact on the FHIR
surface, not confirmed against a running server).

### `PatientIssuesService::getActiveIssues()` is dead, and would be wrong if used (Finding 8)

`getActiveIssues(int $pid)` (`:89-100`) builds a `CompositeSearchField` with
`isAnd=false` (OR) combining "no `enddate`" and "`enddate` in the future" —
correctly mirroring half of `filterActiveIssues()`. But it **never adds an
`outcome != 1` check**, so even if it were wired up it would show resolved-
but-not-yet-ended issues that the PHP card hides. `grep -rn getActiveIssues`
across `src/`, `interface/`, `apis/` finds only its own declaration — no
caller anywhere. Dead code that also doesn't fully replicate the rule it
appears to implement.

### `FhirConditionRestController` is fully dead (Finding 9)

Marked `@deprecated use FhirGenericRestController` in its own docblock
(`:26`). `grep -rln FhirConditionRestController` across the tree (excluding
`.phpstan/baseline/*`, which only records pre-existing suppressed type
errors for the file, not a route reference) finds **no route file, no
controller, nothing** that instantiates it. The live FHIR Condition path is
entirely `FhirGenericRestController` + `FhirConditionService`
(`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:167-175`). Related smell:
`FhirConditionProblemListItemService` and `FhirConditionHealthConcernService`
both construct a `ConditionService` in their constructors
(`new ConditionService()`, lines 64 and 75 respectively) and expose
`get`/`setConditionService()`, but **neither class ever calls a method on
that object** — `searchForOpenEMRRecords()` in both builds and runs its own
raw SQL instead. The dependency is constructed (including its
`UuidRegistry::createMissingUuidsForTables()` side effect) and then never
used. This also runs against this repo's own stated standard (`AGENTS.md`
in the primary checkout / `CLAUDE.md` "Dependency Injection": "Never use
`new` for service-layer objects inside business logic") — noted for the
catalog, not actioned here (read-only audit).

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| `GET /api/medical_problem` (unscoped, all patients) | yes | `encounters/notes` (`_rest_routes_standard.inc.php:210`) | Not `patients/med`; see Finding 6 |
| `GET /api/patient/:puuid/medical_problem` (the port's endpoint) | yes, but wrong section | `encounters/notes` (`:222`) | PHP card uses `patients/med`; Finding 1, Escalate |
| `GET /api/patient/:puuid/medical_problem/:muuid`, `POST`, `PUT`, `DELETE` | yes | `patients/med` (`:227,232,239,246`) | Matches the card's per-issue ACL |
| `GET /fhir/Condition[/:uuid]` | yes | `patients/med` via `addAclRestrictions` (route `:169,174`) | Skipped entirely for a patient-context token (`FhirGenericRestController::getAllProcessingResult`, `:94-96`) |
| `POST /api/patient/:puuid/medical_problem` write validation | yes | `ConditionValidator` (title required 2-255 chars, `begdate` required `Y-m-d`, `puuid` must resolve to `patient_data`) | Not exercised by the read-only port |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `lists` (type=medical_problem) | yes (4 different SQL shapes — see Logic) | yes (insert/update/delete) | `ConditionService::search/insert/update/delete`, both FHIR sub-services' `searchForOpenEMRRecords`, `PatientIssuesService::search` | no explicit transaction in any path |
| `patient_data` | yes (uuid↔pid join everywhere) | no | all four query paths | n/a |
| `issue_encounter`, `form_encounter` | yes | no | `ConditionService::search` (LEFT JOIN, per-row, no dedupe — Finding 5); `FhirConditionProblemListItemService` (LEFT JOIN, exclude-if-linked); `FhirConditionEncounterDiagnosisService` (INNER JOIN, include-only-if-linked) | n/a |
| `list_options` (`condition-verification`) | yes | no | `ConditionService::search` (`verification_title`) | n/a |
| `list_options` (`Observation_Types`) | yes | no | `FhirConditionHealthConcernService` (`health_concern_subtype_title`) | n/a |
| `users` | yes | no | `ConditionService::search` (provider fields), `FhirConditionEncounterDiagnosisService` (creator/updator) | n/a |
| `lists_medication` | yes | no | `PatientIssuesService::search` only — not reachable via any API route | n/a |
| `issue_types` | yes (validation) | no | `PatientIssuesService::validateIssueType()` (write path, not exercised here) | n/a |

## Cross-links

- **Opened by:** `apis/routes/_rest_routes_standard.inc.php`, `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`.
- **Calls into:** `BaseService` (`filterData`, `buildInsertColumns`, `buildUpdateColumns`, `addCoding`, `getIdByUuid`), `ConditionValidator`, `FhirSearchWhereClauseBuilder`/`SearchFieldStatementResolver`, `CodeTypesService`.
- **Related units:** `ui/DEMOGRAPHICS-PART2-CARDS.md` (the PHP card's own query and `filterActiveIssues()`), `api/CLINICAL-CARDS.md` DB-04 (Phase 1 map this analysis corrects/confirms), `api/AUTH-AND-PATIENT.md` (patient-context token ACL skip).

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Bug (data fidelity) | High (provisional) | FHIR problem-list items never carry coded `diagnosis`: the sub-service's own SQL never runs `diagnosis` through `addCoding()`, so `is_array($dataRecord['diagnosis'])` is always false and `Condition.code` is always the title-text fallback, even though 39/39 of pid 13's problems have a coded `SNOMED-CT:` diagnosis. | `FhirConditionProblemListItemService.php:129-181` (SQL); `FhirConditionTrait.php:136-158` (`populateCode`); `ConditionService.php:101-108` (the coding step that's missing) | Port: prefer standard REST `/api/patient/:puuid/medical_problem` for coded diagnosis, not FHIR, if codes matter; catalog upstream |
| 2 | Bug | High (provisional) | `GET /api/patient/:puuid/medical_problem` — the endpoint the port must call for DB-04 — is gated by ACL `encounters/notes`, not `patients/med` like the PHP card and every sibling card's endpoint. Grants and denies data access in both directions relative to the UI. | `_rest_routes_standard.inc.php:210,222` vs `aclCheckIssue('medical_problem')` = `patients\|med` (`ui/DEMOGRAPHICS-PART2-CARDS.md:140`) | Port/checkpoint question: request an `encounters/notes` scope for this card, or flag the mismatch to David |
| 3 | Bug | Medium (verified by code; not observable on pid 13's data) | `GET /fhir/Condition` with no `category` param queries all three mapped services (problem-list-item + health-concern + encounter-diagnosis) and merges them — broader than the Medical Problems card. Corrects `api/CLINICAL-CARDS.md` DB-04, which describes problem-list-item as "the default". | `FhirConditionService.php:93-111` | Port must always pass `category=...\|problem-list-item` explicitly |
| 4 | Bug | Medium (verified) | The `clinical-status` FHIR search param on problem-list items maps to a `clinical_status` column that exists nowhere in the query or the `lists` table (confirmed via `DESCRIBE lists` and full read of the query); using it would produce a SQL error, not a filter. Confirms Phase 1's inference. | `FhirConditionProblemListItemService.php:102,129-181`; `SearchFieldStatementResolver.php:224-260`; `FhirConditionTrait.php:102-118` (status is computed post-query, not selected) | Port: never send `clinical-status`; compute status client-side from `enddate`/`outcome`/`occurrence` |
| 5 | Bug | Low (not verified with data — pid 13 has 0 encounter-linked problems) | `ConditionService::search()`'s LEFT JOIN to `issue_encounter`/`form_encounter` is per-row with no dedupe; a problem linked to multiple encounters would repeat in the standard-REST response. | `ConditionService.php:57-70` | Port: dedupe by `uuid` client-side as a defensive measure |
| 6 | Security | Medium | `GET /api/medical_problem` (no puuid) and `GET /api/medical_problem/:muuid` are unscoped to any patient and gated only by `encounters/notes` — a caller with that ACL, not `patients/med`, can list/read any patient's medical problems system-wide. | `_rest_routes_standard.inc.php:209-219`; `ConditionRestController.php:74-83,190-194` | Out of scope for the port (which always uses the patient-scoped route), recorded for the catalog |
| 7 | Bug | Medium (verified) | `_sort`/`_count`/`_offset` on `/fhir/Condition` are parsed into a `SearchQueryConfig` but silently discarded: none of the three Condition sub-services override `searchForOpenEMRRecordsWithConfig()`, so the inherited default drops the config and re-runs the unsorted, unlimited query. | `FhirServiceBase.php:262-266,313-316`; `ResourceServiceSearchTrait.php:53-64` (generic `_sort`/`_count` parsing) | Port: do not rely on FHIR paging/sort for Condition; fetch all and sort/paginate client-side |
| 8 | Dead code / Half-implemented | Low | `PatientIssuesService::getActiveIssues()` has no caller anywhere in the tree, and even if called would not replicate `filterActiveIssues()` — it never checks `outcome != 1`. | `PatientIssuesService.php:89-100` | Out of scope; catalog |
| 9 | Dead code / Smell | Low | `FhirConditionRestController` is `@deprecated`, has no route referencing it, and is only present in the codebase via PHPStan baseline suppressions. Separately, `FhirConditionProblemListItemService`/`FhirConditionHealthConcernService` both construct an unused `ConditionService` dependency in their constructors that `searchForOpenEMRRecords()` never calls. | `FhirConditionRestController.php:26`; `FhirConditionProblemListItemService.php:56,64,67-75` (unused); `FhirConditionHealthConcernService.php:67,75,78-86` (unused) | Out of scope; catalog |
| 10 | Bug (contradicts own docs) | Medium (verified) | The OpenAPI annotations on `ConditionRestController::getAll()` document `title`, `begdate`, `enddate`, `diagnosis`, `condition_uuid` as query parameters on both GET routes, but the route closures never forward the request's query string to the method — only `puuid` (and `muuid`, on the single-item route) are ever passed. Same pattern on the neighboring Allergy routes. | `_rest_routes_standard.inc.php:209-224` vs `ConditionRestController.php:88-189` (OA doc) | Port: do not attempt server-side filtering by these fields on the standard REST path; fetch all and filter client-side (already the plan per `filterActiveIssues`) |
| 11 | Smell | Low | `ConditionService::search()` and both FHIR problem-list/health-concern queries have no `ORDER BY`; only the API-unreachable `PatientIssuesService::search()` sorts by `begdate ASC`. Confirms the parity gap already noted in `ui/DEMOGRAPHICS-PART2-CARDS.md`'s parity table for DB-04. | `ConditionService.php:44-84`; `FhirConditionProblemListItemService.php:129-184` | Port: client-side sort by `begdate` ascending, NULLs first, to match the card |

## Port notes

- **Must survive:** the `filterActiveIssues()` rule (`outcome != 1 && (empty(enddate) || enddate > now)`) applied client-side to the unfiltered standard-REST response; client-side sort by `begdate` ascending with NULLs first; the card shows `title` only.
- **Must not survive:** relying on FHIR's `clinical-status` search param (errors — Finding 4); relying on the FHIR default (no-`category`) response as if it were problem-list-item-only (Finding 3); relying on FHIR for coded diagnosis data if that matters to a future card (Finding 1); relying on `_sort`/`_count` for Condition (Finding 7).
- **Open questions:** (a) David's call on Finding 2 — is the `encounters/notes` ACL on the list route intentional, and does the port's OAuth2 client need that scope in addition to (or instead of) `patients/med`? (b) What HTTP status/body does the `clinical-status` SQL error actually produce end-to-end (Finding 4) — not traced past `FhirServiceBase::getAll()`'s catch block, which does not catch it; would need a live probe once an OAuth2 client exists. (c) Does pagination metadata survive `MappedServiceTrait::searchServices()`'s merge of three sub-service `ProcessingResult`s well enough to matter, given Finding 7 already makes `_count`/`_sort` non-functional at the SQL level regardless? Not traced.

## Verification (read-only SQL, pid 13, local dev DB)

```
SELECT type, COUNT(*) FROM lists WHERE pid=13 GROUP BY type;
  -> allergy 2, medical_problem 39, medication 5

SELECT COUNT(*), SUM(activity=1), SUM(activity=1 AND ie.list_id IS NULL) AS fhir_active,
       SUM(ie.list_id IS NOT NULL) AS linked_to_encounter
FROM lists l LEFT JOIN issue_encounter ie ON ie.list_id=l.id
WHERE l.pid=13 AND l.type='medical_problem';
  -> total 39, activity=1 39, fhir_active 39, linked_to_encounter 0

SELECT COUNT(*), SUM(diagnosis IS NOT NULL AND diagnosis!='') FROM lists WHERE pid=13 AND type='medical_problem';
  -> 39, 39 (every row has a SNOMED-CT:<code> diagnosis)
```

**PHP-rule vs FHIR-rule disagreement, pid 13** (`php_active` =
`outcome != 1 AND (enddate IS NULL OR enddate > NOW())`; `fhir_active` =
`activity = 1 AND` not linked to any `issue_encounter` row):

```
SELECT l.id, l.title, l.outcome, l.activity, l.enddate,
  (l.outcome != 1 AND (l.enddate IS NULL OR l.enddate > NOW())) AS php_active,
  (l.activity = 1 AND ie.list_id IS NULL) AS fhir_active
FROM lists l LEFT JOIN issue_encounter ie ON ie.list_id = l.id
WHERE l.pid = 13 AND l.type = 'medical_problem'
HAVING php_active != fhir_active;
```
26 of 39 rows disagree — all 26 have `outcome=6` (not `1`, so it isn't the
`outcome` term) and an `enddate` in the past, so the PHP rule correctly
hides them (13 remain "active"), while the FHIR rule shows all 39 because
`activity` is `1` on every row locally and none are linked to an encounter.
This is exactly the divergence the parity tables already predicted
(`activity` and `enddate` are independent columns; FHIR checks the former,
PHP the latter), now enumerated for pid 13: **the FHIR problem-list-item
category currently returns every one of the patient's 39 medical problems,
not the 13 the card would show — a client relying on the FHIR filter alone
would over-show by 26 rows on this patient.**
