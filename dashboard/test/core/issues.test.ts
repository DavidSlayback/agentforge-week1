import { describe, expect, it } from 'vitest';
import {
  buildListLabels,
  filterActiveIssues,
  isActiveIssue,
  isResolvedOutcome,
  isSevereAllergy,
  normalizeLocalDateTime,
  severityLabel,
} from '../../core/rules/issues.ts';

// "Now" is a naive local time in OpenEMR's timezone (the local stack's PHP runs UTC).
const NOW = '2026-09-25 13:00:00';

describe('filterActiveIssues boundary table (MIGRATION-REACT §6.1, catalog 5.08)', () => {
  const cases: [string, { outcome?: string | number | null; enddate?: string | null }, boolean][] = [
    ['outcome=1 (resolved) is hidden even with no enddate', { outcome: '1', enddate: null }, false],
    ['outcome=1 as a number is hidden', { outcome: 1, enddate: null }, false],
    ['outcome "1.0" is hidden (PHP numeric string == 1)', { outcome: '1.0', enddate: null }, false],
    ['outcome " 1" is hidden (PHP 8 allows leading whitespace)', { outcome: ' 1', enddate: null }, false],
    ['outcome=1 with a future enddate is still hidden', { outcome: '1', enddate: '2099-01-01 00:00:00' }, false],
    ['outcome=0, enddate NULL is shown', { outcome: '0', enddate: null }, true],
    ["outcome=0, enddate '' is shown (PHP empty())", { outcome: '0', enddate: '' }, true],
    ["outcome=0, enddate '0' is shown (PHP empty('0'))", { outcome: '0', enddate: '0' }, true],
    ['outcome=0, enddate missing is shown', { outcome: '0' }, true],
    ['outcome=6 (Synthea resolved code) with no enddate is shown', { outcome: '6', enddate: null }, true],
    ['outcome NULL is shown (null != 1)', { outcome: null, enddate: null }, true],
    ["outcome '' is shown ('' != 1)", { outcome: '', enddate: null }, true],
    ["outcome '0x1' is shown (not a PHP numeric string)", { outcome: '0x1', enddate: null }, true],
    ['enddate tomorrow is shown', { outcome: '0', enddate: '2026-09-26 00:00:00' }, true],
    ['enddate one second in the future is shown', { outcome: '0', enddate: '2026-09-25 13:00:01' }, true],
    ['enddate equal to now is hidden (strictly greater)', { outcome: '0', enddate: '2026-09-25 13:00:00' }, false],
    ['enddate one second in the past is hidden', { outcome: '0', enddate: '2026-09-25 12:59:59' }, false],
    ['enddate = today (date only, midnight) is hidden from midnight on', { outcome: '0', enddate: '2026-09-25' }, false],
    ['enddate = tomorrow (date only) is shown', { outcome: '0', enddate: '2026-09-26' }, true],
    ['enddate in the past is hidden', { outcome: '0', enddate: '2020-05-06 20:31:14' }, false],
    ['a MySQL zero date is hidden (strtotime gives a year-0 instant)', { outcome: '0', enddate: '0000-00-00 00:00:00' }, false],
    ['an unparseable enddate is hidden (strtotime false > now is false)', { outcome: '0', enddate: 'next monday' }, false],
  ];
  it.each(cases)('%s', (_label, issue, expected) => {
    expect(isActiveIssue(issue, NOW)).toBe(expected);
  });

  it('enddate today at midnight: shown just before midnight, hidden at midnight', () => {
    const issue = { outcome: '0', enddate: '2026-09-25 00:00:00' };
    expect(isActiveIssue(issue, '2026-09-24 23:59:59')).toBe(true);
    expect(isActiveIssue(issue, '2026-09-25 00:00:00')).toBe(false);
  });

  it('keeps order and returns a new array', () => {
    const rows = [
      { id: 'a', outcome: '0', enddate: null },
      { id: 'b', outcome: '1', enddate: null },
      { id: 'c', outcome: '0', enddate: '2099-12-31 00:00:00' },
      { id: 'd', outcome: '0', enddate: '2001-01-01 00:00:00' },
      { id: 'e', outcome: '6', enddate: '' },
    ];
    const out = filterActiveIssues(rows, NOW);
    expect(out.map((r) => r.id)).toEqual(['a', 'c', 'e']);
    expect(out).not.toBe(rows);
    expect(rows).toHaveLength(5);
  });

  it('refuses a malformed "now" (programmer error, fail loudly)', () => {
    expect(() => isActiveIssue({ outcome: '0', enddate: null }, '2026-09-25T13:00:00Z')).toThrow();
  });
});

describe('outcome and date helpers', () => {
  it('isResolvedOutcome follows PHP 8 loose == 1', () => {
    expect(isResolvedOutcome('1')).toBe(true);
    expect(isResolvedOutcome('1e0')).toBe(true);
    expect(isResolvedOutcome('0')).toBe(false);
    expect(isResolvedOutcome(undefined)).toBe(false);
    expect(isResolvedOutcome('one')).toBe(false);
  });

  it('normalizeLocalDateTime pads a bare date to midnight and rejects other shapes', () => {
    expect(normalizeLocalDateTime('2026-09-25')).toBe('2026-09-25 00:00:00');
    expect(normalizeLocalDateTime('2026-09-25 07:08:09')).toBe('2026-09-25 07:08:09');
    expect(normalizeLocalDateTime('2026-09-25T07:08:09Z')).toBeNull();
    expect(normalizeLocalDateTime('')).toBeNull();
  });
});

describe('allergy severity: label with raw-code fallback, severe-only highlight (5.18)', () => {
  const labels = buildListLabels([
    { option_id: 'mild', title: 'Mild', activity: '1' },
    { option_id: 'severe', title: 'Severe', activity: '1' },
    { option_id: 'fatal', title: 'Fatal', activity: 1 },
    { option_id: 'retired', title: 'Retired', activity: '0' },
    { option_id: 'untitled', title: '', activity: '1' },
  ]);

  it('uses the active option title', () => {
    expect(severityLabel('mild', labels)).toBe('Mild');
    expect(severityLabel('severe', labels)).toBe('Severe');
  });

  it('falls back to the raw code: unknown code, inactive option, empty title (the "(1)" case)', () => {
    expect(severityLabel('1', labels)).toBe('1');
    expect(severityLabel('retired', labels)).toBe('retired');
    expect(severityLabel('untitled', labels)).toBe('untitled');
    expect(severityLabel('severe', new Map())).toBe('severe');
  });

  it('no stored code gives an empty label (legacy renders "()")', () => {
    expect(severityLabel(null, labels)).toBe('');
    expect(severityLabel(undefined, labels)).toBe('');
  });

  it('highlights only severe, life_threatening_severity and fatal', () => {
    expect(isSevereAllergy('severe')).toBe(true);
    expect(isSevereAllergy('life_threatening_severity')).toBe(true);
    expect(isSevereAllergy('fatal')).toBe(true);
    for (const code of ['1', 'mild', 'moderate', 'moderate_to_severe', 'Severe', '', null, undefined]) {
      expect(isSevereAllergy(code), String(code)).toBe(false);
    }
  });
});
