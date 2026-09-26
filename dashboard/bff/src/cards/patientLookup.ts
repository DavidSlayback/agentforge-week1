import type { PatientLookupResult } from '../../../core/dto.ts';
import { parsePatientUuid, type Mrn } from '../../../core/ids.ts';
import { extractMrn } from '../../../core/rules/header.ts';
import type { UpstreamClient } from '../upstream/client.ts';
import { mapUpstream } from '../upstream/mapResponse.ts';
import { fhirPatientBundleSchema } from '../upstream/schemas/patient.ts';

/**
 * Patient selection by MRN (`pubpid`). FHIR `identifier` is a token search
 * over both `ss` and `pubpid`, so only entries whose `PT` identifier equals the
 * MRN exactly count. Zero matches is "not found" (the user typed an MRN that
 * does not exist); more than one is an error, never a guess.
 */
export async function lookupPatientByMrn(
  upstream: UpstreamClient,
  ctx: { readonly mrn: Mrn; readonly accessToken: string; readonly correlationId: string },
): Promise<PatientLookupResult> {
  const { mrn, accessToken, correlationId } = ctx;
  const mapped = mapUpstream(
    await upstream.get({ routeId: 'fhir.patient.search', query: { identifier: mrn }, accessToken, correlationId }),
    { shape: 'fhir-bundle', schema: fhirPatientBundleSchema, emptyMeans: 'empty' },
  );
  if (mapped.kind === 'empty') return { kind: 'not-found' };
  if (mapped.kind === 'failure') {
    const f = mapped.failure;
    if (f.kind === 'error') return { kind: 'error', correlationId, code: f.code };
    return f;
  }
  const matches = (mapped.value.entry ?? []).map((e) => e.resource).filter((p) => extractMrn(p) === mrn);
  if (matches.length === 0) return { kind: 'not-found' };
  if (matches.length > 1) return { kind: 'error', correlationId, code: 'AMBIGUOUS_MRN' };
  const patientId = parsePatientUuid(matches[0]?.id);
  if (patientId === null) return { kind: 'error', correlationId, code: 'SCHEMA_MISMATCH' };
  return { kind: 'found', patientId };
}
