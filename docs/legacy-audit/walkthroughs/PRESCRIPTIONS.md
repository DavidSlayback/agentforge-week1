# Walkthrough: Prescriptions card renders for a patient (DB-06)

> **Orchestrator resolution (tier 3, 2026-09-25):** both `pid` and `patient_id` scope the query (`PrescriptionService.php:225,313`). **The BFF allow-lists `patient_id` only**, because it filters the UNION column directly with no dependency on the `patient_data` join. Where this walkthrough says `pid=`, read `patient_id=`. See `VERIFICATION.md`.

Legacy: `interface/patient_file/summary/demographics.php?set_pid=N` (embedded
Smarty controller stack) → `general_fragment.html`. Port: SPA → BFF →
`GET /api/prescription` (allow-listed keys only) → `PrescriptionService` UNION
→ client sort/filter. Sources: `ui/PRESCRIPTION-TEMPLATES.md`,
`ui/DEMOGRAPHICS-PART2-CARDS.md` (§Prescriptions, "Parity spec" DB-06 row),
`modules/MEDICATION-SERVICES.md` (Q2), `modules/API-ROUTES.md` (per-card
contract table, DB-06 row), `AGENT-BRIEF.md`. Code cited at
`path:line@legacy-baseline` (tag `3ccfe1d`) for legacy paths; current-tree
paths for API/service code (unchanged by this audit).

## (a) Legacy path — UI event → PHP → service → SQL → tables

1. Browser loads `demographics.php?set_pid=13` (iframe of the tabbed shell).
   `$rx = !getBoolean('disable_prescriptions') && AclMain::aclCheckCore('patients','rx') && !in_array('card_prescriptions',$hiddenCards)`
   gates the whole card block
   (`interface/patient_file/summary/demographics.php:1098@legacy-baseline`).
2. Inside `if ($rx === 1):` (`:1185`), the view args set `auth` from
   `aclCheckCore('patients','rx','',['write','addonly'])` (`:1219`, pencil
   only) and `btnLink` to `editScripts('.../controller.php?prescription&list&id=<pid>')`
   (`:1228-1230`, the separate Edit-list surface — not read by the card body
   and not exercised by this walkthrough).
3. Card body (`:1233-1240`): `$cwd = getcwd(); chdir("../../../");` (never
   restored — smell, not a functional gate), then
   `$c = new Controller(); $c->dispatch(['controller'=>'prescription','action'=>'fragment','patient_id'=>$pid])`.
4. `Controller::dispatch()` (`library/classes/Controller.class.php:164-267@legacy-baseline`)
   re-checks the base ACL via `checkControllerAcl('prescription')` → `patients/rx`
   (`:131-144, 207`), instantiates a **fresh** `C_Prescription` (`:223`,
   constructor `C_Prescription.class.php:56-121@legacy-baseline` always runs —
   4 lookup queries for RxNorm/`inhouse_pharmacy` probes regardless of action),
   and calls `fragment_action($pid)` positionally (`array_values($args)` on
   the `patient_id` key, `Controller.class.php:226-261`).
5. `C_Prescription::fragment_action($id)` (`C_Prescription.class.php:286-300@legacy-baseline`,
   docblock says `@deprecated … isn't used` — stale/wrong, this is the live
   path) validates `$id`, calls `Prescription::prescriptions_factory($id)`
   with the default sort (no `$sort` arg passed from this call site).
6. `prescriptions_factory()` (`library/classes/Prescription.class.php:1206-1250@legacy-baseline`):
   `SELECT id FROM prescriptions WHERE patient_id = ? ORDER BY active DESC, date_modified DESC, date_added DESC`
   — **no `WHERE active`/`enddate` clause**; every status row is fetched.
   Table: `prescriptions`.
7. For each returned `id`: `new Prescription($id)` (`:1247`) →
   `ORDataObject::populate()` → `SELECT * FROM prescriptions WHERE id = ?`
   (`src/Common/ORDataObject/ORDataObject.php:123-125@legacy-baseline`), plus
   four `load_drug_attributes()` calls (`drug_route`, `drug_form`,
   `drug_interval`, `drug_units`, each `SELECT * FROM list_options WHERE
   list_id=? AND activity=1 ORDER BY seq`, `Prescription.class.php:497-503`).
   At least 5 SQL statements per row, serially, N+1 (`ui/PRESCRIPTION-TEMPLATES.md`
   Finding 3).
8. `ORDataObject::populate_array()` calls `set_<col>()` only `if
   (!empty($field))` (`ORDataObject.php:130-144,137@legacy-baseline`). A DB
   `active` of `0`/`"0"` is `empty()`, so `set_active()` never runs and
   `$this->active` keeps its constructor default of `1`
   (`Prescription.class.php:149,241@legacy-baseline`). **U-3**: the filter is
   structurally present but never fires.
9. `fragment_action` Smarty-`display()`s `templates/prescription/general_fragment.html`
   (43 lines). Its own `{if $prescription->get_active() > 0}` (`:28`) always
   passes because of step 8 — every row renders. Columns per row (`:30-35`):
   Drug = raw `$prescription->drug`; **Details = `get_size()` +
   `get_unit_display()` + `get_dosage_display()`** concatenated (not bare
   `dosage`); Qty = `get_quantity()`; Refills = `get_refills()` (real,
   populated int column); Filled = `get_date_added()` raw
   `YYYY-MM-DD HH:MM:SS`. Zero prescription rows → literal string `{xlt
   t='None'}`. Rows exist but all "inactive" (impossible in practice, see
   step 8) would instead render a header-only table.
10. Captured output (`ob_start()`/`ob_get_contents()`,
    `demographics.php:1235-1239@legacy-baseline`) becomes the `content` var of
    `templates/patient/card/rx.html.twig`, which echoes `{{ content }}` inside
    `card_base.html.twig` chrome (title "Prescriptions", collapse icon,
    pencil gated on `auth` from step 2). No loading state (synchronous
    server render); an SQL exception fails the whole page.

## (b) Port path — SPA → BFF → API route → scope/ACL → controller → service → SQL

1. SPA already holds the patient's integer `pid` and uuid from the header
   fetch (`GET /api/patient/:puuid` → `pid`, `PatientService.php:427`,
   `data/README.md` "What the build needs from this phase"). It requests
   Prescriptions for that explicit `pid` — no session state, no implicit
   patient (U-6, U-11: every call must carry the patient id explicitly).
2. BFF (confidential OAuth client, tokens server-side) calls
   `GET /api/prescription` with **only allow-listed query keys**: `pid` and
   `source_table=prescriptions`. **M-1** applies here: the route has no
   server-side key allow-list, so the BFF itself must never forward a
   client-supplied query key — it constructs the query string from its own
   fixed constant, not from anything the SPA sent.
3. Request enters the API pipeline (`modules/API-ROUTES.md` §Logic):
   authenticate as a `users`-role bearer token with `api:oemr` in scope →
   route match `GET /api/prescription`
   (`apis/routes/_rest_routes_standard.inc.php:664-667`) → scope check
   requires `user/prescription.s` (or v1 `.read`) → ACL check inside the
   closure, `RestConfig::request_authorization_check(..., 'patients', 'med')`
   (`RestConfig.php:180-194`) → **`patients/med`, not `patients/rx`** (the
   legacy card's ACL) — this is a real, confirmed divergence, not an open
   question (see §c).
4. `PrescriptionRestController::getAll` (`PrescriptionRestController.php:152-157`)
   → `PrescriptionService::getAll($search)` (`PrescriptionService.php:56-85`).
   The constructor backfills missing uuids across five tables on every
   request, reads included (`:41-42`, `UuidRegistry.php:229-234,298-322`) —
   a write side effect on a GET, out of this card's scope to change.
5. `FhirSearchWhereClauseBuilder::build($search)` turns the BFF's two fixed
   keys into `BINARY pid = ?` and `BINARY source_table = ?`-shaped clauses
   (`FhirSearchWhereClauseBuilder.php:33-45`,
   `SearchFieldStatementResolver.php:289-293`) appended to
   `PrescriptionService::getBaseSql()` (`:91-338`) — a `UNION` of the
   `prescriptions` branch and the `lists` (type medication) branch, each
   LEFT JOINed to `list_options`, `patient_data`, `form_encounter`, `users`.
   `source_table=prescriptions` keeps only the `prescriptions` branch.
6. Response envelope: `{validationErrors, internalErrors, data:[...], links}`
   (`RestControllerHelper.php:252-300`) — HTTP 200 with `data:[]` for zero
   rows (not 404; contrast the medication route). **No `ORDER BY`** in the
   SQL; sorting is the client's job.
7. BFF/SPA client-side sorts `data` by `active` DESC, `date_modified` DESC
   (NULLs last), `date_added` DESC, plus a documented stable tiebreak (e.g.
   `uuid`) — reproducing `Prescription.class.php:1208-1209`'s default order.
8. **Show-all decision (implementable, per `modules/MEDICATION-SERVICES.md`
   "Show ALL rows"):** the API applies no `active` filter either, so the
   client does not filter — this reproduces the legacy card's *as-executed*
   behavior (all rows, U-3), not its *as-written* intent. `DELETE
   /api/prescription/:uuid` sets `active=0`, and such rows still show under
   this decision, matching the legacy bug.
9. Client renders: Drug = `drug`; Details = `prescription_drug_size` +
   `unit_title` + `dosage` (+ `" in <form title> <interval_title>"` when the
   API returned an `interval_title` — **`form` is never selected by this API
   query**, so any row with a non-empty `form` cannot reproduce the legacy
   text exactly); Qty = `quantity`; **Refills = "not available via API"**
   documented placeholder, never `0` (the column is real and populated in
   the DB but never selected by `PrescriptionService`); Filled = raw
   `date_added` string (no timezone conversion needed — REST returns the
   same raw local string the card uses, unlike FHIR's UTC `authoredOn`).
10. Empty state: `data.length === 0` → "Nothing Recorded" (or the port's
    chosen empty-state wording; legacy's "None" is driven by row count only
    for this card, not by `lists_touch`, so this one is directly portable).

## (c) Where they diverge

| Rule | Legacy behavior | API behavior | Port rule (per `AGENT-BRIEF.md`) |
|---|---|---|---|
| View ACL | `patients/rx` (`demographics.php:1098,1219@legacy-baseline`) | `patients/med` (`_rest_routes_standard.inc.php:665`, `RestConfig.php:180-194`) | Document the name difference; request/require `patients/med` for the port's Rx card. A user who could see the legacy card may lack API access, and vice versa |
| Active filter | Present in template, structurally dead — `populate_array()` `empty()` bug means every row renders (**U-3**) | No filter applied by the SQL | **Show all rows** (parity with legacy-as-executed) — decided, not open |
| Patient scoping | Implicit session `$pid`, gate-checked once at page load | No documented patient parameter on the route; only accidental exact-match columns work | BFF sends only `pid=<int>` + `source_table=prescriptions`, computed server-side, never forwarded from client input (**M-1**) |
| Refills | Real column, always shown (`get_refills()`) | Column never selected by `PrescriptionService` | "Not available via API" placeholder, not `0` |
| Details / `form` | `size` + unit + `dosage`, plus `" in <form> <interval>"` when `form` or `interval` set | `form` not selected at all; `interval`/`interval_title` are | Gap accepted and documented; rows with `form` set (rare locally) render an incomplete Details string |
| Sort | SQL `ORDER BY active DESC, date_modified DESC, date_added DESC` | No `ORDER BY` | Client replicates the same 3 keys, adds a documented stable tiebreak |
| Filled date | Raw local `YYYY-MM-DD HH:MM:SS` | Same raw string (REST, not FHIR) | No conversion needed — a rare case where REST is easier to match than the FHIR alternative |
| Loading/error state | None — synchronous render, an SQL exception fails the whole page | Async fetch | Port must define its own loading/error states; there is nothing to copy |

## (d) Partial-failure points — what the user would see

- **BFF cannot resolve `pid`** (the prior `GET /api/patient/:puuid` call
  401s/403s/500s): the Prescriptions card must show an explicit error/"not
  permitted" state, never a blank card or "Nothing Recorded" (which implies
  zero rows, not a failure).
- **`GET /api/prescription` returns 401** (bad/expired token, or a missing
  `user/prescription.s` scope — indistinguishable from the body alone,
  `modules/API-ROUTES.md` §"Status handling"): treat as re-authenticate;
  the BFF must not loop on login.
- **403** (ACL denied, e.g. the user lacks `patients/med`): show a "not
  permitted" state for this card specifically — other cards' ACLs are
  independent and must not be blanked by this one's failure.
- **HTTP 200 with non-empty `validationErrors`/`internalErrors`**: must be
  treated as an error, not rendered as data or as "Nothing Recorded"
  (`modules/API-ROUTES.md` Finding 3; explicitly named in `AGENT-BRIEF.md`
  "Treat HTTP 200 validation errors … as errors").
- **500 with a SQL error body** (any malformed query, including if the
  allow-list is ever bypassed): the exception `message` — which can contain
  the full SQL statement and DB error text — must never be rendered to the
  user (`ExceptionHandlerListener.php:50-55`, `QueryUtils.php:226-230`).
- **Zero rows**: `data: []` with HTTP 200 — the one case where "Nothing
  Recorded" is correct and directly matches the legacy "None" string.
- **Row's `pid`/`puuid` mismatch**: if a future allow-list change lets a
  different patient's row through, the BFF/SPA must discard rows that don't
  match the requested patient before rendering (U-11 parity rule).

## (e) Live evidence to collect in the build

Read-only SQL against the local synthetic DB (this session, `agentforge-week1-mysql-1`):

```sql
SELECT patient_id, active, COUNT(*) FROM prescriptions
WHERE patient_id IN (13,3) GROUP BY patient_id, active;
-- pid 13: active=1, count=5. pid 3: no rows (0).
```

```sql
SELECT id, active, date_added, date_modified, form, `interval`, refills
FROM prescriptions WHERE patient_id=13
ORDER BY active DESC, date_modified DESC, date_added DESC;
-- ids 66,65,64,63,62 — all active=1, date_modified NULL (all ties),
-- form=0, interval=NULL, refills=NULL for every row.
-- Tie-break collapses to date_added DESC: 2023-02-12, 2020-03-01,
-- 2018-03-11, 2011-05-08, 1979-08-09.
```

Checklist for the walking-skeleton slice:

1. Outbound BFF→OpenEMR request for the Rx card carries exactly two query
   keys — `pid`, `source_table` — never a key sourced from client input
   (capture the request; diff against the allow-list constant).
2. `pid=13&source_table=prescriptions` returns **5** rows (matches the SQL
   count above), all with `source_table: "prescriptions"`.
3. `pid=3&source_table=prescriptions` returns HTTP **200** with `data: []`
   (not 404 — contrast the medication route's 404-on-empty) → card renders
   "Nothing Recorded".
4. Client-side sort of pid 13's 5 rows renders in `date_added` DESC order
   (66, 65, 64, 63, 62) — the active/date_modified keys are ties on this data,
   so this is the only key visibly exercised locally; note in the build that
   the `active`/`date_modified` legs of the sort are untested by pid 13 alone.
5. Refills column renders the documented placeholder (not `0` or blank
   ambiguous with a real zero) for all 5 pid-13 rows (`refills` is NULL in
   the DB for each).
6. Details column for pid 13's 5 rows shows no `" in <form> <interval>"`
   suffix (`form=0`, `interval=NULL` for all 5) — confirms the common case;
   the `form`-set gap remains unexercised by this patient and should be
   noted as such, not claimed covered.
7. Deliberate regression (per `AGENTS.md` "done" bar): temporarily let the
   BFF forward an arbitrary client query key to `/api/prescription`, and
   show the gate/test that is supposed to catch this (**M-1**) actually
   fails red before re-fixing it.
8. Drive 401 (expired token), 403 (ACL-denied test user), and a forced 500
   (if reproducible without touching production data) through the BFF and
   confirm each maps to the documented UI state in §(d), not to "Nothing
   Recorded".

## Return

Wrote: `C:\Users\david\repos\agentforge-week1-w2-dashboard\docs\legacy-audit\walkthroughs\PRESCRIPTIONS.md`

Confidence: high. The legacy sequence and the card's field mapping are
tier-2/tier-3 verified in `ui/PRESCRIPTION-TEMPLATES.md` and
`ui/DEMOGRAPHICS-PART2-CARDS.md`; the API contract is tier-3 verified in
`modules/MEDICATION-SERVICES.md` and `modules/API-ROUTES.md` with local SQL
cross-checks. The pid-13/pid-3 row counts and field values in §(e) were
independently re-verified against the local DB in this session (not merely
cited).

Contradictions found (up to 5):

1. **Query-key name for patient scoping on `GET /api/prescription`
   disagrees between two tier-3 analyses.** `modules/MEDICATION-SERVICES.md`
   Q2 verifies `pid=<integer>` works ("by accident," a column of the joined
   `patient` subquery, `PrescriptionService.php:309-311`) and recommends it
   in its own "Recommendation for the port" line. `modules/API-ROUTES.md`'s
   per-card contract table and Finding 7 instead verify and recommend
   `patient_id=<pid>` (`combined_prescriptions.patient_id`, SQL-verified
   separately). Both keys plausibly filter to the same rows for a given
   patient (they read different columns of the same UNION), but the two
   docs never test the other's key, so this is unconfirmed, not just a
   naming difference. This walkthrough follows `pid` (matching
   `AGENT-BRIEF.md`'s "M-1... GET /api/prescription" phrasing and the task
   prompt's own `pid, source_table=prescriptions`), but the BFF's final
   allow-list should pick one deliberately in Phase 7/build, not carry both
   by accident.
2. The task prompt's phrasing "ACL patients/rx? (confirm which)" is
   resolved here: the API route's ACL is confirmed **`patients/med`** by
   both `modules/MEDICATION-SERVICES.md` (Permission checks table) and
   `modules/API-ROUTES.md` (route table, line 314); `patients/rx` is only
   the legacy card's own ACL (`demographics.php:1098@legacy-baseline`). Not
   a contradiction between analyses — both agree — but worth flagging since
   the prompt implied uncertainty that the source docs don't actually have.
