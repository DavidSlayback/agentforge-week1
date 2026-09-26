# Patient identity header — persistent identity bar

The dashboard has no single "header" file that draws the persistent identity
bar the brief asks about. What actually renders it is split across three
places, and the split matters for the port because two of them produce
**different name strings for the same patient at the same moment**:

1. `interface/patient_file/summary/dashboard_header.php` — a 30-line PHP
   include inside the `demographics.php` iframe. It renders only a page
   *title* string ("Medical Record Dashboard - `<name>`"), not an identity
   bar with discrete fields.
2. `interface/patient_file/summary/demographics.php` (the `setMyPatient()`
   JS block, ~lines 916-967) — pushes name/pid/pubpid/DOB+age into the
   **shell's** identity bar via `parent.left_nav.setPatient(...)`, once per
   page load that carries `set_pid`.
3. `interface/main/tabs/main.php` (the tabbed shell) + `frame_proxies.js`
   `left_nav.setPatient` + the Knockout template `patient-data-template`
   (`interface/main/tabs/templates/patient_data_template.php`) — this is
   the actual **persistent** bar: a `<div id="attendantData">` that lives in
   the shell's own DOM (`main.php:522`), outside the `mainFrames_div` iframe
   container, so it survives iframe navigation between dashboard, encounter,
   and other patient-scoped pages. This is the DB-02 unit.

**Source:**
- `interface/patient_file/summary/dashboard_header.php` — 36 lines
- `interface/main/tabs/main.php` — 577 lines (relevant: 398-401, 522)
- `interface/main/tabs/js/frame_proxies.js` — 146 lines (relevant: 21-54)
- `interface/main/tabs/templates/patient_data_template.php` — 251 lines
- `interface/main/tabs/js/patient_data_view_model.js` — 61 lines
- `interface/patient_file/summary/demographics.php` — relevant: 270-307
  (deceased/name plumbing), 916-967 (`setMyPatient()`), 1330-1337 (deceased
  banner)

**Audited by:** tier 2 · confidence high

## Purpose & lifecycle

The bar is not a request/response unit — it's client-side state (a
Knockout `patient_data_view_model`) that survives across many page loads
inside the tabbed shell. Lifecycle:

1. **Boot (no patient yet):** `main.php` renders the shell shell once per
   browser session. `app_view_model.attendant_template_type` starts unset
   /empty; `<div id="attendantData">` (`main.php:522`) data-binds to
   whatever that observable currently names, so with no patient selected
   the `<!-- ko if: patient -->` guards in `patient-data-template`
   (`patient_data_template.php:54,65,119`) all fail and the bar renders
   empty (picture, name/pubpid, DOB/age, encounter controls all hidden;
   only the flex containers remain).
2. **Patient selected:** any page that includes `demographics.php` with
   `?set_pid=N` in the URL emits an inline `<script>` block whose
   `setMyPatient()` function (`demographics.php:916-967`) runs on
   `window.onload` (`demographics.php:969-971`) and, gated on
   `isset($_GET['set_pid'])` (`:918`), calls
   `parent.left_nav.setPatient(pname, pid, pubpid, '', str_dob)`
   (`demographics.php:925`) — literally the *parent frame's* copy of
   `left_nav`, i.e. the shell.
3. **Shell updates state:** `left_nav.setPatient()` (`frame_proxies.js:27-54`)
   checks whether the incoming `pid` matches the *already-selected* patient
   (`app_view_model.application_data.patient().pid()`, `:29`); if so it only
   patches `pname`/`pubpid`/`str_dob` on the existing
   `patient_data_view_model` (`:31-33`) — the encounter list, picture URL,
   etc. are left alone. If it's a *different* patient, a brand-new
   `patient_data_view_model(pname, pid, pubpid, str_dob)` replaces the old
   one (`:37-38`), the browser tab title updates
   (`top.document.title = WindowTitleBase + " - " + pname`, `:41-43`), the
   Encounters tab is navigated and the Review tab closed (`:46-48`), therapy
   group tabs close (`:51`), and
   `app_view_model.attendant_template_type('patient-data-template')`
   (`:53`) is what actually makes `<div id="attendantData">` render this
   template rather than `therapy-group-template`.
4. **Redraw:** Knockout's `data-bind="template: {name: ..., data:
   application_data}"` (`main.php:522`) re-renders `patient-data-template`
   automatically whenever the bound observables change — no page reload,
   since this is the shell's own persistent DOM, not iframe content.
5. **Never cleared on its own:** there is no unset call in this file set —
   the bar clears only via `data-bind="click:clearPatient"` on the "X"
   icon in the template itself (`patient_data_template.php:105`,
   `clearPatient` handler not traced here — out of scope, lives in the
   shell's own view-model code, not in the three files this unit covers).

## Layout / interface

What actually renders, in DOM order (`patient_data_template.php:50-249`,
all gated `<!-- ko if: patient -->`):

1. **Patient picture** (`:54-63`) — `<img>` bound to
   `patient.patient_picture` computed
   (`patient_data_view_model.js:29-39`, a `controller.php?document&retrieve...`
   URL keyed on `pid`, hardcoded `document_id=-1`), `onError` fallback to
   `patient-picture-default.png`.
2. **Name + MRN** (`:64-115`) — layout varies by the `patient_name_display`
   global (`:69-97`: `btn` / `text-large` / default), but the bound fields
   are constant:
   - `<span data-bind="text: pname()">` — the name string (see Field
     values below).
   - `(<span data-bind="text: pubpid">)"` — MRN, always parenthesized,
     immediately after the name.
   - A "Close Patient Chart" (✕) icon, `title="Close Patient Chart"`
     (`xla("Close Patient Chart")`), bound to `clearPatient`.
   - Below that, on its own line: `<span data-bind="text:
     patient().str_dob()">` (`:112`) — **not a discrete DOB field**; this
     is a single pre-formatted string containing both DOB and age (or age
     at death). See Field values.
3. **Encounter controls** (`:118-171`) — "Visit History" button, "Select
   Encounter (`N`)" dropdown populated from `encounterArray`, "New
   Encounter" button, and (if `encounterArray().length > 0`) an "Open
   Encounter: `<date>` (`<id>`)" line or "None" — not part of DB-02's
   five fields but shares the same persistent bar and same
   `patient_data_view_model`.
4. **User/messages/portal/services badges** (`:173-248`) — a separate
   `<!-- ko if: user -->` block, unrelated to the patient identity, sharing
   only the outer flex row.

**No sex field and no active/status field appear anywhere in this
template.** `patient_data_view_model` (`patient_data_view_model.js:22-60`)
has exactly four observable patient fields — `pname`, `pid`, `pubpid`,
`str_dob` — plus the derived `patient_picture` and the encounter-array
machinery. There is no `sex` or `status`/`active` observable to bind to,
so this isn't a rendering omission on top of available data — the data
never reaches the client-side view model at all.

## State

```text
patient_data_view_model (patient_data_view_model.js:22-60), one instance
  held at app_view_model.application_data.patient():
    pname            ko.observable  — display name string, see below
    pid              ko.observable  — legacy integer pid
    pubpid           ko.observable  — MRN string
    str_dob          ko.observable  — pre-formatted "DOB: ... Age: ..." string
    patient_picture  ko.computed    — image URL derived from pid
    encounterArray        ko.observableArray  — visit history
    selectedEncounterID   ko.observable
    selectedEncounter     ko.observable
app_view_model.attendant_template_type — which Knockout template
    #attendantData binds to ('patient-data-template' | 'therapy-group-template')
```

**Globals read:** `patient_name_display` (in `patient_data_template.php`,
controls layout only, `:69`), `search_any_patient` (`:28`, unrelated search
box, same template file), `WindowTitleAddPatient` / `WindowTitleBase` (JS
globals, in `left_nav.setPatient`, `frame_proxies.js:41-43`),
`age_display_format` / `age_display_limit` (in
`PatientService::getPatientAgeDisplay()`, `src/Services/PatientService.php:718-728`,
called transitively via `getPatientAgeDisplay()` at
`demographics.php:925`), `date_display_format` (in
`DateFormatterUtils::oeFormatShortDate()`, called from the same line).

**Globals written:** none by this unit.

**Session/PHP state read:** `$_SESSION['pid']` (via
`SessionWrapperFactory`, `dashboard_header.php:29` uses it only as a
fallback default for an unused viewArg — see Findings), `$result` (the
current patient's `patient_data` row, loaded once at
`demographics.php:349`: `getPatientData($pid, "*, DATE_FORMAT(DOB,'%Y-%m-%d')
as DOB_YMD")` — i.e. `SELECT *` on `patient_data` plus a derived
`DOB_YMD` column).

## Logic

### Field values and exact formats (as pushed by `setMyPatient()`, `demographics.php:916-967`)

- **Name (`pname`)** — `js_escape($result['fname'] . " " . $result['lname'])`
  (`:925`). **First + last name only** — no middle name, no title/suffix.
  This differs from the *page title* string built by `OemrUI::__construct`
  (`src/OeUI/OemrUI.php:87`), which uses
  `getPatientFullNameAsString($pid)` (`library/patient.inc.php:869-892`):
  `fname [mname] lname [suffix]`, correctly omitting missing middle
  name/suffix. **Confirmed discrepancy:** for a patient with a middle name
  or suffix, the browser-tab/page-heading title and the persistent identity
  bar show different name strings for the same patient at the same
  moment — see Findings.
- **MRN (`pubpid`)** — `js_escape($result['pubpid'])` (`:925`), the raw
  `patient_data.pubpid` value, no transformation, parenthesized by the
  template (`patient_data_template.php:102`).
- **DOB + age (`str_dob`)** — one composed string, not separable client
  side:
  - Not deceased (`demographics.php:928`):
    `" DOB: " . oeFormatShortDate($result['DOB_YMD']) . " Age: " .
    getPatientAgeDisplay($result['DOB_YMD'])`
  - Deceased (`demographics.php:930`, `is_patient_deceased($pid)` returns
    a row, `:919-922`):
    `" DOB: " . oeFormatShortDate($result['DOB_YMD']) . " Age at death: " .
    oeFormatAge($result['DOB_YMD'], $date_of_death)`
  - **Date format** (`DateFormatterUtils::oeFormatShortDate`,
    `src/Services/Utils/DateFormatterUtils.php:188-212`): driven by the
    `date_display_format` global — `0`/default → ISO `YYYY-MM-DD`, `1` →
    US `MM/DD/YYYY`, `2` → international `DD/MM/YYYY`. Not a fixed format;
    the port must read the same global (or an equivalent site setting
    surfaced by the API — not confirmed present, see Open questions).
  - **Age format, not deceased**
    (`PatientService::getPatientAgeDisplay()`,
    `src/Services/PatientService.php:718-728`): if global
    `age_display_format == '1'`, returns a structured Y/M/D breakdown
    (`getPatientAgeYMD()`) when under the `age_display_limit` global,
    otherwise falls back to `getPatientAge()`
    (`:734+`, not fully traced — months if under 2 years old, else whole
    years, per its own docblock at `library/formatting.inc.php` /
    `getPatientAge` region).
  - **Age format, deceased** (`oeFormatAge($dobYMD, $nowYMD, $format=0)`,
    `library/formatting.inc.php:206-259`): format `0` (the one called
    here) returns months as a bare number if the computed age in months is
    < 24, else whole years as a bare number — **no "Age" global respected
    for the deceased branch**; it always uses `oeFormatAge`'s own default
    format, not `getPatientAgeDisplay()`'s global-driven logic used in the
    non-deceased branch. This is an inconsistency: age display honors
    `age_display_format` when alive, ignores it when deceased.
- **Deceased handling:** the persistent identity bar **never shows
  deceased/alive status at all** — `str_dob`'s "Age" vs "Age at death"
  label is the *only* difference, and it's inside a free-text string, not
  a discrete field or visual treatment (no strikethrough, icon, or color).
  A **separate, unrelated** red banner (`patient/partials/deceased.html.twig`,
  gated `if ($deceased > 0)` at `demographics.php:1333`, rendering
  `"Deceased - <date> (<N days/months/years> ago)"` via `deceasedDays()`,
  `demographics.php:282-304`) appears **inside the dashboard iframe body**,
  positioned between the Care Experience Preferences card and the
  Demographics/Billing/Insurance card row (i.e. mid-page, collapsed-card
  territory) — **not** in the persistent bar, and **not shown at all** for
  a living patient (there is no "Active"/"Alive" positive-state banner,
  only a negative one for deceased). Note: `$deceased` is either `false`
  (alive, from `is_patient_deceased()` returning `false`,
  `library/patient.inc.php:1656-1658`) or an associative array (deceased);
  `$deceased > 0` relies on PHP's array-vs-scalar comparison rules (any
  non-empty array compares greater than any int) to work — correct in
  behavior but non-obvious to a reader; flagged as a Smell, not a bug.
- **Order on screen:** picture → name → MRN (parenthesized, same line as
  name) → DOB+age line (own line below) → encounter controls. Sex and
  active/status are not present, so they have no position to report.

### `dashboard_header.php` (the iframe-local include)

Builds `$viewArgs = ['pageHeading' => ..., 'pid' => $pid, 'csrf' =>
CsrfUtils::collectCsrfToken(...)]` (`:30-34`) and renders
`patient/dashboard_header.html.twig`, which is the single line `{{
pageHeading }}` (verified: file content is exactly `{{ pageHeading }}`,
nothing else). **`pid` and `csrf` are computed and passed but never
referenced by the template** — dead viewArgs (see Findings). `pageHeading`
itself comes from `OemrUI::pageHeading()`
(`src/OeUI/OemrUI.php:150-170`), which renders
`oemr_ui/page_heading/partials/page_heading.html.twig` with `heading`
(the "Medical Record Dashboard - `<name>`" string),
`primaryMenu`/`buttonList` (from a dispatched `PageHeadingRenderEvent`),
and `titleNavContent` — no DOB/sex/MRN/status fields reach this template
either; it is purely a title bar, and it lives inside the iframe (so it
reloads on every dashboard page load), unlike the shell's persistent bar.

### `left_nav.setPatient` (the shell-side mutator)

See Lifecycle step 3 above; full logic already narrated there
(`frame_proxies.js:27-54`).

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| Render persistent bar with patient data | **Indirect only** | No ACL call in any of the three files audited here. The bar only receives data because `demographics.php` (or another patient-scoped page) called `setMyPatient()`, and *that* page is gated by `AclMain::aclCheckCore('patients','demo')` (`demographics.php:1056`, per `ui/DASHBOARD-MAP.md` §2 item 4) | If a future page reused `left_nav.setPatient()` without an equivalent gate, the bar would happily display that patient's name/DOB/MRN — there's no check local to the bar itself |
| Clear patient (✕ icon) | Not traced | `data-bind="click:clearPatient"` (`patient_data_template.php:105`) | `clearPatient` handler lives outside the three files this unit covers — open question |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `patient_data` | Yes (`*` + derived `DOB_YMD`) | No | `getPatientData()` call, `demographics.php:349` | No (single SELECT) |
| `patient_data.deceased_date` | Yes | No | `is_patient_deceased()`, `library/patient.inc.php:1643-1667`, called at `demographics.php:307,919` | No |

No table is written by this unit; it is read-only display plumbing.

## Cross-links

- **Fed by:** `interface/patient_file/summary/demographics.php`
  `setMyPatient()` (this is the primary/only observed feeder in-scope;
  `demographics_full.php:510` has the identical `setPatient(...)` call per
  `api/AUTH-AND-PATIENT.md` §2.4, not independently re-read here since it's
  out of the DB-02 unit list, but the string format should be assumed
  identical — same call signature, same file family).
- **Renders inside:** `interface/main/tabs/main.php` (the tabbed shell),
  specifically `<div id="attendantData">` (`:522`).
- **Sibling title bar:** `interface/patient_file/summary/dashboard_header.php`
  → `OemrUI::pageHeading()` — a *different*, non-persistent identity
  surface (browser/iframe title only), not to be confused with the
  persistent bar this document mostly covers.
- **Calls into:** `PatientService::getPatientAgeDisplay()`
  (`src/Services/PatientService.php:718`), `DateFormatterUtils::oeFormatShortDate()`
  (`src/Services/Utils/DateFormatterUtils.php:188`), both via the legacy
  wrapper functions `getPatientAgeDisplay()`/`oeFormatShortDate()` in
  `library/patient.inc.php` / `library/formatting.inc.php`.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Half-implemented / Gap | Medium | The persistent identity bar has no `sex` or active/status observable at all — not a display omission on top of available data, the client-side view model (`patient_data_view_model`) simply has no field for either. A port that "matches the PHP dashboard's values" per DB-02's literal wording can't show sex or status here without inventing a UI the legacy app never had. | `patient_data_view_model.js:22-28` (only `pname`/`pid`/`pubpid`/`str_dob`); `frame_proxies.js:27-54` (`setPatient` signature has no sex/status param) | Treat as a documented parity gap per A2, not a bug to fix; port decision needed (see Port notes) |
| 2 | Smell | Low | `pname` in the persistent bar (`fname + " " + lname`, `demographics.php:925`) and `heading` in the page title (`getPatientFullNameAsString()`, includes middle name + suffix, `library/patient.inc.php:869-892`) are built by two different functions and can show different strings for the same patient at the same page load. | `demographics.php:925` vs `src/OeUI/OemrUI.php:87` | One-line: standardize both call sites on `getPatientFullNameAsString()` |
| 3 | Smell | Low | `dashboard_header.php` computes `$viewArgs['pid']` and `$viewArgs['csrf']` (a CSRF token) and passes them to `dashboard_header.html.twig`, which renders only `{{ pageHeading }}` — both are unused by the template (confirmed: template's only content is `{{ pageHeading }}`). | `dashboard_header.php:30-36`; `templates/patient/dashboard_header.html.twig:1` | Drop the unused viewArgs, or confirm no module extends this template expecting them |
| 4 | Smell | Low | Age display honors the `age_display_format` global when the patient is alive (`PatientService::getPatientAgeDisplay()`) but always uses `oeFormatAge()`'s hardcoded default format (`format=0`) for the "Age at death" branch — the two branches of the same `str_dob` string are computed by different functions with different configurability. | `demographics.php:928` vs `:930`; `src/Services/PatientService.php:718-728` vs `library/formatting.inc.php:206-259` | Route the deceased branch through the same age-display-format logic, or document the inconsistency for the port |
| 5 | Smell (provisional) | Low | `if ($deceased > 0)` (`demographics.php:1333`) relies on PHP's array-greater-than-scalar comparison semantics (`is_patient_deceased()` returns `false` when alive, an associative array when deceased) rather than an explicit `!== false` / `is_array()` check. Behavior is correct as read, but fragile to a PHP version or refactor that changes comparison semantics or the function's return contract. | `demographics.php:1333`; `library/patient.inc.php:1656-1667` | One-line: `if ($deceased !== false)` |

No Critical or High findings in this unit. `Escalate: no`.

## Port notes

- **Must survive:**
  - Name, DOB (formatted per site's date-display setting), and MRN
    (`pubpid`) visible together, persistently, across navigation — the
    core DB-02 ask minus sex/status.
  - Deceased handling as *some* visible signal — the legacy app's own
    signal is weak (a string suffix change from "Age" to "Age at death"
    inside `str_dob`, no color/icon in the bar itself; the only visual
    (red banner) is buried mid-page, not in the persistent bar) but DB-02
    asks for "active status" and the closest legacy analog is exactly
    this deceased/not-deceased distinction — see Parity spec below.
- **Must not survive:**
  - The two-different-name-strings-for-one-patient discrepancy (Finding 2)
    — the port should pick one canonical name format (full name incl.
    middle/suffix, per `HumanName` from FHIR `Patient.name`) and use it
    everywhere.
  - The `is_patient_deceased() > 0` fragile comparison pattern (Finding 5)
    — a typed port naturally avoids this by checking
    `Patient.deceasedDateTime` presence explicitly.
- **Open questions:**
  - Does any other page beyond `demographics.php`/`demographics_full.php`
    call `left_nav.setPatient()` with a *different* string format for
    `str_dob` or `pname`? Only these two call sites were located by this
    audit (the second cited from `api/AUTH-AND-PATIENT.md` §2.4, not
    independently re-verified here since `demographics_full.php` is
    outside this unit's source list).
  - `clearPatient` (the ✕ icon handler, `patient_data_template.php:105`)
    was not traced — its file lives outside the four sources listed for
    this unit. If the port needs equivalent "close chart" behavior, that
    handler should be mapped separately.
  - Is `date_display_format` (and `age_display_format`/`age_display_limit`)
    exposed via any API the SPA can read, or does the port need to
    hardcode/duplicate the format choice? Not checked as part of this
    unit — flag for whoever audits global-settings API exposure.

## Parity spec for the port

Mapping the brief's five DB-02 fields to FHIR `Patient`
(`api/AUTH-AND-PATIENT.md` §2.3 is the source of the FHIR mapping; this
section adds the legacy-UI format detail on top of it):

| Brief field | What the legacy persistent bar actually shows | Legacy format | FHIR `Patient` field | Notes for the port |
|---|---|---|---|---|
| Name | `fname + " " + lname` only (no middle/suffix) — **but** the page-title bar shown a moment earlier/elsewhere on the same load uses `fname [mname] lname [suffix]` (`getPatientFullNameAsString()`) | Plain string, single space-joined | `Patient.name[0]` (`HumanName`: `use='official'`, `prefix`=title, `family`=lname, `given[0]`=fname, `given[1]`=mname) — `parseOpenEMRPatientName()`, `FhirPatientService.php:281-335` per `AUTH-AND-PATIENT.md` | Port should compose from `HumanName.given`/`family` — recommend matching the *fuller* legacy format (title/page-heading), since it's the more complete one, and note the deviation as a deliberate improvement, not a silent parity break |
| Date of birth | Embedded inside a composed `str_dob` string, not a standalone field: `"DOB: <date> Age: <age>"` / `"DOB: <date> Age at death: <age>"` | Format driven by `date_display_format` global: ISO `YYYY-MM-DD` (default), US `MM/DD/YYYY`, or Intl `DD/MM/YYYY` | `Patient.birthDate` (`parseOpenEMRDateOfBirth()`, `FhirPatientService.php:274-279`) | API gives ISO `YYYY-MM-DD` per FHIR spec; the port must apply its own locale/format choice since the legacy global that drove format isn't itself an API field (open question above) |
| Sex | **Not shown anywhere in the persistent bar.** (It does appear, unrelated to this bar, inside the collapsed Demographics card further down the dashboard — out of this unit's scope.) | n/a | `Patient.gender` + `us-core-birthsex` extension (`parseOpenEMRGenderAndBirthSex()`, `FhirPatientService.php:376-419`) | Available via API; the port would be *adding* a field the legacy persistent bar never had — call this out explicitly as going beyond strict parity (per RECON's A1/parity-vs-improvement tension) |
| MRN | `pubpid`, shown parenthesized immediately after the name, no label | Raw string, no transformation | `Patient.identifier` (type `PT`, system `http://terminology.hl7.org/CodeSystem/v2-0203`) via `parseOpenEMRPublicPatientIdentifier()` (`FhirPatientService.php:552-566`) | Available; match the parenthesized, unlabeled presentation for strict parity, or label it "MRN" as a small explicit improvement |
| Active status | **Not shown at all in the persistent bar.** The only related legacy signal is the "Age" → "Age at death" string swap inside DOB (weak, textual only) plus a separate red "Deceased - `<date>` (`<N> ago`)" banner rendered *mid-page*, not in the bar, and only when deceased (no positive "Active"/"Alive" indicator ever appears) | Deceased banner text: `"Deceased - <date> (<N days|~M months|>Y years> ago)"`, `deceasedDays()`, `demographics.php:282-304` | `Patient.active` is **hardcoded `true`** unconditionally (`FhirPatientService.php:212`, confirmed by direct read) — carries no real signal. The only usable API signal is `Patient.deceasedDateTime` / `Patient.deceasedBoolean` (`parseOpenEMRPatientDeceasedDateTime()`, `FhirPatientService.php:741-752`), which is a **different FHIR element**, not `active` | **Not available via API** for "active" in any meaningful sense (per A2, `REQUIREMENTS-TRACE.md` DB-02 row, already flagged there). If the port wants *some* status signal for parity with the legacy deceased banner, derive it from `Patient.deceasedDateTime` presence (deceased if present, "no signal" otherwise — do **not** repurpose `Patient.active`, since it is always `true` and asserts nothing) |

**Empty/loading/error strings:** none observed for this unit specifically
— the bar has no distinct loading or error state of its own; it is either
absent (`<!-- ko if: patient -->` false, no patient selected) or fully
populated once `setPatient()` runs. No "loading..." placeholder or error
message was found in `patient_data_template.php` for this section (the
encounter dropdown and messages/portal sections elsewhere in the same
template do have their own conditionals, but those are out of DB-02's five
fields).

**Sort order / filters:** not applicable — this is a single-patient
identity display, not a list.
