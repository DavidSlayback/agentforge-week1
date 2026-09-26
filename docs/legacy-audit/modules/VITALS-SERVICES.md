# Vitals services — `VitalsService`, `FhirObservationVitalsService`, `FhirObservationService` (DB-08)

The read path behind the FHIR API a port would call for the Vitals card:
`GET /fhir/Observation?patient=<puuid>&category=vital-signs` dispatches through
`FhirObservationService` (category/code routing across every kind of
Observation OpenEMR exposes), which narrows to `FhirObservationVitalsService`
(the vital-signs mapping layer, one `form_vitals` row → many FHIR
`Observation` resources), which delegates the actual SQL to
`VitalsService::search()`. This is a **different code path from the PHP
dashboard's own query** (`vitals_fragment.php:27`, audited in
[`ui/VITALS-FRAGMENT.md`](../ui/VITALS-FRAGMENT.md)) — no shared SQL, no
shared filter logic, two independent implementations of "read this
patient's vitals" against the same `form_vitals`/`forms` tables.

**Sources:**
- `src/Services/VitalsService.php` · 519 lines · copyright 2021 Stephen
  Nielson, 2025 Jerry Padgett (no version/date stamp)
- `src/Services/FHIR/Observation/FhirObservationVitalsService.php` · 1,036
  lines · copyright 2021 Stephen Nielson
- `src/Services/FHIR/FhirObservationService.php` · 265 lines · copyright
  2020 Yash Bothra

**Audited by:** tier 2 · confidence high, except where noted · not
escalated (no new Critical/High found beyond the already-escalated U-1;
this unit narrows and partially corrects U-1's port-facing implications —
see Findings).

## Purpose & lifecycle

1. Route `GET /fhir/Observation[/:uuid]`
   (`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:493-502`)
   constructs `FhirGenericRestController` wrapping `new FhirObservationService()`
   and calls `addAclRestrictions("patients", "med")` — same ACL section/
   sub-section as the PHP card's own gate
   (`AclMain::aclCheckCore('patients','med')`, `demographics.php:1507`).
2. `FhirGenericRestController::getAll()` → `getAllProcessingResult()`
   (`src/RestControllers/FHIR/FhirGenericRestController.php:93-115`): if the
   request is patient-scoped (`isPatientRequest()`, i.e. hit through the
   patient-facing OAuth2 flow) the ACL checks above are **skipped** and the
   result is bound to `puuidBind` from the token instead; otherwise the two
   `addAclRestrictions` checks run via `RestConfig::request_authorization_check()`
   (throws on failure — not traced further here, generic to every FHIR
   route). Result resources are then filtered again through
   `ResourceConstraintFilterer::canAccessResource()` (SMART-on-FHIR scope
   enforcement, e.g. a `category=`-scoped token) before being wrapped in a
   Bundle — always **HTTP 200** with a Bundle (zero entries if nothing
   matches or the caller lacks scope for anything); there is no distinct
   404/403 body for "no vital signs" vs. "not authorized for any of the
   returned codes" — see Findings #5.
3. `FhirObservationService::__construct()` (`FhirObservationService.php:60-74`)
   registers ten "mapped services" by category, including
   `new FhirObservationVitalsService()` at line 65.
4. `FhirObservationService::getAll()` (`:99-160`): when the request supplies
   `category=vital-signs`, `getServiceListForCategory()` (`MappedServiceCodeTrait.php:24`,
   not read in depth — filters `getMappedServices()` by each service's own
   `supportsCategory()`) narrows the service list to exactly
   `[FhirObservationVitalsService]` (its `supportsCategory()` returns
   `$category === self::CATEGORY` where `CATEGORY = "vital-signs"`,
   `FhirObservationVitalsService.php:104,348-351`). With no `category` or
   `code` param, **all ten mapped services run** and their results are
   concatenated (`:148-151`) — a plain `GET /fhir/Observation?patient=<uuid>`
   with no `category` filter returns vitals mixed with labs, social history,
   employer, advance-directive, etc. observations in one Bundle; a port must
   always pass `category=vital-signs` to avoid this.
5. Per matched service, `searchServices()` (`MappedServiceTrait.php:66-79`)
   calls that service's own `getAll($fhirSearchParams, $puuidBind)` — this
   is `FhirServiceBase::getAll()` (`FhirServiceBase.php:240-296`), **not**
   overridden by `FhirObservationVitalsService`. It builds OpenEMR search
   fields via `ResourceServiceSearchTrait::createOpenEMRSearchParameters()`
   (peels `_sort`/`_count`/`_offset` into a `_config` sub-array,
   `ResourceServiceSearchTrait.php:53-66`), then — because `_config` is
   always present once any query param is parsed through this trait's
   special-column handling, or simply because `_config` key existence is
   checked — calls `searchForOpenEMRRecordsWithConfig($oeSearchParameters, $searchConfig)`.
   `FhirServiceBase`'s own default implementation of that method
   (`FhirServiceBase.php:313-316`) is `return $this->searchForOpenEMRRecords($openEMRSearchParameters);`
   — it **discards `$searchConfig` entirely**. `FhirObservationVitalsService`
   does not override `searchForOpenEMRRecordsWithConfig()`, so this default
   applies. See Findings #2 for what this means for `_sort`/`_count`.
6. `FhirObservationVitalsService::searchForOpenEMRRecords()` (`:398-472`):
   validates `category` equals `"vital-signs"` (throws `SearchFieldException`
   otherwise, `:405-411`), narrows `code` if supplied (maps component codes
   like `8480-6` systolic back to their panel/base code via
   `convertComponentCodeToBaseCode()`, `:1028-1035`, so searching by a
   component code still returns the full parent Observation), defaults to
   **every** code in `COLUMN_MAPPINGS` + `CALCULATED_MAPPING_CODES` if
   neither `category` nor `code` narrowed the set (`:433-437` — reached
   whenever `category=vital-signs` is the only filter, which is the port's
   expected call shape), then calls `$this->service->search($openEMRSearchParameters)`
   (`:441`, `$this->service` is the `VitalsService` instance from the
   constructor, `:338`) — **the exact same bare `search()` call, with no
   `deleted` field added**, that the direct-database VitalsService callers
   listed in Findings #1 take pains to avoid.
7. `VitalsService::search()` (`VitalsService.php:85-223`): runs the SQL in
   Logic below, one row per `form_vitals` record (deduplicated by
   `form_id` at `:210-213` in case the `form_vital_details` join fans out
   multiple detail rows per vitals set), converts units via
   `createResultRecordFromDatabaseResult()`, returns a `ProcessingResult`.
8. Back in `parseVitalsIntoObservationRecords()` (`FhirObservationVitalsService.php:524-597`),
   each returned `form_vitals` row becomes: one "vital-signs panel"
   Observation (code `85353-1`, `hasMember` references to the individual
   codes present via `getVitalSignsUuidMappings()`/`UuidMapping::getMappedRecordsForTableUUID()`)
   plus one Observation per populated vital-sign code from
   `COLUMN_MAPPINGS`. `parseOpenEMRRecord()` (`:624-729`) then shapes each
   into the actual `FHIRObservation` resource (BP/pulse-ox as
   panel-with-components, everything else as a single `valueQuantity`) —
   see Layout/interface below for the code table.
9. If `code=96607-7` (average-BP) is requested, a **second, entirely
   separate** service (`VitalsCalculatedService`, not audited in this unit —
   out of scope, no PHP dashboard card surfaces it) is queried and merged in
   (`:456-466`). Not part of DB-08 parity; flagged only so a port doesn't
   mistake it for a real recorded vital.

## Layout / interface

**`VitalsService`** (`namespace OpenEMR\Services`, extends `BaseService`):
- `search($search, $isAndCondition = true): ProcessingResult` — the one
  method this unit's port-facing analysis depends on. Callers: `EncounterService`
  (4 call sites, `src/Services/EncounterService.php:564,588,600,607` — backs
  the standard REST `GET/POST/PUT /api/patient/:pid/encounter/:eid/vital[/:vid]`
  routes, `apis/routes/_rest_routes_standard.inc.php:140-165`, ACL `encounters/notes`),
  `FhirObservationVitalsService::searchForOpenEMRRecords()` (`:441`), and
  three legacy PHP callers (`interface/forms/vitals/growthchart/chart.php:62`,
  `interface/forms/vitals/C_FormVitals.class.php:63,445`).
- `getVitalsHistoryForPatient($pid, $excludeVitalFormId)`,
  `getVitalsForForm($form_id)`, `getVitalsForPatientEncounter($pid, $eid)`
  (`:436-518`) — each explicitly adds `deleted=0` **and** `formdir='vitals'`
  search fields before calling `search()`. No caller of these three was
  found outside this file in `src/`/`interface/` at a `grep -rn` pass
  limited to this audit's time budget — flagged as an open question, not
  confirmed unused.
- `save()`/`saveVitalsArray()`/`saveVitalsForm()`/`create()` — write path,
  out of scope for a read-only port audit; `create()` is a `// TODO: not
  sure we need this anymore` stub that does nothing (dead code, Low).

**`FhirObservationVitalsService`** (`namespace OpenEMR\Services\FHIR\Observation`,
extends `FhirServiceBase`): FHIR-facing methods `getAll()`/`getOne()`
(inherited, not overridden), `parseOpenEMRRecord()`, `createProvenanceResource()`,
`supportsCategory()`, `supportsCode()`, `getProfileURIs()`. Only reachable
via `FhirObservationService`'s mapping (no direct route to this class).

**`FhirObservationService`** (`namespace OpenEMR\Services\FHIR`, extends
`FhirServiceBase`): the actual `/fhir/Observation` entry point. Public
surface is the standard `FhirServiceBase`/`IResourceSearchableService`
contract (`getAll`, `getOne`, `getSearchParams`) plus
`getProfileURIs()`. `$observationService` (`ObservationLabService`,
`:51-53`) is declared but never assigned or read anywhere in this file —
dead property (Low).

**Search parameters registered** (both classes'
`loadSearchParameters()`):

| Param | `FhirObservationService` (router) | `FhirObservationVitalsService` |
|---|---|---|
| `patient` | `puuid` via `getPatientContextSearchField()` | same |
| `category` | `category` (token) | same, consumed then stripped in `searchForOpenEMRRecords()` |
| `code` | maps to `status` column — **looks like a copy/paste bug**: `loadSearchParameters()` at `FhirObservationService.php:83` builds the `code` search field from OpenEMR column `status`, not `code`; not exercised by category-only queries (the router's own `loadSearchParameters()` is only used when *this* class's `createOpenEMRSearchParameters` runs, which happens before narrowing to sub-services — see Findings #4) | maps to `code` (token), correct |
| `date` | `date` (datetime) | `date` (datetime) — maps to `vitals.date` |
| `_id` | `uuid` (token) | `uuid` (UUID service field) |
| `_lastUpdated` | `date_modified` (datetime) — **no `date_modified` column exists in the underlying `form_vitals`/vitals SQL**, see Findings #4 | `last_updated` (datetime) — correct, maps to `form_vitals.last_updated` |

No `deleted` search parameter is registered by either class — a port
cannot ask the API to exclude soft-deleted vitals sets even if it wanted to
opt in explicitly (see DB-08 decision below).

## State

```text
No module-level/global mutable state in any of the three files.
```

**Globals read:** `units_of_measurement` (`VitalsService::__construct()`,
`:55`, via `OEGlobalsBag::getInstance()->get('units_of_measurement')` when
no explicit value is passed to the constructor — `FhirObservationVitalsService`
constructs `new VitalsService()` with no argument, `:338`, so it always
picks up the **current site-global value at request time**, same source of
truth the PHP card's `report.php` reads, but read independently — a global
change between the two requests, or a per-request override, is possible in
theory though not observed here).
**Globals written:** none.

## Logic

### `VitalsService::search()` — the SQL (`VitalsService.php:85-223`)

```sql
FROM (SELECT id, uuid, `user`, groupname, authorized, activity, external_id,
             `date`, note, bpd, bps, weight, height, temperature, temp_method,
             pulse, respiration, BMI, BMI_status, waist_circ, head_circ,
             oxygen_saturation, oxygen_flow_rate, inhaled_oxygen_concentration,
             ped_weight_height, ped_bmi, ped_head_circ, last_updated
      FROM form_vitals) vitals
JOIN (SELECT form_id, encounter, pid AS form_pid, `user`, deleted, formdir,
             `date` AS date_created
      FROM forms) forms
  ON vitals.id = forms.form_id AND forms.formdir = 'vitals'
LEFT JOIN (SELECT encounter AS eid, uuid AS euuid, `date` AS encounter_date,
                  pid AS encounter_pid FROM form_encounter) encounters
  ON encounters.encounter_pid = forms.form_pid AND encounters.eid = forms.encounter
LEFT JOIN (SELECT uuid AS puuid, pid FROM patient_data) patients
  ON forms.form_pid = patients.pid
LEFT JOIN (SELECT uuid AS user_uuid, username, npi AS user_npi, id AS uid FROM users) users
  ON vitals.`user` = users.username
LEFT JOIN (SELECT form_id AS details_form_id, id AS details_id, ... FROM form_vital_details) details
  ON details.details_form_id = vitals.`id`
<WHERE from FhirSearchWhereClauseBuilder::build($search)>
ORDER BY encounter_date DESC, `date` DESC
```

**The join fix, confirmed by SQL.** Unlike `vitals_fragment.php:27`'s
`LEFT JOIN forms ON FORM_VITALS.id = FORMS.form_id` (no `formdir`
condition, the root cause of U-1's id collision — `forms.form_id` is only
unique *within* a `(formdir, pid)` pair, not globally), this query's join
adds `AND forms.formdir = 'vitals'` (`:152`). Reproduced read-only against
the seeded DB (`docker exec agentforge-week1-mysql-1 … mariadb … openemr`,
select-only):

```sql
SELECT vitals.id, vitals.date, forms.deleted, forms.form_id, forms.formdir, forms.pid
FROM form_vitals vitals
JOIN forms ON vitals.id = forms.form_id AND forms.formdir = 'vitals'
WHERE forms.pid = 13
ORDER BY forms.date DESC, vitals.date DESC;
```
```
form_vitals_id  date                 deleted  form_id  formdir  forms_pid
28              2026-05-01 09:00:00  1        28       vitals   13
27              2026-04-05 20:06:27  0        27       vitals   13
26              2025-03-30 20:06:27  0        26       vitals   13
25              2024-03-24 20:06:27  0        25       vitals   13
24              2018-02-25 20:06:27  0        24       vitals   13
```

Every row maps to exactly one `forms` row, for the right patient, with the
right `deleted` flag — **no fan-out, no cross-patient/cross-formdir
collision**. `form_vitals.id` is confirmed (via `SHOW CREATE TABLE
form_vitals`) a global `bigint AUTO_INCREMENT` primary key, and `forms.id`
is likewise a separate global auto-increment PK — the audit brief's
"`forms.id=1438`/`forms.id=62`/`forms.id=64` collide on the numeric value
28" scenario from `ui/VITALS-FRAGMENT.md` Findings #1 is a collision on
`forms.form_id` (a non-unique, per-formdir/pid sequence-like column) with
the fragment's bug of joining on it without a `formdir` filter — adding
`formdir='vitals'` here is sufficient to eliminate it, because the
resulting `(form_id, formdir='vitals')` pair is unique (one `forms` row
per `form_vitals` row, by construction of `\addForm()`,
`VitalsService.php:380`).
**Answer to the audit's question: this SQL does *not* have the same
id-collision join bug as `vitals_fragment.php:27`.**

**But there is no `deleted` filter at all — confirmed, not merely
inferred.** The WHERE clause is built entirely from
`FhirSearchWhereClauseBuilder::build($search, $isAndCondition)` against
whatever `$search` array the caller passed in; `VitalsService::search()`
itself adds no hardcoded predicate beyond the join conditions above (grep
of the file: no `deleted` literal anywhere in `search()`, only in the three
*other* methods listed in Layout/interface, which build their own
`$search` array with an explicit `deleted=0` field before calling
`search()`). `FhirObservationVitalsService::searchForOpenEMRRecords()`
(`:441`) calls `$this->service->search($openEMRSearchParameters)` with
whatever came from `loadSearchParameters()` — `patient`, `code`,
`category`, `date`, `_id`, `_lastUpdated` only; **`deleted` is not a
registered FHIR search parameter for Observation vital-signs, so no caller
of the public API can add it even opt-in.** Every one of the five rows
above — including `id=28`, `deleted=1` — passes through unfiltered.

**Answer to the audit's central question:** `GET /fhir/Observation?patient=<uuid>&category=vital-signs`
does **not** exclude the deleted set. Phase 2's inference in
`ui/VITALS-FRAGMENT.md` ("neither the FHIR `Observation` mapping … exposes
`forms.deleted`") is **confirmed**, and sharpened: it's not merely that the
*flag* isn't exposed in the response — the *filter* itself never runs
server-side, for any caller, under any parameters. A client that fetches
every vital-signs Observation for pid 13 and groups by
`effectiveDateTime` (the correct grouping key — see below) will see **five**
groups, the most recent of which (2026-05-01) is the deliberately-deleted
seed set, exactly as the buggy PHP fragment (via its own, different bug)
also surfaces it. **The two bugs are independent** (a join collision vs. an
absent filter) but currently produce the same user-visible symptom on this
seed: the deleted set wins "most recent."

### `FhirObservationVitalsService::searchForOpenEMRRecords()` and `_sort`/`_count` (`:398-472`, `FhirServiceBase.php:240-316`)

Traced the full pagination pipeline for this specific service:

1. `FhirServiceBase::getAll()` (`:240-296`) parses `_sort`/`_count`/`_offset`
   out of the incoming query string into `$oeSearchParameters['_config']`
   via `ResourceServiceSearchTrait::createOpenEMRSearchParameters()`
   (`ResourceServiceSearchTrait.php:53-99`) — this part is generic and
   works (no error on `_sort=-date&_count=5`).
2. Because `_config` is set, `getAll()` builds a `SearchQueryConfig` from it
   (`FhirServiceBase.php:262-264`), sets it as the **outer**
   `ProcessingResult`'s pagination (`fhirSearchResult->setPagination(...)`,
   `:264`), strips `_config` out of the search parameters, and calls
   `searchForOpenEMRRecordsWithConfig($oeSearchParameters, $searchConfig)`
   (`:266`) instead of `searchForOpenEMRRecords()`.
3. `FhirServiceBase`'s own `searchForOpenEMRRecordsWithConfig()`
   (`:313-316`) is `return $this->searchForOpenEMRRecords($openEMRSearchParameters);`
   — **it drops `$searchConfig` on the floor.** `FhirObservationVitalsService`
   does not override `searchForOpenEMRRecordsWithConfig()` (confirmed: no
   such method exists in the 1,036-line file), so this default runs
   unchanged. The sort order embedded in `$searchConfig` (built from
   `_sort`) never reaches `VitalsService::search()`, which has its own
   hardcoded `ORDER BY encounter_date DESC, \`date\` DESC` and no awareness
   of any `_config`/`SearchQueryConfig` object at all.
4. `_count`/`_offset` fare partially better, but not at the row level: the
   **outer** `$fhirSearchResult` (the one whose pagination was set in step
   2) is what `addData()` is called against once per emitted FHIR
   `Observation` resource (`FhirServiceBase.php:274-287`), and
   `ProcessingResult::addData()` (`src/Validators/ProcessingResult.php:136-148`)
   does stop appending once the configured limit is hit, setting
   `hasMoreData`. So **`_count` does limit the response — but it counts
   individual FHIR `Observation` resources, not vitals sets**, and every
   set expands to a panel plus ~10-15 per-code Observations
   (`parseVitalsIntoObservationRecords()`, `:524-597`). A `_count=5` on
   `category=vital-signs` will very likely return a partial slice of a
   *single* vitals set (whichever codes happened to be emitted first),
   never five whole sets — the natural pagination unit for the port
   (one "vitals set" = one card render) does not correspond to the API's
   pagination unit at all.

**Correction to `ui/VITALS-FRAGMENT.md`'s `_sort` claim.** That analysis
says `_sort=-date`/`_sort=date` "is legal and should let a client request
… to get results ordered newest-first," flagged as "confirmed by source
reading, not by a live request." Reading the full call chain here shows
that claim needs qualifying: the parameter is *accepted without error*
(no `SearchFieldException`), but it is **silently ignored** for this
specific service — `searchForOpenEMRRecordsWithConfig()` isn't overridden,
so the requested sort order never reaches the SQL. The response happens to
come back in a fixed `encounter_date DESC, date DESC` order regardless of
what `_sort` value (or absence of one) was requested — which coincidentally
looks like "descending by date" already, so a caller who only ever asks
for `_sort=-date` would never notice the parameter does nothing. A caller
asking for `_sort=date` (ascending) would get descending results anyway,
silently wrong.

### `FhirObservationService::searchForOpenEMRRecords()` — `code` search field bug (`:79-89`)

`loadSearchParameters()` at `FhirObservationService.php:83` registers:
```php
'code' => new FhirSearchParameterDefinition('status', SearchFieldType::TOKEN, ['code']),
```
The FHIR-facing parameter name (`'code'`) is correctly `'code'`, but the
**OpenEMR-facing search field name** — the first constructor argument to
`FhirSearchParameterDefinition`, which becomes the key other code looks
this field up by (`SearchFieldException`'s `getField()` in
`FhirObservationService::getAll()`'s catch block references it by that
name, `:154-157`) — is `'status'`, not `'code'`. This is the *router's*
`loadSearchParameters()`, used when `FhirObservationService::getAll()`
itself parses `$fhirSearchParameters['code']`
(`:132-147`, reads the raw associative array directly, not through
`createOpenEMRSearchParameters()` — this bug doesn't actually reach the SQL
because the router never calls `createOpenEMRSearchParameters()` on
itself; it manually inspects `$fhirSearchParameters['code']` as a
`TokenSearchField` before dispatch). Net effect observed by reading the
code: harmless for `category=vital-signs` queries (the router's own
`loadSearchParameters()`/`searchForOpenEMRRecords()` — inherited from
`FhirServiceBase` but never actually invoked, since `FhirObservationService`
fully overrides `getAll()` and never calls
`$this->searchForOpenEMRRecords()` on itself) — flagged as dead/misleading
code (Low), not a live bug, but worth noting since the name `'status'`
doesn't correspond to any column this class's search ever queries.

### `_lastUpdated` mapping mismatch (`FhirObservationService.php:91-94`)

`FhirObservationService::getLastModifiedSearchField()` maps
`_lastUpdated` → OpenEMR field `date_modified`. Nothing in
`VitalsService`'s SQL selects or exposes a `date_modified` column (the
vitals row's true "last updated" column is `last_updated`, which is what
`FhirObservationVitalsService::getLastModifiedSearchField()`,
`:388-391`, correctly maps to). Same reasoning as the `code`/`status`
mismatch above: this is dead code on the router class (never invoked for a
category-routed request), not a live filter bug — but see Findings #4 for
why it matters if any future code path calls the router's own search
methods directly.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| `GET /fhir/Observation`, `GET /fhir/Observation/:uuid` | yes | `addAclRestrictions('patients','med')` on the shared `FhirGenericRestController`, applied in `getAllProcessingResult()` only for non-patient-bound (client-credential/backend) requests (`FhirGenericRestController.php:93-100`) | Matches the PHP card's own `AclMain::aclCheckCore('patients','med')` gate (`demographics.php:1507`) — **parity confirmed** on the ACL section/sub-section, unlike the outright-missing check on `vitals_fragment.php` itself (`ui/VITALS-FRAGMENT.md` Findings #4). A patient-context (patient-portal OAuth2) request skips this ACL branch entirely and is scoped by `puuidBind` instead — not a gap, just a different (and appropriate) enforcement path for that grant type. |
| Per-resource SMART scope filtering | yes | `ResourceConstraintFilterer::canAccessResource()` (`FhirGenericRestController.php:107,147-149`), not read in depth here | Confirms `AUTHORIZATION.md`'s documented granular scope, `patient/Observation.rs?category=…vital-signs`, is enforceable at this layer — out of this unit's file scope to verify the filter's internals. |
| `deleted`-set visibility | **missing** | — | Not an ACL gap (any user with `patients/med` sees the deleted set) but a data-filtering gap: there is no permission model that would legitimately expose vs. hide a deleted vitals set — it's just never filtered (see Logic above). |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `form_vitals` | Yes (`SELECT *`-equivalent column list) | Yes (`save()`/`saveVitalsArray()`, out of scope) | `VitalsService.php:87-194` (read); `:330-405` (write) | No explicit transaction wrapping observed in `saveVitalsArray()` (insert into `form_vitals` then a second `\addForm()` call, then per-detail saves in a loop — three separate statement groups, not wrapped in `BEGIN`/`COMMIT`) |
| `forms` | Yes (`deleted`, `formdir`, `encounter`, `pid` via join) | No (in this unit — `\addForm()` at `:380` writes it, defined elsewhere, not traced) | `VitalsService.php:141-152` | No |
| `form_encounter` | Yes (`uuid`, `date`, `pid`, `encounter`, via LEFT JOIN) | No | `:153-162` | No |
| `patient_data` | Yes (`uuid` as `puuid`, via LEFT JOIN) | No | `:163-169` | No |
| `users` | Yes (`uuid`, `npi`, via LEFT JOIN) | No | `:170-178` | No |
| `form_vital_details` | Yes (interpretation/reason columns, via LEFT JOIN) | Yes (`saveVitalDetails()`, out of scope) | `:179-194` (read); `:479-502` (write) | No |
| `uuid_mapping` (via `UuidMapping`/`UuidRegistry`) | Yes (`getVitalSignsUuidMappings()`, `:599-615`, and `UuidRegistry::createMissingUuidsForTables()` in the constructor, `:53`) | Yes (lazily creates missing UUID rows on first access) | `FhirObservationVitalsService.php:53,599-615` | Not traced |

## Cross-links

- **Opened by (this port's call path):** `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:493-502`
  → `src/RestControllers/FHIR/FhirGenericRestController.php` → `FhirObservationService`
  → `FhirObservationVitalsService` → `VitalsService`.
- **Also opened by (non-API paths, not the port's concern but share the
  same `VitalsService` class):** `src/Services/EncounterService.php`
  (backs `GET/POST/PUT /api/patient/:pid/encounter/:eid/vital[/:vid]`,
  encounter-scoped standard REST, ACL `encounters/notes` — a *second*,
  narrower API surface for vitals that requires an encounter id up front;
  not useful for "show the latest set" without first enumerating
  encounters), `interface/forms/vitals/C_FormVitals.class.php`,
  `interface/forms/vitals/growthchart/chart.php`.
- **Parallel/independent unit:** `interface/patient_file/summary/vitals_fragment.php`
  + `interface/forms/vitals/report.php` (`ui/VITALS-FRAGMENT.md`) — the PHP
  dashboard's own query/render path, sharing no code with this unit.
- **Registers with:** `src/Common/Uuid/UuidMapping.php:31` (static
  `RESOURCE_TABLE_MAPPING`-style entry tying `form_vitals` + this service's
  `COLUMN_MAPPINGS`/`CATEGORY` into the UUID registry, used for `_id`
  lookups and Provenance).

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Bug (data-safety, API surface) | **High (provisional)** | `GET /fhir/Observation?category=vital-signs` returns soft-deleted (`forms.deleted=1`) vitals sets with no way to exclude them — no `deleted` search parameter is registered, and `VitalsService::search()` (the SQL both this service and `FhirObservationVitalsService` share) adds no `deleted` predicate by default, unlike the three other `VitalsService` methods (`getVitalsHistoryForPatient`, `getVitalsForForm`, `getVitalsForPatientEncounter`) that explicitly add `deleted=0` before calling the same `search()`. Confirmed by SQL on the seed data: pid 13's `id=28` (2026-05-01, `deleted=1`) is returned alongside the four live sets, and is the most recent by date — a client naively grouping by date and taking the max would surface the deleted set as "current," the same end-user-visible symptom as U-1, via an independent root cause (absent filter, not a join collision — the join itself is correct, see Logic). | `FhirObservationVitalsService.php:441` (bare `$this->service->search($openEMRSearchParameters)`, no `deleted` field added); contrast `VitalsService.php:448,464,509` (the three safe callers) | Register a `deleted` (or `-deleted`) search field on `FhirObservationVitalsService::loadSearchParameters()` and default `searchForOpenEMRRecords()` to add `deleted=0` unless a caller explicitly opts into seeing deleted rows (mirrors how the three safe `VitalsService` methods already behave) — a schema-compatible, additive change to a service class, not "touching the backend" in the DB-10 sense if scoped to search defaults rather than the table. |
| 2 | Bug (API contract) | Medium | `_sort` is parsed without error for `/fhir/Observation?category=vital-signs` but has **zero effect** on result order: `FhirServiceBase::searchForOpenEMRRecordsWithConfig()`'s default implementation discards the `SearchQueryConfig` (and the sort order inside it), and `FhirObservationVitalsService` doesn't override that method to apply it. Results always come back in `VitalsService`'s hardcoded `ORDER BY encounter_date DESC, date DESC`, regardless of what `_sort` value (if any) was requested. `_count` does apply, but only as a cap on the *number of individual FHIR Observation resources* emitted (each vitals set expands to ~10-15 resources), not on the number of vitals sets — so `_count` cannot be used by a port to say "give me the last 3 sets." | `FhirServiceBase.php:262-266,313-316`; `FhirObservationVitalsService.php` (no `searchForOpenEMRRecordsWithConfig` override, confirmed absent) | Either override `searchForOpenEMRRecordsWithConfig()` in `FhirObservationVitalsService` to translate `$searchConfig`'s sort/limit into `VitalsService::search()`'s SQL, or document for the port that `_sort`/`_count` are non-functional for this resource and all grouping/ordering must happen client-side after fetching the full unpaginated set (which the port already has to do for "group by set" regardless — see Port notes). |
| 3 | Smell / dead code | Low | `FhirObservationService::loadSearchParameters()`'s `code` field maps to OpenEMR field name `'status'` (no such column is ever queried) and `getLastModifiedSearchField()` maps `_lastUpdated` to `'date_modified'` (no such column exists in the vitals SQL either). Both are unreachable in practice — `FhirObservationService::getAll()` is a full override that never calls its own inherited `searchForOpenEMRRecords()`/`createOpenEMRSearchParameters()` for itself, only for sub-services via `searchServices()`, and vitals-specific requests are dispatched to `FhirObservationVitalsService`'s own (correct) `loadSearchParameters()` instead. Confirmed dead by tracing every call site of `FhirObservationService::searchForOpenEMRRecords()`/`createOpenEMRSearchParameters()` in this file — none exist; the inherited `FhirServiceBase::getAll()` machinery that would invoke them is bypassed by the override. | `FhirObservationService.php:79-94` | Not urgent; a rewrite/cleanup could delete `FhirObservationService::loadSearchParameters()`/`getLastModifiedSearchField()` entirely since they're unreachable, or fix the field names if a future refactor removes the `getAll()` override. |
| 4 | Smell / dead code | Low | `FhirObservationService::$observationService` (`ObservationLabService`, `:51-53`) is declared, typed, and documented but never assigned or read anywhere in the 265-line file. | `FhirObservationService.php:51-53` | Remove the unused property. |
| 5 | Smell | Low | `FhirGenericRestController::getAll()` always responds `200` with a Bundle, even for zero matching resources or zero resources the caller's scope can access (`canAccessResource()` filters silently) — there is no way from the HTTP response alone to distinguish "no vitals recorded" from "vitals exist but your token's scope excludes them all." Generic to every FHIR resource on this controller, not vitals-specific; noted here because it directly affects how a port must render the Vitals card's empty state (it cannot distinguish "truly no data" from "scope too narrow" and must treat both the same way visually, which is arguably fine for a read-only card but worth the port team knowing). | `FhirGenericRestController.php:122-145` | Not urgent for a read-only port; if precise diagnostics matter later, `canAccessResource()`'s filtering could be surfaced as a response header or `OperationOutcome` warning. |

## Port notes

- **Must survive:** the *intended* "most recent, non-deleted vitals set"
  semantics — but the API cannot deliver this today (Finding #1); the port
  must implement its own workaround (see below) or accept parity is
  impossible until the `deleted` gap is closed. US-primary dual-unit
  display driven by `units_of_measurement` (matches the PHP card's own
  global read — same source of truth, independently read).
- **Must not survive:** relying on `_sort`/`_count` to do set-level
  pagination or ordering for this resource (Finding #2) — a port must
  always fetch the full `category=vital-signs` result for a patient and
  group/sort client-side, the same conclusion `ui/VITALS-FRAGMENT.md`
  already reached for a different reason (multi-resource-per-set), now
  reinforced by the fact that server-side sort doesn't work either.
- **Open questions:**
  - Is there an acceptable workaround for Finding #1 within "consume the
    existing API only, don't touch the backend" (DB-10)? None found by
    reading source: `deleted` is not exposed on the Observation resource
    itself (`parseOpenEMRRecord()` never reads or emits
    `dataRecord['deleted']`) and is not a registered search parameter, so
    there is no client-side filter possible — a port calling only the API
    **cannot** replicate even the *intended* "hide the deleted set" rule,
    only the *current, broken* legacy behavior of leaking it through
    (confirms and sharpens `ui/VITALS-FRAGMENT.md`'s same conclusion). This
    needs David's call per DB-10/A2: document as a hard "not available via
    API" gap, or treat as grounds for a scoped backend PR (would violate
    "don't touch the backend" unless separately approved).
  - Grouping key: **use `effectiveDateTime`, not `Observation.encounter`.**
    Confirmed by SQL that pid 13's deleted set (`form_vitals.id=28`,
    2026-05-01) shares `forms.encounter=367` with the adjacent live set
    (`form_vitals.id=27`, 2026-04-05) — both vitals forms were recorded
    against the *same* encounter. A port that grouped Observations by
    `Observation.encounter` reference instead of `effectiveDateTime` would
    **merge** these two distinct vitals sets into one group (mixing a
    deleted set's values with a live set's values under one "encounter"),
    which is strictly worse than the effectiveDateTime-grouping approach
    `ui/VITALS-FRAGMENT.md` already recommends. `effectiveDateTime` is
    reliably distinct per set (down to the second, from `form_vitals.date`)
    on this seed data; not proven collision-free in general (two vitals
    sets recorded in the same second for the same patient would merge too,
    but that's an inherent API limitation, not a client mistake).
  - BMI/BP/SpO2 representation, confirmed by reading
    `FhirObservationVitalsService::parseOpenEMRRecord()`: Blood Pressure is
    **one** Observation (code `85354-9`, `populateBloodPressurePanel()`)
    with two `component`s (systolic `8480-6`, diastolic `8462-4`) — not two
    separate top-level Observations. Pulse oximetry is similarly **one**
    Observation (code `59408-5`/`2708-6`, `populatePulseOximetryObservation()`)
    with `oxygen_flow_rate` (`3151-8`) and `inhaled_oxygen_concentration`
    (`3150-0`) as components, oxygen_saturation itself as the primary
    value. BMI (`39156-5`) is a plain single-value Observation, no
    components (`BMI_status`'s pediatric override is not on the FHIR
    resource at all — confirmed absent from `COLUMN_MAPPINGS['39156-5']['column']`
    handling in `parseOpenEMRRecord()`, matches `ui/VITALS-FRAGMENT.md`'s
    finding). All of the above matches
    `ui/VITALS-FRAGMENT.md`'s parity table; this unit confirms it against
    the actual `parseOpenEMRRecord()`/`populate*` implementations rather
    than the column-mapping table alone.
  - Units: confirmed against the live seed global
    (`SELECT gl_value FROM globals WHERE gl_name='units_of_measurement'` →
    `1`) that `VitalsService::createResultRecordFromDatabaseResult()`
    (`:254-270`) takes the **identity/US branch** — weight in `lb`, height/
    waist/head circ in `in`, temperature in `degF` — for this site, i.e.
    the FHIR API currently returns US units for these three fields,
    matching the PHP card's primary display unit. The metric branch only
    activates if the global is `2` (persist-in-metric) or `4`
    (metric-only); a port cannot get *both* units from one API call either
    way (confirmed, matches `ui/VITALS-FRAGMENT.md`).

## API contract for the port

**Endpoint:** `GET /fhir/Observation?patient=<puuid>&category=vital-signs`
(always pass `category`; omitting it returns every Observation type this
site exposes, not just vitals — see Logic step 4).

**Scope + ACL:** `patient/Observation.rs` or `user/Observation.rs`
(`Documentation/api/AUTHORIZATION.md:384,428`); a category-scoped grant,
`patient/Observation.rs?category=http://terminology.hl7.org/CodeSystem/observation-category|vital-signs`,
is documented and would be enforced by `ResourceConstraintFilterer`
(`AUTHORIZATION.md:224,269,713,811`). Server-side ACL gate is `patients`/`med`
(`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:495`) — matches the PHP card's
own gate exactly (see Permission checks).

**Search params actually honored** (for `category=vital-signs` requests,
i.e. dispatched to `FhirObservationVitalsService`):
- `patient` (required in practice — a port must always scope by patient)
- `category` (must be `vital-signs`; comma-separated multi-category not
  tested here)
- `code` (LOINC; component codes like `8480-6` auto-resolve to their panel
  code, e.g. `85354-9`)
- `date` (maps to `form_vitals.date`; standard FHIR date-search prefixes
  should work via `FhirSearchWhereClauseBuilder`, not individually
  exercised in this audit)
- `_id` (via UUID registry surrogate lookup, `FhirObservationService.php:167-230`)
- `_lastUpdated` (maps correctly to `form_vitals.last_updated` for this
  sub-service specifically — see Layout/interface table for why the
  router-level mapping is a red herring)
- `_sort` — **accepted but non-functional** (Finding #2); do not rely on it
- `_count`/`_offset` — **limits individual Observation resources, not
  vitals sets** (Finding #2); do not use for "latest N sets" pagination
- **No `deleted` param** — cannot exclude soft-deleted sets (Finding #1)

**Default filtering:** none beyond `category`/`code`/`date`/patient — every
matching `form_vitals` row for the patient is returned as a set of
Observations, live or deleted alike.

**Response shape per vitals set:** one "vital-signs panel" Observation
(code `85353-1`, `hasMember` references) plus one Observation per populated
vital sign; BP and pulse-ox are single Observations with `component`s
(see Port notes); all Observations in one set share `effectiveDateTime`
(**use this to group**) and the same `Observation.encounter` reference
(**do not use this to group** — can span multiple vitals sets, confirmed on
seed data).

**Error shape:** always HTTP 200 with a (possibly empty) Bundle on success;
ACL/authorization failures happen before any Observation-specific code runs
(generic `RestConfig::request_authorization_check()` — not traced in this
unit) and are not distinguishable from "no data" once past that gate
(Finding #5).

**Fields not available via API (per A2), confirmed for this unit:**
- Any notion of "deleted"/soft-delete status for a vitals set (Finding #1;
  this is the load-bearing gap for DB-08's "show the correct latest
  non-deleted set" decision — the API cannot express it).
- Reliable server-side sort or set-level pagination (Finding #2, new in
  this unit — `ui/VITALS-FRAGMENT.md` had flagged `_sort` as working;
  corrected here).
- Everything already catalogued in `ui/VITALS-FRAGMENT.md`'s parity table
  (dual-unit display, Waist Circ LOINC mapping, `BMI_status` pediatric
  override, pediatric-field age gating) — reconfirmed, not re-derived, by
  this unit's read of `parseOpenEMRRecord()`/`populate*` methods.

### DB-08 decision support: does the API make "show the correct latest non-deleted set" implementable?

**No — confirmed, with the exact mechanism identified.** The PHP
dashboard's own query has a join bug that *accidentally* leaks the deleted
set through (`ui/VITALS-FRAGMENT.md` U-1); this unit shows the API's
underlying query (`VitalsService::search()`) has the *correct* join
(`formdir='vitals'` present) but *no deleted filter at all*, and no way for
a caller to add one (no registered search parameter, no `deleted` field on
the FHIR resource). The two bugs are unrelated in cause but identical in
observed effect on this seed data: both surface the 2026-05-01 deleted set
as "most recent." A port built strictly against
`GET /fhir/Observation?category=vital-signs` **cannot** implement "show the
correct latest non-deleted set" — it can only implement "show the latest
set, deleted or not," which is worse than even today's buggy PHP card in
spirit (though coincidentally identical in output on this exact seed).
This should be recorded as a hard "not available via API" gap for DB-08,
per A2, unless David approves a scoped, additive backend change (register
a `deleted` search field / default-exclude it) as a separate, explicitly-approved
exception to "don't touch the backend."
