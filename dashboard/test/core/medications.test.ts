import { describe, expect, it } from 'vitest';
import { joinDosageInstructions } from '../../core/rules/medications.ts';

// Synthetic titles and instructions.
const MEDS = [
  { uuid: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Synthetic med A' },
  { uuid: 'aaaaaaaa-0000-4000-8000-000000000002', title: 'Synthetic med B' },
  { uuid: 'aaaaaaaa-0000-4000-8000-000000000003', title: 'Synthetic med C' },
];

describe('joinDosageInstructions (slice 01-06-04, 4.05)', () => {
  it('attaches each plan request to the medication with the same uuid, case-insensitively, in the medications order', () => {
    const joined = joinDosageInstructions(MEDS, [
      { id: 'AAAAAAAA-0000-4000-8000-000000000003', intent: 'plan', dosageTexts: ['sig C'] },
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', intent: 'plan', dosageTexts: ['sig A'] },
      { id: 'aaaaaaaa-0000-4000-8000-000000000002', intent: 'plan', dosageTexts: [] },
    ]);
    expect(joined).toEqual({
      rows: [
        { title: 'Synthetic med A', dosage: 'sig A' },
        { title: 'Synthetic med B', dosage: null },
        { title: 'Synthetic med C', dosage: 'sig C' },
      ],
      unmatched: 0,
    });
  });

  it('never takes instructions from a request whose intent is not plan (a prescription), even with the same uuid', () => {
    const joined = joinDosageInstructions(MEDS.slice(0, 1), [
      { id: MEDS[0]?.uuid ?? '', intent: 'order', dosageTexts: ['prescription sig'] },
      { id: MEDS[0]?.uuid ?? '', intent: undefined, dosageTexts: ['no intent'] },
    ]);
    expect(joined).toEqual({ rows: [{ title: 'Synthetic med A', dosage: null }], unmatched: 1 });
  });

  it('joins several instruction texts with "; ", trims them and drops blanks', () => {
    const joined = joinDosageInstructions(MEDS.slice(0, 1), [{ id: MEDS[0]?.uuid ?? '', intent: 'plan', dosageTexts: [' one ', '', '   ', 'two'] }]);
    expect(joined.rows[0]?.dosage).toBe('one; two');
  });

  it('counts medications without a matching request, and ignores requests without a medication', () => {
    const joined = joinDosageInstructions(MEDS, [{ id: 'bbbbbbbb-0000-4000-8000-000000000009', intent: 'plan', dosageTexts: ['orphan'] }]);
    expect(joined.unmatched).toBe(3);
    expect(joined.rows.every((r) => r.dosage === null)).toBe(true);
  });

  it('an empty medication list stays empty', () => {
    expect(joinDosageInstructions([], [{ id: 'x', intent: 'plan', dosageTexts: ['x'] }])).toEqual({ rows: [], unmatched: 0 });
  });
});
