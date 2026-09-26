/**
 * Parity rules shared by the three issue cards (Allergies, Medical Problems,
 * Medications), reproduced from the PHP dashboard (`walkthroughs/ISSUE-CARDS.md`).
 * Pure: the caller supplies "now" as a local date-time in OpenEMR's timezone.
 */

/** The two `lists` columns `filterActiveIssues()` reads, as the REST API serializes them. */
export interface IssueActivityFields {
  /** `lists.outcome` (ADODB returns it as a string, e.g. "0", "1", "6"). */
  readonly outcome?: string | number | null | undefined;
  /** `lists.enddate`, a naive `YYYY-MM-DD HH:MM:SS` in OpenEMR's timezone, or null. */
  readonly enddate?: string | null | undefined;
}

const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/;
// PHP 8 numeric string: optional surrounding whitespace, sign, digits, fraction, exponent.
const PHP_NUMERIC_RE = /^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t\n\r\v\f]*$/;

/**
 * Normalize a naive MySQL date or datetime to `YYYY-MM-DD HH:MM:SS`, so two
 * values in the same timezone compare correctly as strings. `null` if the
 * value is not in that shape.
 */
export function normalizeLocalDateTime(value: string): string | null {
  const m = LOCAL_DATE_TIME_RE.exec(value);
  if (!m) return null;
  return `${m[1] ?? ''}-${m[2] ?? ''}-${m[3] ?? ''} ${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
}

/**
 * True when PHP 8's loose `$outcome != 1` is false, i.e. the issue is resolved
 * (`demographics.php:1110@legacy-baseline`). A numeric string such as "1" or
 * "1.0" equals 1; null, "" and non-numeric strings do not.
 */
export function isResolvedOutcome(outcome: string | number | null | undefined): boolean {
  if (typeof outcome === 'number') return outcome === 1;
  if (typeof outcome === 'string') return PHP_NUMERIC_RE.test(outcome) && Number(outcome.trim()) === 1;
  return false;
}

/**
 * `filterActiveIssues()` for one row (`demographics.php:1104-1113@legacy-baseline`):
 * `outcome != 1 && (empty(enddate) || strtotime(enddate) > strtotime('now'))`.
 *
 * Both sides are naive local times in OpenEMR's timezone, so a string
 * comparison of normalized values matches PHP's instant comparison (except in
 * the repeated hour of a DST fall-back, where PHP's own `strtotime` is also
 * ambiguous). An enddate equal to "now" is not active; an enddate of today at
 * midnight is inactive from midnight on (catalog 5.08, bug-for-bug).
 *
 * Args:
 *   issue: the row's raw REST `outcome` and `enddate` (never FHIR `clinicalStatus` or `activity`).
 *   nowLocal: now as `YYYY-MM-DD HH:MM:SS` in OpenEMR's timezone.
 */
export function isActiveIssue(issue: IssueActivityFields, nowLocal: string): boolean {
  const now = normalizeLocalDateTime(nowLocal);
  if (now === null) throw new Error('isActiveIssue: nowLocal must be YYYY-MM-DD HH:MM:SS');
  if (isResolvedOutcome(issue.outcome)) return false;
  const end = issue.enddate;
  // PHP empty(): null, "" and "0" all count as "no end date".
  if (end === null || end === undefined || end === '' || end === '0') return true;
  const normalized = normalizeLocalDateTime(end);
  // strtotime() returns false for an unparseable date and `false > now` is false,
  // so PHP hides the row. The upstream schemas reject such values before this runs.
  if (normalized === null) return false;
  return normalized > now;
}

/** Keep the rows the PHP card shows, in their original order. Returns a new array. */
export function filterActiveIssues<T extends IssueActivityFields>(rows: readonly T[], nowLocal: string): T[] {
  return rows.filter((row) => isActiveIssue(row, nowLocal));
}

/** Allergy severity codes the legacy card highlights (`allergies.html.twig:37`). */
export const SEVERE_ALLERGY_CODES: readonly string[] = ['severe', 'life_threatening_severity', 'fatal'];

/** True when the legacy card would highlight this allergy (`bg-warning font-weight-bold`). */
export function isSevereAllergy(severityCode: string | null | undefined): boolean {
  return typeof severityCode === 'string' && SEVERE_ALLERGY_CODES.includes(severityCode);
}

/** One `list_options` row as `GET /api/list/:list_name` returns it (fields the lookup reads). */
export interface ListOptionLike {
  readonly option_id: string;
  readonly title?: string | null | undefined;
  readonly activity?: string | number | null | undefined;
}

/**
 * The `severity_ccda` label map. Like `LayoutsUtils::getListItemTitle()`
 * (`src/Common/Layouts/LayoutsUtils.php:17-24@legacy-baseline`) only active
 * options (`activity = 1`) count.
 */
export function buildListLabels(options: readonly ListOptionLike[]): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const o of options) {
    const active = o.activity === 1 || o.activity === '1';
    if (active && typeof o.title === 'string' && o.title !== '' && !labels.has(o.option_id)) labels.set(o.option_id, o.title);
  }
  return labels;
}

/**
 * The text the legacy card puts in parentheses after an allergy title:
 * the option's title, else the raw stored code (the "(1)" fallback), else ""
 * when no code is stored (the legacy card then renders "()").
 */
export function severityLabel(severityCode: string | null | undefined, labels: ReadonlyMap<string, string>): string {
  if (severityCode === null || severityCode === undefined) return '';
  return labels.get(severityCode) ?? severityCode;
}

/**
 * Sort by `begdate` ascending with missing dates first, as the PHP card's
 * `PatientIssuesService::search()` does (`ORDER BY lists.begdate`,
 * `src/Services/PatientIssuesService.php:211@legacy-baseline`; MySQL puts NULLs
 * first). Stable: ties keep API order, since neither system defines one.
 * Returns a new array.
 */
export function sortByBegdateAsc<T extends { readonly begdate?: string | null | undefined }>(rows: readonly T[]): T[] {
  const key = (row: T): string | null => (row.begdate ? normalizeLocalDateTime(row.begdate) : null);
  return rows
    .map((row, index) => ({ row, index, k: key(row) }))
    .sort((a, b) => {
      if (a.k === b.k) return a.index - b.index;
      if (a.k === null) return -1;
      if (b.k === null) return 1;
      return a.k < b.k ? -1 : 1;
    })
    .map((x) => x.row);
}

/**
 * Keep the first row per `uuid`. `ConditionService::search()` LEFT JOINs
 * `issue_encounter`/`form_encounter` without de-duplicating, so a problem linked
 * to several encounters comes back once per encounter; the PHP card
 * (`PatientIssuesService`) shows it once.
 */
export function dedupeByUuid<T extends { readonly uuid: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.uuid)) return false;
    seen.add(row.uuid);
    return true;
  });
}
