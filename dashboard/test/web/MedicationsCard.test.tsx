import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MedicationRow } from '../../core/dto.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { MedicationsCard } from '../../web/src/cards/MedicationsCard.tsx';
import type { CardState } from '../../web/src/useCard.ts';

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
const P13 = uuid('a2d4d063-d949-4f5a-9001-01c1d919afc6');

// Synthetic display values.
const ROWS: MedicationRow[] = [
  { title: 'Synthetic medication 1', dosage: '1 tablet daily [synthetic]' },
  { title: 'Synthetic medication 2', dosage: null },
];
const LOAD_FAILED = { field: 'dosage', text: "Dosage instructions: couldn't be loaded from the API (FHIR MedicationRequest); the medication list is complete." };

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe('MedicationsCard', () => {
  it('renders the legacy title, a one-line source label, and each title followed by its dosage instructions where recorded', async () => {
    const { container } = render(<MedicationsCard state={{ kind: 'ok', patientId: P13, rows: ROWS, notes: [] }} />);
    expect(screen.getByRole('heading', { name: 'Medications' })).toBeTruthy();
    expect(container.querySelector('.card-source')?.textContent).toMatch(/medication list.*prescriptions are listed separately/);
    // Legacy medication.html.twig: <span>title</span> <span>drug_dosage_instructions</span>.
    expect([...container.querySelectorAll('li.issue')].map((li) => li.textContent)).toEqual(['Synthetic medication 1 1 tablet daily [synthetic]', 'Synthetic medication 2']);
    expect([...container.querySelectorAll('[data-field="dosage"]')].map((el) => el.textContent)).toEqual(['1 tablet daily [synthetic]']);
    expect(container.querySelector('[data-note]')).toBeNull();
    expect(container.textContent).not.toMatch(/not available via API/);
    await expectNoAxeViolations(container);
  });

  it('when the instructions could not be loaded, the rows stay and the note says so', async () => {
    const rows: MedicationRow[] = ROWS.map((r) => ({ ...r, dosage: null }));
    const { container } = render(<MedicationsCard state={{ kind: 'ok', patientId: P13, rows, notes: [LOAD_FAILED] }} />);
    expect([...container.querySelectorAll('li.issue')].map((li) => li.textContent)).toEqual(rows.map((r) => r.title));
    expect(container.querySelector('[data-note="dosage"]')?.textContent).toBe(LOAD_FAILED.text);
    await expectNoAxeViolations(container);
  });

  it('empty (including the upstream 404-with-empty-body case) says exactly "Nothing Recorded"', async () => {
    const { container } = render(<MedicationsCard state={{ kind: 'empty', patientId: P13 }} />);
    expect(container.querySelector('.card-body')?.textContent).toBe('Nothing Recorded');
    await expectNoAxeViolations(container);
  });

  const states: [string, CardState<MedicationRow>, RegExp][] = [
    ['loading', { kind: 'loading' }, /^Loading Medications…$/],
    ['forbidden', { kind: 'forbidden', patientId: P13 }, /^Not authorized for this section\.$/],
    ['error', { kind: 'error', patientId: P13, correlationId: 'corr-9', code: 'UPSTREAM_STATUS' }, /^Couldn't load Medications\. Reference corr-9 \(UPSTREAM_STATUS\)\.$/],
    ['reauth', { kind: 'reauth' }, /session has ended/],
  ];
  it.each(states)('state %s is distinct from empty and from data, and axe-clean', async (kind, state, text) => {
    const { container } = render(<MedicationsCard state={state} />);
    expect(container.querySelector('.card-body')?.textContent).toMatch(text);
    expect(container.textContent).not.toContain('Nothing Recorded');
    expect(container.querySelector('li.issue')).toBeNull();
    expect(container.querySelector('[data-card="medications"]')?.getAttribute('data-state')).toBe(kind);
    await expectNoAxeViolations(container);
  });
});
