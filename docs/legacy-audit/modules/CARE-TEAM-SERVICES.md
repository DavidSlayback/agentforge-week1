# CareTeamService / FhirCareTeamService — Care Team data access (DB-07)

These two classes are the entire data-access layer behind the Care Team
card and the FHIR `CareTeam` endpoint. `CareTeamService` owns every SQL
query (three different query shapes read `care_team_member`, one for each
caller); `FhirCareTeamService` is a thin FHIR-shaping wrapper around it.
The UI card (`src/Patient/Cards/CareTeamViewCard.php`, audited in
`ui/CARE-TEAM-CARD.md`) and the FHIR API (`FhirCareTeamRestController`)
call **different methods** on the same service class — `getCareTeamData()`
for the card, `search()`/`getAll()` for FHIR — and, as this pass confirms
with read-only SQL against the seeded pid 13 team, those two methods
disagree on which members exist at all, not just on how they're rendered.

**Source:**
`src/Services/CareTeamService.php` · 690 lines · no version header, copyright 2020 (Yash Bothra) / 2025 (Jerry Padgett), portions marked AI-generated
`src/Services/FHIR/FhirCareTeamService.php` · 485 lines · no version header, copyright 2020/2025
(`saveCareTeam()` and its private helpers are documented only per the brief — their write path and missing ACL were already verified in `ui/CARE-TEAM-CARD.md` Finding 1 and are not re-verified here.)

**Audited by:** tier 2 · confidence high (read paths, confirmed by read-only SQL against pid 13) · medium (write path, not re-traced) · **Escalate: yes** — see Findings 1 and 6 (provisional High)

## Purpose & lifecycle

`CareTeamService` is a plain `BaseService` (table `care_teams`) with three
independent read paths that never call each other:

1. **`getCareTeamData($pid)`** (`:550-671`) — one big hand-joined query,
   called only from `CareTeamViewCard::getFormManagementData()`
   (`src/Patient/Cards/CareTeamViewCard.php:162`). This is the dashboard
   card's sole data source.
2. **`search()` / `getAll()`** (`:59-159`) — a team-level query
   (`getCareTeamRecordsForSearch()`) plus three separate per-team-id
   fan-out queries (`getCareTeamProviders()`, `getCareTeamFacilities()`,
   `getCareTeamContacts()`, `:174-314`). Called only from
   `FhirCareTeamService::searchForOpenEMRRecords()` (`:283-287`) and
   `getOne()` (`:323-364`) — i.e. this is the FHIR API's sole data source.
   No standard (`/api/`) REST route exists for Care Team at all (confirmed
   this pass: `grep -in "careteam|care_team"
   apis/routes/_rest_routes_standard.inc.php` — zero hits).
3. **`saveCareTeam($pid, ...)`** (`:375-442`) plus its five private helpers
   (`:447-545`, `:677-689`) — the write path, called from
   `CareTeamViewCard::handleFormSubmission()`. Per the brief, documented
   only to restate what `ui/CARE-TEAM-CARD.md` already verified: **zero**
   `AclMain`/`aclCheck` references exist anywhere in this 690-line file
   (re-confirmed this pass: `grep -n "AclMain\|aclCheck"
   src/Services/CareTeamService.php` — no output). The write path is out of
   scope for the read-only port; see Finding 6.

`FhirCareTeamService extends FhirServiceBase` and is reached only through
`FhirCareTeamRestController` (`src/RestControllers/FHIR/FhirCareTeamRestController.php`,
177 lines), which does no ACL check of its own — ACL is enforced entirely
at the route closure (see API contract below). `parseOpenEMRRecord()`
(`:103-157`) turns one `getCareTeamRecordsForSearch()`-shaped row (with
`providers`/`facilities`/`contacts` arrays attached by `search()` — **not**
the `getCareTeamData()` shape the card uses) into one `FHIRCareTeam`, calling
`populateProviderTeamMembers()`, `populateFacilityTeamMembers()`,
`populateRelatedPersonTeamMembers()` and `populateManagingOrganization()`
in that order. A commented-out `populatePatientMember()` call (`:150`) is
dead code left in place with an explanation ("inferno is having issues
with the subject not validating").

## Layout / interface

Public surface actually reached by the dashboard/API (private/protected
helpers listed only where cited):

```php
// CareTeamService (namespace OpenEMR\Services)
public function search(array $search, $isAndCondition = true): ProcessingResult                         // :59
public function getAll(array $search = [], $isAndCondition = true, $puuidBind = null)                    // :131 — FHIR read path
public function getOne(string $uuid, $puuidBind = null)                                                  // :323
public function hasActiveCareTeam($pid): bool                                                            // :367 — computed, unused by any template (ui/CARE-TEAM-CARD.md Finding 3)
public function saveCareTeam($pid, ?int $teamId, string $teamName, array $team, string $status='active'): void  // :375 — write path, not re-verified
public function getCareTeamData($pid): array                                                             // :550 — card read path
protected function getCareTeamRecordsForSearch(array $search, bool $isAndCondition): array                // :83
protected function getCareTeamContacts(array $careTeamIds): array                                        // :255
private function getCareTeamProviders(array $careTeamIds): array                                         // :174
private function getCareTeamFacilities(array $careTeamIds): array                                        // :223
private function getExistingCareTeamMembers($careTeamId): array                                          // :677 — write-path helper

// FhirCareTeamService (namespace OpenEMR\Services\FHIR), extends FhirServiceBase
public function parseOpenEMRRecord($dataRecord = [], $encode = false)                                    // :103
protected function loadSearchParameters()                                                                // :80 — patient, status, _id, _lastUpdated
protected function searchForOpenEMRRecords($openEMRSearchParameters): ProcessingResult                   // :283 → CareTeamService::getAll()
public function getSupportedVersions(): array                                                            // :306
public function populateProviderTeamMembers(...)                                                         // :336
public function populateFacilityTeamMembers(...)                                                         // :373
public function populateRelatedPersonTeamMembers(...)                                                    // :396
public function populateManagingOrganization(...)                                                        // :445
```

## State

No module-level (static/global) state in either class. Both are
instantiated fresh per request (`FhirCareTeamRestController::getFhirCareTeamService()`,
`:58-68`, lazily `new`s `FhirCareTeamService`, which itself `new CareTeamService()`s
in its constructor, `FhirCareTeamService.php:69-73`).

**Globals read:** none directly. `FhirCareTeamRestController::getFhirCareTeamService()`
reads `GlobalConnectorsEnum::FHIR_US_CORE_MAX_SUPPORTED_PROFILE_VERSION`
(`fhir_us_core_profile_version`) via the injected `OEGlobalsBag`
(`:62-64`) and calls `setHighestCompatibleUSCoreProfileVersion()` on the
service — this is the switch that gates `populateRelatedPersonTeamMembers()`
(see Finding 4). **Confirmed this pass by read-only SQL:** this install's
`globals` table has `fhir_us_core_profile_version = '8.0.0'`.
**Session read:** `saveCareTeam()`'s private helpers read `authUserID`
from `SessionWrapperFactory::getInstance()->getActiveSession()` (write
path only, e.g. `:449-450`).
**Globals/session written:** none in the read path. Write path is out of
scope (per brief).

## Logic

### `CareTeamService::getCareTeamData($pid)` (`:550-671`) — the card's only source

Already fully audited in `ui/CARE-TEAM-CARD.md` (§"`CareTeamService::getCareTeamData($pid)`
— confirmed by read-only SQL"). Restated here only as the baseline the FHIR
path is compared against: one query, `care_team_member` **pre-filtered**
in a derived subselect (`:563-566`, `WHERE status != 'inactive' AND status
!= 'entered-in-error'`) before the `LEFT JOIN` to `care_teams` even runs;
team-level `WHERE ct.pid = ? AND (ct.status IS NULL OR ct.status !=
'entered-in-error')`; returns exactly **one** team (`:653-661`, first
`team_status === 'active'`, else `reset()`). Re-confirmed this pass with
the exact query against pid 13 (see Key question below): 2 rows (user 6
PCP, user 5 nurse), team `Primary care team [seed:phase1]`, `active`.

### `CareTeamService::search()` / `getAll()` (`:59-159`) — the FHIR API's only source

`getAll()` (`:131-159`) is the entry point `FhirCareTeamService::searchForOpenEMRRecords()`
calls. It normalizes each search-array value into an `ISearchField`
(defaulting to `StringSearchField(..., SearchModifier::EXACT)`), optionally
adds a `puuid` `TokenSearchField` when a patient-context token is bound,
then calls `search()` (`:59-81`), which:

1. Runs `getCareTeamRecordsForSearch()` (`:83-121`) — **team-level only**:
   `care_teams ct JOIN patient_data (for puuid) LEFT JOIN list_options (Care_Team_Status)`,
   with the caller's search filters appended via
   `FhirSearchWhereClauseBuilder::build()`. **No `care_team_member` join
   here at all**, and — unlike `getCareTeamData()` — **no `ORDER BY`**
   clause, so for a patient with several teams, result order is whatever
   the storage engine returns (Finding 2).
2. Collects the resulting team ids (`array_column($records, 'id')`) and
   fans out to three *separate, per-team-id* queries: `getCareTeamFacilities()`
   (`:223-253`), `getCareTeamProviders()`(`:174-221`), `getCareTeamContacts()`
   (`:255-314`, tagged "AI-generated method implementation").
3. Attaches each team's `facilities`/`providers`/`contacts` arrays back
   onto its record (`:73-78`) and returns one `ProcessingResult` row per
   team — this shape (a team row with three nested member-type arrays) is
   exactly what `FhirCareTeamService::parseOpenEMRRecord()` expects.

**None of the three fan-out queries filters on `care_team_member.status`
at all.** `getCareTeamProviders()`'s `WHERE` clause is only
`ctm.care_team_id IN (...)` (`:190`) — no `status` predicate anywhere in
the method. Same for `getCareTeamFacilities()` (`:234`) and
`getCareTeamContacts()` (`:286-287`, which does add `AND
ctm.contact_id IS NOT NULL` but nothing about `status`). This is the one
load-bearing difference from `getCareTeamData()`'s subselect filter, and
it is the entire answer to the "would the inactive member show up"
question below.

Each of the three fan-out methods **does** select `ctm.status` into its
per-row array (`getCareTeamProviders()` line 215: `'status' =>
$row['status']`; likewise `getCareTeamFacilities()`... actually
`getCareTeamFacilities()` doesn't select status at all, only
`getCareTeamProviders()` and `getCareTeamContacts()` do) — but that value
is **never read again**. `FhirCareTeamService::parseOpenEMRRecord()` and
every one of its `populate*TeamMembers()` helpers were grepped this pass
(`grep -n "'status'\|->setStatus" src/Services/FHIR/FhirCareTeamService.php`)
and the only two hits are the `status` *search parameter* definition
(`:84`) and the two `$careTeamResource->setStatus($dataRecord['care_team_status'])`
calls for the **team**, not the member (`:127-130`). Finding 3 / Finding 1.

### `FhirCareTeamService::parseOpenEMRRecord()` (`:103-157`)

Builds one `FHIRCareTeam` per team row: `Meta` (US Core profile + version,
`_lastUpdated` from `date` else "now"), `id` = `uuid`, `status` = team's
`care_team_status` (falls back to `active` if the stored value isn't one
of the five FHIR-valid `CARE_TEAM_STATII`, `:127-131` — same silent
fallback style as `CareTeamViewCard`'s badge `match`), `subject` = a
`Patient/<puuid>` reference, `name` if `team_name` is non-empty, then the
three participant populators plus a managing-organization populator.

- **`populateProviderTeamMembers()`** (`:336-371`): one `FHIRCareTeamParticipant`
  per `providers[]` entry. Sets `period.start` = `provider_since` **only if
  non-empty** (no `period.end`, ever — nothing in the file sets one);
  `role` via `createRoleCodeableConcept()` (below); `member` =
  `Practitioner/<provider_uuid>`; `onBehalfOf` = `Organization/<facility_uuid>`
  if the member has a facility. Member `status` is read from the array
  (it's present) but never consulted.
- **`createRoleCodeableConcept()`** (`:186-234`): three-tier fallback —
  (1) if `physician_type_codes` is set (from `users.physician_type` →
  `list_options` `codes`), use that SNOMED code with a description from
  `physician_type_title` → `role_title` → a `CodeTypesService` lookup →
  `"Healthcare professional"`; (2) else if `role` matches
  `getRoleMappings()` (`:159-181`, a fixed `care_team_roles`-string →
  SNOMED-code table, e.g. `specialist` → `69280009`), use that code with
  `description` = `role_title`; (3) else generic `223366009` /
  `"Healthcare professional"`. **`createRoleCodeableConcept()`'s
  `description` becomes `FHIRCoding.display`** via
  `UtilsService::createCoding()` (`src/Services/FHIR/UtilsService.php:132-147`,
  `if (!empty($display)) $coding->setDisplay(...)`) — confirmed this pass
  by reading `UtilsService`. **This corrects `api/CLINICAL-CARDS.md`'s DB-07
  row, which called Role "Partial — SNOMED code, not the free-text role
  label": the free-text label (`care_team_roles` list-option title, the
  same string the card shows) *is* present, at `role.coding[0].display`,
  whenever `role_title` resolved — only the coded value itself differs
  from what the card shows (SNOMED vs. the raw `care_team_roles` option
  id/label).**
- **`populateFacilityTeamMembers()`** (`:373-395`): one participant per
  `facilities[]` entry (an `Organization` reference, not a role on the
  provider), role from `createOrganizationRoleCodeableConcept()`
  (`:239-275`, SNOMED facility-taxonomy code or a `43741000` "Healthcare
  facility" default). No `period` on this participant type.
- **`populateRelatedPersonTeamMembers()`** (`:396-443`): one participant
  per `contacts[]` entry, `member` = `RelatedPerson/<uuid>`, role mapped
  the same way as providers (fallback code `407542009` "informal
  caregiver" if unmapped). **Early-returns with nothing added if
  `getHighestCompatibleUSCoreProfileVersion() === '3.1.1'`** (`:398-400`).
  No `period` is ever set for this participant type either.
- **`populateManagingOrganization()`** (`:445-451`): only fires if
  `$dataRecord['primary_facility_uuid']` is set — **no query anywhere in
  `CareTeamService` ever populates a `primary_facility_uuid` key** (grep
  confirms: the string appears nowhere else in either file), so this
  method is dead code for every team, always. Not previously flagged in
  any Phase 1/2 doc.

## Key question — would `GET /fhir/CareTeam?patient=<uuid>` include the inactive member, for pid 13?

**Yes — confirmed by running the exact `getCareTeamProviders()` SQL
read-only against pid 13's one seeded team (team id 1).** All three
seeded `care_team_member` rows came back, with no status filter applied:

```
care_team_id  user_id  role                    status     provider_since  fname     lname
1             5        nurse                   active     2021-09-15      Fred      Stone
1             6        primary_care_provider   active     2019-04-01      Donna     Lee
1             10       specialist              inactive   2016-02-01      External  Provider
```

Contrast with `getCareTeamData()`'s query (the card's), run against the
same team: only the two `active` rows come back — user 10 is excluded at
the SQL `LEFT JOIN`'s subselect, before any PHP or JS runs (re-confirming
`ui/CARE-TEAM-CARD.md`'s "Key question" finding for the card side).

So: `GET /fhir/CareTeam?patient=<pid-13-uuid>` returns one `CareTeam`
resource whose `participant[]` includes a `Practitioner/<uuid-for-user-10>`
entry with role "Specialist" (`role.coding[0].code=69280009`,
`.display="Specialist"`) and `period.start="2016-02-01"` — **structurally
indistinguishable from the two active participants.** Nothing in the
resource says this member is inactive: there is no `participant.status`
field in the FHIR R4 `CareTeam` resource shape at all (correct per spec —
this isn't an OpenEMR omission, it's a real FHIR modeling gap this server
doesn't work around with an extension), no `period.end`, and no extension
carrying `care_team_member.status`. **A client that calls `GET
/fhir/CareTeam` naively will show the inactive specialist that the legacy
card never shows, and has no field to filter on to reproduce the card's
behavior.** This is the confirmed, data-backed version of what
`REQUIREMENTS-TRACE.md` DB-07 and `api/CLINICAL-CARDS.md` DB-07 both
flagged as "inferred" / "not confirmed" — it is now Finding 1, provisional
High, not a guess.

**The `status` *search* parameter is real and does work — but only at the
team level, not the member level.** `loadSearchParameters()` maps FHIR
`status` to `['status']` (`:84`), which `FhirSearchWhereClauseBuilder`
turns into an unqualified `WHERE status = ?` appended to
`getCareTeamRecordsForSearch()`'s query. Verified this pass by running
that exact query with `AND status = 'active'` read-only against pid 13:
it resolves unambiguously to `ct.status` (the only physical `status`
column among the joined tables) and returns the one seeded team
correctly. So `GET /fhir/CareTeam?patient=<uuid>&status=active` **is** a
valid way to filter *teams* by status (useful for replicating "prefer the
active team"), but there is no equivalent member-level parameter — `status`
never reaches `getCareTeamProviders()`/`getCareTeamFacilities()`/`getCareTeamContacts()`,
which take only team ids as input (`:190,234,286-287`).

## Team status mapping

| OpenEMR `care_teams.status` (`list_options` list `Care_Team_Status`, confirmed this pass) | `FhirCareTeamService` handling |
|---|---|
| `active` | `CareTeamResource->setStatus('active')` |
| `inactive` | `setStatus('inactive')` |
| `proposed` | `setStatus('proposed')` |
| `suspended` | `setStatus('suspended')` |
| `entered-in-error` | `setStatus('entered-in-error')` |
| NULL / anything else | `createResultRecordFromDatabaseResult()` defaults `care_team_status` to `'active'` before FHIR mapping ever sees it (`CareTeamService.php:165`); `parseOpenEMRRecord()` has its own second fallback to `'active'` if the value somehow isn't in `CARE_TEAM_STATII` (`FhirCareTeamService.php:127-131`) |

All five `Care_Team_Status` option ids match the five FHIR R4
`CareTeamStatus` value-set codes exactly (`active`, `proposed`,
`suspended`, `inactive`, `entered-in-error`) — this is a clean 1:1, no
lossy mapping, unlike Role (free-text list vs. SNOMED) or Type (implicit
in reference type). The team's badge label the card shows
(`Care_Team_Status` list-option `title`, e.g. "Active") is **not** in the
FHIR response at all — only the raw status code is — but since the code
set is small and fixed, the SPA can hardcode the same five title strings
without an extra lookup, unlike Role.

## Which card columns are recoverable from `GET /fhir/CareTeam`

Building on `ui/CARE-TEAM-CARD.md`'s parity table with this pass's direct
reads of `UtilsService`, the routes, and the profile-version global:

| Card column | Recoverable via FHIR? | How |
|---|---|---|
| Type | Yes | Reference type on `participant.member` (`Practitioner`=user, `RelatedPerson`=contact, `Organization`=facility-as-participant) |
| Member (name) | Yes, with an extra fetch | `GET /fhir/Practitioner/:uuid` or `GET /fhir/RelatedPerson/:uuid` (both routes exist, confirmed this pass: `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:650-664`, `:714-720`) — no name ships inline on the participant |
| Role | Yes (corrected this pass) | `participant.role.coding[0].display` carries the same free-text label as the card (`role_title`) whenever it resolved; `.coding[0].code` is the SNOMED code, not shown by the card at all |
| Facility | Yes, with an extra fetch | `onBehalfOf` (providers) or a dedicated `Organization`-type participant (facilities); `GET /fhir/Organization/:uuid` exists (`:503-511`) |
| Since | Yes, providers only | `participant.period.start` = raw `provider_since`; **never set for `RelatedPerson`/`Organization` participants** — confirmed by reading every `populate*` method, none of the other two set a `period` |
| Status (member) | **No** | Fetched into the PHP array at every layer, never written into the FHIR resource anywhere. Confirmed by exhaustive grep this pass. This is the finding that matters for DB-07 |
| Note | **No** | Confirmed again this pass, same as `ui/CARE-TEAM-CARD.md`: zero references to `note`/`ctm.note`/`member['note']` in `FhirCareTeamService.php` |

## Can the SPA replicate "show only the first active team"?

**Partially, and only by accepting a different tie-break rule than the
card's.** `GET /fhir/CareTeam?patient=<uuid>&status=active` returns every
*active* team for the patient (confirmed working via the SQL test above),
which covers the "first active" half — but:

- `getCareTeamRecordsForSearch()` has no `ORDER BY` (Finding 2), while the
  card's `getCareTeamData()` sorts `ORDER BY ct.team_name ASC`. If a
  patient has two active teams, the FHIR Bundle's entry order is
  DB-storage-order, and "take the first Bundle entry" will not reliably
  match "the alphabetically-first team by name" the card computes.
- If no team is `active`, the card falls back to "first team found, any
  status except `entered-in-error`" (`:660-661`, `reset($careTeams)`
  after the whole unfiltered set was already fetched and iterated). A
  client would need a *second*, unfiltered `GET /fhir/CareTeam?patient=<uuid>`
  call (no `status` param) and then apply the same fallback client-side —
  doable, but it's two requests where the card does one query.
- pid 13 only has one team, seeded `active`, so none of this was
  observable end-to-end against live data this pass; the above is derived
  from the query shapes, not from a multi-team fixture.

## Whether `populateRelatedPersonTeamMembers` no-ops matters for this install

**No, not for this install as currently configured.** The method
short-circuits only when `getHighestCompatibleUSCoreProfileVersion() ===
self::PROFILE_VERSION_3_1_1` (`FhirCareTeamService.php:398-400`). That
value is set per-request from the `fhir_us_core_profile_version` global
(`FhirCareTeamRestController::getFhirCareTeamService()`, `:62-64`, default
`8.0.0` if the global is unset). **Confirmed this pass by read-only SQL
against the local `globals` table: `fhir_us_core_profile_version =
'8.0.0'`** — not `3.1.1` — so `populateRelatedPersonTeamMembers()` runs
normally and RelatedPerson-type members would be exposed if any existed.
(None are seeded for pid 13 — all three `care_team_member` rows have
`user_id` set and `contact_id` NULL — so this couldn't be directly
observed against live data either, but the code path and the global's
value are both confirmed.) This is an environment-dependent behavior: a
future config change to US Core 3.1.1 would silently start dropping
contact-type Care Team members from the API with no other code change,
which is worth the port team knowing about even though it doesn't affect
today's deployment.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| `GET /fhir/CareTeam` (collection, non-patient-context) | yes | `RestConfig::request_authorization_check($request, "patients", "med")` (`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:150`) | Route-level only; neither `FhirCareTeamRestController` nor either service class checks ACL itself (confirmed by grep, zero hits in all three files this pass) |
| `GET /fhir/CareTeam` (patient-context token) | **bypassed** | `if ($request->isPatientRequest())` skips the `request_authorization_check` call entirely and scopes by `puuidBind` instead (`:146-149`) | Matches `api/AUTH-AND-PATIENT.md`'s general note that patient-context tokens skip ACL; not specific to Care Team |
| `GET /fhir/CareTeam/:uuid` | yes / bypassed | same pattern, `:157-163` | |
| `saveCareTeam()` (write, reached only from the PHP card) | **missing** | none — CSRF only, enforced one layer up in `CareTeamViewCard::handleFormSubmission()` | Already verified in `ui/CARE-TEAM-CARD.md` Finding 1; restated here per the brief, not re-verified. Out of scope for the read-only port regardless |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `care_teams` | yes (both paths) | write path only | `getCareTeamRecordsForSearch` (`:87-105`), `getCareTeamData` (`:562`), `hasActiveCareTeam` (`:369`); write: `createOrUpdateCareTeam` (`:447-478`) | n/a for read |
| `care_team_member` | yes, **three different filter shapes** across the two read paths (see Logic) | write path only | `getCareTeamProviders`/`getCareTeamFacilities`/`getCareTeamContacts` (unfiltered by status, `:174-314`) vs. `getCareTeamData`'s subselect (filtered, `:563-566`) vs. `getExistingCareTeamMembers` (unfiltered, write-path helper, `:679-682`) | n/a |
| `users` | yes | no | all provider queries | n/a |
| `facility` | yes | no | facility queries in both paths | n/a |
| `contact`, `person`, `contact_relation` | yes | no in these methods (possible write via `ContactService` in the card's *other* method, `getFormManagementData`, out of this unit) | `getCareTeamContacts` (`:255-314`), `getCareTeamData` (`:568-576`) | n/a |
| `list_options` | yes (`Care_Team_Status`, `care_team_roles`, `physician_type`) | no | throughout | n/a |
| `patient_data` | yes (`puuid`↔`pid`, and squad/patient lookup) | no | `getCareTeamRecordsForSearch` (`:99-103`), `getCareTeamData` (`:576` join alias `patient_contact`, unused past the join — see Open questions) | n/a |

## Cross-links

- **Opened by:** `src/RestControllers/FHIR/FhirCareTeamRestController.php`
  (`getAll`/`getOne`) for the API path; `src/Patient/Cards/CareTeamViewCard.php`
  (`getFormManagementData` → `getCareTeamData`) for the card path — see
  `ui/CARE-TEAM-CARD.md`.
- **Calls into:** `OpenEMR\Services\Search\FhirSearchWhereClauseBuilder`,
  `OpenEMR\Common\Database\QueryUtils`, `OpenEMR\Common\Uuid\UuidRegistry`,
  `OpenEMR\Services\CodeTypesService` (role-code descriptions),
  `OpenEMR\Services\FHIR\UtilsService` (reference/coding construction).
- **Route:** `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:142-166`.
- **See also:** `ui/CARE-TEAM-CARD.md` (card-side read path, save-ACL gap,
  stored-XSS finding, empty-state gap), `api/CLINICAL-CARDS.md` DB-07
  (Phase 1 map; this doc confirms two of its "not confirmed" flags — Since
  and Role — and turns its "inferred" member-status gap into a confirmed
  one), `REQUIREMENTS-TRACE.md` DB-07.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Parity gap / Half-implemented | **High (provisional)** | `GET /fhir/CareTeam` exposes inactive and entered-in-error care-team members identically to active ones — no query in the FHIR read path filters `care_team_member.status`, and no field in the FHIR `CareTeamParticipant` shape (no status, no `period.end`, no extension) lets a client tell them apart. Confirmed on pid 13 by reproducing the exact SQL: the FHIR path returns all 3 members (incl. the inactive specialist), the card path returns 2. | `CareTeamService::getCareTeamProviders/getCareTeamFacilities/getCareTeamContacts` (`src/Services/CareTeamService.php:174-314`, no `status` predicate); `FhirCareTeamService::parseOpenEMRRecord` and all `populate*TeamMembers` (`src/Services/FHIR/FhirCareTeamService.php:103-443`, no read of `$dataRecordProvider['status']`) | For the port: document as "not available via API" and accept the card's inactive-member-hiding cannot be replicated; for OpenEMR upstream, either filter status server-side (breaking parity with `search()`'s documented "no default filter" behavior) or expose it via an extension |
| 2 | Bug / Parity gap | Medium | `getCareTeamRecordsForSearch()` (FHIR path) has no `ORDER BY`; `getCareTeamData()` (card path) sorts `ORDER BY ct.team_name, ctm.date_created ASC`. A multi-team patient's "first team" via FHIR Bundle order need not match the card's alphabetically-first team, and the FHIR `status=active` filter only narrows to active teams — it doesn't restore a name sort | `CareTeamService.php:87-121` vs `:550-582,653-661` | Port: sort client-side by team name after fetching, to approximate the card |
| 3 | Smell | Low | `care_team_member.status` is selected into the intermediate PHP array by two of the three FHIR fan-out queries (`getCareTeamProviders`, `getCareTeamContacts`) but never read again — dead data fetched on every request, same pattern as the already-documented unused `hasActiveTeam` query on the card side | `CareTeamService.php:177,215` (`getCareTeamProviders`), `:269,307` (`getCareTeamContacts`); zero reads in `FhirCareTeamService.php` (grep, this pass) | Delete the unused column selection, or wire it into a FHIR extension if member status should be exposed |
| 4 | Smell / environment-dependent behavior | Low | `populateRelatedPersonTeamMembers()`'s US Core 3.1.1 short-circuit is currently inert for this install (`fhir_us_core_profile_version=8.0.0`, confirmed by SQL), but a config change to 3.1.1 would silently drop all contact-type Care Team members from the API with no other code change and no error | `src/Services/FHIR/FhirCareTeamService.php:396-400`; `src/Services/FHIR/Traits/VersionedProfileTrait.php:22,67-70`; `globals` table (`fhir_us_core_profile_version`) | Document as a config-dependent behavior in the port's API-assumptions doc, not a code fix |
| 5 | Dead code | Low | `populateManagingOrganization()` never fires: it requires `$dataRecord['primary_facility_uuid']`, but no query anywhere in `CareTeamService` ever sets that key | `FhirCareTeamService.php:445-451`; grep confirms `primary_facility_uuid` appears nowhere else in either file | Out of port scope; catalog item |
| 6 | Security | High (provisional, **not re-verified this pass — restated per brief**) | `saveCareTeam()` has no ACL check anywhere in this file; CSRF-only protection lives one layer up in `CareTeamViewCard`. Re-confirmed the zero-`AclMain` claim by grep this pass, did not re-trace the call chain | `src/Services/CareTeamService.php` (whole file, grep confirmed no `AclMain`/`aclCheck`); see `ui/CARE-TEAM-CARD.md` Finding 1 for the full trace | Out of scope for the read-only port; already tracked in `ui/CARE-TEAM-CARD.md` |

## Port notes

- **Must survive:** nothing from the write path (port is read-only). From
  the read path: the SPA should call `GET /fhir/CareTeam?patient=<uuid>`
  (patient-context token, so no separate ACL configuration needed) and, if
  strict parity with the card's inactive-member-hiding is required, accept
  that it **cannot** be done from FHIR data — this must be either an
  explicit, documented gap (recommended, consistent with DB-10) or require
  an upstream API change (out of scope for this project).
- **Must not survive:** the save endpoint's missing ACL (not ported,
  read-only) — restated, not re-verified this pass.
- **Open questions:**
  - Whether `getExistingCareTeamMembers()`'s note that `contact`/`person`
    rows can be created as a side effect of a GET (flagged in
    `ui/CARE-TEAM-CARD.md` Finding 4, via `ContactService::getOrCreateForEntity`)
    also has any bearing on the FHIR read path — not traced here;
    `FhirCareTeamService`'s read path never touches `ContactService`
    directly, only `CareTeamService::getCareTeamContacts()`, which is a
    plain `SELECT`, so this is presumed **not** to apply to the API path,
    but wasn't independently confirmed by tracing every call into
    `ContactService`.
  - Whether a `RelatedPerson` team member's `person.uuid` is guaranteed to
    exist: `CareTeamService::__construct()`'s `UuidRegistry::createMissingUuidsForTables()`
    call (`:44-50`) covers `patient_data`, `users`, `facility`,
    `care_teams` — **not `person`**. If a contact-type member's `person`
    row predates UUID backfill, `populateRelatedPersonTeamMembers()` would
    emit a `RelatedPerson/` reference with an empty/null id. Not verified
    against data — no contacts are seeded for pid 13.
  - Whether the `patient_contact` join alias in `getCareTeamData()`
    (`:576`, joined but never selected into the output array) is truly
    unused, or feeds something outside the lines read for this pass — not
    traced further; low priority since it's the card path, already
    audited in `ui/CARE-TEAM-CARD.md`.
  - Pagination/`_count`/`_sort` support for `GET /fhir/CareTeam` goes
    through `FhirServiceBase::getAll()`'s generic `_config`/`SearchQueryConfig`
    mechanism (`src/Services/FHIR/FhirServiceBase.php:240-265`), shared
    across every FHIR resource — not re-traced in this unit; flagged for
    whichever unit audits `FhirServiceBase` directly, if one hasn't
    already.

## API contract for the port

**Route:** `GET /fhir/CareTeam?patient=<patient-uuid>` (list) and
`GET /fhir/CareTeam/<uuid>` (single) — `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:142-166`.
No standard (`/api/`) REST route exists for Care Team (confirmed this pass
by grep; matches `api/CLINICAL-CARDS.md`).

**Scope / ACL:** `patients/med` (`RestConfig::request_authorization_check`,
route closure, `:150,161`) for a non-patient-context (client-credentials /
user) token. A patient-context token bypasses this check entirely and is
scoped by `puuidBind` instead (`:146-149,157-163`). OAuth2 scope
`patient/CareTeam.rs` / `user/CareTeam.rs` per `Documentation/api/AUTHORIZATION.md`
(cited via `api/CLINICAL-CARDS.md`; not independently re-read this pass).

**Search params actually honored** (`FhirCareTeamService::loadSearchParameters()`, `:80-88`):

| Param | Type | Maps to | Confirmed working? |
|---|---|---|---|
| `patient` | REFERENCE | `puuid` (patient uuid) via `getPatientContextSearchField()` | Yes (standard FHIR patient-compartment pattern) |
| `status` | TOKEN | unqualified `status` → resolves to `ct.status` (team status) | **Yes — confirmed this pass by running the exact SQL with `AND status='active'` against pid 13; filters teams by status correctly. Does NOT filter member status — see Key question.** |
| `_id` | TOKEN | `uuid` (the CareTeam resource's own id) | Standard, not independently tested |
| `_lastUpdated` | DATETIME | `date_updated` | Standard, not independently tested |

No `_sort` or `_count` params are declared for this resource specifically;
any pagination support is generic `FhirServiceBase` infrastructure (see
Open questions), not re-traced here.

**Default filtering:** none, at either the team or member level, for
`search()`/`getAll()` — every team status and every member status is
returned unless the caller supplies `status=`. This matches
`api/CLINICAL-CARDS.md`'s Phase 1 claim and is now confirmed with data.

**Response fields for the card's 8 columns** (Type, Member, Role,
Facility, Since, Status, Note, Remove): see "Which card columns are
recoverable" above — Status and Note are **not available via API**; Remove
is edit-mode-only, n/a for a read-only port; the rest are recoverable, Role
and Since with the corrections/caveats noted above.

**Error shapes** (`RestControllerHelper`, shared FHIR infrastructure, not
Care-Team-specific — read this pass for completeness):
- `getOne()` → `handleFhirProcessingResult()` (`src/RestControllers/RestControllerHelper.php:314-333`):
  400 with `{"validationErrors": [...]}` if the uuid fails `BaseValidator::validateId`;
  404 with `[]` if zero rows; 500 with `{"internalErrors": [...]}` on an
  internal error — the internal-error messages come from `ProcessingResult::getInternalErrors()`
  (validator-generated strings), not a raw caught-exception message, so
  this does not appear to violate AGENTS.md's "never expose `$e->getMessage()`"
  rule, though the exact content of those messages wasn't traced further.
- `getAll()` → `RestControllerHelper::responseHandler()` (`:156-169`): a
  `createBundle()` result is always truthy, so a zero-match search returns
  **200** with an empty FHIR `Bundle` (`total: 0`), not 404 — different
  from the single-resource 404 behavior above. The port's "empty" UI state
  for Care Team should be driven by `Bundle.total === 0` / empty `entry`,
  not by an HTTP status code.

**Phase 2 parity decision (Care Team was accepted as a gap for squad /
`hide_dashboard_cards`, not otherwise called out for this card) — this
pass adds:** the API can implement "show one team" (partially, via
`status=active` plus a client-side tie-break) and "show Role/Facility/Since
for providers" (via extra fetches), but **cannot** implement "hide inactive
members," which was `ui/CARE-TEAM-CARD.md`'s and `api/CLINICAL-CARDS.md`'s
open/inferred item and is now a confirmed hard gap — recommend recording it
explicitly in the parity checklist as "not available via API" rather than
attempting a client-side workaround, since no workaround exists with the
data FHIR exposes.
