# `stats.php` — Async "generic issue type" card renderer for the patient dashboard

`stats.php` is a fragment endpoint, not a page: it is fetched by an
authenticated AJAX POST from `demographics.php`'s document-ready handler and
its HTML output is injected into an empty `<div id="stats_div"></div>` shell
that `demographics.php` emits inline. It renders every dashboard "issue
type" card that is *not* one of the three hardcoded issue cards
(Allergies, Medical Problems, Medications) already rendered directly by
`demographics.php` — in this codebase that resolves to **Health Concerns**
and **Immunizations**, plus (only if the corresponding legacy form module
happens to be installed and has data) Treatment Protocols/Injury Log, and
(only if the patient has rows in that issue type) Medical Devices, Surgery,
or Dental. It also contains two medication-related code paths — an eRx
"Current Medications" card and an "Old Medication" card — that read from
`lists`/`prescriptions`, but as traced below neither can ever execute in
this codebase, in any configuration. Control does not "go" anywhere after
`stats.php` finishes; it echoes HTML/script back to the AJAX caller, which
splices it into the DOM.

**Source:** `interface/patient_file/summary/stats.php` · 344 lines (also
traced: `library/lists.inc.php:82-98` for `$ISSUE_TYPES` construction, cited
by `path:line` throughout) · no version header present.
**Audited by:** tier 2 · confidence high

## Purpose & lifecycle

1. `demographics.php:2024` echoes an empty `<div id="stats_div"></div>`
   inside the `if ($thisauth):` region gated by the page-level ACL
   (`AclMain::aclCheckCore('patients','demo')`, `demographics.php:1056-1061`,
   see `ui/DASHBOARD-MAP.md` §2.4). If that gate fails, the div (and
   everything below it) never renders and `stats.php` is never fetched.
2. `demographics.php:606`, inside the jQuery `$(function () {...})`
   document-ready handler (`demographics.php:543` onward — fires as soon as
   the DOM is parsed, no user click needed): `placeHtml("stats.php",
   "stats_div", true)`. The `true` third argument is `sessionRestore`,
   which makes the underlying `fetchHtml()` call `top.restoreSession()`
   first (`demographics.php:494-513`, see `ui/DASHBOARD-MAP.md` §7) — one of
   only two call sites in the whole file that do this, which is also one of
   the two sources of the `top.restoreSession is not a function` console
   error RECON observed outside the tabbed shell.
3. `stats.php:13` `require_once("../../globals.php")` — same auth/session
   bootstrap as every other `interface/*` entry point
   (`interface/globals.php:725-728`), but note `stats.php` does **not**
   repeat the page-level `AclMain::aclCheckCore('patients','demo')` check
   that gated the div in step 1 — see Permission checks below.
4. `stats.php:16` reads `$pid = $session->get('pid', 0)` — the same session
   pid `demographics.php` already resolved; `stats.php` does not accept or
   trust a `$_GET`/`$_POST` pid of its own.
5. `stats.php:25` `CsrfUtils::checkCsrfInput(INPUT_POST, dieOnFail: true)` —
   the AJAX call must be a POST carrying a valid CSRF token or the script
   dies here.
6. Four independent rendering blocks run in file order (not otherwise
   gated on each other): the issue-type loop (§Logic 1), the
   Treatment-Protocols/Injury-Log loop (§Logic 3), the Immunizations block
   (§Logic 4), and the dead "Old Medication" block (§Logic 5). Each
   `echo $t->render(...)`s a Twig fragment that becomes one more collapsible
   card appended after whatever was already in `#stats_div`.

## Layout / interface

Not a page with its own controls; it emits a sequence of card partials,
each extending `patient/card/card_base.html.twig` (the standard collapsible
card chrome used everywhere on the dashboard — its own collapse-toggle
click handler is wired back in `demographics.php:607-609`, right after
`placeHtml("stats.php", ...)` resolves). Card templates used:

| Card | Twig template | Rendered from |
|---|---|---|
| Each issue-type card (Health Concerns, etc.) | `patient/card/medical_problems.html.twig` (`stats.php:233`) | main loop, `stats.php:148-236` |
| eRx "Current Medications" (dead — see Findings #1) | `patient/card/erx.html.twig` (`stats.php:180`) | main loop, erx branch |
| Injury Log / Treatment Protocols | `patient/card/tp_il.html.twig` (`stats.php:261`) | `stats.php:239-270` |
| Immunizations | `patient/card/immunizations.html.twig` (`stats.php:304`) | `stats.php:273-314` |
| "Old Medication" (dead — see Findings #2) | `patient/card/medical_problems.html.twig` (`stats.php:342`) | `stats.php:317-343` |

Note `medical_problems.html.twig` is reused verbatim for every generic
issue-type card *and* for the (dead) Old Medication card — it is the same
template `demographics.php` uses for the real Medical Problems card
(`ui/DASHBOARD-MAP.md` row for Medical Problems). It renders only `l.title`
per row (`templates/patient/card/medical_problems.html.twig:19`), with
empty-state text `"Nothing Recorded"` (`:13`) or, if `listTouched` is true,
`"None{{Issues}}"` (`:9`, xlt-translated to `"None"` in the Issues context).

## State

```text
$srcdir              // OEGlobalsBag src dir, stats.php:14
$session              // active session wrapper, stats.php:15
$pid                  // session pid, stats.php:16
$ISSUE_TYPES          // OEGlobalsBag('ISSUE_TYPES'), copy of the per-request
                       // global lists.inc.php built (see below), stats.php:31
$need_head             // true, unused flag guarding the Treatment-Protocols
                       // block header (stats.php:32, 251) — no head is ever
                       // actually emitted conditionally on it besides itself
$erx_upload_complete   // 0 at stats.php:134; can only become 1 inside dead
                       // code (Findings #1/#2)
$old_key               // "" at stats.php:135; tracks the previous loop
                       // iteration's $key, used only by the dead erx branch
$display_current_medications_below // 1 at stats.php:136, set to 0 only
                       // inside the same dead branch; never read anywhere
```

**Globals read:** `$ISSUE_TYPES` (via `OEGlobalsBag::get('ISSUE_TYPES', [])`, `stats.php:31` — populated per-request by `library/lists.inc.php:82-98`, itself a `SELECT * FROM issue_types WHERE active=1 AND category=? ORDER BY ordering` keyed by `issue_types.type`); `erx_enable`, `erx_medication_display`, `erx_allergy_display`, `erx_import_status_message`-style OEGlobalsBag booleans (`stats.php:59,63,154,157,191,217`); `disable_immunizations`, `weight_loss_clinic`, `use_custom_immun_list` (`stats.php:273,290`); web root (`stats.php:216,336`).
**Globals written:** none (no `$GLOBALS`/`OEGlobalsBag::set` calls in this file).
**DB tables read:** `lists` (+ `lists_medication` join for medication rows), `prescriptions`, `form_treatment_protocols`/`form_injury_log` (existence-checked), `immunizations` (+ `code_types`/`codes`), `lists_touch` (via `getListTouch()`). No writes.

## Logic

### Issue-type card loop — `stats.php:138-236`

`$reducedIssueTypes = $ISSUE_TYPES` then, for each of `['allergy',
'medication', 'medical_problem']`, `unset($ISSUE_TYPES[$i])` if present
(`stats.php:139-146`). **This unconditionally removes all three in-scope
issue types from the working copy before the loop below ever runs — there
is no config flag or code path that keeps them in.** Confirmed against the
local dev DB: `issue_types` has rows for exactly `medical_problem` (ordering
10), `health_concern` (15), `allergy` (20), `medication` (30),
`medical_device` (35, `force_show=0`), `surgery` (40, `force_show=0`),
`dental` (50, `force_show=0`) for `category='default'`, `active=1`
(read-only `SELECT` against `agentforge-week1-mysql-1`, per the audit's
allowed SQL rule). After removing `allergy`/`medication`/`medical_problem`,
the loop at `stats.php:148` iterates the remainder **in `ordering` order**
(the DB `ORDER BY` from `lists.inc.php:84` is preserved because PHP's
`unset()` on an associative array doesn't reorder the survivors): first
`health_concern`, then `medical_device`, `surgery`, `dental` (the last
three all have `force_show=0`, so per `stats.php:189` — `count($issues) > 0
|| $arr[4] == 1` — they only render if the patient actually has rows of
that type; not traced further, out of scope).

For each surviving `$key`:
- **ACL:** `AclMain::aclCheckIssue($key)` (`stats.php:150`) — skips the type
  entirely (`continue`) if it fails. `AclMain::aclCheckIssue()`
  (`src/Common/Acl/AclMain.php:365-373`) looks up `$ISSUE_TYPES[$type][5]`
  (the `issue_types.aco_spec` column) and, if non-empty, delegates to
  `aclCheckAcoSpec()`; if empty, returns `true` (no restriction). All seven
  `category='default'` rows in the local DB have `aco_spec = 'patients|med'`
  (confirmed by SQL), so in practice every generic issue-type card is gated
  on `patients/med`, not the page-level `patients/demo` — see Permission
  checks.
- **eRx "Current Medications" branch (`stats.php:154-183`) — dead code.**
  Guarded by `$old_key == "medication" && erx_enable && $erx_upload_complete
  == 1`. `$old_key` is only ever assigned inside this same loop, at
  `stats.php:190` (`$old_key = $key`), and `$key` can never be the literal
  string `"medication"` because that key was already `unset()` from
  `$ISSUE_TYPES` at `stats.php:144` before the loop started. **This branch
  can never execute, in any global/erx configuration** — the condition it
  guards on is unreachable, not merely usually-false. See Findings #1.
- `$issues = getListData($pid, $key)` (`stats.php:186`, defined
  `stats.php:41-105`) — builds `SELECT [lists.* | lists.* + lists_medication
  columns for type='medication'] FROM lists WHERE pid=? AND type=? AND
  <dateEmptySql('enddate')> ORDER BY begdate` (`stats.php:44-56,67`).
  `dateEmptySql('enddate')` (`library/sanitize.inc.php:173-190`, no `$rev`
  arg passed so the non-reversed branch) expands to `` (`enddate` IS NULL OR
  `enddate`='0000-00-00') `` — **a SQL-level filter for "no end date at
  all"**, unlike the hardcoded Allergies/Medical-Problems/Medications cards
  in `demographics.php`, which fetch everything and then apply the PHP-level
  `filterActiveIssues()` (`outcome!=1 AND (no enddate OR enddate in the
  future)`, `demographics.php:1110-1113`, `api/CLINICAL-CARDS.md` DB-03/04).
  **A generic issue-type card (e.g. Health Concerns) therefore uses a
  different, narrower filter rule than the in-scope cards**: no `outcome`
  check at all, and a *future* `enddate` still excludes the row here (the
  in-scope cards' PHP filter explicitly keeps future-dated `enddate` rows;
  this SQL filter does not). For `type='allergy'` specifically (unreachable
  here, but shared code) `getListData()` also resolves `reactionTitle` via
  `getListItemTitle("reaction", ...)` and collapses `severity_al` into a
  3-value `critical` flag plus a `severity` title via `getListItemTitle`
  (`stats.php:82-99`, `src/Common/Layouts/LayoutsUtils.php:17`) — the same
  lookup `api/CLINICAL-CARDS.md` documents as the source of RECON's "(1)"
  raw-code fallback on the real Allergies card.
- If `count($issues) > 0 || $arr[4] == 1` (force_show), it re-fetches via a
  second, identical `getListData($pid, $key)` call (`stats.php:205` —
  redundant with line 186's call; same query runs twice per rendered
  type), builds `$viewArgs` with `title => xl($arr[0])` (the plural label
  from `issue_types.plural`), a per-user collapse state via
  `getUserSetting($id) == 0` (`stats.php:210`, `$id = "<type>_ps_expand"`,
  same `UserSettingsService`-backed mechanism `ui/DASHBOARD-MAP.md` §3
  documents for the primary cards), and an edit link. The edit link
  (`stats.php:216-224`) is normally `Edit → stats_full.php?active=all&
  category=<key>` — the **same edit page** the real Allergies/Medical
  Problems/Medications cards link to (`ui/DASHBOARD-MAP.md` row entries),
  except for `allergy`/`medication` when `erx_enable` is on, where the
  button instead reads `"Add"` and links to `eRx.php?page=medentry`
  (`stats.php:217-219`) — **also dead**, since `allergy`/`medication` never
  reach this code (removed at `stats.php:144`).
- If the fetched list is empty, `listTouched` is set from `getListTouch($pid,
  $key)` (`stats.php:227`, `library/lists.inc.php:130-139`, reads the
  `lists_touch` table) — drives the `"None"` vs `"Nothing Recorded"`
  empty-state text choice in the twig template.
- Renders `patient/card/medication.html.twig` only if `$id ==
  "medication_ps_expand"` (`stats.php:230-231`) — **unreachable**, same
  reason (`medication` removed) — otherwise always
  `patient/card/medical_problems.html.twig` (`stats.php:233`), which is why
  Health Concerns and the other generic types visually look exactly like a
  plain Medical-Problems-style title list, not a medications-style
  dosage list.

### `getPrescriptions($pid)` — `stats.php:107-121` — dead function

Defined but never called anywhere in `interface/`, `library/`, or `src/`
(confirmed by grep across all three trees). It duplicates the
`SELECT * FROM prescriptions WHERE patient_id=? AND active='1'` query that
*is* live, inline, inside the dead erx branch at `stats.php:158` — evidence
this function was likely factored out and then the call site never
switched over to it. See Findings #3.

### Treatment Protocols / Injury Log loop — `stats.php:239-270`

For each of `['treatment_protocols', 'injury_log']`: `SHOW TABLES LIKE
'form_{$formname}'` (`stats.php:240`) — confirmed against the local dev DB
that **neither `form_treatment_protocols` nor `form_injury_log` exists**,
so this whole block is currently inert in this deployment regardless of
data. If the table did exist and had matching `forms`-joined rows starting
with `'0%'` (`stats.php:248`), the loop at `stats.php:253-258` has a
variable-name bug: it writes `$formRws['templateName'] = $template_name;`
(`stats.php:256`, missing the `o` — should be `$formRows`), so
`$formRows['templateName']` is **never set**. Separately, `$formRows` is
re-assigned by bare-key writes (`$formRows['startDate'] = ...`,
`$formRows['id'] = ...`) inside the `while` loop rather than appended as a
list (`$formRows[] = [...]`), so if the query returns more than one row
only the **last** row's `startDate`/`id` survive into the array passed to
the template. `templates/patient/card/tp_il.html.twig:6` then does
`{% for r in formRows %}` over that flat associative array — which iterates
its scalar *values* (a date string, then an id), not row objects — so
`r.startDate`/`r.id`/`r.templateName` (`tp_il.html.twig:9`) would resolve
against a string/int, not a keyed row, and render blank. See Findings #4.

### Immunizations — `stats.php:273-314`

Gated by `!disable_immunizations && !weight_loss_clinic` (`stats.php:273`,
OEGlobalsBag booleans) — **not** gated by any ACL/`AclMain` call and **not**
subject to `demographics.php`'s `hide_dashboard_cards` mechanism (see
Findings #5). Query (`stats.php:274-282`): `immunizations` LEFT JOIN
`code_types`/`codes` for the CVX code's display text, `WHERE patient_id=?
AND added_erroneously=0 ORDER BY administered_date DESC`. Per row, the
display label (`$row['field']`) comes from either the custom immunization
list (`use_custom_immun_list` on, `generate_display_field()` against
`list_id='immunizations'`) or the CVX code text, falling back to the same
`generate_display_field()` lookup if no CVX text (`stats.php:290-298`).
Each row's click target is `immunizations.php?mode=edit&id=<id>&
csrf_token_form=<token>` (`stats.php:300`, CSRF token minted inline via
`CsrfUtils::collectCsrfToken()`). Renders
`patient/card/immunizations.html.twig`, which shows only `i.cvx_text` per
row (`immunizations.html.twig:12` — note: not `i.field`, so the
custom-list/fallback label computed above is actually unused by the
current template; the raw `cvx_text` join column is what's shown) with
empty text `"None{{Immunizations}}"` (`:7`, xlt-translated to `"None"` in
the Immunizations context — this out-of-scope card's empty string is
literally `"None"`, distinct from the in-scope cards' `"Nothing Recorded"`).

### "Old Medication" card — `stats.php:317-343` — dead code

`if ($erx_upload_complete == 1)`. The only assignment to
`$erx_upload_complete` anywhere in the file is at `stats.php:200`, itself
inside the unreachable erx branch traced above (issue-type loop section).
**This entire block — including its own `SELECT * FROM lists WHERE pid=? AND
type='medication' AND <dateEmptySql('enddate')> ORDER BY begdate` query and
its `medical_problems.html.twig` render with title "Old Medication" — can
never execute**, in any configuration, because the flag that gates it can
never be set to `1`. See Findings #2.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| Fetching `stats.php` at all (the container div existing) | yes, but only indirectly | Page-level `AclMain::aclCheckCore('patients','demo')` in `demographics.php:1056-1061` gates whether `<div id="stats_div">` (`demographics.php:2024`) is ever emitted for `placeHtml()` to target | If that check fails the div never exists and the AJAX call has nothing to inject into, but nothing stops a direct POST to `stats.php` itself — see next row |
| `stats.php` request itself | **missing** (page-level) | `stats.php` never calls `AclMain::aclCheckCore('patients', 'demo')` or repeats any squad check; it only does `CsrfUtils::checkCsrfInput` (`stats.php:25`) and reads `$pid` from the session (`stats.php:16`) | Contrast with `pnotes_fragment.php`, which `ui/DASHBOARD-MAP.md` row for Messages notes "independently re-checks the same ACL" at load time. `stats.php` has no equivalent self-check — a valid session + CSRF token is enough to invoke it and get *some* HTML back for whatever `$_SESSION['pid']` currently is, gated only per-issue-type (next row). **Provisional — not verified whether this is exploitable (e.g. whether `$_SESSION['pid']` can independently be set to a patient the current ACL role can't view `patients/demo` for); tier 2, not confirmed.** |
| Each generic issue-type card | yes, per type | `AclMain::aclCheckIssue($key)` (`stats.php:150`) → `AclMain::aclCheckIssue()` (`src/Common/Acl/AclMain.php:365-373`) checks `issue_types.aco_spec` for that type, all `'patients|med'` in the local DB (confirmed by SQL) | This is the `patients/med` ACO, not `patients/demo` — a narrower/different check than the page-level gate, same pattern `ui/DASHBOARD-MAP.md` notes for Care Team reusing the page ACL rather than a card-specific one, but inverted (here it's a *different*, not *same*, ACO) |
| Immunizations card | **missing** | No `AclMain` call anywhere in the Immunizations block (`stats.php:273-314`); only feature-flag gates (`disable_immunizations`, `weight_loss_clinic`) | Anyone who can reach `stats.php` at all sees Immunizations regardless of role-based ACL |
| Treatment Protocols / Injury Log | **missing** | No `AclMain` call; gated only by table existence and data presence (`stats.php:240,251`) | Currently moot — tables don't exist in this deployment |
| "Old Medication" / eRx "Current Medications" | n/a | Dead code, never reached | — |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `issue_types` | Yes (indirectly, via `$ISSUE_TYPES`) | No | `library/lists.inc.php:83-98`, consumed in `stats.php:31,139-236` | No |
| `lists` (+ `lists_medication` join) | Yes | No | `getListData()`, `stats.php:41-105`; also `stats.php:319-323` (dead) | No |
| `lists_touch` | Yes | No | `getListTouch()`, `library/lists.inc.php:130-139`, called `stats.php:227` | No |
| `prescriptions` | Yes | No | `getPrescriptions()` (dead, `stats.php:107-121`); inline dupe at `stats.php:158` (dead) | No |
| `form_treatment_protocols` / `form_injury_log` | Yes (existence + rows) | No | `stats.php:240-250` | No |
| `forms` | Yes | No | joined at `stats.php:242` | No |
| `immunizations` (+ `code_types`, `codes`) | Yes | No | `stats.php:274-282` | No |

No writes anywhere in this file — pure read/render.

## Cross-links

- **Opened by:** `interface/patient_file/summary/demographics.php` (`placeHtml("stats.php", "stats_div", true)`, `demographics.php:606`), only reachable if `demographics.php`'s page-level ACL gate passed (`demographics.php:1056-1074`).
- **Opens:** `interface/patient_file/summary/stats_full.php` (edit link, `stats.php:222`); `interface/forms/eRx.php` (dead, `stats.php:219`); `interface/forms/<formname>/new.php` (dead in this deployment, `templates/patient/card/tp_il.html.twig:9`); `interface/patient_file/summary/immunizations.php` (`stats.php:300`, `immunizations.html.twig:12`).
- **Calls into:** `library/lists.inc.php` (`$ISSUE_TYPES` build, `getListById`/`getListTouch`/`setListTouch`), `library/sanitize.inc.php` (`dateEmptySql`), `library/options.inc.php`/`src/Common/Layouts/LayoutsUtils.php` (`getListItemTitle`, `generate_display_field`), `src/Common/Acl/AclMain.php` (`aclCheckIssue`), `library/user.inc.php` → `UserSettingsService` (`getUserSetting`).
- **Shares data/filter logic with:** the in-scope Allergies/Medical-Problems/Medications cards in `demographics.php` (same `lists` table, same `getListItemTitle` severity lookup for allergy rows) — but see Findings for why the filter rule and ACL differ.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Dead code | Low | eRx "Current Medications" branch can never execute: its guard condition depends on `$old_key`/`$key == "medication"`, but `"medication"` is unconditionally removed from `$ISSUE_TYPES` before the loop starts | `stats.php:139-146` (removal), `154,190-191` (unreachable guard) | Delete the branch, or move the `medication` exclusion after this check if the eRx card was meant to still fire |
| 2 | Dead code | Low | "Old Medication" card can never execute: its sole gate, `$erx_upload_complete == 1`, is only ever set inside the dead branch from Finding #1 | `stats.php:200` (only assignment), `317` (guard) | Delete the block, or fix Finding #1 first if the card is meant to be reachable |
| 3 | Dead code | Low | `getPrescriptions($pid)` is defined but never called anywhere in `interface/`, `library/`, or `src/` | `stats.php:107-121` (confirmed via repo-wide grep) | Delete the function |
| 4 | Bug | Medium | Injury Log / Treatment Protocols card, if its form tables existed and had rows: `$formRws['templateName']` typo means `templateName` is never populated, and `$formRows` is overwritten per-row instead of appended, so the Twig loop iterates scalar values instead of row objects — the card would render garbled/blank. Currently inert in this deployment because `form_treatment_protocols`/`form_injury_log` don't exist (confirmed by SQL), but the code-level bug exists independent of that | `stats.php:253-258` (bug), `templates/patient/card/tp_il.html.twig:6-9` (fallout) | Fix the typo and append rows as a list (`$formRows[] = [...]`) instead of overwriting scalar keys |
| 5 | Smell / Gap | Low | Cards rendered by `stats.php` (Health Concerns, Immunizations, etc.) are not covered by `demographics.php`'s `hide_dashboard_cards` admin setting — that check exists only in `demographics.php`'s own hardcoded card blocks and is never passed into or consulted by `stats.php` | `demographics.php:101,138-147` (mechanism, local to that file); no corresponding check anywhere in `stats.php` | Out of scope for a read-only audit; note for the catalog if `hide_dashboard_cards` parity ever matters |
| 6 | Security | Medium (provisional) | `stats.php` performs no page-level ACL check of its own (`patients/demo` or the squad check `demographics.php` applies) — only a per-issue-type `patients/med` check inside the loop and no check at all for Immunizations. A direct authenticated POST to `stats.php` with a valid CSRF token returns whatever the current `$_SESSION['pid']` is, without re-verifying page-level view authorization the way `pnotes_fragment.php` does | `stats.php:25` (only check), contrast `ui/DASHBOARD-MAP.md` Messages row (`pnotes_fragment.php` "independently re-checks the same ACL") | Add an `AclMain::aclCheckCore('patients','demo')` guard at the top of `stats.php`, mirroring `pnotes_fragment.php`; **Escalate: yes** — not verified whether this is practically exploitable, tier 2 |

## Port notes

- **Must survive (n/a for in-scope cards):** none — no in-scope card
  (Allergies, Medical Problems, Medications) is ever rendered by this file
  in any live configuration (see Parity section).
- **Must not survive:** the two dead medication code paths (Findings #1,
  #2) and the unused `getPrescriptions()` function (Finding #3) should not
  be treated as reference behavior for the port — they never ran in the
  legacy app either. The Injury-Log typo bug (Finding #4) should likewise
  not be reproduced if that card is ever ported.
- **Open questions:** none affecting the in-scope cards. For the catalog
  (not this port): should Health Concerns/Immunizations someday respect
  `hide_dashboard_cards` (Finding #5)? Should `stats.php` gain its own
  page-level ACL check (Finding #6)? Both are out of scope for the
  read-only, parity-only dashboard port per `AGENTS.md`/`REQUIREMENTS-TRACE.md` A1.

## Parity spec for the port

**None of the three in-scope cards (Allergies, Medical Problems,
Medications) are rendered by `stats.php` in any reachable configuration.**
They are rendered exclusively by `demographics.php` itself
(`demographics.php:1116-1182`, already specified in `ui/DASHBOARD-MAP.md`
§4 and `api/CLINICAL-CARDS.md` DB-03/04/05). `stats.php` explicitly removes
all three from its working `$ISSUE_TYPES` copy before its rendering loop
(`stats.php:139-146`), and the only two code paths in this file that *do*
touch medication data — the eRx "Current Medications" card and the "Old
Medication" card — are dead/unreachable in every configuration (Findings
#1, #2). **This file contributes nothing to DB-03/DB-04/DB-05 parity and
the port can ignore it entirely for those three cards.**

The cards this file *does* render live (Health Concerns, Immunizations,
and conditionally Medical Devices/Surgery/Dental/Injury-Log) are all
out-of-scope per `REQUIREMENTS-TRACE.md` A1 ("Remaining cards go to a
parity checklist marked 'not ported'"). Short descriptions, for that
checklist:

- **Health Concerns** (`issue_types.type='health_concern'`, ordering 15):
  a plain title list, same `medical_problems.html.twig` template and same
  `patients/med` ACO as the in-scope cards, but a different, SQL-level
  "no enddate at all" filter (`dateEmptySql('enddate')`,
  `stats.php:44-56`) instead of `demographics.php`'s PHP-level
  `filterActiveIssues()` — not a shared filter rule with the in-scope
  Medical Problems card despite the shared template.
- **Immunizations**: title-only list of CVX-coded immunization events,
  `WHERE added_erroneously=0 ORDER BY administered_date DESC`
  (`stats.php:274-282`), empty text `"None"`, no ACL check at all
  (Finding, Permission checks table).
- **Medical Devices / Surgery / Dental**: same generic issue-type loop as
  Health Concerns, `force_show=0` (only render if the patient has rows);
  not observed with data in Phase 0/1; not traced beyond the shared loop
  logic above.
- **Injury Log / Treatment Protocols**: existence-gated on
  `form_treatment_protocols`/`form_injury_log` tables, which don't exist in
  this deployment (confirmed by SQL) — currently always absent, and buggy
  (Finding #4) if it were ever populated.
