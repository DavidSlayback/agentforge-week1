import { act, cleanup, render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CardResult } from '../../core/cardResult.ts';
import type { HeaderDto } from '../../core/dto.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import type { Fetcher } from '../../web/src/api.ts';
import { PatientView } from '../../web/src/App.tsx';
import stylesheet from '../../web/src/styles.css?raw';

/**
 * Slice 01-06-04: the patient header is the brief's "persistent identity bar".
 * It must stay on screen while the cards scroll (sticky, opaque, above the
 * cards), stay a named landmark, leave room so focused elements are not hidden
 * under it, and stay rendered through patient switches and every card state.
 */

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}

const P13 = uuid('a2d4d063-d949-4f5a-9001-01c1d919afc6');
const P3 = uuid('a2c331a5-3b72-45c1-884e-94015f1f34fa');

// Synthetic display values (not taken from any record).
const header = (patientId: PatientUuid, name: string): HeaderDto => ({
  patientId,
  name,
  birthDate: '1980-01-01',
  ageLabel: 'Age',
  age: '46',
  sex: 'Female',
  mrn: 'SYN',
  status: 'Active',
  deceasedDate: null,
});

let styleEl: HTMLStyleElement | null = null;
beforeEach(() => {
  // The shipped stylesheet, so computed styles below come from the real CSS.
  styleEl = document.createElement('style');
  styleEl.textContent = stylesheet;
  document.head.appendChild(styleEl);
});
afterEach(() => {
  cleanup();
  styleEl?.remove();
});

function deferred() {
  let resolve: (r: Response) => void = () => undefined;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

/** A fetcher whose answers the test releases one URL at a time. */
function controlledFetcher() {
  const pending = new Map<string, ReturnType<typeof deferred>>();
  const fetcher: Fetcher = (url) => {
    const d = deferred();
    pending.set(url, d);
    return d.promise;
  };
  const answer = async (url: string, response: Response): Promise<void> => {
    await act(async () => {
      const d = pending.get(url);
      if (!d) throw new Error(`no pending request for ${url}`);
      d.resolve(response);
      await Promise.resolve();
    });
  };
  return { fetcher, answer, pending };
}

const headerUrl = (id: PatientUuid) => `/dashboard/bff/patients/${id}/header`;
const CARD_PATHS = ['allergies', 'problems', 'medications', 'prescriptions', 'care-team', 'vitals'] as const;

function headerRegion(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('section.patient-header');
  if (!el) throw new Error('no patient header');
  return el;
}

describe('the persistent identity bar (slice 01-06-04)', () => {
  it('is sticky at the top, opaque and above the cards (computed from the shipped stylesheet)', () => {
    const { fetcher } = controlledFetcher();
    const { container } = render(<PatientView fetcher={fetcher} patientId={P13} />);
    const style = window.getComputedStyle(headerRegion(container));
    expect(style.position).toBe('sticky');
    expect(style.top).toBe('0px');
    expect(Number(style.zIndex)).toBeGreaterThan(0);
    // Cards scroll underneath: a transparent bar would show their text through the identity fields.
    // jsdom does not resolve custom properties, so read the declared value and the token it names.
    const rule = [...(styleEl?.sheet?.cssRules ?? [])].find((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === '.patient-header');
    const background = rule?.style.getPropertyValue('background') ?? '';
    const token = /^var\((--[\w-]+)\)$/.exec(background)?.[1];
    const tokenValue = token ? new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(stylesheet)?.[1] : undefined;
    expect(tokenValue ?? background).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('reserves scroll padding so focused or linked elements are not hidden under the bar', () => {
    const html = window.getComputedStyle(document.documentElement);
    expect(html.getPropertyValue('scroll-padding-top').trim()).toBe('var(--sticky-header-offset)');
    const offset = /--sticky-header-offset:\s*([\d.]+)rem/.exec(stylesheet);
    expect(Number(offset?.[1])).toBeGreaterThanOrEqual(4);
  });

  it('is a named landmark that comes before every card in reading order', async () => {
    const { fetcher, answer } = controlledFetcher();
    const { container } = render(<PatientView fetcher={fetcher} patientId={P13} />);
    await answer(headerUrl(P13), json({ kind: 'ok', patientId: P13, rows: [header(P13, 'Synthetic One')], notes: [] } satisfies CardResult<HeaderDto>));
    const bar = headerRegion(container);
    expect(bar.getAttribute('aria-label')).toBe('Patient header');
    const firstCard = container.querySelector('[data-card]');
    expect(firstCard).not.toBeNull();
    if (firstCard) expect(bar.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('stays rendered while cards load and fail, and across a patient switch (same element, never unmounted)', async () => {
    const { fetcher, answer } = controlledFetcher();
    const { container, rerender } = render(<PatientView fetcher={fetcher} patientId={P13} />);
    const bar = headerRegion(container);
    expect(bar.textContent).toMatch(/Loading the patient header/);

    await answer(headerUrl(P13), json({ kind: 'ok', patientId: P13, rows: [header(P13, 'Synthetic One')], notes: [] }));
    await waitFor(() => {
      expect(bar.querySelector('[data-field="name"]')?.textContent).toBe('Synthetic One');
    });
    // Every card still loading: the identity bar is complete and unaffected.
    expect(container.querySelectorAll('[data-state="loading"]')).toHaveLength(CARD_PATHS.length);

    // Every card fails (upstream error, reauth, forbidden): the bar keeps the patient's identity.
    const failures: unknown[] = [
      { kind: 'error', patientId: P13, correlationId: 'corr-1', code: 'UPSTREAM_STATUS' },
      { kind: 'forbidden', patientId: P13 },
      { kind: 'error', patientId: P13, correlationId: 'corr-2', code: 'UPSTREAM_VALIDATION' },
      { kind: 'error', patientId: P13, correlationId: 'corr-3', code: 'SCHEMA_MISMATCH' },
      { kind: 'error', patientId: P13, correlationId: 'corr-4', code: 'UPSTREAM_TIMEOUT' },
      { kind: 'error', patientId: P13, correlationId: 'corr-5', code: 'PATIENT_MISMATCH' },
    ];
    for (const [i, path] of CARD_PATHS.entries()) await answer(`/dashboard/bff/patients/${P13}/${path}`, json(failures[i]));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-state="loading"]')).toHaveLength(0);
    });
    expect(headerRegion(container)).toBe(bar);
    expect(bar.querySelector('[data-field="name"]')?.textContent).toBe('Synthetic One');

    // Switch patient: the same bar element stays; it shows loading (never the previous patient), then the new patient.
    rerender(<PatientView fetcher={fetcher} patientId={P3} />);
    expect(headerRegion(container)).toBe(bar);
    expect(bar.textContent).not.toContain('Synthetic One');
    expect(bar.textContent).toMatch(/Loading the patient header/);
    await answer(headerUrl(P3), json({ kind: 'ok', patientId: P3, rows: [header(P3, 'Synthetic Two')], notes: [] }));
    await waitFor(() => {
      expect(bar.querySelector('[data-field="name"]')?.textContent).toBe('Synthetic Two');
    });
    expect(window.getComputedStyle(bar).position).toBe('sticky');
  });

  it('a header failure keeps the bar in place, as an error state with no identity fields', async () => {
    const { fetcher, answer } = controlledFetcher();
    const { container } = render(<PatientView fetcher={fetcher} patientId={P13} />);
    await answer(headerUrl(P13), json({ kind: 'error', patientId: P13, correlationId: 'corr-h', code: 'UPSTREAM_STATUS' }));
    const bar = headerRegion(container);
    await waitFor(() => {
      expect(bar.textContent).toMatch(/Couldn't load the patient header\. Reference corr-h/);
    });
    expect(bar.querySelector('[data-field]')).toBeNull();
    expect(window.getComputedStyle(bar).position).toBe('sticky');
  });
});
