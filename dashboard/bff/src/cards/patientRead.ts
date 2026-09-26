import type { CardResult } from '../../../core/cardResult.ts';
import { parsePid, type Pid } from '../../../core/ids.ts';
import type { UpstreamClient } from '../upstream/client.ts';
import { failureToCard, mapUpstream } from '../upstream/mapResponse.ts';
import { restPatientSchema } from '../upstream/schemas/patient.ts';
import type { CardContext } from './header.ts';

export type PatientRead = { readonly kind: 'resolved'; readonly pid: Pid } | { readonly kind: 'failed'; readonly card: CardResult<never> };

/**
 * Resolve the requested patient once through `rest.patient.read` before any
 * card route is called (walkthroughs/ISSUE-CARDS.md (b)1 and (e): no card is
 * fetched until the patient read has succeeded; 10.04: the integer pid comes
 * only from the patient's own API response). A record for another uuid is
 * `PATIENT_MISMATCH` (5.04).
 */
export async function resolvePatient(upstream: UpstreamClient, ctx: CardContext): Promise<PatientRead> {
  const { patientId, accessToken, correlationId } = ctx;
  const failed = (code: 'PATIENT_MISMATCH' | 'SCHEMA_MISMATCH'): PatientRead => ({
    kind: 'failed',
    card: { kind: 'error', patientId, correlationId, code },
  });
  const mapped = mapUpstream(
    await upstream.get({ routeId: 'rest.patient.read', pathParams: { puuid: patientId }, accessToken, correlationId }),
    { shape: 'rest-envelope', schema: restPatientSchema, emptyMeans: 'error' },
  );
  if (mapped.kind === 'failure') return { kind: 'failed', card: failureToCard(mapped.failure, patientId, correlationId) };
  if (mapped.kind === 'empty') return failed('SCHEMA_MISMATCH');
  if (mapped.value.uuid.toLowerCase() !== patientId) return failed('PATIENT_MISMATCH');
  const pid = parsePid(mapped.value.pid);
  if (pid === null) return failed('SCHEMA_MISMATCH');
  return { kind: 'resolved', pid };
}

/** True when a row's `pid` column names the resolved patient (checked on every row). */
export function rowBelongsTo(rowPid: string | number, pid: Pid): boolean {
  return parsePid(rowPid) === pid;
}
