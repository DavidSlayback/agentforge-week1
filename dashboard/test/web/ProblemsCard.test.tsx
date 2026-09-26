import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProblemRow } from '../../core/dto.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { ProblemsCard } from '../../web/src/cards/ProblemsCard.tsx';
import type { CardState } from '../../web/src/useCard.ts';

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
const P13 = uuid('a2d4d063-d949-4f5a-9001-01c1d919afc6');

// Synthetic display values, in the order the BFF sends them (already begdate-sorted).
const ROWS: ProblemRow[] = [{ title: 'Synthetic problem 1' }, { title: 'Synthetic problem 2' }, { title: 'Synthetic problem 3' }];

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe('ProblemsCard', () => {
  it('renders the legacy title and one title-only row per problem, in the order received', async () => {
    const { container } = render(<ProblemsCard state={{ kind: 'ok', patientId: P13, rows: ROWS, notes: [] }} />);
    expect(screen.getByRole('heading', { name: 'Medical Problems' })).toBeTruthy();
    expect([...container.querySelectorAll('li.issue')].map((li) => li.textContent)).toEqual(ROWS.map((r) => r.title));
    await expectNoAxeViolations(container);
  });

  it('empty says exactly "Nothing Recorded"', async () => {
    const { container } = render(<ProblemsCard state={{ kind: 'empty', patientId: P13 }} />);
    expect(container.querySelector('.card-body')?.textContent).toBe('Nothing Recorded');
    await expectNoAxeViolations(container);
  });

  const states: [string, CardState<ProblemRow>, RegExp][] = [
    ['loading', { kind: 'loading' }, /^Loading Medical Problems…$/],
    // The route needs encounters/notes, so this card alone can be denied (3.14).
    ['forbidden', { kind: 'forbidden', patientId: P13 }, /^Not authorized for this section\.$/],
    ['error', { kind: 'error', patientId: P13, correlationId: 'corr-8', code: 'SCHEMA_MISMATCH' }, /^Couldn't load Medical Problems\. Reference corr-8 \(SCHEMA_MISMATCH\)\.$/],
    ['reauth', { kind: 'reauth' }, /session has ended/],
  ];
  it.each(states)('state %s is distinct from empty and from data, and axe-clean', async (kind, state, text) => {
    const { container } = render(<ProblemsCard state={state} />);
    expect(container.querySelector('.card-body')?.textContent).toMatch(text);
    expect(container.textContent).not.toContain('Nothing Recorded');
    expect(container.querySelector('[data-card="problems"]')?.getAttribute('data-state')).toBe(kind);
    await expectNoAxeViolations(container);
  });
});
