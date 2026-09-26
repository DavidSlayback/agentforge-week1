# Vitals fragment (DB-08) — async card body + shared report renderer

`vitals_fragment.php` is the AJAX-loaded body of the dashboard's Vitals card.
It runs a "most recent, non-deleted vitals set" query, then hands the winning
`form_vitals` row's id to a shared renderer, `vitals_report()`
(`interface/forms/vitals/report.php`), which is also used by the vitals
form's own print/report views and by `trend_form.php`. The fragment is one
of the async `placeHtml()` fetches wired up in `demographics.php`'s
document-ready handler (`demographics.php:631`, gated by `$vitals_is_registered`
computed at `demographics.php:344-345`), and its card shell (title, collapse
toggle, "Trend" button) is rendered synchronously by `demographics.php:1507-1530`
before the fragment ever runs — the fragment only fills the collapsible body.

**Source:** `interface/patient_file/summary/vitals_fragment.php` · 49 lines
(no header version stamp) · copyright 2018 Brady Miller.
Renderer: `interface/forms/vitals/report.php` · 186 lines · copyright 2018
Brady Miller, 2021 Sherwin Gaddis.
**Audited by:** tier 2 · confidence high, except the "current live behavior"
finding below, which is SQL-confirmed but still provisional per audit rules
(see Findings #1).

## Purpose & lifecycle

1. `demographics.php:1507-1530` renders the card shell
   (`patient/card/loader.html.twig`) with `title=Vitals`,
   `btnLabel=Trend`/`btnLink=../encounter/trend_form.php?formname=vitals&context=dashboard`,
   `auth` = whether `SELECT * FROM form_vitals WHERE pid=?` returns any row
   at all (`demographics.php:1511-1512`) — this existence check has no join
   bug (see Findings #1) and is independent of the fragment's own query.
2. On DOM ready, if `$vitals_is_registered` (site has the Vitals form module
   active, `demographics.php:342-344`) and the user passes
   `AclMain::aclCheckCore('patients','med')`, the page emits
   `placeHtml("vitals_fragment.php", "vitals_ps_expand")` (`demographics.php:631`).
   This ACL check only controls whether the JS *fetch call is emitted* — see
   Permission checks below for why that is not the same as a server-side
   gate.
3. **Request in:** `vitals_fragment.php:13` `require_once("../../globals.php")`
   (session/login only — no page-specific ACL); `:19-20` reads `$pid` from
   the active session (`SessionWrapperFactory`), not from any request
   parameter; `:21` `CsrfUtils::checkCsrfInput(INPUT_POST, dieOnFail: true)` —
   POST-only, dies on a bad/missing CSRF token (matches the `placeHtml()`
   POST fetch pattern used by every other async fragment card).
4. **Query** (`vitals_fragment.php:27`, the "which set wins" query — see
   Findings #1 for the confirmed behavior on the seeded data):
   ```sql
   SELECT FORM_VITALS.date, FORM_VITALS.id
   FROM form_vitals AS FORM_VITALS
   LEFT JOIN forms AS FORMS ON FORM_VITALS.id = FORMS.form_id
   WHERE FORM_VITALS.pid=? AND FORMS.deleted != '1'
   ORDER BY FORM_VITALS.date DESC
   ```
   `sqlQuery()` (`library/sql.inc.php:262-270` → `QueryUtils::querySingleRow()`)
   returns only the first row of whatever the driver hands back — there is
   no `LIMIT 1` in the SQL text, but the effect is the same.
5. **Empty state:** if `$result` is falsy (no row survived the WHERE),
   `vitals_fragment.php:29-34` echoes
   `<span class='text'>No vitals have been documented.</span>` — exact
   string, via `xlt()`. Confirmed still correct for pid 3 (see Findings, "SQL
   confirmation" below): its one vitals row (`id=14`) is not caught by the
   join bug, so pid 3 shows real data, not the empty state (matching the
   audit brief's seed note that pid 3 "does have 1 vitals row, like every
   patient").
6. **Populated state:** `vitals_fragment.php:37-39` prints
   `Most recent vitals from: <date>` (bold), where `<date>` is
   `$result['date']` — `form_vitals.date` (the vitals-taken date the user
   entered/imported), **not** `form_vitals.last_updated` and **not**
   `forms.date` (the `forms` row's own creation timestamp). There is no
   separate "Last Updated" label anywhere in this fragment or in
   `report.php` — the only date-like ui-string is "Most recent vitals from:".
   (`forms.date_created`/`form_vitals.last_updated` do exist as columns and
   do feed the FHIR side — see Parity section.)
7. `vitals_fragment.php:42-43` includes `interface/forms/vitals/report.php`
   and calls `vitals_report('', '', 1, $result['id'])` — note the first two
   arguments (`$pid`, `$encounter`) are **empty strings**, not the real
   `$pid`/encounter (see Findings #2: they are dead parameters).
8. `vitals_report()` (`report.php:34-185`):
   - `formFetch("form_vitals", $id)` (`library/api.inc.php:111-115`) — a
     **second, independent filter**: `WHERE id=? AND pid=? AND activity
     LIKE '1'`, where `pid` comes from `OEGlobalsBag::getInstance()->get('pid')`
     (the same session pid, not the unused `$pid` parameter) and `activity`
     defaults to `'1'`. On the seeded data every `form_vitals` row for pid 13
     has `activity=1` (confirmed by SQL below), so this second filter never
     actually excludes anything here — but it means a row could pass the
     fragment's join-based "not deleted" check and still be silently dropped
     by `formFetch()` if its `activity` flag were `0`. `activity` and
     `forms.deleted` are two independent soft-delete-ish flags on two
     different tables; neither this fragment nor the report reconciles them
     into one rule.
   - `getPatientData(OEGlobalsBag::getInstance()->get('pid'))` +
     `getPatientAge()` determine `$is_pediatric_patient` (age ≤ 20, or an
     age string containing "month") — used only to swap the BMI-status label
     to "See Growth-Chart" for pediatric patients and to gate the three
     `Ped *` percentile fields.
   - Iterates every column of the fetched `form_vitals` row in **DB column
     order** (`report.php:48`, `foreach ($data as $key => $value)`), skips
     `uuid, id, pid, user, groupname, authorized, activity, date` plus any
     "empty date" value or the literal string `"0.0"`, and builds an HTML
     `<table>` with `$cols` (`=1` from this caller) values per row — so with
     `cols=1` the vitals fragment renders **one field per table row**, unlike
     other callers of `vitals_report()` that may pass more columns.
   - Field-specific formatting is documented in Layout/interface below.
9. `vitals_fragment.php:44-47` appends a "Click here to view and graph all
   vitals." link to `../encounter/trend_form.php?formname=vitals` (not the
   `context=dashboard` variant the card-shell "Trend" button uses at
   `demographics.php:1520` — two different links to the same destination
   page, one with a query param the other lacks; not traced further, out of
   this unit's scope).

## Layout / interface

Field order is **DB column order in `form_vitals`** (`sql/database.sql:2418-2451`),
not a curated display order, because `report.php:48` iterates `$data` as
returned by `formFetch()`'s `SELECT *`. After the skip-list, the order
actually rendered for a typical adult record is: `bps`/`bpd` (combined into
one "Blood Pressure" row, only emitted once both are seen — `report.php:81-94`),
`weight`, `temp_method`, `temperature`, `pulse`, `respiration`, `BMI`,
`BMI_status`, `waist_circ`, `head_circ`, `oxygen_saturation`,
`oxygen_flow_rate`, `note` (falls through to the generic `else` branch,
`report.php:163-166`, no special formatting), `ped_weight_height`, `ped_bmi`,
`ped_head_circ` (pediatric-only, gated), `inhaled_oxygen_concentration`,
`external_id` (generic branch again). `height` is skipped in this listing
because it's alphabetically/positionally after `date`/`pid`/etc. in the
schema but before `weight` — the real emitted order per the schema is
`bps, bpd, weight, height, temperature, temp_method, pulse, respiration,
note, BMI, BMI_status, waist_circ, head_circ, oxygen_saturation,
oxygen_flow_rate, external_id, ped_weight_height, ped_bmi, ped_head_circ,
inhaled_oxygen_concentration` (last_updated is also skipped implicitly —
see below).

**Suppressed when empty:** any column whose value is an empty date
(`Utilities::isDateEmpty()`, `src/BC/Utilities.php:16-25` — true for `null`,
`''`, `'0000-00-00'` and (per the `match`) presumably `'0000-00-00 00:00:00'`)
or the literal string `"0.0"` is skipped entirely (`report.php:49-55`) — so a
vital recorded as exactly `0.0` (as opposed to `NULL`/unset) never renders.
`last_updated` is not in the explicit skip list but is a `DATETIME NOT NULL`
column that's never empty, so it *would* render via the generic branch if
`formFetch`'s `SELECT *` included it — it does (no column whitelist) — this
looks like an oversight (a raw, unlabeled last-updated timestamp could print
as a generic "Last Updated: `<raw datetime>`" row) but was not observed live
(David/the probes never captured the rendered fragment HTML); flagged as an
open question, not a confirmed bug.

**Per-field formatting** (`report.php`, all values pass through `text()`
for HTML-escaping; units come from `xlt()`):

| Field (DB column) | Label | Format | Units logic |
|---|---|---|---|
| `bps` + `bpd` | "Blood Pressure" | `<bps>/<bpd>` | none — raw stored values, no conversion |
| `weight` | "Weight" | `US_weight($value, $mode)` (lb, or lb+oz if `us_weight_format==2`) and/or kg via `$value * 0.45359237` | keyed off `units_of_measurement`: `1`/unset → `"<lb> (<kg>)"`; `2` → `"<kg> (<lb>)"`; `3` → lb only; `4` → kg only |
| `height`, `waist_circ`, `head_circ` | "Height"/"Waist Circ"/"Head Circ" | raw value + `xlt('in')`, converted value = `number_format(round($value * 2.54, 1), 2)` + `xlt('cm')` | same 4-way `units_of_measurement` switch as weight; `1`/unset → `"<in> (<cm>)"` — **this is the branch that produces "170.3 in (432.60 cm)"**, see Findings #3 |
| `temperature` | "Temperature" | raw + `xlt('F')`, converted = `number_format(($value-32)*0.5556, 2)` + `xlt('C')` | same 4-way switch, unit labels F/C |
| `pulse`, `respiration` | field name | `number_format($value, 0)` + "per min" | none |
| `oxygen_saturation` | "Oxygen Saturation" | `number_format($value,0)` + "%" | none |
| `oxygen_flow_rate` | "Oxygen Flow Rate" | `number_format($value,2)` + "l/min" | none |
| `BMI` | "BMI" | `number_format($value,0)` + "kg/m^2" | none |
| `ped_weight_height`, `ped_bmi`, `ped_head_circ` | "Pediatric Height Weight Percentile" / "Pediatric BMI Percentile" / "Pediatric Head Circumference Percentile" | `number_format($value,0)` + "%" | only rendered `if ($is_pediatric_patient)` — silently dropped otherwise, not just relabeled |
| `temp_method`, `BMI_status` | "Temp Method"/"BMI Status" | plain `xl()`-translated value | `BMI_status` value forced to "See Growth-Chart" when pediatric |
| `inhaled_oxygen_concentration` | field name | value + " %" appended before the generic formatter | none |
| everything else (e.g. `note`, `external_id`) | `ucwords(str_replace('_',' ',$key))` | raw `text($value)` | none |

Boolean-ish stored value `"on"` is normalized to `"yes"` before formatting
(`report.php:57-59`) for any field that isn't specially handled.

## State

```text
No module-level/global mutable state in either file.
```

**Globals read:** `units_of_measurement` (in `vitals_report()`, weight/height/
temperature branches, `report.php:100-136`), `us_weight_format` (weight
branch, `report.php:100`), `pid` (session, in both files, via
`SessionWrapperFactory`/`OEGlobalsBag`).
**Globals written:** none.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| Emit the async fetch (client-side) | yes | `AclMain::aclCheckCore('patients','med')`, `demographics.php:629` | Only gates whether the page's JS issues the `placeHtml()` request — client-side only. |
| Serve `vitals_fragment.php` itself | **missing** | — | No `AclMain::aclCheckCore()` (or any ACL) call anywhere in `vitals_fragment.php` or `report.php`. Contrast with the Messages fragment, which independently re-checks `AclMain::aclCheckCore('patients','notes')` at `pnotes_fragment.php:45` specifically because the card-emission check alone isn't a server-side guarantee. A logged-in user who lacks `patients/med` but can still reach the page (session cookie + a harvested/valid CSRF token) can POST directly to `vitals_fragment.php` and get vitals data for whatever `pid` is in their session. See Findings #4. |
| `formFetch()`'s own filter | n/a (data filter, not ACL) | `WHERE id=? AND pid=? AND activity LIKE ?` | Uses the session pid via `OEGlobalsBag`, not a passed-in authenticated scope; not a permission check. |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `form_vitals` | Yes (`date`,`id` via the join; then `SELECT *` via `formFetch`) | No | `vitals_fragment.php:27`; `report.php:37` (`formFetch`) | No (read-only fragment) |
| `forms` | Yes (`deleted`, joined on `form_id` only) | No | `vitals_fragment.php:27` | No |
| `patient_data` | Yes (`getPatientData()`, for DOB → pediatric-age check) | No | `report.php:38` | No |

## Cross-links

- **Opened by:** `demographics.php:631` (async `placeHtml`) and the card
  shell at `demographics.php:1507-1530`.
- **Calls into:** `interface/forms/vitals/report.php` (`vitals_report()`),
  `library/api.inc.php` (`formFetch()`), `library/patient.inc.php`
  (`getPatientData()`, `getPatientAge()`), `src/BC/Utilities::isDateEmpty()`.
- **Shares `vitals_report()` with:** other Vitals-form views not audited
  here (`interface/forms/vitals/` print/history views, `trend_form.php`) —
  not traced, out of scope for this unit.
- **Parallel unit:** `src/Services/VitalsService.php` and
  `src/Services/FHIR/Observation/FhirObservationVitalsService.php` implement
  an **independent** query/filter/conversion path for the same `form_vitals`
  table (used by the API, not by this PHP card) — see Parity section. They do
  *not* share code with `vitals_fragment.php`/`report.php`; any future PHP
  fix to one path won't automatically fix the other.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Bug | **Critical (provisional)** | The "most recent, non-deleted vitals set" query joins `forms` on `FORM_VITALS.id = FORMS.form_id` **with no condition tying `forms.pid` to `form_vitals.pid` and no `forms.formdir='vitals'` filter**. `forms.form_id` is only unique *within* a given `formdir`+`pid`, so this join fans out to unrelated `forms` rows for *other patients'* *other form types* that happen to share the same numeric id. Confirmed on the seeded data by SQL: `form_vitals.id=28` (pid 13, the seed's deliberately-deleted 2026-05-01 set, `forms.id=1438` deleted=1) also numerically collides with `forms.id=62` (pid 4, `procedure_order`, deleted=0) and `forms.id=64` (pid 5, `newpatient`, deleted=0). Running the exact fragment query for pid 13 returns `id=28` (deleted set) as the top/only row after `ORDER BY date DESC` — **the "hidden" 2026-05-01 set wins, not the 2026-04-05 set** the audit brief expected. `formFetch()`'s own `activity` filter does not catch this either (pid 13's rows are all `activity=1`). | `vitals_fragment.php:27` | Add `AND FORMS.formdir = 'vitals' AND FORMS.pid = FORM_VITALS.pid` to the join/WHERE (or join on `forms.id` — the true PK — via a `form_id`+`formdir`+`pid` composite instead of the bare numeric `form_id`). |
| 2 | Smell / Dead code | Low | `vitals_report($pid, $encounter, $cols, $id, $print)`'s first two parameters (`$pid`, `$encounter`) are never referenced in the function body; every internal pid lookup instead reads `OEGlobalsBag::getInstance()->get('pid')` directly. The only caller in this unit passes empty strings for both (`vitals_fragment.php:43`). | `report.php:34`, `vitals_fragment.php:43` | Drop the unused parameters or wire them through if other callers rely on an explicit pid/encounter (not traced here). |
| 3 | Bug (data quality, not UI) | Medium | pid 13's original 2018 vitals row stores `height=170.300000`. Because `form_vitals` has no unit column and the app's own JS comment states "all values are saved in usa system units" (`interface/forms/vitals/vitals.js:129`), and the site global `units_of_measurement` defaults to `'1'` ("Show both US and metric, main unit is US" — `library/globals.inc.php:727-737`, unset for this site), `report.php`'s height branch (`report.php:112-124`, the `else` / `=1 or not set` case) correctly renders the raw stored number as inches and converts it for the secondary display: `170.3 * 2.54 = 432.562`, `round(...,1) = 432.6`, `number_format(...,2) = "432.60"` → **"170.3 in (432.60 cm)" is the report doing exactly what it's designed to do with the value it was given.** 170.3 inches (~4.3 m) is not a plausible human height; 170.3 **cm** is a plausible adult height. This points to a **data-import problem**, not a UI bug: whatever imported this 2018 Synthea row (which typically encodes height in cm) wrote the cm number directly into `height` without converting it to the inches OpenEMR's own storage convention requires. | `report.php:112-124`; `interface/forms/vitals/vitals.js:129`; `library/globals.inc.php:727-737` | Not a report/UI fix — a data-cleanup or import-pipeline fix (convert cm→in on ingest, or store/tag the source unit) is the right layer; out of scope for this audit's read-only mandate. |
| 4 | Security | **High (provisional)** | `vitals_fragment.php` performs no server-side ACL check of its own (no `AclMain::aclCheckCore()` call anywhere in the file or in `report.php`). The only access control is the client-side gate at `demographics.php:629` deciding whether to *emit* the fetch — a user with a valid session and CSRF token but without `patients/med` can still POST directly to the fragment URL and receive vitals PHI for the pid in their session. Compare to the Messages/`pnotes_fragment.php` sibling, which re-checks ACL server-side at `pnotes_fragment.php:45` for exactly this reason. | `vitals_fragment.php` (whole file — absence of a check); contrast `pnotes_fragment.php:45` | Add `AclMain::aclCheckCore('patients','med')` at the top of `vitals_fragment.php`, mirroring the Messages fragment. |
| 5 | Smell | Low | Field display order in the card is simply `form_vitals`'s physical column order (`SELECT *` iterated as-is), not a designed/curated order — adding or reordering DB columns silently reorders the card. | `report.php:37,48`; `sql/database.sql:2418-2451` | Not urgent for a read-only port; a rewrite should pick an explicit field order instead of inheriting the schema's. |
| 6 | Open question / possible smell | Low | `last_updated` (a `DATETIME NOT NULL` column, always populated) is not in `report.php`'s explicit skip list (`report.php:49-52`), so `formFetch()`'s `SELECT *` would carry it through to the generic fallback formatter and print an unlabeled "Last Updated: `<raw datetime>`" row unless something else (a `0.0`/empty-date coincidence) suppresses it — not confirmed against live HTML output; see Open questions. | `report.php:49-55` | Confirm with a live/Selenium render before treating as a real finding. |

## Port notes

- **Must survive:** "most recent, non-deleted vitals set" semantics (once the
  join bug is understood/fixed at the source — see Findings #1); the
  US/metric dual-unit display driven by `units_of_measurement`; the
  suppress-when-`0.0`-or-empty-date behavior per field; the pediatric-only
  percentile fields and the pediatric BMI-status override; the exact empty
  string `"No vitals have been documented."`.
- **Must not survive:** the DB-column-order-as-display-order coupling; the
  missing server-side ACL check (Findings #4) — a port reading only the API
  inherits OAuth2 scope enforcement instead, so this specific gap is largely
  moot for the port itself, but is worth flagging in the catalog since the
  legacy PHP card remains live during any transition period.
- **Open questions:**
  - Does the live-rendered fragment actually print a stray `last_updated`
    row (Findings #6)? Needs a Selenium/live check, not just source reading.
  - Is the `vitals_fragment.php:27` / Findings #1 join bug present in other
    dashboards' similarly-shaped "most recent form X" queries elsewhere in
    OpenEMR (e.g. Labs' existence check at `demographics.php:1481-1486` uses
    a *different* join shape — `procedure_report`/`procedure_order` — not
    checked here)? Flagged for Phase 3/6, not re-verified in this unit.
  - `report.php`'s two `trend_form.php` links use different query strings
    (`vitals_fragment.php:46` vs. `demographics.php:1520`) — not traced.

## Parity spec for the port

All "fields" below are for the **default site configuration** observed on
this DB (`units_of_measurement` unset → defaults to `'1'`, both units shown,
US primary). A port that only reads the API inherits whatever
`units_of_measurement` is configured at request time, same as the legacy
card — see the "Units returned" column.

**Which set the port must pick.** The correct rule is *"the most recent
`form_vitals` row for this patient whose owning `forms` row (same `pid`,
`formdir='vitals'`) is not soft-deleted"* — i.e., the rule the legacy SQL
*should* implement, not the rule it actually implements today (Findings #1).
Neither the standard REST vitals endpoint nor the FHIR `Observation` path
exposes a "deleted" flag at all (see below), so **a port calling the API has
no way to replicate "hide the deleted set" either way** — this is a second,
independent gap from the legacy bug, not a fix for it.

| Card field | DB column | FHIR `Observation` (`category=vital-signs`) mapping | LOINC code | Units the API returns | Match? |
|---|---|---|---|---|---|
| "Most recent vitals from: `<date>`" (set date) | `form_vitals.date` | `Observation.effectiveDateTime` (or `effectivePeriod.start` if `date_end` present — vitals rows have no `date_end`, so always `effectiveDateTime`) | n/a (applies to every Observation in the set) | n/a | Yes, 1:1 — `FhirObservationVitalsService::parseOpenEMRRecord()`, `src/Services/FHIR/Observation/FhirObservationVitalsService.php:638-648` |
| ("Last Updated", not actually labeled in the UI — see Findings #6) | `form_vitals.last_updated` | `Observation.meta.lastUpdated` | n/a | n/a | Available via API even though not shown as a labeled field on the card today — `FhirObservationVitalsService.php:712-716` |
| Blood Pressure (`bps`/`bpd`) | `lists`→no, `form_vitals.bps`/`bpd` | One Observation, code `85354-9` (panel), with two `component`s: systolic `8480-6`, diastolic `8462-4` | `85354-9` (+ components `8480-6`/`8462-4`) | `mm[Hg]` (UCUM), raw stored value, no conversion (matches the card — BP is never converted) | Yes |
| Weight | `form_vitals.weight` | Separate Observation, code `29463-7` | `29463-7` | `[lb_av]`("lb") by default (site `units_of_measurement=1`); converted to `kg` server-side only if the global is `2` or `4` (`VitalsService::createResultRecordFromDatabaseResult()`, `src/Services/VitalsService.php:254-270`) | Partial — API gives one unit per call (driven by the *current* global), the card shows **both** side by side; a port must independently compute/display the secondary unit itself if it wants the dual display |
| Height | `form_vitals.height` | Separate Observation, code `8302-2` | `8302-2` | `[in_i]`("in") by default, same global-driven conversion as weight | Partial, same caveat as Weight — **and inherits the exact same "raw stored number treated as inches" behavior as the legacy card** (Findings #3): the API does not know or correct for the cm-into-inches data-import issue either |
| Temperature | `form_vitals.temperature` | Separate Observation, code `8310-5` | `8310-5` | `[degF]`("degF") by default, `Cel` if global is `2`/`4` | Partial, same unit-not-dual caveat |
| Temp Method | `form_vitals.temp_method` | Separate Observation, code `8327-9` ("Temperature Location") | `8327-9` | n/a (`Observation.valueString`/coded, not traced in depth — out of this unit's file scope) | Present via API, not independently verified here |
| Pulse | `form_vitals.pulse` | Separate Observation, code `8867-4` | `8867-4` | `/min` | Yes |
| Respiration | `form_vitals.respiration` | Separate Observation, code `9279-1` | `9279-1` | `/min` | Yes |
| BMI / BMI Status | `form_vitals.BMI`/`BMI_status` | Separate Observation, code `39156-5` | `39156-5` | `kg/m2` | `BMI` yes; `BMI_status` (the pediatric "See Growth-Chart" override) is a display-only PHP-side computation keyed on patient age, not present as a distinct FHIR field — **not available via API**, a port must recompute pediatric status client-side from the patient's age the same way the legacy card does |
| Waist Circ / Head Circ | `form_vitals.waist_circ`/`head_circ` | Head circumference: separate Observation, code `9843-4`. **Waist circumference has no entry in `FhirObservationVitalsService::COLUMN_MAPPINGS`** (grep of the file's code table turns up no waist-circ LOINC code) | `9843-4` (head only) | `in`/converted per global (head only) | Head: yes. **Waist Circ: not available via API** — confirmed absent from the mapping table read in this audit (`src/Services/FHIR/Observation/FhirObservationVitalsService.php:106-288`) |
| Oxygen Saturation / Oxygen Flow Rate / Inhaled O2 Concentration | `form_vitals.oxygen_saturation`/`oxygen_flow_rate`/`inhaled_oxygen_concentration` | One combined pulse-oximetry Observation (code `59408-5`, or legacy `2708-6`) with `oxygen_flow_rate` (`3151-8`) and `inhaled_oxygen_concentration` (`3150-0`) as components | `59408-5`/`2708-6` (+components) | `%`, `L/min`, `%` respectively | Yes, structurally different (one Observation with components vs. the card's three separate rows) but all three values present |
| Pediatric percentile fields (`ped_weight_height`, `ped_bmi`, `ped_head_circ`) | same-named columns | Separate Observations, codes `77606-2`, `59576-9`, `8289-1` | as listed | `%` | Yes, present via API; the card's pediatric-only *display gate* (age ≤ 20) is a PHP-side decision the port must reimplement itself — the API returns these fields regardless of patient age |
| `note` | `form_vitals.note` | Rolled into the **panel** Observation (`85353-1`) as `Observation.note`, not a per-vital-sign field | n/a | n/a | Yes, but only on the panel resource, not per-component |

**How a client picks "the latest set" via the API.** Each `form_vitals` row
becomes **many** FHIR `Observation` resources (one "vital-signs panel"
Observation, code `85353-1`, plus one per populated vital sign) that all
share the same `effectiveDateTime` and the same `Observation.encounter`
reference (`parseVitalsIntoObservationRecords()`,
`FhirObservationVitalsService.php:524-620`; encounter set at
`FhirObservationVitalsService.php:709-711`). A port must fetch
`GET /fhir/Observation?patient=<id>&category=vital-signs`, **group the
results by `effectiveDateTime` (and/or `encounter` reference) client-side**,
and treat the group with the max `effectiveDateTime` as "the most recent
set" — there is no single API call that returns one row per set the way
`form_vitals` does.

**`_sort` support:** confirmed generically available. `_sort` is handled by
the shared `ResourceServiceSearchTrait::createOpenEMRSearchParameters()`
(`src/Services/FHIR/Traits/ResourceServiceSearchTrait.php:53-87`, used by
every `FhirServiceBase` subclass including `FhirObservationVitalsService`)
for any FHIR search parameter the service registers — `date` is registered
(`FhirObservationVitalsService.php:382`), so `_sort=-date` (descending) or
`_sort=date` is legal and should let a client request
`GET /fhir/Observation?patient=<id>&category=vital-signs&_sort=-date` to get
results ordered newest-first without a client-side sort, though the
port still needs to group by date/encounter itself since each set spans
multiple resources. Not executed against the live API in this audit (rule
3's read-only-SQL allowance doesn't cover HTTP calls) — flagged as
"confirmed by source reading, not by a live request."

**Fields "not available via API" (per rule A2), summary:**
- Card's dual-unit display (e.g. "170.3 in (432.60 cm)") — API returns one
  unit per the site's current `units_of_measurement` global, not both; a
  port must compute the secondary unit itself if it wants parity.
- `Waist Circ` — no LOINC mapping exists in `FhirObservationVitalsService`
  at all.
- `BMI Status`'s pediatric "See Growth-Chart" override — PHP-side, ageon
  the card, not a distinct FHIR field.
- The pediatric-only *display gating* (age ≤ 20) for the three `Ped *`
  fields — API always returns them if populated; the age gate is UI logic.
- Any notion of "deleted" for a `form_vitals` set — neither the FHIR
  `Observation` mapping nor (per `api/CLINICAL-CARDS.md`'s pattern for other
  cards) a standard REST equivalent exposes `forms.deleted`; a port cannot
  replicate even the *intended* "hide the deleted set" rule via the API,
  only the *current buggy* legacy behavior happens to leak the deleted set
  through in this specific seeded case.
