import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllergyRow } from '../../core/dto.ts';
import { isAllergyRow } from '../../core/guards.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import type { Fetcher } from '../../web/src/api.ts';
import { AllergiesCard } from '../../web/src/cards/AllergiesCard.tsx';
import { useCard, type CardState } from '../../web/src/useCard.ts';

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
const P13 = uuid('a2d4d063-d949-4f5a-9001-01c1d919afc6');

// Synthetic display values.
const ROWS: AllergyRow[] = [
  { title: 'Synthetic allergen A', severityLabel: '1', severe: false, reaction: 'Moderate' },
  { title: 'Synthetic allergen B', severityLabel: 'Severe', severe: true, reaction: null },
  { title: 'Synthetic allergen C', severityLabel: 'Mild', severe: false, reaction: null },
];

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  // jsdom has no layout, so color-contrast moves to the manual pass (01-06-01).
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AllergiesCard', () => {
  it('renders the legacy title, each row as "title (label)", in the given order, highlighting severe only', async () => {
    const { container } = render(<AllergiesCard state={{ kind: 'ok', patientId: P13, rows: ROWS, notes: [] }} />);
    expect(screen.getByRole('heading', { name: 'Allergies' })).toBeTruthy();
    const items = [...container.querySelectorAll('li.issue')].map((li) => li.textContent);
    expect(items).toEqual(['Synthetic allergen A (1)', 'Synthetic allergen B (Severe)', 'Synthetic allergen C (Mild)']);
    const flags = [...container.querySelectorAll('[data-severe]')].map((el) => el.getAttribute('data-severe'));
    expect(flags).toEqual(['false', 'true', 'false']);
    expect(container.querySelectorAll('.severity-severe')).toHaveLength(1);
    expect(container.querySelector('li.issue')?.getAttribute('title')).toBe('Synthetic allergen A Reaction: Moderate - 1');
    await expectNoAxeViolations(container);
  });

  it('shows gap notes next to the data (e.g. severity labels unavailable)', () => {
    render(
      <AllergiesCard
        state={{ kind: 'ok', patientId: P13, rows: ROWS.slice(0, 1), notes: [{ field: 'severity', text: 'Severity labels could not be loaded; raw severity codes are shown.' }] }}
      />,
    );
    expect(screen.getByText(/raw severity codes are shown/)).toBeTruthy();
  });

  it('empty says exactly "Nothing Recorded"', async () => {
    const { container } = render(<AllergiesCard state={{ kind: 'empty', patientId: P13 }} />);
    expect(container.querySelector('.state-empty')?.textContent).toBe('Nothing Recorded');
    expect(container.querySelector('li.issue')).toBeNull();
    await expectNoAxeViolations(container);
  });

  const states: [string, CardState<AllergyRow>, RegExp][] = [
    ['loading', { kind: 'loading' }, /^Loading Allergies…$/],
    ['forbidden', { kind: 'forbidden', patientId: P13 }, /^Not authorized for this section\.$/],
    ['error', { kind: 'error', patientId: P13, correlationId: 'corr-7', code: 'UPSTREAM_VALIDATION' }, /^Couldn't load Allergies\. Reference corr-7 \(UPSTREAM_VALIDATION\)\.$/],
    ['reauth', { kind: 'reauth' }, /session has ended/],
  ];
  it.each(states)('state %s is distinct from empty and from data, and axe-clean', async (kind, state, text) => {
    const { container } = render(<AllergiesCard state={state} />);
    const body = container.querySelector('.card-body');
    expect(body?.textContent).toMatch(text);
    expect(body?.textContent).not.toContain('Nothing Recorded');
    expect(container.querySelector('li.issue')).toBeNull();
    expect(container.querySelector('[data-card="allergies"]')?.getAttribute('data-state')).toBe(kind);
    await expectNoAxeViolations(container);
  });

  it('collapses and remembers it per viewer; default is expanded', () => {
    const first = render(<AllergiesCard state={{ kind: 'empty', patientId: P13 }} />);
    const toggle = screen.getByRole('button', { name: /Collapse Allergies/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Expand Allergies/ }).getAttribute('aria-expanded')).toBe('false');
    expect(first.container.querySelector('.card-body')?.hasAttribute('hidden')).toBe(true);
    first.unmount();
    render(<AllergiesCard state={{ kind: 'empty', patientId: P13 }} />);
    expect(screen.getByRole('button', { name: /Expand Allergies/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('works when storage throws (private mode): expanded, and the toggle still works', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<AllergiesCard state={{ kind: 'ok', patientId: P13, rows: ROWS, notes: [] }} />);
    const toggle = screen.getByRole('button', { name: /Collapse Allergies/ });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Expand Allergies/ })).toBeTruthy();
  });
});

function Harness({ fetcher }: { readonly fetcher: Fetcher }) {
  const state = useCard(fetcher, `/dashboard/bff/patients/${P13}/allergies`, P13, isAllergyRow);
  return <AllergiesCard state={state} />;
}

describe('AllergiesCard through useCard (BFF wire format)', () => {
  it('a well-formed BFF answer renders rows', async () => {
    const fetcher: Fetcher = () => Promise.resolve(new Response(JSON.stringify({ kind: 'ok', patientId: P13, rows: ROWS, notes: [] }), { status: 200 }));
    const { container } = render(<Harness fetcher={fetcher} />);
    await waitFor(() => {
      expect(container.querySelectorAll('li.issue')).toHaveLength(3);
    });
  });

  it('an unexpected shape from the BFF is an error state, never "Nothing Recorded" or data', async () => {
    for (const body of [{ kind: 'ok', patientId: P13, rows: [{ title: 1 }], notes: [] }, { kind: 'empty' }, [], { rows: [] }]) {
      const fetcher: Fetcher = () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      const { container, unmount } = render(<Harness fetcher={fetcher} />);
      await waitFor(() => {
        expect(container.querySelector('[data-card="allergies"]')?.getAttribute('data-state')).toBe('error');
      });
      expect(container.textContent).not.toContain('Nothing Recorded');
      unmount();
    }
  });

  it('loading is shown until the answer arrives', async () => {
    let resolve: (r: Response) => void = () => undefined;
    const fetcher: Fetcher = () =>
      new Promise<Response>((r) => {
        resolve = r;
      });
    const { container } = render(<Harness fetcher={fetcher} />);
    expect(container.querySelector('[data-card="allergies"]')?.getAttribute('data-state')).toBe('loading');
    await act(async () => {
      resolve(new Response(JSON.stringify({ kind: 'empty', patientId: P13 }), { status: 200 }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('.state-empty')?.textContent).toBe('Nothing Recorded');
    });
  });
});
