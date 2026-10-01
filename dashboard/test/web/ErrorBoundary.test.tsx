import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertNever } from '../../core/cardResult.ts';
import type { VitalsDto } from '../../core/dto.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { AllergiesCard } from '../../web/src/cards/AllergiesCard.tsx';
import { VitalsCard } from '../../web/src/cards/VitalsCard.tsx';
import { Card } from '../../web/src/components/Card.tsx';
import type { CardState } from '../../web/src/useCard.ts';

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
const P14 = uuid('8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d');
const SECRET_MARKER = 'SYNTHETIC-VALUE-THAT-MUST-NOT-RENDER';

beforeEach(() => {
  window.localStorage.clear();
  // React reports a caught render error on console.error; the boundary is what is under test.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// W3 hardening H4: a render throw (assertNever, a malformed row) used to unmount the whole SPA and
// leave a blank page. Each card now has its own boundary: the card shows its error state, keeps its
// title, and every other card keeps rendering.
describe('per-card render error boundary', () => {
  it('a card whose body throws shows its own error state; its neighbour still renders', async () => {
    const boom = (): never => assertNever(SECRET_MARKER as never);
    const { container } = render(
      <>
        <Card id="broken" title="Broken" state={{ kind: 'ok', patientId: P14, rows: [1], notes: [] }} renderRows={boom} />
        <AllergiesCard state={{ kind: 'empty', patientId: P14 }} />
      </>,
    );
    const broken = document.querySelector('[data-card="broken"]');
    expect(broken?.querySelector('[data-render-error]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Broken' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe("Couldn't display Broken (RENDER_ERROR).");
    expect(document.body.textContent).not.toContain(SECRET_MARKER); // the error message is never shown
    expect(document.querySelector('[data-card="allergies"]')?.textContent).toContain('Nothing Recorded');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('a malformed Vitals row (no fields) is the card error, not a blank page', () => {
    const bad = { date: '2026-04-05 09:10:00' } as unknown as VitalsDto;
    render(<VitalsCard state={{ kind: 'ok', patientId: P14, rows: [bad], notes: [] }} />);
    expect(screen.getByRole('heading', { name: 'Vitals' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe("Couldn't display Vitals (RENDER_ERROR).");
  });

  it('recovers when the card gets a new state (another patient, a reload)', () => {
    const bad = { date: 'x' } as unknown as VitalsDto;
    const good: CardState<VitalsDto> = { kind: 'ok', patientId: P14, rows: [{ date: '2026-04-05 09:10:00', fields: [{ label: 'Pulse', value: '72' }] }], notes: [] };
    const { rerender } = render(<VitalsCard state={{ kind: 'ok', patientId: P14, rows: [bad], notes: [] }} />);
    expect(screen.queryByRole('alert')).not.toBeNull();
    rerender(<VitalsCard state={good} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('[data-card="vitals"]')?.textContent).toContain('Pulse');
  });
});
