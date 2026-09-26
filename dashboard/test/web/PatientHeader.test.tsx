import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { CardResult } from '../../core/cardResult.ts';
import type { HeaderDto } from '../../core/dto.ts';
import { isHeaderDto } from '../../core/guards.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import type { Fetcher } from '../../web/src/api.ts';
import { PatientHeader } from '../../web/src/components/PatientHeader.tsx';
import { useCard, type CardState } from '../../web/src/useCard.ts';

afterEach(cleanup);

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}

const P13 = uuid('a2d4d063-d949-4f5a-9001-01c1d919afc6');
const P12 = uuid('a2d4d05f-5ff1-4d5d-9b6f-883f99ffc212');

// Synthetic display values (not taken from any record).
const ACTIVE: HeaderDto = {
  patientId: P13,
  name: 'Synthetic Active',
  birthDate: '1974-02-10',
  ageLabel: 'Age',
  age: '52',
  sex: 'Male',
  mrn: '13',
  status: 'Active',
  deceasedDate: null,
};
const DECEASED: HeaderDto = {
  patientId: P12,
  name: 'Synthetic Deceased',
  birthDate: '1995-07-20',
  ageLabel: 'Age at death',
  age: '31',
  sex: 'Male',
  mrn: '12',
  status: 'Deceased',
  deceasedDate: '2026-08-30',
};

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  // jsdom has no layout or canvas, so axe's color-contrast rule cannot run here;
  // contrast is part of the manual accessibility pass (slice 01-06-01).
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

describe('PatientHeader', () => {
  it('renders name, DOB with age, sex, MRN and Active status from the DTO', async () => {
    const { container } = render(<PatientHeader state={{ kind: 'ok', patientId: P13, rows: [ACTIVE], notes: [] }} />);
    expect(screen.getByText('Synthetic Active')).toBeTruthy();
    expect(container.querySelector('[data-field="dob"]')?.textContent).toBe('1974-02-10 (Age: 52)');
    expect(container.querySelector('[data-field="sex"]')?.textContent).toBe('Male');
    expect(container.querySelector('[data-field="mrn"]')?.textContent).toBe('13');
    expect(container.querySelector('[data-field="status"]')?.textContent).toBe('Active');
    await expectNoAxeViolations(container);
  });

  it('renders Deceased with "Age at death"', async () => {
    const { container } = render(<PatientHeader state={{ kind: 'ok', patientId: P12, rows: [DECEASED], notes: [] }} />);
    expect(container.querySelector('[data-field="dob"]')?.textContent).toBe('1995-07-20 (Age at death: 31)');
    expect(container.querySelector('[data-field="status"]')?.textContent).toBe('Deceased (2026-08-30)');
    await expectNoAxeViolations(container);
  });

  it('shows "Not recorded" for missing fields, never blank', () => {
    const { container } = render(
      <PatientHeader state={{ kind: 'ok', patientId: P13, rows: [{ ...ACTIVE, name: null, mrn: null, sex: null }], notes: [] }} />,
    );
    expect(container.querySelector('[data-field="name"]')?.textContent).toBe('Not recorded');
    expect(container.querySelector('[data-field="mrn"]')?.textContent).toBe('Not recorded');
    expect(container.querySelector('[data-field="sex"]')?.textContent).toBe('Not recorded');
  });

  const states: [string, CardState<HeaderDto>, RegExp][] = [
    ['loading', { kind: 'loading' }, /Loading the patient header/],
    ['forbidden', { kind: 'forbidden', patientId: P13 }, /not authorized/],
    ['error', { kind: 'error', patientId: P13, correlationId: 'corr-9', code: 'UPSTREAM_STATUS' }, /Couldn't load the patient header\. Reference corr-9/],
    ['reauth', { kind: 'reauth' }, /session has ended/],
  ];
  it.each(states)('state %s is distinct, shows no patient data, and is axe-clean', async (_k, state, text) => {
    const { container } = render(<PatientHeader state={state} />);
    expect(container.textContent).toMatch(text);
    expect(container.querySelector('[data-field]')).toBeNull();
    await expectNoAxeViolations(container);
  });
});

function Harness({ fetcher, patientId }: { readonly fetcher: Fetcher; readonly patientId: PatientUuid }) {
  const state = useCard(fetcher, `/dashboard/bff/patients/${patientId}/header`, patientId, isHeaderDto);
  return <PatientHeader state={state} />;
}

function deferred() {
  let resolve: (r: Response) => void = () => undefined;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const okResponse = (dto: HeaderDto): Response =>
  new Response(JSON.stringify({ kind: 'ok', patientId: dto.patientId, rows: [dto], notes: [] } satisfies CardResult<HeaderDto>), { status: 200 });

describe('useCard: stale responses are discarded (5.04, 7.04)', () => {
  it('a late answer for the previous patient never renders under the new one', async () => {
    const pending = new Map<string, ReturnType<typeof deferred>>();
    // Ignores the abort signal on purpose, to simulate a response that still arrives.
    const fetcher: Fetcher = (url) => {
      const d = deferred();
      pending.set(url, d);
      return d.promise;
    };
    const { container, rerender } = render(<Harness fetcher={fetcher} patientId={P13} />);
    rerender(<Harness fetcher={fetcher} patientId={P12} />);

    await act(async () => {
      pending.get(`/dashboard/bff/patients/${P12}/header`)?.resolve(okResponse(DECEASED));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-field="name"]')?.textContent).toBe('Synthetic Deceased');
    });

    await act(async () => {
      pending.get(`/dashboard/bff/patients/${P13}/header`)?.resolve(okResponse(ACTIVE));
      await Promise.resolve();
    });
    expect(container.querySelector('[data-field="name"]')?.textContent).toBe('Synthetic Deceased');
    expect(container.textContent).not.toContain('Synthetic Active');
  });

  it('a BFF answer about another patient is an error, not data', async () => {
    const fetcher: Fetcher = () => Promise.resolve(okResponse(DECEASED));
    const { container } = render(<Harness fetcher={fetcher} patientId={P13} />);
    await waitFor(() => {
      expect(container.textContent).toMatch(/PATIENT_MISMATCH/);
    });
    expect(container.textContent).not.toContain('Synthetic Deceased');
  });

  it('a 401 from the BFF shows the sign-in-again state', async () => {
    const fetcher: Fetcher = () => Promise.resolve(new Response(JSON.stringify({ kind: 'reauth' }), { status: 401 }));
    const { container } = render(<Harness fetcher={fetcher} patientId={P13} />);
    await waitFor(() => {
      expect(container.textContent).toMatch(/session has ended/);
    });
  });
});
