import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import type { Fetcher } from '../../web/src/api.ts';
import { PatientView } from '../../web/src/App.tsx';
import stylesheet from '../../web/src/styles.css?raw';

/**
 * Slice 01-06-04, layout parity with the legacy dashboard (legacy-*.png in
 * docs/legacy-audit/evidence/parity/): Allergies | Medical Problems |
 * Medications in one three-column row, Prescriptions and Care Team full width,
 * Vitals in the two-thirds-wide left column; one column on narrow screens.
 */

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
const P13 = uuid('a2d4d063-d949-4f5a-9001-01c1d919afc6');

// Nothing ever answers: the layout is the same in every card state.
const never: Fetcher = () => new Promise<Response>(() => undefined);

const LEGACY_ORDER = ['allergies', 'problems', 'medications', 'prescriptions', 'care-team', 'vitals'];

let styleEl: HTMLStyleElement | null = null;
beforeEach(() => {
  styleEl = document.createElement('style');
  styleEl.textContent = stylesheet;
  document.head.appendChild(styleEl);
});
afterEach(() => {
  cleanup();
  styleEl?.remove();
});

function styleRules(list: CSSRuleList | undefined): CSSStyleRule[] {
  return [...(list ?? [])].filter((r): r is CSSStyleRule => r instanceof CSSStyleRule);
}

/** The declarations for `selector` inside the wide-screen media rule. */
function wide(selector: string): CSSStyleDeclaration | undefined {
  const media = [...(styleEl?.sheet?.cssRules ?? [])].find((r): r is CSSMediaRule => r instanceof CSSMediaRule && /min-width/.test(r.conditionText));
  return styleRules(media?.cssRules).find((r) => r.selectorText.split(',').map((s) => s.trim().replace(/"/g, "'")).includes(selector))?.style;
}

describe('card layout (slice 01-06-04)', () => {
  it('renders the cards as direct grid children in the legacy order: Allergies, Problems, Medications, Prescriptions, Care Team, Vitals', () => {
    const { container } = render(<PatientView fetcher={never} patientId={P13} />);
    const grid = container.querySelector('.cards');
    expect(grid).not.toBeNull();
    expect([...(grid?.children ?? [])].map((el) => el.getAttribute('data-card'))).toEqual(LEGACY_ORDER);
    // Headings in the same order (reading order = visual order).
    expect([...container.querySelectorAll('.cards h2')].map((h) => h.textContent)).toEqual([
      'Allergies',
      'Medical Problems',
      'Medications',
      'Prescriptions',
      'Care Team',
      'Vitals',
    ]);
  });

  it('is one column by default (narrow screens), from the shipped stylesheet', () => {
    const { container } = render(<PatientView fetcher={never} patientId={P13} />);
    const grid = container.querySelector('.cards');
    if (!grid) throw new Error('no grid');
    const style = window.getComputedStyle(grid);
    expect(style.display).toBe('grid');
    expect(style.gridTemplateColumns).toBe('minmax(0, 1fr)');
  });

  it('on wide screens: three equal columns; Prescriptions and Care Team span all; Vitals spans the left two', () => {
    expect(wide('.cards')?.getPropertyValue('grid-template-columns')).toBe('repeat(3, minmax(0, 1fr))');
    expect(wide(".cards > [data-card='prescriptions']")?.getPropertyValue('grid-column')).toBe('1 / -1');
    expect(wide(".cards > [data-card='care-team']")?.getPropertyValue('grid-column')).toBe('1 / -1');
    expect(wide(".cards > [data-card='vitals']")?.getPropertyValue('grid-column')).toBe('1 / span 2');
    // The first three cards get no span, so they share the first row, one column each.
    for (const id of ['allergies', 'problems', 'medications']) expect(wide(`.cards > [data-card='${id}']`), id).toBeUndefined();
  });
});
