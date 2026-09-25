# demographics.php, part 2: page gate and card blocks

This is the second half of the patient dashboard page: everything from the
page ACL gate to the end of the file. The browser reaches it at
`interface/patient_file/summary/demographics.php?set_pid=N` (usually as an
iframe of the tabbed shell). By line 1056 the first half has already run
(session/`setpid`, patient/employer/insurance lookups, the whole `<head>`
with its inline JS). This half checks the page ACL, then prints every card
in hard-coded source order. Some cards are rendered server-side. Others are
spinner shells that the first half's `placeHtml()` JS fills over AJAX once
the DOM is ready. Control never leaves the page. Edit links go to other
screens (`stats_full.php`, `controller.php?prescription&list`, `pnotes_full.php`,
`trend_form.php`) or to in-page JS.

**Source:** `interface/patient_file/summary/demographics.php` · 2,080 lines (this analysis: 1056–2080) · no version header; git SHA `3ccfe1d` base, worktree `agentforge/w2-dashboard` @ `5ddaed7`
**Audited by:** tier 3 · confidence high (in-scope cards), medium (out-of-scope card paragraphs, which are map-depth only)
**Sibling:** lines 1–1055 (boot, `<head>`, JS helpers `placeHtml`/`fetchHtml`/`updateUserVisibilitySetting`/`setMyPatient`) are audited by another tier-3 agent. This file refers to that part as "Part 1" and does not repeat it.

## Purpose & lifecycle

1. **Gate** (`1052-1061`). A `ViewEvent($pid)` is dispatched, then
   `AclMain::aclCheckCore('patients','demo')`. If either fails, the page
   renders `core/unauthorized-partial.html.twig` ("Medical Dashboard Not
   Authorized") and `exit()`s. The only in-tree listener that can veto
   `ViewEvent` is the PatientFilter Zend module
   (`interface/modules/zend_modules/module/PatientFilter/Module.php:79`).
   `ViewEvent::$authorized` defaults to `true`
   (`src/Events/PatientDemographics/ViewEvent.php:35`).
2. **Squad check** (`1068-1072`). If `patient_data.squad` is set and the user
   lacks `squads/<squad>`, `$thisauth` becomes `0`. This hides **only** the
   header include (`1074-1077`) and the "delete patient" partial (`2046-2053`).
   Every card below still renders. See Finding 1.
3. **Header + nav** (`1075-1087`): `RenderEvent::EVENT_SECTION_LIST_RENDER_TOP`,
   `dashboard_header.php` (squad-gated), then `PatientMenuRole::displayHorizNavBarMenu()`
   (not gated) and the ID-card document lookup.
4. **Row 1** (`1091-1249`): Allergies, Medical Problems, Medications (each
   `col-md-(12 / number shown)`), then Prescriptions in a `col` that wraps to
   its own line. An optional eRx "Current Medications" card is dead code
   (Finding 14).
5. **Row 2** (`1250-2056`): Care Team (`col-12`), Treatment Intervention
   Preferences (`col-12`), Care Experience Preferences (`col-12`), then a
   left column `col-md-8` (`1331-1578`) and a right column `col-md-4`
   (`1579-2055`).
6. **Footer script** (`2060-2076`): `checkSkipConditions()`, marks the nav
   item `#dashboard` active, optionally auto-clicks `#eligibility`. Then
   `RenderEvent::EVENT_RENDER_POST_PAGELOAD` (`2079`).

Async bodies are filled by Part 1's document-ready block: `stats.php`
(`606`), `pnotes_fragment.php` (`611`), `disc_fragment.php` (`626`),
`labdata_fragment.php` (`627`), `track_anything_fragment.php` (`628`),
`vitals_fragment.php` (`629-632`, only when vitals is registered and
`patients/med` is granted), `clinical_reminders_fragment.php` (`635`) and
`patient_reminders_fragment.php` (`715`). `placeHtml()` skips a missing div
(`528-535`). It inserts the response text whatever the HTTP status, and it
has no rejection handler, so a network failure leaves the spinner up forever.

## Layout / interface

Final page order (source order = visual order):

```text
[header: "Medical Record Dashboard - <name>"] [patient nav menu]
Row 1: Allergies | Medical Problems | Medications      (col-md-4 each when all 3 shown)
       Prescriptions (own line, full width)
Row 2: Care Team (full width)
       Treatment Intervention Preferences (full width)
       Care Experience Preferences (full width)
       LEFT col-md-8                         RIGHT col-md-4
       [Deceased banner]                     Patient Portal / API Access
       Demographics                          [eRx partial]
       Billing                               [ID Card / Photos]
       Insurance                             [Advance Directives]
       Messages (async)                      Clinical Reminders (async)
       Patient Reminders (async)             Recall (inside appointments block)
       Disclosures (async)                   Appointments
       Amendments                            #stats_div (async: Health Concerns, Immunizations, ...)
       Labs (async)                          [Tracks (async)]
       Vitals (async)                        [Delete patient]
       [LBF chartable forms]
```

Every card extends `templates/patient/card/card_base.html.twig`. The title is
a link with `data-toggle="collapse"` plus an expand/compress icon. The pencil
or plus button is shown only when `auth` is truthy, and the `+` only when
`btnLabel == "Add"`. The body is `<div id="{{id}}" class="card-text collapse[ show]">`.
The Twig environment has `autoescape => false`
(`src/Common/Twig/TwigContainer.php:70`), so escaping depends entirely on
the `|text`/`|attr` filters.

## State

```text
$thisauth        // 1056: patients/demo; 1070: forced 0 on squad failure (header/delete only)
$allergy,$pl,$meds,$rx  // 1095-1098: per-card show flags (ACL && not hidden [&& !disable_prescriptions])
$cards,$colInt,$col     // 1099-1102: bootstrap column width for row 1 (Rx not counted)
$t                // 1093 / 1598: Twig environment
$id,$viewArgs     // reused per card
$result           // patient_data row from Part 1 (349); OVERWRITTEN at 1451 (amendments stmt) and 1841
$result2          // employer row (351); overwritten at 1902 (recall loop)
$card,$_auth,$btnLabel  // per ViewCard
$cwd              // 1233: saved, never restored after chdir("../../../")
$resNotNull       // global written by fetchNextXAppts() (library/appointments.inc.php); default false at 36
$appts,$recurr,$past_appts,$recallArr,$therapyGroupCategories  // appointments block
```

**Globals read (via `OEGlobalsBag`):** `disable_prescriptions`, `erx_enable`,
`hide_billing_widget`, `amendments`, `enable_cdr`, `enable_cdr_prw`,
`enable_cdr_crw`, `portal_onsite_two_enable`, `rest_fhir_api`, `rest_api`,
`rest_portal_api`, `patient_id_category_name`, `patient_photo_category_name`,
`advance_directives_warning`, `disable_calendar`, `number_of_appts_to_show`,
`appt_display_sets_option`, `appt_display_sets_color_1..4`,
`time_display_format`, `appt_recurrences_widget`,
`num_past_appointments_to_show`, `allow_pat_delete`. The `globals` table row
`hide_dashboard_cards` (multi-select, `library/globals.inc.php:203-208`) is
read in Part 1 (`138-147`). **Session:** `authUserID` (`1066`), `authUser`
(`1726`), CSRF token (`2050`).
**Globals written:** none by this half. Collapse clicks write `user_settings`
through Part 1's JS (see "Collapse state").

## Logic

### Page gate (`1052-1077`)

This is the only page-level ACL. It is `patients/demo`, the lowest clinical
section. **It runs after the whole `<head>` has been emitted** (`382-1049`).
That head includes `setMyPatient()`, which on `set_pid` writes the patient's
full name, `pid`, `pubpid`, DOB and age, plus the full encounter list
(dates, categories), into inline JS (`916-967`). Part 1 has also already
run `setpid()` / `touchRecentPatientList()` (`83-94`) and the CDR allergy
popup (`104-131`). A logged-in user without `patients/demo` therefore gets
the page title "Not Authorized", but the page source carries identity
data, and the patient becomes their session patient and joins their
recent-patient list (Finding 2).

### Row 1 flags and column width (`1095-1102`)

`$allergy`, `$pl` and `$meds` are `aclCheckIssue(<type>) && !in_array('card_…', $hiddenCards)`.
`aclCheckIssue()` (`src/Common/Acl/AclMain.php:365-373`) looks up
`issue_types.aco_spec` for the type and returns `true` when it is empty. In
the local DB all three types have `aco_spec = patients|med` (read-only SQL).
`$rx` = `!disable_prescriptions && aclCheckCore('patients','rx') && !hidden`.
The column width is `12 / max(1, allergy+pl+meds)`. Prescriptions is not
counted, and its `col` wraps to the next line.

### `filterActiveIssues()` (`1110-1113`)

```php
array_filter($i, fn($_i) => ($_i['outcome'] != 1) && (empty($_i['enddate']) || (strtotime((string)$_i['enddate']) > strtotime('now'))));
```

The function is declared inside the `<div class="row">` PHP block and is
applied in PHP after the full query returns. Semantics, exactly:

- `outcome` loose `!= 1` (1 = "Resolved" in list `outcome`). `NULL`, `0` and 2–5 all pass.
- `enddate` empty (NULL or `''`) passes. So does an enddate *strictly later
  than now* at seconds resolution in the PHP server timezone. An issue whose
  enddate is today at `00:00:00` is **hidden** from midnight on.
- `activity` is **not** consulted. An issue "disappeared" through
  `disappearList()` (`library/lists.inc.php:119-123`, sets `activity=0`)
  still shows. FHIR `Condition` filters `activity=1` instead
  (`api/CLINICAL-CARDS.md` DB-04).
- The array keeps its original keys. Twig iterates in source order.

Local check (read-only SQL, pid 13): allergy 2/2, medical_problem 13/39,
medication 1/5 pass. This matches the seeded probe exactly.

### Allergies card (`1115-1136`)

- **Service:** `new AllergyIntoleranceService()` → `getAll(['lists.pid'=>$pid])`.
  `getAll()` renames `lists.pid` to `patient_id` (`src/Services/AllergyIntoleranceService.php:155-158`)
  and calls `search()`. `search()` forces `type='allergy'` (`:100-101`); the
  SQL (`:51-98`) joins `list_options` for reaction and verification,
  `patient_data`, `users` and `facility`, and **has no `ORDER BY`**, so rows
  come in whatever order the database returns them. Duplicate UUIDs are
  dropped in PHP (`:112-135`). If `diagnosis`/`reaction_codes` exist they
  are replaced with coding arrays (`:125-130`).
- **Filter:** `filterActiveIssues()`.
- **Template:** `patient/card/allergies.html.twig`. Each row renders
  `{{ l.title }} (<span>{{ severity }}</span>)`. The severity is
  `getListItemTitle('severity_ccda', l.severity_al)`
  (`src/Common/Layouts/LayoutsUtils.php:17-24`), which returns the raw
  option id when no active `severity_ccda` option matches. That is where
  "(1)" comes from (pid 13 has `severity_al='1'`), and a NULL severity
  renders "()". Rows whose `severity_al` is `severe`,
  `life_threatening_severity` or `fatal` get
  `bg-warning font-weight-bold px-1` on the severity span. Tooltip:
  `"<title> Reaction: <reaction_title> - <severity>"`.
  *Note:* the template docblock (`:6-9`) says severe allergies "always
  rendered at the top of the card". **No such sort exists**; they are only
  highlighted (Finding 9).
- **Empty strings:** `listTouched` true → "No Known Allergies"; else
  "Nothing Recorded". `listTouched = !empty(getListTouch($pid,'allergy'))`
  (`library/lists.inc.php:130-139`, table `lists_touch`). That row is written
  on any issue save (`add_edit_issue.php:279`), by eRx import and by
  `library/ajax/lists_touch.php`. So a patient whose only allergies are
  resolved shows "No Known Allergies" if anyone ever saved one, and
  "Nothing Recorded" otherwise (Finding 8).
- **Per-card ACL:** `aclCheckIssue('allergy')` (= `patients/med` here),
  stricter than the page gate. `auth => true`, so the pencil always shows.
- **Collapse:** `initiallyCollapsed = getUserSetting('allergy_ps_expand') == 0`.
  The default row for user 0 is `1` (`sql/database.sql:9910`) → expanded.
- **Edit link:** `return load_location('<webroot>/interface/patient_file/summary/stats_full.php?active=all&category=allergy')`
  (linkMethod `javascript`). The `?active=all` issues screen shows resolved
  rows too.

### Medical Problems card (`1138-1160`)

- **Service:** `PatientIssuesService::search(['lists.pid'=>$pid,'lists.type'=>'medical_problem'])`.
  Plain values become EXACT `StringSearchField`s
  (`src/Services/Search/FhirSearchWhereClauseBuilder.php:33-40`). SQL is
  `lists LEFT JOIN lists_medication` **`ORDER BY lists.begdate`** ascending,
  so NULL begdates come first (`src/Services/PatientIssuesService.php:170-211`).
- **Filter:** `filterActiveIssues()` (`1151`).
- **Template:** `medical_problems.html.twig`. One `list-group-item` per row
  with `l.title` only.
- **Empty strings:** listTouched → "None" (source `"None{{Issues}}"`; `xl()`
  strips `{{…}}`, `library/translation.inc.php:77-85`); else "Nothing
  Recorded". pid 13 has a `lists_touch` row for `medical_problem` (read-only
  SQL), from David's edit.
- **ACL:** `aclCheckIssue('medical_problem')` (`patients/med`). Pencil always shown.
- **Collapse:** `medical_problem_ps_expand`, default `1` → expanded.
- **Edit link:** `stats_full.php?active=all&category=medical_problem`.

### Medications card (`1162-1182`)

- **Service:** the same `PatientIssuesService::search()` with `lists.type='medication'`,
  `ORDER BY lists.begdate` ASC. When a `lists_medication` row exists,
  `createResultRecordFromDatabaseResult()` copies its fields into a nested
  `medication` array. It unsets them from `$row`, not from `$record`, so the
  top-level `drug_dosage_instructions` survives for the template
  (`PatientIssuesService.php:223-243`). There is a typo at `:241`,
  `unset($record['list_medication_id'])`, which is harmless.
- **Filter:** `filterActiveIssues()` (`1173`).
- **Template:** `medication.html.twig`, `<span>title</span> <span>drug_dosage_instructions</span>`.
- **Empty strings:** same as Problems ("None" / "Nothing Recorded").
- **ACL / collapse / edit:** `aclCheckIssue('medication')`; `medication_ps_expand`
  default `1`; `stats_full.php?active=all&category=medication`.

### Prescriptions card (`1184-1247`)

- **Gate:** `$rx` (above). The eRx branch (`1186-1209`) needs
  `$display_current_medications_below == 1`. That variable is only assigned
  in `stats.php:136,155`, which is a separate AJAX request, so here it is
  always undefined and the "Current Medications" card never renders
  (Finding 14).
- **View args:** title "Prescriptions"; `auth = aclCheckCore('patients','rx','',['write','addonly'])`
  (pencil only for writers); `prescriptions_ps_expand` default `1` →
  expanded. With `erx_enable` (off locally) the title becomes "Prescription
  History" and the button becomes "Add" → `/interface/eRx.php?page=compose`.
  Otherwise `editScripts('<webroot>/controller.php?prescription&list&id=<pid>')`
  opens an iframe modal (Part 1, `472-483`), then `refreshme()`.
- **Body:** `chdir("../../../")` (never restored), then
  `new Controller()->dispatch(['controller'=>'prescription','action'=>'fragment','patient_id'=>$pid])`
  captured with `ob_start` and injected raw as `content` into `rx.html.twig`.
  `dispatch()` re-checks `patients/rx` (`library/classes/Controller.class.php:131-144, 211-212`)
  and calls `C_Prescription::fragment_action($pid)`
  (`controllers/C_Prescription.class.php:286-300`, tagged `@deprecated … isn't used`
  but in fact live) → `Prescription::prescriptions_factory($pid)` → Smarty
  `templates/prescription/general_fragment.html`.
- **Query and sort:** `SELECT id FROM prescriptions WHERE patient_id = ? ORDER BY active DESC, date_modified DESC, date_added DESC`
  (`library/classes/Prescription.class.php:1206-1250`), then one
  `new Prescription($id)` per row, which is N+1 queries plus four
  `list_options` loads per object (`:202-206`).
- **Filter, as written:** `{if $prescription->get_active() > 0}` (`general_fragment.html:28`).
  **As executed: no filter.** `Prescription::__construct()` sets
  `$this->active = 1` (`:241`; property default `:149`), then `populate()`
  → `ORDataObject::populate_array()`, which calls `set_<col>()` only
  `if (!empty($field))` (`src/Common/ORDataObject/ORDataObject.php:130-144`).
  A DB `active` of `0`/`"0"` is `empty()`, so `set_active()` never runs and
  `get_active()` returns 1 for **every** row. The card shows inactive
  prescriptions too, and the edit list's `inactive` class
  (`general_list.html.twig:352`) never applies. There is a worse
  consequence: the edit form's `active` checkbox is always pre-checked
  (`general_edit.html.twig:155`), so saving any edit re-activates a stopped
  prescription (Finding 3). The local DB has no `active=0` prescriptions
  (read-only SQL: every patient's rows are all active), so the probe could
  not reveal this.
- **Columns:** Drug = `$prescription->drug` + `&nbsp;`. Details =
  `get_size()` + `get_unit_display()` (`drug_units` title) + `&nbsp;` +
  `get_dosage_display()`. That last value is `dosage` alone when `form` and
  `interval` are both `''`, otherwise `"<dosage> in <drug_form title> <drug_interval title>"`
  (`:552-559`). Because of the same `empty()` rule, a stored `form=0` stays
  `''`. Qty = `quantity` (NULL → `''`). Refills = `get_refills()` (int; NULL
  → `0`). Filled = `get_date_added()`, the raw `YYYY-MM-DD HH:MM:SS`.
- **Empty string:** "None", printed only when the patient has **zero**
  prescription rows (`general_fragment.html:12-13`). If rows existed but
  all were filtered, the card would show a header-only table.

### Care Team card (`1252-1276`)

- **Gate:** `!in_array('card_care_team',$hiddenCards)`, then the card's
  `getAcl()` = `['patients','demo']` (`src/Patient/Cards/CareTeamViewCard.php:89`),
  checked at `1270-1271`. That is the same pair as the page gate, so it
  always passes here. The edit button needs `patients/demo` **write**
  (`:86, 105`).
- **Side effect at construction:** `handleFormSubmission()` (`:124-147`)
  runs in the constructor. A POST with `save_care_team=true` plus CSRF
  saves the team before the page renders.
- **View args:** `demographics.php` builds `btnLink => 'test'` (`1268`) and
  `id => 'care_team'`. Both are overridden by the card's
  `templateVariables` through `array_merge` (`1273`): `id => 'careteam_ps_expand'`,
  `btnLabel "Edit"`, `btnClass 'btn-edit-care-team'`, `btnLink "javascript:void(0);"`,
  `linkMethod 'html'`, `auth` = demo-write.
- **Data:** `CareTeamService::getCareTeamData($pid)` (`src/Services/CareTeamService.php:549-669`).
  `care_teams LEFT JOIN (care_team_member WHERE status != 'inactive' AND status != 'entered-in-error')`,
  plus users, contact/person/contact_relation, facility and three
  `list_options`. `WHERE ct.pid=? AND (ct.status IS NULL OR ct.status != 'entered-in-error')`,
  `ORDER BY ct.team_name, ctm.date_created ASC`. The subquery's `!=` also
  drops members whose status is NULL (the column defaults to `active`).
  Rows with neither user nor contact are skipped (`:615-617`). **Only one
  team is returned:** the first with `team_status==='active'`, otherwise
  the first team found (`:651-660`). If there is none, the return is
  `team_name ''`, `members []`.
  `hasActiveCareTeam()` (`:367-373`) is passed as `hasActiveTeam` but the
  template never reads it.
- **Template:** `patient/card/manage_care_team.html.twig`. The server
  renders only the team `<h5>` (name + status badge: active=`badge-success`,
  inactive=`badge-warning`, proposed=`badge-info`,
  entered-in-error=`badge-danger`, else `badge-secondary`,
  `CareTeamViewCard.php:311-329`) and an **empty** `<tbody>` under the
  8-column header Type / Member / Role / Facility / Since / Status / Note /
  Remove (`:190-205`). Member rows are **built in the browser** by
  `preloadTeamRows()` (`:31-107`) from the JSON `existingCareTeam`. The
  view-mode text of Member, Role, Facility and Status is then replaced by
  the text of the selected `<option>` in hidden edit `<select>`s (`:98-101`).
  Consequences:
  - Member shows "Lname, Fname" (+ " (physician_type)"), the option text
    built at `CareTeamViewCard.php:260-267`, **not** the service's
    "Fname Lname (type title)".
  - The option list holds only `users.active = 1` with non-null username
    and fname (`:201-205`). A member whose user is inactive shows a
    **blank** name. Likewise, a facility that is neither a service nor a
    billing location shows a blank Facility (`:219-224`). With an NPI the
    facility text is "Name (NPI: n)".
  - Since is the raw `provider_since` (`YYYY-MM-DD`); Note is the raw `note`.
  - Both go into `innerHTML` unescaped: `${member.provider_since}` and
    `${member.note}` (`:64-65, 72-73`). That is stored XSS (Finding 4).
  - The template nests a full `<html><head>` and calls
    `setupHeader(['no_bootstrap','datetime-picker'])` (`:3-7`), which
    re-emits every autoload asset (jQuery, utility, main-theme, textformat,
    dialog, per `config/config.yaml`) in the middle of the body (Finding 6).
- **Empty state:** no text at all, just the header row. With no team there
  is no `<h5>`.
- **Collapse:** `getUserSetting('careteam_ps_expand') == 0`
  (`CareTeamViewCard.php:85`). There is **no default row** for this label,
  so `getUserSetting()` returns NULL, `NULL == 0` is true, and the card
  starts **collapsed**.
- **Why the seeded probe saw "only the header row":** the card was collapsed
  (screenshot `probe/results/claude-laptop-seeded/screens/card-13-care_team.png`).
  The probe records `tables` as `th` text only (`probe/probe-dashboard.mjs:110`).
  It records `text` as `innerText` of the collapsed body, sliced to 4,000
  characters (`:108`); for a non-rendered element `innerText` falls back to
  `textContent`, so the capture is the inline `<script>` source cut off
  before any row. That captured script contains `existingCareTeam` with
  exactly two members (user 5 nurse, user 6 PCP) and leaves out the
  inactive user 10. That is the correct output of
  `CareTeamService.php:564-566`. **The card works; the observation is a
  capture artifact.** The two members are ordered nurse first, then PCP:
  all three seed rows share one `date_created`, so the order among them is
  not defined.

### Treatment Intervention / Care Experience Preferences (`1277-1329`)

Out of scope; see the table below.

### Left column (`1331-1578`)

- Deceased banner (`1333-1337`, `patient/partials/deceased.html.twig`) when
  `is_patient_deceased()` (Part 1, `307`) is set.
- `SectionEvent('primary')` cards loop (`1339-1380`): Demographics, Billing
  (unless `hide_billing_widget`), Insurance (unless hidden). Each card is
  skipped only if `!empty($_auth) && !aclCheckCore(...)`, so a card whose
  ACL is `[]` is **always** shown. That is Billing
  (`src/Patient/Cards/BillingViewCard.php:32`).
- Messages, Patient Reminders, Disclosures, Amendments, Labs, **Vitals**,
  LBF chartable forms: see below.

### Messages card (`1384-1401`), documented only to mark it as not ported

- **Gate:** `aclCheckCore('patients','notes')`. The shell is `loader.html.twig`
  (spinner + sr-only "Loading...") with `id pnotes_ps_expand` and the
  default `0`, so it starts **collapsed**. The pencil (`patients/notes`
  write) links to `pnotes_full.php?form_active=1`.
- **Body:** `pnotes_fragment.php` over AJAX. It re-checks `patients/notes`
  **and** squad (`pnotes_fragment.php:45-51`, "(Notes not authorized)"),
  then calls `getPnotesByDate("", 1, …, $pid, $N, 0, '', $docid)` with
  `$N = num_of_messages_displayed` (3 locally). The SQL
  (`library/pnotes.inc.php:147-206`) is `deleted != 1 AND activity='1' AND message_status != 'Done' AND p.pid != p.user`,
  `ORDER BY date DESC LIMIT 0,$N`.
- **Why the probe showed 2 of 3 active notes:** the third seeded active note
  has `message_status='Done'` (`seed/phase1-seed.sql`, 2026-09-24 note),
  and `activity='1'` mode excludes Done. The footer then prints
  "Displaying the following number of most recent messages: **3**". That
  number is the limit `$N`, not the count shown (`pnotes_fragment.php:127-128`,
  Finding 7).
- **Empty:** "There are no messages on file for this patient." plus, for
  write/addonly users, " To add messages, please click here." Each row has
  a "Completed" button that POSTs `?docUpdateId=` → `disappearPnote()`.
- **Why it is not ported:** there is no read API for `pnotes` (only
  POST/PUT/DELETE, scope `message.cud`; `api/CLINICAL-CARDS.md` DB-08). The
  decision is recorded in `AUDIT-STATE.md` (2026-09-25).

### Vitals card (`1507-1530`), DB-08

- **Gate:** `$vitals_is_registered` (Part 1, `344-345`: `registry.directory='vitals' AND state=1`;
  true locally) `&& aclCheckCore('patients','med')`, and `card_vitals` not
  hidden. The async fetch is emitted under the same condition (Part 1,
  `629-632`) but ignores `hiddenCards`. When the card is hidden,
  `placeHtml()` finds no div and skips.
- **Shell:** `loader.html.twig` titled "Vitals", `id vitals_ps_expand`
  (default `1` → expanded), button "Trend" →
  `../encounter/trend_form.php?formname=vitals&context=dashboard`
  (`linkMethod html`). `auth` = whether **any** `form_vitals` row exists for
  the pid (`1511`, deleted forms included).
- **Body:** `vitals_fragment.php` (separate unit, `ui/VITALS-FRAGMENT.md`).
  In short: it checks CSRF and does **no ACL check**. Its query:
  `SELECT … FROM form_vitals LEFT JOIN forms ON form_vitals.id = forms.form_id WHERE pid=? AND forms.deleted != '1' ORDER BY date DESC`
  (`vitals_fragment.php:27`). The join does not restrict
  `forms.formdir='vitals'`, so any other form type whose `form_id` happens
  to equal the vitals id keeps a deleted vitals set visible. **Confirmed on
  local data:** this exact WHERE clause returns `form_vitals.id=28`
  (2026-05-01, whose `vitals` forms row has `deleted=1`), because
  `newpatient` and `procedure_order` rows with `form_id=28` are not deleted.
  The correct latest set is id 27 (2026-04-05) (Finding 5). Output:
  "Most recent vitals from: <raw date>", then `vitals_report()` (non-empty
  fields only, units per `units_of_measurement`), then "Click here to view
  and graph all vitals.". Empty: "No vitals have been documented.". The
  seeded probe predates the vitals seed and showed the 2018-02-25 set.

### LBF chartable forms (`1537-1576`)

This is one loader card per `layout_group_properties` LBF with `grp_repeats > 0`.
The ACL is `grp_aco_spec`. `id` = the form id (e.g. `LBFxxx`). That id does
not end in `_expand`, so `library/ajax/user_settings.php:25` never persists
its toggle (Finding 13). The "Trend" link is hard-coded to
`formname=vitals`, not to the LBF (`1568`). No fetch fills these loaders in
this file, as far as Part 1's list shows.

### Right column (`1579-2055`)

Portal/API card (`SectionEvent('secondary')`), the eRx partial, ID Card /
Photos, Advance Directives, Clinical Reminders, the Appointments block (with
Recall), `#stats_div`, Tracks, and the Delete partial. See the table below.
The Appointments block reuses `$result` as a loop variable (`1841`). The
patient row it held was already overwritten at `1451`.

## Collapse state (all cards)

- **Read:** `initiallyCollapsed = (getUserSetting($id) == 0)`.
  `getUserSetting()` returns the user's row, else the user-0 row, else
  **NULL** (`src/Services/Globals/UserSettingsService.php:40-50`,
  `ORDER BY setting_user DESC`). `NULL == 0` is true, so **any label with no
  row starts collapsed.**
- **Defaults** (user 0, `sql/database.sql:9910-9926`; the same rows exist
  locally): expanded (`1`) for `allergy`, `medical_problem`, `medication`,
  `prescriptions`, `vitals`, `appointments`, `clinical_reminders`,
  `immunizations`, `surgery`, `dental`, `directives`. Collapsed (`0`) for
  `billing`, `demographics`, `disclosures`, `insurance`,
  `patient_reminders`, `pnotes`. No row, so collapsed: `careteam`,
  `labdata`, `amendments`, `recall`, `photos`, `adv_directives`,
  `track_anything`, `patient_portal`, `treatmentpref`, `carepref`,
  `current_prescriptions`, LBF ids.
- **Write:** Part 1 binds `updateUserVisibilitySetting` to every
  `[data-toggle="collapse"]` present **after `stats.php` loads** (`606-609`).
  It POSTs `target=<id>` and `mode` 0/1 to `library/ajax/user_settings.php`,
  which accepts only targets ending in `_expand` (`:25-28`).
  `setUserSetting()` also creates the **user-0 default if none exists**
  (`UserSettingsService.php:84-107`). So the first user ever to toggle a
  no-default card, such as Care Team, sets the starting state for every
  user who has no row of their own (Finding 12). The collapse state is
  per-user and server-stored, not per-browser.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| Open page | yes | `aclCheckCore('patients','demo')` + `ViewEvent` (`1056-1061`) | Runs **after** `<head>` emitted PHI and after `setpid()` (Finding 2) |
| Squad restriction | **partial** | `aclCheckCore('squads',$result['squad'])` (`1069`) | Hides header and delete only; cards still render (Finding 1). Other summary pages deny outright (`demographics_full.php:68-69`) |
| Allergies / Problems / Meds view | yes | `aclCheckIssue(type)` → `issue_types.aco_spec` (`patients\|med` locally) | Empty `aco_spec` means **no check** |
| Allergies / Problems / Meds edit pencil | **missing** | `'auth' => true` (`1129,1153,1177`) | Shown to read-only users; target page enforces its own ACL |
| Prescriptions view | yes | `patients/rx` (`1098`) + re-check in `Controller::dispatch` | API route uses `patients/med` instead |
| Prescriptions edit | yes | `patients/rx` write\|addonly (`1219`) | |
| Care Team view | yes (weak) | `getAcl()` = `patients/demo` (`1270-1271`) | Same as page gate; FHIR `CareTeam` needs `patients/med` |
| Care Team edit/save | yes | `patients/demo` write for the button; the save path has CSRF only | `handleFormSubmission()` (`CareTeamViewCard.php:124-147`) checks CSRF but no write ACL. Not traced further (Care Team unit) |
| Vitals card | yes | `patients/med` (`1507`) | `vitals_fragment.php` itself has **no** ACL (CSRF only) |
| Messages | yes | `patients/notes` (`1384`), fragment re-check + squad | |
| Treatment / Care Experience prefs | **missing** | hidden-card check only (`1280, 1306`) | |
| Billing | **missing** | `acl => []` skips the loop check (`1358`) | |
| Portal / API card | yes | `patients/demo` (`PortalCard`) | |
| Patient Reminders / Disclosures / Amendments / Labs / Clinical Reminders / Appointments | yes | `reminder` / `disclosure` / `amendment` / `lab` / `alert` / `appt` | |
| ID Card / Photos, Advance Directives, Tracks | **missing** | none | Advance Directives always `auth => true` (`1715`) |
| Delete patient partial | yes | `$thisauth` (+ `admin/super` inside the template) | |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `lists` (allergy, medical_problem, medication) | yes | no | `AllergyIntoleranceService::search`, `PatientIssuesService::search` | n/a |
| `lists_medication`, `list_options`, `users`, `facility`, `patient_data` | yes | no | same | n/a |
| `lists_touch` | yes | no | `getListTouch` ×3 | n/a |
| `issue_types` | yes | no | `$ISSUE_TYPES` (via `aclCheckIssue`) | n/a |
| `prescriptions` (+ `list_options` drug_*) | yes | no | `prescriptions_factory`, `Prescription::__construct` | n/a |
| `care_teams`, `care_team_member`, `contact`, `person`, `contact_relation` | yes | **yes on POST** | `CareTeamViewCard::handleFormSubmission` → `saveCareTeam`; `getOrCreateForEntity` may **insert** a `contact` row on a plain GET (`CareTeamViewCard.php:190`) | not traced |
| `user_settings` | yes | via AJAX | `getUserSetting` ×N; writes by `user_settings.php` | no |
| `form_vitals`, `forms`, `registry` | yes | no | `1511`, fragment | n/a |
| `amendments`, `procedure_report`/`procedure_order`, `layout_group_properties`, `categories`/`documents`, `openemr_postcalendar_*`, `medex_recalls`, `globals` | yes | no | out-of-scope cards | n/a |
| `pnotes` | yes | yes (Completed button) | `pnotes_fragment.php` | no |

## Cross-links

- **Opened by:** the tabbed shell / Finder / direct `set_pid` URL (Part 1).
- **Opens:** `stats_full.php`, `controller.php?prescription&list` (B-14 path, `ui/DASHBOARD-MAP.md` §5), `pnotes_full.php`, `trend_form.php`, `labdata.php`, `disclosure_full.php`, `list_amendments.php`, `patient_reminders.php`, `clinical_reminders.php`, `create_portallogin.php`, `add_edit_event.php` (`newEvt`).
- **Calls into:** `AllergyIntoleranceService`, `PatientIssuesService`, `Controller`/`C_Prescription`/`Prescription`, `CareTeamViewCard`/`CareTeamService`, `TreatmentPreferenceViewCard`, `CareExperiencePreferenceViewCard`, `DemographicsViewCard`, `BillingViewCard`, `InsuranceViewCard`, `PortalCard`, `fetchNextXAppts`/`fetchRecurrences`/`fetchXPastAppts`, `resolve_rules_sql`, `pic_array`.
- **Related units:** `ui/CARE-TEAM-CARD.md` (XSS, nested head, JS rows), `ui/VITALS-FRAGMENT.md` (deleted-set bug, no ACL), `ui/STATS.md` (Health Concerns / Immunizations / eRx variable), `ui/PRESCRIPTION-TEMPLATES.md` (dead `active` filter, edit re-activation), `modules/MEDICATION-SERVICES.md`, `modules/CARE-TEAM-SERVICES.md`, `modules/VITALS-SERVICES.md`, Part 1 analysis.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Security | High (verified) | A squad restriction hides only the header and delete button. Every clinical card (allergies, problems, meds, Rx, care team, vitals, …) still renders for a user who lacks the patient's squad ACL, while sibling pages deny. | `1068-1077` vs `1089-2045`; `demographics_full.php:68-69` | In the port, treat a squad failure as whole-page deny (and note the API has no squad concept) |
| 2 | Security | High (verified) | The page ACL gate runs after the `<head>`, which already emitted name, pubpid, DOB/age and the encounter list in JS, and after `setpid()`/recent-list writes. Unauthorized users get PHI in page source. | `1056-1061`; Part 1 `83-94`, `916-967` | The port must authorize before fetching or rendering any identity |
| 3 | Bug | High (verified by code read; no `active=0` rows locally) | The Prescriptions `active` filter never excludes anything: `populate_array()` skips `empty()` values, so `active=0` never overrides the default 1. The card shows stopped prescriptions, and the edit form's checkbox is always checked, so saving re-activates them. Contradicts Phase 1. | `general_fragment.html:28`; `Prescription.class.php:149,241`; `ORDataObject.php:137`; `general_edit.html.twig:155` | Port decision: strict parity (show all) vs intent (active only). Record as a catalog bug |
| 4 | Security | High (verified) | Stored XSS in the Care Team card: `member.note` and `provider_since` are interpolated into `row.innerHTML` without escaping. | `templates/patient/card/manage_care_team.html.twig:64-65,72-73` | Port renders as text nodes; catalog upstream |
| 5 | Bug | High (verified by SQL on pid 13) | The Vitals card can show a deleted vitals set: the fragment's join lacks `formdir='vitals'`, so other forms' non-deleted rows with the same `form_id` pass `deleted != '1'`. | `vitals_fragment.php:27`; card `1507-1530` | Port filters `deleted=0` per vitals form; document the divergence |
| 6 | Smell | Medium | The Care Team template nests `<html><head>` and calls `setupHeader`, re-emitting jQuery and other autoload assets mid-body. The runtime effect on plugins bound to the first jQuery is unverified. | `manage_care_team.html.twig:3-7`; `src/Core/Header.php:84-150` | Port: none needed; verify in the Care Team unit |
| 7 | Bug | Medium | The Messages footer shows the limit N as "number of most recent messages" even when fewer are shown; `Done` notes are silently excluded. | `pnotes_fragment.php:127-128`; `library/pnotes.inc.php:184` | Not ported; record for the catalog |
| 8 | Bug | Medium | Empty-state wording depends on `lists_touch`, not data: "No Known Allergies"/"None" can appear for a patient with (resolved) entries, and "Nothing Recorded" for one whose entries are all resolved. | `allergies.html.twig:28-37`; `medical_problems.html.twig:7-15`; `1128,1152,1174` | Port: `lists_touch` is not available via the API; choose a documented rule |
| 9 | Half-implemented | Medium | The Allergies docblock promises severe allergies pinned to the top; the code only highlights them, and the service has no ORDER BY, so row order is DB-defined. | `allergies.html.twig:6-9,38-49`; `AllergyIntoleranceService.php:51-103` | Port: preserve API order; do not invent a sort |
| 10 | Bug | Medium | `filterActiveIssues()` ignores `activity` (disappeared issues still show) and hides an issue from midnight of its end date; it differs from both FHIR rules. | `1110-1113` | Port replicates exactly: `outcome != 1 && (!enddate \|\| enddate > now)` |
| 11 | Bug | Low | The Prescriptions "None" appears only for zero rows; if the filter ever worked, an all-inactive list would render a header-only table. | `general_fragment.html:12-28` | Port: spec both states |
| 12 | Smell | Low | A missing `user_settings` row means collapsed (`NULL == 0`), and the first user to toggle creates the global default for everyone. | `UserSettingsService.php:40-50,84-107`; e.g. `CareTeamViewCard.php:85` | Port: fixed defaults per card from `database.sql` + "collapsed when absent" |
| 13 | Bug | Low | LBF card ids don't end in `_expand`, so their collapse state is never saved; their "Trend" link is hard-coded to vitals. | `1566-1568`; `library/ajax/user_settings.php:25` | Out of scope |
| 14 | Dead code | Low | The eRx "Current Medications" block depends on a variable defined only in `stats.php` (another request), so it never renders. | `1186`; `stats.php:136,155` | Out of scope |
| 15 | Smell | Low | Edit pencils on Allergies, Problems and Meds are shown regardless of write ACL; `btnLink => 'test'` placeholder; `btnCLass` typo. | `1129,1153,1177`; `1268`; `1464` | Port is read-only; no action |
| 16 | Smell | Low | `$result` (patient row) and `$result2` are reused as loop and statement variables; `chdir("../../../")` is never restored. | `1451,1841,1902`; `1233-1234` | Out of scope |
| 17 | Bug | Low | The Care Team view derives names and facilities from `<select>` options: an inactive user shows a blank member; a non-service/billing facility shows a blank facility; only one team is ever shown. | `manage_care_team.html.twig:98-101`; `CareTeamViewCard.php:201-224`; `CareTeamService.php:651-660` | Port: replicate the display, or document |
| 18 | Security | Low | Billing, Treatment Prefs, Care Experience, Photos, Advance Directives and Tracks cards have no ACL beyond the page gate. | `BillingViewCard.php:32`; `1280,1306,1641,1663,2030` | Out of scope |
| 19 | Parity | Low | Card ACLs differ from API route ACLs: Rx `patients/rx` vs API `patients/med`; Care Team `patients/demo` vs FHIR `patients/med`. | `1098`, `1270`; `_rest_routes_standard.inc.php:665`; FHIR routes CareTeam | Port: document "who can see" differences |
| 20 | Smell | Low | Rendering the dashboard (a GET) can insert a `contact` row for the patient: the Care Team card calls `getOrCreateForEntity('patient_data', $pid)`. | `CareTeamViewCard.php:190`; `src/Services/ContactService.php:38-57` | Port is read-only; the API does not do this |

## Port notes

- **Must survive:** the source order and the two-column layout; each card's
  per-card ACL; the exact `filterActiveIssues` rule for the three issue
  cards; Problems/Meds sorted by `begdate` ASC with NULLs first; the
  allergy severity label fallback to the raw code, and the highlight for
  severe/life-threatening/fatal; the per-card default expanded/collapsed
  state; the Care Team shows one team and hides inactive and
  entered-in-error members; the Vitals card shows only the latest set.
- **Must not survive:** PHI emitted before authorization; squad bypass;
  innerHTML XSS; deleted vitals shown; the Prescriptions checkbox
  re-activation (not ported: the port is read-only).
- **Open questions:** (a) Prescriptions: strict parity (all rows, as
  executed) or intended parity (`active=1` only)? This is David's call;
  AUDIT-STATE "strict parity" suggests all rows. (b) Vitals: show the
  deleted 2026-05-01 set to match PHP, or the correct 2026-04-05 set? (c)
  How to derive "No Known Allergies" vs "Nothing Recorded" without
  `lists_touch`? (d) How to hide inactive Care Team members when FHIR
  exposes no member status? (e) Squads: the API has no squad concept; is
  that acceptable? (f) `hide_dashboard_cards` is a site global with no read
  API; assume nothing hidden?

## Parity spec for the port

API sources: `api/CLINICAL-CARDS.md` (DB-03…DB-07) and
`api/AUTH-AND-PATIENT.md` (§2.5 pid↔uuid, §3 ACL/scopes; patient-context
tokens skip ACL). List titles come from `GET /api/list/:list_name`
(`_rest_routes_standard.inc.php:435-440`, ACL `lists/default`).
**Common states:** the PHP cards 1–5 are server-rendered, so they have no
loading state; an SQL exception fails the whole page. The Vitals body has a
spinner with sr-only "Loading..." (`loader.html.twig`). There is no error
state anywhere: a failed fetch leaves the spinner, and a non-2xx body is
injected as-is. The port must define loading/error; parity has none to copy.
The card header is the title, then a collapse icon (`fa-expand` when
collapsed, `fa-compress` when open), then the pencil if authorized (not
ported: read-only).

### Allergies (DB-03)

| Item | PHP behavior | API source |
|---|---|---|
| Title | "Allergies" | n/a |
| Rows | all `lists` type=allergy for the patient, then `outcome != 1 && (enddate empty \|\| enddate > now)` | `GET /api/patient/:puuid/allergy` (returns `outcome`, `enddate`, `severity_al`, `reaction_title`, `title`; unfiltered). FHIR `clinicalStatus` uses a different rule; don't use it |
| Sort | none (DB order; the same SQL backs the API) | API order as returned |
| Row text | `"<title> (<severity>)"`; severity = `severity_ccda` title for `severity_al`, else the raw value ("1"), NULL → "()" | `severity_al` + `GET /api/list/severity_ccda` |
| Highlight | `bg-warning font-weight-bold` on severity if `severity_al` ∈ {severe, life_threatening_severity, fatal} | `severity_al` |
| Tooltip | `"<title> Reaction: <reaction_title> - <severity>"` | `reaction_title` |
| Empty | "No Known Allergies" if `lists_touch(pid,'allergy')` exists, else "Nothing Recorded" | `lists_touch`: **not available via API** |
| Default | expanded | n/a |
| ACL | `issue_types.aco_spec` for allergy (`patients\|med`) | route ACL `patients/med` (matches) |

### Medical Problems (DB-04)

| Item | PHP behavior | API source |
|---|---|---|
| Title | "Medical Problems" (not "Problem List") | n/a |
| Rows | type=medical_problem, same `filterActiveIssues` | `GET /api/patient/:puuid/medical_problem` (`lists.*`, unfiltered). Dedupe by `uuid`: `ConditionService` LEFT JOINs `issue_encounter`, so a problem linked to several encounters can repeat (inferred; none in pid 13) |
| Sort | `begdate` ASC, NULL first | `begdate` (client sort; API has no ORDER BY) |
| Row text | `title` only | `title` |
| Empty | "None" if `lists_touch(pid,'medical_problem')`, else "Nothing Recorded" | **not available via API** (pid 13 has the touch row) |
| Default / ACL | expanded / `patients\|med` | route `patients/med` |

### Medications (DB-05)

| Item | PHP behavior | API source |
|---|---|---|
| Title | "Medications" | n/a |
| Rows | `lists` type=medication, same `filterActiveIssues` | `GET /api/patient/:pid/medication` (`SELECT * FROM lists … ORDER BY date DESC`; takes integer pid) |
| Sort | `begdate` ASC, NULL first | client re-sort on `begdate` |
| Row text | `title` + " " + `drug_dosage_instructions` | `title`; **`drug_dosage_instructions` is not in this endpoint** (it lives in `lists_medication`). Available from `GET /api/prescription` rows with `source_table=lists` only for meds **not** linked to a prescription (`PrescriptionService.php` lists branch `prescription_id IS NULL`), or FHIR `MedicationRequest.dosageInstruction.text`. Otherwise **not available via API** |
| Empty | "None" / "Nothing Recorded" (lists_touch) | lists_touch **not available** |
| Default / ACL | expanded / `patients\|med` | route `patients/med` |

### Prescriptions (DB-06)

| Item | PHP behavior | API source |
|---|---|---|
| Title | "Prescriptions" ("Prescription History" if `erx_enable`) | n/a |
| Rows | **as executed: every `prescriptions` row for the patient** (the `active` filter is dead, Finding 3); as written: `active > 0` | `GET /api/prescription` rows with `source_table='prescriptions'` for the patient; `active` is available for the intended filter |
| Sort | `active DESC, date_modified DESC, date_added DESC` (MySQL: NULL `date_modified` last in DESC) | `active`, `date_modified`, `date_added` (all selected) |
| Drug | `drug` | `drug` |
| Details | `size` + unit title + " " + `dosage`, plus `" in <form title> <interval title>"` when form or interval is set | `prescription_drug_size`, `unit_title` (API uses `COALESCE(prescriptions.unit, drugs.unit)`, which can differ), `dosage`, `interval_title`; **`form` not selected by the API** |
| Qty | `quantity`, NULL → blank | `quantity` |
| Refills | `refills`, NULL → "0" | **not available via API** (`api/CLINICAL-CARDS.md` DB-06) |
| Filled | `date_added` raw `YYYY-MM-DD HH:MM:SS` | `date_added` |
| Empty | "None" only when the patient has no prescription rows | row count |
| Default / ACL | expanded / `patients/rx` | route `patients/med` (**differs**) |

### Care Team (DB-07)

| Item | PHP behavior | API source |
|---|---|---|
| Title | "Care Team" | n/a |
| Team | first team with status `active` (by `team_name`), else the first non-entered-in-error team; `<h5>team_name</h5>` + status badge (title from `Care_Team_Status`) | `GET /fhir/CareTeam?patient=` → `name`, `status`; client picks per the same rule |
| Members | status ≠ inactive, entered-in-error, NULL | FHIR `participant[]`. **Member status is not exposed, and inactive members are not filtered** (`CareTeamService.php:177-190`; inferred, confirm in `modules/CARE-TEAM-SERVICES.md`) → **not available via API** |
| Order | `date_created` ASC (ties undefined) | FHIR participant order |
| Type | badge "Provider" (user) / "Related Person" (contact) | participant member reference type (Practitioner / RelatedPerson; RelatedPerson is limited by US Core version, `FhirCareTeamService.php` ~`:308`) |
| Member | "Lname, Fname" (+ " (physician_type)"); blank if the user is inactive | Practitioner reference → fetch `Practitioner` name |
| Role | `care_team_roles` option title | `participant.role` SNOMED code → map via `GET /api/list/care_team_roles` `codes` |
| Facility | facility name (+ " (NPI: n)"); blank unless a service/billing location | `participant.onBehalfOf` Organization |
| Since | raw `provider_since` `YYYY-MM-DD` | `participant.period.start` (`FhirCareTeamService.php` ~`:342-346`) |
| Status | member status title | **not available via API** |
| Note | raw `note` | **not available via API** |
| Remove | header only in view mode | n/a (read-only) |
| Empty | header row only, no text, no `<h5>` | empty Bundle |
| Default / ACL | **collapsed** (no default row) / `patients/demo` | route `patients/med` (**differs**) |

### Vitals (DB-08)

| Item | PHP behavior | API source |
|---|---|---|
| Title / button | "Vitals" / "Trend" (link not ported) | n/a |
| Row selection | latest `form_vitals` by `date` whose join to `forms` has `deleted != '1'` for *any* formdir (**bug: can pick a deleted set**; pid 13 → 2026-05-01 id 28) | `GET /fhir/Observation?patient=&category=vital-signs` (ACL `patients/med`). `FhirObservationVitalsService.php` adds no `deleted` filter and `VitalsService::search` joins `formdir='vitals'` without one (inferred: the API may also return deleted sets; confirm in `modules/VITALS-SERVICES.md`). REST vitals is per encounter only (`GET /api/patient/:pid/encounter/:eid/vital`) |
| Header line | "Most recent vitals from: <raw date>" | `effectiveDateTime` (UTC-converted; format differs) |
| Body | `vitals_report()` fields that are non-empty and ≠ "0.0", with units per `units_of_measurement` (e.g. "170.3 in (432.60 cm)"), "Last Updated" | group Observations by effective date/encounter; units from `valueQuantity` (`ui/VITALS-FRAGMENT.md`) |
| Footer | "Click here to view and graph all vitals." (link) | not ported |
| Empty | "No vitals have been documented." | empty Bundle |
| Loading | spinner, sr-only "Loading..." | port-defined |
| Default / ACL | expanded / `patients/med` + vitals registered | `patients/med` (matches) |

## Phase 1 map check (`ui/DASHBOARD-MAP.md`, `RECON.md`, `PROJECT-MAP.md`)

| Where | Phase 1 says | Correction |
|---|---|---|
| `PROJECT-MAP.md` UI units | `demographics.php` 1,890 lines | 2,080 lines (`DASHBOARD-MAP.md` header is right) |
| `DASHBOARD-MAP.md` §2 item 4 | squad failure "only suppresses the header/card region rendered under `if ($thisauth):`" | It suppresses **only** the header (and the delete partial at `2046`). **All cards render** (Finding 1) |
| §2 item 4 | gate described as the first thing that renders | It runs after the `<head>` emitted identity JS (Finding 2) |
| §3 default collapse | "If no stored setting exists `getUserSetting()` presumably returns a value that isn't literally `0` (cards open by default)" | It returns **NULL**, and `NULL == 0` means **collapsed**. Open-by-default cards are open only because `sql/database.sql:9910-9926` seeds user-0 rows. That is why Care Team, Labs and Amendments start collapsed |
| §4 Allergies row | filter only | Add: **no sort** (DB order); empty text also "No Known Allergies" when `lists_touch` exists; pencil shown regardless of ACL |
| §4 Medical Problems / Medications rows | filter + ORDER BY `begdate` | Correct. Add: empty text "None" when touched; Meds show `drug_dosage_instructions`, which `/api/patient/:pid/medication` does not return |
| §4 Prescriptions row, `RECON.md` DB-06, `api/CLINICAL-CARDS.md` DB-06, `REQUIREMENTS-TRACE.md` DB-06 | "only rows where the `active` DB column is truthy render"; RECON "sorted by Filled desc" | The `active` filter is **dead**: every row renders (Finding 3). Sort is `active DESC, date_modified DESC, date_added DESC`; "Filled desc" holds only while `date_modified` is NULL/equal. `AUDIT-STATE.md`'s calibration note ("the Rx `active` filter … held") needs revisiting |
| §4 Care Team row | filter + ACL + btnLink | Correct. Add: **rows are built client-side by JS**; the card is collapsed by default (no settings row); one team only; `hasActiveTeam` is unused; member/facility names come from `<select>` options. The probe's "header row only" is a capture artifact, not a data bug (see the Care Team section) |
| §4 Messages row | "no other filter — all active notes up to N" | Also excludes `message_status='Done'`, `deleted=1` and `pid = user`; `ORDER BY date DESC`. Explains 2 of 3; the footer's "3" is the limit |
| §4 Vitals row | existence check + async fetch | Add: the fragment can show a **deleted** set (Finding 5); the fragment has no ACL; the fetch ignores `hide_dashboard_cards`; `auth` for "Trend" counts deleted forms |
| §4 Billing row | "same loop ACL check" | Billing's ACL is `[]`, so the loop skips the check and it **always** renders (`BillingViewCard.php:32`) |
| §4 Treatment / Care Experience rows | no `AclMain` | Correct. Add: `id` and `initiallyCollapsed` are overridden by the card's `templateVariables` (`treatmentpref_ps_expand` / `carepref_ps_expand`), and neither has a default row, so both start collapsed |
| §3 card order | Rx listed as a primary card | Row 1 width counts only the three issue cards; Rx wraps to its own line. The eRx "Current Medications" card is dead code |

## Out-of-scope cards (not ported, per A1)

One paragraph each: what it shows, its data source and its ACL.

- **Treatment Intervention Preferences** (`1280-1301`). A `TreatmentPreferenceViewCard`
  rendered through `preference_card_inline.html.twig` (422 lines), with an
  inline "Add" editor (`js-card-toggle-edit`). Data comes from the card
  class (`src/Patient/Cards/TreatmentPreferenceViewCard.php`, not traced).
  ACL: none, only `card_treatment_preferences` hidden-card. It starts
  collapsed (`treatmentpref_ps_expand` has no default row).
- **Care Experience Preferences** (`1306-1329`). The same pattern with
  `CareExperiencePreferenceViewCard` and `carepref_ps_expand`. The
  `initiallyCollapsed` computed at `1312` from `card_care_experience` is
  overridden by the card's own value. ACL: none.
- **Demographics** (`1340`). A `DemographicsViewCard($result, $result2)`
  (`tab_base.html.twig`) that shows the layout-driven demographics and
  employer data from Part 1's `getPatientData`/`getEmployerData`. This is
  the only place on the page that shows DOB, sex and External ID.
  ACL `patients/demo`. Default collapsed (`demographics_ps_expand=0`).
- **Billing** (`1342-1344`). `BillingViewCard($pid, $insco_name, billing_note, $result3)`:
  primary insurer name, copay and effective dates, billing note, balance.
  Hidden by `hide_billing_widget`. **ACL: none** (`acl => []`). Default
  collapsed.
- **Insurance** (`1346-1348`). `InsuranceViewCard($pid)`
  (`insurance.html.twig`, 196 lines, primary/secondary/tertiary per
  `insurance_only_one`), with eligibility. ACL `patients/demo`. Default
  collapsed.
- **Patient Reminders** (`1403-1422`). A loader shell filled by
  `patient_reminders_fragment.php` (CDR patient reminders). Needs
  `patients/reminder` and `enable_cdr` + `enable_cdr_prw`. Edit link
  `../reminder/patient_reminders.php?mode=simple&patient_id=`. Default
  collapsed. Its fetch uses `sessionRestore=true`, the source of one
  `top.restoreSession` error outside the shell.
- **Disclosures** (`1424-1445`). A loader filled by `disc_fragment.php`
  (`extended_log` disclosures). ACL `patients/disclosure`; the pencil needs
  write or addonly and goes to `disclosure_full.php`. Default collapsed.
- **Amendments** (`1447-1475`). Rendered synchronously:
  `SELECT * FROM amendments WHERE pid=? ORDER BY amendment_date DESC`
  (`amendments.html.twig`). Needs the `amendments` global and
  `patients/amendment`; the pencil needs write or addonly and goes to
  `list_amendments.php?id=`. Starts collapsed (no default row). The
  statement overwrites `$result`.
- **Labs** (`1477-1505`). An existence query on `procedure_report` JOIN
  `procedure_order` sets `auth` for the "Trend" button (`../summary/labdata.php`);
  the body comes from `labdata_fragment.php`. ACL `patients/lab`. Starts
  collapsed (no default row).
- **Patient Portal / API Access** (`1582-1629`). A `PortalCard` is built when
  any of the portal or API globals are on. It subscribes to
  `SectionEvent('secondary')` and renders `patient/partials/portal.html.twig`
  (portal allowed, credentials created, API allowed). ACL `patients/demo`
  via `getAcl()`. The loop indexes `$_auth[0]` without an empty check
  (`1601-1602`). Starts collapsed (no `patient_portal_expand` row).
- **Clinical Reminders** (`1725-1745`). Needs `resolve_rules_sql()` to be
  non-empty for the user, `enable_cdr` + `enable_cdr_crw`, and
  `patients/alert`. The body comes from `clinical_reminders_fragment.php`
  (`sessionRestore=true`). The pencil needs `alert` write and goes to
  `../reminder/clinical_reminders.php?patient_id=`. Default expanded.
- **Recall** (`1897-1922`). Inside the Appointments block, only when
  `$resNotNull`: `SELECT * FROM medex_recalls WHERE r_pid=?` → date and
  reason (`recall.html.twig`). ACL: the appointments `patients/appt`.
  Starts collapsed (no default row). *Note:* `recallsAvailable` uses
  `$count` from the appointment loop.
- **Appointments** (`1747-2022`). Future appointments via
  `fetchNextXAppts()`, windowed by `number_of_appts_to_show`, with display
  sets and colors (`1776-1834`). Recurrences come from `fetchRecurrences()`
  when `appt_recurrences_widget` is on, and past appointments from
  `fetchXPastAppts()` when `num_past_appointments_to_show` is non-zero.
  Status comes from list `apptstat` ("None" is shown as "Scheduled"). Needs
  `!disable_calendar` and `patients/appt`; the "Add" button (`newEvt()`)
  needs appt write or addonly **and** `$resNotNull`. Default expanded.
- **Health Concerns** (async, `#stats_div` `2024`). Rendered by `stats.php`
  for each remaining `$ISSUE_TYPES` entry (`issue_types.ordering`), with
  `aclCheckIssue($key)` and an SQL-level open-issue filter. Here
  `health_concern` has `aco_spec = patients|med`. Details in `ui/STATS.md`.
  Medical Devices, Surgeries and Dental Issues share this path.
- **Immunizations** (async, `stats.php:273-305`). Rows from `immunizations`
  JOIN codes; hidden by `disable_immunizations` or `weight_loss_clinic`.
  `stats.php` shows no `AclMain` check near it (grep); to confirm in
  `ui/STATS.md`. Default expanded (`immunizations_ps_expand=1`).
- **Conditional extras** (not in RECON's 22): ID Card / Photos
  (`1640-1660`, documents in the configured categories, no ACL); Advance
  Directives (`1663-1723`, `advance_directives_warning`, no ACL,
  `auth => true`); the eRx partial (`1631-1637`); Tracks (`2026-2044`,
  `track_anything` registered, no ACL); LBF chartable forms (`1537-1576`,
  `grp_aco_spec`); the Deceased banner (`1333-1337`); Delete patient
  (`2046-2053`, `$thisauth`, with the admin check inside the template).
