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
