# LayoutsUtils — List option lookup utilities

Utility class for translating and validating option codes from the `list_options` table and form data_type modifiers. Used throughout the dashboard to display human-readable labels in place of raw database codes and to validate comma- or JSON-delimited modifier flags in form field definitions.

**Source:** `src/Common/Layouts/LayoutsUtils.php` · 46 lines
**Audited by:** tier 1 · confidence high · no escalation

## Purpose & lifecycle

LayoutsUtils is a static utility class providing two core operations:

1. **List title lookup** (`getListItemTitle`): translates option_id codes to their `list_options.title` labels, with fallback to the raw code if no match exists. Used by dashboard cards to display allergies, prescriptions, messages, and other entity attributes sourced from the `lists` and related tables.

2. **Option validation** (`isOption`): checks whether a test modifier is present in a form field's `edit_options` or similar flags. Handles two legacy/modern formats: a space-separated string ("G P T" or "GPT") and JSON arrays (["G", "P", "T"]). Used by form rendering to conditionally enable/hide field controls.

Both are exposed three ways: as static methods, via deprecated global-namespace functions in `library/options.inc.php`, and as Twig functions in template rendering (registered in `src/Common/Twig/TwigExtension.php`).

## State

None. Both methods are static and have no module-level state.

## Logic

### `getListItemTitle($list, $option)`

Queries `list_options` table:

```sql
SELECT `title` FROM `list_options` 
WHERE `list_id` = ? AND `option_id` = ? AND activity = 1
```

The `$list` parameter (e.g. `'severity_ccda'`, `'disclosure_type'`, `'reaction'`) is matched against `list_id`; `$option` (the raw code, e.g. `'1'`, `'mild'`) is matched against `option_id`. Only rows with `activity = 1` (enabled) are returned.

**Return behavior:**
- If a matching row is found with a non-empty `title`, returns `xl_list_label($row['title'])` — the title, optionally translated via the OpenEMR translation system if `translate_lists` global is enabled.
- If no row matches or `title` is empty, returns the raw `$option` code as fallback.

**Observed behavior in test data:** For allergies (pid 13), the test data has `severity_al = '1'` for all rows. The `severity_ccda` list_options table has entries for `'mild'`, `'moderate'`, `'severe'`, etc., but no entry for `option_id = '1'`. The function returns the fallback `'1'`, causing the Allergies card to display "(1)" instead of a human-readable severity label (RECON DB-03).

### `isOption($options, string $test): bool`

Determines whether a modifier string `$test` is present in the `$options` array or encoded string. Handles format negotiation between legacy and modern schemas:

1. **Early exit:** If `$options` is empty, `$test` is unset, or `$options == "null"`, return `false`.

2. **Format detection:** If `$options` does not contain a comma (i.e. `!str_contains($options, ',')`):
   - Attempt `json_decode($options)` to test if it's JSON.
   - If `json_last_error() !== JSON_ERROR_NONE` (i.e., not valid JSON), assume it's a legacy string — split it into individual characters and re-encode as JSON array: `$options = json_encode(str_split(trim($options)))`.

3. **Decode and return:** `json_decode($options)` to array, then return `in_array($test, $options, true)` (strict equality).

**Legacy format example:** `"GPT"` → `['G', 'P', 'T']` → `in_array('G', ..., true)` → `true`.
**JSON array example:** `["G", "P"]` → decoded → `in_array('G', ..., true)` → `true`.
**Single-element JSON:** `["RO"]` → decoded → `in_array('RO', ..., true)` → `true`.

## Permission checks

None. Both methods are read-only utilities with no authorization gates. Callers are responsible for ensuring the user has permission to view the data being labeled.

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `list_options` | yes | no | `getListItemTitle` — one query per call | no |

## Cross-links

**Callers in specified paths:**

*interface/patient_file/summary/:*
- `disclosure_full.php:159` — `getListItemTitle('disclosure_type', $iter['event'])`
- `pnotes_full.php:525` — `getListItemTitle("message_status", $iter['message_status'])`
- `stats.php:85` — `getListItemTitle("reaction", $row['reaction'])`
- `stats.php:89` — `getListItemTitle("severity_ccda", $row['severity_al'])`

*templates/patient/card/:*
- `allergies.html.twig:43` — `getListItemTitle('severity_ccda', l.severity_al)` (via Twig function)

*src/Patient/:*
- None found.

**Broader use:** getListItemTitle is also called from `interface/billing/payment_master.inc.php`, `interface/forms/care_plan/report.php`, `interface/forms/eye_mag/SpectacleRx.php`, `interface/forms/requisition/new.php`, `interface/main/finder/patient_select.php`, `interface/main/messages/messages.php`, `interface/orders/single_order_results.inc.php`, `interface/patient_file/download_template.php`, `interface/patient_file/education.php`, `interface/patient_tracker/patient_tracker.php`, `interface/reports/appointments_report.php`, `portal/home.php`, `src/ClinicalDecisionRules/Interface/Controller/ControllerLog.php`, `src/Services/DocumentTemplates/DocumentTemplateRender.php`, and `library/clinical_rules.php`. isOption is heavily used in `library/options.inc.php` (form field rendering) and `interface/forms/LBF/new.php`, `interface/forms/LBF/printable.php`, `interface/forms/LBF/report.php` (form-builder rendering).

**Exposed via:**
- Static methods: `OpenEMR\Common\Layouts\LayoutsUtils::{getListItemTitle,isOption}`
- Global namespace functions (deprecated): `getListItemTitle()`, `isOption()` in `library/options.inc.php`
- Twig functions: `getListItemTitle`, registered in `src/Common/Twig/TwigExtension.php`

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Smell | Low | Missing type hints on getListItemTitle parameters; no return type declared. PHPStan level 10 flags this. | `getListItemTitle` (src/Common/Layouts/LayoutsUtils.php:17) | Add type hints: `getListItemTitle($list, $option): string` (assuming `$list` and `$option` are strings, or union type if they can be other types). |
| 2 | Smell | Low | isOption's first parameter declared as `array` but receives `mixed` types from callers (form field data, list data). PHPStan baseline flags multiple violations. | `isOption` (src/Common/Layouts/LayoutsUtils.php:33) and callers in `library/options.inc.php`, `interface/forms/LBF/new.php`, etc. | Widen the parameter type to `array\|string\|mixed` or add a type guard and clarify in the docstring that it accepts both legacy strings and JSON arrays. |
| 3 | Bug | Low | Fallback behavior in `getListItemTitle`: if no list_options row matches, the function returns the raw option code (e.g., "1"). In the allergies card with test data pid 13, all severity_al values are "1", which do not exist in the severity_ccda list_options table, causing "(1)" to display instead of a readable label. This is a data-quality issue, not a code bug, but the fallback silently masks it. | `getListItemTitle` returns `$option` at line 21; test data confirmed: severity_al='1' for all allergies, no severity_ccda entry for '1' | Confirm with domain expert whether "1" is a valid severity code that should be added to list_options, or whether the test data should use a valid code (e.g., 'mild', 'moderate'). The function is working as designed; the issue is upstream data. |
| 4 | Smell | Low | Comment on line 36 in isOption (`// why bother?`) suggests the early-exit empty check may be redundant or unclear in intent. The logic is correct but the comment is cryptic. | `isOption` (src/Common/Layouts/LayoutsUtils.php:35-36) | Clarify the comment: e.g., `// Reject null, empty, or explicitly-null-string options; they can never contain a test value.` |

## Port notes

- **Must survive:** Both functions are read-only query/validation utilities with no side effects. The port's API layer should preserve label-lookup semantics: when the SPA needs to display a human-readable name for a code, it should either (a) query an equivalent `/fhir/<resource>?code=<value>` endpoint or similar to fetch the title, or (b) cache list_options at initialization and look them up client-side. See `api/CLINICAL-CARDS.md` for what the FHIR API returns for each card's attributes.

- **Must not survive:** The fallback-to-raw-code behavior (`return $option` on line 21) is acceptable for the rewrite, but the SPA should decide upfront whether to display codes, titles, or both. The RECON notes that test data's severity codes don't match any list_options entries; the rewrite should either (a) populate the missing entries in `list_options` to fix the root cause, (b) accept mismatches and display codes, or (c) use an enum-based system that validates codes at the API boundary.

- **Open questions:**
  - Is the "1" severity value in test data (allergies) a valid code that should exist in the `severity_ccda` list_options table, or is it synthetic data noise?
  - Should the SPA query the FHIR API for human-readable labels (fetch-on-demand), or cache list_options at startup (cache-on-startup)?
  - The deprecated global-namespace functions `getListItemTitle()` and `isOption()` in `library/options.inc.php` are still widely used. Should the rewrite eliminate them entirely, or keep them for backward compat with legacy PHP code?
