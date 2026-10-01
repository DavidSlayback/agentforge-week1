import type { CardResult, GapNote } from '../../../core/cardResult.ts';
import type { VitalsDto } from '../../../core/dto.ts';
import { parseEncounterId, parsePid, type EncounterId } from '../../../core/ids.ts';
import { isPediatric, latestVitalsSet, MAX_ENCOUNTER_SCAN, vitalsFields } from '../../../core/rules/vitals.ts';
import type { UpstreamClient } from '../upstream/client.ts';
import { failureToCard, mapUpstream } from '../upstream/mapResponse.ts';
import { encounterListSchema } from '../upstream/schemas/encounter.ts';
import { vitalListSchema } from '../upstream/schemas/vital.ts';
import type { CardContext } from './header.ts';
import { resolvePatient } from './patientRead.ts';

/**
 * Overall time budget for one Vitals load (W3 hardening H4). The walk is
 * sequential and each call has its own 5 s timeout, so without it a load could
 * take 50 × 5 s. Past it the card is `VITALS_DEADLINE`, never "Nothing Recorded".
 */
export const VITALS_DEADLINE_MS = 10_000;

export interface VitalsCardDeps {
  readonly upstream: UpstreamClient;
  /** Today's date in OpenEMR's timezone (`YYYY-MM-DD`), for the pediatric rule. */
  readonly today: () => string;
  /** Encounters walked per load before the card fails with `VITALS_SCAN_LIMIT`; `MAX_ENCOUNTER_SCAN` in production. */
  readonly maxEncounters?: number;
  /** Overall budget for the load before the card fails with `VITALS_DEADLINE`; `VITALS_DEADLINE_MS` in production. */
  readonly deadlineMs?: number;
}

/** The legacy card shows every measurement in US and metric units at once; the API returns one system. */
export const SECONDARY_UNITS_NOT_SHOWN: GapNote = {
  field: 'units',
  text: 'Units are shown as the API returns them (one system); the legacy card also showed the metric equivalent.',
};

/**
 * The Vitals card (W2D-4, slice 01-05-01). `rest.patient.read` (pid, DOB),
 * then `rest.encounter.list`, then, one encounter at a time in descending
 * encounter-number order, `rest.vital.list` until an encounter has a live
 * vitals set. That route excludes deleted forms (`deleted=0 AND
 * formdir='vitals'`), so the card shows the newest non-deleted set of the
 * highest-numbered encounter that has one: a deliberate deviation from the
 * legacy card, whose join can show a deleted set (5.01), and the reason FHIR
 * Observation is never used (it has no deleted filter, 5.02 / M-5). The walk
 * trusts encounter-number order: it matches visit-date order on every seeded
 * patient but the schema does not enforce it, so a newer set on a
 * lower-numbered encounter is missed (walkthroughs/VITALS.md (c)).
 *
 * Fail loudly: every encounter and vitals row must be this patient's; any
 * failed call is the card's error, never "Nothing Recorded"; if the cap is
 * reached with encounters left unchecked the card is `VITALS_SCAN_LIMIT`; and
 * if the load runs past its deadline (the in-flight call is aborted) the card
 * is `VITALS_DEADLINE`. "Nothing Recorded" means every encounter was checked
 * and none had vitals.
 */
export async function loadVitals(deps: VitalsCardDeps, ctx: CardContext): Promise<CardResult<VitalsDto>> {
  const { patientId, accessToken, correlationId } = ctx;
  const error = (code: 'PATIENT_MISMATCH' | 'SCHEMA_MISMATCH' | 'VITALS_SCAN_LIMIT' | 'VITALS_DEADLINE'): CardResult<VitalsDto> => ({
    kind: 'error',
    patientId,
    correlationId,
    code,
  });
  const deadline = AbortSignal.timeout(deps.deadlineMs ?? VITALS_DEADLINE_MS);
  // Every call of this load carries the deadline, so the call in flight when it fires is aborted.
  const upstream: UpstreamClient = { get: (request) => deps.upstream.get({ ...request, signal: deadline }) };
  const pastDeadline = (): boolean => deadline.aborted;

  const patient = await resolvePatient(upstream, ctx);
  if (pastDeadline()) return error('VITALS_DEADLINE');
  if (patient.kind === 'failed') return patient.card;

  const listed = mapUpstream(
    await upstream.get({ routeId: 'rest.encounter.list', pathParams: { puuid: patientId }, accessToken, correlationId }),
    { shape: 'rest-envelope', schema: encounterListSchema, emptyMeans: 'empty', notFoundEmptyEnvelopeIsEmpty: true },
  );
  if (pastDeadline()) return error('VITALS_DEADLINE');
  if (listed.kind === 'failure') return failureToCard(listed.failure, patientId, correlationId);
  if (listed.kind === 'empty') return { kind: 'empty', patientId };

  const encounters: EncounterId[] = [];
  for (const row of listed.value) {
    const eid = parseEncounterId(row.eid);
    if (eid === null) return error('SCHEMA_MISMATCH');
    if (row.puuid?.toLowerCase() !== patientId || parsePid(row.pid) !== patient.pid) return error('PATIENT_MISMATCH');
    encounters.push(eid);
  }
  // Newest first by encounter number, as the route orders them (`ORDER BY fe.eid DESC`); sorted here so
  // the walk never depends on response order.
  encounters.sort((a, b) => b - a);

  const cap = deps.maxEncounters ?? MAX_ENCOUNTER_SCAN;
  for (const [index, eid] of encounters.entries()) {
    if (index >= cap) return error('VITALS_SCAN_LIMIT');
    if (pastDeadline()) return error('VITALS_DEADLINE');
    const outcome = await upstream.get({ routeId: 'rest.vital.list', pathParams: { pid: patient.pid, eid }, accessToken, correlationId });
    if (pastDeadline()) return error('VITALS_DEADLINE');
    const mapped = mapUpstream(
      outcome,
      // No live vitals in this encounter: HTTP 404 with an empty body (`responseHandler()`), or `[]`.
      { shape: 'rest-array', schema: vitalListSchema, emptyMeans: 'empty', notFoundEmptyBodyIsEmpty: true },
    );
    if (mapped.kind === 'failure') return failureToCard(mapped.failure, patientId, correlationId);
    if (mapped.kind === 'empty') continue;
    const mismatch = !mapped.value.every(
      (row) => row.puuid?.toLowerCase() === patientId && parsePid(row.pid) === patient.pid && parseEncounterId(row.eid) === eid,
    );
    if (mismatch) return error('PATIENT_MISMATCH');
    const set = latestVitalsSet(mapped.value);
    if (set === null) continue;
    const dto: VitalsDto = { date: set.date ?? '', fields: vitalsFields(set, isPediatric(patient.birthDate, deps.today())) };
    return { kind: 'ok', patientId, rows: [dto], notes: [SECONDARY_UNITS_NOT_SHOWN] };
  }
  return { kind: 'empty', patientId };
}
