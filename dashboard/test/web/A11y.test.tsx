import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeaderDto, PrescriptionRow, SessionDto } from '../../core/dto.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import type { Fetcher } from '../../web/src/api.ts';
import { App } from '../../web/src/App.tsx';
import { PrescriptionsCard } from '../../web/src/cards/PrescriptionsCard.tsx';
import { PatientHeader } from '../../web/src/components/PatientHeader.tsx';
import stylesheet from '../../web/src/styles.css?raw';

/**
 * Fixes from the real-browser accessibility pass (docs/legacy-audit/evidence/a11y/README.md).
 * Each finding was seen in headless Chromium on the local stack; jsdom has no layout, so
 * these tests pin the mechanism (overflow detection, measured offset, shipped CSS rules).
 */

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
const P14 = uuid('8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d');
const P3 = uuid('a2c331a5-3b72-45c1-884e-94015f1f34fa');

// Synthetic display values.
const ROWS: PrescriptionRow[] = [{ drug: 'Synthetic drug A', details: '500mg 1', quantity: '60', refills: null, filled: '2026-03-14 10:30:00' }];
const HEADER: HeaderDto = {
  patientId: P14,
  name: 'Synthetic Person',
  birthDate: '1980-01-01',
  ageLabel: 'Age',
  age: '46',
  sex: 'Female',
  mrn: 'SYN',
  status: 'Active',
  deceasedDate: null,
};

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

/** Pretends every `.card-body` is `inner` px wide inside `outer` px (jsdom has no layout). */
function fakeCardBodyWidths(inner: number, outer: number): () => void {
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('card-body') ? inner : 0;
  });
  const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('card-body') ? outer : 0;
  });
  return () => {
    scroll.mockRestore();
    client.mockRestore();
  };
}

let styleEl: HTMLStyleElement | null = null;
beforeEach(() => {
  window.localStorage.clear();
  styleEl = document.createElement('style');
  styleEl.textContent = stylesheet;
  document.head.appendChild(styleEl);
});
afterEach(() => {
  cleanup();
  styleEl?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a card body that scrolls sideways (finding K-2)', () => {
  it('becomes a focusable region named after its card, so keyboard users can scroll it and screen readers announce it', async () => {
    const restore = fakeCardBodyWidths(620, 300);
    const { container } = render(<PrescriptionsCard state={{ kind: 'ok', patientId: P14, rows: ROWS, notes: [] }} />);
    const body = container.querySelector<HTMLElement>('.card-body');
    await waitFor(() => {
      expect(body?.getAttribute('tabindex')).toBe('0');
    });
    expect(screen.getByRole('region', { name: 'Prescriptions, scrolls sideways' })).toBe(body);
    await expectNoAxeViolations(container);
    restore();
  });

  it('stays a plain container, out of the tab order, when its content fits', async () => {
    const restore = fakeCardBodyWidths(300, 300);
    const { container } = render(<PrescriptionsCard state={{ kind: 'ok', patientId: P14, rows: ROWS, notes: [] }} />);
    const body = container.querySelector<HTMLElement>('.card-body');
    expect(body?.hasAttribute('tabindex')).toBe(false);
    expect(body?.hasAttribute('role')).toBe(false);
    expect(body?.hasAttribute('aria-label')).toBe(false);
    await expectNoAxeViolations(container);
    restore();
  });

  it('shows a visible focus ring inside the card border (shipped stylesheet)', () => {
    const rule = [...(styleEl?.sheet?.cssRules ?? [])].find((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === '.card-body[tabindex]:focus-visible');
    expect(rule?.style.getPropertyValue('outline')).toMatch(/^2px solid/);
  });
});

describe('the sticky header never hides the focused control (finding K-3)', () => {
  it('sets the scroll padding from the bar’s measured height, and removes it on unmount', () => {
    let notify: () => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          notify = cb;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    let height = 155; // the bar at 320 CSS px wide, taller than the 9 rem (144 px) fallback
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains('patient-header') ? height : 0 } as DOMRect;
    });
    const { unmount } = render(<PatientHeader state={{ kind: 'ok', patientId: P14, rows: [HEADER], notes: [] }} />);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--sticky-header-offset')).toBe('163px');
    height = 97;
    act(() => {
      notify();
    });
    expect(root.style.getPropertyValue('--sticky-header-offset')).toBe('105px');
    unmount();
    expect(root.style.getPropertyValue('--sticky-header-offset')).toBe('');
  });

  it('stops being sticky on very short viewports (about 400 % zoom), where it would cover most of the screen', () => {
    const media = [...(styleEl?.sheet?.cssRules ?? [])].find((r): r is CSSMediaRule => r instanceof CSSMediaRule && /max-height/.test(r.conditionText));
    expect(media?.conditionText).toMatch(/max-height:\s*20rem/);
    const rules = [...(media?.cssRules ?? [])].filter((r): r is CSSStyleRule => r instanceof CSSStyleRule);
    expect(rules.find((r) => r.selectorText === '.patient-header')?.style.getPropertyValue('position')).toBe('static');
    expect(rules.find((r) => r.selectorText === 'html')?.style.getPropertyValue('scroll-padding-top')).toBe('0');
  });
});

describe('demo patient links meet the 24 px target size (finding A-1)', () => {
  it('renders them in the styled list, each at least 1.5 rem tall with space between', async () => {
    window.history.pushState(null, '', '/dashboard/');
    const session: SessionDto = {
      authenticated: true,
      displayConfig: { dateFormat: 'YYYY-MM-DD', ageFormat: 'years-or-months' },
      demoPatients: [
        { label: 'Demo one', patientId: P14 },
        { label: 'Demo two', patientId: P3 },
      ],
    };
    const fetcher: Fetcher = () => Promise.resolve(new Response(JSON.stringify(session), { status: 200 }));
    const { container } = render(<App fetcher={fetcher} />);
    const link = await screen.findByRole('link', { name: 'Demo one' });
    expect(link.closest('ul')?.classList.contains('demo-patients')).toBe(true);
    const a = window.getComputedStyle(link);
    expect(a.display).toBe('inline-block');
    expect(a.minHeight).toBe('1.5rem');
    const li = link.closest('li');
    expect(li ? window.getComputedStyle(li).marginTop : '').toBe('0.25rem');
    await expectNoAxeViolations(container);
  });
});
