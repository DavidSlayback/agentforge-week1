# Patient Dashboard Map

> **Superseded in part by Phase 2** (2026-09-25). Seven claims here were corrected; see [`README.md`](README.md) "Corrections to Phase 1". Per-card detail now lives in the Phase 2 analyses.

Audited by: tier 2 (sonnet), 2026-09-25, git SHA `3ccfe1d`

`interface/patient_file/summary/demographics.php` — 2,080 lines.

This is a structure/data-flow map (Phase 1), not a critique. No fix
recommendations below; section 5 traces one bug David hit, per the task's
explicit request, and states only where the break is, not how to fix it.

## 1. Scope note

This maps `demographics.php` as the entry point opened at
`demographics.php?set_pid=N`, plus every file it `require`s, `dispatch()`es,
or fetches by AJAX to render the 22 cards. It does not map the tabbed shell
frameset itself (`left_nav`, `top`) beyond identifying where the dashboard's
JS assumes that shell exists (section 7).

## 2. Boot sequence

1. **`require_once("../../globals.php")`** — `demographics.php:30`. This is
   the only auth/session gate before any dashboard-specific code runs.
   `interface/globals.php:725-728` does `require_once("$srcdir/auth.inc.php")`
   unless `$ignoreAuth` is set (it isn't, for this page) — that legacy
   include is the actual login/session check for every `interface/*` page,
   not something local to the dashboard. `interface/globals.php:770-777`
   also seeds `$_SESSION['pid']` from `$_GET['pid']`/`$_POST['pid']` if not
   already set, and resolves `$pid = PatientSessionUtil::getPid()`.
2. **Other requires** — `demographics.php:37-43`: `lists.inc.php`,
   `patient.inc.php`, `options.inc.php`, `../history/history.inc.php`,
   `clinical_rules.php`, `group.inc.php`, `library/appointments.inc.php`.
   `lists.inc.php` (see section 3, card order) builds the global
   `$ISSUE_TYPES` array from the `issue_types` DB table
   (`library/lists.inc.php:82-98`) — used later by `stats.php`, not by
   `demographics.php` directly.
3. **`set_pid` → current patient** — `demographics.php:83-94`. If
   `$_GET['set_pid']` is present: `require_once(pid.inc.php)` then
   `setpid($_GET['set_pid'])` (writes `$_SESSION['pid']`), then
   `$pid = (new PatientService())->findByPid($pid)`-backed lookup and
   `touchRecentPatientList()`. `set_encounterid` is stored to
   `$_SESSION['encounter']` in the same block if present and `>0`.
   Earlier, `demographics.php:73-75`: if `$pid` isn't already set in scope,
   it falls back to `$session->get('pid') ?? $_GET['pid'] ?? null` — i.e.
   the dashboard can run off a *pre-existing* session pid even without
   `set_pid` on the current request (this is what lets in-shell navigation
   avoid a full re-auth per click).
4. **ACL gate for the whole page** — `demographics.php:1056-1061`:
   `$thisauth = AclMain::aclCheckCore('patients', 'demo');` combined with a
   dispatched `ViewEvent` (`OpenEMR\Events\PatientDemographics\ViewEvent`,
   `demographics.php:1054-1055`). If either fails, the page renders
   `core/unauthorized-partial.html.twig` and `exit()`s — nothing below that
   line (including the header) renders. `demographics.php:1068-1072` then
   layers a second check: if the patient has a `squad` set and the user
   lacks ACL for that squad (`AclMain::aclCheckCore('squads', $result['squad'])`),
   `$thisauth` is forced to `0` right before the header would render — but
   note this check happens *after* the `unauthorized-partial` branch above,
   so a squad failure alone does not early-exit; it only suppresses the
   header/card region rendered under `if ($thisauth):` at line 1074.
5. **Header rendering** — `demographics.php:1076`:
   `require_once($webserver_root . "/interface/patient_file/summary/dashboard_header.php")`,
   gated by `$thisauth` (line 1068-1077). See section 3 for its contents.
6. **Per-card region** starts at `demographics.php:1089` (`<div class="main mb-1">`)
   and runs to end of file (line 2080).

## 3. Header, card order, and default collapse state

**Header** (`interface/patient_file/summary/dashboard_header.php`, 36 lines):
reads `$pid` from the session if not already set (`dashboard_header.php:28`),
builds `$viewArgs = ['pageHeading' => $oemr_ui->pageHeading(), 'pid' => $pid,
'csrf' => ...]` (`dashboard_header.php:29-33`) and renders
`patient/dashboard_header.html.twig`, which is a single line:
`{{ pageHeading }}` (`templates/patient/dashboard_header.html.twig:1`).
`$oemr_ui` is built in `demographics.php:365-377` with
`heading_title => xl('Medical Record Dashboard')` and
`include_patient_name => true`. `OemrUI::__construct`
(`src/OeUI/OemrUI.php:87`) concatenates:
`$heading_title . " - " . getPatientFullNameAsString($session->get('pid'))`.
`OemrUI::pageHeading()` (`src/OeUI/OemrUI.php:150-170`) dispatches a
`PageHeadingRenderEvent` and renders `oemr_ui/page_heading/partials/page_heading.html.twig`
with `heading`, `primaryMenu`, `buttonList`, `titleNavContent` — no DOB, sex,
MRN, or active-status fields are part of this payload. **Confirms RECON:**
the only identity shown on the direct URL is the composed title string
"Medical Record Dashboard - `<name>`"; DOB/sex/status only appear inside the
(collapsed-by-default, see below) Demographics card further down the page.

**Card order — two different mechanisms:**
- The 6 primary cards (Allergies, Medical Problems, Medications,
  Prescriptions, Care Team, then Treatment/Care-Experience preferences) and
  the rest of the named 22 cards are **hardcoded sequential PHP** in
  `demographics.php` — the order they appear on the page is simply the
  order the `echo $t->render(...)` calls occur in the file (e.g. Allergies
  at line 1116, Medical Problems at 1141, Medications at 1163, Prescriptions
  at 1185, Care Team at 1252, Treatment Prefs at 1280, Care Experience at
  1306, Demographics/Billing/Insurance via a `SectionEvent('primary')` cards
  loop at 1339-1351 in that push order, Patient Reminders 1403, Disclosures
  1424, Amendments 1447, Labs 1477, Vitals 1507, Portal/API-access via
  `SectionEvent('secondary')` at 1595, Clinical Reminders 1729, Appointments
  block (incl. Recall) 1754-2022).
- The "generic issue type" cards rendered by the separately-included
  `interface/patient_file/summary/stats.php` (loaded async — see below) —
  which is where Health Concerns and Immunizations render, among any other
  issue types not hardcoded in `demographics.php` — are ordered by the
  **`issue_types.ordering` DB column**
  (`library/lists.inc.php:83-98`: `SELECT * FROM issue_types WHERE active=1
  AND category=? ORDER BY ordering`). `stats.php:130-140` explicitly removes
  `allergy`/`medication`/`medical_problem` from that list
  (`$refactoredIssues`) since those three are the hardcoded cards above; the
  remaining `$ISSUE_TYPES` entries (Health Concerns, Immunizations, etc. —
  whatever rows exist in `issue_types` with `category='default'`) are looped
  in `stats.php` in `ordering` order.
- So: **order is config-driven (DB) for the generic issue-type cards,
  hardcoded PHP source order for everything else.**

**Default collapsed/expanded state:** per-card, via
`getUserSetting($id) == 0 ? true : false` (repeated at every card block,
e.g. `demographics.php:1125`, `1149`, `1171`, `1203`, `1217` for the primary
cards) — a **per-user setting** (`library/ajax/user_settings.php`, written
by the collapse-toggle click handler at `demographics.php:900-911`) keyed by
each card's DOM id (e.g. `allergy_ps_expand`). If no stored setting exists
`getUserSetting()` presumably returns a value that isn't literally `0`
(cards open by default), so first-time state is effectively "expanded"
unless the user has previously collapsed it. Care Team's default instead
comes from `CareTeamViewCard::setupOpts()` (`src/Patient/Cards/CareTeamViewCard.php:85`),
same underlying `getUserSetting()` mechanism (`CARD_ID_EXPAND = 'careteam_ps_expand'`).
Some cards are hidden entirely (not just collapsed) via the `hide_dashboard_cards`
global (`getHiddenDashboardCards()`, `demographics.php:138-147`, reads
`globals` table rows with `gl_name='hide_dashboard_cards'`) — checked per
card, e.g. `!in_array('card_allergies', $hiddenCards)` at line 1095.

## 4. Per-card table

| Card | Rendering code | Data source | Filter/sort | ACL check | Async? | Edit/add link |
|---|---|---|---|---|---|---|
| **Header** | `demographics.php:1076` includes `dashboard_header.php`; renders `templates/patient/dashboard_header.html.twig:1` via `OemrUI::pageHeading()` (`src/OeUI/OemrUI.php:150-170`) | `getPatientFullNameAsString($session->get('pid'))` (`src/OeUI/OemrUI.php:87`) — name only | n/a | `AclMain::aclCheckCore('patients','demo')`, `demographics.php:1056` (page-level, not header-specific) | No | n/a |
| **Allergies** | `demographics.php:1116-1136` → `templates/patient/card/allergies.html.twig` | `AllergyIntoleranceService::getAll(['lists.pid'=>$pid])`, `demographics.php:1117-1118`; SQL in `src/Services/AllergyIntoleranceService.php:60-107` (`lists` table, `type='allergy'` forced at line 101) | **PHP-level**, not SQL: `filterActiveIssues()` (`demographics.php:1110-1113`) — `outcome != 1 AND (empty(enddate) OR strtotime(enddate) > now)`, applied *after* the full result set is fetched. No SQL `WHERE enddate` clause in the service. | `AclMain::aclCheckIssue('allergy')`, `demographics.php:1095`, plus `!in_array('card_allergies',$hiddenCards)` | No | `load_location('.../stats_full.php?active=all&category=allergy')`, `demographics.php:1131` |
| **Medical Problems** | `demographics.php:1140-1160` → `templates/patient/card/medical_problems.html.twig` | `PatientIssuesService::search(['lists.pid'=>$pid,'lists.type'=>'medical_problem'])`, `demographics.php:1142`; SQL in `src/Services/PatientIssuesService.php:171-211` (`lists` LEFT JOIN `lists_medication`, `ORDER BY lists.begdate`) | Same `filterActiveIssues()` PHP filter as Allergies, applied at `demographics.php:1151`. **Confirms RECON**: no `enddate` filter in the SQL; refines it slightly — the PHP condition also accepts a *future* enddate, not strictly "no enddate". | `AclMain::aclCheckIssue('medical_problem')`, `demographics.php:1096` | No | `load_location('.../stats_full.php?active=all&category=medical_problem')`, `demographics.php:1155` |
| **Medications** | `demographics.php:1162-1182` → `templates/patient/card/medication.html.twig` | Same `PatientIssuesService::search()` call with `lists.type='medication'`, `demographics.php:1164` | Same `filterActiveIssues()`, `demographics.php:1173` | `AclMain::aclCheckIssue('medication')`, `demographics.php:1097` | No | `load_location('.../stats_full.php?active=all&category=medication')`, `demographics.php:1177` |
| **Prescriptions** | `demographics.php:1184-1247` → `templates/patient/card/rx.html.twig`; card body content comes from `Controller::dispatch(['controller'=>'prescription','action'=>'fragment','patient_id'=>$pid])` (`demographics.php:1240`) → `C_Prescription::fragment_action()` (`controllers/C_Prescription.class.php:286-300`, marked `@deprecated ... isn't used` but is in fact the live call path for this card) → legacy Smarty `templates/prescription/general_fragment.html` | `Prescription::prescriptions_factory($pid)` (`library/classes/Prescription.class.php:1206-1250`): `SELECT id FROM prescriptions WHERE patient_id = ? ORDER BY active DESC, date_modified DESC, date_added DESC` (line 1242-1243, default order) | **Card view** (`general_fragment.html:28`): `{if $prescription->get_active() > 0}` — only rows where the `active` DB column is truthy render as `<tr>`s; end_date is irrelevant here. **Corrects RECON**: the visible filter is the `active` flag, not "all rows including past-end_date ones" — a row with a past `end_date` still shows if `active=1` (they are independent columns in this schema). Columns: Drug=`drug`, Details=`get_size()+get_unit_display()+get_dosage_display()`, Qty=`get_quantity()`, Refills=`get_refills()`, Filled=`get_date_added()` (`general_fragment.html:30-35`). | `AclMain::aclCheckCore('patients','rx')` (`demographics.php:1098`); `dispatch()` additionally re-checks via `Controller::checkControllerAcl('prescription')` → `patients/rx` (`library/classes/Controller.class.php:131-144`, `CONTROLLER_ACL_MAP`) | No (embedded synchronously in the initial page render, not AJAX) | Pencil/"Edit" opens an iframe modal (`editScripts()`, `demographics.php:472-483`) to `controller.php?prescription&list&id=<pid>` (`demographics.php:1228`) → `list_action()` (`controllers/C_Prescription.class.php:176-260`) → **unfiltered** `templates/prescription/general_list.html.twig` (all prescriptions shown, inactive ones get an `inactive` CSS class, `general_list.html.twig:352`). See section 5 for the "Add" button inside that iframe. |
| **Care Team** | `demographics.php:1252-1276` → `CareTeamViewCard` (`src/Patient/Cards/CareTeamViewCard.php`) → `patient/card/manage_care_team.html.twig` | `CareTeamService::getCareTeamData($pid)` (`src/Patient/Cards/CareTeamViewCard.php:162`) → SQL in `src/Services/CareTeamService.php:550-572`: `care_teams` LEFT JOIN `care_team_member` (`CARE_TEAM_TABLE`/`CARE_TEAM_MEMBER_TABLE` consts, lines 35-36) | `care_team_member` subselect filters `WHERE status != 'inactive' AND status != 'entered-in-error'` (`src/Services/CareTeamService.php:564-566`); `hasActiveCareTeam()` separately checks `care_teams` `WHERE status='active' OR status IS NULL` (line 369) | Card's own ACL from `getAcl()` is `['patients','demo']` (`CareTeamViewCard::setupOpts()`, line 89) — the same ACL as the whole-page gate, not a narrower Care-Team-specific check; enforced at `demographics.php:1270-1271` | No | `btnLink` from demographics.php's own array is the literal string `'test'` (`demographics.php:1268`), but `array_merge($viewArgs, $card->getTemplateVariables())` (line 1273) lets the card's own `templateVariables` (`CareTeamViewCard::setupOpts()`, line 102: `'btnLink' => "javascript:void(0);"`) win — opens an in-page edit form via JS, not a link, and the form POSTs back to the same page (`handleFormSubmission()`, `CareTeamViewCard.php:124-147`, gated on `save_care_team=='true'` + CSRF) |
| **Messages** (DB-08, "Patient Notes") | Card shell: `demographics.php:1384-1401` → `patient/card/loader.html.twig` (empty container, `id="pnotes_ps_expand"`); content fetched async into that div by `placeHtml("pnotes_fragment.php", 'pnotes_ps_expand')` (`demographics.php:611`) → `interface/patient_file/summary/pnotes_fragment.php` (plain PHP, not Twig) | `getPnotesByDate("", 1, "id,date,body,user,title,assigned_to,message_status", $pid, "$N", 0, '', $docid)` (`pnotes_fragment.php:61-70`, `library/pnotes.inc.php`) — reads the **`pnotes`** table. **Confirmed: this is the only notes/messages-like card on the dashboard** — no other card reads `pnotes` or an equivalent table; "Patient Notes" in the brief maps 1:1 to this "Messages" card. | `$N = getInt('num_of_messages_displayed')` limits row count (`pnotes_fragment.php:43`); no other filter — "all active notes up to N most recent" per the inline comment (line 42) | Card shell gated by `AclMain::aclCheckCore('patients','notes')`, `demographics.php:1384`; `pnotes_fragment.php` **independently re-checks** the same ACL at line 45 (`$thisauth = AclMain::aclCheckCore('patients','notes')`), plus a squad check (lines 47-50) | **Yes** — `placeHtml("pnotes_fragment.php", ...)`, `demographics.php:611`, POST fetch, runs inside the jQuery document-ready handler `$(function () {...})` that starts at `demographics.php:543` (fires as soon as the DOM is parsed, not gated on a user click) | `btnLink => "pnotes_full.php?form_active=1"`, `demographics.php:1392`; inside the fragment itself, if there are zero notes and the user has write/addonly, a second link to `pnotes_full.php` appears (`pnotes_fragment.php:118-120`) |
| Treatment Intervention Preferences | `demographics.php:1280-1301`, `TreatmentPreferenceViewCard` | `src/Patient/Cards/TreatmentPreferenceViewCard.php` | not traced in depth (out of the 7 in-scope areas) | `!in_array('card_treatment_preferences', $hiddenCards)` only — no `AclMain` call gates this card | No | JS modal (`btnClass: 'js-card-toggle-edit'`) |
| Care Experience Preferences | `demographics.php:1303-1330`, `CareExperiencePreferenceViewCard` | `src/Patient/Cards/CareExperiencePreferenceViewCard.php` | not traced in depth | `!in_array('card_care_experience', $hiddenCards)` only — no `AclMain` call | No | JS modal |
| Demographics | `demographics.php:1339-1340`, `DemographicsViewCard`, part of `SectionEvent('primary')` cards loop (1339-1379) | `$result`/`$result2` from `getPatientData()`/`getEmployerData()` (`demographics.php:349-351`) | per-card `$card->getAcl()` checked in the loop at `demographics.php:1357-1360` | same loop ACL check | No | per `$card->canAdd()/canEdit()` |
| Billing | `demographics.php:1342-1344`, `BillingViewCard`, same `SectionEvent('primary')` loop, gated additionally by `!getBoolean('hide_billing_widget')` | `$insco_name`, `$result['billing_note']`, `$result3` (insurance data) | same loop ACL check | same loop ACL check | No | per card |
| Insurance | `demographics.php:1346-1347`, `InsuranceViewCard`, same loop, gated by `!in_array('card_insurance',$hiddenCards)` | `src/Patient/Cards/InsuranceViewCard.php` | same loop | same loop ACL check | No | per card |
| Patient Reminders | `demographics.php:1403-1422` → `patient/card/loader.html.twig` shell | content async via `placeHtml("patient_reminders_fragment.php", ..., false, true)`, `demographics.php:715` | gated by `enable_cdr` + `enable_cdr_prw` globals | `AclMain::aclCheckCore('patients','reminder')`, line 1403 | **Yes**, `demographics.php:715` (this is one of the two calls that pass `sessionRestore=true` — see section 7) | `../reminder/patient_reminders.php?mode=simple&patient_id=<pid>`, line 1412 |
| Disclosures | `demographics.php:1424-1445` → `patient/card/loader.html.twig` shell | async via `placeHtml("disc_fragment.php", "disclosures_ps_expand")`, `demographics.php:626` | n/a | `AclMain::aclCheckCore('patients','disclosure')`, line 1424 | **Yes**, line 626 | `disclosure_full.php`, line 1435 |
| Amendments | `demographics.php:1447-1475` → `patient/card/amendments.html.twig` (rendered synchronously, not via loader) | `SELECT * FROM amendments WHERE pid=? ORDER BY amendment_date DESC`, `demographics.php:1450-1451` | ORDER BY only, no row filter | `getBoolean('amendments') && AclMain::aclCheckCore('patients','amendment')`, line 1447 | No | `list_amendments.php?id=<pid>`, line 1463 |
| Labs | `demographics.php:1477-1505` → `patient/card/loader.html.twig` shell | existence check: `procedure_report` JOIN `procedure_order`, `demographics.php:1481-1486`; actual content async via `placeHtml("labdata_fragment.php", "labdata_ps_expand")`, line 627 | n/a | `AclMain::aclCheckCore('patients','lab')`, line 1477 | **Yes**, line 627 | `../summary/labdata.php` ("Trend"), line 1495 |
| Vitals | `demographics.php:1507-1530` → `patient/card/loader.html.twig` shell | existence check `SELECT * FROM form_vitals WHERE pid=?`, line 1511; content async via `placeHtml("vitals_fragment.php", "vitals_ps_expand")`, line 631 (only emitted if `$vitals_is_registered`, checked line 629 and 344-345) | n/a | `AclMain::aclCheckCore('patients','med')`, line 1507 (and 629 for the JS emit) | **Yes**, line 631 | `../encounter/trend_form.php?formname=vitals&context=dashboard` ("Trend"), line 1520 |
| Patient Portal / API Access | `demographics.php:1582-1629`, `PortalCard` (`src/Patient/Cards/PortalCard.php`), part of `SectionEvent('secondary')` loop | `new PortalCard($GLOBALS)` only instantiated if any of `portal_onsite_two_enable`/`rest_fhir_api`/`rest_api`/`rest_portal_api` globals are truthy (lines 1582-1593) | loop-level `$card->getAcl()` check, line 1601-1605 | same | No | `javascript:$('#patient_portal').collapse('toggle')`, line 1625 |
| Clinical Reminders | `demographics.php:1725-1741` (title/link only shown here — see async note) | `resolve_rules_sql()` gate at line 1726; content async via `placeHtml("clinical_reminders_fragment.php", "clinical_reminders_ps_expand", true, true)`, line 635 | requires non-empty `resolve_rules_sql()` result + `enable_cdr` + `enable_cdr_crw` | `AclMain::aclCheckCore('patients','alert')`, line 1729 | **Yes**, line 635 (the other call with `sessionRestore=true` — see section 7) | `../reminder/clinical_reminders.php?patient_id=<pid>`, line 1738 |
| Recall | `demographics.php:1897-1922` → `patient/card/recall.html.twig`, nested inside the Appointments block | `SELECT * FROM medex_recalls WHERE r_pid=?`, line 1899 | only rendered `if ($resNotNull)` (set by `fetchNextXAppts()` via the `global $resNotNull` convention noted at file top, line 34-36) | shares the Appointments ACL (`patients`,`appt`), line 1754 — no separate Recall-specific ACL call | No | none (display-only; `recallsAvailable` flag drives an empty-state message) |
| Appointments | `demographics.php:1754-2022` → `patient/card/appointments.html.twig` | `fetchNextXAppts($current_date2, $pid, ...)`, line 1774 (`library/appointments.inc.php`) | complex pagination/windowing logic (lines 1776-1896) around `number_of_appts_to_show`, `appt_display_sets_option` globals — not a simple SQL WHERE, a PHP windowing algorithm over the fetched event list | `AclMain::aclCheckCore('patients','appt')`, line 1754 (and again 2017 for write/addonly) | No | `return newEvt()` ("Add"), line 2007 |
| Health Concerns, Immunizations | Not present as named blocks in `demographics.php`; rendered generically by `interface/patient_file/summary/stats.php` (`getListData($pid, $type)`, `stats.php:41-101`) inside `<div id="stats_div">` (`demographics.php:2024`), which is loaded async via `placeHtml("stats.php", "stats_div", true)`, `demographics.php:606` | `stats.php:52-54`: `SELECT * FROM lists WHERE pid=? AND type=? AND <dateEmptySql('enddate')> ORDER BY begdate` — one query per remaining `$ISSUE_TYPES` entry | **SQL-level** `dateEmptySql('enddate')` filter (`stats.php:44-45,53`) — unlike the Allergies/Medical-Problems/Medications cards above, which filter in PHP after the fact, these generic issue-type cards filter ended rows directly in the query. | `AclMain::aclCheckIssue($key)` per issue type, `stats.php:151` region (loop header at ~150) | **Yes**, `demographics.php:606` | not traced in depth |

## 5. Prescriptions "Add" — tracing David's `controller.php` error (B-14)

**The pencil/"Edit" link itself works.** `demographics.php:1228` builds
`controller.php?prescription&list&id=<pid>` — a positional (no `=` after
`prescription`/`list`) query string. `controller.php:18`
(`isset($_GET['controller']) ? dispatch(...) : act(...)`) routes this
through the legacy `act()` fallback since there is no literal `controller`
key. `Controller::act()` (`library/classes/Controller.class.php:164-186`)
takes `array_keys($_GET)[0]` = `"prescription"` as the controller name —
that *is* in the `VALID_CONTROLLERS` whitelist
(`Controller.class.php:35-45`), so `dispatch()` succeeds and `list_action()`
renders `templates/prescription/general_list.html.twig` inside the iframe
opened by `editScripts()`.

**The "Add" button inside that iframe is what breaks.**
`templates/prescription/general_list.html.twig:449`:
```
<a href="{{ CONTROLLER }}?prescription&edit&id=0&pid={{ pid|attr_url }}" ...>{{ "Add"|xlt }}</a>
```
`CONTROLLER` is assigned once in the base `Controller::__construct()`
(`library/classes/Controller.class.php:78`): `$this->assign("CONTROLLER", "controller.php?")`
— note it **already ends in `?`**. The template then appends a second
literal `?` before `prescription`. String-concatenated, the `href` becomes:

```
controller.php??prescription&edit&id=0&pid=<pid>
```

A URL has exactly one query-string delimiter — the *first* `?`. Everything
from the first `?` onward, including the second literal `?`, is the query
string, so the browser/PHP parses the first `&`-delimited segment as the
literal key `"?prescription"` (with the `?` character as part of the key
name), not `"prescription"`. When this request hits `controller.php`,
`$_GET` has no key literally equal to `"controller"`, so `controller.php:18`
again falls through to `act()`. `act()` takes `array_keys($_GET)[0]` =
`"?prescription"` (leading `?` included) as the controller name — that
string is **not** in `VALID_CONTROLLERS`, so `Controller::dispatch()`
(`Controller.class.php:197-203`) throws
`BadRequestHttpException("Missing or invalid 'controller' parameter")` at
line 202 — exactly the message and location David reported.

**Path, not fix:** the break is the doubled `?` produced by concatenating
`CONTROLLER` (`"controller.php?"`, `Controller.class.php:78`) with the
template's own leading `?` (`general_list.html.twig:449`) for this one
link. Every other link in the same template that uses `{{ CONTROLLER }}`
without a second `?` (e.g. line 293, `action="{{TOP_ACTION}}send"` where
`TOP_ACTION` is `"controller.php?prescription&"`,
`C_Prescription::__construct()`, `controllers/C_Prescription.class.php:59`)
does not have this problem, since `TOP_ACTION` doesn't end in `?` before
being concatenated with a bare `send`.

## 6. Messages / patient-notes table confirmation

Confirmed at `pnotes_fragment.php:61-70`: `getPnotesByDate(...)` (defined in
`library/pnotes.inc.php`, not re-read line-by-line here) is the sole data
source for the Messages card, and it reads the **`pnotes`** table. No other
card block in `demographics.php` or its included fragments queries `pnotes`
or a similarly-named notes table — Messages is the only notes-like card,
confirming RECON's DB-08 mapping.

## 7. `top.restoreSession` / `parent.left_nav.setPatient` — why they throw outside the tabbed shell

Both symptoms trace to code that assumes the page is loaded inside a
frameset (`interface/main/tabs/...`) where `top` is the shell's top frame
and `parent.left_nav` is a sibling frame with `setPatient()` defined on it.
Opened as a bare top-level document (as the probes and a direct
`demographics.php?set_pid=N` load did), `top === window` (no
`restoreSession` function exists on the bare `window`) and
`parent.left_nav` is `undefined`.

- **`top.restoreSession is not a function` (×2 per RECON):** both
  occurrences come from `fetchHtml(url, embedded, sessionRestore)`
  (`demographics.php:494-513`), which calls `top.restoreSession()` at line
  497 only `if (sessionRestore === true)`. Exactly two `placeHtml(...)`
  call sites pass `sessionRestore=true`, both inside the jQuery
  document-ready handler `$(function () {...})` starting at
  `demographics.php:543` — i.e. they fire as soon as the DOM is parsed, not
  behind a user click: `placeHtml("clinical_reminders_fragment.php", "clinical_reminders_ps_expand", true, true)`
  at `demographics.php:635`, and
  `placeHtml("patient_reminders_fragment.php", "patient_reminders_ps_expand", false, true)`
  at `demographics.php:715`. (Both are further gated by `enable_cdr` +
  `enable_cdr_crw`/`enable_cdr_prw` globals respectively — so this error
  count assumes both are on, as RECON's runs presumably had them.)
- **`Cannot read properties of undefined (reading 'setPatient')` (×1):**
  `parent.left_nav.setPatient(...)` at `demographics.php:924`, inside
  `setMyPatient()` (`demographics.php:916-967`). `setMyPatient()` is called
  unconditionally on load: `$(window).on('load', function () { setMyPatient(); });`
  (`demographics.php:969-971`). The `setPatient(...)` call itself is
  additionally guarded by `if (isset($_GET['set_pid']))` in the PHP that
  generates this JS (`demographics.php:918`), so it only appears in the
  emitted script when the URL includes `set_pid` — consistent with the
  probes hitting `demographics.php?set_pid=N` directly.

Other `top.restoreSession()` calls in the file (e.g. lines 390, 413, 497,
539, 550, 571, 668, 833, 904, 963, plus inside `image_widget()` at 323/331)
are inside `onclick` handlers or other user-triggered/async code paths, not
unconditional page-load code, so they don't fire (and can't throw) until a
user interacts with that specific control.
