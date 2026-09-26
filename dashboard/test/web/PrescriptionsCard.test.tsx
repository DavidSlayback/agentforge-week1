import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrescriptionRow } from '../../core/dto.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { PrescriptionsCard } from '../../web/src/cards/PrescriptionsCard.tsx';
import type { CardState } from '../../web/src/useCard.ts';

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
const P14 = uuid('8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d');

// Synthetic display values.
const ROWS: PrescriptionRow[] = [
  { drug: 'Synthetic drug A', details: '500mg 1', quantity: '60', refills: null, filled: '2026-03-14 10:30:00' },
  { drug: 'Synthetic drug B', details: '10mg 1', quantity: '', refills: null, filled: '2025-11-02 09:00:00' },
];
const NOTES = [
  { field: 'refills', text: 'Refills: not available via API (OpenEMR stores them, but its prescription API does not return them).' },
  { field: 'form', text: 'Dosage form: not available via API, so Details omits it.' },
];

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe('PrescriptionsCard', () => {
  it('renders the legacy columns in order, one row per prescription, in the order given', async () => {
    const { container } = render(<PrescriptionsCard state={{ kind: 'ok', patientId: P14, rows: ROWS, notes: NOTES }} />);
    expect(screen.getByRole('heading', { name: 'Prescriptions' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Drug', 'Details', 'Qty', 'Refills', 'Filled']);
    const cells = [...container.querySelectorAll('tr.rx-row')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(cells).toEqual([
      ['Synthetic drug A', '500mg 1', '60', 'Not available via API', '2026-03-14 10:30:00'],
      ['Synthetic drug B', '10mg 1', '', 'Not available via API', '2025-11-02 09:00:00'],
    ]);
    expect(container.querySelector('.card-source')?.textContent).toMatch(/Prescriptions.*every status.*medication list is separate/);
    expect(container.querySelector('[data-note="refills"]')?.textContent).toMatch(/^Refills: not available via API/);
    await expectNoAxeViolations(container);
  });

  it('every Refills cell reads "Not available via API", never 0 or blank', () => {
    const { container } = render(<PrescriptionsCard state={{ kind: 'ok', patientId: P14, rows: ROWS, notes: NOTES }} />);
    const refills = [...container.querySelectorAll('[data-gap="refills"]')].map((td) => td.textContent);
    expect(refills).toEqual(['Not available via API', 'Not available via API']);
  });

  it('empty says exactly "None", the legacy Rx card text', async () => {
    const { container } = render(<PrescriptionsCard state={{ kind: 'empty', patientId: P14 }} />);
    expect(container.querySelector('.card-body')?.textContent).toBe('None');
    expect(container.querySelector('table')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('renders a hostile drug name as literal text (JSX escaping, 2.04)', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { container } = render(
      <PrescriptionsCard state={{ kind: 'ok', patientId: P14, rows: [{ ...ROWS[0], drug: hostile } as PrescriptionRow], notes: [] }} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('tr.rx-row td')?.textContent).toBe(hostile);
  });

  const states: [string, CardState<PrescriptionRow>, RegExp][] = [
    ['loading', { kind: 'loading' }, /^Loading Prescriptions…$/],
    ['forbidden', { kind: 'forbidden', patientId: P14 }, /^Not authorized for this section\.$/],
    ['error', { kind: 'error', patientId: P14, correlationId: 'corr-7', code: 'PATIENT_MISMATCH' }, /^Couldn't load Prescriptions\. Reference corr-7 \(PATIENT_MISMATCH\)\.$/],
    ['reauth', { kind: 'reauth' }, /session has ended/],
  ];
  it.each(states)('state %s is distinct from empty and from data, and axe-clean', async (kind, state, text) => {
    const { container } = render(<PrescriptionsCard state={state} />);
    expect(container.querySelector('.card-body')?.textContent).toMatch(text);
    expect(container.querySelector('.card-body')?.textContent).not.toBe('None');
    expect(container.querySelector('tr.rx-row')).toBeNull();
    expect(container.querySelector('[data-card="prescriptions"]')?.getAttribute('data-state')).toBe(kind);
    await expectNoAxeViolations(container);
  });
});
