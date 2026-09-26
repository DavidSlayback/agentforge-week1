# Prescriptions card + edit list — Smarty fragment, Twig list, controller actions

The Prescriptions card is one of the 6 primary dashboard cards
(`demographics.php`, DB-06 in `RECON.md`). Unlike every other primary card,
its body is not rendered by a Twig card partial reading a `Service` class —
`demographics.php` calls into the **legacy Smarty controller stack**
(`Controller`/`C_Prescription`) synchronously, at page-render time, and
splices the resulting HTML string into a Twig wrapper. The pencil/"Edit"
button on the card opens a *second*, richer view of the same data (all
statuses, not just active) in an iframe modal, itself rendered by the same
controller through a different action and a different (Twig, not Smarty)
template. This file documents both surfaces plus the controller code that
feeds them and the one place `demographics.php` embeds the fragment.

**Source:**
- `templates/prescription/general_fragment.html` · 43 lines · Smarty, no version header
- `templates/prescription/general_list.html.twig` · 558 lines · Twig, no version header
- `controllers/C_Prescription.class.php` · 1,320 lines · relevant actions: `list_action` (176-260), `fragment_action` (286-300); constructor 56-121
- `library/classes/Controller.class.php` · 316 lines (base class `C_Prescription` extends) — `CONTROLLER` assign (78), `dispatch()`/`act()` (164-267), `checkControllerAcl()` (131-144)
- `library/classes/Prescription.class.php` · 1,320+ lines — `prescriptions_factory()` (1206-1250), field getters (505-716, 901-909, 1024-1035), `get_dispensation_count()` (1252-1264), `__construct`/`populate` (201-260, 447-459)
- Embed site: `interface/patient_file/summary/demographics.php:1098, 1185-1247`

**Audited by:** tier 2 · confidence high

## Purpose & lifecycle

Two independent render paths share the same data-access call
(`Prescription::prescriptions_factory($pid)`, unfiltered SQL) and diverge
only in which rows they choose to *display* and how much chrome surrounds
them:

1. **Card body (embedded, synchronous, read-only).** On every
   `demographics.php?set_pid=N` load, if the Prescriptions card is turned on
   (`$rx == 1`, `demographics.php:1098`), the page constructs a bare
   `Controller()` (not `C_Prescription` — see Logic, "hacky" comment) and
   calls `$c->dispatch(['controller' => 'prescription', 'action' =>
   'fragment', 'patient_id' => $pid])` (`demographics.php:1240`). This
   whitelists `prescription` → `C_Prescription`
   (`Controller.class.php:35-45, 204`), re-checks the base `patients`/`rx`
   ACL (`checkControllerAcl`, `Controller.class.php:131-144, 207`),
   instantiates `C_Prescription`, and calls `fragment_action($pid)`
   positionally (`Controller.class.php:226-261` builds args from the
   `patient_id` key and calls the method with `array_values($args)`, so the
   named param `patient_id` lands in `fragment_action`'s first positional
   arg `$id`). `fragment_action` (`C_Prescription.class.php:286-300`) loads
   `Prescription::prescriptions_factory($id)` and Smarty-`display()`s
   `general_fragment.html`. The captured output (`ob_start()`/
   `ob_get_contents()`, `demographics.php:1235-1239`) becomes the `content`
   var of `patient/card/rx.html.twig`, which just echoes `{{ content }}`
   inside the standard collapsible card chrome (`card_base.html.twig`).
2. **Edit list (modal iframe, richer, read+write entry point).** The card's
   "Edit" button (visible only when
   `AclMain::aclCheckCore('patients','rx','',['write','addonly'])` is true,
   `demographics.php:1219`) has `btnLink =
   "editScripts('.../controller.php?prescription&list&id=<pid>')"`
   (`demographics.php:1228-1230`) — a **positional** query string (no
   `controller=`/`action=` keys), routed through the legacy `act()`
   fallback (`Controller.class.php:164-186`, confirmed for this exact case
   in `REQUIREMENTS-TRACE.md` section 5) to `list_action($pid)`
   (`C_Prescription.class.php:176-260`), which renders
   `general_list.html.twig` inside a `dlgopen(..., 'modal-xl', ..., {type:
   'iframe'})` dialog (`demographics.php:472-482`, function `editScripts`).
   This view shows **every** prescription regardless of status (no
   server-side filter at all — see Logic), styles ended ones with an
   `inactive` CSS class, and is the entry point for per-row Edit/Delete,
   bulk print/fax/email, and "Add" (`id=0`).
3. Both actions instantiate a **fresh `C_Prescription`** (`new $className()`
   in `Controller::dispatch()`, `Controller.class.php:223`) — its
   constructor (56-121) always runs, regardless of which action follows.

## Layout / interface

**Card body** (`general_fragment.html`): if `$prescriptions` is empty,
literally the string `{xlt t='None'}` ("None", no wrapping markup). Else a
5-column `<table>`: **Drug, Details, Qty, Refills, Filled** header row
(19-24), one `<tr>` per prescription that passes `get_active() > 0`
(27-28), no other controls — no links, no buttons, no checkboxes anywhere
in this template (confirmed by full read; the task's request to check every
href/onclick in this file found none to check).

**Edit list** (`general_list.html.twig`): full HTML document (`<html>`
28-558, not a fragment — it's rendered inside an iframe, hence its own
`<head>`/`setupHeader`). Controls, top to bottom:
- Top navbar (`prescriptionTopNavbarButtons` block, 247-270): Download
  (PDF) via Zend template if `rx_zend_pdf_template` else a controller
  `multiprint` link; "View Printable Version" (HTML) similarly gated on
  `rx_zend_html_template`; Download (Fax) if `rx_use_fax_template`
  (carries `data-signature-missing` if no signature configured); "Send
  Email" (toggles an inline form) if `rx_send_email`; "View Four Panel" if
  `CAMOS_FORM` is registered. All the controller-routed links here use
  `{{CONTROLLER}}prescription&...` — no second `?`, so none of these hit
  the B-14 bug (see Findings #1).
- "Check All" / "Clear All" links (273-274) — pure JS, populate the print
  button hrefs with a `:id:id:...` colon-delimited id list
  (`changeLinkHref`/`changeLinkHrefAll`, 64-117) and the hidden
  `sendEmailPrescriptionIds` field (`updateSendEmailIdList`, 189-199).
- Inline email form (`#sendEmailSection`, 286-325, hidden by default),
  posts to `{{TOP_ACTION}}send` (= `controller.php?prescription&send`, no
  matching `send_action` — only `send_action_process`, so a plain GET/no
  `process=true` POST would 404 in `dispatch()`'s "Action ... does not
  exist" branch, `Controller.class.php:262-264`; not exercised here since
  the form always POSTs `process=true`, line 298).
- Main table (326-427): checkbox column (`check_list`, drives the print/fax
  buttons and email id list), per-row **Edit** link
  (`controller.php?prescription&edit&id=<id>`, hardcoded `webroot`-based
  URL, **not** built from `CONTROLLER`, so immune to B-14), Drug (bold if
  active, with a green "dispensed" badge if `get_dispensation_count() > 0`),
  RxNorm code, Created/Changed dates, Dosage (`get_dosage_display()`), Qty,
  Unit, Refills, Provider, and a per-row **Delete** button
  (`deleteDrug()`, 119-140 — AJAX POST to `library/deletedrug.php`, then a
  hardcoded redirect back to the list). Rows with `active <= 0` get class
  `inactive` (352) — no other visual distinction and no filtering; **every**
  row renders.
- Drug-drug interaction panel (428-438), only if `rx_show_drug_drug`.
- Footer row (444-452): **Add** (`{{ CONTROLLER }}?prescription&edit&id=0&pid=<pid>`
  — the B-14 bug, see Findings #1) and **Quit** (closes the dialog via
  `dlgclose()` if opened as a popup, else no-ops — `window.opener` is falsy
  inside a `dlgopen` iframe, so within the actual card flow this button
  does nothing observable; not traced further, out of scope).
- Auto-print block (223-229): if `printPrescriptionId` is set (only true
  when `list_action` is reached via `C_Prescription::printAfterSave()`,
  i.e. the "Save and Print" workflow on the edit form, out of scope of this
  unit), opens a new tab to the `multiprint` PDF URL on page load.

## State

```text
(No module-level PHP variables — both templates are pure render targets.
 Twig-side "state" is the vars array C_Prescription assigns per action.)
```

**Vars into `general_fragment.html`** (Smarty `assign`, from
`fragment_action` + constructor): `prescriptions` (array of `Prescription`
objects). The constructor also assigns `TOP_ACTION`, `STYLE`,
`WEIGHT_LOSS_CLINIC`, `SIMPLIFIED_PRESCRIPTIONS`, `RXNORMS_AVAILABLE`,
`RXCUI_AVAILABLE`, `CSRF_TOKEN_FORM`, and (if `inhouse_pharmacy`)
`dispenseEnabled`/`defaultPharmacySupplyType`/`DRUG_ARRAY_*` — none of
these are referenced by `general_fragment.html`, which only reads
`prescriptions` (dead assigns from this template's point of view, but they
matter for `general_edit.html.twig`, not read here).

**Vars into `general_list.html.twig`** (`list_action`,
`C_Prescription.class.php:239-258`, plus the same constructor set):
`prescriptions`, `pid`, `rx_send_email`, `rx_show_drug_drug`,
`rx_zend_pdf_template`, `baseModDir`, `zendModDir`, `printm` (always
`null` — `TODO: figure out where printm is used or defined`, line 246;
every `{% if printm is not empty %}` branch in the template is therefore
dead in practice), `rx_zend_pdf_action`, `rx_zend_html_template`,
`rx_zend_html_action` (**bug**: assigned from `rx_zend_pdf_action` global,
not a distinct `rx_zend_html_action` global — see Findings #4),
`rx_use_fax_template`, `faxSignatureMissing`, `printPrescriptionId`,
`INTERACTION` (only if `rx_show_drug_drug`), `CAMOS_FORM`.

**Globals read:** `disable_prescriptions`, `hide_dashboard_cards` (via
`$hiddenCards`) — both in `demographics.php:1098`, not in this unit's own
files; `rx_send_email`, `rx_show_drug_drug`, `rx_zend_pdf_template`,
`rx_zend_pdf_action`, `rx_zend_html_template`, `rx_use_fax_template`,
`inhouse_pharmacy`, `weight_loss_clinic`, `simplified_prescriptions`,
`erx_enable` (all in `C_Prescription.class.php` constructor/`list_action`/
`demographics.php:1185-1229`), `webroot`, `style`.
**Globals written:** none by this unit (writes happen in
`edit_action_process`/`send_action_process`/`dispenseAfterSave`, out of
scope — see Cross-links).

## Logic

### `demographics.php:1098, 1185-1247` — card gate and embed

`$rx = !getBoolean('disable_prescriptions') && AclMain::aclCheckCore('patients','rx') && !in_array('card_prescriptions',$hiddenCards) ? 1 : 0`
(1098) gates the whole card block, `if ($rx === 1):` (1185). Inside, if
`erx_enable` **and** a display flag is on, a *separate* "Current
Medications" card (`erx.html.twig`) is rendered first from a raw
`SELECT * FROM prescriptions WHERE patient_id=? AND active='1'`
(1186-1207) — this is a different card with its own query, not the
Prescriptions card; noted for completeness since it lives in the same
`if` block. Then the actual Prescriptions card: `$viewArgs['auth']` is the
write/addonly ACL (1219); if `erx_enable`, the card becomes read-only
history with a link out to `eRx.php` (1221-1225); else `btnLink` is the
`editScripts(...)` JS call (1228-1230) described above. `demographics.php:1235-1236`
does `$cwd = getcwd(); chdir("../../../");` before dispatching — the
Smarty controller stack apparently needs a specific CWD (relative
`require_once`s elsewhere in the codebase); **note the code never restores
`$cwd`** — no `chdir($cwd)` call anywhere after line 1236 in the file (not
traced further: whether this leaks into later `demographics.php` code that
depends on CWD is an open question). `$c = new Controller()` — a *bare*
base `Controller`, not `C_Prescription`; `dispatch()` is what swaps in the
real `C_Prescription` instance internally (see Purpose & lifecycle #3), so
this is legitimate, just easy to misread as "the card uses the base
controller's own logic."

### `C_Prescription::fragment_action` (286-300)

`@deprecated ... isn't used` docblock (278-284) is **stale/wrong** — this
is confirmed (independently, by `REQUIREMENTS-TRACE.md` section 4 and by
this read) to be the live render path for the dashboard card's body on
every page load. Validates `$id` non-empty (else
`function_argument_error()` + `exit`, 288-291), calls
`Prescription::prescriptions_factory($id, $sort)` — `$sort` is always `""`
here since `dispatch()` only passes the `patient_id` arg (see Purpose &
lifecycle #1), so the **default sort order applies** (see next section) —
and Smarty-`display()`s `general_fragment.html`.

### `C_Prescription::list_action` (176-260)

Same `$id` validation and same `prescriptions_factory()` call (no sort
override from this call site either — the URL
`controller.php?prescription&list&id=<pid>` carries no `sort` param).
Then, only in this action (not `fragment_action`): if `rx_show_drug_drug`
is on, builds a drug-drug interaction check — queries
`information_schema.tables` for an RxNorm table, then for every distinct
active-prescription drug name queries `RXNCONSO`/`rxconso` for an RxCUI,
then (if ≥2 RxCUIs found) makes an **outbound HTTP GET to
`https://rxnav.nlm.nih.gov/REST/interaction/list.json`**
(`C_Prescription.class.php:215`, via `oeHttp::get()`) and renders any
interactions found as inline `alert-danger` HTML blocks (embedding
`$item['comment']`/name/severity/description from the RxNav response,
escaped via `text()`). This external call happens **only** when a user
opens the Edit iframe with `rx_show_drug_drug` on — not on the plain
dashboard card render, and not gated by any error handling beyond the
`$rxn === false` install check; a network failure here would surface as
whatever `json_decode(null, true)` produces (`null`), silently falling
into the "no interactions found" branch via the `!empty(...)` check
(218) — no distinct error path for "RxNav unreachable" vs. "RxNav
returned zero interactions." Builds the full `$vars` array (239-258,
listed in State) and renders `general_list.html.twig`.

### `Prescription::prescriptions_factory` (`Prescription.class.php:1206-1250`)

`SELECT id FROM prescriptions WHERE patient_id = ? ORDER BY <order>` — no
`WHERE active`/`enddate` clause at all; **every** status for the patient is
fetched at this layer. Default `$order_by = "active DESC, date_modified
DESC, date_added DESC"` (1208-1209), validated per-column against a
`SORTABLE_COLUMNS` allowlist (1223-1234, not fully enumerated here) before
being interpolated into the SQL — this is the sort-injection guard;
`list_action`/`fragment_action` never pass a non-default `$order_by` from
this unit's call sites, so it's effectively always the 3-key default.
**Correction to `RECON.md`'s DB-06 row** ("sorted by Filled desc"): the
actual primary sort key is `active DESC`, not `date_added`
("Filled") — `date_added` is only the *third* tiebreaker. Since the
card's own PHP-side filter (`general_fragment.html:28`) already drops every
`active <= 0` row, the visible card rows all share `active=1`, so within
the card the effective observed order collapses to `date_modified DESC,
date_added DESC` — RECON's "Filled desc" is an approximation that happens
to look right on data where `date_modified` tracks `date_added`, not a
description of the actual `ORDER BY`. The **Edit list** shows *all*
statuses, so there `active DESC` is directly visible as ended prescriptions
sorting after active ones (independent of the `inactive` CSS class).

For each returned `id`, `new Prescription($id)` (1247) — see next section
for the cost of this.

### `Prescription::__construct` / `populate` (201-260, `ORDataObject::populate` at `src/Common/ORDataObject/ORDataObject.php:123-127`)

Every `new Prescription($id)` call runs, unconditionally: four
`load_drug_attributes()` calls (`drug_route`, `drug_form`, `drug_interval`,
`drug_units` — each `SELECT * FROM list_options WHERE list_id=? AND
activity=1 ORDER BY seq`, `Prescription.class.php:497-503`), a `new
Provider($authUserID)`, `new Pharmacy()`, `new Person()`, `new
PrescriptionPatient()` (construction cost of each not traced — open
question), then (since `$id != ""`) `populate()` →
`SELECT * FROM prescriptions WHERE id = ?` (`ORDataObject.php:123-125`).
That is **at least 5 SQL statements per prescription row**, run serially,
for both the card fragment and (again, independently) the Edit list — see
Findings #3.

### Field mapping actually rendered

**Card (`general_fragment.html:30-35`):** Drug = `$prescription->drug`
(raw public property, text-escaped); **Details = `get_size()` +
`get_unit_display()` + `get_dosage_display()` concatenated** — *not* simply
`dosage` as `CLINICAL-CARDS.md`'s summary table shorthand suggests.
`get_size()` returns the raw `size` column (numeric string, e.g. `"1.00"`);
`get_unit_display()` maps the numeric `unit` code through `unit_array`
(built from `list_options` `drug_units`, may be blank); `get_dosage_display()`
returns bare `dosage` if both `form` and `interval` are empty, else
`"<dosage> in <form_label> <interval_label>"`. **This resolves the open
ambiguity in `RECON.md`'s probe-disagreement table** ("dosage=1.00"): the
"1.00" a user sees under *Details* could equally be the `size` value, not
necessarily `dosage` — the two are concatenated with no separator markup
beyond a `&nbsp;`, so they're visually indistinguishable when one is
blank. Qty = `get_quantity()` (raw `quantity` string, blank if NULL).
Refills = `get_refills()` (raw int `refills` column — a real, populated
value; confirms `CLINICAL-CARDS.md`'s finding that the API drops this
field, not that the DB lacks it). Filled = `get_date_added()` (raw
`date_added` datetime string, no format applied — full
`YYYY-MM-DD HH:MM:SS`, unlike the Edit list's `date_added|shortDate`).

**Edit list (`general_list.html.twig`):** reads `prescription.quantity`,
`.active`, `.refills`, `.drug`, `.encounter`, `.id`, `.note`,
`.rxnorm_drugcode`, `.erx_source` as **direct public property access**
(Twig dot-lookup on the `Prescription` object — these are typed public
properties on the class, not computed), while Dosage and dispensed-badge
use the getters (`get_dosage_display()`, `get_dispensation_count()`).
Dates use the `date_added`/`date_modified` properties through Twig's
`shortDate` filter (392-395) — different formatting than the card for the
same underlying column.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| Card renders at all | yes | `AclMain::aclCheckCore('patients','rx')`, `demographics.php:1098` | Combined with `disable_prescriptions` global and `hide_dashboard_cards`; controls whether the `dispatch()` call happens at all |
| Card "Edit" button shown | yes | `AclMain::aclCheckCore('patients','rx','',['write','addonly'])`, `demographics.php:1219` | Gates only whether the *link* renders — see next row |
| `dispatch()` re-check (both `fragment` and `list` actions) | yes | `Controller::checkControllerAcl('prescription')` → `patients/rx` base check (no write/addonly), `Controller.class.php:131-144, 207` | Runs on **every** dispatch, including the plain-view card fragment; throws `AccessDeniedHttpException` + audit log (`throwAccessDenied`, 149-156) on failure |
| Direct navigation to `controller.php?prescription&list&id=<pid>` (the Edit-list URL) | **partial — see Findings #5** | Same base `patients/rx` check as above, not `write`/`addonly` | Any user who can view the card (base ACL only) can reach the *unfiltered, all-status* list by hitting this URL directly, without ever passing the write/addonly check that gates the button itself |
| Per-row Edit / Delete links in `general_list.html.twig` | **missing (template-level)** | none — links at 364 and 418 render unconditionally | Not gated on `auth`/write in the template; whether `library/deletedrug.php` (Delete's AJAX target) or `edit_action`/`edit_action_process` (Edit's target) enforce ACL server-side is **not traced in this unit** (open question) |
| Add button (`id=0`, footer) | **missing (template-level)**, same as above | none | Renders unconditionally regardless of `auth`; reaching `edit_action_process` for a real save would still need whatever `list_action`'s/`edit_action`'s own dispatch-level ACL provides (base `patients/rx`, not write) — not confirmed to require write here |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `prescriptions` | Yes — id list (`prescriptions_factory`) + full row per id (`ORDataObject::populate`) | No (this unit is display-only; writes happen in `edit_action_process`/`dispenseAfterSave`, out of scope) | `Prescription.class.php:1242-1247`, `ORDataObject.php:123-125` | No |
| `list_options` (`drug_route`/`drug_form`/`drug_interval`/`drug_units`) | Yes — 4 queries per `Prescription` instantiation | No | `Prescription.class.php:497-503`, called from `__construct` (204-207) | No |
| `drug_sales` | Yes — dispensation count, per row, **only in the Edit list** (not the card) | No | `get_dispensation_count()`, `Prescription.class.php:1252-1264`, called from `general_list.html.twig:372, 384` | No |
| `information_schema.tables`, `code_types` | Yes — RxNorm/RxCUI availability probe, **every** `C_Prescription` construction (both actions) | No | `C_Prescription.class.php:66-67` | No |
| `RXNCONSO`/`rxconso` | Yes — only if `rx_show_drug_drug` global on, **only in `list_action`** | No | `C_Prescription.class.php:193, 205` | No |
| External HTTP: `rxnav.nlm.nih.gov` | Yes — only if `rx_show_drug_drug` on and ≥2 drug RxCUIs resolved | No | `C_Prescription.class.php:215` (`oeHttp::get`) | No |
| `drug_templates`, `drugs` | Yes — only if `inhouse_pharmacy` global on, in the constructor (both actions) | No | `C_Prescription.class.php:80-84` | No |

## Cross-links

- **Opened by:** `demographics.php` (`$c->dispatch(...)`, 1240) for the card
  body; `editScripts()` (`demographics.php:472-483`) for the Edit-list
  iframe.
- **Calls into:** `Controller::dispatch()`/`act()` (`library/classes/Controller.class.php`);
  `Prescription`/`Prescription::prescriptions_factory` (`library/classes/Prescription.class.php`);
  `PatientIssuesService`/`CodeTypesService` (only in `edit_action`, out of
  this unit's scope); `DrugSalesService` (only in
  `dispenseAfterSave`, out of scope).
- **Also see:** `templates/prescription/general_edit.html.twig` (the actual
  add/edit form both "Edit" and "Add" links route to via `edit_action`) —
  not read for this unit; `library/deletedrug.php` (Delete AJAX target) —
  not read for this unit; `REQUIREMENTS-TRACE.md` section 5 (full trace of
  the B-14 bug reproduced independently below) and `api/CLINICAL-CARDS.md`
  DB-05/DB-06 section (API parity, `refills` gap).

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Bug | High | "Add" link in the Edit-list iframe builds a doubled `?` (`{{ CONTROLLER }}?prescription...` where `CONTROLLER` already ends in `?`), so `controller.php` receives a literal `?prescription` key, fails the `VALID_CONTROLLERS` whitelist, and throws `BadRequestHttpException("Missing or invalid 'controller' parameter")` — reproduces David's B-14 exactly. Independently re-confirmed here (not just cited) by reading `general_list.html.twig:449` and `Controller.class.php:78` together; every other `{{CONTROLLER}}`-built link in the same template omits the extra `?` and works. | `templates/prescription/general_list.html.twig:449`, `library/classes/Controller.class.php:78` | Drop the leading `?` from the template link (`{{ CONTROLLER }}prescription&edit&id=0&pid=...`) |
| 2 | Half-implemented / dead code | Low | `fragment_action`'s docblock claims `@deprecated ... isn't used`, but it is the live, unconditional render path for the Prescriptions card body on every dashboard load. A future cleanup guided by that comment would break the dashboard. | `controllers/C_Prescription.class.php:278-286` | Remove/correct the docblock |
| 3 | Smell / Performance | Medium | Rendering the Prescriptions card issues at least 5 SQL statements per prescription row (`load_drug_attributes()` ×4 + `populate()` ×1, plus whatever `Provider`/`Pharmacy`/`Person`/`PrescriptionPatient` construction costs), serially, with **no batching or caching** — for a patient with N prescriptions the card body alone is ~5N+ queries, and opening the Edit iframe repeats the same work independently. Directly relevant to `RECON.md`'s "loading is slow in general" observation. | `library/classes/Prescription.class.php:201-260` (`__construct`), `497-503` (`load_drug_attributes`), `src/Common/ORDataObject/ORDataObject.php:123-125` (`populate`) | Batch-load `list_options` lookups once per request instead of once per `Prescription` object |
| 4 | Bug | Low | `rx_zend_html_action` is assigned from the `rx_zend_pdf_action` global, not a distinct `rx_zend_html_action` global — looks like a copy-paste of the line above it. | `controllers/C_Prescription.class.php:249` (compare to 247) | Use the correct global name if one exists, else confirm intentional and comment it |
| 5 | Security / Authorization modeling | Medium (provisional) | The Edit-list URL (`controller.php?prescription&list&id=<pid>`) is reachable by anyone who passes the *base* `patients/rx` ACL — the same check that gates the read-only card. The `write`/`addonly` check (`demographics.php:1219`) only controls whether the *button* is drawn; it is not re-checked by `list_action` or by the template. A view-only user who navigates there directly sees the unfiltered, all-status list (including rows the card's `active>0` filter hides) with Edit/Delete/Add controls rendered in the HTML regardless of their ACL. Whether the destinations of those controls (`edit_action`, `library/deletedrug.php`) independently enforce write ACL is **not verified in this unit** — flagged, not confirmed. | `demographics.php:1219` vs. `controllers/C_Prescription.class.php:176-187` (no additional ACL in `list_action`), `templates/prescription/general_list.html.twig:364, 418, 449` (unconditional rendering) | Re-check write/addonly ACL inside `list_action` itself, and/or hide Edit/Delete/Add controls in the template when `auth` is false |
| 6 | Smell | Low | `rx.html.twig`'s `{{ content }}` splices the Smarty fragment's captured HTML output into a Twig template whose environment is constructed with `autoescape => false` (`src/Common/Twig/TwigContainer.php:70`, used globally for this render, not specific to this card). Currently safe because every dynamic value in `general_fragment.html` is passed through the `|text` modifier, but there is no independent safety net if a future edit to the fragment forgets an escape. | `templates/patient/card/rx.html.twig:11`, `src/Common/Twig/TwigContainer.php:70` | Note as a fragile pattern; not exploitable as currently written |
| 7 | Smell | Low | `demographics.php:1236` does `chdir("../../../")` before dispatching the controller and never restores the original working directory (no matching `chdir($cwd)` found anywhere later in the file). | `interface/patient_file/summary/demographics.php:1235-1240` | Restore `$cwd` after the `dispatch()` call, or confirm downstream code doesn't depend on CWD (open question) |

## Port notes

- **Must survive:** the `active > 0` filter for the card view (do **not**
  filter on `end_date`; confirmed the DB column driving this is
  `prescriptions.active`, independent of `end_date`); the card's exact 5
  columns and their real source (Details = size + unit + dosage, not just
  dosage); Refills as a genuinely populated field on the card even though
  the API drops it (client will need a documented gap here, matching
  `CLINICAL-CARDS.md`'s DB-06 finding — this is a UI-side confirmation that
  the DB has the data, the API just doesn't expose it); the "None" empty
  string, verbatim.
- **Must not survive:** the double-`?` Add-button bug (Finding #1) —
  a port should use `active=1` create semantics without reproducing the
  concatenation bug; the per-request N+1 query pattern (Finding #3) — a
  REST/FHIR-backed port already avoids this by construction, but worth
  confirming the replacement client doesn't re-introduce N+1 at the HTTP
  level (e.g., one API call per row); the unauthenticated-looking
  Edit/Delete/Add affordances gated only by client-side judgment (Finding
  #5) — a port must gate these on the API's own write scope, not on
  whether a button happened to be drawn.
- **Open questions:** exact query cost of `Provider`/`Pharmacy`/`Person`/
  `PrescriptionPatient` construction inside `Prescription::__construct`
  (not traced); whether `library/deletedrug.php` and `edit_action`/
  `edit_action_process` independently enforce write ACL (Finding #5, out
  of this unit's file scope); whether the un-restored `chdir()` (Finding
  #7) has any observable effect later in `demographics.php`'s 2,080 lines;
  the full `SORTABLE_COLUMNS` allowlist (`Prescription.class.php`, not
  fully enumerated here) — irrelevant to the port since no caller in this
  unit passes a non-default sort, but worth a note if the port ever exposes
  user-driven sorting via the API's own params.
