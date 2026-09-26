import { cleanup, render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AllergyRow, MedicationRow, ProblemRow } from '../../core/dto.ts';
import { isAllergyRow, isMedicationRow, isProblemRow } from '../../core/guards.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import type { Fetcher } from '../../web/src/api.ts';
import { AllergiesCard } from '../../web/src/cards/AllergiesCard.tsx';
import { MedicationsCard } from '../../web/src/cards/MedicationsCard.tsx';
import { ProblemsCard } from '../../web/src/cards/ProblemsCard.tsx';
import { useCard } from '../../web/src/useCard.ts';
import { DRILLS, type Drill } from '../support/drills.ts';

/**
 * The SPA half of the error-state drills: each drill's BFF wire answer (the
 * value `test/bff/drills.test.ts` proves the BFF sends for that upstream
 * failure) is served to the real card through `useCard`, and the card must
 * show its own distinct state and never upstream text.
 */

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
const P13 = uuid('a2d4d063-d949-4f5a-9001-01c1d919afc6');
// The BFF's correlation id is a random uuid; a fixed synthetic one stands in for it here.
const CORRELATION = '0b7c6a1e-0000-4000-8000-00000000d111';

function wireResponse(drill: Drill): Response {
  const w = drill.wire;
  const body =
    w.kind === 'reauth'
      ? { kind: 'reauth' }
      : w.kind === 'error'
        ? { kind: 'error', patientId: P13, correlationId: CORRELATION, code: w.code }
        : { kind: w.kind, patientId: P13 };
  return new Response(JSON.stringify(body), { status: w.status });
}

function DrillCard({ drill, fetcher }: { readonly drill: Drill; readonly fetcher: Fetcher }) {
  const path = `/dashboard/bff/patients/${P13}/${drill.card}`;
  const allergies = useCard<AllergyRow>(fetcher, path, P13, isAllergyRow);
  const problems = useCard<ProblemRow>(fetcher, path, P13, isProblemRow);
  const medications = useCard<MedicationRow>(fetcher, path, P13, isMedicationRow);
  switch (drill.card) {
    case 'allergies':
      return <AllergiesCard state={allergies} />;
    case 'problems':
      return <ProblemsCard state={problems} />;
    case 'medications':
      return <MedicationsCard state={medications} />;
  }
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe('error-state drills in the SPA (the BFF wire answer rendered by the real card)', () => {
  it.each(DRILLS.map((d) => [d.name, d] as const))('%s', async (_name, drill) => {
    const fetcher: Fetcher = () => Promise.resolve(wireResponse(drill));
    const { container } = render(<DrillCard drill={drill} fetcher={fetcher} />);
    const card = container.querySelector(`[data-card="${drill.card}"]`);
    await waitFor(() => {
      expect(card?.getAttribute('data-state')).toBe(drill.wire.kind);
    });
    const body = container.querySelector('.card-body')?.textContent ?? '';
    expect(body.replace(CORRELATION, 'ref')).toMatch(drill.ui);
    expect(container.querySelector('h2')?.textContent).toBe(drill.title);
    for (const text of drill.neverShown) expect(container.textContent, text).not.toContain(text);
    // No data rows in any non-data state.
    expect(container.querySelector('li.issue, tbody tr')).toBeNull();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('the four kinds of outcome read differently: reauth, forbidden, error and empty are never the same text', async () => {
    const texts = new Map<string, string>();
    for (const drill of DRILLS) {
      const fetcher: Fetcher = () => Promise.resolve(wireResponse(drill));
      const { container, unmount } = render(<DrillCard drill={drill} fetcher={fetcher} />);
      await waitFor(() => {
        expect(container.querySelector('[data-card]')?.getAttribute('data-state')).toBe(drill.wire.kind);
      });
      const text = (container.querySelector('.card-body')?.textContent ?? '').replace(/Reference \S+ \(\w+\)/, 'Reference');
      texts.set(drill.wire.kind, text.replace(drill.title, 'CARD'));
      unmount();
    }
    expect([...texts.keys()].sort()).toEqual(['empty', 'error', 'forbidden', 'reauth']);
    expect(new Set(texts.values()).size).toBe(4);
  });
});
