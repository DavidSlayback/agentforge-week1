import { describe, expect, it } from 'vitest';
import { formatAge, formatName, formatSex, isoDatePart } from '../../core/format.ts';
import { parseMrn, parsePatientUuid, parsePid } from '../../core/ids.ts';

describe('formatName: one canonical name (7.18)', () => {
  it('uses given… family suffix… from the official name', () => {
    expect(formatName([{ use: 'old', family: 'Old', given: ['X'] }, { use: 'official', family: 'Doe', given: ['Jan', 'Q'], suffix: ['Jr'] }])).toBe(
      'Jan Q Doe Jr',
    );
  });
  it('falls back to the first name entry and trims blanks', () => {
    expect(formatName([{ family: ' Doe ', given: ['', 'Jan'] }])).toBe('Jan Doe');
  });
  it('returns null when there is nothing to show', () => {
    expect(formatName(undefined)).toBeNull();
    expect(formatName([])).toBeNull();
    expect(formatName([{ given: [' '] }])).toBeNull();
  });
});

describe('formatAge: PatientService::getPatientAge rule (7.17)', () => {
  it.each([
    ['1974-02-10', '2026-09-25', '52'],
    ['1974-09-25', '2026-09-25', '52'], // birthday today
    ['1974-09-26', '2026-09-25', '51'], // birthday tomorrow
    ['1995-07-20', '2026-08-30', '31'], // age at death
    ['2024-09-25', '2026-09-25', '24 months'], // exactly 24 months is still months (> 24 for years)
    ['2024-08-24', '2026-09-25', '2'],
    ['2026-08-25', '2026-09-25', '1 month'],
    ['2026-09-01', '2026-09-25', '0 months'],
  ])('%s as of %s → %s', (dob, asOf, expected) => {
    expect(formatAge(dob, asOf)).toBe(expected);
  });
  it('returns null for missing or future dates', () => {
    expect(formatAge(null, '2026-09-25')).toBeNull();
    expect(formatAge('2026-09-25', null)).toBeNull();
    expect(formatAge('2027-01-01', '2026-09-25')).toBeNull();
  });
});

describe('isoDatePart and formatSex', () => {
  it('takes the local date part OpenEMR wrote', () => {
    expect(isoDatePart('2026-08-30T14:00:00+00:00')).toBe('2026-08-30');
    expect(isoDatePart('garbage')).toBeNull();
  });
  it('maps FHIR gender to display text', () => {
    expect(formatSex('male')).toBe('Male');
    expect(formatSex('female')).toBe('Female');
    expect(formatSex('other')).toBe('Other');
    expect(formatSex('unknown')).toBe('Unknown');
    expect(formatSex(undefined)).toBeNull();
  });
});

describe('ids: parse at the boundary', () => {
  it('accepts canonical uuids (case-folded) and rejects anything else', () => {
    expect(parsePatientUuid('A2D4D063-D949-4F5A-9001-01C1D919AFC6')).toBe('a2d4d063-d949-4f5a-9001-01c1d919afc6');
    for (const bad of ['13', '', 'a2d4d063-d949-4f5a-9001-01c1d919afc', '../patient', null, 13]) expect(parsePatientUuid(bad)).toBeNull();
  });
  it('accepts positive integer pids only', () => {
    expect(parsePid('13')).toBe(13);
    expect(parsePid(13)).toBe(13);
    for (const bad of ['0', '-1', '1.5', '13 OR 1=1', '', 0, 1.5, null]) expect(parsePid(bad)).toBeNull();
  });
  it('accepts conservative MRNs only', () => {
    expect(parseMrn('DASH-SYN-01')).toBe('DASH-SYN-01');
    expect(parseMrn('13')).toBe('13');
    for (const bad of ['', '-x', 'a b', 'a/b', "1' OR '1", 'x'.repeat(33)]) expect(parseMrn(bad)).toBeNull();
  });
});
