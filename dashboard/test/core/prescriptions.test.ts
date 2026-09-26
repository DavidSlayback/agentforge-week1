import { describe, expect, it } from 'vitest';
import { prescriptionDetails, sortPrescriptions, type PrescriptionSortFields } from '../../core/rules/prescriptions.ts';

const row = (uuid: string, active: string | null, modified: string | null, added: string | null): PrescriptionSortFields => ({
  uuid,
  active,
  date_modified: modified,
  date_added: added,
});
const order = (rows: PrescriptionSortFields[]) => sortPrescriptions(rows).map((r) => r.uuid);

describe('sortPrescriptions: ORDER BY active DESC, date_modified DESC, date_added DESC, then uuid', () => {
  it('active rows come before inactive ones, whatever their dates (the active leg)', () => {
    expect(order([row('new-inactive', '0', '2026-01-01 00:00:00', '2026-01-01 00:00:00'), row('old-active', '1', '2001-01-01 00:00:00', '2001-01-01 00:00:00')])).toEqual([
      'old-active',
      'new-inactive',
    ]);
  });

  it('within one active value, a later date_modified wins over a later date_added (the date_modified leg)', () => {
    expect(
      order([
        row('added-late', '1', '2020-01-01 00:00:00', '2026-01-01 00:00:00'),
        row('modified-late', '1', '2025-01-01 00:00:00', '2001-01-01 00:00:00'),
      ]),
    ).toEqual(['modified-late', 'added-late']);
  });

  it('a NULL date_modified sorts after every set one (MySQL puts NULLs last under DESC)', () => {
    expect(order([row('null-mod', '1', null, '2026-01-01 00:00:00'), row('set-mod', '1', '1999-01-01 00:00:00', '1999-01-01 00:00:00')])).toEqual([
      'set-mod',
      'null-mod',
    ]);
  });

  it('with date_modified tied (all NULL, as for pid 13), date_added DESC decides', () => {
    expect(
      order([
        row('a-1979', '1', null, '1979-08-09 20:06:27'),
        row('b-2023', '1', null, '2023-02-12 20:25:42'),
        row('c-2011', '1', null, '2011-05-08 20:06:27'),
      ]),
    ).toEqual(['b-2023', 'c-2011', 'a-1979']);
  });

  it('a bare date sorts as midnight, and a full tie falls back to uuid ascending (documented tiebreak)', () => {
    expect(order([row('z', '1', null, '2020-01-01'), row('y', '1', null, '2020-01-01 00:00:01'), row('a', '1', null, '2020-01-01 00:00:00')])).toEqual([
      'y',
      'a',
      'z',
    ]);
  });

  it('accepts numeric active and treats an unparseable or NULL active as last', () => {
    expect(order([row('null', null, null, null), { uuid: 'num', active: 1 }, row('zero', '0', null, null)])).toEqual(['num', 'zero', 'null']);
  });

  it('keeps every row (no active filter: U-3 / 5.03) and does not mutate its input', () => {
    const input = [row('b', '0', null, null), row('a', '1', null, null)];
    const out = sortPrescriptions(input);
    expect(out).toHaveLength(2);
    expect(input.map((r) => r.uuid)).toEqual(['b', 'a']);
  });
});

describe('prescriptionDetails: size + unit, a space, dosage (general_fragment.html:31-32)', () => {
  it('joins size and unit with no space, then the dosage', () => {
    expect(prescriptionDetails({ prescription_drug_size: '500', unit_title: 'mg', dosage: '1' })).toBe('500mg 1');
  });

  it('with no size or unit it is the dosage alone (pid 13 shape)', () => {
    expect(prescriptionDetails({ prescription_drug_size: '', unit_title: null, dosage: '1.00', interval: null })).toBe('1.00');
  });

  it('appends " in <interval>" only when an interval is set; interval "0" counts as unset (PHP empty)', () => {
    expect(prescriptionDetails({ prescription_drug_size: '10', unit_title: 'mg', dosage: '1', interval: '1', interval_title: 'b.i.d.' })).toBe('10mg 1 in b.i.d.');
    expect(prescriptionDetails({ prescription_drug_size: '10', unit_title: 'mg', dosage: '1', interval: '0', interval_title: '' })).toBe('10mg 1');
  });

  it('is empty when nothing is recorded', () => {
    expect(prescriptionDetails({})).toBe('');
  });
});
