import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VitalsDto } from '../../core/dto.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { VitalsCard } from '../../web/src/cards/VitalsCard.tsx';
import type { CardState } from '../../web/src/useCard.ts';

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
const P14 = uuid('8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d');

// Synthetic display values.
const VITALS: VitalsDto = {
  date: '2026-04-05 09:10:00',
  fields: [
    { label: 'Blood Pressure', value: '128/82 mmHg' },
    { label: 'Weight', value: '176 lb' },
    { label: 'Note', value: '<img src=x onerror=alert(1)>' },
  ],
};
const NOTES = [{ field: 'units', text: 'Units are shown as the API returns them (one system); the legacy card also showed the metric equivalent.' }];

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe('VitalsCard', () => {
  it('shows "Most recent vitals from: <date>" and the fields in the order given, as text', async () => {
    const { container } = render(<VitalsCard state={{ kind: 'ok', patientId: P14, rows: [VITALS], notes: NOTES }} />);
    expect(screen.getByRole('heading', { name: 'Vitals' })).toBeTruthy();
    expect(container.querySelector('.vitals-date')?.textContent).toBe('Most recent vitals from: 2026-04-05 09:10:00');
    const labels = [...container.querySelectorAll('.vitals-fields dt')].map((dt) => dt.textContent);
    const values = [...container.querySelectorAll('.vitals-fields dd')].map((dd) => dd.textContent);
    expect(labels).toEqual(['Blood Pressure:', 'Weight:', 'Note:']);
    expect(values).toEqual(['128/82 mmHg', '176 lb', '<img src=x onerror=alert(1)>']);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-note="units"]')?.textContent).toMatch(/one system/);
    await expectNoAxeViolations(container);
  });

  it('empty (no encounter has a live vitals set) says exactly "Nothing Recorded"', async () => {
    const { container } = render(<VitalsCard state={{ kind: 'empty', patientId: P14 }} />);
    expect(container.querySelector('.card-body')?.textContent).toBe('Nothing Recorded');
    await expectNoAxeViolations(container);
  });

  const states: [string, CardState<VitalsDto>, RegExp][] = [
    ['loading', { kind: 'loading' }, /^Loading Vitals…$/],
    ['forbidden', { kind: 'forbidden', patientId: P14 }, /^Not authorized for this section\.$/],
    ['error', { kind: 'error', patientId: P14, correlationId: 'corr-5', code: 'VITALS_SCAN_LIMIT' }, /^Couldn't load Vitals\. Reference corr-5 \(VITALS_SCAN_LIMIT\)\.$/],
    ['reauth', { kind: 'reauth' }, /session has ended/],
  ];
  it.each(states)('state %s is distinct from empty and from data, and axe-clean', async (kind, state, text) => {
    const { container } = render(<VitalsCard state={state} />);
    expect(container.querySelector('.card-body')?.textContent).toMatch(text);
    expect(container.textContent).not.toContain('Nothing Recorded');
    expect(container.querySelector('.vitals-fields')).toBeNull();
    expect(container.querySelector('[data-card="vitals"]')?.getAttribute('data-state')).toBe(kind);
    await expectNoAxeViolations(container);
  });
});
