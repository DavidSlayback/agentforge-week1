import { useEffect, useState } from 'react';
import type { CardResult } from '../../core/cardResult.ts';
import type { PatientUuid } from '../../core/ids.ts';
import { fetchCard, type Fetcher } from './api.ts';

export type CardState<T> = { readonly kind: 'loading' } | CardResult<T>;

/**
 * Load one card for the patient in the route. The request is aborted when the
 * patient changes, and a result is shown only while it belongs to the current
 * patient, so no card renders under another patient's header (5.04, 7.04).
 */
export function useCard<T>(
  fetcher: Fetcher,
  path: string,
  patientId: PatientUuid,
  isRow: (row: unknown) => row is T,
): CardState<T> {
  const [loaded, setLoaded] = useState<{ readonly forPatient: PatientUuid; readonly result: CardResult<T> } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchCard(fetcher, path, patientId, isRow, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setLoaded({ forPatient: patientId, result });
      },
      () => {
        // Aborted: a newer patient's request owns the state now.
      },
    );
    return () => {
      controller.abort();
    };
  }, [fetcher, path, patientId, isRow]);

  if (loaded === null || loaded.forPatient !== patientId) return { kind: 'loading' };
  return loaded.result;
}
