import type { CardResult, GapNote } from '../../../core/cardResult.ts';
import type { MedicationRow } from '../../../core/dto.ts';
import type { PatientUuid } from '../../../core/ids.ts';
import { filterActiveIssues, sortByBegdateAsc } from '../../../core/rules/issues.ts';
import { joinDosageInstructions, type MedicationRequestForJoin } from '../../../core/rules/medications.ts';
import { failureToCard, mapUpstream } from '../upstream/mapResponse.ts';
import { medicationListSchema } from '../upstream/schemas/medication.ts';
import { fhirMedicationRequestBundleSchema } from '../upstream/schemas/medicationRequest.ts';
import type { IssueCardDeps } from './allergies.ts';
import type { CardContext } from './header.ts';
import { resolvePatient, rowBelongsTo } from './patientRead.ts';

/**
 * The FHIR MedicationRequest read failed (any status, a timeout, an unexpected
 * shape). The medication list itself came from REST and is complete, so the
 * card keeps it and says the instructions are missing, never that none exist.
 * The usual cause is a client registered without `user/MedicationRequest.rs`:
 * OpenEMR then answers 401 for this one route.
 */
export const DOSAGE_LOAD_FAILED: GapNote = {
  field: 'dosage',
  text: "Dosage instructions: couldn't be loaded from the API (FHIR MedicationRequest); the medication list is complete.",
};

/** Some active medications have no `intent=plan` MedicationRequest with the same uuid, so no instructions can be shown for them. */
export function dosageNotReturned(count: number): GapNote {
  return {
    field: 'dosage',
    text: `Dosage instructions: not returned by the API for ${String(count)} of these medications.`,
  };
}

type Enrichment =
  | { readonly kind: 'requests'; readonly requests: readonly MedicationRequestForJoin[] }
  | { readonly kind: 'failed' }
  | { readonly kind: 'patient-mismatch' };

/**
 * `GET /fhir/MedicationRequest?patient=<puuid>&intent=plan`. Every entry must be
 * about this patient (`subject.reference`), or the card fails like any other
 * cross-patient answer (5.04). Any other failure only drops the instructions.
 */
async function readDosageRequests(deps: IssueCardDeps, ctx: CardContext): Promise<Enrichment> {
  const { patientId, accessToken, correlationId } = ctx;
  const mapped = mapUpstream(
    await deps.upstream.get({ routeId: 'fhir.medicationrequest.search', query: { patient: patientId }, accessToken, correlationId }),
    // The patient read succeeded in this chain, so an empty Bundle is a real "no requests" (6.03).
    { shape: 'fhir-bundle', schema: fhirMedicationRequestBundleSchema, emptyMeans: 'empty' },
  );
  if (mapped.kind === 'failure') return { kind: 'failed' };
  if (mapped.kind === 'empty') return { kind: 'requests', requests: [] };
  const resources = (mapped.value.entry ?? []).map((e) => e.resource);
  if (!resources.every((r) => subjectIs(r.subject?.reference, patientId))) return { kind: 'patient-mismatch' };
  return {
    kind: 'requests',
    requests: resources.map((r) => ({
      id: r.id,
      intent: r.intent,
      dosageTexts: (r.dosageInstruction ?? []).flatMap((d) => (d.text === undefined ? [] : [d.text])),
    })),
  };
}

function subjectIs(reference: string | undefined, patientId: PatientUuid): boolean {
  return reference !== undefined && reference.toLowerCase() === `patient/${patientId}`;
}

/**
 * The Medications card (W2D-3, slices 01-02-03 and 01-06-04). The list is REST:
 * `rest.patient.read` resolves the integer pid (10.04), then
 * `rest.medication.list` for that pid, because only REST carries the `outcome`
 * that `filterActiveIssues` needs (FHIR has none). Rules: `filterActiveIssues`
 * on the raw `outcome`/`enddate`, then `begdate` ascending with NULLs first
 * (the route itself sorts by `date DESC`, a different column). A 404 with an
 * empty body is this route's "no rows" (6.04) and means "Nothing Recorded";
 * any other 404 is an error. A 500 (e.g. the null-uuid path, 6.07) is an error.
 *
 * Dosage instructions (4.05) are joined in from FHIR `MedicationRequest`
 * (intent `plan`) by uuid, only when there is at least one active row.
 */
export async function loadMedications(deps: IssueCardDeps, ctx: CardContext): Promise<CardResult<MedicationRow>> {
  const { patientId, accessToken, correlationId } = ctx;
  const patient = await resolvePatient(deps.upstream, ctx);
  if (patient.kind === 'failed') return patient.card;

  const mapped = mapUpstream(
    await deps.upstream.get({ routeId: 'rest.medication.list', pathParams: { pid: patient.pid }, accessToken, correlationId }),
    { shape: 'rest-array', schema: medicationListSchema, emptyMeans: 'empty', notFoundEmptyBodyIsEmpty: true },
  );
  if (mapped.kind === 'failure') return failureToCard(mapped.failure, patientId, correlationId);
  if (mapped.kind === 'empty') return { kind: 'empty', patientId };
  if (!mapped.value.every((row) => rowBelongsTo(row.pid, patient.pid))) {
    return { kind: 'error', patientId, correlationId, code: 'PATIENT_MISMATCH' };
  }

  const active = sortByBegdateAsc(filterActiveIssues(mapped.value, deps.nowLocal()));
  if (active.length === 0) return { kind: 'empty', patientId };

  const enrichment = await readDosageRequests(deps, ctx);
  switch (enrichment.kind) {
    case 'patient-mismatch':
      return { kind: 'error', patientId, correlationId, code: 'PATIENT_MISMATCH' };
    case 'failed':
      return { kind: 'ok', patientId, rows: active.map((row): MedicationRow => ({ title: row.title, dosage: null })), notes: [DOSAGE_LOAD_FAILED] };
    case 'requests': {
      const joined = joinDosageInstructions(active, enrichment.requests);
      return { kind: 'ok', patientId, rows: joined.rows, notes: joined.unmatched > 0 ? [dosageNotReturned(joined.unmatched)] : [] };
    }
  }
}
