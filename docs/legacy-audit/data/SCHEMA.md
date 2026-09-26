# Data Schema — tables the dashboard port reads

> **Orchestrator correction (tier 3, 2026-09-25):** D-2 says `lists.outcome=6` isn't a defined option. It **is** defined in `list_options` (`list_id='outcome'`, `option_id='6'`) with an **empty title**. It's still meaningless (most likely created by the import), and still counts as active under `filterActiveIssues()` (`outcome != 1`), so it has no parity impact. Severity: Low.

**Source of truth:** `sql/database.sql` (the install-time DDL, cited
`path:line` per table below) plus the version-to-version scripts in `sql/*_upgrade.sql`
(cited where they changed a column set materially — see "Migration drift"
under each table). Every table below was cross-checked read-only against
the local synthetic DB (`docker exec agentforge-week1-mysql-1 … mariadb …
openemr -e "SHOW CREATE TABLE …"`, SELECT-only counts) on 2026-09-25; drift
from `database.sql` is called out explicitly where found.

**Engine:** MariaDB (InnoDB, `utf8mb4`/`utf8mb4_general_ci` on the live
install; `database.sql`'s own `CREATE TABLE` statements predate the
charset/collation clause, which is added by an upgrade script, not shown
here since it's uniform across all tables). **Tables:** 11 in scope
(`patient_data`, `lists`, `lists_medication`, `lists_touch`,
`prescriptions`, `care_teams`, `care_team_member`, `form_vitals`, `forms`,
`pnotes`, `list_options`).

No triggers, views or stored procedures touch any of these tables —
confirmed by querying `information_schema.TRIGGERS`/`VIEWS` and `SHOW
PROCEDURE STATUS` against the local DB; all three returned zero rows for
this schema. See "Stored logic" below.

This document does not repeat query-level behavior already fully audited
in `modules/CARE-TEAM-SERVICES.md`, `modules/MEDICATION-SERVICES.md`,
`modules/VITALS-SERVICES.md`, `api/CLINICAL-CARDS.md` and
`ui/DEMOGRAPHICS-PART2-CARDS.md` — it cites them rather than re-deriving
their SQL, and focuses on the tables themselves: columns, keys, defaults,
soft-delete/status semantics, uuid/audit columns, and data-quality issues
visible only by querying the data.

## Entity overview

| Table | Purpose | Rows (local) | Soft delete? | Audit columns? | Read by | Written by |
|---|---|---|---|---|---|---|
| `patient_data` | One row per patient; identity, demographics, squad | 13 | No (no `deleted`/`inactive` column at all) | `created_by`/`updated_by`/`last_updated` (added late; no `date_created`) | Every card, via `pid`↔`uuid` joins | Patient registration/edit screens (not audited) |
| `lists` | Allergies, Medical Problems, Medications (and every other "issue" type) — one polymorphic table keyed by `type` | 312 (3 allergy / 249 medical_problem / 60 medication) | No `deleted` column; "ended" is `enddate` (nullable) + `activity` (tinyint) + `outcome` (int), three overlapping and inconsistently-honored signals | `modifydate` (auto), no `date_created`/`created_by` | `AllergyIntoleranceService`, `PatientIssuesService`, `ConditionService`, `FhirConditionProblemListItemService`, `ListService`, `PrescriptionService` (lists branch), `stats.php` | `ListService::insert/update/delete`; legacy `add_edit_issue.php` (not audited) |
| `lists_medication` | Extra medication fields (dosage instructions, usage category, request intent) for a `lists` row of `type=medication` | 0 | No | No | `PatientIssuesService::search` (LEFT JOIN), `PrescriptionService::getBaseSql` (both UNION branches, LEFT JOIN) | Not traced (0 rows locally; presumably the medication add/edit screen) |
| `lists_touch` | One row per `(pid, type)` recording "this issue list has ever been saved" — drives "No Known Allergies"/"None" vs "Nothing Recorded" empty text | 6 | n/a (append/overwrite only) | `date` (last touch) | `getListTouch()`, `library/lists.inc.php:130-139` | `add_edit_issue.php:279`, eRx import, `library/ajax/lists_touch.php` (per `ui/DEMOGRAPHICS-PART2-CARDS.md`) |
| `prescriptions` | The Prescriptions card's own table; also half of the `PrescriptionService` UNION | 56 | Yes: `active` int (soft-delete flag, doubles as clinical status) | `date_added`, `date_modified`, `created_by`, `updated_by` | `Prescription::prescriptions_factory()` (legacy card), `PrescriptionService::getBaseSql` | `PrescriptionService::insert/delete` (soft), legacy `Prescription` write path (not traced), uuid backfill on every `PrescriptionService` construction |
| `care_teams` | One row per care team (patient can have several; the card shows one) | 1 | No `deleted`; `status` includes `entered-in-error` as a soft-delete-like state | `date_created`, `date_updated`, `created_by`, `updated_by` | `CareTeamService::getCareTeamData`/`getCareTeamRecordsForSearch` | `CareTeamService::saveCareTeam` (no ACL — `modules/CARE-TEAM-SERVICES.md` Finding 6) |
| `care_team_member` | Member rows (provider/contact/facility) for a care team | 3 (2 active, 1 inactive) | No `deleted`; `status` (`active`/`inactive`/`entered-in-error`/…) is the only signal, and it is honored **inconsistently** across the read paths (see Findings) | `date_created`, `date_updated`, `created_by`, `updated_by` | `CareTeamService::getCareTeamData` (filtered), `getCareTeamProviders/Facilities/Contacts` (unfiltered) | `saveCareTeam()` helpers |
| `form_vitals` | One row per recorded vitals set | 17 | No — soft delete lives on the **joined** `forms` row, not here | `last_updated` (auto) | `VitalsService::search` (both the PHP fragment's own query and the FHIR path, independently) | `VitalsService::save/saveVitalsArray` (not traced) |
| `forms` | Generic per-encounter form registry; `(form_id, formdir)` together identify which specialty table's row a given `forms` row describes | 1,438 | Yes: `deleted` tinyint | none beyond `date` | Every `form_vitals` reader, via a join keyed on `form_id` (+ `formdir` when done correctly) | `\addForm()` helper (not traced) |
| `pnotes` | Patient messages/notes — documented here **only to record it is not ported**: no read API exists (`api/CLINICAL-CARDS.md` DB-08) | 5 | Yes: `deleted` tinyint | `update_by`/`update_date` | `getPnotesByDate()`, legacy only | `MessageService::insert/update/delete` (write-only API scope `message.cud`); `pnotes_fragment.php`'s "Completed" button |
| `list_options` | Shared option/title lookup for every `list_id` the cards resolve (`severity_ccda`, `outcome`, `Care_Team_Status`, `care_team_roles`, plus `drug_units`/`drug_interval`/`drug_route`/`physician_type` for Prescriptions/Care Team) | see per-list counts below | n/a (`activity` tinyint gates visibility, not deletion) | `timestamp`, `last_updated` | `LayoutsUtils::getListItemTitle()` and every service that joins it for a title | Admin list editor (not audited) |

## Tables

### `patient_data`

`sql/database.sql:8334-8472` (139 lines, ~180 columns — a wide, denormalized
demographics table; only the columns the dashboard port touches are listed
below). **No `PRIMARY KEY` clause exists on this table** — confirmed both
in `database.sql` and live (`SHOW CREATE TABLE`): the key set is `UNIQUE
KEY pid (pid)`, `UNIQUE KEY uuid (uuid)`, plus non-unique `KEY id (id)`,
`idx_patient_name (lname, fname)`, `idx_patient_dob (DOB)`. `id` is
`AUTO_INCREMENT` but is not the primary key — MySQL/MariaDB only requires
the auto-increment column to be the leftmost part of *some* index, which
the plain `KEY id (id)` satisfies. Every join the audited services do uses
`pid` (the clinical/business key) or `uuid`, never `id`, so this is a
schema smell rather than a port-facing bug — noted because ORM code that
assumes a conventional single-column `PRIMARY KEY` would need to target
`pid` or `uuid` explicitly.

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|
| `id` | bigint(20) | No | auto_increment | `KEY id` (non-unique) | Not the primary key (see above) |
| `uuid` | binary(16) | Yes | NULL | `UNIQUE KEY uuid` | FHIR `Patient.id`; backfilled by `UuidRegistry` |
| `pid` | bigint(20) | No | `0` | `UNIQUE KEY pid` | The business key every card/service joins on |
| `pubpid` | varchar(255) | No | `''` | — | External/MRN-like id shown on the (out-of-scope) Demographics card only |
| `fname`, `lname`, `mname` | varchar(255) | No | `''` | `idx_patient_name (lname,fname)` | Synthea test data appends digits to given/family names (Finding D-1) |
| `DOB` | date | Yes | NULL | `idx_patient_dob` | Not shown anywhere on the direct dashboard URL (`RECON.md`, `ui/DASHBOARD-MAP.md` §3) — only inside the collapsed Demographics card |
| `sex` | varchar(255) | No | `''` | — | Comment: "Sex at birth" |
| `squad` | varchar(32) | No | `''` | — | Drives the squad ACL gate (`ui/DEMOGRAPHICS-PART2-CARDS.md` Finding 1); the API has no squad concept |
| `status` | varchar(255) | No | `''` | — | Free-text patient status field, distinct from any card's "active" concept |
| `date` | datetime | Yes | NULL | — | Registration timestamp; no matching `deleted`/`archived` flag anywhere in the table |
| `created_by`, `updated_by`, `last_updated` | bigint / bigint / datetime | Yes/Yes/No | NULL/NULL/`CURRENT_TIMESTAMP` | — | Added by a later upgrade; no `date_created` — `date` (above) is the closest equivalent, and it is not documented as immutable |

**Readers:** `AllergyIntoleranceService::search` (joins for reaction
verification/patient/facility, `src/Services/AllergyIntoleranceService.php:52-98`),
`PatientIssuesService::search`, `CareTeamService::getCareTeamRecordsForSearch`/`getCareTeamData`
(`puuid`↔`pid`, `src/Services/CareTeamService.php:99-103,576`),
`VitalsService::search` (`puuid`, `VitalsService.php:163-169`),
`PrescriptionService::getBaseSql` (`puuid`/`pid`, `src/Services/PrescriptionService.php`),
`OemrUI::pageHeading()` → `getPatientFullNameAsString()` (header, name
only). **Writers:** none of the audited units; patient registration/edit
screens are out of this audit's scope.

### `lists`

`sql/database.sql:7671-7712` (42 lines). One polymorphic table for
Allergies, Medical Problems and Medications (and every other "issue type"
— Health Concerns, Surgery, etc. — none of which are seeded locally: local
data has exactly the three in-scope `type` values, confirmed by `SELECT
DISTINCT type FROM lists`). "Ended"/"active" is not one column but three,
independently honored (or not) by every reader:

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|
| `id` | bigint(20) | No | auto_increment | PRIMARY KEY | |
| `uuid` | binary(16) | Yes | NULL | UNIQUE KEY | 0 NULL locally (fully backfilled) |
| `pid` | bigint(20) | Yes | NULL | KEY `pid` | |
| `type` | varchar(255) | Yes | NULL | KEY `type` | `allergy` \| `medical_problem` \| `medication` in scope |
| `title` | varchar(255) | Yes | NULL | — | The only field the Medical Problems/Medications cards render |
| `begdate` | datetime | Yes | NULL | — | 9 of 312 local rows NULL. Medical Problems/Medications sort by this **ascending, NULLs first** (`ui/DEMOGRAPHICS-PART2-CARDS.md` §Medical Problems) |
| `enddate` | datetime | Yes | NULL | — | 241 of 312 local rows carry one shared non-NULL date (`2017-10-22 10:23:21`, a Synthea import artifact — see Data-quality), 71 NULL, **0** using the legacy zero-date sentinel `0000-00-00 00:00:00` locally. `filterActiveIssues()` treats NULL/`''` as "no end date" via PHP `empty()` (`demographics.php:1110-1113`) — a `0000-00-00…` value, were one present, is **not** `empty()` in PHP and `strtotime()` would parse it to a large negative timestamp, which is still `> strtotime('now')`... no: `strtotime('0000-00-00')` returns `false`, which compares as `0`, i.e. **not** greater than now, so such a row would be (correctly, if accidentally) treated as ended. Not observed locally; flagged as an open question for the port since it can't be tested against this seed |
| `outcome` | int(11) | No | `0` | — | `list_options` list `outcome`, values `0`–`5` defined (`sql/database.sql:4400-4406`). **246 of 249 local `medical_problem` rows have `outcome=6`** — not a defined option (Finding D-2). `filterActiveIssues()`'s loose `!= 1` still passes these rows (6 != 1), so the card's filter behavior is unaffected, but `getListItemTitle('outcome', 6)` (if ever called — it currently isn't, by any card in scope) would fall back to the raw `6` the same way `severity_al='1'` does for Allergies |
| `activity` | tinyint(4) | Yes | NULL | — | Set by `disappearList()` (`library/lists.inc.php:119-123`) to `0`; **not consulted** by `filterActiveIssues()` (Finding, restated from `ui/DEMOGRAPHICS-PART2-CARDS.md` #10), but **is** consulted by the FHIR `Condition` (`activity=1`) and `MedicationRequest` status derivation paths — the three signals diverge by reader |
| `severity_al` | varchar(50) | Yes | NULL | — | Allergy-only. `list_options` list `severity_ccda` (`sql/database.sql:5388-5396`). **2 of 3 local allergy rows have `severity_al='1'`**, not a `severity_ccda` option id (Finding D-3 — this is `RECON.md`'s "(1)" observation, now counted) |
| `subtype`, `list_option_id`, `verification`, `external_allergyid`, `reaction`, `classification`, `occurrence` | varchar/int | mixed | mixed | — | Allergy/CCDA-coding support columns; not read by any in-scope card (per `ui/DEMOGRAPHICS-PART2-CARDS.md`/`api/CLINICAL-CARDS.md`) |
| `modifydate` | timestamp | No | `CURRENT_TIMESTAMP` (auto-update) | — | The only audit column; no `date_created`/`created_by` |

**Migration drift:** `severity_al` was added in
`sql/4_2_0-to-4_2_1_upgrade.sql:11450`; `subtype` in
`sql/4_2_1-to-4_2_2_upgrade.sql:148`. Both are present and consistent
between `database.sql` and the live schema.

**Readers:** `AllergyIntoleranceService::search`
(`src/Services/AllergyIntoleranceService.php:52-98`, forces `type='allergy'`),
`PatientIssuesService::search` (`src/Services/PatientIssuesService.php:171-211`,
LEFT JOINs `lists_medication`, `ORDER BY begdate`), `ConditionService::search`
(`src/Services/ConditionService.php:42-94`, hardcodes `type='medical_problem'`),
`FhirConditionProblemListItemService::searchForOpenEMRRecords`
(`src/Services/FHIR/Condition/FhirConditionProblemListItemService.php:129-181`,
adds `activity='1'` at the SQL level), `ListService::getAll/getOne`
(`src/Services/ListService.php:50,181`, `type='medication'` path),
`PrescriptionService::getBaseSql` lists branch (`src/Services/PrescriptionService.php:206-260`,
`WHERE type='medication' AND lists_medication.prescription_id IS NULL`),
`stats.php` (generic issue types, out of scope). **Writers:**
`ListService::insert/update/delete` (`src/Services/ListService.php:186-237`,
hard delete); legacy `add_edit_issue.php` (not audited this pass).

### `lists_medication`

`sql/database.sql:7717-7735` (19 lines). Extension table for `lists` rows
of `type=medication`: dosage instructions and coded usage/intent metadata
that the base `lists` row doesn't carry. **0 rows locally** — every
medication `lists` row (60 of them) has no matching `lists_medication`
row, so the Medications card's `drug_dosage_instructions` display and the
`/api/prescription` lists-branch dosage join are both untestable against
this seed (noted as a gap in `modules/MEDICATION-SERVICES.md`).

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|
| `id` | bigint(20) | No | auto_increment | PRIMARY KEY | |
| `list_id` | bigint(20) | Yes | NULL | `lists_medication_list_idx` | FK to `lists.id`, not enforced (no `FOREIGN KEY` constraint anywhere in this schema — OpenEMR relies on application code) |
| `drug_dosage_instructions` | longtext | Yes | NULL | — | The field the Medications card shows alongside title; **not** returned by `GET /api/patient/:pid/medication` (that query is a bare `lists` SELECT with no join — `modules/MEDICATION-SERVICES.md` Q1) |
| `usage_category`, `usage_category_title`, `request_intent`, `request_intent_title` | varchar | mixed | mixed | `lists_med_usage_category_idx`, `lists_med_request_intent_idx` | CCDA/FHIR coding support, not read by the in-scope cards |
| `prescription_id` | bigint(20) | Yes | NULL | — | When set, `PrescriptionService::getBaseSql`'s lists branch **excludes** the row from the UNION (`WHERE … prescription_id IS NULL`) to avoid double-counting a medication already represented as a `prescriptions` row |

**Readers:** `PatientIssuesService::search` (LEFT JOIN, `src/Services/PatientIssuesService.php:171-211`),
`PrescriptionService::getBaseSql` (LEFT JOIN in both UNION branches).
**Writers:** not traced this pass (0 local rows; presumably a medication
add/edit screen not read for this audit).

### `lists_touch`

`sql/database.sql:7744-7749` (6 lines). A 3-column marker table, one row
per `(pid, type)` ever saved through the issue editor — not a history, a
single overwritable "has this list ever been touched" flag.

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|
| `pid` | bigint(20) | No | `0` | PRIMARY KEY (`pid`,`type`) | |
| `type` | varchar(255) | No | `''` | PRIMARY KEY (`pid`,`type`) | |
| `date` | datetime | Yes | NULL | — | Last-touch timestamp, not read by any in-scope card logic |

**Local data:** 6 rows — pid 1 (allergy, medical_problem, medication), pid
2 (medical_problem, medication), pid 13 (medical_problem only). This is
the entire mechanism behind the Allergies/Medical-Problems/Medications
empty-state text ("No Known Allergies"/"None" vs "Nothing Recorded") and
is **not exposed by any REST/FHIR endpoint** — confirmed here, restating
`ui/DEMOGRAPHICS-PART2-CARDS.md` Finding 8 and
`modules/MEDICATION-SERVICES.md`'s "not available via API" list. Pid 13's
allergy/medication rows are absent even though pid 13 has 3 allergy-type
`lists` rows and 60 medication-type rows practice-wide, i.e. this table is
**not** derived from `lists` row existence — it only reflects whether the
issue *editor* was ever used for that `(pid, type)`, which for pid 13's
allergy/medication data (Synthea-imported, not editor-saved) it wasn't.

**Readers:** `getListTouch($pid, $type)`, `library/lists.inc.php:130-139`.
**Writers:** `add_edit_issue.php:279`, eRx import, `library/ajax/lists_touch.php`
(all per `ui/DEMOGRAPHICS-PART2-CARDS.md`, not re-traced here).

### `prescriptions`

`sql/database.sql:8698-8751` (54 lines). The Prescriptions card's table,
and half of `PrescriptionService::getBaseSql()`'s UNION (the other half is
`lists` type=medication — see `modules/MEDICATION-SERVICES.md`).

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|
| `id` | int(11) | No | auto_increment | PRIMARY KEY | |
| `uuid` | binary(16) | Yes | NULL | UNIQUE KEY | 0 NULL locally |
| `patient_id` | bigint(20) | Yes | NULL | KEY `patient_id` | |
| `active` | int(11) | No | `1` | — | **The soft-delete/status flag** — `DELETE /api/prescription/:uuid` sets this to `0` rather than removing the row (`PrescriptionService.php:465-466`). **Not honored as a filter anywhere in the live PHP card**: `Prescription::__construct()` hardcodes `$this->active = 1` and `ORDataObject::populate_array()` skips `empty()` values, so a DB `0` never overrides it (`ui/DEMOGRAPHICS-PART2-CARDS.md` Finding 3, re-confirmed: **local data has `active=1` on all 56 rows**, so this can't be directly observed against the seed, only reasoned from code) |
| `date_added` | datetime | Yes | NULL | — | Card's "Filled" column, shown raw (`YYYY-MM-DD HH:MM:SS`) |
| `date_modified` | datetime | Yes | NULL | — | Sort key 2 (`ORDER BY active DESC, date_modified DESC, date_added DESC`) |
| `end_date` | date | Yes | NULL | — | Feeds `status` computation only (`completed` vs `active`/`stopped`); not selected by the outer `PrescriptionService` query |
| `drug`, `dosage`, `quantity`, `size`, `unit`, `route`, `interval` | varchar/int | mostly Yes | mostly NULL | — | Card's Drug/Details/Qty columns |
| `refills` | int(11) | Yes | NULL | — | Real, populated column (55 of 56 local rows NULL, 1 row `=6`) but **`PrescriptionService::getBaseSql()` never selects it** — confirmed by grep, `modules/MEDICATION-SERVICES.md` Finding 4 — so it is unavailable via `/api/prescription` and reported as a hardcoded `0` via `/fhir/MedicationRequest` |
| `drug_dosage_instructions` | longtext | Yes | NULL | — | A **second, `prescriptions`-table-local** column of the same name as `lists_medication.drug_dosage_instructions`; `PrescriptionService.php:175` does select `prescriptions.drug_dosage_instructions` into the UNION's prescriptions branch, unlike the lists branch's version of the same key, which comes from the joined `lists_medication` table. Both branches expose a `drug_dosage_instructions` key in the response with the **same name but different source columns** — not previously flagged in `modules/MEDICATION-SERVICES.md`'s field table (Finding D-4) |
| `created_by`, `updated_by` | bigint(20) | Yes | NULL | — | No `date_created` (only `date_added`, which is app-set, not DB-defaulted) |

**Migration drift:** none material found for the columns above; `refills`,
`drug_dosage_instructions`, `usage_category`/`request_intent` and
`created_by`/`updated_by` are already present in `database.sql`'s base
DDL, not added by a later upgrade script (unlike `care_teams`/`care_team_member`,
see below).

**Readers:** `Prescription::prescriptions_factory()` (legacy card,
`library/classes/Prescription.class.php:1206-1250`, `SELECT id … ORDER BY
active DESC, date_modified DESC, date_added DESC`, then one `new
Prescription($id)` per row), `PrescriptionService::getBaseSql` (both the
standard REST and FHIR paths — `modules/MEDICATION-SERVICES.md`).
**Writers:** `PrescriptionService::insert` (`POST /api/prescription`),
`PrescriptionService::delete` (soft, `active=0`); the `PrescriptionService`
**constructor** additionally backfills missing `uuid`s across five tables
(`prescriptions`, `patient_data`, `form_encounter`, `users`, `drugs`) on
**every** request, GETs included (`modules/MEDICATION-SERVICES.md` Finding
15 — a write on a read path).

### `care_teams`

`sql/database.sql:14780-14793` (14 lines). One row per care team.
**Confirmed by SQL: pid 13 has exactly one seeded team, `status='active'`.**

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|
| `id` | int(11) | No | auto_increment | PRIMARY KEY | |
| `uuid` | binary(16) | Yes | NULL | UNIQUE KEY | |
| `pid` | int(11) | No | — (no default) | — | FK to `patient_data.pid`, not enforced |
| `status` | varchar(100) | Yes | `'active'` | — | `list_options` list `Care_Team_Status`: `active`/`proposed`/`suspended`/`inactive`/`entered-in-error` (`sql/database.sql:6900-6905`) — a clean 1:1 with the five FHIR R4 `CareTeamStatus` codes (`modules/CARE-TEAM-SERVICES.md` "Team status mapping"). `entered-in-error` functions as this table's only soft-delete-like state, and it **is** excluded by the card's own query (`WHERE ct.status IS NULL OR ct.status != 'entered-in-error'`) but **not** by the FHIR search path's default (no status filter at all unless the caller supplies one) |
| `team_name` | varchar(255) | Yes | NULL | — | Card `<h5>`; local value carries the seed marker `[seed:phase1]` |
| `note` | text | Yes | NULL | — | Team-level note, distinct from `care_team_member.note` |
| `date_created`, `date_updated`, `created_by`, `updated_by` | datetime/datetime/bigint/bigint | mixed | `CURRENT_TIMESTAMP` / auto-update / NULL / NULL | — | Standard audit columns, present from this table's introduction (not bolted on later) |

**Migration drift — this table was reshaped, not just extended.**
`sql/7_0_3-to-7_0_4_upgrade.sql:179-267` renames a pre-existing single-table
`care_teams` design (`care_teams_v1`, one row per patient with a free-text
member list, not read for this pass) to the current normalized
`care_teams` + `care_team_member` pair, then migrates every `care_teams_v1`
row into the new shape. **This means any OpenEMR install upgraded from
before 7.0.4 could have care-team history whose original member data was
best-effort-converted; a fresh 7.0.4+ install (like this one) has no such
legacy data.** Current `database.sql`/live schema match exactly (`SHOW
CREATE TABLE`, no drift).

**Readers/Writers:** see `modules/CARE-TEAM-SERVICES.md` (this doc does
not repeat the query-shape analysis: `getCareTeamData()` vs `search()`/`getAll()`
read genuinely different `care_team_member` result sets — restated in
Findings below since it's a schema-usage split, not just a code path
split).

### `care_team_member`

`sql/database.sql:14795-14812` (18 lines). One row per member (provider,
contact, or facility) of a `care_teams` row. **Confirmed by SQL: pid 13's
one team has 3 members — 2 `active` (nurse, primary_care_provider), 1
`inactive` (specialist).**

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|
| `id` | int(11) | No | auto_increment | PRIMARY KEY | |
| `care_team_id` | int(11) | No | — | part of `care_team_member_unique` | FK to `care_teams.id`, not enforced |
| `user_id` | bigint(20) | Yes | NULL | part of `care_team_member_unique` | FK to `users.id` — a provider/staff member |
| `contact_id` | bigint(20) | Yes | NULL | part of `care_team_member_unique` | FK to `contact.id` — a non-user contact person. Local data: all 3 rows have `user_id` set and `contact_id` NULL |
| `facility_id` | bigint(20) | Yes | NULL | part of `care_team_member_unique` | FK to `facility.id` |
| `role` | varchar(50) | No | — | — | `list_options` list `care_team_roles`, 16 seed options (`sql/database.sql:14818-14834`, e.g. `nurse`, `primary_care_provider`, `specialist`) |
| `status` | varchar(100) | Yes | `'active'` | — | **The load-bearing column for this table's biggest finding** (Finding D-5 below): honored by one read path, ignored by the other two |
| `provider_since` | date | Yes | NULL | — | Card's "Since" column |
| `note` | text | Yes | NULL | — | Card's "Note" column; interpolated unescaped into `innerHTML` client-side (stored XSS, `ui/CARE-TEAM-CARD.md` Finding 4 — restated, not re-verified here) |
| `date_created`, `date_updated`, `created_by`, `updated_by` | mixed | mixed | `CURRENT_TIMESTAMP`/auto/NULL/NULL | — | |

**Unique key note:** `care_team_member_unique (care_team_id, user_id,
facility_id, contact_id)` allows more than one row with the same
`care_team_id` if `user_id`/`facility_id`/`contact_id` combination differs
by having some columns NULL — MySQL/MariaDB unique indexes treat NULL as
distinct from any other NULL, so e.g. two rows with the same
`care_team_id`, `user_id=NULL`, `facility_id=NULL`, but different
`contact_id`s are both allowed, as are two rows that are NULL in all three
member-reference columns. Not observed as a live issue on this seed (every
row has a non-NULL `user_id`), but worth the port team knowing the
constraint doesn't fully prevent duplicate "empty" member rows.

**Migration drift:** introduced whole by `sql/7_0_3-to-7_0_4_upgrade.sql:196-211`
alongside the `care_teams` reshape above; no drift from `database.sql`/live.

**Readers — three different filter shapes over the same table** (fully
traced in `modules/CARE-TEAM-SERVICES.md`, restated here as the schema
fact): `CareTeamService::getCareTeamData()`'s subselect filters `WHERE
status != 'inactive' AND status != 'entered-in-error'` **before** joining
(the card's only source — 2 of 3 local rows survive); `getCareTeamProviders()`/`getCareTeamFacilities()`/`getCareTeamContacts()`
(the FHIR API's only source) filter only on `care_team_id`, with **no
`status` predicate at all** (all 3 local rows survive, including the
inactive specialist — confirmed by SQL, `modules/CARE-TEAM-SERVICES.md`
"Key question"); `getExistingCareTeamMembers()` (write-path helper, not
re-verified) is also unfiltered by status. **Writers:** `saveCareTeam()`'s
private helpers (`CareTeamService.php:447-545`), no ACL check (restated
from `modules/CARE-TEAM-SERVICES.md` Finding 6, not re-verified this
pass).

### `form_vitals`

`sql/database.sql:2418-2451` (34 lines). One row per recorded vitals set.
**Live schema (`SHOW CREATE TABLE`) carries column comments not present in
`database.sql`'s DDL** — added by an upgrade script's `ALTER TABLE …
COMMENT`, not individually traced, but the comment text itself is
significant (see below): `height` is commented `'patient height stored in
imperial in'` and `weight` `'patient weight stored in imperial lbs'` —
i.e. the column's own DDL comment documents it as inches-only, with no
paired unit column.

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|
| `id` | bigint(20) | No | auto_increment | PRIMARY KEY | Joined to `forms.form_id` — **not** a foreign key to `forms.id` |
| `uuid` | binary(16) | Yes | NULL | UNIQUE KEY | |
| `pid` | bigint(20) | Yes | `0` | KEY `pid` | |
| `date` | datetime | Yes | NULL | — | The set's timestamp; the port's recommended grouping key (`modules/VITALS-SERVICES.md` Port notes — `effectiveDateTime`, not `encounter`, since one encounter can hold two vitals sets, confirmed on pid 13's own seed) |
| `height` | decimal(12,6) | Yes | NULL (`0.00` in `database.sql`'s original default, dropped live) | — | **Documented as inches-only** (live column comment), but **local data holds centimeter-scale values for every Synthea-imported patient** — see Data-quality below. No `height_unit`/`height_cm` column exists anywhere in this table to disambiguate |
| `weight`, `temperature`, `pulse`, `respiration`, `BMI`, `waist_circ`, `head_circ`, `oxygen_saturation`, `oxygen_flow_rate`, `inhaled_oxygen_concentration` | decimal | Yes | mixed | — | Each is a single un-unit-suffixed column; `units_of_measurement` (a **site global**, not a per-row column) determines whether the PHP report and the FHIR mapping treat the stored number as US or metric — confirmed locally `units_of_measurement=1` (US units) |
| `BMI_status` | varchar(255) | Yes | NULL | — | Pediatric BMI percentile status; not exposed on the FHIR `Observation` resource at all (`modules/VITALS-SERVICES.md` Port notes) |
| `bps`, `bpd` | varchar(40) | Yes | NULL | — | Blood pressure systolic/diastolic, stored as strings, not numeric columns |
| `last_updated` | datetime | No | `CURRENT_TIMESTAMP` (auto-update) | — | The only reliable "last modified" column; `_lastUpdated` maps to it correctly only on the vitals-specific FHIR service, not the generic Observation router (`modules/VITALS-SERVICES.md` Layout/interface table) |

**No `deleted` column on this table at all** — soft-delete for a vitals
set lives entirely on the **joined** `forms` row (see next table). This is
the structural reason two independent bugs (a join collision in the PHP
fragment, a missing filter in the FHIR/`VitalsService::search()` path)
both leak the same deleted set through: there is no way to ask
`form_vitals` itself "is this one deleted."

**Readers:** `VitalsService::search()` (`src/Services/VitalsService.php:85-223`,
shared by the PHP dashboard fragment's SQL — no, corrected: **not**
shared; `vitals_fragment.php` has its own independent query — and by the
FHIR path); `EncounterService` (`src/Services/EncounterService.php:564,588,600,607`,
encounter-scoped standard REST, a narrower surface). **Writers:**
`VitalsService::save()`/`saveVitalsArray()` (not traced, out of the
read-only port's scope).

### `forms`

`sql/database.sql:2460-2478` (19 lines). A generic per-encounter form
registry shared by **every** form type in OpenEMR (vitals, SOAP notes,
new-patient, procedure orders, …) — `form_id` is this table's pointer into
whichever specialty table `formdir` names, and it is **not unique on its
own**.

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|
| `id` | bigint(20) | No | auto_increment | PRIMARY KEY | The table's own global identity |
| `form_id` | bigint(20) | Yes | NULL | KEY `form_id` (non-unique) | Points into the `formdir`-named specialty table's own `id` (e.g. `form_vitals.id`). **Confirmed by SQL: 355 of the local install's distinct `form_id` values are shared across more than one `formdir`** (`SELECT form_id FROM forms GROUP BY form_id HAVING COUNT(DISTINCT formdir) > 1` → 355 rows), out of 1,438 total `forms` rows. This is the mechanism behind `ui/VITALS-FRAGMENT.md`'s U-1: joining `form_vitals.id = forms.form_id` **without** also constraining `forms.formdir = 'vitals'` can match a `newpatient`/`procedure_order`/etc. row that happens to share the same `form_id` value and a different `deleted` flag |
| `formdir` | longtext | Yes | NULL | — | The disambiguator `form_id` needs; `(form_id, formdir)` together identify one specialty-table row unambiguously (confirmed: `VitalsService::search()`'s join adds `AND forms.formdir='vitals'` and is collision-free on pid 13's 5 vitals rows, `modules/VITALS-SERVICES.md` "The join fix, confirmed by SQL") |
| `pid`, `encounter` | bigint(20) | Yes | NULL | KEY `pid_encounter (pid, encounter)` | |
| `deleted` | tinyint(4) | No | `0` | — | The soft-delete flag every specialty-table reader must AND against — **and must also constrain by `formdir`**, or the flag can belong to the wrong row entirely (see `form_id` above) |
| `date` | datetime | Yes | NULL | — | Aliased `date_created` by `VitalsService::search()`'s join; used for `ORDER BY encounter_date DESC` via the `form_encounter` join, not this column directly, in that query |

**Local confirmation of the exact bug pattern (pid 13, read-only SQL):**
`form_vitals.id=28` (2026-05-01, seeded `deleted=1`) joins correctly to
`forms.form_id=28, formdir='vitals', deleted=1` when the join includes
`formdir='vitals'` — **no collision on this specific row locally** (the
formdir-qualified join is correct and returns exactly the right `deleted`
flag). The bug in `vitals_fragment.php:27` (no `formdir` condition at all)
is a *live, exploitable* collision in general — 355 shared `form_id`
values prove the precondition exists broadly in this install — but pid
13's specific vitals rows happen not to individually collide with another
formdir's row *at that exact id* locally; the fragment's bug is
confirmed by reading its actual join and by `ui/VITALS-FRAGMENT.md`'s
independent trace, not by finding a live cross-formdir collision on
`form_id=28` specifically. Do not read the "355 collisions" count as
"formdir=28 specifically collides" — it is a table-wide density figure
showing the join hazard is real and common, not a per-row reproduction.

**Readers:** every `form_vitals` reader (via the join discussed above); no
writer traced this pass (`\addForm()` helper, defined elsewhere, not
read).

### `pnotes` — documented only as not-ported

`sql/database.sql:8670-8689` (20 lines). Full column list included for
completeness, but **this table has no read path anywhere in the REST or
FHIR API** — confirmed in `api/CLINICAL-CARDS.md` DB-08 (exhaustive grep
of every `Fhir*`/`*RestController`/route file) and restated in
`ui/DEMOGRAPHICS-PART2-CARDS.md`'s Messages section. The SPA cannot show
this card; per `AUDIT-STATE.md`'s 2026-09-25 decision it is out of the
port's scope entirely, not merely deprioritized.

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|
| `id` | bigint(20) | No | auto_increment | PRIMARY KEY | |
| `pid` | bigint(20) | Yes | NULL | KEY `pid` | |
| `date` | datetime | Yes | NULL | — | `ORDER BY date DESC` in the legacy query |
| `body`, `title` | longtext/varchar | Yes | NULL | — | Message content |
| `deleted` | tinyint(4) | Yes | `0` | — | Soft delete, honored by the legacy `deleted != 1` filter |
| `activity` | tinyint(4) | Yes | NULL | — | A second, independent "is this note live" signal (legacy filter: `activity='1'`) |
| `message_status` | varchar(20) | No | `'New'` | — | Legacy filter excludes `'Done'` — the reason the seeded probe saw 2 of 3 active notes |
| `assigned_to`, `update_by`, `update_date` | mixed | Yes | NULL | — | No `created_by`; `update_by`/`update_date` only cover the most recent edit |

**Readers:** `getPnotesByDate()`, `library/pnotes.inc.php:147-206` (legacy
only). **Writers:** `MessageService::insert/update/delete`
(`src/Services/MessageService.php:44-116`, OAuth scope `user/message.cud`
— create/update/delete, **no read scope exists**); `pnotes_fragment.php`'s
"Completed" button → `disappearPnote()`.

### `list_options`

`sql/database.sql:3887-3905` (19 lines). Shared option/title table for
every OpenEMR "list" (dropdown/enum), keyed `(list_id, option_id)`. The
lists the in-scope cards resolve, with local row counts:

| `list_id` | Purpose for this port | Local option count | Notes |
|---|---|---|---|
| `severity_ccda` | Allergy severity label | 8 (`unassigned`…`fatal`, `sql/database.sql:5389-5396`) | 2 of 3 local allergy rows store `severity_al='1'`, not a member of this list — see Finding D-3 |
| `outcome` | Issue outcome label (not currently rendered by any in-scope card, but consulted by `filterActiveIssues()`'s `!= 1` check and by FHIR `clinicalStatus`) | 6 (`0`…`5`, `sql/database.sql:4401-4406`) | 246 of 249 local `medical_problem` rows store `outcome=6`, not a member — Finding D-2 |
| `Care_Team_Status` | Team **and** member status badge title | 5 (`sql/database.sql:6901-6905`) | Exact 1:1 with FHIR R4 `CareTeamStatus` codes — the one clean mapping in this whole audit; safe for the SPA to hardcode |
| `care_team_roles` | Member role label / SNOMED code source | 16 (`sql/database.sql:14818-14834`) | Free-text list vs. FHIR's SNOMED coding — `role.coding[0].display` does carry the same title string (`modules/CARE-TEAM-SERVICES.md`, correcting `api/CLINICAL-CARDS.md`'s earlier claim) |
| `drug_units`, `drug_interval`, `drug_route` | Prescriptions "Details" column composition | 10 / 21 / 22 (confirmed by count, local) | `unit_title`/`interval_title`/`route_title` are joined server-side into the `/api/prescription` response; `route_title` is not currently used by the card display per `ui/PRESCRIPTION-TEMPLATES.md` |
| `physician_type` | Care Team provider's secondary role/type title, used in the "Fname Lname (physician_type)" member display | 15 | Only reachable via `users.physician_type` → this list; not itself a `care_team_member` column |

**Readers:** `LayoutsUtils::getListItemTitle()` (`src/Common/Layouts/LayoutsUtils.php:17-24`,
falls back to the raw stored code when no active option row matches — this
is the shared mechanism behind both the `severity_al='1'` and `outcome=6`
findings), plus every service above that LEFT JOINs `list_options`
directly for a title. **Writers:** the admin list editor, not audited
this pass.

## Stored logic

None. `information_schema.TRIGGERS` and `.VIEWS` return zero rows for
`openemr`, and `SHOW PROCEDURE STATUS` returns none, confirmed read-only
against the local DB. All "business logic" for these tables — filtering,
status derivation, soft-delete honoring — lives entirely in PHP (the
`Service`/`FhirService` classes cited throughout this document and in
`modules/*.md`), not in the database. A port that talks only to the API
inherits whichever subset of that PHP logic the specific endpoint it calls
happens to apply — which, per `modules/CARE-TEAM-SERVICES.md`,
`modules/MEDICATION-SERVICES.md` and `modules/VITALS-SERVICES.md`, is
frequently a *different* subset than the PHP dashboard card uses for the
same data.

## Seed data & defaults

- **`user_settings` seeds the per-card default collapse state** for user 0
  (`sql/database.sql:9910-9926`): expanded (`1`) for `allergy`,
  `medical_problem`, `medication`, `prescriptions`, `vitals`; collapsed
  (`0`) for `billing`, `demographics`, `disclosures`, `insurance`,
  `patient_reminders`, `pnotes`. No row exists for `careteam`, and
  `getUserSetting()` returns NULL for a missing label, which the PHP
  compares `NULL == 0` (true) — so Care Team starts **collapsed** by
  omission, not by an explicit default (`ui/DEMOGRAPHICS-PART2-CARDS.md`
  "Collapse state"). This is schema-adjacent seed data, not a table this
  port reads directly, but it explains why the Care Team card's default
  state can't be reproduced from `care_teams`/`care_team_member` alone.
- **Phase 1 seed marker:** `care_teams.team_name` for pid 13 carries the
  literal string `[seed:phase1]`, and the seeded `care_team_member` rows
  are the only non-empty care-team data in the whole install — every other
  patient has zero `care_teams` rows (`RECON.md` line 59, re-confirmed:
  `SELECT COUNT(*) FROM care_teams` → 1).
- **Synthea import defaults:** the bulk `lists.enddate = '2017-10-22
  10:23:21'` value shared by 241 of 312 rows, and the `form_vitals.height`
  values in the 40–183 range for patients 1–12 (see Data-quality), are
  both Synthea-generator artifacts baked into the seed data, not
  OpenEMR schema defaults.
- **`pid 13` vs `pid 3`:** per the brief's seed note, pid 13 is the
  richest (2 allergies, 39 problems as of David's edit, 5 medications, 5
  prescriptions, 1 care team of 3 members, 5 pnotes, 4 extra vitals sets)
  and pid 3 is the empty-state patient — but pid 3 still has exactly one
  `form_vitals` row, like every patient (`id=14`, `pid=3`, `height=40`).

## Data-quality notes

- **D-1. Synthea name-suffix noise.** 10 of 13 local `patient_data` rows
  have a digit in `fname` or `lname` (`SELECT COUNT(*) FROM patient_data
  WHERE fname REGEXP '[0-9]' OR lname REGEXP '[0-9]'` → 10). Confirms
  `RECON.md` B-11 ("Zack583 Metz686") with a count; the schema itself has
  no width or format constraint that would reject this (`fname`/`lname`
  are plain `varchar(255) NOT NULL DEFAULT ''`).
- **D-2. `lists.outcome=6` is not a defined `outcome` list option.**
  246 of 249 local `medical_problem` rows carry `outcome=6`; the
  `list_options` list `outcome` only defines `0`–`5`
  (`sql/database.sql:4401-4406`). `filterActiveIssues()`'s `outcome != 1`
  check still behaves correctly (6 ≠ 1), so this is currently invisible on
  the card, but it is the same class of bug as D-3 below and would surface
  the moment any code called `getListItemTitle('outcome', …)` on these
  rows (nothing currently does, for the in-scope cards).
- **D-3. `lists.severity_al='1'` is not a `severity_ccda` option.**
  2 of 3 local allergy rows; this is `RECON.md`'s "(1)" observation,
  counted directly against the seed data. `getListItemTitle('severity_ccda',
  '1')` falls back to the raw stored value `'1'`, which is what renders.
- **D-4. `form_vitals.height` holds centimeter-scale values in a
  documented inches-only column, with no unit column to disambiguate.**
  The live schema's own DDL comment says `'patient height stored in
  imperial in'`; the site global `units_of_measurement=1` (US/imperial) is
  the only run-time signal for how to interpret the stored number, and it
  applies uniformly to the whole install, not per-row. Local data (`id,
  pid, height`): pid 1→70, pid 2→60, pid 3→40, pid 4→78.9, pid 5→160, pid
  6→57.5, pid 7→158.5, pid 8→160.3, pid 9→138.9, pid 10→136.8, pid
  11→176.7, pid 12→183.4 (all Synthea-imported, single row each) versus
  pid 13's four phase-1-seeded rows, all `height=67` (a plausible adult
  inch value). Several of the Synthea values (160, 170.3, 183.4, 176.7)
  are implausible as inches for an adult (13–15 feet tall) but entirely
  plausible as centimeters — strong evidence the Synthea import wrote
  metric height into a column the rest of the system treats as inches.
  `form_vitals` has **no separate height-unit or height-cm column at all**
  — this is a single-column, single-unit design; there is no way to fix
  the ambiguity from the schema alone, only from knowing which rows came
  from which import path (not recorded anywhere in this table).
- **D-5. `form_vitals`/`forms` has no table-local soft-delete signal.**
  Restated as a schema fact underlying two independent bugs documented
  elsewhere (`ui/VITALS-FRAGMENT.md` U-1, `modules/VITALS-SERVICES.md`
  Finding 1): `deleted` lives only on `forms`, reachable only via a join
  keyed on the non-unique `form_id`, so every reader must both join
  correctly (`formdir='vitals'`) **and** filter `deleted=0` explicitly —
  no default protects a reader that does one but not the other, and the
  FHIR/API read path does neither (no `deleted` search parameter is even
  registered).
- **`forms.form_id` is only unique per `(formdir, pid)`, not globally.**
  355 of the local install's distinct `form_id` values are shared across
  two or more `formdir`s (`GROUP BY form_id HAVING COUNT(DISTINCT formdir)
  > 1`), out of 1,438 total rows — this density figure is why a join on
  `form_id` alone (`vitals_fragment.php:27`) is a live hazard across the
  whole install, not a one-off.
- **NULL vs `''` vs zero-date in `enddate`.** Confirmed locally: `lists.enddate`
  is either NULL (71 rows) or a real datetime (241 rows, overwhelmingly
  one shared Synthea-import value); **no** row uses the legacy
  `'0000-00-00 00:00:00'` sentinel. `filterActiveIssues()`'s `empty()`
  check treats NULL and `''` identically (both "no end date"); a
  `0000-00-00…` value is not `empty()` in PHP, but `strtotime()` on it
  returns `false` (≈0), which fails the `> strtotime('now')` test — so if
  such a row ever exists, it would be (correctly) treated as ended, by
  accident of `strtotime()`'s behavior rather than by design. Untestable
  against this seed; flagged as an open question for the port (see Port
  notes).
- **`prescriptions.refills` is a real, populated column the API drops.**
  1 of 56 local rows has a non-default value (`6`); the rest are NULL
  (not `0`) — confirming the column is genuinely optional data, not a
  universally-zero field, which makes `PrescriptionService`'s omission of
  it (and FHIR's resulting hardcoded `0`) a loss of real information, not
  a no-op on empty data.
- **`lists_medication` and `list_medication`-dependent fields are
  untestable locally.** 0 rows — every gap this audit's sibling docs flag
  around `drug_dosage_instructions` for Medications-card rows is real per
  the code, but cannot be cross-checked against live data in this
  install.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| D-1 | Data quality | Low | Synthea-imported patient names carry digit suffixes (10 of 13 local patients); no schema constraint prevents or flags this. | `patient_data.fname/lname`, local SQL count | Port: treat as cosmetic seed-data noise, not a bug to fix; document for demo/screenshot purposes |
| D-2 | Data quality / Half-implemented | Medium | `lists.outcome=6` (246 of 249 local `medical_problem` rows) is not a defined `outcome` list option (`0`–`5` only). Currently invisible on the card (the loose `!= 1` filter doesn't care), but would break any future title lookup or a stricter port-side validation of `outcome`. | `sql/database.sql:4401-4406` (list definition) vs. local `SELECT outcome, COUNT(*) FROM lists GROUP BY outcome` | Port: don't attempt to resolve `outcome` to a title; treat it as an opaque code if ever surfaced |
| D-3 | Data quality (restated, now counted) | Medium | `lists.severity_al='1'` (2 of 3 local allergy rows) is not a `severity_ccda` option id; `getListItemTitle()` falls back to the raw code, producing the "(1)" the PHP card and RECON both observed. | `sql/database.sql:5389-5396`; `src/Common/Layouts/LayoutsUtils.php:17-24`; local SQL | Port: replicate the fallback-to-raw-code behavior rather than hiding/erroring on an unmapped severity |
| D-4 | Schema smell | Low | `prescriptions.drug_dosage_instructions` and `lists_medication.drug_dosage_instructions` are two different columns on two different tables that both surface under the identical JSON key `drug_dosage_instructions` in `PrescriptionService`'s UNION response, sourced differently per branch. Not documented in `modules/MEDICATION-SERVICES.md`'s field table. | `src/Services/PrescriptionService.php:113,175,229`; `sql/database.sql:7720,8744` | Port: treat the field as branch-dependent provenance, not a single consistent column; no action needed if the port already keys off `source_table` |
| D-5 | Bug (data-safety), schema root cause | High (provisional — restates and grounds `modules/VITALS-SERVICES.md` Finding 1 and `ui/VITALS-FRAGMENT.md` U-1 in the table design) | Neither `form_vitals` nor a per-set relationship exposes soft-delete directly; the only signal is `forms.deleted`, reachable solely through a join on the non-unique `form_id` column. Any reader that joins without `formdir='vitals'`, or that doesn't filter `deleted=0` at all (confirmed true of the FHIR/API path — no such search parameter is registered), can surface a deleted vitals set as current. | `sql/database.sql:2418-2478` (both DDLs, no `deleted` on `form_vitals`); confirmed by SQL: 355 of 1,438 local `forms` rows share a `form_id` with another `formdir` | Port: cannot filter server-side (Finding 1 in `modules/VITALS-SERVICES.md`); document as a hard "not available via API" gap per DB-10, or request a scoped, explicitly-approved backend change registering a `deleted` search field |
| D-6 | Data quality | Medium | `form_vitals.height` (documented inches-only by its own live column comment) holds values consistent with centimeters for essentially every Synthea-imported patient (1 row each, values 40–183), while the phase-1-seeded pid 13 rows correctly hold inch values (~67). No unit column exists to disambiguate row-by-row; the site-wide `units_of_measurement` global cannot fix per-row provenance. | `SHOW CREATE TABLE form_vitals` (live column comment); local SQL, `id,pid,height` listing above | Port: do not trust `height` at face value for the Synthea-imported patients (pid 1–12); document the unit ambiguity in the Vitals card's port notes; cannot be fixed from the API alone since the raw stored number is what both the PHP card and the FHIR mapping return |
| D-7 | Schema smell | Low | `patient_data` has no `PRIMARY KEY` clause — only `UNIQUE KEY pid`, `UNIQUE KEY uuid`, and a non-unique `KEY id`. Every audited service already joins on `pid`/`uuid`, so this has no observed behavioral effect, but ORM/query-builder code that assumes a conventional primary key needs to target `pid` or `uuid` explicitly. | `sql/database.sql:8467-8471`; live `SHOW CREATE TABLE patient_data` (confirmed identical) | Port: no action; document as a schema quirk if the port ever generates queries against `patient_data` directly rather than through the audited services |
| D-8 | Parity gap (schema-level restatement) | Medium | `care_team_member.status` is honored by exactly one of three read paths over the same table (`getCareTeamData()`, the card's source) and ignored by the other two (`getCareTeamProviders/Facilities/Contacts`, the FHIR API's source) — a single column whose meaning depends entirely on which query touches it, with nothing in the schema itself (no view, no check constraint) to enforce consistency. | `sql/database.sql:14796-14812`; full trace in `modules/CARE-TEAM-SERVICES.md` (Finding 1, provisional High there) | Port: document as "not available via API" per that unit's recommendation; this doc adds only the schema-level framing (one column, inconsistent readers) |
| D-9 | Data quality | Low | `lists.enddate`'s bulk non-NULL value (241 of 312 rows) is a single shared timestamp (`2017-10-22 10:23:21`), not per-row clinical data — a Synthea-generator artifact. A port relying on `enddate` for anything beyond the boolean "is it set" (e.g. showing an end date to the user) would surface this artifact value for most seeded rows. | Local SQL: `SELECT enddate, COUNT(*) FROM lists GROUP BY (enddate IS NULL), (enddate='')` | Port: fine for the `filterActiveIssues` boolean use; flag if any future card design shows the raw `enddate` value to a user |

## Port notes

- **Must survive:** the three-signal split for "is this issue ended"
  (`enddate` empty-or-future, `outcome != 1`, `activity` — each honored by
  a *different* subset of readers, per `modules/MEDICATION-SERVICES.md`
  and `ui/DEMOGRAPHICS-PART2-CARDS.md`); the `prescriptions.active`
  soft-delete flag as the source of truth for "stopped" even though the
  legacy card never actually filters on it; `care_teams.status='entered-in-error'`
  and `care_team_member.status` as the only soft-delete-equivalents in the
  care-team tables; `forms.deleted` + `formdir` as the only soft-delete
  signal for vitals sets.
- **Must not survive:** trusting `form_vitals.height` at face value for
  pre-phase-1 (Synthea-imported) patients without a documented unit
  caveat (D-6); assuming `lists.outcome`/`severity_al` values always
  resolve to a `list_options` title (D-2, D-3); assuming
  `care_team_member.status` is honored consistently across every API
  surface (D-8); assuming `patient_data` has a conventional single-column
  primary key (D-7).
- **Not available via API at all**, confirmed at the schema/data level in
  this pass (cross-referencing the module docs' code-level findings
  against what the tables themselves can or cannot express): a vitals
  set's deleted status (D-5 — the table design itself has no per-set flag,
  only a join-away one); `lists_touch` (no table read anywhere in
  `src/RestControllers`/`apis/routes`, confirmed by the same grep pattern
  used for DB-08); `care_team_member.status`/`note` (D-8); `prescriptions.refills`
  (present and populated, never selected).
- **Open questions:**
  - Whether a `0000-00-00 00:00:00` `enddate` sentinel exists anywhere in
    production data — absent from this seed, so `filterActiveIssues()`'s
    behavior against it is reasoned from `strtotime()` semantics, not
    observed.
  - Whether `form_vitals.height`'s apparent cm-in-inches-column pattern
    (D-6) is specific to this Synthea seed's generation process or a
    general Synthea-import characteristic worth flagging to whoever seeds
    future demo/test data.
  - Whether `outcome=6` (D-2) is a valid application-level code missing
    from `list_options` (i.e. the DDL is stale) or genuinely invalid data
    — not resolvable from the schema alone; would need an OpenEMR source
    or changelog check outside this pass's scope.
