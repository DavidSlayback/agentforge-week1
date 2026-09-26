# Allergies / Medical Problems / Medications card templates — Twig rendering layer

These are the three Twig templates behind the dashboard's "in-scope" issue
cards (DB-03 Allergies, DB-04 Medical Problems, DB-05 Medications). Each is
a thin `content` block extending the shared `card_base.html.twig` chrome
(header, collapse, edit button). The templates themselves hold almost no
logic — the filtering, sorting-that-doesn't-happen, and severity lookups
live one layer up, in `demographics.php`, or one layer down, in the DB
(`list_options`, `lists_touch`, `user_settings`). This doc traces both
layers wherever the template's behavior depends on them, per Phase-2
instructions.

**Source:**
- `templates/patient/card/allergies.html.twig` · 52 lines
- `templates/patient/card/medical_problems.html.twig` · 24 lines
- `templates/patient/card/medication.html.twig` · 25 lines
- `templates/patient/card/card_base.html.twig` · 22 lines (shared chrome, all three `{% extends %}` it)
- `templates/patient/card/loader.html.twig` · 9 lines (found under the same directory per the brief; **not used by these three cards** — see Cross-links)
- Renderer: `interface/patient_file/summary/demographics.php:1090-1182` (viewArgs construction + `$t->render()` calls)

**Audited by:** tier 2 · confidence high (all claims re-read at source; three
DB checks run against the seeded synthetic DB to confirm behavior that
depends on live data, see inline citations)

## Purpose & lifecycle

All three cards render **synchronously**, inline in `demographics.php`'s
main PHP execution (not via `placeHtml()`/AJAX like Labs, Vitals, or
Messages — see `ui/DASHBOARD-MAP.md` §4). Sequence per card, identical
shape for all three (`demographics.php:1116` allergy, `:1141` medical
problem, `:1163` medication — using `DASHBOARD-MAP.md`'s line numbers,
which match a re-read of the same block):

1. An ACL+hidden-card gate computes a `1`/`0` flag (`$allergy`, `$pl`,
   `$meds`, `demographics.php:1095-1097`): `AclMain::aclCheckIssue(<type>)`
   AND `!in_array('card_<name>', $hiddenCards)`. If `0`, the card's `if`
   block is skipped entirely — no card, no "no access" placeholder, nothing
   in the DOM.
2. A service call fetches **every** `lists` row of that type for the
   patient (no `enddate`/`outcome` filter in SQL — see Data touches).
3. The shared `filterActiveIssues()` closure (`demographics.php:1110-1113`,
   defined once, reused by all three) filters to "active" rows in PHP,
   after the full result set is already in memory.
4. A `$viewArgs` array is built (title, id, collapse state, the filtered
   `list`, a `listTouched` boolean, and an edit-link `btnLink`) and passed
   to `$t->render('patient/card/<name>.html.twig', $viewArgs)`.
5. The rendered HTML is echoed inside a `<div class="$col">` column whose
   width (`col-md-4`/`-6`/`-12`) depends on how many of the three cards are
   currently visible (`$colInt = 12 / $cards`, `demographics.php:1099-1102`)
   — i.e. these three cards visually resize each other; hiding one widens
   the rest.
6. `card_base.html.twig` wraps the card's `content` block in the header
   (title, collapse toggle, single edit-pencil icon) and a Bootstrap
   `collapse` div whose open/closed state is set at render time from
   `initiallyCollapsed`.
7. Client-side, a single delegated-ish click binding
   (`demographics.php:606-609`, inside `placeHtml("stats.php", "stats_div",
   true).then(...)`) wires `$('[data-toggle="collapse"]').on('click',
   updateUserVisibilitySetting)` for **every** element matching that
   selector already in the DOM, including these three cards' header links
   — see Findings #1 for the timing implication.
8. The pencil icon navigates the whole page (not a modal/iframe) to
   `stats_full.php?active=all&category=<type>` via `load_location()`
   (`demographics.php:538-541`, `document.location = location` after
   `top.restoreSession()`) — a full-page issue editor showing **all** rows
   of that type, not just the filtered "active" set the card shows.

## Layout / interface

### `card_base.html.twig` (shared chrome, all three extend it)

```
<section class="{{ card_container_class_list|join(' ') }}{{ card_bg_color }} {{ card_text_color }}">
  <div class="card-body p-1">
    <h6 class="card-title ...">
      <a data-toggle="collapse" data-target="#{{ id }}" aria-expanded="true" aria-controls="{{ id }}">
        {{ title }}<i class="... fa-expand|fa-compress" data-target="#{{ id }}"></i>
      </a>
      {% if auth %}
        <span>
          {% if card.canAdd() or btnLabel == "Add" %}<a class="{{ btnClass }}" href="..." ...><i class="fa fa-plus"></i></a>{% endif %}
          {% if card.canEdit() or btnLabel == "Edit" %}<a class="{{ btnClass }}" href="..." ...><i class="fa fa-pencil-alt"></i></a>{% endif %}
        </span>
      {% endif %}
    </h6>
    <div id="{{ id }}" class="card-text collapse{{ initiallyCollapsed ? '' : ' show' }}">
      <div class="clearfix pt-2">{% block content %}{% endblock %}</div>
    </div>
  </div>
</section>
```

None of the three cards pass a `card` object into `$viewArgs` (only
`btnLabel => 'Edit'`, confirmed by re-reading `demographics.php:1120-1132,
1144-1156, 1166-1178` — no `'card' =>` key in any of the three arrays).
With Twig's default (non-strict) variable handling, `card.canAdd()` on an
undefined `card` evaluates to `null` (falsy) without erroring, so the
`or btnLabel == "Add"` / `"Edit"` fallback is what actually decides the
icon for these three — **only the pencil (Edit) ever renders; the plus
(Add) icon is structurally impossible** for these three cards regardless
of the user's actual add-vs-edit ACL, because `btnLabel` is hardcoded to
`'Edit'` in every one of the three `$viewArgs` arrays.

The collapse icon is `fa-expand` (meaning "click to expand") when
`initiallyCollapsed` is true, `fa-compress` ("click to collapse")
otherwise — set once at render time from `initiallyCollapsed`, then
toggled client-side per click (`demographics.php:889-898`).

### `loader.html.twig` — not used by these three cards

```twig
{% extends "patient/card/card_base.html.twig" %}
{% block content %}
<div class="text ml-2"><div class="spinner-border spinner-border-sm" role="status">
  <span class="sr-only">{{ "Loading"|xlt }}...</span>
</div></div>
{% endblock %}
```

This is the shell used by the **async** cards (Messages, Patient
Reminders, Disclosures, Labs, Vitals, Clinical Reminders — per
`DASHBOARD-MAP.md` §4) as a placeholder while `placeHtml()` fetches the
real fragment. Allergies/Medical Problems/Medications never use it: they
render their final content synchronously in the same PHP pass that emits
the page (step 2-4 above), so there is no loading-spinner state for these
three cards, ever — an empty list shows the "Nothing Recorded"/"No Known
Allergies"/"None" text immediately on first paint, not a spinner that
resolves into one of those strings. Worth calling out because the brief
listed `loader.html.twig` as an example file to trace; tracing it confirms
it's *not* part of this unit's actual render path.

### Allergies (`allergies.html.twig`)

```twig
<div class="{{ list_group_container_class_list|default(['list-group','list-group-flush','pami-list'])|join(' ') }}">
{% if list|length == 0 %}
    {{ listTouched ? "No Known Allergies"|xlt : "Nothing Recorded"|xlt }}
{% else %}
    {% set severityAlarms = ["severe", "life_threatening_severity", "fatal"] %}
    {% for l in list %}
        {% set classes = (l.severity_al in severityAlarms) ? 'bg-warning font-weight-bold px-1' : '' %}
        <div class="list-group-item p-1">
          <div class="d-flex w-100 justify-content-between">
            {% set _severity = getListItemTitle('severity_ccda', l.severity_al) %}
            <div class="flex-fill" title="{{ l.title }} Reaction: {{ l.reaction_title }} - {{ _severity }}">
              {{ l.title }} (<span class="{{ classes }}">{{ _severity }}</span>)
            </div>
          </div>
        </div>
    {% endfor %}
{% endif %}
</div>
```

One `list-group-item` row per allergy, unconditionally in the order
`list` arrives in (see Findings #2 — the docblock claims otherwise). Each
row shows `Title (Severity)` with a `title=` tooltip repeating title +
reaction + severity. Rows whose `severity_al` is `severe`,
`life_threatening_severity`, or `fatal` get `bg-warning font-weight-bold
px-1` on the **severity span only**, not the row/title.

### Medical Problems (`medical_problems.html.twig`)

```twig
<div class="{{ list_group_container_class_list|default([...])|join(' ') }}">
{% if list|length == 0 %}
    {{ listTouched ? "None{{Issues}}"|xlt : "Nothing Recorded"|xlt }}
{% else %}
    {% for l in list %}<div class="list-group-item py-1 px-1">{{ l.title }}</div>{% endfor %}
{% endif %}
</div>
```

Single field per row: `l.title` only. No severity, no tooltip, no
highlight, no date. Simplest of the three.

### Medications (`medication.html.twig`)

```twig
<div class="{{ list_group_container_class_list|default([...])|join(' ') }}">
{% if list|length == 0 %}
    {{ listTouched ? "None{{Issues}}"|xlt : "Nothing Recorded"|xlt }}
{% else %}
    {% for m in list %}
      <div class="list-group-item p-0 pl-1">
        <span class="font-weight-normal">{{ m.title }}</span>
        <span>{{ m.drug_dosage_instructions }}</span>
      </div>
    {% endfor %}
{% endif %}
</div>
```

Two fields per row: drug name (`m.title`) and dosage instructions
(`m.drug_dosage_instructions`), each its own `<span>`, no separator
character between them in the markup (rendered CSS/whitespace only).

## State (Twig context per render — not PHP globals, this unit is templates)

Common keys across all three (`demographics.php:1120-1132`,
`:1144-1156`, `:1166-1178`):

```text
title              — xl('Allergies' | 'Medical Problems' | 'Medications')
card_container_class_list — ['flex-fill', 'mx-1', 'card'] (literal, PHP)
id                 — 'allergy_ps_expand' | 'medical_problem_ps_expand' | 'medication_ps_expand'
forceAlwaysOpen    — false (literal)
initiallyCollapsed — (getUserSetting($id) == 0) ? true : false   -- see Findings #3
linkMethod         — "javascript" (literal)
list               — filterActiveIssues($service result)         -- array of assoc rows
listTouched        — !empty(getListTouch($pid, $type))
auth               — true (literal)
btnLabel           — 'Edit' (literal)
btnLink            — "return load_location('<webroot>/interface/patient_file/summary/stats_full.php?active=all&category=<type>')"
```

Not set for these three: `card`, `btnClass`, `card_bg_color`,
`card_text_color`, `requireRestore` — all read as `null`/undefined by
`card_base.html.twig` and render as empty string or fall through
conditionals (non-strict Twig; confirmed no `strict_variables` in the
environment — see Findings #4).

**Globals read (indirectly, by the PHP renderer, not the templates
themselves):** `$hiddenCards` (from `globals` table, `gl_name =
'hide_dashboard_cards'`, resolved earlier in `demographics.php`, per
`DASHBOARD-MAP.md` §3), `$pid` (session), ACL state via `AclMain`.
**Globals written:** none by these three cards' render path itself; the
async collapse-toggle POST (`library/ajax/user_settings.php`) writes
`user_settings` — see Findings #3.

## Logic

### `filterActiveIssues()` (`demographics.php:1104-1113`, shared by all three)

```php
function filterActiveIssues(array $i): array
{
    return array_filter($i, fn($_i): bool => ($_i['outcome'] != 1) && (empty($_i['enddate']) || (strtotime((string) $_i['enddate']) > strtotime('now'))));
}
```

PHP-side filter applied *after* the full unfiltered result set is fetched
(no SQL `WHERE` on `enddate`/`outcome` in either service — confirmed in
`api/CLINICAL-CARDS.md` DB-03/DB-04 sections, re-confirmed here by reading
`src/Services/AllergyIntoleranceService.php:44-107` and
`src/Services/PatientIssuesService.php:171-211` directly: neither has an
`enddate`/`outcome` clause). `array_filter()` preserves original array
keys and relative order — it does not resort. Rule: keep a row if
`outcome != 1` (not resolved) **and** (`enddate` is empty **or** in the
future). A row with a *future* `enddate` counts as active — not "no
enddate", a nuance `api/CLINICAL-CARDS.md` already flags for Medical
Problems/Allergies and which applies identically to Medications (same
function, same call site pattern).

### Row order — no ORDER BY, no client-side sort, despite the Allergies docblock's claim

`AllergyIntoleranceService::search()` (`src/Services/AllergyIntoleranceService.php:44-107`)
has **no `ORDER BY`** clause in its SQL. `PatientIssuesService::search()`
(`src/Services/PatientIssuesService.php:171-211`) has `ORDER BY
lists.begdate` (line ~204, the `$sql .= $whereClause->getFragment() . "
ORDER BY lists.begdate "` line) — used for *both* Medical Problems and
Medications, since both call the same method with a different `type`
filter. `array_filter()` in `filterActiveIssues()` does not reorder.

`allergies.html.twig`'s own docblock (lines 6-8) says: *"Any allergy with
a severity of severe, life threatening, or fatal is always rendered at
the top of the card, regardless of the overflow of the list."* **This does
not happen.** The `{% for l in list %}` loop (line 39) is a plain,
unmodified iteration — there is no sort, no two-pass split-and-recombine,
nothing that promotes high-severity rows. `grep -rn
"critical_allergy_item_class_list"` across `templates/`, `interface/`,
`src/` finds exactly one hit: the docblock comment itself (line 11) — the
customization hook the comment describes for overriding "critical
allergy" styling is never read by the template body either. Both claims
in the docblock are aspirational/dead documentation, not implemented
behavior. See Findings #2 (Escalate).

### Severity display and the "(1)" fallback (Allergies only)

`getListItemTitle('severity_ccda', l.severity_al)`
(`src/Common/Layouts/LayoutsUtils.php:17-24`, registered as a Twig
function `src/Common/Twig/TwigExtension.php:281-282`):

```php
public static function getListItemTitle($list, $option)
{
    $row = sqlQuery("SELECT `title` FROM `list_options` WHERE `list_id` = ? AND `option_id` = ? AND activity = 1", [$list, $option]);
    if (empty($row['title'])) {
        return $option;
    }
    return xl_list_label($row['title']);
}
```

Seeded `severity_ccda` options (`sql/database.sql:5389-5396`) use string
`option_id`s: `unassigned`, `mild`, `mild_to_moderate`, `moderate`,
`moderate_to_severe`, `severe`, `life_threatening_severity`, `fatal`. **DB
check (read-only, aggregate only, no PHI):**
`SELECT severity_al, COUNT(*) FROM lists WHERE type='allergy' GROUP BY
severity_al` on the local synthetic DB returns `severity_al = '1'` for 2
rows and `NULL` for 1 row — neither is a valid `severity_ccda` option_id.
So:
- `severity_al = '1'`: the `SELECT ... WHERE option_id = '1'` finds no
  row → `getListItemTitle` returns the raw stored value `'1'` unchanged
  → the card literally shows `Title (1)` — this is what `RECON.md`'s
  "(1)" observation is: not a special code, just a legacy/mis-seeded raw
  `severity_al` value that never matched a `list_options` row, falling
  back to the DB's raw string. `'1'` is not in `severityAlarms`, so it is
  **not** highlighted.
- `severity_al = NULL`: `WHERE option_id = NULL` never matches in SQL (no
  row, not even an empty-string row) → `$row` is falsy → same fallback →
  returns `$option` which is `NULL` → `{{ _severity|text }}` on `null` →
  `text(null)` (`htmlspecialchars(null ?? '', ...)`) → empty string → the
  card shows `Title ()` — empty parens, no text inside.

### Empty-state text and `listTouched` (all three)

`getListTouch($pid, $type)` (`library/lists.inc.php:130-138`):
`SELECT date FROM lists_touch WHERE pid=? AND type=?`; `listTouched` in
`$viewArgs` is `true` iff that query returns a row. `lists_touch` is
written by `setListTouch()` (`library/lists.inc.php:141-...`) from four
call sites: whenever a user actually **saves** an issue of that type via
`interface/patient_file/summary/add_edit_issue.php:279`; from eRx
sync (`interface/eRxStore.php:623`, `'allergy'` only); from two
type-specific form-save paths not relevant here
(`interface/eRxSOAP.php:684` "prescription_erx",
`interface/forms/fee_sheet/review/fee_sheet_queries.php:125`
"medical_problem", `interface/forms/eye_mag/save.php:806`); and via a
dedicated AJAX endpoint, `library/ajax/lists_touch.php:25`, POSTed by a
`.noneCheck` control (`interface/patient_file/summary/stats_full.php:484-493`)
that a user clicks on the **full** issue-editor page (the same page the
card's pencil icon opens) to explicitly assert "no known problems of this
type" without adding a row. **DB check (aggregate, read-only):**
`SELECT pid, type FROM lists_touch` on the local DB shows pid 1 touched
for `allergy`/`medical_problem`/`medication`, pid 2 for
`medical_problem`/`medication` only, pid 13 for `medical_problem` only —
confirming the flag is per-(patient, type), independent across the three
cards; the same empty patient can show "Nothing Recorded" for one card
and "No Known Allergies"/"None" for another simultaneously depending on
which lists staff have explicitly reviewed.

Exact empty strings, each via `|xlt` (translate-then-`text()`-escape,
`library/htmlspecialchars.inc.php:323-326`):

| Card | `listTouched == true` | `listTouched == false` |
|---|---|---|
| Allergies | `"No Known Allergies"` | `"Nothing Recorded"` |
| Medical Problems | `"None{{Issues}}"` → renders **`"None"`** | `"Nothing Recorded"` |
| Medications | `"None{{Issues}}"` → renders **`"None"`** | `"Nothing Recorded"` |

The `{{Issues}}` suffix on the Medical Problems/Medications key is a
disambiguation tag, not literal output. `xl()` (`library/translation.inc.php:20-90`)
looks up the exact constant `"None{{Issues}}"` in `lang_constants`; **DB
check** (`SELECT constant_name FROM lang_constants WHERE constant_name
LIKE '%Issues%'`) shows no row named `"None{{Issues}}"` exists (only
`"Issues"`, `"No Issues"`, etc.), so `xl()` falls back to returning the
constant itself (`library/translation.inc.php:74-76`) — but *after* that
fallback, `xl()` unconditionally regex-strips any `{{...}}` span
(`/\{\{.*\}\}/`, lines 79-85) from whatever string it's about to return,
translated or not. Net effect: the displayed text is always exactly
`"None"`, regardless of translation/language settings — the `{{Issues}}`
tag exists purely so this "None" doesn't collide with some other,
differently-translated "None" constant elsewhere in the app. A port
should hardcode the display string `"None"` for these two cards' touched-empty
state, not `"None{{Issues}}"`.

### Collapse persistence and its real default (`initiallyCollapsed`)

`(getUserSetting($id) == 0) ? true : false` — `UserSettingsService::getUserSetting()`
(`src/Services/Globals/UserSettingsService.php:40-51`) runs `SELECT
setting_value FROM user_settings WHERE (setting_user=? OR setting_user=?)
AND setting_label=? ORDER BY setting_user DESC` (per-user row first, then
`setting_user=0` "global default" row), returning `NULL` if neither
exists. PHP's `==` treats `NULL == 0` as **true** (loose comparison, both
sides cast to bool: `false == false`), so a literal absence of any row
*would* mean `initiallyCollapsed = true` (collapsed) — **not** "expanded"
as `ui/DASHBOARD-MAP.md` §3 guesses ("presumably... cards open by
default"). But that only matters if no row exists at all. **DB check**
(`SELECT setting_user, setting_label, setting_value FROM user_settings
WHERE setting_label IN ('allergy_ps_expand','medical_problem_ps_expand','medication_ps_expand')`)
on the local synthetic DB shows all three already have a `setting_user=0`
row with `setting_value='1'` — so today, on this install, all three
default to **expanded**, matching what `DASHBOARD-MAP.md` and `RECON.md`
observed live, but for a different reason than either doc states: not
because "NULL isn't literally 0" (it is, for `==`), but because a global
default row already happens to exist with value `'1'`.

That global-default row's origin is itself a quirk worth porting
carefully: `UserSettingsService::setUserSetting()`
(`src/Services/Globals/UserSettingsService.php:84-105`), called from the
collapse-toggle AJAX handler (`library/ajax/user_settings.php:26-29`)
whenever **any** user toggles a card, always also calls itself with
`$user=0, $createDefault=false, $overwrite=false` (line 103) — i.e. **the
first person, system-wide, to ever toggle a given card's collapse state
permanently sets the fleet-wide default for every user who has never
touched that card themselves**, since `$overwrite=false` means later
toggles by other users never change that `setting_user=0` row again. This
is undocumented, data-dependent, and not something a fresh install or a
different seed dataset would reproduce identically — flag as an open
question for the port (see Port notes).

Client-side, the click handler that persists a toggle
(`updateUserVisibilitySetting`, `demographics.php:882-911`) is bound via
`$('[data-toggle="collapse"]').on('click', ...)` **only inside the
`.then()` callback of `placeHtml("stats.php", "stats_div",
true)`** (`demographics.php:606-609`) — an async fetch to a *different*
card's fragment (Health Concerns/Immunizations, per
`DASHBOARD-MAP.md` §4). These three cards render synchronously and exist
in the DOM well before that fetch resolves, so in the common case the
binding still attaches to them correctly once `stats.php` responds — but
if that request is slow or fails (network error, ACL 403, JS exception
in an earlier `.then()` in the chain), the click binding never attaches
at all system-wide, for every card including these three: Bootstrap's own
`data-toggle="collapse"` behavior still visually expands/collapses the
`<div class="collapse">` (that part needs no JS handler, it's a
`data-*` attribute Bootstrap reads directly), but the POST to
`user_settings.php` that would persist the new state never fires — the
card's collapse state silently reverts to the DB-stored value on next
page load. Not exercised/reproduced here (would require simulating a
slow/failing `stats.php` request, out of scope for a template-file read),
flagged as an open question.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| Show Allergies card at all | yes | `AclMain::aclCheckIssue('allergy')` (`demographics.php:1095`) combined with `!in_array('card_allergies', $hiddenCards)` | Gate is all-or-nothing per card — no row-level ACL inside the rendered list |
| Show Medical Problems card | yes | `AclMain::aclCheckIssue('medical_problem')` (`:1096`) + hidden-cards check | same pattern |
| Show Medications card | yes | `AclMain::aclCheckIssue('medication')` (`:1097`) + hidden-cards check | same pattern |
| Add vs. Edit icon inside the card | **not distinguished** | `btnLabel` hardcoded `'Edit'` in all three `$viewArgs` | See Layout/interface — `card_base.html.twig`'s `canAdd()`/`canEdit()` branches never fire for these three since no `card` object is passed; only the pencil renders, never the plus, independent of the user's actual add-only vs. edit ACL |
| Pencil-icon destination (`stats_full.php`) | not re-checked by these templates | out of scope (separate file) — `stats_full.php`'s own ACL gate not read for this doc | Cross-link only |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `lists` (type='allergy') | Yes, all rows for pid, no SQL filter | No | `AllergyIntoleranceService::search()` (`src/Services/AllergyIntoleranceService.php:44-107`) | n/a (read) |
| `lists` (type='medical_problem', 'medication') | Yes, all rows for pid, no SQL filter (ORDER BY `begdate`) | No | `PatientIssuesService::search()` (`src/Services/PatientIssuesService.php:171-211`) | n/a (read) |
| `list_options` (`list_id='reaction'`, `'allergyintolerance-verification'`) | Yes, joined in allergy query | No | `AllergyIntoleranceService::search()` | n/a |
| `list_options` (`list_id='severity_ccda'`) | Yes, per-row lookup | No | `LayoutsUtils::getListItemTitle()` (`src/Common/Layouts/LayoutsUtils.php:17-24`), called from `allergies.html.twig:43` | n/a — one query per allergy row rendered, N+1 pattern |
| `lists_medication` | Yes, joined for `drug_dosage_instructions` etc. | No | `PatientIssuesService::search()` | n/a |
| `lists_touch` | Yes (`getListTouch`, `library/lists.inc.php:130-138`) | No, from this render path | `demographics.php:1128`/`1152`/`1174` (the `listTouched` line in each `$viewArgs`) | n/a |
| `user_settings` | Yes (`getUserSetting`) at render time | Yes, async, from a *different* file (`library/ajax/user_settings.php:26-29`) on collapse toggle | see Logic — collapse persistence | Not transactional; check-then-insert/update race is possible across two users toggling the same card simultaneously for the first time, not verified here |

## Cross-links

- **Opened by:** `interface/patient_file/summary/demographics.php` (§4 of
  `ui/DASHBOARD-MAP.md`)
- **Card chrome shared with:** every other card in
  `templates/patient/card/*.html.twig` (Care Team, Prescriptions, etc.) via
  `card_base.html.twig` — a bug/gap found there (e.g. Findings #4, unescaped
  `btnLink` sink) is not unique to these three cards, it's systemic
- **Edit target:** `interface/patient_file/summary/stats_full.php`
  (`?active=all&category=<type>`) — full, unfiltered issue editor; also
  where the `.noneCheck` "mark as touched" control lives
  (`stats_full.php:484-493`) that flips `listTouched`
- **Same severity-highlight class logic duplicated (not shared) in:**
  `interface/patient_file/summary/stats.php:94` and
  `interface/patient_file/summary/stats_full.php:395` — both independently
  hardcode `['severe','life_threatening_severity','fatal']` rather than
  referencing a shared constant; a fourth copy lives in
  `allergies.html.twig:38`. If the severity vocabulary ever changes, four
  places need to change in lockstep.
- **Related to:** `api/CLINICAL-CARDS.md` DB-03/DB-04/DB-05 — this doc's
  "Logic" section corroborates and extends that doc's filter analysis;
  no corrections needed to its SQL/endpoint claims, only additions (row
  order, severity fallback, touch semantics) that doc didn't cover because
  it was scoped to the API side.
- **Correction to `ui/DASHBOARD-MAP.md` §3:** the "cards open by default"
  claim for the default-collapse-state guess is right for this install but
  for the wrong stated reason — see Logic, "Collapse persistence."

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Smell / reliability | Medium | Collapse-toggle persistence (`updateUserVisibilitySetting`) is bound only inside the `.then()` of an unrelated async fetch (`stats.php`); if that fetch is slow/fails, the click-to-persist wiring for all cards (including these three) never attaches, and Bootstrap's own collapse still works visually, so state silently fails to persist with no user-visible error | `demographics.php:606-609`, `:882-911` | Bind the collapse-persist handler independently of the `stats.php` promise chain, e.g. on document ready |
| 2 | Bug / dead doc | Medium (provisional — **Escalate: yes**, patient-safety-adjacent: burying a "fatal"-severity allergy below the fold contradicts the template's own stated purpose) | `allergies.html.twig`'s docblock claims severe/life-threatening/fatal allergies "always render at the top... regardless of overflow" and describes a `critical_allergy_item_class_list` override hook; neither is implemented — the loop is a plain unsorted iteration and that variable is never read anywhere in the codebase outside the comment itself | `templates/patient/card/allergies.html.twig:6-8,11,39` (behavior); `grep -rn critical_allergy_item_class_list` (zero real usages) | Either implement the documented sort (split high-severity rows to the front before the loop, or add a real Twig sort) or fix the docblock to describe actual behavior |
| 3 | Smell | Low | A card's system-wide default collapse/expand state is not a fixed value in code — it's whichever value the *first* user anywhere to ever toggle that card happened to leave it at (`setUserSetting(..., $createDefault=true, $overwrite=false)` seeds `setting_user=0` once, then never updates it again) | `src/Services/Globals/UserSettingsService.php:84-105`, `library/ajax/user_settings.php:26-29` | Port with an explicit, code-defined default per card rather than reproducing this emergent-from-first-click behavior |
| 4 | Security (pattern, not exploited by these 3 cards) | Medium (provisional — **Escalate: yes**, needs a stronger check across all card callers) | `card_base.html.twig` line 8 concatenates `btnLink` directly into a raw `onclick="..."` HTML attribute with **no escaping filter at all** (`{{ linkMethod == "javascript" ? "onclick=\"" ~ btnLink ~ "\"" : ''}}`), relying on Twig's global `autoescape => false` (`src/Common/Twig/TwigContainer.php:70`) plus manual `|text`/`|attr` discipline everywhere else. For these three cards `btnLink` is server-built from a trusted webroot config string, not request data, so it's not exploitable *here* — but any future/other card that builds `btnLink` from patient- or request-influenced data with `linkMethod: "javascript"` would have an unescaped attribute-injection sink | `templates/patient/card/card_base.html.twig:8,11` | Route `btnLink` for the javascript-onclick case through `js_escape`/`attr` before concatenation, or restructure to avoid inline `onclick` entirely |
| 5 | Smell | Low | `card_container_class_list`, `card_bg_color`, `card_text_color` are emitted in `card_base.html.twig:1` with no escaping filter (`|attr` or otherwise); currently only literal/enum-sourced values reach it (confirmed via `getBackgroundColorClass()`/`getTextColorClass()` callers for other cards, `demographics.php:1264-1265` etc.) but the template itself provides no defense-in-depth | `templates/patient/card/card_base.html.twig:1` | Add `|attr` to the class-list join and the two color variables for consistency with every other attribute in the same file |
| 6 | Correctness (doc) | Low | `ui/DASHBOARD-MAP.md`'s "cards open by default" claim for these three is correct on this install but the reasoning given ("NULL isn't literally 0") is backwards — `NULL == 0` *is* true in PHP; the actual reason is a pre-seeded `setting_user=0` default row | `src/Services/Globals/UserSettingsService.php:40-51`; DB check above | Update `DASHBOARD-MAP.md` §3 if/when consolidated |

## Parity spec for the port

Applies to all three cards unless noted. "API field" cites
`api/CLINICAL-CARDS.md` (DB-03/DB-04/DB-05 sections) or
`api/AUTH-AND-PATIENT.md`.

| PHP-card behavior | Exact spec | API field / endpoint | Gap? |
|---|---|---|---|
| Row filter | `outcome != 1 AND (enddate empty OR enddate in future)`, applied client-side after fetching all rows | Neither `/fhir/AllergyIntolerance`, `/api/patient/:puuid/allergy`, `/api/patient/:puuid/medical_problem`, `/fhir/Condition`, nor `/api/patient/:pid/medication` apply this filter server-side (per `api/CLINICAL-CARDS.md` DB-03/DB-04/DB-05) | Client must reimplement `outcome != 1 && (!enddate \|\| enddate > now)` itself for all three cards |
| Allergies row order | Whatever the SQL returns (no `ORDER BY`) | `AllergyIntoleranceService`/FHIR equivalent also has no `ORDER BY` | No gap — both sides are equally unordered; port can pick a stable order (e.g. by title) without breaking parity, since there's no real order to match |
| Medical Problems / Medications row order | `ORDER BY lists.begdate` | Standard REST `/api/patient/:pid/medication` and `ConditionService`/FHIR `Condition` — ordering not confirmed server-side in `api/CLINICAL-CARDS.md` | **Flag as not available via API** — client must sort by `begdate`/equivalent client-side if this order matters for parity; not verified whether the API even returns a `begdate`-equivalent field for medications |
| Allergy title | `lists.title` | `title` (standard REST) / `AllergyIntolerance.text` narrative (FHIR) | Yes, available |
| Allergy severity display | Raw `severity_al` looked up against `list_options(list_id='severity_ccda')`; falls back to the **raw stored code** (e.g. `"1"`) if no match, or empty string if `NULL` | `severity_al` raw (standard REST) or `AllergyIntolerance.criticality` (FHIR, 3-value enum — lossy) | Standard REST carries the raw value; client must do its own `list_options` lookup (or a static copy of the `severity_ccda` table) to render the human label, and must replicate the same graceful-fallback-to-raw-code behavior to match the legacy display exactly, bugs included |
| Allergy reaction (tooltip only) | `reaction_title` via joined `list_options(list_id='reaction')`, run through `xl_list_label()` (conditional translation) | `reaction`, `reaction_title` (per `api/CLINICAL-CARDS.md`) | Yes, available |
| Allergy severity highlight | `bg-warning font-weight-bold` class on severity text only, for `severe`/`life_threatening_severity`/`fatal` — **NOT** promoted to top of list despite the source docblock's claim | client-side logic against raw `severity_al` | Available (raw `severity_al` field), but note the "promote to top" behavior does **not** need to be ported since it was never real — porting the docblock's claim would be adding a feature, not preserving parity |
| Medical Problems title | `lists.title` | `title` (`ConditionService`) | Yes |
| Medications title + dosage | `lists.title`, `lists_medication.drug_dosage_instructions` | `drug` / `title`, `drug_dosage_instructions` (per `api/CLINICAL-CARDS.md` DB-05 field mapping) | Yes, both available on the non-unioned `/api/patient/:pid/medication` path |
| Empty state — never touched | Exact string **`"Nothing Recorded"`** (all three cards, identical) | Derived client-side: `!listTouched` | **Not available via API.** `listTouched` reads `lists_touch`, a table with no REST/FHIR exposure anywhere (confirmed: not mentioned in `api/CLINICAL-CARDS.md`, and a fresh `grep -rn lists_touch src/RestControllers apis/routes` here finds no hits) |
| Empty state — touched, Allergies | Exact string **`"No Known Allergies"`** | same gap as above | **Not available via API** |
| Empty state — touched, Medical Problems / Medications | Exact string **`"None"`** (source constant is `"None{{Issues}}"`, but the `{{...}}` is always stripped — port the literal word "None", not the source key) | same gap as above | **Not available via API** |
| Collapse/expand default + persisted state | Per-card, per-user, keyed by DOM id (`<type>_ps_expand`) in `user_settings`; true first-viewer-wins global default when no per-user row exists | Not part of clinical data at all — a UI preference | **Not available via API** (and arguably shouldn't be — this is presentation state, not EHR data; a port would define its own preference-storage mechanism, e.g. browser local storage or a new preferences endpoint) |
| Edit-icon-only, no Add-icon | Always shows pencil, never plus, for these three cards specifically (hardcoded `btnLabel: 'Edit'`) | n/a — UI-only decision | Not an API gap; a straightforward behavior to reproduce: single "Edit" affordance per card, linking to the equivalent of `stats_full.php`'s full-list view |
| Pencil link target | Full, **unfiltered** (`active=all`) issue-list page for that `category`, not scoped to the same "active" filter the card itself uses | n/a — would be the port's own "manage <type>" route | Not an API gap, but a spec nuance: the edit destination intentionally shows more rows (including resolved/ended) than the summary card does |

**Everything else (row fields, filters, highlight) has an API equivalent.**
The two genuine, unconditional gaps for these three cards are
**`listTouched`** (drives which of two different empty strings shows) and
the **collapse/expand preference** (UI-only, expected to not need an API
equivalent). Both should be called out explicitly if these cards are
ported per the AGENTS.md "consume the existing API only... gaps are
documented, not patched" rule (DB-10) — `listTouched` in particular
changes *which literal string renders* for an empty list, so silently
dropping it (e.g. always showing "Nothing Recorded") is a visible,
user-facing behavior change, not a cosmetic one.

## Port notes

- **Must survive:** the exact three empty-state strings and the
  touched/untouched distinction that selects between them (a real,
  visible, current behavior — see Parity spec); the per-row filter logic
  (`outcome != 1 AND (no enddate OR future enddate)`) since it's the only
  thing standing between "active issues" and "every issue ever recorded"
  on these cards; the severity-highlight-on-severe/fatal-allergies visual
  cue (Finding #2's *fallback* behavior, not its *claimed* top-of-list
  behavior); the raw-code-fallback quirk for severity display **only** if
  exact bug-for-bug legacy parity is the goal — otherwise this is a good
  candidate to actually fix in the port (show something better than a raw
  `"1"` when the severity code doesn't resolve).
- **Must not survive:** the four-way duplicated severity-vocabulary
  hardcoding (Cross-links); the emergent, first-click-wins global default
  for collapse state (Finding #3) — a port should pick an explicit default
  per card; the unescaped `onclick` sink in `card_base.html.twig` (Finding
  #4) if any port reuses this Twig chrome pattern for new cards with
  less-trusted `btnLink` sources; the dead "sort severe allergies to the
  top" docblock (Finding #2) unless the sort is actually (re)implemented.
- **Open questions:**
  - Should the port actually implement the "severe/fatal allergies sort to
    top" behavior the source docblock describes but the code never does?
    This needs David's call — it reads as an abandoned feature, not
    necessarily an intentional decision to skip it, and it's plausibly
    patient-safety relevant (why Finding #2 is flagged for escalation).
  - `listTouched`/`lists_touch` has no API path at all (same class of gap
    DB-08 Patient Notes has, per `api/CLINICAL-CARDS.md`) — does the port
    drop the untouched/touched distinction (collapsing to a single empty
    string), fake it client-side some other way, or is a backend change
    in scope after all for this one flag?
  - Whether the collapse/expand preference should be ported at all as
    server-persisted state, or downgraded to browser-local UI state given
    it's not clinical data and the legacy persistence mechanism has the
    first-click-wins quirk noted above.

---

Wrote: C:\Users\david\repos\agentforge-week1-w2-dashboard\docs\legacy-audit\ui\CARD-TEMPLATES.md
Tier: 2 · Confidence: high
Escalate: yes — two provisional Medium findings need a stronger model's confirmation before any severity is marked "(verified)": #2 (Allergies severity-sort documented but not implemented — patient-safety-adjacent, since it means a fatal-severity allergy is not guaranteed visible without scrolling) and #4 (unescaped `btnLink` onclick sink in the shared `card_base.html.twig` — not exploitable via these three cards today since their `btnLink` values are server-trusted, but a systemic pattern issue in a template every dashboard card extends).
Unit: Allergies / Medical Problems / Medications card templates (`templates/patient/card/{allergies,medical_problems,medication}.html.twig` + shared `card_base.html.twig`) — Twig `content` blocks rendered synchronously by `demographics.php` for the three "in-scope" issue-list cards.
Findings: 0 Critical, 0 High, 3 Medium, 3 Low
Top findings:
- [Medium, escalate] Allergies card docblock claims severe/fatal allergies always sort to the top of the card; the actual `{% for l in list %}` loop never sorts, and the `critical_allergy_item_class_list` override hook it also documents is read nowhere in the codebase (`templates/patient/card/allergies.html.twig:6-8,39`)
- [Medium, escalate] `card_base.html.twig` builds a raw `onclick="..."` attribute by string-concatenating `btnLink` with zero escaping, relying entirely on `autoescape => false` plus caller discipline; not exploited by these three cards (trusted `btnLink` values) but a systemic sink in shared chrome (`templates/patient/card/card_base.html.twig:8`)
- [Medium] Collapse-state persistence click handler is bound only after an unrelated async fetch (`stats.php`) resolves; a slow/failed fetch silently breaks persistence for every card with no visible error (`demographics.php:606-609`)
Cross-links to add elsewhere:
- `ui/DASHBOARD-MAP.md` §3: correct the "cards open by default... presumably" reasoning — `NULL == 0` is true in PHP; the actual mechanism is a pre-seeded `setting_user=0` default row plus first-click-wins semantics (see this doc's Logic section)
- `api/CLINICAL-CARDS.md`: add `lists_touch`/`listTouched` as a confirmed API gap (same shape as the DB-08 Patient Notes gap) for DB-03/DB-04/DB-05's empty-state text, not previously called out there
Open questions:
- Was the "severe/fatal allergies sort to top" behavior in the Allergies docblock ever implemented and later removed, or was it always aspirational? Affects whether the port should build it fresh.
- Does `listTouched` get ported (needs a new mechanism, since there's no API path) or dropped (collapsing two empty states into one, a visible behavior change)?
- Is the collapse/expand preference meant to be server-persisted in the port, or is this a good place to switch to purely client-local UI state given the legacy mechanism's first-click-wins quirk?
