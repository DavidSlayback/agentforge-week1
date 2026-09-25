# UUID Mapping — pid/eid (integer) ↔ API uuid

Phase 4 data audit. Read-only: source (`Read`/`Grep`) plus read-only `SELECT`
SQL against the local synthetic dev DB (pid 13). No writes, no HTTP calls to
the app. Every claim below is cited `path:line`; anything not confirmed from
source or SQL is listed under Open questions, not guessed.

**Why this doc exists.** Client model B (`AUDIT-STATE.md:83,94`, David,
2026-09-25) puts the SPA behind a thin BFF with a confidential OAuth client.
Per `modules/README.md`'s per-card table, the BFF must call a mix of routes
that take the **integer** `pid`/`eid` (`/api/patient/:pid/medication`,
`/api/prescription?pid=`, `/api/patient/:pid/encounter/:eid/vital`) and
routes that take the **uuid** (`/api/patient/:puuid/allergy`,
`/medical_problem`, `/encounter`; all of FHIR). This doc traces where the
uuid comes from, when it's guaranteed to exist, and — the part that
actually blocks BFF design — where the integer id comes back out of a
uuid-keyed response so the BFF never has to store its own pid↔uuid table.

## 1. `uuid_registry` — what it is, and what it is not

**Schema** (`sql/database.sql:9955-9970`):

```sql
CREATE TABLE `uuid_registry` (
  `uuid` binary(16) NOT NULL DEFAULT '',
  `table_name` varchar(255) NOT NULL DEFAULT '',
  `table_id` varchar(255) NOT NULL DEFAULT '',
  `table_vertical` varchar(255) NOT NULL DEFAULT '',
  `couchdb` varchar(255) NOT NULL DEFAULT '',
  `document_drive` tinyint(4) NOT NULL DEFAULT '0',
  `mapped` tinyint(4) NOT NULL DEFAULT '0',
  `created` timestamp NULL,
  PRIMARY KEY (`uuid`)
) ENGINE=InnoDB;
```

It is a **flat ledger of every uuid ever issued by `UuidRegistry`**, across
every uuid-bearing table, keyed by the uuid itself (not by `table_name` +
`table_id` — there's no composite unique key on those, so `table_id` is
descriptive metadata, not a lookup key). Its two jobs:

1. **Uniqueness checking when minting a new uuid.** `getUnusedUuidBatch()`
   (`src/Common/Uuid/UuidRegistry.php:305-330`) generates candidate uuids via
   a Timestamp-first COMB codec (`Ramsey\Uuid\Codec\TimestampFirstCombCodec`,
   `:31,108-113`) and rejects any that already exist in `uuid_registry`
   **or** in the target table's own `uuid` column (`:320-326`) — belt and
   suspenders in case a row got a uuid without going through the registry
   (see §4).
2. **A backfill worklist.** `createMissingUuids()` /
   `createMissingUuidsForTableWithId()` scan the target table for rows with
   `uuid IS NULL` (or an all-zero 16-byte value,
   `isEmptyBinaryUUID()`, `:359-362`) and assign+insert one for each.

**It is not an authoritative "every row that has a uuid" index** — see §4:
a row can carry a real, valid uuid in its own table without ever appearing
in `uuid_registry`, if that uuid was set through a path other than
`UuidRegistry::createUuid()`/`createMissingUuidForRow()`.

**Format.** `binary(16)` in every uuid-bearing table (patient_data, lists,
prescriptions, care_teams, form_vitals, form_encounter, etc. — confirmed
individually in §2) and in `uuid_registry` itself. Conversion is symmetric
and explicit, not a MySQL `UUID()`/`BIN_TO_UUID()` cast:

```php
// src/Common/Uuid/UuidRegistry.php:265-278
public static function uuidToString($uuidBytes) { return Uuid::fromBytes($uuidBytes)->toString(); }
public static function uuidToBytes($uuidString) { return Uuid::fromString($uuidString)->getBytes(); }
```

`Uuid::fromBytes(...)->toString()` (Ramsey) renders standard
8-4-4-4-12 dashed lowercase hex (e.g. `a2d4d063-d949-4f5a-9001-01c1d919afc6`
for pid 13's `patient_data.uuid`, confirmed by SQL, see §5). Every
service's `createResultRecordFromDatabaseResult()` calls this conversion
per uuid-bearing field before the row reaches JSON
(`src/Services/BaseService.php:528-540`, and per-service overrides — see
§3) — **the API never emits raw binary or an undashed 32-hex string**; the
client always sees the dashed form.

## 2. When uuids get backfilled: on every read, not just at install

There is **no migration or install step that guarantees every row has a
uuid up front**. `patient_data.uuid`, `form_encounter.uuid`, `lists.uuid`,
`prescriptions.uuid`, `care_teams.uuid`, `form_vitals.uuid` are all
`binary(16) DEFAULT NULL` in the base schema (`sql/database.sql:8336`
patient_data, `:2024` form_encounter, `:7673` lists, `:8700` prescriptions,
`:14780` care_teams, `:2420` form_vitals) — nullable, no `NOT NULL DEFAULT`.
A freshly-imported or Synthea-generated row (or a hand-written `INSERT`, see
§4) can land with `uuid IS NULL`.

Backfill happens two ways, and **only one of them is reachable from the
BFF's request path**:

- **Per-request, inside the service constructor that the route calls.**
  Every in-scope service except `ListService` (see below) calls
  `UuidRegistry::createMissingUuidsForTables([...])` as the *first* thing
  its constructor does, before running any query:
  - `AllergyIntoleranceService::__construct()` →
    `['lists', 'patient_data', 'users', 'facility']`
    (`src/Services/AllergyIntoleranceService.php:36-38`)
  - `PatientIssuesService::__construct()` (Medical Problems' PHP-side
    service, not on the REST path — see `modules/CONDITION-SERVICES.md`) →
    `['lists']` (`src/Services/PatientIssuesService.php:33-34`)
  - `ConditionService::__construct()` (backs `/api/patient/:puuid/medical_problem`)
    → `['lists', 'patient_data', 'form_encounter']`
    (`src/Services/ConditionService.php:36-38`)
  - `PrescriptionService::__construct()` (backs `/api/prescription`) →
    `['prescriptions', 'patient_data', 'form_encounter', 'users', 'drugs']`
    (`src/Services/PrescriptionService.php:38-40`)
  - `CareTeamService::__construct()` →
    `['patient_data', 'users', 'facility', 'care_teams']`
    (`src/Services/CareTeamService.php:42-48`)
  - `VitalsService::__construct()` (backs `/api/patient/:pid/encounter/:eid/vital`
    and FHIR `Observation` vital-signs) → `['form_vitals']`
    (`src/Services/VitalsService.php:52-53`)
  - `PatientService` resolves a patient's uuid lazily instead of a blanket
    table scan: `getUuid(string $pid)` (`src/Services/PatientService.php:696-699`)
    just reads the column, and new-patient creation calls
    `(new UuidRegistry(['table_name'=>'patient_data']))->createUuid()`
    directly (`PatientService.php:173`) rather than a backfill scan.

  Each of these scans is a **full-table `WHERE uuid IS NULL` sweep** over
  the named table (`createMissingUuidsForTableWithId()`,
  `UuidRegistry.php:368-...`, batched at `UUID_TRANSACTION_MAX_RECORDS =
  10000` per transaction, `:79-81`) — it runs synchronously before the
  service answers *any* request, not scoped to the one patient being
  queried. On a table with millions of rows and a large "missing" backlog
  this is a real per-request latency risk for the BFF; not measured here
  (read-only audit, no load test performed).

  **Exception — `ListService` (backs `/api/patient/:pid/medication`, the
  one integer-pid route the BFF calls for Medications) never calls
  `createMissingUuidsForTables()` in its own constructor**
  (`src/Services/ListService.php:27-30`, no `UuidRegistry` call at all)
  yet `getAll()` unconditionally does
  `UuidRegistry::uuidToString($row['uuid'])` on every row
  (`ListService.php:52-54`) with **no null check**. It only works because
  `lists` is a shared table that `AllergyIntoleranceService`,
  `ConditionService`, and `PatientIssuesService` all backfill as a side
  effect of their own constructors. **If the BFF calls
  `GET /api/patient/:pid/medication` for a patient before any allergy- or
  problem-list read has ever run for that patient (or that `lists` row was
  inserted after the last such backfill), a `lists` row with
  `uuid IS NULL` will make `Uuid::fromBytes(null)` throw inside
  `ListService::getAll()`, i.e. a 500 on the Medications card with no
  parity fallback.** Not exercised live (read-only rule); flagged as
  provisional. **Escalate: yes** (possible High — an unhandled exception on
  a documented port route, not yet reproduced against live data).

- **Scheduled, via OpenEMR's background-services runner — not reachable by
  the SPA/BFF at all.** `library/uuid.php:15-18` defines
  `autoPopulateAllMissingUuids()`, which calls
  `UuidRegistry::populateAllMissingUuids()` (a sweep over **every** table in
  `UuidRegistry::UUID_TABLE_DEFINITIONS`, `UuidRegistry.php:41-77,128-156`).
  It is registered as a `background_services` row, not called directly by
  any request handler (`grep -rln autoPopulateAllMissingUuids` outside
  `library/uuid.php` finds nothing but its own definition and the PHPStan
  baseline):
  ```sql
  -- sql/database.sql:214-215
  INSERT INTO `background_services` (`name`, `title`, `active`, `running`, `next_run`, `execute_interval`, `function`, `require_once`, `sort_order`) VALUES
  ('UUID_Service', 'Automated UUID Creation Service', 1, 0, '2021-01-18 11:25:10', 240, 'autoPopulateAllMissingUuids', '/library/uuid.php', 100);
  ```
  `execute_interval` is in minutes → runs at most every **4 hours**
  (`active=1` locally). It's driven by
  `library/ajax/execute_background_services.php`, which per its own header
  comment (`:23-25`) is polled "only when users are logged in" to the
  legacy tabbed-shell UI (an Ajax call from a page the SPA never loads) or
  by an external cron hitting the same script — **neither path is
  exercised by a BFF that only ever calls the REST/FHIR API**, so this
  4-hourly sweep is not something the port can rely on. The per-request
  backfill in §2's first bullet is the *only* mechanism that actually runs
  for the port's traffic.

## 3. Field-by-field: pid → uuid, and back, per in-scope area

| Area | Table(s) | uuid column | Backfilled by (constructor) | Confirmed via |
|---|---|---|---|---|
| Patient | `patient_data` | `uuid` (`sql/database.sql:8336`, `UNIQUE KEY uuid`, `:8468`) | `PatientService` — lazy per-row (`PatientService.php:173,696-699`), not a table sweep | `api/AUTH-AND-PATIENT.md` §2.5 |
| Encounter | `form_encounter` | `uuid` (`:2024`) | `ConditionService`, `PrescriptionService`, `EncounterService` (`EncounterService.php:67`, not called by any in-scope route directly — encounters are read via `EncounterRestController`, see below) | SQL §5 |
| Allergies / Problems / Medications | `lists` (`type='allergy'\|'medical_problem'\|'medication'`) | `uuid` (`:7673`) | `AllergyIntoleranceService`, `ConditionService`, `PatientIssuesService` — **not** `ListService` (§2) | SQL §5 |
| Prescriptions | `prescriptions` (+ `lists` in the UNION, `source_table` distinguishes them — `modules/README.md` DB-05/DB-06 row) | `uuid` (`:8700`) | `PrescriptionService` (`PrescriptionService.php:38-40`) | SQL §5 |
| Care Team (team) | `care_teams` | `uuid` (`:14780`, `UNIQUE KEY uuid`) | `CareTeamService` (`CareTeamService.php:42-48`) | SQL §5 — **see §4, seed-data gap** |
| Care Team (member) | `care_team_member` | **no `uuid` column exists** (`sql/database.sql:14796-14811` — full `CREATE TABLE`, no `uuid` field, only an `id` auto-increment PK) | n/a | schema read |
| Vitals | `form_vitals` | `uuid` (`:2420`) | `VitalsService` (`VitalsService.php:52-53`) | SQL §5 |

**Care Team members have no uuid at all.** `FhirCareTeamService` doesn't
need one: FHIR `CareTeam.participant.member` references the *provider's*
identity, not the membership row — `getCareTeamProviders()`
(`src/Services/CareTeamService.php:184-190`, cited in
`api/CLINICAL-CARDS.md` DB-07) selects `u.uuid as provider_uuid` (the
`users` row's uuid), never a `care_team_member.id`. So the port never needs
a per-member id/uuid; it identifies a row in the rendered table by
`(care_team_id, user_id)` or just render order — same shape the PHP card
already uses, since `care_team_member` has no external identifier of its
own in the legacy schema either.

## 4. Uuids that exist but were never registered (seed-data gap, not a code bug)

Read-only SQL against pid 13 (`docker exec agentforge-week1-mysql-1 ...
mariadb ... openemr`, `SELECT` only):

```sql
SELECT COUNT(*) FROM uuid_registry WHERE table_name='care_teams';   -- 0
SELECT HEX(uuid), pid FROM care_teams WHERE pid=13;
-- F31D59AFB88B11F18C7A0ED9AF59D05D | 13
```

`care_teams.uuid` for pid 13's seeded team is a real, well-formed uuid (the
FHIR `CareTeam` endpoint reads it straight off the row —
`src/Services/CareTeamService.php:87-105` selects `ct.uuid` directly, it
never joins through `uuid_registry`), but it does **not** appear in
`uuid_registry` at all. Root cause, traced to the seed script:

```sql
-- docs/legacy-audit/seed/phase1-seed.sql:19-22
INSERT INTO care_teams (uuid, pid, status, team_name, note, created_by, updated_by)
SELECT UNHEX(REPLACE(UUID(), '-', '')), 13, 'active', 'Primary care team [seed:phase1]', ...
```

The seed uses MySQL's own `UUID()` function to pre-populate the column
directly, bypassing `UuidRegistry::createUuid()` entirely. Because the
column is already non-null by the time `CareTeamService`'s constructor runs
its `WHERE uuid IS NULL` backfill sweep (§2), that row is silently skipped
— it never needed backfilling, so it never gets inserted into
`uuid_registry` either.

**Consequence for the port:** none for *reading* this card — the FHIR
response is unaffected, since it reads `care_teams.uuid` directly, not via
`uuid_registry`. It does mean **`uuid_registry` is not a safe "does this
resource have an API-exposed uuid" check** — a row can have a real uuid the
registry has never heard of (seed data here; equally possible after a raw
`INSERT`, a data import, or DB replication in production). If any future
tooling (this port or otherwise) treats `uuid_registry` row-count as an
inventory of "uuid-bearing rows," pid 13's care team is a concrete
counterexample. This is a data-quality note about the local seed script,
not a finding against production `CareTeamService` code.

## 5. Confirmed: every in-scope pid-13 row has a uuid (today, on this DB)

Read-only SQL, run once, `SELECT` only, no full rows pasted (counts and a
null-check only):

```sql
SELECT 'patient_data' tbl, COUNT(*), SUM(uuid IS NULL) FROM patient_data WHERE pid=13
UNION ALL SELECT 'form_encounter', COUNT(*), SUM(uuid IS NULL) FROM form_encounter WHERE pid=13
UNION ALL SELECT 'lists_allergy', COUNT(*), SUM(uuid IS NULL) FROM lists WHERE pid=13 AND type='allergy'
UNION ALL SELECT 'lists_medical_problem', COUNT(*), SUM(uuid IS NULL) FROM lists WHERE pid=13 AND type='medical_problem'
UNION ALL SELECT 'lists_medication', COUNT(*), SUM(uuid IS NULL) FROM lists WHERE pid=13 AND type='medication'
UNION ALL SELECT 'prescriptions', COUNT(*), SUM(uuid IS NULL) FROM prescriptions WHERE patient_id=13
UNION ALL SELECT 'care_teams', COUNT(*), SUM(uuid IS NULL) FROM care_teams WHERE pid=13
UNION ALL SELECT 'form_vitals', COUNT(*), SUM(uuid IS NULL) FROM form_vitals WHERE pid=13;
```

| tbl | total | null_uuid |
|---|---|---|
| patient_data | 1 | 0 |
| form_encounter | 36 | 0 |
| lists_allergy | 2 | 0 |
| lists_medical_problem | 39 | 0 |
| lists_medication | 5 | 0 |
| prescriptions | 5 | 0 |
| care_teams | 1 | 0 |
| form_vitals | 5 | 0 |

Every in-scope row for pid 13 has a uuid today. This is **because every
one of these tables' services has already run at least once** during
Phase 0–3 probing (each request backfills, per §2), not evidence that the
tables were uuid-complete from creation — e.g. `patient_data.uuid` for pid
13 (`HEX(uuid) = A2D4D063D9494F5A900101C1D919AFC6` →
`a2d4d063-d949-4f5a-9001-01c1d919afc6`) was almost certainly backfilled the
first time any FHIR/REST call touched this patient, not set at Synthea
import time. **This does not prove `ListService`'s missing backfill call
(§2) is safe for a patient nobody has queried through Allergies/Problems
first** — pid 13 has been queried through those cards repeatedly during
this audit, which is exactly the confound. A patient reachable only via
`/api/patient/:pid/medication` first (plausible for a BFF that lets a user
deep-link straight to the Medications card) is the untested case.

## 6. How the BFF gets the integer `pid`/`eid` back out of a uuid-keyed response

This is the concrete question client model B has to answer: several
in-scope routes are uuid-keyed (`/api/patient/:puuid/...`, all of FHIR) and
others are integer-keyed (`/api/patient/:pid/medication`,
`/api/prescription?pid=`, `/api/patient/:pid/encounter/:eid/vital`). Traced
per response:

- **`GET /api/patient/:puuid` → yes, returns integer `pid` directly.**
  `PatientService::search()` selects `patient_data.*`
  (`src/Services/PatientService.php:427`, cited in
  `api/AUTH-AND-PATIENT.md` §2.2), and `patient_data.pid` is the table's own
  int PK-adjacent column (`sql/database.sql:8336` region). The documented
  response shape (`swagger/openemr-api.yaml:9915-10012`, cited in
  `api/AUTH-AND-PATIENT.md:330-338`) explicitly lists both `id` and `pid`
  alongside `pubpid`. **The BFF resolves the integer pid once, from the
  same `/api/patient/:puuid` call it already makes for the header card —
  no separate lookup needed.**

- **`GET /api/patient/:puuid/encounter` → yes, returns both `eid` (int) and
  `euuid`, plus the patient's own `pid`/`puuid` again.**
  `EncounterService::search()`'s SQL (`src/Services/EncounterService.php:187-236`)
  explicitly selects `fe.eid` (aliased `encounter as eid` in the inner
  query, `:235`) and `patient.pid`/`patient.puuid` in the same row
  (`:207-208`). **This is the route that unblocks
  `GET /api/patient/:pid/encounter/:eid/vital`**: the BFF calls
  `/api/patient/:puuid/encounter`, reads `eid` (and the patient's `pid`,
  redundantly available on every row) straight off the response, and uses
  those integers for the vitals-per-encounter route. No client-side
  pid/eid cache or extra uuid→id lookup table is needed.

- **`GET /api/patient/:puuid/allergy` and `/medical_problem` → yes, the raw
  integer `lists.id` and `lists.pid` survive into the response**, because
  both services' base query is literally `SELECT lists.*, lists.pid AS
  patient_id FROM lists ...` (`src/Services/AllergyIntoleranceService.php:66-68`,
  same shape confirmed for `ConditionService` by its equivalent `lists`-table
  join, `src/Services/ConditionService.php:42-94`) — `lists.*` includes
  `lists.id` and `lists.pid` verbatim; `uuid`/`puuid` are added, not
  substituted. These two card reads don't need pid translation either way
  — the BFF already holds `puuid` before calling them (from the header) and
  never needs the row's own integer id for a read-only card.

- **`GET /api/prescription` → no.** `PrescriptionService::getBaseSql()`
  (`src/Services/PrescriptionService.php:91-143`)'s outer `SELECT` list has
  no `id`, `pid`, or `patient_id` column at all — only `uuid`,
  `source_table`, `puuid` (patient), `euuid` (encounter), `pruuid`
  (practitioner). A prescription row is identified purely by its `uuid`
  (matches the route shape: writes are `PUT/DELETE /api/prescription/:uuid`,
  never by integer id). **The BFF must already hold the integer `pid` before
  calling this route** (it's a required query-string filter, `?pid=`, read
  by `PrescriptionRestController::getAll()` passing `$request->getQueryParams()`
  straight to `PrescriptionService::getAll()`,
  `src/RestControllers/PrescriptionRestController.php:152-157`) — the same
  `pid` already resolved from `/api/patient/:puuid` above.

- **`GET /api/patient/:pid/medication` → the route is already integer-keyed**
  (`ListRestController::getAll($pid, $list_type)` →
  `ListService::getAll($pid, ...)` → `WHERE pid=? AND type=?`,
  `src/Services/ListService.php:48-50`) — no uuid round-trip needed for this
  one at all; it consumes the same `pid` resolved from `/api/patient/:puuid`.

**Summary: the BFF resolves `pid` exactly once per patient, from
`GET /api/patient/:puuid`, and `eid` exactly once per encounter, from
`GET /api/patient/:puuid/encounter` — both come back embedded in
responses the BFF already has to fetch for the header/vitals cards. No
separate uuid↔id mapping table or extra request is required on the port's
critical path.**

## 7. Open questions

- Whether `ListService::getAll()` (§2) actually throws on a `lists.uuid IS
  NULL` row was not exercised live (read-only rule) — traced from source
  only. Flagged `Escalate: yes`, provisional High.
- `EncounterService` itself is never constructed by any in-scope route in
  this audit's grep (`EncounterRestController` backs
  `/api/patient/:puuid/encounter`, confirmed by route table
  `apis/routes/_rest_routes_standard.inc.php:105-131`) — need to confirm
  which class actually instantiates `EncounterService`/runs its
  `form_encounter` backfill for that specific route (not traced deeper
  here; `EncounterRestController.php` itself wasn't read line-by-line for
  this doc, only its route bindings and `EncounterService`'s SQL).
- Whether a `lists`/`prescriptions`/`form_vitals` row can go from
  `uuid IS NULL` to non-null *during* a paginated multi-request read (a
  backfill racing a client's own `_offset` pagination) was not tested;
  each backfill call commits per `UUID_TRANSACTION_MAX_RECORDS` batches
  (`UuidRegistry.php:79-81`), so a large missing-uuid backlog is visible
  mid-scan to any concurrent reader — not exercised here.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Bug | High (provisional, unverified live) | `ListService::getAll()` calls `UuidRegistry::uuidToString($row['uuid'])` on every `lists` row with no null guard, and `ListService`'s constructor — unlike every sibling service — never calls `createMissingUuidsForTables()`. A patient whose `lists` rows haven't been touched by Allergies/Problems first can 500 the Medications route. | `src/Services/ListService.php:27-30,48-54` | Add the same `UuidRegistry::createMissingUuidsForTables(['lists'])` call `ListService`'s constructor is missing, or null-guard the conversion. |
| 2 | Data quality | Low | `care_teams.uuid` for pid 13's seeded team exists but is absent from `uuid_registry` (seed script uses raw `UUID()`, bypassing `UuidRegistry::createUuid()`). Doesn't break reads; breaks any future assumption that `uuid_registry` inventories every uuid-bearing row. | `docs/legacy-audit/seed/phase1-seed.sql:19-22`; SQL in §4 | Note in any tooling that treats `uuid_registry` as authoritative; reseed through `UuidRegistry::createUuid()` if exactness matters later. |
| 3 | Design note | Low | `care_team_member` has no `uuid`/external-id column at all — not a gap, just means the port must key rendered member rows by `(care_team_id, user_id)` or render order, same as the legacy card. | `sql/database.sql:14796-14811` | None needed; document for the frontend data model. |

## Port notes

- **Must survive:** the "resolve pid/eid once, from `/api/patient/:puuid`
  and `/api/patient/:puuid/encounter`" pattern in §6 — it removes the need
  for a BFF-side uuid↔id cache entirely for the patients this audit
  checked.
- **Must not survive:** relying on the 4-hourly `UUID_Service` background
  sweep (§2) for anything the port depends on — it never runs for the
  port's traffic pattern.
- **Open questions:** Finding 1 (`ListService` null-guard) should be
  confirmed live in Phase 6 against a patient that has never been read
  through Allergies/Problems/Medical-Problems, before the port ships a
  Medications-first deep link.
