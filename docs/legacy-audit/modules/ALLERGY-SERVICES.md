# Allergy services — data access + two REST surfaces for DB-03 (Allergies)

This unit is the code the port's SPA must call to reproduce the PHP dashboard's
Allergies card. There is exactly one data-access class,
`OpenEMR\Services\AllergyIntoleranceService`, and it is shared verbatim by the
PHP card, the standard REST surface (`/api/allergy`,
`/api/patient/:puuid/allergy`), and the FHIR surface (`/fhir/AllergyIntolerance`)
— all three read the same SQL. The two REST controllers
(`AllergyIntoleranceRestController`, `FhirAllergyIntoleranceRestController`)
are thin: they parse route params, call the service, and hand the
`ProcessingResult` to `RestControllerHelper`. `FhirAllergyIntoleranceService`
sits in between the FHIR controller and the shared service, translating rows
to `FHIRAllergyIntolerance` resources.

Control reaches this unit three ways: (1) `demographics.php:1115-1118` builds
`new AllergyIntoleranceService()` directly and calls `getAll()`; (2) an HTTP
`GET /api/patient/:puuid/allergy` request routes through
`apis/routes/_rest_routes_standard.inc.php:265-270` into
`AllergyIntoleranceRestController::getAll()`; (3) an HTTP
`GET /fhir/AllergyIntolerance` request routes through
`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:73-84` into
`FhirAllergyIntoleranceRestController::getAll()` → `FhirAllergyIntoleranceService::getAll()`
(inherited from `FhirServiceBase::getAll()`, `src/Services/FHIR/FhirServiceBase.php:240-296`)
→ `AllergyIntoleranceService::search()`. All three paths terminate in the same
`SELECT` at `AllergyIntoleranceService.php:52-98`; the divergence the port has
to bridge is entirely in what happens *after* the rows come back (filtering,
shaping, coarsening), not in what rows are fetched.

**Source:**
- `src/Services/AllergyIntoleranceService.php` · 375 lines
- `src/Services/FHIR/FhirAllergyIntoleranceService.php` · 266 lines
- `src/RestControllers/AllergyIntoleranceRestController.php` · 302 lines
- `src/RestControllers/FHIR/FhirAllergyIntoleranceRestController.php` · 228 lines
- No header version/date fields present in any of the four files.

**Audited by:** tier 2 · confidence high · no escalation to a stronger model
requested beyond the provisional-severity rule below.

This doc confirms and extends `api/CLINICAL-CARDS.md`'s DB-03 section (Phase
1, read-only-at-the-time). Every claim below was re-read from source for this
pass; corrections to Phase 1 are called out explicitly where found.

## Purpose & lifecycle

`AllergyIntoleranceService` is a `BaseService` subclass
(`AllergyIntoleranceService.php:25`) whose table is `lists`
(`ALLERGY_TABLE = "lists"`, `:27`). It has no request/response lifecycle of
its own — it is instantiated fresh per call site (no singleton, no DI
container) and does one of: `search`/`getAll`/`getOne` (read), `insert`,
`update`, `delete` (write). The port only needs the read paths.

Every constructor call — including a pure read — invokes
`UuidRegistry::createMissingUuidsForTables([lists, patient_data, users,
facility])` (`:39-40`). `createMissingUuidsForTables()`
(`src/Common/Uuid/UuidRegistry.php:229-234`) loops each table and calls the
private `createMissingUuids()` (`:295-`), which opens
`QueryUtils::startTransaction()` and scans for rows with a null/empty/all-zero
UUID, backfilling them. The class's own newer, narrower sibling
(`createMissingUuidForRow` or similar, per the docblock at `:236-249`) exists
specifically to let request-scoped code avoid triggering a "whole-table
backfill across every row missing a UUID" on every authenticated request —
but `AllergyIntoleranceService`'s constructor still uses the wide,
whole-table form on all four tables, on every single call including a plain
`GET /api/allergy`. See Finding 1.

Two REST controllers wrap the service for HTTP:

- `AllergyIntoleranceRestController` (standard REST, JSON shape defined by
  `RestControllerHelper::handleProcessingResult`) — read + write.
- `FhirAllergyIntoleranceRestController` (FHIR R4, `FHIRAllergyIntolerance`
  resources inside a `Bundle`) — read only; no FHIR write route is registered
  for this resource (`grep -n AllergyIntolerance apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`
  shows only the two `GET` entries at `:73,85`).

`FhirAllergyIntoleranceService` is stateless per-request: it is `new`'d
inside `FhirAllergyIntoleranceRestController::__construct()`
(`FhirAllergyIntoleranceRestController.php:30`) and internally `new`'s its
own `AllergyIntoleranceService` (`FhirAllergyIntoleranceService.php:52`) — so
a FHIR list request pays the UUID-backfill cost from *both* layers'
constructors in sequence (the FHIR controller doesn't own an
`AllergyIntoleranceService` itself, but the `FhirAllergyIntoleranceService`
it wraps does).

## Layout / interface (public surface)

### `AllergyIntoleranceService` (`src/Services/AllergyIntoleranceService.php`)

| Method | Signature | Callers (confirmed by search) |
|---|---|---|
| `search` | `search(array $search, $isAndCondition = true): ProcessingResult` (`:44`) | `getAll` (`:228`); `FhirAllergyIntoleranceService::searchForOpenEMRRecords` (`FhirAllergyIntoleranceService.php:254`) |
| `getAll` | `getAll(array $search = [], $isAndCondition = true, $puuidBind = null): ProcessingResult` (`:151`) | `demographics.php:1117`; `AllergyIntoleranceRestController::getAll` (`:190`) |
| `getOne` | `getOne($uuid, $puuidBind = null): ProcessingResult` (`:238`) | `AllergyIntoleranceRestController::getOne` (`:77`) |
| `insert` | `insert($data): ProcessingResult` (`:254`) | `AllergyIntoleranceRestController::post` (`:225`) |
| `update` | `update($uuid, $data): ProcessingResult` (`:300`) | `AllergyIntoleranceRestController::put` (`:266`) |
| `delete` | `delete($puuid, $uuid): ProcessingResult` (`:343`) | `AllergyIntoleranceRestController::delete` (`:299`) |

No other callers of `AllergyIntoleranceService` exist outside these two
controllers and `demographics.php` (`grep -rn "new AllergyIntoleranceService"
src/ interface/ apis/` — three hits, all three cited above).

### `FhirAllergyIntoleranceService` (`src/Services/FHIR/FhirAllergyIntoleranceService.php`)

Implements `IResourceUSCIGProfileService`, `IPatientCompartmentResourceService`,
`IFhirExportableResourceService` (`:35`). Public surface is mostly inherited
from `FhirServiceBase` (`getAll`, `getOne`, `insert`, `update` — the last two
are inherited but have no route wired to them, see above). Overrides:

| Method | Signature | Purpose |
|---|---|---|
| `loadSearchParameters` | `protected loadSearchParameters()` (`:59`) | registers `patient`, `_id`, `_lastUpdated` |
| `parseOpenEMRRecord` | `parseOpenEMRRecord($dataRecord = [], $encode = false)` (`:101`) | row → `FHIRAllergyIntolerance` |
| `searchForOpenEMRRecords` | `protected searchForOpenEMRRecords($openEMRSearchParameters): ProcessingResult` (`:252`) | delegates to `AllergyIntoleranceService::search()` |
| `createProvenanceResource` | `createProvenanceResource($dataRecord, $encode = false)` (`:80`) | only reachable via `_revinclude=Provenance:target` |
| `getProfileURIs` / `getPatientContextSearchField` | `:257`, `:262` | US Core profile + patient-compartment binding |

`FhirAllergyIntoleranceService` does **not** override
`searchForOpenEMRRecordsWithConfig()`. `FhirServiceBase::getAll()`
(`FhirServiceBase.php:262-269`) only calls the config-aware path when the
caller supplies a `_config` search parameter (built from `_sort`/`_count` by
`SearchQueryConfig::createFhirConfigFromSearchParams`); otherwise it falls
straight through to plain `searchForOpenEMRRecords()`. Since this class
inherits the base `searchForOpenEMRRecordsWithConfig()`
(`FhirServiceBase.php:313-316`), which **ignores** the `SearchQueryConfig`
argument and just calls `searchForOpenEMRRecords()` unmodified, `_sort` and
`_count` on `GET /fhir/AllergyIntolerance` are accepted by the framework
(no error) but have **no effect** on ordering or page size — every matching
row comes back in one response. See Finding 2 / API contract section.

### `AllergyIntoleranceRestController` (`src/RestControllers/AllergyIntoleranceRestController.php`)

| Method | Route(s) | Notes |
|---|---|---|
| `getOne($uuid)` (`:75`) | `GET /api/allergy/:auuid` (`_rest_routes_standard.inc.php:259`) | 404 via `handleProcessingResult(...,404)` when 0 rows (`:79-81`) |
| `getAll($search = [])` (`:188`) | `GET /api/allergy` (`:253`, called with **no args** — see below); `GET /api/patient/:puuid/allergy` (`:265`, called with `['puuid'=>$puuid]`); `GET /api/patient/:puuid/allergy/:auuid` (`:271`, called with `['puuid'=>$puuid,'allergy_uuid'=>$auuid]`) | |
| `post($puuid, $data)` (`:221`) | `POST /api/patient/:puuid/allergy` (`:278`) | whitelists `title,begdate,enddate,diagnosis,comments` (`:38-44`) |
| `put($puuid, $uuid, $data)` (`:263`) | `PUT /api/patient/:puuid/allergy/:auuid` (`:285`) | same whitelist |
| `delete($puuid, $uuid)` (`:297`) | `DELETE /api/patient/:puuid/allergy/:auuid` (`:292`) | |

**Confirmed gap, not previously called out in Phase 1's field-level detail:**
the OpenAPI annotations on `getAll()` (`:90-133`) document `title`, `begdate`,
`enddate`, `diagnosis` as query-string search parameters, but neither route
lambda that serves a collection GET (`:253`, `:265`) passes
`$request->getQueryParams()` (or anything derived from the query string) into
`getAll()` — `:255` calls `->getAll()` with zero arguments and `:267` calls
`->getAll(['puuid' => $puuid])`. The documented filter parameters are dead:
there is no code path by which a client's `?title=...` query string ever
reaches `AllergyIntoleranceService::search()`. This is the same pattern
`api/CLINICAL-CARDS.md` flagged for `/api/medical_problem`
(`ConditionRestController`, same file `:209-231`) — confirmed here to also
apply to `/api/allergy` and `/api/patient/:puuid/allergy`, i.e. it is a
route-wiring convention across this REST surface, not an allergy-specific
bug. **No pagination parameters (`_offset`/`_limit`) are read either** for
this endpoint — `getAll()`'s `$isMultipleResultResponse=true` branch in
`RestControllerHelper::handleProcessingResult` (`:226-243`) builds pagination
links from `$processingResult->getPagination()`, but
`AllergyIntoleranceService::search()` never calls `setPagination()` on its
`ProcessingResult` (`:109-137`), so the `links` key in the response is always
built from an unset/default pagination object. Not independently re-verified
against `ProcessingResult`'s default; flagged as an open question below
rather than a claim.

### `FhirAllergyIntoleranceRestController` (`src/RestControllers/FHIR/FhirAllergyIntoleranceRestController.php`)

| Method | Route(s) | Notes |
|---|---|---|
| `getOne($fhirId, $puuidBind = null)` (`:136`) | `GET /fhir/AllergyIntolerance/:uuid` (`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:85`) | patient-context requests bind `$puuidBind` from the token (`:86-92`); non-patient requests re-check ACL (`:90`) |
| `getAll($searchParams, $puuidBind = null)` (`:212`) | `GET /fhir/AllergyIntolerance` (`:73`) | same patient-context branching (`:75-81`); builds a `Bundle` (`:224`) |

## State

No module-level state in any of the four files (all methods are effectively
pure given their constructor-injected collaborators). The only persistent
side effect on the read path is the UUID backfill described above (a DB
write triggered by object construction, not by the read call itself).

**Globals read:** none directly in these four files. `sqlFetchArray`,
`sqlInsert`, `sqlStatement` (legacy global functions,
`AllergyIntoleranceService.php:107,113,275,325,363`) read the ADODB
connection via `$GLOBALS`/legacy bootstrap, but that is `library/`
infrastructure, not this unit's own state.
**Globals written:** none.

## Logic

### `AllergyIntoleranceService::search()` (`:44-138`)

Builds one SQL statement (`:52-98`) that:

- Wraps `lists` in a derived table aliasing `pid AS patient_id` (`:67-69`) —
  this is what lets a caller search by either `patient_id` (the PHP card's
  path, via `getAll()`'s `lists.pid` → `patient_id` rename, `:155-158`) or by
  a `puuid`-derived `patient.pid` join (the REST/FHIR path).
- Self-joins `lists` again as `allergy_ids` (`:70-72`) purely to expose
  `uuid` as a column name that isn't `lists.uuid` — the comment at `:46-50`
  explains this is a workaround so `FhirSearchWhereClauseBuilder` has
  distinct column names to bind against per search field.
- `LEFT JOIN list_options` twice: once for `reaction` (`list_id='reaction'`,
  `:73`), once for `verification`
  (`list_id='allergyintolerance-verification'`, `:74-75`) — note this is a
  **different** `list_options` list than the severity label lookup
  (`severity_ccda`, used only by the Twig template via `getListItemTitle()`,
  not by this SQL at all — severity is returned as the raw `severity_al`
  code by every code path in this unit; the human-readable label is a
  template-side lookup with no SQL dependency here).
- `RIGHT JOIN` a `patient_data` subquery (`:76-82`) — a `RIGHT JOIN`, not
  `INNER`/`LEFT`, meaning the query's driving table for cardinality purposes
  is actually `patient_data`, not `lists`. In practice this doesn't produce
  patient rows with no allergies (there's no `WHERE type='allergy'` row
  returned for such a patient), but it is worth noting for anyone
  restructuring this SQL later — it is not the "join a filter table onto the
  facts" shape it looks like at a glance.
- `LEFT JOIN users` (practitioner) and `LEFT JOIN facility` (organization),
  both keyed on legacy string columns (`lists.user = users.username`,
  `:83-91`; `practitioners.organization = facility.name`, `:92-98`) rather
  than IDs — a data-quality risk (renamed users/facilities silently break the
  join) but out of scope for the port since these fields aren't on the
  card.
- **No `ORDER BY` anywhere in this statement.** Confirms `api/CLINICAL-CARDS.md`
  and `ui/README.md` Finding 9: row order is whatever MySQL's query planner
  returns for this particular join shape, not a designed sort. Because the
  PHP-card path (`patient_id` predicate) and the API path (`puuid` predicate)
  execute the *same* join structure and differ only in which derived column
  the `WHERE` clause binds against, they are likely to return rows in the
  same order in practice — but neither is guaranteed, and nothing in the code
  makes that guarantee explicit. **Port must not assume a stable sort; treat
  API order as PHP-card order (per prior audit's decision) but do not build
  logic that depends on it.**
- Forces `search['type'] = new StringSearchField('type', ['allergy'],
  SearchModifier::EXACT)` (`:101`) unconditionally, after `$search` is
  otherwise built — a caller cannot override `type` to see other list types
  through this service; this is also why `search()` can't be reused for
  Medical Problems/Medications, unlike what a naive read of `CLINICAL-CARDS.md`'s
  "same data-access layer" framing might suggest at first glance — each `lists`
  type has its own service class with the type hardcoded in its own `search()`.
- `FhirSearchWhereClauseBuilder::build($search, $isAndCondition)` (`:103`)
  turns the search array into a bound `WHERE` fragment — this is the piece
  that would need to support `_sort`/`_count`/paging for those to work; it
  does the binding, not the config application (see FHIR search-config gap
  above).

The result loop (`:112-136`) does three things worth flagging for the port:

1. Converts every UUID-bearing column from binary to string
   (`UuidRegistry::uuidToString`, `:114-123`).
2. Re-codes `diagnosis` and `reaction` into structured coding arrays via
   `addCoding()` (`BaseService.php:551-573`) **only when non-empty**
   (`:124-129`) — so a plain standard-REST client reading `reaction` off the
   JSON body sometimes gets the raw `list_options` option id (string) and
   sometimes gets a `{code: {code, description, code_type, system}}` map,
   depending on whether `reaction_codes` was populated for that
   `list_options` row. `reaction_title` (the joined `list_options.title`) is
   the one field that is reliably a plain string in every case — the SPA
   should prefer it over `reaction` for display.
3. **De-duplicates by uuid** (`:131-135`, `$temp_uuid_array`) — the code
   comment (`:110-111`) says this compensates for the query returning
   duplicate rows "if allergies do not have a user associated" (i.e. the
   `LEFT JOIN users`/`facility` chain can fan out). This is a correctness
   guard, not an optimization; a port re-implementing this query without the
   same de-dup would risk duplicate rows for allergies with no recorded
   practitioner.

### `AllergyIntoleranceService::getAll()` (`:151-229`)

Normalizes caller-supplied keys before delegating to `search()`:
`lists.pid` → `patient_id` (`:155-158`, this is the PHP card's exact call
shape, `demographics.php:1117`), `lists.id` → `allergy_uuid` (`:159-162`),
and validates `puuid`/`allergy_uuid` as real UUIDs via
`AllergyIntoleranceValidator::validateId()` (`:164-187`) before converting
them to `TokenSearchField`s (`:202-213`). If validation fails, `getAll()`
returns the validator's `ProcessingResult` directly (`:172,185,198`) — i.e.
**a malformed `puuid` or `allergy_uuid` short-circuits before any SQL runs**
and surfaces as a `validationErrors` 400 through the controller (see Error
paths below), not a 404 or 500.

### `AllergyIntoleranceService::insert/update/delete()` (`:254-374`)

Not on the port's read path (dashboard is read-only), documented briefly for
completeness. `insert()` (`:254`) validates via
`AllergyIntoleranceValidator::DATABASE_INSERT_CONTEXT`, resolves `pid` from
`puuid` (`:265-266`), hardcodes `activity=1, type='allergy'` on the raw SQL
(`:270-274`) — bypassing the whitelist for those two columns, i.e. a caller
cannot create an inactive allergy through this endpoint regardless of
payload. `update()` (`:300`) and `delete()` (`:343`) both scope their SQL
with `AND type='allergy'` (`:321`, `:361`) so a uuid belonging to a
non-allergy `lists` row cannot be mutated through this service even if
guessed. None of the three wraps its own SQL in an explicit transaction
(no `QueryUtils::startTransaction()` in `insert`/`update`/`delete` bodies) —
each is a single autocommit statement; not transactional in the
multi-statement sense, but each statement is also self-contained so this is
not a correctness gap on its own.

### `FhirAllergyIntoleranceService::parseOpenEMRRecord()` (`:101-244`)

Row-by-row mapping, the piece that determines everything the FHIR surface
diverges from the PHP card and from standard REST on:

- **`clinicalStatus`** (`:117-122`):
  ```php
  $clinicalStatus = "inactive";
  if ($dataRecord['outcome'] == '1' && isset($dataRecord['enddate'])) {
      $clinicalStatus = "resolved";
  } elseif (!isset($dataRecord['enddate'])) {
      $clinicalStatus = "active";
  }
  ```
  Three-way, `enddate`-presence-driven, and **it never inspects whether
  `enddate` is in the future** the way `filterActiveIssues()`
  (`demographics.php:1110-1113`) does. Compare the two rules directly:

  | Row shape | `filterActiveIssues()` (PHP card) | FHIR `clinicalStatus` |
  |---|---|---|
  | `outcome != 1`, no `enddate` | kept (active) | `active` |
  | `outcome != 1`, `enddate` in the future | kept (active) | **`inactive`** — any set `enddate` falls through both branches to the `"inactive"` default, regardless of when it falls |
  | `outcome != 1`, `enddate` in the past | dropped | `inactive` |
  | `outcome == 1` (resolved), no `enddate` | dropped | `active` — the `elseif` branch only checks `enddate` presence, not `outcome`, so a resolved allergy with no `enddate` reads as FHIR-`active` |
  | `outcome == 1`, `enddate` set | dropped | `resolved` |

  Two of five combinations disagree with the PHP card's own filter. A client
  that filters on FHIR `clinicalStatus == active` to reproduce the Allergies
  card will get a **different row set** than `filterActiveIssues()` produces
  from the same underlying data, in both directions (it will drop a
  future-dated-enddate row the card shows, and it will show a resolved,
  no-enddate row the card hides). This is a stronger, more precise version of
  the divergence `CLINICAL-CARDS.md` already flagged qualitatively — confirmed
  by tracing both rules field-by-field here. **Port must not use FHIR
  `clinicalStatus` to reproduce `filterActiveIssues()`; it must re-implement
  the PHP predicate client-side against the raw `outcome`/`enddate` fields,
  which standard REST returns unmodified.**

- **`criticality`** (`:138-152`): a fixed 8-entry lookup table maps every
  known `severity_al` option (`mild`, `mild_to_moderate`, `moderate`,
  `moderate_to_severe`, `severe`, `life_threatening_severity`, `fatal`,
  `unassigned`) down to FHIR's 3-value `AllergyIntoleranceCriticality`
  enum (`low`/`high`/`unable-to-assess`). This confirms
  `CLINICAL-CARDS.md`'s "coarsened to 3 buckets" claim precisely: `mild`
  through `moderate` all collapse to `low`; `moderate_to_severe` through
  `fatal` all collapse to `high`. The PHP card's warning highlight
  (`severity in {severe, life_threatening_severity, fatal}` →
  `bg-warning`, `allergies.html.twig:38,40`) and this FHIR bucketing are
  **not the same partition**: `moderate_to_severe` is FHIR-`high` but is
  **not** in the PHP card's highlight set. A port driven by FHIR
  `criticality` alone would highlight (or fail to highlight) different rows
  than the PHP card. Standard REST does not have this problem — it returns
  raw `severity_al` untouched (confirmed: `AllergyIntoleranceService::search()`
  never rewrites `severity_al`, `:52-136`), so the port should read raw
  `severity_al` for both the label and the highlight rule, not FHIR
  `criticality`, matching `CLINICAL-CARDS.md`'s summary row.
- **The seeded `severity_al='1'` rows are not just a label-fallback
  cosmetic issue on the FHIR surface — they hit an unguarded array
  access.** `$criticalityCode[$dataRecord['severity_al']]['code']`
  (`:150`) has no entry for `'1'` (`'1'` is not a key in the map at
  `:140-148`; it is a legacy/import numeric code, not one of the eight
  `severity_ccda` option strings the map expects — this matches
  `ui/LAYOUTS-UTILS.md`'s finding that `severity_al='1'` has no
  `severity_ccda` `list_options` row either, i.e. it's stored as a raw code
  that was never a valid option in either the UI's list nor this map).
  `$criticalityCode['1']` evaluates to `null` (PHP 8.2: "Undefined array
  key" warning, not fatal), and `null['code']` evaluates to `null` again
  ("Trying to access array offset on value of type null" warning, not
  fatal). `FHIRAllergyIntoleranceCriticality::setValue(null)`
  (`src/FHIR/R4/FHIRElement/FHIRAllergyIntoleranceCriticality.php:95-99`)
  accepts the `null` with no validation and stores it — so execution
  continues and the response is well-formed JSON, but `criticality` comes
  back `null` instead of a value, for the exact rows the audit's seed data
  and RECON both call out as the import artifact. Verified by reading both
  files; not executed (Hard rule 2 — no PHP execution). Provisional finding,
  see Findings table — flagged for escalation per Hard rule 6 since two
  PHP warnings on a live request are close to the Critical/High boundary
  (not user-visible breakage, but a code smell strong enough that a stronger
  model should confirm severity and whether warnings are suppressed or
  surfaced in this deployment's `error_reporting`/log configuration).
- **`reaction`** (`:169-196`): only ever populates a *single* reaction
  manifestation from `$dataRecord['reaction']`/`reaction_title` — matches
  `CLINICAL-CARDS.md`. When `reaction` is `'unassigned'` or empty, it emits
  a `reaction` block with only a data-absent-reason manifestation (`:193-196`)
  rather than omitting the field. `reaction_title` alone (raw string) is what
  the PHP card's tooltip uses too (`allergies.html.twig:44`,
  `getListItemTitle('reaction', ...)` is *not* even called for the tooltip —
  it's `l.reaction_title`, the value already joined server-side by
  `AllergyIntoleranceService::search()`, so the FHIR and PHP-card reaction
  text ultimately trace back to the same joined column).
- **`code`/`text`** (`:198-221`): `title` (the card's row text) is placed
  only in FHIR's free-text narrative (`.text`, `additional` status,
  `:221`), not in `.code` unless `diagnosis` happens to be populated
  (rare for allergies in this dataset — `diagnosis` isn't shown on the
  card at all). A client reading only `.code.coding[].display` would miss
  the allergy name entirely for undiagnosed rows; it must read `.text.div`
  or keep using standard REST's plain `title` field.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| `GET /api/allergy` | yes | `RestConfig::request_authorization_check($request, "patients", "med")` (`_rest_routes_standard.inc.php:254`) | Collection route with no patient scoping in the path — any caller with `patients/med` can list allergies across patients by supplying no filter (query filters are dead, see above), though in practice a client still needs a patient's `puuid`/`allergy_uuid` to make sense of the response since `title` etc. carry no other patient marker in the whitelist |
| `GET /api/allergy/:auuid` | yes | same ACL section (`:260`) | |
| `GET /api/patient/:puuid/allergy[/:auuid]` | yes | same ACL section (`:266,272`) | matches `ui/DEMOGRAPHICS-PART2-CARDS.md`'s finding that the PHP card's own per-card ACL (`aclCheckIssue('allergy')` → `patients\|med`) lines up with this route's ACL |
| `POST/PUT/DELETE /api/patient/:puuid/allergy[/:auuid]` | yes | same ACL section (`:279,286,293`) | write ACL is identical to read ACL — no separate write permission; out of scope for the read-only port but worth noting for the catalog |
| `GET /fhir/AllergyIntolerance[/:uuid]` (non-patient-context) | yes | `RestConfig::request_authorization_check($request, "patients", "med")` (`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:79,90`) | |
| `GET /fhir/AllergyIntolerance[/:uuid]` (patient-context / patient-scoped OAuth token) | yes, different mechanism | `$request->isPatientRequest()` branches to bind `puuidBind` from the token instead of an ACL check (`:75-77,86-88`) | this is the standard FHIR-patient-scope pattern used across this API surface; not unique to allergies |

No permission check inside `AllergyIntoleranceService` itself at any layer
(the class trusts its caller entirely) — consistent with the rest of this
API: ACL enforcement lives at the route/controller boundary, not the
service. The port's auth model (OAuth2/OIDC per DB-01) must obtain a token
scoped to `patients/med`-equivalent (`user/allergy.cruds` standard,
`patient/AllergyIntolerance.rs`/`user/AllergyIntolerance.rs` FHIR — both
confirmed present in `Documentation/api/AUTHORIZATION.md:370` (FHIR patient
context), `:415` (FHIR user context), `:524` (standard `user/allergy.cruds`))
to reach any of these routes.

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `lists` (`type='allergy'`) | yes | yes (insert/update/delete) | `search` (`:52-98`), `insert` (`:270-278`), `update` (`:318-325`), `delete` (`:361-363`) | each write is a single autocommit statement, not wrapped in an explicit transaction |
| `list_options` (`list_id='reaction'`, `'allergyintolerance-verification'`) | yes | no | `search` (`:73-75`) | n/a |
| `patient_data` | yes | no | `search` (`:76-82`) | n/a |
| `users` | yes | no | `search` (`:83-91`) | n/a |
| `facility` | yes | no | `search` (`:92-98`) | n/a |
| `lists`, `patient_data`, `users`, `facility` (UUID backfill) | yes | yes, conditionally | `UuidRegistry::createMissingUuids()` via constructor (`AllergyIntoleranceService.php:39-40`) | yes — `QueryUtils::startTransaction()`/commit per `UUID_TRANSACTION_MAX_RECORDS` batch (`UuidRegistry.php:298,317-318`); runs on every construction, including reads |

## Cross-links

- **Opened by:** `demographics.php` Allergies card (`ui/DEMOGRAPHICS-PART2-CARDS.md`
  §"Allergies card (`1115-1136`)"); `apis/routes/_rest_routes_standard.inc.php`;
  `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`.
- **Opens:** nothing further downstream besides the tables above and
  `AllergyIntoleranceValidator` (`src/Validators/AllergyIntoleranceValidator.php`,
  not fully traced — out of scope, write-path only).
- **Calls into:** `BaseService::addCoding` (`src/Services/BaseService.php:551-573`),
  `UuidRegistry` (`src/Common/Uuid/UuidRegistry.php`), `FhirSearchWhereClauseBuilder`
  (`src/Services/Search/FhirSearchWhereClauseBuilder.php`, not fully traced —
  responsible for turning `$search` into the bound `WHERE` fragment; its
  `_sort`/`_count` handling for FHIR was not independently verified beyond
  what `FhirServiceBase::getAll()` does with `SearchQueryConfig`, see Open
  questions).
- **Cross-links to add elsewhere:** `ui/LAYOUTS-UTILS.md` (confirms the
  `severity_al='1'` → no `severity_ccda` label story from the template side;
  this doc adds the FHIR-side consequence); `ui/DEMOGRAPHICS-PART2-CARDS.md`
  Finding 9 (no sort — this doc confirms at the SQL level, both call sites);
  `api/CLINICAL-CARDS.md` DB-03 (this doc supersedes its field-mapping table
  with line-level detail and adds the dead-query-param and criticality-null
  findings it didn't have).

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Smell / Perf | Medium | Every `AllergyIntoleranceService` construction — including a plain read — triggers a whole-table UUID backfill scan+conditional-write across 4 tables inside its own transaction, the exact pattern a newer sibling method's docblock warns against for request-scoped code. | `AllergyIntoleranceService.php:39-40`; `UuidRegistry.php:229-249,295-320` | Not the port's problem to fix (backend unchanged), but the port should expect and budget for this per-request overhead when measuring API latency against the PHP-card baseline |
| 2 | Bug | Medium | `FHIR /fhir/AllergyIntolerance` accepts `_sort`/`_count` (parsed into a `SearchQueryConfig`) but `FhirAllergyIntoleranceService` doesn't override `searchForOpenEMRRecordsWithConfig()`, so the base class's no-op default silently ignores them — no error, no effect. | `FhirAllergyIntoleranceService.php` (no override present); `FhirServiceBase.php:262-269,313-316` | Port must not rely on FHIR-side sort/paging for this resource; fetch and sort/limit client-side, same as the no-`ORDER BY` finding below |
| 3 | Bug | Medium (provisional — Escalate) | `severity_al='1'` (the confirmed import-artifact code, per seed data and `ui/LAYOUTS-UTILS.md`) has no entry in `FhirAllergyIntoleranceService`'s criticality map, causing two chained "undefined array key" / "access on null" PHP warnings and a silently-null `criticality` field in the FHIR response for exactly the rows this audit's seed data contains. | `FhirAllergyIntoleranceService.php:138-152`; `FHIRAllergyIntoleranceCriticality.php:95-99` | Not executed to confirm the warnings are suppressed rather than surfaced/logged in this deployment; a stronger-model pass should decide real severity. Port mitigation regardless: don't source severity from FHIR `criticality` (see Finding 5) |
| 4 | Bug | Low | `GET /api/allergy` and `GET /api/patient/:puuid/allergy` document `title`/`begdate`/`enddate`/`diagnosis` query filters in their OpenAPI annotations, but neither route lambda passes query-string params into the controller — the filters are unreachable dead documentation. Same pattern independently confirmed for `/api/medical_problem` in `api/CLINICAL-CARDS.md`. | `AllergyIntoleranceRestController.php:90-133` (docs) vs. `_rest_routes_standard.inc.php:253,255,265,267` (call sites) | Port: don't build query-string filtering against this endpoint; fetch-all-then-filter-client-side is the only working approach, which the port already plans to do for `filterActiveIssues()` anyway |
| 5 | Half-implemented | Medium | `clinicalStatus` (FHIR) and `filterActiveIssues()` (PHP card) disagree on 2 of 5 row-shape combinations (future-dated `enddate`, and resolved-with-no-`enddate`) — traced field-by-field in Logic section above, a more precise restatement of `api/CLINICAL-CARDS.md`'s qualitative note. | `FhirAllergyIntoleranceService.php:117-122` vs. `demographics.php:1110-1113` | Port must re-implement the PHP predicate against raw `outcome`/`enddate` from standard REST; never filter on FHIR `clinicalStatus` for this card |
| 6 | Bug | Low | FHIR `criticality`'s 3-bucket coarsening does not align with the PHP card's highlight set: `moderate_to_severe` is FHIR-`high` but is not one of the three values (`severe`, `life_threatening_severity`, `fatal`) the card highlights. | `FhirAllergyIntoleranceService.php:139-148` vs. `allergies.html.twig:38` | Port: read raw `severity_al` from standard REST for both label and highlight, matching `api/CLINICAL-CARDS.md`'s recommendation; do not use FHIR `criticality` |
| 7 | Smell | Low | `AllergyIntoleranceService::search()`'s SQL has no `ORDER BY`; confirmed identical join shape is used by both the PHP-card call (`patient_id` predicate) and the REST/FHIR call (`puuid` predicate), so their row order likely but not guaranteedly matches. | `AllergyIntoleranceService.php:52-98,155-158` | Port: preserve API response order as-returned (matches prior audit's decision); do not add a client-side sort that could diverge from what a user sees on re-runs of the PHP page |

## Port notes — API contract for the port

**Best endpoint for the SPA:** `GET /api/patient/:puuid/allergy` (standard
REST). It returns every field the card needs, unmodified, and does not
coarsen severity. `GET /fhir/AllergyIntolerance` is usable as a fallback but
loses information (see below) and should not be the primary source for this
card.

| Card need | Standard REST field | Present/correct? | FHIR equivalent | Present/correct? |
|---|---|---|---|---|
| Row text (`title`) | `title` | Yes, raw | `.text.div` narrative only (unless `diagnosis` set, rare here) | Partial |
| `outcome` (for `filterActiveIssues`) | `outcome` | Yes, raw, unfiltered by the server | not exposed as a raw field; only folded into `clinicalStatus` using a *different* rule | **No — do not use FHIR for this filter, see Finding 5** |
| `enddate` (for `filterActiveIssues`) | `enddate` | Yes, raw, unfiltered | same as above | **No** |
| Severity label source (`severity_al` raw code, the "(1)" fallback) | `severity_al` | Yes, raw, untouched by this service (label lookup is template-side, not server-side — confirmed no `severity_ccda` join anywhere in `AllergyIntoleranceService::search()`) | `criticality` — coarsened to 3 buckets, and **silently `null` for the seeded `severity_al='1'` rows** (Finding 3) | **No — do not use for the label or the `(1)` fallback reproduction; the raw code isn't in the FHIR resource at all** |
| Severity highlight (`severe`/`life_threatening_severity`/`fatal`) | `severity_al` | Yes | `criticality` bucketing doesn't align (Finding 6) | **No** |
| Reaction tooltip | `reaction_title` | Yes, plain string, reliable | `reaction[].manifestation[].text`/`reaction_title`-derived | Yes, roughly equivalent |
| Sort order | none server-side either surface | API-returned order = PHP-card order in practice, not guaranteed | same | same |

**Error shapes** (both confirmed by reading `RestControllerHelper`, not
executed):

- Standard REST (`handleProcessingResult`, `RestControllerHelper.php:204-`):
  body is always `{validationErrors: [], internalErrors: [], data: [...], links: [...]}`.
  400 when `!$processingResult->isValid()` (validation failure, e.g. a
  malformed `puuid` short-circuits here per `getAll()`'s validator calls,
  `AllergyIntoleranceService.php:172,185,198`) — `validationErrors` populated,
  `data` empty. 500 when `hasInternalErrors()` — `internalErrors` populated
  with a generic string (`"error processing SQL Insert"` on write failures,
  `:286,370` — write paths only; no equivalent internal-error path was found
  on the read side, since `search()` calls `QueryUtils::sqlStatementThrowException()`,
  `:107`, which throws rather than returning an internal-error result — an
  uncaught SQL exception on a read would surface as a framework-level 500,
  not this shape). No exception message is ever placed in the response body
  on any path read here — matches the project's "never expose `getMessage()`"
  standard. 404 only from `getOne()`'s explicit zero-count check (`:79-81`);
  `getAll()` returns 200 with an empty `data` array for zero matches (never
  404) — **the port must treat "empty allergy list" and "patient not found"
  the same way `getAll()` does: both come back 200 with `data: []`**, since
  `getAll()` never distinguishes a bad `puuid` from a `puuid` with zero
  allergy rows unless the `puuid` itself fails UUID-format validation.
- FHIR (`handleFhirProcessingResult`, `RestControllerHelper.php:314-333`):
  400 with `{validationErrors: [...]}` on invalid search parameters (a
  `SearchFieldException`, caught in `FhirServiceBase::getAll()`,
  `:288-294`, surfaces here). 404 with a **bare empty array `[]`** (not an
  object) when zero records match — different shape from standard REST's
  404, which the port's HTTP client must handle explicitly if it uses both
  surfaces. 500 with `{internalErrors: [...]}`.

**Phase 2 parity decisions, applicability check (per this unit):**

- *Allergies highlight-only* (no reordering to pin severe allergies at the
  top, per the earlier approved decision) — **implementable as-is**: neither
  API surface offers a severity-based sort, and the PHP card doesn't
  actually reorder either (Finding 7 / `ui/DEMOGRAPHICS-PART2-CARDS.md`
  Finding 9), so "highlight only, preserve API order" matches both source
  systems.
- *Empty lists say "Nothing Recorded"* — **not fully implementable from this
  unit's API alone**. The PHP card's actual empty-state text depends on
  `lists_touch` (`"No Known Allergies"` vs `"Nothing Recorded"`,
  `demographics.php:1128`, traced in `ui/DEMOGRAPHICS-PART2-CARDS.md` Finding
  8), and neither `AllergyIntoleranceService` nor either REST/FHIR surface
  reads or exposes `lists_touch` — confirmed by this pass (no reference to
  `lists_touch`/`getListTouch` anywhere in the four files audited here).
  The approved simplification (always "Nothing Recorded" for an empty list)
  is a deliberate, already-approved parity gap, not something this unit's
  API can close.

## Open questions

- Does `AllergyIntoleranceService::search()`'s `ProcessingResult` ever get
  `setPagination()` called on it? Not found in this file; if it never does,
  `/api/allergy`'s `links` response key is always built from a default/unset
  pagination object via `RestControllerHelper::handleProcessingResult`
  (`:229-243`) — worth a follow-up read of `ProcessingResult`'s constructor
  default before the port relies on `links` for anything.
- Are PHP `E_WARNING`s from the undefined-array-key access in
  `FhirAllergyIntoleranceService::parseOpenEMRRecord()` (Finding 3)
  suppressed, logged, or surfaced as visible output in this deployment's
  `php.ini`/OpenEMR error-reporting configuration? Not executed, not traced
  here — needed to finalize the provisional severity.
- `FhirSearchWhereClauseBuilder::build()`'s exact handling of the `type`
  `StringSearchField` forced at `AllergyIntoleranceService.php:101` combined
  with a caller-supplied `type` (if any future caller tried) wasn't traced —
  low relevance to the read-only port, flagged only for completeness of the
  "search params actually honored" contract, since it determines whether a
  malicious/unexpected `type` in `$search` could ever override the hardcoded
  allergy filter (expected: no, since it's set after user input is merged in,
  but the `FhirSearchWhereClauseBuilder` internals weren't opened to confirm
  duplicate-key behavior).
