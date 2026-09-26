# Legacy router and issue-list helpers — `controller.php` dispatch and `lists.inc.php`

Two small, unrelated legacy units bundled into one audit because neither is
on the dashboard-port's read path, but both back parts of the *current* PHP
dashboard that the port must reason about for parity: the Prescriptions
card's "Edit"/"Add" flow (B-14) routes through `controller.php` →
`Controller.class.php`, and the Allergies/Medical-Problems/Medications
cards' issue-type machinery and "touched" empty-state text depend on
`library/lists.inc.php`. Written for the person deciding what the SPA can
ignore vs. what it must document as a gap.

**Sources:**
- `library/classes/Controller.class.php` · 317 lines · no version header (doc-block only, multiple authors/copyrights 2026)
- `library/lists.inc.php` · 152 lines · no version header

**Audited by:** tier 2 · confidence high · not escalated (see Findings — one provisional High is recorded per the tier-2 rule, not because the evidence is weak)

## Scope note: not on the port's read path

Neither file is a REST/FHIR controller or service; the SPA calling only
`apis/dispatch.php` routes will never execute either file. So the "API
contract for the port" section below is short by design — there isn't one.
What *does* carry over to the port:

- **`Controller.class.php`**: nothing functional. The port doesn't render
  Smarty templates or route through `controller.php`. The one thing worth
  carrying into the port's own design notes is the *lesson* from B-14 (string
  concatenation of a URL base that already ends in `?` is fragile) — not code
  to port.
- **`lists.inc.php`**: two behaviors the port needs to know about even though
  it can't call this file:
  1. **Issue-type card titles/ordering** — the plural/singular/abbreviated
     titles and the DB-driven `ordering` column this file reads into
     `$ISSUE_TYPES` are the source of truth for how "Health Concerns",
     "Immunizations", etc. are labeled and sequenced on the PHP dashboard
     (see `ui/DASHBOARD-MAP.md` §3). Out of scope for the six required
     cards (A1), but if the port ever adds a generic issue-type card, this
     is where the labels/order come from, and there's no REST equivalent —
     a client would need `GET` on the `issue_types` table indirectly (no
     such endpoint was found in Phase 1's API maps).
  2. **`list_touch` empty-state semantics** — see Finding 6 below. This
     directly affects the Allergies/Medical-Problems/Medications empty-state
     text Phase 2 signed off on ("Nothing Recorded" for all empty lists) and
     is not a small nuance — it changes what a faithful port must render
     when a list is empty.

## Purpose & lifecycle

**`Controller.class.php`** is the legacy request router for
`controller.php` (repo root). `controller.php` `require_once`s
`interface/globals.php` (session/login gate — the only auth check upstream
of this file; see `ui/DASHBOARD-MAP.md` §2 for the equivalent flow on
`demographics.php`) then does:

```php
$controller = new Controller();
$dispatcher = isset($_GET['controller']) ? $controller->dispatch(...) : $controller->act(...);
echo $dispatcher($_GET);
```

(`controller.php:14-20`, read directly — not previously mapped.) Two entry
points converge on the same `dispatch()`:
- **`dispatch(array $params)`** (order-independent, explicit `controller`/
  `action` keys) — the intended modern path, added per
  `tests/Tests/RestControllers/ControllerRoutingTest.php` to fix
  [openemr#11162](https://github.com/openemr/openemr/issues/11162) (URL
  param order bugs from `URLSearchParams`).
- **`act(array $qarray)`** (`@deprecated`, positional: first `$_GET` key is
  the controller name, second is the action) — still the *only* path any
  in-repo caller actually uses, because every link-building template in
  this repo builds bare positional query strings like
  `controller.php?prescription&list&id=5` (confirmed by grep across
  `templates/`, `controllers/`, `interface/` — see Findings). `act()`
  reshapes its input into `dispatch()`'s param shape and delegates.

`dispatch()` validates the controller name against a fixed whitelist
(`VALID_CONTROLLERS`), ACL-gates it (`checkControllerAcl()`, see Permission
checks), loads `controllers/C_<Name>.class.php`, instantiates it, and calls
either `<action>_action()` or, if `$_POST['process']==='true'` and a
`<action>_action_process()` method exists, that first (form-submission
pattern: render, then process-and-redisplay).

**`lists.inc.php`** is not a router or a class — it's a legacy "include and
run" file. Top-level code executes two SQL queries unconditionally on every
`require`/`include` (see State), building four superglobal-ish arrays used
by `stats.php`/`demographics.php`/`add_edit_issue.php` and others. Below
that, six standalone functions provide CRUD-ish helpers on the `lists` and
`lists_touch` tables — most of which have zero callers (see Findings).

## Layout / interface

**`Controller` public surface** (all instance methods; `library/classes/Controller.class.php`):

| Method | Signature | Callers (grepped) |
|---|---|---|
| `__construct()` | `()` | `controller.php:16`, every `new Controller()`/subclass |
| `set_current_action` | `($action)` | not called externally (dead in this repo) |
| `default_action` / `process_action` | `()` | fallback stubs; overridden by every `C_*` subclass's own actions |
| `populate_object` | `(&$obj)` | not called externally in this repo (grep: 0 hits outside this file) |
| `function_argument_error` | `(): never` | `populate_object` only (itself uncalled) |
| `i_once` | `($file)` | `dispatch()` internally; test-mocked in `ControllerRoutingTest` |
| `checkControllerAcl` (private) | `(string $controllerName): void` | `dispatch()` only |
| `throwAccessDenied` (protected) | `(string $comment, string $message, string $auditEvent = 'security-access-denied'): never` | `checkControllerAcl()` only |
| `act` | `(array $qarray): string` `@deprecated` | `controller.php:19` (the actual live path — see Findings), `ControllerRoutingTest.php:111,178` |
| `dispatch` | `(array $params): string` | `controller.php:19`, `act()`, `ControllerRoutingTest.php` |
| `methodExists` (private) | `(object $controllerObj, string $method): bool` | `dispatch()` only |
| `escapeForTextNode` (private static) | `(mixed $value): string` | registered as the Smarty `text` modifier in `__construct()` (`:74`) |
| `_link` | `($action = "default", $inlining = false)` | `C_Document.class.php` (12 call sites), `C_DocumentCategory.class.php` (4 call sites) — not called by `C_Prescription`, `C_Pharmacy`, or any other controller |

**`lists.inc.php` public surface** (global functions, no class):

| Function | Signature | Callers (grepped, this repo) |
|---|---|---|
| `collect_issue_type_category` | `()` | called once, top-level in this same file (`:85`) |
| `getListById` | `($id, $cols = "*")` | **none found** (grep: only its own definition) |
| `addList` | `($pid, $type, $title, $comments, $activity = "1")` | **none found** |
| `disappearList` | `($id)` | **none found** |
| `reappearList` | `($id)` | **none found** |
| `getListTouch` | `($patient_id, $type)` | `demographics.php:1128,1152,1174` (Allergies/Medical-Problems/Medications cards) |
| `setListTouch` | `($patient_id, $type): void` | `library/ajax/lists_touch.php:25` (AJAX endpoint, CSRF-checked, POST-only) |

`getListById`/`addList`/`disappearList`/`reappearList` are dead in this
repo — zero callers found via `grep -rn <name>\( --include=*.php` from the
repo root. See Finding 5.

## State

```text
$ISSUE_TYPE_CATEGORIES   // global, built at include-time (lists.inc.php:47-59)
$ISSUE_TYPE_STYLES       // global, static literal (lists.inc.php:61-67)
$ISSUE_TYPES             // global, built at include-time from `issue_types` table (lists.inc.php:82-98)
$ISSUE_CLASSIFICATIONS   // global, static literal (lists.inc.php:100-104)
$GLOBALS                 // read by Controller::__construct() and assigned whole into every Smarty template (Controller.class.php:80)
$_GET / $_POST           // read and mutated by Controller::dispatch() (unsets $_GET['process'], sets $_POST['process'])
$_SERVER['QUERY_STRING'] // read by Controller::__construct() to build CONTROLLER_THIS
$_SERVER['REQUEST_URI']  // read by Controller::_link()
```

**Globals read:** `$GLOBALS` (`Controller::__construct`, `Controller.class.php:80`); `$_GET`, `$_POST`, `$_SERVER['QUERY_STRING']` (`Controller::__construct`, `Controller.class.php:79`); `$_SERVER['REQUEST_URI']` (`Controller::_link`, `:291`); `OEGlobalsBag` singleton (`Controller::__construct`/`dispatch`, kernel + project dir); `$ISSUE_TYPES` (read downstream by `stats.php`, `demographics.php`, `add_edit_issue.php`, `stats_full.php` — not by these two files themselves after construction).

**Globals written:** `$ISSUE_TYPE_CATEGORIES`, `$ISSUE_TYPE_STYLES`, `$ISSUE_TYPES`, `$ISSUE_CLASSIFICATIONS` — all written unconditionally as a side effect of `require`/`include`-ing `lists.inc.php` (`lists.inc.php:47,61,91,100`), not behind a function call. `$_GET['process']` unset, `$_POST['process']` set (`Controller::dispatch`, `:211-213`).

*Note:* `Controller::__construct()` assigning the **entire** `$GLOBALS`
superglobal into the Smarty template context (`$this->assign('GLOBALS',
$GLOBALS)`, `:80`) means every legacy Smarty template rendered through this
router (`general_fragment.html`, `general_list.html.twig`, etc.) can read
any PHP global by name, including config/secret-bearing globals set
elsewhere in the request lifecycle. Not exploitable by an external
attacker on its own (this is server-side template authoring, not
user input), but it's the kind of blast-radius-widening pattern the coding
standard (`$GLOBALS`-as-service-locator) explicitly calls out as legacy,
not a model. Recorded as a Low finding (design smell, not an exploit path)
— see Finding 7.

## Logic

### `Controller::__construct()` (`Controller.class.php:63-81`)

Extends Smarty; sets compile dir via `CacheDirectory`, enables compile-check
(templates recompiled on source change — dev-friendly, not a perf issue at
this scale), registers a custom `text` Smarty modifier plugin
(`escapeForTextNode`) so `{$x|text}` doesn't fall through to Smarty's
deprecated unregistered-function autoload path, and assigns five template
variables every subclass inherits: `PROCESS`, `HEADER`/`FOOTER` (bare HTML
wrapper strings — used when a controller action needs to `echo` raw HTML
outside the normal template flow), `CONTROLLER` (`"controller.php?"` — note
the trailing `?`, the root cause of B-14), `CONTROLLER_THIS` (current
request re-buildable as a link, `"controller.php?" . $_SERVER['QUERY_STRING']`),
and `GLOBALS` (see State note above).

### `Controller::checkControllerAcl(string $controllerName): void` (private, `:131-144`)

```php
if (!isset(self::CONTROLLER_ACL_MAP[$controllerName])) {
    return;   // no entry -> no check at all
}
[$section, $value, $displayName] = self::CONTROLLER_ACL_MAP[$controllerName];
if (!AclMain::aclCheckCore($section, $value)) {
    $this->throwAccessDenied(...);
}
```

`CONTROLLER_ACL_MAP` (`:52-55`) has exactly **two** entries out of the ten
`VALID_CONTROLLERS`: `practice_settings` → `['admin','practice', ...]` and
`prescription` → `['patients','rx', ...]`. Every other controller name
(`document`, `document_category`, `hl7`, `insurance_company`,
`insurance_numbers`, `patient_finder`, `pharmacy`, `x12_partner`) hits the
early `return` — **no ACL check runs at all** for those seven, from this
method. See Permission checks and Finding 1/2 for what (if anything) backs
them up elsewhere.

The call passes only `$section`/`$value` to `AclMain::aclCheckCore()` — no
`$return_value` (the fourth parameter other call sites in this codebase use
to request a specific access level, e.g. `AclMain::aclCheckCore('patients',
'docs', '', ['write', 'addonly'])` in `C_Document.class.php:1147`). So even
for the two gated controllers, this is a single generic-access check per
whole `dispatch()` call — the *same* check whether the requested action is
a read (`list_action`) or a write (`edit_action`/`save`). See Permission
checks / Finding 3.

### `Controller::act(array $qarray): string` (`:164-186`, `@deprecated`)

```php
$keys = array_keys($qarray);
$controller = (string) $keys[0];
$positionalAction = (string) ($keys[1] ?? 'default');
$params = ['controller' => $controller, 'action' => $positionalAction];
foreach ($qarray as $key => $value) {
    if ($key === $controller || $key === $positionalAction) continue;
    $params[$key === 'action' ? 'sub_action' : $key] = $value;
}
return $this->dispatch($params);
```

Treats the **first** `$_GET` key as the controller name and the **second**
as the action, positionally — this is exactly the parameter-order
sensitivity `dispatch()` was built to fix (per the doc-block referencing
[openemr#11162](https://github.com/openemr/openemr/issues/11162) and
`ControllerRoutingTest::testActFailsWithWrongParameterOrder`), but `act()`
itself is unchanged and is still the only path any in-repo template
actually drives, because none of them build `?controller=x&action=y` query
strings — they all build bare positional ones (`controller.php?prescription&list&id=5`,
`controller.php?practice_settings&pharmacy&action=list`, etc; see Findings).
An explicit `action` key present alongside two leading positional segments
is renamed to `sub_action` (`:182`) rather than overwriting the positional
action — this exists specifically to support the two-level
`practice_settings`→`pharmacy` sub-controller delegation pattern
(`C_PracticeSettings.class.php` dispatches by reading `func_get_args()`),
confirmed by `ControllerRoutingTest::testActPreservesExplicitActionAsSubAction`.

*Note:* if `$_GET` has zero or one key, `$keys[1] ?? 'default'` degrades to
`'default'` gracefully, but `$keys[0]` on an **empty** `$qarray` would be
`array_keys([])[0]` → `null`, then `(string) null` → `''` — not in
`VALID_CONTROLLERS`, so `dispatch()` throws the same "Missing or invalid
'controller' parameter" `BadRequestHttpException` as B-14. In practice this
path is unreachable: `controller.php:12-14` throws its own
`BadRequestHttpException("Missing query parameters")` first if
`$_GET === []`.

### `Controller::dispatch(array $params): string` (`:197-267`)

Order: (1) whitelist-check `$params['controller']` against
`VALID_CONTROLLERS`, throwing `BadRequestHttpException` if absent/invalid —
this is exactly where B-14's doubled-`?` bug surfaces, since the malformed
URL produces a controller string of `"?prescription"` (leading `?`
included), which isn't in the whitelist (see Findings, B-14 is verified
per `ui/DASHBOARD-MAP.md` §5 — not re-traced here); (2) ACL check via
`checkControllerAcl()` — **before** the controller file is loaded, so an
unauthorized request never reaches the target controller's code, for the
two controllers that have a map entry; (3) `process` flag handling: if
`$params['process']` is set, it's removed from both `$_GET` and the local
`$params`, and `$_POST['process']` is forced to `"true"` — this lets a
GET-triggered "confirm and process" link masquerade as a POST-processed
form submission for the `<action>_action_process()` convention, without
an actual POST body; (4) `i_once()` the controller file by a fixed
`OEGlobalsBag`-resolved project path + hardcoded `C_<Name>.class.php`
filename — no user input reaches the filename (the suffix comes from the
whitelist's *value*, not the caller's key), so this is not
path-traversable; (5) instantiate; (6) build the args array from every
remaining param except `controller`/`action`/`process`, converting empty
strings to `null`; (7) if this is a "processing" request
(`$_POST['process']==='true'`) and `<action>_action_process` exists (using
`methodExists()`, not raw `is_callable()` — see below), call it first; if
it sets `_state = false`, return immediately without also calling the
`_action` method (an explicit early-exit signal the base class exposes but
never itself sets — each subclass's `*_process` method presumably sets it,
not traced here since it's per-controller); (8) otherwise/always, call
`<action>_action`, throwing `NotFoundHttpException` if it doesn't exist.

Argument passing to both action methods is **positional**, not
named — `$controllerObj->$method(...array_values($args))` (`:247`) — so
the order params appear in `$params` (after removing the three reserved
keys) determines which PHP parameter each value binds to. Combined with
`array_values()` discarding keys entirely, a controller's `*_action(string
$id, string $pid)` signature depends on `id` happening to iterate before
`pid` in the `$args` array — which itself depends on PHP's insertion-order
guarantee for the associative array built by the `foreach` at `:235-241`,
which in turn mirrors whatever order the original `$_GET` (or `act()`'s
reshaped `$params`) had for the non-reserved keys. Fragile, but consistent
with `dispatch()`'s history (built to fix *controller/action* order
sensitivity, not action-*argument* order sensitivity) — not a new bug this
audit is claiming, just an open question about whether it's ever bitten
anyone (no test covers it). See Open questions.

### `Controller::methodExists()` (private, `:275-279`)

```php
return method_exists($controllerObj, $method) && is_callable([$controllerObj, $method]);
```

Exists specifically because `Controller extends Smarty`, and Smarty 4's
`__call()` magic method makes `is_callable()` return `true` for *any*
method name on a `Controller`/`C_*` instance — including ones that don't
exist — because PHP can't distinguish "real method" from "will be caught by
`__call`" via `is_callable()` alone. Without the `method_exists()`
half of this check, `dispatch()` would try to invoke a phantom method name
and Smarty's internal extension-method resolver would throw an unrelated
"undefined extension class" error instead of the intended
`NotFoundHttpException`. Directly documented and regression-tested:
`ControllerRoutingTest::testMethodExistsGuardsAgainstSmartyPhantomMethods`
(`tests/Tests/RestControllers/ControllerRoutingTest.php:200-234`).

### `Controller::_link($action = "default", $inlining = false)` (`:289-315`)

Builds a link by parsing `$_SERVER['REQUEST_URI']` on `&`, taking the
segment before the first `&` as the base path, and reconstructing a query
string from `$action` plus `$this->_args` (an instance array only
`C_Document` ever populates, `C_Document.class.php:76`). Only `C_Document`
and `C_DocumentCategory` call this method (see Layout table) — `C_Prescription`
and every other controller build their links by hand-concatenating the
`CONTROLLER`/`CONTROLLER_THIS`/`TOP_ACTION` template variables directly in
Smarty/Twig markup instead, which is how B-14's doubled `?` happened (a
markup-level concatenation bug, not a `_link()` bug — `_link()` itself
isn't involved in the Prescriptions card at all).

### `lists.inc.php` top-level script body (`:45-104`)

Executes immediately on `require`/`include`, not inside a function: (1)
seeds `$ISSUE_TYPE_CATEGORIES` with two hardcoded entries, then runs
`SELECT DISTINCT category FROM issue_types` and appends any other distinct
category values found (`:52-59`); (2) sets the static
`$ISSUE_TYPE_STYLES` lookup array (no DB query); (3) runs `SELECT * FROM
issue_types WHERE active=1 AND category=? ORDER BY ordering`, parameterized
by `collect_issue_type_category()` (which just checks an `ippf_specific`
global — an IPPF-specific product mode not otherwise documented in this
audit's scope), and builds `$ISSUE_TYPES` keyed by `type`, each entry a
6-tuple `[plural, singular, abbreviation, style, force_show, aco_spec]`
(matching the array-shape doc-comment at the top of the file, `:1-22`) —
this is the DB-driven ordering `ui/DASHBOARD-MAP.md` §3 cites for the
generic issue-type cards; (4) sets the static `$ISSUE_CLASSIFICATIONS`
lookup (no DB query). Two unconditional `sqlStatement()` calls per include
— see Finding 8 (performance/side-effect smell, not a correctness bug).

### `getListById($id, $cols = "*")` (`:106-109`)

`SELECT <cols> FROM lists WHERE id=? ORDER BY date DESC LIMIT 0,1` via
`escape_sql_column_name(process_cols_escape($cols), ['lists'])` for the
column list (external sanitizer, not re-verified here) and a bound
parameter for `$id`. Dead code in this repo — see Finding 5.

### `addList($pid, $type, $title, $comments, $activity = "1")` (`:112-116`)

`INSERT INTO lists (date, pid, type, title, activity, comments, user,
groupname) VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?)`, sourcing `user`/`groupname`
from the active session (`authUser`/`authProvider`). *Note:* the SQL column
order in the query text is `pid, type, title, activity, comments, user,
groupname` but the bound-parameter array is `[$pid, $type, $title,
$activity, $comments, $session->get('authUser'), $session->get('authProvider')]`
— i.e. `$activity` and `$comments` are swapped relative to the column list
(`activity` column gets the `$comments` argument's *position* in the
column list, but the parameter array puts `$activity` fourth and
`$comments` fifth, matching the column order `activity, comments` — on
re-reading, the column order is `..., title, activity, comments, ...` and
the parameter order is `..., $title, $activity, $comments, ...`, which
**does** line up correctly; flagged here only because the signature's own
parameter order (`$pid, $type, $title, $comments, $activity`) has
`$comments` before `$activity`, the reverse of both the column list and
the call-site binding order — a caller relying on positional familiarity
with the function signature could pass them backwards without a type
error, since both are strings). No caller exists in this repo to check
against (Finding 5), so this is a latent footgun for any future caller,
not an active bug.

### `disappearList($id)` / `reappearList($id)` (`:118-128`)

Single-column soft delete/undelete: `UPDATE lists SET activity = '0'|'1'
WHERE id=?`. No transaction, no return-value check on the `sqlStatement()`
call (always `return true`, regardless of whether the UPDATE matched any
row). Dead code in this repo (Finding 5).

### `getListTouch($patient_id, $type)` / `setListTouch($patient_id, $type): void` (`:130-151`)

`getListTouch` returns the `date` column from `lists_touch` for a given
`(pid, type)` pair, or `false` if no row exists. `setListTouch` does a
`SELECT` on the same key, and `INSERT`s a new row only if the `SELECT`
found nothing — a check-then-act pattern with no transaction and no
`INSERT ... ON DUPLICATE KEY UPDATE`, racing against the table's own
`PRIMARY KEY (pid, type)` constraint (`sql/database.sql:7744-7749`). Two
concurrent calls for the same never-touched `(pid, type)` could both pass
the emptiness check and both attempt the `INSERT`; the second would hit a
primary-key violation, which `sqlStatement()` doesn't catch here, so it
would surface as an uncaught DB exception rather than being silently
absorbed. See Finding 4 for severity/likelihood.

`setListTouch()` is called from exactly one place in this repo:
`library/ajax/lists_touch.php` (`:25`), a small CSRF-checked POST endpoint
that the dashboard's issue-list UI presumably calls when staff explicitly
review/confirm a category — that call site was not traced further (out of
this unit's file scope) but confirms `list_touch` is a *user action*
(explicit review), not a passive read-tracking mechanism.

`getListTouch()` feeds the `listTouched` template variable on the
Allergies/Medical-Problems/Medications cards
(`demographics.php:1128,1152,1174`), which the card templates use to pick
between two different empty-state strings — see Finding 6, the most
port-relevant finding in this file.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| `controller.php` page access (any controller) | Indirect only | `interface/globals.php` → `auth.inc.php` session/login gate (same mechanism as every `interface/*` page, per `ui/DASHBOARD-MAP.md` §2) | Confirms a *logged-in* user of any role can reach `dispatch()`/`act()` — there is no page-level ACL equivalent to `demographics.php`'s `AclMain::aclCheckCore('patients','demo')` gate in `controller.php` itself |
| `document` controller (any action) | **missing** from `checkControllerAcl`, but present in the controller | `C_Document.class.php` does its own per-action `AclMain::aclCheckCore('patients','docs'\|'docs_rm', ..., ['write','addonly'])` calls (`:472,1147,1163`) | Defense-in-depth inside the controller class itself compensates for the router-level gap — the *only* one of the ten that does |
| `document_category` controller (any action) | **missing** | none found (`AclExtended` is used only to render an ACO `<select>`'s options, `C_DocumentCategory.class.php:68,96` — not an access check) | No compensating check found anywhere in the class |
| `hl7` controller (any action) | **missing** | none found | No compensating check |
| `insurance_company` controller (any action) | **missing** | none found | No compensating check |
| `insurance_numbers` controller (any action) | **missing** | none found | No compensating check |
| `patient_finder` controller (any action) | **missing** | none found | No compensating check |
| `pharmacy` controller (any action) | **missing** | none found | No compensating check |
| `practice_settings` controller (any action) | present, generic | `checkControllerAcl('practice_settings')` → `AclMain::aclCheckCore('admin','practice')` | One check for the whole controller, not per action; own class (`C_PracticeSettings.class.php`) has no additional check found |
| `prescription` controller (any action, incl. edit/save) | present, generic | `checkControllerAcl('prescription')` → `AclMain::aclCheckCore('patients','rx')` | Same check for `list_action` (read) and `edit_action`/whatever the save path is (write) — no `$return_value` level requested (see Logic); own class (`C_Prescription.class.php`) has no additional check found |
| `x12_partner` controller (any action) | **missing** | none found | No compensating check |
| `lists_touch.php` (`setListTouch` caller) | present | `AclMain`? — not confirmed; the file does check `CsrfUtils::checkCsrfInput` (`lists_touch.php:21`) but no `AclMain::aclCheckCore` call was found in that file itself | Out of this unit's file scope to fully trace; flagged as an open question |
| `getListTouch`/issue-type card read (Allergies/Medical-Problems/Medications) | present, upstream | `AclMain::aclCheckIssue('allergy'\|'medical_problem'\|'medication')` in `demographics.php` (per `ui/DASHBOARD-MAP.md` §4), not in `lists.inc.php` itself | `lists.inc.php`'s own functions have no ACL checks — callers are responsible |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `issue_types` | Yes | No | top-level script body, `lists.inc.php:52,83` | No — two independent `sqlStatement()` calls, no transaction, run on every include |
| `lists` | Yes (`getListById`) | Yes (`addList` insert, `disappearList`/`reappearList` update `activity`) | `lists.inc.php:106-128` | No — each function is a single statement; no multi-statement transaction anywhere in this file |
| `lists_touch` | Yes (`getListTouch`) | Yes (`setListTouch`) | `lists.inc.php:130-151` | No — `setListTouch`'s SELECT-then-INSERT is not wrapped in a transaction (see Finding 4) |

`Controller.class.php` itself touches no database directly — all DB access
in the request lifecycle happens inside the dispatched `C_*` controller
classes, out of this unit's scope.

## Cross-links

- **Routes to:** `controllers/C_Document.class.php`, `C_DocumentCategory`, `C_Hl7`, `C_InsuranceCompany`, `C_InsuranceNumbers`, `C_PatientFinder`, `C_Pharmacy`, `C_PracticeSettings`, `C_Prescription`, `C_X12Partner` — per `VALID_CONTROLLERS` (`Controller.class.php:35-45`)
- **Opened by (in-scope-for-the-port path):** the Prescriptions card's pencil/"Edit" link (`demographics.php:1228`, iframe to `controller.php?prescription&list&id=<pid>`) and the "Add" link inside that iframe's own template (`general_list.html.twig:449`, the B-14 break) — both already mapped in `ui/DASHBOARD-MAP.md` §5, not re-traced here beyond confirming the router-side half of that trace against source (see Findings, B-14 row)
- **Opened by (out-of-scope-for-the-port):** 30+ other `interface/*` and `portal/*` files build `controller.php?...` links for Documents, Pharmacies, Insurance Companies/Numbers, X12 Partners, HL7, Patient Finder, Practice Settings — none of these are in the six required cards; listed in Layout/Findings only where relevant to the routing-correctness question the brief asked about
- **Depends on:** `OpenEMR\Common\Acl\AclMain`, `OpenEMR\Common\Acl\AccessDeniedHelper`, `OpenEMR\Core\OEGlobalsBag`, `Smarty` (base class), `OpenEMR\Services\Storage\CacheDirectory`
- **`lists.inc.php` is `require`d by:** `demographics.php:37-43` (per `ui/DASHBOARD-MAP.md` §2), `stats.php`, `stats_full.php`, `add_edit_issue.php`, `library/ajax/lists_touch.php`, and others (see State/Layout tables) — every one of these re-runs the two top-level SQL queries (Finding 8)
- **Related audit docs:** `ui/DASHBOARD-MAP.md` §3–5 (card order, B-14 trace, list_touch not previously connected to empty-state text), `api/CLINICAL-CARDS.md` (DB-03/04/05 filter rules — `filterActiveIssues()` is defined in `demographics.php`, not in this unit, but consumes data these two files help produce/route to)

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Security | High (provisional) | Seven of ten `controller.php` controllers (`document_category`, `hl7`, `insurance_company`, `insurance_numbers`, `patient_finder`, `pharmacy`, `x12_partner`) have no entry in `CONTROLLER_ACL_MAP`, so `checkControllerAcl()` performs zero access check for them, and grep of each controller class found no compensating `AclMain`/ACL call anywhere inside them either. Any authenticated user of any role can invoke any action on these controllers. | `checkControllerAcl` (`library/classes/Controller.class.php:131-144`, early-return on missing map entry); confirmed no compensating check via targeted grep of `controllers/C_DocumentCategory.class.php`, `C_Hl7.class.php`, `C_InsuranceCompany.class.php`, `C_InsuranceNumbers.class.php`, `C_PatientFinder.class.php`, `C_Pharmacy.class.php`, `C_X12Partner.class.php` (zero `Acl`/`acl` matches in six of the seven; `C_DocumentCategory` has one `AclExtended` use that only renders a dropdown, not a gate) | Add the missing seven to `CONTROLLER_ACL_MAP`, or give each controller its own per-action check like `C_Document` does |
| 2 | Security | Medium (provisional) | `document` is the one controller *not* in `CONTROLLER_ACL_MAP` that does have its own real ACL checks — but they live entirely inside `C_Document.class.php`, invisible from `Controller::checkControllerAcl()`. A future edit to the map, or to `dispatch()`, could silently assume all not-in-map controllers are equally unchecked (as Finding 1 shows six of them are) and not realize `document` is the exception, or vice versa a refactor of `C_Document` could drop its internal checks without anyone noticing the router provides no backstop. | `C_Document.class.php:472,1147,1163` (own checks) vs. `Controller.class.php:131-144` (router-level gate, doesn't cover `document`) | Make ACL enforcement visible in one place — either move `document`'s checks into the map (with per-action granularity the map doesn't currently support) or document the split explicitly in code comments |
| 3 | Security | Medium (provisional) | For the two controllers that *are* gated (`practice_settings`, `prescription`), `checkControllerAcl()` runs one generic check per `dispatch()` call, not one per action, and never passes the `$return_value` parameter `AclMain::aclCheckCore()` supports for requesting a specific access level (e.g. `write`/`addonly`, as `C_Document.class.php:1147` does). A user with only view-level `patients/rx` access is checked with the exact same call whether the requested action is `list_action` (read) or an edit/save action (write) — the router can't distinguish, and neither `C_Prescription.class.php` nor `C_PracticeSettings.class.php` was found to add its own finer-grained check. | `checkControllerAcl` (`Controller.class.php:138`, `AclMain::aclCheckCore($section, $value)` — no third/fourth arg); confirmed no compensating per-action check via grep of `C_Prescription.class.php` and `C_PracticeSettings.class.php` (zero `Acl` matches in either) | If OpenEMR's ACL model distinguishes view from write for `patients/rx`, thread an explicit `$return_value` through the map/check for write actions |
| 4 | Bug | Low | `setListTouch()`'s SELECT-then-INSERT is not transactional and races against `lists_touch`'s own `PRIMARY KEY (pid, type)` constraint; a second concurrent call for the same never-touched key would hit an uncaught primary-key violation instead of the intended "already touched, exit" no-op. | `library/lists.inc.php:141-151`; schema constraint at `sql/database.sql:7744-7749` | `INSERT ... ON DUPLICATE KEY UPDATE date=date` (no-op update) instead of SELECT-then-INSERT |
| 5 | Dead code | Low | `getListById`, `addList`, `disappearList`, `reappearList` have zero callers anywhere in this repo (grep from repo root for each function name found only its own definition). | `library/lists.inc.php:106-128`; grep `getListById\|addList\|disappearList\|reappearList` across `*.php` from repo root | Confirm with a wider history/blame check before deleting; if confirmed unused, remove — dead DB-write helpers are an audit and injection-surface liability even unused |
| 6 | Half-implemented / parity gap | Medium | The PHP Allergies/Medical-Problems/Medications cards render **two different empty-state strings**, not one: "Nothing Recorded" only when the issue type has never been explicitly reviewed (`getListTouch()` returns falsy), and a different, type-specific string ("No Known Allergies", "None" for Problems/Medications) once staff has explicitly touched the category via `lists_touch.php`. Phase 2's parity decision ("empty lists say 'Nothing Recorded'", per this skill's brief) covers only the never-touched case. There is no REST/FHIR endpoint for `lists_touch` (grep of `apis/`, `src/RestControllers`, `src/Services` for `lists_touch` found only an audit-log table-name mapping, the same pattern DB-08/`pnotes` hit) — so a port that calls the API alone cannot distinguish "never reviewed, nothing recorded" from "reviewed, confirmed empty" and cannot reproduce the second string at all. | `templates/patient/card/allergies.html.twig:27-36` (mirrored in `medical_problems.html.twig:6-10`, `medication.html.twig:6-10`); `demographics.php:1128,1152,1174` (`listTouched` wiring); `getListTouch`/`setListTouch` (`library/lists.inc.php:130-151`); confirmed no API surface via grep `lists_touch` in `apis/` (0 hits) and `src/` (1 hit, unrelated audit-logger table mapping) | Record as "not available via API" per A2, alongside DB-02 active-status and DB-06 refills; port shows a single empty string (Phase 2's "Nothing Recorded") for both PHP-side states, which is a real, documented parity gap, not silently different behavior |
| 7 | Smell | Low | `Controller::__construct()` assigns the entire `$GLOBALS` superglobal into every Smarty template's variable scope. | `library/classes/Controller.class.php:80` | Assign only the specific globals templates actually reference, if/when this code is next touched |
| 8 | Smell / perf | Low | `lists.inc.php`'s top-level script body runs two unparameterized-scope `sqlStatement()` calls unconditionally every time the file is `require`d/`include`d (no include-once guard around the query logic itself — PHP's `require_once` at call sites prevents *re-including the file*, but every *first* include in a given request, and this file is required by multiple independent entry points per request in some flows, re-runs both queries). | `library/lists.inc.php:52,83-86` | Not urgent at current scale; worth a look if `issue_types` grows or this file's include count per request increases |

## Port notes

- **Must survive (as documented gaps, not code):** the `list_touch`
  reviewed/not-reviewed empty-state distinction (Finding 6) needs to be
  called out explicitly in the port's parity documentation — it's a second,
  previously-uncaught layer under Phase 2's "Nothing Recorded" decision, not
  a contradiction of it.
- **Must not survive:** the router-level ACL gaps (Findings 1-3) are a
  legacy-app concern, not something the read-only SPA port re-implements —
  the port never calls `controller.php`. Still worth flagging to David
  since it's a real gap in the *existing* app the audit surfaced while
  tracing B-14, independent of the port.
- **Open questions:**
  - Does `library/ajax/lists_touch.php` (the sole caller of `setListTouch`)
    have its own ACL check, or does it rely solely on the CSRF check and
    session login? Not traced — out of this unit's file scope, but directly
    relevant to Finding 6's "who can flip a card's empty-state text" question.
  - Is `Controller::dispatch()`'s positional (not named) argument-binding
    to `<action>_action(...)` (`:247`, `...array_values($args)`) ever
    order-sensitive in a way that's actually hit in practice? No test
    covers multi-argument action methods; not confirmed either way.
  - `addList()`'s parameter order (`$comments` before `$activity`) versus
    its own column/bind order (`activity` before `comments`) — confirmed
    the current implementation binds correctly, but flagged as a latent
    footgun for any future caller reading the signature; worth a second
    pair of eyes since this function is currently dead code and any
    resurrection should fix the ordering for clarity even though it's not
    presently a bug.
