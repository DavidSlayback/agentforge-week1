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

export interface VitalsCardDeps {
  readonly upstream: UpstreamClient;
  /** Today's date in OpenEMR's timezone (`YYYY-MM-DD`), for the pediatric rule. */
  readonly today: () => string;
  /** Encounters walked per load before the card fails with `VITALS_SCAN_LIMIT`; `MAX_ENCOUNTER_SCAN` in production. */
  readonly maxEncounters?: number;
}

/** The legacy card shows every measurement in US and metric units at once; the API returns one system. */
export const SECONDARY_UNITS_NOT_SHOWN: GapNote = {
  field: 'units',
  text: 'Units are shown as the API returns them (one system); the legacy card also showed the metric equivalent.',
};

/**
 * The Vitals card (W2D-4, slice 01-05-01). `rest.patient.read` (pid, DOB),
 * then `rest.encounter.list` (newest first), then, one encounter at a time,
 * `rest.vital.list` until an encounter has a live vitals set. That route
 * excludes deleted forms (`deleted=0 AND formdir='vitals'`), so the card shows
 * the latest NON-DELETED set: a deliberate deviation from the legacy card,
 * whose join can show a deleted set (5.01), and the reason FHIR Observation is
 * never used (it has no deleted filter, 5.02 / M-5).
 *
 * Fail loudly: every encounter and vitals row must be this patient's; any
 * failed call is the card's error, never "Nothing Recorded"; and if the cap is
 * reached with encounters left unchecked the card is `VITALS_SCAN_LIMIT`.
 * "Nothing Recorded" means every encounter was checked and none had vitals.
 */
export async function loadVitals(deps: VitalsCardDeps, ctx: CardContext): Promise<CardResult<VitalsDto>> {
  const { patientId, accessToken, correlationId } = ctx;
  const error = (code: 'PATIENT_MISMATCH' | 'SCHEMA_MISMATCH' | 'VITALS_SCAN_LIMIT'): CardResult<VitalsDto> => ({ kind: 'error', patientId, correlationId, code });
  const patient = await resolvePatient(deps.upstream, ctx);
  if (patient.kind === 'failed') return patient.card;

  const listed = mapUpstream(
    await deps.upstream.get({ routeId: 'rest.encounter.list', pathParams: { puuid: patientId }, accessToken, correlationId }),
    { shape: 'rest-envelope', schema: encounterListSchema, emptyMeans: 'empty', notFoundEmptyEnvelopeIsEmpty: true },
  );
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
    const mapped = mapUpstream(
      await deps.upstream.get({ routeId: 'rest.vital.list', pathParams: { pid: patient.pid, eid }, accessToken, correlationId }),
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
