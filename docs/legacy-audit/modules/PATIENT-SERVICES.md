# PatientService & FhirPatientService — patient read paths for the API and `demographics.php`

`PatientService` is the single service class that owns the `patient_data`
table: every legacy PHP read of a patient (including `demographics.php`'s
own patient lookup) and every API read of a patient (standard REST and,
indirectly, FHIR) goes through it. `FhirPatientService` is a thin FHIR R4
mapping layer on top of it — it never queries the database itself; it calls
`PatientService::search()`/`insert()`/`update()` and converts the rows it
gets back into `FHIRPatient` resources (and back again for writes). For the
dashboard port this pair of files is the entire answer to "where does DB-02
come from": the SPA's persistent identity bar has no other legal path to
patient data.

**Source:** `src/Services/PatientService.php` (1,003 lines) · `src/Services/FHIR/FhirPatientService.php` (1,081 lines) — both read cover to cover; no version header on either file; git SHA `3ccfe1d` base, worktree `agentforge/w2-dashboard`. (Note: `PROJECT-MAP.md` records 905/976 lines for these two files; the current worktree copies are 1,003/1,081 — longer, not shorter, so nothing in the Phase 1 map depended on the missing lines, but the line counts there are stale.)
**Audited by:** tier 2 · confidence high · `Escalate: yes` (see Findings #3, #4)

## Purpose & lifecycle

`PatientService extends BaseService` (`PatientService.php:43`, table
`patient_data`). It has three families of public methods:

- **Read:** `findByPid()`, `search()`, `getAll()`, `getOne()`, `getUuid()`,
  `getPidByUuid()`, `getPatientAgeDisplay()`/`getPatientAge()`/`getPatientAgeYMD()`,
  `getProviderIDsForPatientPids()`/`getProviderIDsForPatientUuids()`,
  `getPatientPictureDocumentId()`, `getRecentPatientList()`,
  `getChartTrackerInformation()`/`getChartTrackerInformationActivity()`
  (static, unrelated chart-tracker feature).
- **Write:** `insert()`, `update()`, `databaseInsert()`, `databaseUpdate()`,
  `touchRecentPatientList()`.
- **Legacy-only, no route at all:** `findByPid()` — see Findings #3. It is
  the function `demographics.php` calls directly (`demographics.php:87`,
  `require_once("../../globals.php")` → `setpid()` → `$ptService =
  new PatientService(); $newPatient = $ptService->findByPid($pid);
  $ptService->touchRecentPatientList($newPatient);`), and 13 other legacy
  call sites (`src/Billing/Claim.php:81`, `src/Common/Auth/OneTimeAuth.php:309`,
  `interface/forms/newpatient/save.php:51`, `interface/patient_file/history/history_sdoh_health_concerns.php:77`,
  plus telehealth/Carecoordination modules) — confirmed by
  `grep -rn findByPid src/ apis/ interface/ library/`: **zero** hits under
  `src/RestControllers/` or `apis/`.

`FhirPatientService extends FhirServiceBase implements IFhirExportableResourceService,
IResourceUSCIGProfileService, IPatientCompartmentResourceService`
(`FhirPatientService.php:49`). Its lifecycle per request is entirely driven
by the base class (`src/Services/FHIR/FhirServiceBase.php`): a controller
calls `getOne($id, $puuidBind)` or `getAll($searchParams, $puuidBind)`
(`FhirServiceBase.php:223,240`); `getAll()` builds OpenEMR search fields via
`createOpenEMRSearchParameters()`, calls the subclass's
`searchForOpenEMRRecordsWithConfig()` (which for this class just forwards to
`PatientService::search()`, `FhirPatientService.php:924-943`), then maps
every returned row through `parseOpenEMRRecord()`
(`FhirPatientService.php:196-253`). Writes go the other direction:
`parseFhirResource()` (`:777-897`) turns an inbound `FHIRPatient` JSON body
into an OpenEMR-shaped array, which `insertOpenEMRRecord()`/
`updateOpenEMRRecord()` (`:905-922`) hand to `PatientService::insert()`/
`update()`.

**Neither class performs any authentication or authorization check.**
There is no `AclMain`, no scope check, no session read for permission
purposes anywhere in either file (`SessionWrapperFactory` is used only to
read `authUserID` for audit columns on insert/update, `PatientService.php:170,253`).
All gating happens one layer up, in the route closures — see Permission
checks below.

## Layout / interface

### `PatientService` public surface (callers in parentheses; `*` = only legacy PHP callers, no API route)

| Method | Signature | Callers |
|---|---|---|
| `findByPid($pid)` | `PatientService.php:655-666` | `*` legacy only (14 call sites, see above) — **no REST/FHIR route** |
| `search(array $search, $isAndCondition = true, ?SearchQueryConfig $config = null)` | `:418-523` | `FhirPatientService::searchForOpenEMRRecordsWithConfig()` (`:942`); `PatientService::getAll()` (self, `:415`) |
| `getAll(array $search = [], $isAndCondition = true, $puuidBind = null, ?SearchQueryConfig $config = null)` | `:392-416` | `PatientRestController::getAll()` (`PatientRestController.php:487`) — standard REST list |
| `getOne($puuidString)` | `:632-647` | `PatientRestController::getOne()`/`put()` (`:325,316`) — standard REST single |
| `getUuid(string $pid): false\|string` | `:696-699` (→ `BaseService::getUuidById()`) | `*` no route found (`grep -rn "getUuid(" src/RestControllers apis` — no hits) |
| `getPidByUuid($uuid)` | `:701-704` (→ `BaseService::getIdByUuid()`) | `*` legacy only |
| `getPatientAgeDisplay($dobYMD, $asOfYMD = null)` / `getPatientAge()` / `getPatientAgeYMD()` | `:718-863` | `demographics.php:925` (persistent-bar `str_dob`, via the `getPatientAgeDisplay()` legacy wrapper — see `ui/DASHBOARD-HEADER.md`) — **no route**; age is not a field the API returns at all (client computes it from `birthDate`) |
| `insert($data)` / `update($puuidString, $data)` | `:219-239`, `:307-357` | `PatientRestController::post()`/`put()`; `FhirPatientService::insertOpenEMRRecord()`/`updateOpenEMRRecord()` |
| `getProviderIDsForPatientPids(array)` / `getProviderIDsForPatientUuids(array)` | `:865-900` | not traced further (out of DB-02 scope); see Finding #7 |
| `touchRecentPatientList(array $patient)` / `getRecentPatientList(int $user_id = 0)` | `:939-1002` | `demographics.php:89` (write, on every `set_pid`); no route found for either direction |

### `FhirPatientService` public surface

| Method | Signature | Role |
|---|---|---|
| `parseOpenEMRRecord($dataRecord = [], $encode = false)` | `:196-253` | OpenEMR row → `FHIRPatient` (read path, both `getOne`/`getAll`) |
| `parseFhirResource(FHIRDomainResource $fhirResource)` | `:777-897` | `FHIRPatient` JSON → OpenEMR row array (write path only) |
| `insertOpenEMRRecord($openEmrRecord)` / `updateOpenEMRRecord($fhirResourceId, $updatedOpenEMRRecord)` | `:905-922` | delegate to `PatientService` |
| `searchForOpenEMRRecordsWithConfig($openEMRSearchParameters, SearchQueryConfig $config)` / `searchForOpenEMRRecords($openEMRSearchParameters)` | `:924-954` | delegate to `PatientService::search()`, with a gender-casing fixup (see Logic) |
| `loadSearchParameters()` (protected) | `:123-168` | the FHIR search-parameter → OpenEMR-field map (see API contract) |
| `getPatientContextSearchField(): FhirSearchParameterDefinition` | `:986-989` | returns `_id` bound to `uuid` — this is what `FhirServiceBase` uses to enforce a patient-context bind |
| `getSupportedVersions()` / `getProfileURIs()` | `:965-984` | US Core profile version negotiation (3.1.1 / 7.0.0 / 8.0.0), not patient-data-specific |
| ~20 private `parseOpenEMR*`/`extract*` methods | `:255-1080` | one per FHIR element/extension; narrated below |

## State

```text
PatientService (per-instance)
  patient_picture_fallback_id = -1     // constant fallback doc id when no photo (:82)
  patientValidator: PatientValidator   // built in constructor (:101)
  patientSuffixKeys: ?array = null     // lazy cache of translated suffix strings (:93, populated :921-927)

FhirPatientService (per-instance)
  patientService: PatientService       // built in constructor (:115)
  listService: ?ListService            // built in constructor (:116); lazy-rebuilt by getListService() if unset
  codeTypesService: CodeTypesService   // lazy, getCodeTypesService() (:991-997)
  searchParameters: ?array = null      // declared (:100) but never assigned anywhere in this file — dead property, see Finding #6
  cachedListOptions: array<string,array>       // per-request list_options cache, keyed list_id→option_id (:105, populated :540-549)
  cachedListOptionsByCode: array<string,array> // per-request cache, keyed list_id→code (:110, populated :514-534)
```

**Globals read:** `age_display_format`, `age_display_limit` (in
`PatientService::getPatientAgeDisplay()`, `:720-722`); `recent_patient_count`
(in `touchRecentPatientList()`, `:970`); `patient_photo_category_name` (in
`getPatientPictureDocumentId()`, `:681`). `FhirPatientService` reads no
globals directly (its translation calls `xl()` read globals internally but
that's out of this unit).
**Globals written:** none by either class.
**Session read:** `SessionWrapperFactory::getInstance()->getActiveSession()->get('authUserID')`
in `databaseInsert()`/`databaseUpdate()` (`:180,262`) — audit-column
population only, not a permission check.

## Logic

### `PatientService::findByPid($pid)` (`:655-666`)

`SELECT * FROM patient_data WHERE pid = ? LIMIT 1` via `BaseService::selectHelper()`
(itself `QueryUtils::selectHelper()`, not read further here). Returns the
raw associative row (`PatientDataRow`, including the binary `uuid` column
**not** converted to a string — contrast with `search()`/`getOne()`, whose
`createResultRecordFromDatabaseResult()` does that conversion, `:363-377`).
Callers that need the string uuid from `findByPid()`'s result must convert
it themselves; none of the legacy callers do (they only read `fname`/`lname`/
`pid`/etc.). **This method is what seeds `demographics.php`'s `$pid`-keyed
session/recent-patient-list state** (`demographics.php:83-91`,
`ui/DASHBOARD-MAP.md` §2 item 3) but, per the callers table above, has no
API equivalent at all — see Finding #3.

### `PatientService::search($search, $isAndCondition = true, ?SearchQueryConfig $config = null)` (`:418-523`)

Two-pass query, by design comment (`:420-423`): pass 1 selects only
`DISTINCT patient_data.uuid` matching the search (`$sqlSelectIds`/
`$sqlSelectIdsCount`, `:424-425`) against a query that LEFT JOINs
`patient_history` (previous names), a `users` subselect (`provider_uuid`),
and a `contact`/`contact_address`/`addresses` subselect (additional
addresses, `WHERE contact_address.status='A' AND contact.foreign_table_name='patient_data'`,
`:484-487`) — all 1:many joins, hence the two passes. `FhirSearchWhereClauseBuilder::build()`
(`:489`) turns the caller's `ISearchField` map into a bound WHERE fragment.
`SearchConfigClauseBuilder` (`:493-497`) builds `ORDER BY`/`LIMIT` from an
optional `SearchQueryConfig`, with `ALLOWED_SORT_COLUMNS`
(`PatientService.php:52-75`) as an explicit whitelist for `_sort` — this
directly answers "is `_sort` honored": **yes, for standard REST `GET
/api/patient`**, restricted to the 21 whitelisted columns (`id`, `pid`,
`pubpid`, `title`, `fname`, `lname`, `mname`, `DOB`, `sex`, `street`,
`city`, `state`, `postal_code`, `country_code`, `phone_home`, `phone_cell`,
`phone_biz`, `email`, `status`, `date`, `regdate`, `last_updated`); any
other `_sort` value is silently dropped by
`SearchConfigClauseBuilder::buildSortOrderClauseFromConfig()` (not read
line-by-line here — behavior inferred from the whitelist pattern, not
independently confirmed for the "invalid column" case).

If the uuid count is 0, returns an empty `ProcessingResult` immediately
(`:506-508`) — **no distinction between "search matched nothing" and "search
was malformed"**: both produce the same empty result, no error. Pass 2 then
re-runs a full `SELECT patient_data.*, ...` filtered to exactly those uuids
(`:509-519`, preserves the pass-1 `ORDER BY`), and
`hydrateSearchResultsFromQueryResource()` (`:525-579`) folds the flattened
join rows back into one array per patient with nested `previous_names[]`
and `addresses[]` arrays, deduping on `patient_history_uuid`/
`contact_address_id` as it goes (`:552-568`). `getPagination()->setTotalCount($uuidCount)`
(`:518`) is set from the pass-1 count query, independent of `LIMIT`/`OFFSET`
— so **pagination is honored** (total count is the true match count, not
the page size).

### `PatientService::getAll($search, $isAndCondition = true, $puuidBind = null, ?SearchQueryConfig $config = null)` (`:392-416`)

The public entry point standard REST `GET /api/patient` calls
(`PatientRestController::getAll()`). Builds `ISearchField`s from the raw
key/value `$search` array: `uuid` (from `$puuidBind` if given, else
`$search['uuid']`) as an exact `TokenSearchField`; a fixed list of 12
"wildcard" fields (`fname`, `mname`, `lname`, `street`, `city`, `state`,
`postal_code`, `title`, plus four `contact_address_*` fields) as
**`CONTAINS`** `StringSearchField`s (`:401-407`) — i.e. `fname=Zac` matches
`Zachary`; every other key not already handled becomes an **`EXACT`**
`StringSearchField` (`:408-413`) — i.e. `sex=Male` must match exactly, `DOB`
must match the literal stored string. **`$puuidBind` here is accepted but
is never actually wired to anything by the standard REST route** — see
Finding #4; only `FhirPatientRestController::getAll()`'s route closure ever
passes a real `$puuidBind` through this parameter's FHIR-service
equivalent.

### `PatientService::getOne($puuidString)` (`:632-647`)

`$this->patientValidator->isExistingUuid($puuidString)` (→
`PatientValidator.php:26-41`: converts to bytes, `SELECT uuid FROM
patient_data WHERE uuid = ?`, existence only, **no patient-context check of
any kind** — it will happily confirm any patient's uuid exists, not just
one the caller is scoped to). If invalid, returns a `ProcessingResult` with
a `validationMessages['uuid']` entry and no data — this is what produces
the standard REST 404 (`PatientRestController::getOne()` checks
`count($processingResult->getData()) == 0` itself, `PatientRestController.php:327-329`,
since `createProcessingResultResponse()` doesn't auto-404 on an empty
result — contrast with the FHIR path, which does, see API contract). If
valid, delegates to `search(['uuid' => new TokenSearchField('uuid',
[$puuidString], true)])` — same two-pass query as above, just constrained
to one uuid.

### `PatientService::getUuid()` / `getPidByUuid()` (`:696-704`)

Thin wrappers over `BaseService::getUuidById()`/`getIdByUuid()`
(`BaseService.php:387-408`): single-column `SELECT`, no join, no ACL. Note
`getUuidById()` returns the **raw binary** uuid column value (`sqlQuery()`
does no conversion) — the docblock on `PatientService::getUuid()` says so
explicitly ("otherwise return UUID (in binary form)", `:693-695`); a caller
needing the string form must call `UuidRegistry::uuidToString()` itself.
Neither method has any route (confirmed by grep); they exist purely for
internal legacy/service-to-service use.

### `PatientService::insert()` / `update()` / `databaseInsert()` / `databaseUpdate()` (`:168-357`)

Out of DB-02's read scope (the port is read-only per `AGENTS.md`/brief
DB-10) but worth one note for completeness: both dispatch `Before*`/`*Event`
Symfony events around the write (`BeforePatientCreatedEvent`/
`PatientCreatedEvent`, `BeforePatientUpdatedEvent`/`PatientUpdatedEvent`),
and `databaseUpdate()` additionally syncs `patient_access_onsite.portal_login_username`
when `allow_patient_portal === 'YES'` (`:280-288`) — a write side-effect
this audit didn't need to trace further since the port never calls these.

### `PatientService::parseSuffixForPatientRecord()` / `getPatientSuffixKeys()` (`:902-927`)

Called once per hydrated patient row, from `hydrateSearchResultsFromQueryResource()`
(`:544`), to populate `$patient['suffix']`. If the DB `suffix` column is
non-empty, returns it as-is (`:905-907`). Otherwise it tries to *detect* a
suffix embedded in `lname` (e.g. a legacy record where "Jr." was typed into
the last-name field instead of the dedicated column): it loops
`getPatientSuffixKeys()` — `['Jr.', ' Jr', 'Sr.', ' Sr', 'II', 'III', 'IV']`
translated via `xl()` (`:924`) — and on the first case-insensitive
substring match (`stripos()`, `:912`) sets `$suffix = $s` and attempts
`$result['lname'] = trim(str_replace($s, '', $patientRecord['lname']))`
(`:914`). **`$result` is never declared anywhere else in this function or
passed in — it is a brand-new local array that is discarded the instant the
function returns.** The stripped `lname` is never written back to
`$patientRecord`/`$patient` anywhere. See Finding #1: the detected suffix
*is* still returned and *is* still added to `HumanName.suffix` by
`FhirPatientService::parseOpenEMRPatientName()`, but `lname`/`family`
retains the original, suffix-embedded text — so the FHIR name for such a
patient carries the suffix twice, once inside `family` and once in
`suffix[]`.

### `FhirPatientService::parseOpenEMRRecord($dataRecord, $encode = false)` (`:196-253`)

The read-path entry point, called once per row by `FhirServiceBase::getAll()`.
Order of operations, each independently guarded by its own `!empty()`
check so a sparse record degrades gracefully rather than erroring:

1. `Meta` — version `'1'` (hardcoded, not derived from anything —
   OpenEMR patient rows have no revision counter this maps to),
   `lastUpdated` from `dataRecord['last_updated']` or "now" if absent
   (`:200-206`); attaches the versioned US Core profile URI(s) via
   `getProfileForVersions()` (`:207-209`).
2. `Patient.active = true`, **unconditionally, every row, no exceptions**
   (`:212`, confirmed the only `setActive`/`->active` reference anywhere in
   this file by full-file read and a targeted grep). This is the DB-02
   "active status" gap already recorded in `api/AUTH-AND-PATIENT.md` §2.3
   and `REQUIREMENTS-TRACE.md` DB-02 — re-confirmed here at the exact
   call site with no additional nuance (there is no config flag, no branch,
   nothing that could make this conditional).
3. `Patient.id` from `dataRecord['uuid']` (`:213-215`) — the string uuid,
   already converted by `PatientService::createResultRecordFromDatabaseResult()`
   before this method ever sees the row.
4. Narrative text, name, address, telecom, birth date, gender/birth sex,
   race, ethnicity, SSN identifier, public-patient (`pubpid`) identifier,
   communication (language), general practitioner — one call each,
   narrated individually below.
5. US Core 6.1.1/7.0.0/8.0.0 extensions: gender identity, `us-core-sex`,
   tribal affiliation, interpreter-needed.
6. Deceased date/boolean — the closest thing to an "active status" signal
   this record actually carries (see below).

### `FhirPatientService::parseOpenEMRPatientName()` (`:281-335`)

Builds exactly one **official** `HumanName` (`use='official'` hardcoded,
`:285` — matches the legacy UI's `OemrUI`/`getPatientFullNameAsString()`
convention of one canonical name, not the persistent bar's stripped-down
`fname+" "+lname`, per `ui/DASHBOARD-HEADER.md` Finding 2): `title` →
`prefix[0]` (`:287-289`), `lname` → `family` (`:290-292`), `fname` →
`given[0]` (`:294-296`), `mname` → `given[1]` (`:298-300`), `suffix` (the
`$patient['suffix']` value computed by `parseSuffixForPatientRecord()`
above — either the real DB column or the detected-in-`lname` fallback) →
`suffix[0]` (`:302-304`) — this is the exact point where Finding #1's
duplication happens. Then, if `previous_names` is non-empty (populated by
`PatientService::hydrateSearchResultsFromQueryResource()` from
`patient_history` rows of type `name_history`), one additional
`use='old'` `HumanName` per previous name, each with its own optional
`Period.end` from `previous_name_enddate` (`:308-333`). **This confirms and
extends `ui/DASHBOARD-HEADER.md`'s field map:** the API's name is the
*fuller* form (title/middle/suffix all included, like the legacy page-title
string), never the persistent bar's `fname+" "+lname`-only form — so a port
matching the API's `HumanName` by construction avoids the legacy
two-different-name-strings bug (`DASHBOARD-HEADER.md` Finding 2) rather
than needing to actively choose between the two legacy formats.

### `FhirPatientService::parseOpenEMRGenderAndBirthSex($patientResource, $sex)` (`:376-419`)

Two outputs from one input column (`patient_data.sex`, "sex at birth" per
schema comment): `Patient.gender` (FHIR's coarse `male`/`female`/`other`/
`unknown` enum, `:407-414`) and the `us-core-birthsex` extension (`M`/`F`/
`UNK`, or, on US Core ≥7.0.0, also `OTH`/`ASKU`/`asked-declined`,
`:384-399`) — the version branch is on
`getHighestCompatibleUSCoreProfileVersion()`, a site-wide setting, not
per-record. `$genderValue = strtolower((string) $sex) ?? 'unknown'`
(`:378`) — the `?? 'unknown'` is unreachable dead code (`strtolower((string)
$sex)` can never be PHP `null`; an absent `$sex` already defaults to the
string `'Unknown'` one call site up, `parseOpenEMRRecord()` line 223, so by
the time this function runs `$sex` is always at least `''`) — Finding #6,
Low.

**This is the field DB-02 means by "sex".** It is distinct from
`sex_identified` ("Patient reported current sex", mapped separately at
`:645-674` into the `us-core-sex` extension only — a different FHIR element
entirely, and one the legacy dashboard has no analog for anywhere, not even
in the Demographics card per this audit's reading of `dataRecord['sex_identified']`
usage). **Port note:** map DB-02's "sex" field to `Patient.gender` +
`us-core-birthsex`, sourced from `sex`, not `sex_identified`.

### `FhirPatientService::parseOpenEMRPublicPatientIdentifier()` / `parseOpenEMRSocialSecurityRecord()` (`:552-566`, `:493-512`)

Both call the shared `createIdentifier($use, $system, $code, $systemUri,
$value)` helper (`:754-769`). MRN (`pubpid`): type code `PT`, both the
identifier-type coding system *and* `identifier.system` set to the same
`http://terminology.hl7.org/CodeSystem/v2-0203` URI (`:557-563` —
confirmed odd but as-written; `api/AUTH-AND-PATIENT.md` already flagged
this). SSN (`ss`): type `SS`, `identifier.system =
http://hl7.org/fhir/sid/us-ssn`, only added if `ss` is non-empty
(`:501-511`) — not a DB-02 field but present in the same response.

### `FhirPatientService::loadSearchParameters()` (`:123-168`)

The full honored-parameter list for `GET /fhir/Patient`:
`_id` (bound to `uuid`, patient-context field), `identifier` (→ `ss` OR
`pubpid`), `name` (→ `fname`/`mname`/`lname`/`title`, fuzzy per
`SearchFieldType::STRING`), `birthdate` (→ `DOB`), `gender` (→ `sex`),
`address`/`address-city`/`address-postalcode`/`address-state` (→ the
patient's own columns *and* the joined `contact_address_*` columns —
i.e. matches either the primary address on `patient_data` or any
additional address row), `email`, `family` (→ `lname`), `given` (→
`fname`/`mname`), `phone`, `telecom`, `_lastUpdated` (→ `last_updated`),
`generalPractitioner` (→ `provider_uuid`, a reference search). **No search
parameter reaches the legacy integer `pid`/`id` columns** — this repeats
and re-confirms `api/AUTH-AND-PATIENT.md` §2.5's finding, now cited at the
exact source (`loadSearchParameters()`, not just inferred from the SQL).

### `FhirPatientService::searchForOpenEMRRecordsWithConfig()` (`:924-943`)

Before delegating to `PatientService::search()`, if a `gender` search field
was supplied it force-`ucfirst()`s every token value (`:929-939`) — i.e. a
client searching `gender=male` is silently rewritten to match the
DB-stored `'Male'` casing (`PatientService`'s own `EXACT` string match is
case-sensitive as written in `search()`, so without this fixup a
lowercase FHIR-spec-correct `gender=male` query would match zero rows).
This is a real, working accommodation, not a bug — noted because it's the
one place `FhirPatientService` mutates a search value rather than just
translating field names.

### `FhirPatientService::parseOpenEMRPatientDeceasedDateTime()` (`:741-752`)

`dataRecord['deceased_date']` non-empty → `Patient.deceasedDateTime` (UTC via
`UtilsService::getLocalDateAsUTC()`); otherwise → `Patient.deceasedBoolean(false)`
explicitly (never left unset). Since `PatientService::search()`'s data
query is `SELECT patient_data.*, ...` (`PatientService.php:426-440`), the
`deceased_date` column flows through automatically — no separate fetch or
join is needed for the port to get this field; it's present on the same
`Patient` payload as everything else. **This is the only real signal DB-02
can use for "active status"**, per `AUTH-AND-PATIENT.md`/`DASHBOARD-HEADER.md`,
now confirmed end-to-end: `patient_data.deceased_date` (schema) →
unconditional `SELECT *` (search SQL) → `parseOpenEMRPatientDeceasedDateTime()`
(mapping) → `deceasedDateTime`/`deceasedBoolean` (wire). Do not use
`Patient.active` for this (Finding, restated above — it is hardcoded and
carries zero information).

### `FhirPatientService::parseFhirResource()` (`:777-897`)

Write path only (POST/PUT), not used by the dashboard's read-only port, but
one detail worth recording since it explains an asymmetry: on read, `title`
is mapped from `HumanName.prefix[0]` in one direction; on write, the
docblock (`:805-806`) explicitly says title updates are unsupported
("requires updating another table which is breaking the service class...
never tested and never worked") — read and write are not symmetric for this
one field. Not relevant to the port (read-only) beyond noting it if anyone
later builds edit functionality against this same service.

## Permission checks

| Operation | Check present in this unit? | Where it actually happens | Notes |
|---|---|---|---|
| Any read/write in `PatientService`/`FhirPatientService` | **No** — neither class calls `AclMain`, checks a scope, or reads session role | Route closures only: `RestConfig::request_authorization_check($request, "patients", "demo")` for every standard REST patient route (`_rest_routes_standard.inc.php:77,85,93,100`) and every non-patient-context FHIR Patient route (`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:559,568,589`) | Same ACL pair the legacy page gate uses (`demographics.php:1056`) — see `api/AUTH-AND-PATIENT.md` §3.1 |
| Patient-context isolation, FHIR | **No** (service-level) | Route closure branches on `$request->isPatientRequest()`: `GET /fhir/Patient` forces `_id`/`puuidBind` to the token's own uuid (`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:578-591`); `GET /fhir/Patient/:uuid` throws `AccessDeniedException` if the requested uuid doesn't equal the token's own (`:608-620`) | Enforced entirely outside this unit, in the route file |
| Patient-context isolation, standard REST | **Missing entirely** | `GET /api/patient` / `GET /api/patient/:puuid` (`_rest_routes_standard.inc.php:76-104`) have no `isPatientRequest()` branch, no uuid-bind, nothing — see Finding #4 | Mitigated (not eliminated) by a role gate one layer further out — see Finding #4 |
| "Who can list whom" | **No restriction found** | `PatientService::search()` applies no implicit filter beyond the caller's own search array; any `users`-role token with `patients/demo` ACL (the lowest clinical ACL in the system) can list every patient | See Finding #5 |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `patient_data` | yes (`SELECT *` + derived columns) | yes (`insert`/`update`) | `search()`, `findByPid()`, `databaseInsert()`, `databaseUpdate()` | No — each is a single statement, no explicit transaction wrapping |
| `patient_history` | yes (previous names) | no (not in this unit) | `search()` LEFT JOIN, `:443-457` | n/a |
| `users` | yes (`provider_uuid` join) | no | `search()` LEFT JOIN, `:458-463` | n/a |
| `contact`, `contact_address`, `addresses` | yes (additional addresses) | no | `search()` LEFT JOIN, `:464-487` | n/a |
| `list_options` | yes (race, ethnicity, language, gender identity, `administrative_sex`, `tribal_affiliations`, `yes_no_unknown`) | no | `FhirPatientService::getCachedListOption()`/`getCachedListOptionByCode()` → `ListService::getOptionsByListName()` (not independently re-read here) | n/a |
| `recent_patients` | yes | yes (`ON DUPLICATE KEY UPDATE`) | `touchRecentPatientList()` (`:944-975`), `getRecentPatientList()` (`:988-1002`) | No |
| `patient_access_onsite` | yes | yes (conditional) | `databaseUpdate()` (`:280-288`) — only if `allow_patient_portal === 'YES'` | No |
| `chart_tracker`, `cttemp` | yes | no | `getChartTrackerInformation*()` (static, unrelated to DB-02) | n/a |

## Cross-links

- **Opened by:** `demographics.php` (`findByPid`, `touchRecentPatientList`,
  `getPatientAgeDisplay` via legacy wrapper — see `ui/DASHBOARD-HEADER.md`
  and `ui/DASHBOARD-MAP.md` §2); `PatientRestController`
  (`src/RestControllers/PatientRestController.php`); `FhirPatientRestController`
  (`src/RestControllers/FHIR/FhirPatientRestController.php`).
- **Calls into:** `BaseService` (`selectHelper`, `getUuidById`,
  `getIdByUuid`); `FhirServiceBase` (search/getAll/getOne orchestration);
  `ListService`, `CodeTypesService`; `UuidRegistry`; `PatientValidator`;
  `FhirSearchWhereClauseBuilder`, `SearchConfigClauseBuilder`.
- **Related units:** `api/AUTH-AND-PATIENT.md` §2 (this audit confirms and
  extends its field map and its §2.5 pid↔uuid conclusions), `ui/DASHBOARD-HEADER.md`
  (this audit confirms its `Patient.active`/deceased findings end-to-end
  through the search SQL) — no corrections to either, only confirmations
  and additional detail.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Bug | Medium | `parseSuffixForPatientRecord()`'s attempt to strip a detected suffix out of `lname` writes to an undeclared local `$result['lname']` that is immediately discarded — it has no effect. A patient whose suffix was typed into the `lname` field (not the dedicated `suffix` column) gets that suffix rendered twice in FHIR output: once inside `family` (unmodified) and once in `HumanName.suffix[]` (correctly detected). | `PatientService.php:902-919` (dead write); `FhirPatientService.php:290-304` (`family`=lname unmodified, `suffix` added separately) | Port: don't rely on FHIR `family` being suffix-free; if displaying `family`+`suffix` together, check for the substring already being present, or just display `family` as-is (which already reads naturally, e.g. "Smith Jr") |
| 2 | Half-implemented | Medium | `findByPid($pid)` — the function that resolves a legacy integer `pid` to a full patient row, and the only thing `demographics.php` calls on `set_pid` — has **zero** REST/FHIR route (confirmed by full-repo grep of `src/RestControllers` and `apis/`). No search parameter on either API surface maps to the raw `pid`/`id` column either (`loadSearchParameters()`, `FhirPatientService.php:123-168`; standard REST `SUPPORTED_SEARCH_FIELDS`, `PatientRestController.php:137-153` — neither lists `pid` or `id`). | `PatientService.php:655-666`; confirmed via `grep -rn findByPid src/ apis/` | Port: the SPA's deep-link scheme must be built on `uuid` (or `pubpid` via `identifier=`), never a bare legacy `pid`. If a `pid`-based deep link must be supported (e.g. bookmarks from the old app), it needs a one-time manual lookup path David explicitly approves — there is no API for it today |
| 3 | Security (provisional) | Medium | Standard REST `GET /api/patient` and `GET /api/patient/:puuid` apply only the `patients/demo` ACL check — no patient-context uuid bind, no `isPatientRequest()` branch at all — unlike every FHIR Patient-compartment route, which does bind. In isolation this looks like a missing authorization check that would let a patient-context token read/list any patient. Traced further: `BearerTokenAuthorizationStrategy::isValidRequestForUserRole()` blocks `userRole === 'patient'` tokens from `/api/*` entirely (only `/portal/*` and `/fhir/*` are allowed for that role), so the gap is not reachable by a genuine patient-context token today — but it is a structural inconsistency, not a designed decision documented anywhere in this code. | `_rest_routes_standard.inc.php:76-104` (no bind); contrast `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:578-620` (binds); mitigating gate: `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php:365-396` | Not a port action item (the SPA only needs read access as a `users`-role client); flag for the security catalog — a future change to `isValidRequestForUserRole()` or a new route alias could make this reachable with no additional review |
| 4 | Parity / access-model note | Low (informational, answers the brief's question) | `PatientService::search()` applies no default patient-scoping filter of any kind. Combined with Finding #3's non-patient routes and the FHIR non-patient-context branch (`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:578-591`, `puuidBind=null`), **any bearer token whose user has the `patients/demo` ACL — the lowest, most broadly granted clinical ACL section in the system — can list every patient in the EHR** via `GET /fhir/Patient` or `GET /api/patient` with no query params. There is no facility, squad, or assigned-provider restriction at the API layer; the legacy UI's own `squad` concept has no server-side API equivalent at all (matches `ui/README.md` U-9, which already found the squad check to be non-functional even in the legacy UI). | `PatientService.php:392-523` (no implicit WHERE); routes cited above | Not a port defect — this is existing, unchanged production behavior, and matches the legacy Patient Finder's own scope. Record in the port's access-model documentation so nobody mistakes the API's openness for a port-introduced regression |
| 5 | Smell | Low | `strtolower((string) $sex) ?? 'unknown'` — the null-coalescing fallback is unreachable dead code; `strtolower((string) $sex)` is never PHP `null`. | `FhirPatientService.php:378` | Drop the `?? 'unknown'`; behavior is unaffected either way (verified: the eventual `match` already has a `default` branch) |
| 6 | Smell | Low | `FhirPatientService::$searchParameters` is declared (`private ?array $searchParameters = null;`) but never read or written anywhere in this 1,081-line file. | `FhirPatientService.php:100` | Remove the dead property, or confirm a parent class relies on the name existing (not checked) |
| 7 | Bug (edge case, unconfirmed reachability) | Low | `getProviderIDsForPatientUuids(array $patientUuids)` builds a bind-placeholder string with `str_repeat("?,", count($patientUuids) - 1)`; PHP 8 `str_repeat()` throws `ValueError` for a negative `$times`, so calling this with an **empty** array throws instead of returning `[]`. The sibling `getProviderIDsForPatientPids()` has the analogous problem via `implode(",", $pids)` producing `WHERE pid IN ()`, a SQL syntax error, for empty input. Callers were not traced (out of DB-02 scope), so real-world reachability is unconfirmed. | `PatientService.php:865-900` | Guard both with an early `if (empty($patientPids/$patientUuids)) return [];` |

No Critical findings. Two Medium items (#1, #3) provisional per tier-2 rules — `Escalate: yes` on #3 specifically (possible missing authorization check pattern); #1 is a confirmed, reproducible code-read finding (not provisional) but rated Medium rather than High since its worst effect is a cosmetically duplicated name suffix, not a security or data-integrity issue.

## Port notes

- **Must survive:**
  - Patient identity resolved by `uuid` only (or `pubpid`/`ss` via
    `identifier=` search) — never the legacy integer `pid`. Finding #2 is
    the reason this is a hard requirement, not a preference.
  - DB-02's name/DOB/MRN/sex all come from the *same* `FHIRPatient`
    resource, one API call (`GET /fhir/Patient/:uuid` or `GET
    /api/patient/:puuid`) — no cross-card stitching needed, unlike the
    legacy app's split between `dashboard_header.php`, the persistent bar's
    `setMyPatient()` JS, and the Demographics card (`ui/DASHBOARD-HEADER.md`).
  - "Active status": derive purely from `deceasedDateTime`/`deceasedBoolean`
    presence. Never read `Patient.active` — it is unconditionally `true`
    and asserts nothing (confirmed the sole `setActive()` call in the file).
- **Must not survive:**
  - Don't replicate the `lname`-suffix duplication (Finding #1) — if the
    port ever needs to strip a suffix substring out of a displayed family
    name, do it client-side deliberately, don't assume the API already did.
  - Don't assume a `pid`-based URL/query parameter will ever resolve via
    this API (Finding #2) — there is no code path for it today, on either
    the standard or FHIR surface.
- **Open questions:**
  - Does David want the SPA's own patient-search/typeahead (if any card
    needs one) to reproduce the API's unrestricted "list everyone with
    `patients/demo`" scope as-is, or add a client-side narrowing (e.g. to
    recently-viewed patients)? The API gives the port no way to narrow this
    server-side without a backend change (out of scope per DB-10).
  - Confirm with a live token (once OAuth2 client registration is set up,
    per A5) whether `GET /fhir/Patient?_sort=lname` actually orders
    results — `ALLOWED_SORT_COLUMNS` supports it in principle
    (`PatientService.php:52-75`) but this audit is read-only and could not
    execute a request.
  - `refills`-style "silently dropped column" bugs exist elsewhere in this
    codebase (DB-06, per `api/CLINICAL-CARDS.md`); this audit found no
    DB-02 field with the same problem — every field the brief lists
    (name, DOB, sex, MRN) is confirmed present in the FHIR/REST response.
    Only "active status" is absent, and that is a schema gap (no column
    means it), not a query bug.
