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
const ROWS: MedicationRow[] = [{ title: 'Synthetic medication 1' }, { title: 'Synthetic medication 2' }];
const DOSAGE = { field: 'dosage', text: 'Dosage instructions: not available via API' };

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe('MedicationsCard', () => {
  it('renders the legacy title, a one-line source label, title-only rows and the dosage footnote', async () => {
    const { container } = render(<MedicationsCard state={{ kind: 'ok', patientId: P13, rows: ROWS, notes: [DOSAGE] }} />);
    expect(screen.getByRole('heading', { name: 'Medications' })).toBeTruthy();
    expect(container.querySelector('.card-source')?.textContent).toMatch(/medication list.*prescriptions are listed separately/);
    expect([...container.querySelectorAll('li.issue')].map((li) => li.textContent)).toEqual(ROWS.map((r) => r.title));
    expect(container.querySelector('[data-note="dosage"]')?.textContent).toBe('Dosage instructions: not available via API');
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
