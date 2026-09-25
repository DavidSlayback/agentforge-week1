# demographics.php, part 1: boot, patient context and page script

This is the first 1,055 lines of the patient dashboard
(`interface/patient_file/summary/demographics.php`). Everything that runs
before the page-level ACL check at line 1056 lives here. That includes the
PHP boot (auth include, requires, session/`set_pid` handling, CDR allergy and
reminder checks, patient/employer/insurance loads, deceased/age helpers), and
the whole `<head>`: the inline JavaScript that loads the async card fragments
(`fetchHtml`/`placeHtml`), binds the modals, persists card collapse state, and
pushes patient identity into the tabbed shell (`setMyPatient` →
`parent.left_nav.setPatient`). Control then moves to line 1056 (ACL gate,
header and cards), which the part-2 analysis covers. A user reaches this page
from the Finder, the recent-patients list, or any link to
`demographics.php?set_pid=N`, normally inside the tabbed shell
(`interface/main/tabs/main.php`).

**Source:** `interface/patient_file/summary/demographics.php`, lines 1–1055 of 2,080 (no version header; copyright through 2026)
**Audited by:** tier 3 · confidence high (source read in full for the range; runtime claims cite the seeded probe screenshot or are marked as source-derived)
**Revision:** working tree of `C:\Users\david\repos\agentforge-week1-w2-dashboard` (Phase-1 docs cite `3ccfe1d`)

## Purpose and lifecycle

1. **Request → auth.** `require_once("../../globals.php")` (`:30`). `interface/globals.php:725-728` includes `library/auth.inc.php` (login/session check, idle timeout reset at `auth.inc.php:108-116`). `globals.php:770-776` seeds `session.pid` from `$_GET['pid']`/`$_POST['pid']` **only if the session has no pid**, then sets the global `$pid = PatientSessionUtil::getPid()` (int, 0 if unset).
2. **Patient switch** (`:84-94`) if `set_pid` is present. This writes the session, the audit log and the recent-patients list. No authorization runs first.
3. **CDR side work** (`:105-134`): allergy/medication conflict check, which writes `clinical_rules_log`. On a new-patient load it also runs the active-reminder and all-allergy checks.
4. **Data loads** (`:307-363`): deceased status, vitals registry flag, `patient_data`, employer, primary insurance.
5. **`OemrUI` construction** (`:365-377`): the heading "Medical Record Dashboard - <name>".
6. **`<head>` emission** (`:379-1049`): assets, inline JS, inline CSS. The JS embeds the CSRF token, the pid and, when `set_pid` is present, the patient's name, pubpid, DOB, age and full encounter list.
7. **`<body>` → `ViewEvent` + ACL** (`:1051-1056`): the handoff to part 2. If `patients/demo` fails, the page shows the "Not Authorized" partial and `exit()`s (`:1058-1061`). By then steps 2–6 have already run and been sent.
8. **Client side**: on DOM ready the page starts ~8 async fragment POSTs (`:544-871`). On `window.load` it calls `setMyPatient()` (`:969-971`) to sync the tabbed shell's identity bar and encounter dropdown.

The page is non-modal. Everything it opens goes into `dlgopen` iframes/windows (`library/dialog.js`, auto-loaded by `Header::setupHeader`, `config/config.yaml:159-162`).

## Layout / interface

Parameters this range reads:

| Input | Where | Effect |
|---|---|---|
| `GET set_pid` | `:84-86`, `:122`, `:918`, `:954` | Switches the session patient (`setpid`), touches recent list, triggers new-patient popups and shell identity sync |
| `GET set_encounterid` | `:90-93`, `:954-956` | If `>0`, writes `session.encounter` and (in shell) opens `encounter_top.php` in the `enc` tab. **Not checked against `set_pid`** |
| `GET pid` / `POST pid` | `globals.php:770-773`; `:74` (dead) | Seeds `session.pid` only when the session has none |

Inline JS functions (all in `<head>`), with who calls them:

| Function / binding | Lines | Called by |
|---|---|---|
| `referentialCdsClick(codetype, codevalue)` | 389-397 | `library/clinical_rules.php:115` (Clinical Reminders fragment markup) |
| `oldEvt(apptdate, eventid)` | 399-406 | `templates/patient/card/appointments*.html.twig` |
| `advdirconfigure()` | 408-410 | part 2, `:1713` |
| `refreshme()` | 412-415 | dialog `onClosed` callbacks (`:646`, `:758`), `editScripts` |
| `deleteme()` | 418-430 | **no caller** (its own `@todo` says so) |
| `imdeleted()` | 433-435 | `interface/patient_file/deleter.php:451-459` callback → `top.clearPatient()` |
| `newEvt()` | 437-445 | part 2, `:2007` |
| `toggleIndicator(target, div)` | 447-467 | **no caller** anywhere in the repo |
| `editScripts(url)` | 472-484 | part 2, `:1228` (Prescriptions pencil) |
| `fetchHtml(url, embedded, sessionRestore)` | 494-513 | `placeHtml` |
| `placeHtml(url, divId, embedded, sessionRestore)` | 528-535 | ready handler |
| `load_location(location)` (defined only if absent) | 537-542 | `stats.php`, `immunizations.html.twig`, `tp_il.html.twig`, part-2 card links |
| ready handler `$(function(){…})` | 544-871 | jQuery |
| `openReminderPopup()` (inner) | 832-846 | ready handler `:866`/`:869` |
| `updateUserVisibilitySetting(e)` | 882-912 | click on `[data-toggle="collapse"]`, bound after `stats.php` loads (`:606-610`) |
| `setMyPatient()` | 916-967 | `$(window).on('load')` (`:969-971`) |

Async fragments loaded by the ready handler. Every one is a `fetch` POST with
body `csrf_token_form=<token>`, `credentials: 'same-origin'`, and **no patient
id**. Each endpoint reads the patient from the session.

| Target div | URL | Extra params | Condition to emit | Line |
|---|---|---|---|---|
| `stats_div` | `stats.php` | `embeddedScreen=true` | always | 606 |
| `pnotes_ps_expand` | `pnotes_fragment.php` | — | always | 611 |
| (same, on "Completed") | `pnotes_fragment.php?docUpdateId=<id>` | — | click on `.complete_btn` | 613-624 |
| `disclosures_ps_expand` | `disc_fragment.php` | — | always | 626 |
| `labdata_ps_expand` | `labdata_fragment.php` | — | always | 627 |
| `track_anything_ps_expand` | `track_anything_fragment.php` | — | always | 628 |
| `vitals_ps_expand` | `vitals_fragment.php` | — | `$vitals_is_registered && aclCheckCore('patients','med')` | 629-632 |
| `clinical_reminders_ps_expand` | `clinical_reminders_fragment.php` | `embeddedScreen=true`; calls `top.restoreSession()` first | `enable_cdr && enable_cdr_crw` | 634-711 |
| `patient_reminders_ps_expand` | `patient_reminders_fragment.php` | calls `top.restoreSession()` first | `enable_cdr && enable_cdr_prw` | 714-716 |
| `<LBFxxx>_ps_expand` | `lbf_fragment.php?formname=<grp_form_id>` | jQuery `.load` POST `csrf_token_form` | one per repeating LBF group (`:721-732`) | 729 |
| (no div; sync XHR) | `../../soap_functions/soap_patientfullmedication.php`, `soap_allergy.php` | `patient=<pid>`, **no CSRF token** | `erx_enable` and `patient_data.soap_import_status IN ('1','3')` | 547-603 |
| (settings) | `../../../library/ajax/user_settings.php` | `csrf_token_form, target, mode` | card collapse click | 900-911 (and dead 453-465) |

`placeHtml` skips the fetch if the target div is missing (`:529-530`), so the
card shells rendered in part 2 decide which fragments are fetched. `.load()`
on an empty jQuery set also sends nothing. Locally, `enable_cdr`,
`enable_cdr_crw`, `enable_cdr_prw` and `enable_cdr_crp` are all `1`,
`erx_enable` is empty, and there are no repeating LBF groups (read-only SQL).

## State

```text
$srcdir, $webserver_root   // :32-33 from OEGlobalsBag (overwrites globals.php's $webserver_root)
$resNotNull = false        // :36 written via `global` by fetchNextXAppts() in part 2
$session                   // :71 active session wrapper
$pid                       // globals.php:776 (int); :73-75 fallback is dead; reassigned by setpid() via `global $pid`
$twig                      // :81 TwigContainer, used by part 2
$ptService, $newPatient    // :87-88 only for touchRecentPatientList
$encounter                 // :91, :955 local copies of set_encounterid
$smartLaunchController     // :99-100 registers RenderEvent listener (fires in part 2)
$hiddenCards               // :101 list of `globals.gl_value` rows for hide_dashboard_cards → part 2
$ed                        // :103 event dispatcher → part 2
$active_reminders          // :105/:124 HTML string|false, drives openReminderPopup
$all_allergy_alerts        // :106/:126 array|false, drives openReminderPopup
$new_allergy_alerts, $pod_warnings, $allergyWarningMessage // :111-118
$insurance_array           // :136 DEAD, never read (InsuranceViewCard recomputes it, src/Patient/Cards/InsuranceViewCard.php:85)
$deceased                  // :307 array{days_deceased,date_deceased}|false → part 2 :1333-1335
$tmp, $vitals_is_registered// :344-345 → JS :629 and part 2 :1507
$result                    // :349 patient_data row (+DOB_YMD) → JS :924-930, part 2 squad check :1069, DemographicsViewCard :1340, BillingViewCard :1343; clobbered at part 2 :1451
$result2                   // :351 employer row → DemographicsViewCard :1340
$result3                   // :352-359 primary insurance (copay, provider, effdate, effdate_end) → BillingViewCard :1343
$insco_name                // :360-363 → BillingViewCard :1343
$arrOeUiSettings, $oemr_ui // :365-377 → part 2 :1064, dashboard_header.php, :2059
$date_of_death, $result4, $rowresult4, $query_result // :919-962 JS-emission locals
$grparr, $FONTSIZE         // :1004-1008 CSS override
$viewEvent, $thisauth      // :1054-1056 boundary with part 2
```

**Globals / superglobals read:** `$_GET['set_pid']` (`:84,86,122,918,954`), `$_GET['set_encounterid']` (`:90-91,954-955`), `$_GET['pid']` (`:74`, dead; live in `globals.php:770`), session `pid`, `authUser`, `authUserID`, `alert_notify_pid`, `language_direction` (`:74,111,121,124,126,853,989`), `global $web_root` (in `image_widget`, `:313`, set at `globals.php:192-195`). `OEGlobalsBag` keys: `enable_cdr`, `enable_allergy_check`, `enable_alert_log`, `enable_cdr_crp`, `enable_cdr_crw`, `enable_cdr_prw`, `insurance_only_one`, `portal_onsite_two_enable`, `portal_onsite_two_address`, `enforce_signin_email`, `date_display_format`, `generate_doc_thumb`, `erx_enable`, `erx_import_status_message`, `patient_birthday_alert`, `right_justify_labels_demographics`, plus `getWebRoot()`/`getKernel()`/`getSrcDir()`/`getProjectDir()`. Indirectly: `age_display_format`, `age_display_limit` (`PatientService::getPatientAgeDisplay`, `src/Services/PatientService.php:718-730`), `recent_patient_count` (`touchRecentPatientList`).

**Globals / session written:** session `disablePreviousNameAdds=0` (`:79`, every load); session `pid` and possibly `encounter=0`, unset `therapy_group` (`setpid` → `PatientSessionUtil::setPid`, `src/Common/Session/PatientSessionUtil.php:44-81`); global `$pid`, `$encounter` (same, via `global`); session `encounter` (`:92`); session `alert_notify_pid` (`:129`, only when `enable_cdr`). Each `SessionUtil::setSession` call reopens the session for writing and logs key and value at debug level (`src/Common/Session/SessionUtil.php:103-118`).

## Logic

### Boot and includes (`:30-81`)

`globals.php` does authentication and the patient seed described above. The
requires (`lists.inc.php`, `patient.inc.php`, `options.inc.php`,
`history.inc.php`, `clinical_rules.php`, `group.inc.php`,
`appointments.inc.php`) define global functions and, for `lists.inc.php`, the
`$ISSUE_TYPES` global used by `stats.php`. `$resNotNull` is pre-declared
because part 2's `fetchNextXAppts()` writes it through `global` (`:34-36`).

`if (!isset($pid)) { $pid = $session->get('pid') ?? $_GET['pid'] ?? null; }`
(`:73-75`) is **dead**. `globals.php:776` always assigns `$pid` at file scope
before this line, so the `$_GET['pid']` fallback never runs. What actually
lets the dashboard run off the existing session patient is `globals.php`, not
this block. That corrects `ui/DASHBOARD-MAP.md` §2 step 3.

### `set_pid` / `set_encounterid` (`:84-94`)

If `set_pid` is present, the page calls `setpid($_GET['set_pid'])`
(`library/pid.inc.php:16-19`) → `PatientSessionUtil::setPid()`. That:

- `intval()`s the value. It logs a "Critical OpenEMR Error" if the value is non-numeric but still proceeds with `0`.
- Resets session `encounter` to 0 if the pid changes, and unsets `therapy_group`.
- Writes session `pid`, sets global `$pid`.
- Writes an audit `view` event for the new pid (`PatientSessionUtil.php:80`).

Then `PatientService::findByPid($pid)` (`src/Services/PatientService.php:655-666`)
loads the row into `$newPatient`. The result is **not** assigned to `$pid`,
which corrects DASHBOARD-MAP §2. `touchRecentPatientList($newPatient)`
(`PatientService.php:939-975`) rewrites `recent_patients` for the current
user.

*Quirk (source-derived, not run):* for a pid with no `patient_data` row
(e.g. `set_pid=99999` or `set_pid=abc` → 0), `QueryUtils::selectHelper`
returns `$results[0]` of an empty array → `null`
(`src/Common/Database/QueryUtils.php:342-344`).
`touchRecentPatientList(array $patient)` then throws a `TypeError`, but only
**after** the session has been switched and the audit row written.

`set_encounterid > 0` is written straight to session `encounter` (`:90-93`).
Nothing checks that the encounter belongs to `set_pid`. The shell branch at
`:954-964` also looks up `form_encounter` by `encounter` alone (`:956`).

**No authorization of any kind precedes this block.** The only gates are
"logged in" (`auth.inc.php`) and a valid session. The per-patient check
(squads) and the role check (`patients/demo`) come later, at `:1056` and
`:1069`, after the switch, audit and recent-list writes.

### SMART launch, hidden cards, dispatcher (`:99-103`)

`SMARTLaunchController::registerContextEvents()`
(`src/FHIR/SMART/SmartLaunchController.php:47-50`) registers a listener for
`RenderEvent::EVENT_SECTION_LIST_RENDER_AFTER`, which fires in part 2.
`getHiddenDashboardCards()` (`:138-147`) reads every `globals` row named
`hide_dashboard_cards` into `$hiddenCards`.

### CDR allergy and reminder checks (`:105-134`)

Only when `enable_cdr` is set (on locally):

- **Every load**, if `enable_allergy_check && enable_alert_log`: `allergy_conflict($pid, 'new', authUser)` (`library/clinical_rules.php:309-384`). It matches active allergy titles against active medication titles and active prescription `drug` names, **by exact string**. It then calls `compare_log_alerts(..., 'allergy_alert', ..., 'new')` (`clinical_rules.php:398+`), which **inserts a `clinical_rules_log` row** when there are new conflicts. So a GET page load writes the database, before the ACL check.
- It builds `alert(<"WARNING - FOLLOWING ACTIVE MEDICATIONS ARE ALLERGIES"> + "\n" + <pod_warnings>)`, where each conflict appends `js_escape(title) . ' + "\n"'` (`:115`). With **two or more** conflicts the emitted JS is `"A" + "\n""B" + "\n"`: two adjacent string literals, a `SyntaxError`, so **no alert shows**. The conflicts are already logged, so they stop being "new" and this alert never fires for them again for this user.
- The `<script>` is echoed at `:131-133`, **before `<!DOCTYPE html>`** (`:379`), which puts the page into quirks mode whenever it fires.
- If this is a new patient for the popup (`alert_notify_pid` ≠ `$pid`) **and** `set_pid` is present **and** `enable_cdr_crp` is set: `active_alert_summary($pid,'reminders-due',…,true)` runs the whole CDR engine (`test_rules_clinic`) synchronously. `allergy_conflict($pid,'all',…,true)` also runs if allergy checking is on. Both run in test mode, with no log writes. They set `$active_reminders`/`$all_allergy_alerts`, which trigger `openReminderPopup()` in JS.
- `alert_notify_pid` is set to `$pid` on every load (`:129`).

### Helpers (`:138-305`, `:311-341`)

| Function | Behavior | Consumer |
|---|---|---|
| `getHiddenDashboardCards()` | `SELECT gl_value FROM globals WHERE gl_name='hide_dashboard_cards'` | `:101` |
| `print_as_money($money)` | formats "$ 1,234.56" | **dead**: no caller in repo |
| `pic_array($pid, $cat)` | document ids in a category `LIKE ?`, `documents.deleted = 0` | part 2 `:1640` |
| `get_document_by_catg($pid, $cat, $limit)` | document ids in a category `LIKE ?`, `ORDER BY d.date DESC LIMIT n`. **No `deleted = 0` filter**, unlike `pic_array` | part 2 `:1086` (patient ID card) |
| `isPortalEnabled()`, `isPortalSiteAddressValid()`, `isPortalAllowed($pid)`, `isApiAllowed($pid)`, `areCredentialsCreated($pid)`, `isContactEmail($pid)`, `isEnforceSigninEmailPortal()` | globals or `patient_data`/`patient_access_onsite` lookups | **`src/Patient/Cards/PortalCard.php:85-92`**. A PSR-4 class calls global functions that exist only because `demographics.php` defined them |
| `deceasedDays($row)` | "Deceased - <date> (<Today / 1 day ago / N days ago / ~N months ago / More than N years ago>)". Uses the raw first 10 chars when `date_display_format < 1` and the value is longer than 10 chars, otherwise `oeFormatShortDate` | part 2 `:1335` → `patient/partials/deceased.html.twig` |
| `image_widget($doc_id, $cat)` | echoes a `<table>` with a thumbnail link (`.image_modal`) for image extensions, else a "View" button; uses `controller.php?document&retrieve` | `src/Common/Twig/TwigExtension.php:184-190` (`imageWidget` Twig function) ← `templates/patient/card/photo.html.twig:7,14`. Another `src/` → global-function dependency |

`$deceased = is_patient_deceased($pid)` (`:307`; `library/patient.inc.php:1643-1668`)
returns `false`, or `{days_deceased, date_deceased}` when `deceased_date` is
non-empty and `<=` now. The helper tries to turn 0 days into 1 with
`=== 0` (`patient.inc.php:1662`). Whether that ever matches depends on
whether the DB layer returns ints or strings, which decides whether
`deceasedDays` can print "Today" (open question).

### Data loads (`:343-363`)

- `registry` count for `vitals` (`:344`).
- `getPatientData($pid, "*, DATE_FORMAT(DOB,'%Y-%m-%d') as DOB_YMD")` (`library/patient.inc.php:68-72`, `patient_data … ORDER BY date DESC LIMIT 1`).
- `getEmployerData` (→ `EmployerService::getMostRecentEmployerData`).
- `getInsuranceData($pid,'primary', …)` (`insurance_data` join `insurance_companies`), plus `getInsuranceProvider` (`insurance_companies.name`).

With `$pid = 0` (no session patient and no `set_pid`), these return empty and
part 2 reads `$result['squad']` off an empty result (warnings). The heading
becomes "Medical Record Dashboard - " (`getPatientFullNameAsString` returns
`''` for empty pid, `library/patient.inc.php:869-873`).

### `OemrUI` (`:365-377`)

`heading_title = xl('Medical Record Dashboard')`,
`include_patient_name = true`. `OemrUI::__construct`
(`src/OeUI/OemrUI.php:87`) builds
`"Medical Record Dashboard - " . getPatientFullNameAsString(session pid)`,
that is `fname [mname] lname [suffix]` (`patient.inc.php:881-893`). The help
file is `medical_dashboard_help.php` and the expandable file is
`demographics_xpd`.

### `<head>`: assets and inline CSS (`:382-386`, `:974-1048`)

`Header::setupHeader(['common','utility'])` loads `library/js/common.js`
(`tabbify`) and `utility.js`, plus autoloaded `dialog.js`, jQuery, Bootstrap
and the theme. `options.js.php` (391 lines, LBF/skip-condition/age helpers)
is inlined. The CSS sets card shadow, radius and background overrides, an
optional right-justified label style
(`right_justify_labels_demographics` + LTR), and optional `#DEM` font sizes
from `getLayoutProperties('DEM', …, 'grp_size')` (`:1004-1028`). The
`<title>` is `xlt("Dashboard{{patient file}}")`, which renders as
"Dashboard".

### `fetchHtml` / `placeHtml` (`:494-535`)

`fetchHtml` is `async`. With `sessionRestore === true` it calls
`top.restoreSession()` **before** building the request (`:495-498`), then
POSTs `csrf_token_form` (+ `embeddedScreen=true` if `embedded`) and returns
`response.text()`. There is **no `response.ok` check**, so a 403/500 or CSRF
failure body is injected into the card as if it were content. There is also
no `catch`. `placeHtml` assigns `contentDiv.innerHTML = fragment`, so
`<script>` tags in a fragment do not run (only `stats.php` contains one).

**E-08 explained, and it does break things.** In the tabbed shell,
`top.restoreSession` is defined by `library/restoreSession.php:44-72`,
included only by `interface/main/tabs/main.php:115`. When `restore_sessions`
is on, it rewrites the session cookie if another window changed it. Opened
top-level, `top === window` has no such function. The call throws inside the
`async` function **before `fetch` is reached**, so the promise rejects
("Uncaught (in promise) TypeError") and **no request is sent**. The other
placeHtml calls are unaffected. The two call sites with
`sessionRestore=true` are `clinical_reminders_fragment.php` (`:635`) and
`patient_reminders_fragment.php` (`:715`). Result outside the shell: the
**Clinical Reminders card spins forever** (seen in
`probe/results/claude-laptop-seeded/screens/dashboard-13-full.png`: an
expanded "Clinical Reminders" card with only the spinner). Patient Reminders
is collapsed by default in that shot, so it was not visible, but it has the
same cause. Its `.then()` bindings (`.medium_modal`,
`.cdr-rule-btn-info-launch`) are never attached either. This also fits the
probe's "0 failed requests": the fetch was never issued.

### Ready handler (`:544-871`)

In order:

1. **eRx import** (`:547-603`, only if `erx_enable` and the patient's `soap_import_status` is 1 or 3). It calls `top.restoreSession()` **synchronously** (`:550`), then makes two **synchronous** (`async:false`) jQuery POSTs to the SOAP import endpoints with `patient=<pid>` and **no CSRF token**. It reloads the page if anything was imported and may `alert()` the messages. Outside the shell, the throw at `:550` is synchronous in the ready handler, so it **aborts the entire rest of the handler**: every `placeHtml`, `tabbify`, all modal bindings and popups. That path is off locally (`erx_enable` empty). The target `interface/soap_functions/soap_patientfullmedication.php:31-73` itself has no CSRF check and no ACL check, and takes the patient id from `$_REQUEST`.
2. **Fragment loads** (`:606-716`, table above). `stats.php`'s `.then` binds `updateUserVisibilitySetting` to **every** `[data-toggle="collapse"]` on the page (`:607-609`). So collapse persistence for *all* cards depends on `stats.php` succeeding, and clicks before it resolves are not saved. The pnotes `.then` adds a delegated `.complete_btn` handler on `document` (`this` inside the arrow is the ready handler's `document`). It POSTs `pnotes_fragment.php?docUpdateId=<id>` with the CSRF token, then reloads the card. There is **no confirmation** (B-13). `pnotes_fragment.php:34-36` runs `disappearPnote` (IDOR-guarded by session pid, `library/pnotes.inc.php:493-504`) **before** its `patients/notes` ACL check at `:45`.
3. **Clinical Reminders `.then`** (`:635-710`): `.medium_modal` opens an 800×200 iframe dialog that refreshes on close. `.cdr-rule-btn-info-launch` opens `super/rules/index.php?action=review!view&csrf_token_form=<token>&pid=&rule_id=` (**CSRF token in a GET URL**, `:658-664`; the web root is echoed unescaped into a JS string, `:664`). It listens for a `postMessage` of type `cdr-edit-source` from the same origin, then calls `window.parent.left_nav.loadFrame('adm','adm0', '/super/rules/index.php?action=edit!summary&csrf_token=…')` (shell-only). The listener reads the implicit global `event` and `console.log`s every message (`:670-671`).
4. **LBF fragments** (`:721-732`): jQuery `.load` per repeating LBF group.
5. `tabbify()` (`library/js/common.js:1`).
6. **Modal bindings** (`:736-830`), direct rather than delegated, bound once at ready, so markup that arrives later in async fragments is not bound:
   - `.large_modal` (1000×600) and `.rx_modal` ("Amendments", 800×300): **no element in the repo carries these classes** (repo-wide grep), so both are dead.
   - `.image_modal` (400×300): from `image_widget`.
   - `.deleter` (600×360): `templates/patient/partials/delete.html.twig:11`.
   - `.iframe1` (350×300): `erx.html.twig`.
   - `.small_modal` (550×550): `portal.html.twig`.
7. **Popups** (`:848-870`). If `patient_birthday_alert` is set (it is locally) and `BirthdayReminder::isDisplayBirthdayAlert()`, it opens `#birthday_popup`'s href (`../birthday_alert/birthday_pop.php?pid=&user_id=`, markup at part 2 `:1066`). Otherwise, if `$active_reminders || $all_allergy_alerts`, it calls `openReminderPopup()` → `top.restoreSession()` (`:833`, not guarded) → `dlgopen` of `#reminder_popup_link` (`../reminder/active_reminder_popup.php`, part 2 `:1065`). Outside the shell that is a third `restoreSession` TypeError and no popup. The probes logged only two, so pid 13 had no due reminders at probe time (inference).

### `updateUserVisibilitySetting` (`:882-912`)

It toggles the icon between `fa-expand` and `fa-compress`, then POSTs
`user_settings.php` with `target=<card id>` and
`mode = (target is .show) ? 0 : 1`. It calls `top.restoreSession()` first
(`:904`), so **outside the shell collapse state is never saved**. Server side,
`library/ajax/user_settings.php:22-28` checks CSRF and only accepts targets
ending in `_expand`. Part 2 reads the value back with `getUserSetting(id) == 0`
→ collapsed.

### `setMyPatient` (`:916-967`) and E-09

The PHP emits this function's body. With `set_pid`, it calls
`parent.left_nav.setPatient(pname, pid, pubpid, '', str_dob)` (`:924-930`)
where:

- `pname = fname + " " + lname` (no middle name or suffix, unlike the heading).
- `str_dob = " DOB: <oeFormatShortDate(DOB_YMD)> Age: <getPatientAgeDisplay(DOB_YMD)>"`, or for a deceased patient `" … Age at death: <oeFormatAge(DOB_YMD, deceased_date)>"`.

It then embeds **every** encounter for the patient
(`form_encounter` LEFT JOIN `openemr_postcalendar_categories`,
`ORDER BY fe.date DESC`, `:937-947`) and calls
`parent.left_nav.setPatientEncounter(ids, dates, categories)`. **Without the
`set_pid` guard**, it also calls `parent.left_nav.syncRadios()` (`:953`),
which is a no-op in the shell (`frame_proxies.js:126-129`). With
`set_pid` + `set_encounterid`, it calls `left_nav.setEncounter(…)`,
`top.restoreSession()` and
`left_nav.loadFrame('enc2','enc','patient_file/encounter/encounter_top.php?pid=&set_encounter=')`.

In the shell, `frame_proxies.js:27-54` replaces the Knockout patient model
(identity bar: picture via `controller.php?document&retrieve&document_id=-1&context=patient_picture`,
name, "(pubpid)", `str_dob`; `patient_data_template.php:95-116`). It
retitles the window and navigates the `enc` tab to `encounters.php`.

**E-09 explained.** Opened top-level, `parent === window` and
`window.left_nav` is undefined, so the first `parent.left_nav.*` access
throws inside the `load` handler. Every later statement in `setMyPatient` is
shell sync, so **nothing visible on the page breaks**. Correction to
DASHBOARD-MAP §7: the error happens **with or without** `set_pid`. Without
it, the message reads `reading 'syncRadios'` instead of `'setPatient'`.
Correction to `api/AUTH-AND-PATIENT.md` §2.4: the `restoreSession` errors
come from `fetchHtml`, not from the `setPatient` call.

Timing: `setMyPatient` runs on `window.load`, after every synchronous
resource. In the shell, the identity bar keeps showing the **previous**
patient for the whole 3–5 s load (RECON load times), while the frame already
shows the new patient's heading and cards.

### Boundary (`:1051-1056`)

`new ViewEvent($pid)` is dispatched. `ViewEvent::authorized()` defaults to
`true`, so only a module can veto. `$thisauth = aclCheckCore('patients','demo')`
comes next. Everything above has already run and been flushed into the
response: session switch, audit, recent list, CDR log, identity, encounters,
CSRF token.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| Reach the page at all | yes | `auth.inc.php` via `globals.php:725-728` | login and idle timeout only; every fragment POST also resets idle (no `skip_timeout_reset`) |
| Switch session patient (`set_pid`) | **missing** | — | runs at `:84-94`, before `patients/demo` (`:1056`) and squads (`:1069`) |
| Set session encounter (`set_encounterid`) | **missing** (and not tied to pid) | — | `:90-93`, `:956` |
| Audit / recent-list writes | **missing** | — | happen for users who then get "Not Authorized" |
| CDR allergy check + `clinical_rules_log` write | **missing** | — | `:109-118` every load |
| Emit name/pubpid/DOB/age/encounter list into `<head>` JS | **missing** | — | `:916-949`, before `:1056`; unauthorized users receive it in page source |
| Emit CSRF token and pid | **missing** | — | `:420-421,456,464,501,616,656,730,901` before `:1056` |
| Vitals fragment emission | yes (client-emit only) | `aclCheckCore('patients','med')` `:629` | the endpoint itself has no ACL (`vitals_fragment.php:15-21`) |
| Labs / Disclosures / Track-anything / Stats / Notes emission | **missing here** | — (div presence only) | endpoints: `labdata_fragment.php` and `track_anything_fragment.php` **no ACL**; `disc_fragment.php` only a write-ACL for the add link (`:94`); `stats.php` per-issue ACL (`:150`); `pnotes_fragment.php` read ACL `:45` |
| Clinical / Patient reminders | global flags only | `enable_cdr*` | endpoints **no ACL** (`clinical_reminders_fragment.php`, `patient_reminders_fragment.php`) |
| eRx SOAP import | **missing** | — | no CSRF, no ACL at either end |
| Collapse-state write | CSRF only | `user_settings.php:22` | per-user setting; fine |
| Page view | yes | `aclCheckCore('patients','demo')` + `ViewEvent` `:1056-1061` | after everything above |

CSRF on state-changing paths in this range: `set_pid`/`set_encounterid` are
GET with no token. That is mitigated for cross-site use by the core session
cookie's `SameSite=Strict` (`src/Common/Session/SessionConfigurationBuilder.php:25`,
`SessionUtil.php:18`), so any same-site link or embedded resource still
switches the patient. The page load's `clinical_rules_log` write is GET with
no token. Fragment POSTs and `user_settings` carry the token. The SOAP import
POSTs do not.

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| session (`pid`, `encounter`, `therapy_group`, `disablePreviousNameAdds`, `alert_notify_pid`) | yes | yes | `:74,79,86,92,121,129` | no |
| audit log (`EventAuditLogger` "view") | | yes | `PatientSessionUtil::setPid:80` | no |
| `patient_data` | yes | | `findByPid :88`, `getPatientData :349`, `is_patient_deceased :307,:919`, portal helpers, soap status `:548` | — |
| `recent_patients`, `list_options` (`recent_patient_columns`) | yes | yes (`recent_patients` upsert) | `touchRecentPatientList :89` | no |
| `lists` (allergy, medication), `prescriptions` | yes | | `allergy_conflict :111,:126` | — |
| `clinical_rules_log` | yes | yes (new allergy conflicts) | `compare_log_alerts` via `:111` | no |
| CDR rule tables (`clinical_rules`, etc.) | yes | | `active_alert_summary :124` | — |
| `globals` (`hide_dashboard_cards`) | yes | | `:141` | — |
| `documents`, `categories`, `categories_to_documents` | yes | | `pic_array`, `get_document_by_catg`, `image_widget` (`Document`) | — |
| `patient_access_onsite` | yes | | `areCredentialsCreated` | — |
| `registry` | yes | | `:344` | — |
| `employer_data`, `insurance_data`, `insurance_companies` | yes | | `:351-363` | — |
| `form_encounter`, `openemr_postcalendar_categories` | yes | | `:937-938`, `:956` | — |
| `layout_group_properties` | yes | | `:721-727`, `getLayoutProperties :1005` | — |
| birthday reminder tables | yes | | `BirthdayReminder::isDisplayBirthdayAlert :853-854` | — |

## Cross-links

- **Opened by:** Finder / recent patients / any `demographics.php?set_pid=N` link; the tabbed shell's `pat` tab (`frame_proxies.js` `RTop`); `interface/main/main_screen.php:480`, billing/collections/encounters reports (`set_encounterid`).
- **Opens:** `../education.php`, `add_edit_event.php`, `advancedirectives.php`, `../deleter.php`, `controller.php?prescription&list`, `super/rules/index.php`, `active_reminder_popup.php`, `birthday_pop.php`, `encounter_top.php` (shell).
- **Calls into:** `setpid`/`PatientSessionUtil::setPid`, `PatientService::findByPid`/`touchRecentPatientList`, `allergy_conflict`/`active_alert_summary`/`compare_log_alerts` (`library/clinical_rules.php`), `is_patient_deceased`, `getPatientData`/`getEmployerData`/`getInsuranceData`, `OemrUI`, `SMARTLaunchController`, `CsrfUtils::collectCsrfToken`, `BirthdayReminder`.
- **Consumed by part 2 (lines 1056–end):** `$pid`, `$result` (squad check `:1069`, Demographics/Billing cards), `$result2`, `$result3`, `$insco_name`, `$deceased` + `deceasedDays()`, `$hiddenCards`, `$vitals_is_registered`, `$ed`, `$twig`, `$oemr_ui`, `$resNotNull`, `pic_array()`, `get_document_by_catg()`. Also the JS functions `editScripts`, `advdirconfigure`, `newEvt`, `oldEvt`, `load_location`, `refreshme`, and the div ids the fragments fill. Part 2's hidden anchors `#reminder_popup_link` / `#birthday_popup` (`:1065-1066`) are consumed by this range's popup code.
- **Consumed by `src/`:** `PortalCard` → the seven portal helpers; `TwigExtension::imageWidget` → `image_widget()`.
- **Shell side:** `interface/main/tabs/js/frame_proxies.js`, `patient_data_view_model.js`, `templates/patient_data_template.php`, `library/restoreSession.php`.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Security | High (verified) | Patient identity (name, pubpid, DOB, age or age at death) and the full encounter list (ids, dates, categories) are written into `<head>` JS before the `patients/demo` check. A user who then sees "Not Authorized" already has them in page source, along with the CSRF token | `setMyPatient` (`demographics.php:916-949`) vs ACL `:1056` | Authorize before any patient read or emission |
| 2 | Security | High (verified) | `set_pid` switches the session patient, writes an audit "view" and the recent-patients list, and runs the CDR checks with no authorization. The squad check (`:1069`) comes after and does not undo the switch. Later session-scoped fragment calls then serve that patient | `:84-94`, `PatientSessionUtil.php:44-81`, `:1069` | Authorize (role and squad) before `setpid`; port reads patient by explicit id under OAuth scope |
| 3 | Security | High (verified) | The dashboard's ACL gating of Vitals/Labs/Track/Reminders is presentation-only. The endpoints it calls have no ACL, only CSRF (a per-session token any logged-in user has), and read the session patient | `:626-631,635,715`; `vitals_fragment.php:15-21`, `labdata_fragment.php:17-22`, `track_anything_fragment.php:19-21`, `clinical_reminders_fragment.php:22-24`, `patient_reminders_fragment.php:21-23` | Enforce ACL in each endpoint; port uses API routes that enforce ACL and scope |
| 4 | Bug (patient safety) | High (verified) | With two or more new allergy/medication conflicts, the warning `alert()` is a JS `SyntaxError` (missing `+` between entries) and never shows. The conflicts are already logged as seen, so this alert does not fire again for them | `:111-118`, `library/clinical_rules.php:363-369,398+` | Build the list server-side as one JSON array; log only after display |
| 5 | Bug (patient context) | High (verified code path; race not reproduced) | Every async card fetch (and the notes "Completed" reload) carries no patient id and uses whatever `session.pid` is at fetch time. If another window or tab switches patient between render and fetch (3–5 s loads), cards for patient B render under patient A's heading | `fetchHtml :494-513`, fragment `$pid = $session->get('pid')`; `setpid` in any other page | Pass and verify an explicit patient id per request; port keys every call by patient uuid |
| 6 | Bug | Medium | Outside the shell, `top.restoreSession()` throws before `fetch`, so the Clinical Reminders and Patient Reminders cards spin forever and collapse state is never saved (E-08 is functional, not cosmetic). Observed in the seeded screenshot | `:495-498,635,715,904`; `probe/results/claude-laptop-seeded/screens/dashboard-13-full.png` | Guard with `typeof top.restoreSession === 'function'` as `dialog.js:184` does |
| 7 | Bug / Security | Medium | eRx path: a synchronous `top.restoreSession()` in the ready handler aborts all later dashboard JS outside the shell. It makes synchronous XHR, and the POSTs to the SOAP import endpoints carry no CSRF token (the endpoints check neither CSRF nor ACL and take the patient from `$_REQUEST`) | `:547-603`; `interface/soap_functions/soap_patientfullmedication.php:31-73` | Guard restoreSession; add CSRF and ACL to the endpoints; make async |
| 8 | Bug | Medium | `set_pid` for a non-existent or non-numeric pid switches the session and audits, then `touchRecentPatientList(null)` throws a `TypeError` (source-derived, not run) | `:86-89`; `QueryUtils.php:342-344`; `PatientService.php:939` | Validate the patient exists before switching |
| 9 | Bug (integrity) | Medium | `set_encounterid` is stored to the session without checking it belongs to `set_pid`, and the shell branch loads it | `:90-93,954-964` | Verify `form_encounter.pid` |
| 10 | Bug (patient context) | Medium | The shell identity bar updates only on `window.load`, so during a 3–5 s load it names the previous patient while the frame shows the new one | `:969-971`, `frame_proxies.js:27-54` | Port: set identity before clinical data renders |
| 11 | Smell | Medium | `fetchHtml` has no `response.ok` check and no `catch`. Error or CSRF-failure bodies render as card content, rejections leave spinners, and there is no error state | `:507-512`, `:531-533` | Port: explicit loading, error and empty states per card |
| 12 | Security | Medium | "Completed" on a note changes data with one click (B-13). The endpoint runs `disappearPnote` before its `patients/notes` ACL check | `:613-624`; `pnotes_fragment.php:34-36` vs `:45` | ACL before the write; confirm step |
| 13 | Security | Low | `set_pid` / `set_encounterid` change state on GET with no CSRF token; cross-site is mitigated by `SameSite=Strict`, same-site links are not | `:84-94`; `SessionConfigurationBuilder.php:25` | POST + token for context switches |
| 14 | Bug | Low | The allergy `<script>` is echoed before `<!DOCTYPE html>`, which forces quirks mode when it fires | `:131-133` vs `:379` | Emit inside `<head>` |
| 15 | Smell | Low | CDR engine (`active_alert_summary` → `test_rules_clinic`) runs synchronously before first byte on new-patient loads, and again in the Clinical Reminders fragment | `:122-128`; `clinical_reminders_fragment.php:24` | Measure; defer |
| 16 | Bug | Low | `get_document_by_catg` does not exclude deleted documents (unlike `pic_array`), so a deleted ID-card document can still show | `:189-195` vs `:172` | Add `deleted = 0` |
| 17 | Bug | Low | `oeFormatAge` (age at death, under 2 years) precedence bug yields "5months" with no space; living age uses `>24` months but deceased uses `>=24`, and living under-2 shows singular "N month" | `:929`; `library/formatting.inc.php:243-252`; `PatientService.php:768-777` | Port: one age formatter |
| 18 | Dead code | Low | `print_as_money`, `$insurance_array`, `toggleIndicator`, `deleteme`, `.large_modal` and `.rx_modal` handlers, and the `!isset($pid)` fallback are all unused | `:149-163,136,447-467,418-430,736-765,73-75` | Delete |
| 19 | Smell | Low | `src/` classes depend on global functions defined only in this page (`PortalCard` → portal helpers; `TwigExtension::imageWidget` → `image_widget`) | `PortalCard.php:85-92`; `TwigExtension.php:184-190` | Move into services |
| 20 | Security | Low | CSRF token in GET URLs (`deleteme`, dead; CDR rule-review launch); web root echoed unescaped into JS | `:419-423,658-664` | POST or header; `js_escape` |
| 21 | Smell | Low | The `message` listener uses the implicit global `event` and logs every cross-frame message to the console | `:670-671` | Use the handler parameter; drop the log |
| 22 | Smell | Low | Modal bindings are direct, not delegated, and bound before async fragments arrive; collapse persistence is bound only after `stats.php` resolves, and only to toggles present then | `:606-610,736-830` | Delegate |
| 23 | Smell | Low | `SessionUtil::setSession` debug-logs session keys and values (pid) on every write | `SessionUtil.php:115-118` via `:79,92,129` | Drop values from log context |

## Port notes

- **Must survive:**
  - The page loads for exactly one patient chosen by the user, and the patient's identity is visible before any clinical data. The heading format is "Medical Record Dashboard - <fname [mname] lname [suffix]>". The shell adds "(pubpid)" and " DOB: <date> Age: <age>" / "Age at death".
  - The deceased banner text and buckets from `deceasedDays`.
  - Per-user, per-card collapse memory (`<card>_expand`, 0 = collapsed).
  - `hide_dashboard_cards` admin hiding.
  - The allergy/medication conflict warning. Its intent is patient safety; the current implementation is broken, see #4.
  - The cards-open-by-default rule when no setting exists.
- **Must not survive:**
  - Patient context held in server session and switched by GET.
  - Authorization after data load and emission.
  - Fragment endpoints without ACL.
  - The frame coupling (`top.restoreSession`, `parent.left_nav`).
  - Unchecked `fetch` with endless spinners.
  - The allergy alert string-concatenation.
  - The page load writing `clinical_rules_log`.
  - Global functions consumed by `src/`.
- **Open questions:**
  - Does `is_patient_deceased` ever return int `0` (can "Today" print, or does it always read "1 day ago")? That depends on the DB layer's return types.
  - Is `hide_dashboard_cards` / `num_of_messages_displayed` / `age_display_format` reachable via any API? (Globals endpoint not traced.) If not, the SPA needs its own config.
  - The CDR "new conflict" semantics (`clinical_rules_log`) and active-reminder popups have no API. Are they in scope for DB-03..DB-06 parity, or explicitly dropped?
  - How much of B-02's 3–5 s is the synchronous CDR work in this range? It needs a server-timing measurement.
  - Does the shell identity bar (not the frame heading) count as the DB-02 "header" for parity? It is the only place pubpid, DOB and age appear without expanding Demographics.

## Parity spec for the port

This range owns page-level behavior (DB-02 identity and the patient-context
contract), not individual cards.

| Element | Legacy behavior (exact) | API source | Gap |
|---|---|---|---|
| Document title | "Dashboard" (`xlt("Dashboard{{patient file}}")`, `:1048`) | n/a | — |
| Page heading | "Medical Record Dashboard - " + `fname` [+ " " + `mname`] + " " + `lname` [+ " " + `suffix`] (`OemrUI.php:87`, `patient.inc.php:881-893`); blank name when no patient | FHIR `Patient.name` given[0]/given[1]/family (suffix not listed in the mapper excerpt); REST `fname`,`mname`,`lname`,`suffix` (api/AUTH-AND-PATIENT.md §2.3, "Name" row) | verify `suffix` in FHIR mapper |
| Shell identity: name | `fname + " " + lname` (`:924`) | same as above | — |
| Shell identity: MRN | "(" + `pubpid` + ")" (`patient_data_template.php:99-100`) | FHIR `Patient.identifier` type `PT`; REST `pubpid` (AUTH-AND-PATIENT §2.3, MRN row) | — |
| Shell identity: DOB/age | `" DOB: " + oeFormatShortDate(DOB) + " Age: " + age` (`:927`). Date format per `date_display_format` (0 → `YYYY-MM-DD`, local value 0). Age per `age_display_format` (local 0): whole years if >24 months, else "`N` month". Format 1: "#y #m #d" when age ≤ `age_display_limit` (local 3) | FHIR `Patient.birthDate`; REST `DOB` (AUTH-AND-PATIENT §2.3, DOB row); age computed client-side | age/date settings: not available via API (open question) |
| Shell identity: deceased | `" DOB: … Age at death: " + oeFormatAge(DOB, deceased_date)` (`:929`) | FHIR `Patient.deceasedDateTime` (AUTH-AND-PATIENT §2.3, Active-status row) | — |
| Deceased banner (rendered in part 2) | "Deceased - `<date>` (`Today` \| `1 day ago` \| `N days ago` (2–89) \| `~N months ago` (90–730, N = round(d/30)) \| `More than N years ago` (≥731, N = round(d/365)))" (`:282-305`) | FHIR `Patient.deceasedDateTime` | — |
| Patient picture (shell) | `controller.php?document&retrieve&patient_id=<pid>&document_id=-1&context=patient_picture`, fallback `patient-picture-default.png` | not traced (FHIR `DocumentReference`/`Media` listed in metadata) | not verified via API |
| Encounter dropdown (shell) | all encounters, `ORDER BY date DESC`, each: id, short date, translated category name (`:937-947`) | `GET /api/patient/:puuid/encounter` (`apis/routes/_rest_routes_standard.inc.php:105`) or `GET /fhir/Encounter` (`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:297`) | field mapping not in api/ docs |
| Card collapse memory | per user, key `<card>_expand`, `0` = collapsed, default expanded | none | **not available via API** (browser storage only) |
| Hidden cards | `globals` rows `hide_dashboard_cards` = card ids (`card_allergies`, …) | none traced | **not available via API** (open question) |
| Loading state (async cards) | spinner, sr-only "Loading..." (`templates/patient/card/loader.html.twig:4-7`) | — | — |
| Error state (async cards) | **none**: raw error body injected, or permanent spinner | — | port must define one (deliberate deviation) |
| Unauthorized | "Medical Dashboard Not Authorized" (`core/unauthorized-partial.html.twig`, `pageTitle = xl("Medical Dashboard")`, `:1059`) | API returns 401/403 per route (AUTH-AND-PATIENT §3.1) | port shows this string on 403 from `/fhir/Patient/:id` |
| Allergy/med conflict alert | "WARNING - FOLLOWING ACTIVE MEDICATIONS ARE ALLERGIES" + one title per line; exact-title match of active allergies (`lists` allergy, activity 1, no/future enddate) against active medications (same filter) and `prescriptions.active=1` `drug` | FHIR `AllergyIntolerance`, `MedicationRequest` (api/CLINICAL-CARDS.md DB-03, DB-05/06) | "new since last shown" (`clinical_rules_log`) **not available via API** |
| Messages card count (for the part-2/fragment owner) | loader passes no filter. `getPnotesByDate` counts "active" as `activity=1 AND message_status != 'Done' AND deleted != 1 AND pid != user`, limit `num_of_messages_displayed` (local 3). That explains the seeded "2 of 3" (note id 3 is `activity=1`, `Done`) | none (api/CLINICAL-CARDS.md DB-08: no read API) | **not available via API** |
