import type { CardResult } from '../../../core/cardResult.ts';
import type { HeaderDto } from '../../../core/dto.ts';
import { parsePid, type PatientUuid, type Pid } from '../../../core/ids.ts';
import { deriveHeader, extractMrn } from '../../../core/rules/header.ts';
import type { UpstreamClient } from '../upstream/client.ts';
import { failureToCard, mapUpstream } from '../upstream/mapResponse.ts';
import { fhirPatientSchema, restPatientSchema } from '../upstream/schemas/patient.ts';

export interface CardContext {
  readonly patientId: PatientUuid;
  readonly accessToken: string;
  readonly correlationId: string;
}

export interface HeaderDeps {
  readonly upstream: UpstreamClient;
  /** Today's date in OpenEMR's timezone (`YYYY-MM-DD`). */
  readonly today: () => string;
}

export interface HeaderLoad {
  readonly card: CardResult<HeaderDto>;
  /** The integer pid resolved once from `rest.patient.read` (10.04); `null` unless `card` is ok. */
  readonly pid: Pid | null;
}

/**
 * The patient header use case (W2D-2): `fhir.patient.read`, then
 * `rest.patient.read` to resolve the integer pid. Both responses must be about
 * the requested patient, or the header fails with `PATIENT_MISMATCH` (5.04).
 * The header DTO exists only after both authorized calls succeed (3.02).
 */
export async function loadHeader(deps: HeaderDeps, ctx: CardContext): Promise<HeaderLoad> {
  const { patientId, accessToken, correlationId } = ctx;
  const error = (code: 'PATIENT_MISMATCH' | 'SCHEMA_MISMATCH'): HeaderLoad => ({
    card: { kind: 'error', patientId, correlationId, code },
    pid: null,
  });

  const fhir = mapUpstream(
    await deps.upstream.get({ routeId: 'fhir.patient.read', pathParams: { puuid: patientId }, accessToken, correlationId }),
    { shape: 'fhir-resource', schema: fhirPatientSchema, emptyMeans: 'error' },
  );
  if (fhir.kind === 'failure') return { card: failureToCard(fhir.failure, patientId, correlationId), pid: null };
  if (fhir.kind === 'empty') return error('SCHEMA_MISMATCH');
  if (fhir.value.id.toLowerCase() !== patientId) return error('PATIENT_MISMATCH');

  const rest = mapUpstream(
    await deps.upstream.get({ routeId: 'rest.patient.read', pathParams: { puuid: patientId }, accessToken, correlationId }),
    { shape: 'rest-envelope', schema: restPatientSchema, emptyMeans: 'error' },
  );
  if (rest.kind === 'failure') return { card: failureToCard(rest.failure, patientId, correlationId), pid: null };
  if (rest.kind === 'empty') return error('SCHEMA_MISMATCH');
  if (rest.value.uuid.toLowerCase() !== patientId) return error('PATIENT_MISMATCH');
  const pid = parsePid(rest.value.pid);
  if (pid === null) return error('SCHEMA_MISMATCH');
  const fhirMrn = extractMrn(fhir.value);
  const restMrn = rest.value.pubpid?.trim() ? rest.value.pubpid.trim() : null;
  if (fhirMrn !== restMrn) return error('PATIENT_MISMATCH');

  return {
    card: { kind: 'ok', patientId, rows: [deriveHeader(patientId, fhir.value, deps.today())], notes: [] },
    pid,
  };
}
