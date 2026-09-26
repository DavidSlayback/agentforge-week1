import type { CardResult } from '../../core/cardResult.ts';
import type { PatientLookupResult, SessionDto } from '../../core/dto.ts';
import { isCardResult, isPatientLookupResult, isSessionDto } from '../../core/guards.ts';
import type { PatientUuid } from '../../core/ids.ts';

/** The SPA talks only to its own BFF (same origin). It never sees a token. */
export const BASE = '/dashboard';

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function getJson(fetcher: Fetcher, path: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = { credentials: 'same-origin', headers: { accept: 'application/json' } };
  if (signal) init.signal = signal;
  const res = await fetcher(path, init);
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function fetchSession(fetcher: Fetcher): Promise<SessionDto> {
  try {
    const { status, body } = await getJson(fetcher, `${BASE}/bff/session`);
    return status === 200 && isSessionDto(body) ? body : { authenticated: false };
  } catch {
    return { authenticated: false };
  }
}

/**
 * Fetch one card. A 401 means the BFF session is gone (`reauth`). Anything
 * that is not a well-formed `CardResult` for *this* patient becomes an error
 * state, never data (5.04). Aborts propagate so the caller can ignore them.
 */
export async function fetchCard<T>(
  fetcher: Fetcher,
  path: string,
  patientId: PatientUuid,
  isRow: (row: unknown) => row is T,
  signal: AbortSignal,
): Promise<CardResult<T>> {
  const unavailable: CardResult<T> = { kind: 'error', patientId, correlationId: 'none', code: 'BFF_UNAVAILABLE' };
  let res: { status: number; body: unknown };
  try {
    res = await getJson(fetcher, path, signal);
  } catch (err) {
    if (signal.aborted) throw err;
    return unavailable;
  }
  if (res.status === 401) return { kind: 'reauth' };
  if (res.status !== 200 || !isCardResult(res.body, isRow)) return unavailable;
  const card = res.body;
  if (card.kind !== 'reauth' && card.patientId !== patientId) {
    return { kind: 'error', patientId, correlationId: 'none', code: 'PATIENT_MISMATCH' };
  }
  return card;
}

export async function lookupByMrn(fetcher: Fetcher, mrn: string): Promise<PatientLookupResult> {
  const unavailable: PatientLookupResult = { kind: 'error', correlationId: 'none', code: 'BFF_UNAVAILABLE' };
  try {
    const { status, body } = await getJson(fetcher, `${BASE}/bff/patients/by-mrn/${encodeURIComponent(mrn)}`);
    if (status === 401) return { kind: 'reauth' };
    return status === 200 && isPatientLookupResult(body) ? body : unavailable;
  } catch {
    return unavailable;
  }
}
