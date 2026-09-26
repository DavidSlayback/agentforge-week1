/**
 * Today's date (`YYYY-MM-DD`) in OpenEMR's timezone for a given instant. The
 * clock itself is injected (`buildApp({ now })`), so this stays deterministic.
 */
export function isoDateInZone(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(epochMs),
  );
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Now as a naive `YYYY-MM-DD HH:MM:SS` in OpenEMR's timezone: the form
 * `lists.enddate` is stored in, so `filterActiveIssues` compares like PHP's
 * `strtotime(enddate) > strtotime('now')` in the server's zone (5.08).
 */
export function localDateTimeInZone(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
