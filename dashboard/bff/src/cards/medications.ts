import type { CardResult, GapNote } from '../../../core/cardResult.ts';
import type { MedicationRow } from '../../../core/dto.ts';
import { filterActiveIssues, sortByBegdateAsc } from '../../../core/rules/issues.ts';
import { failureToCard, mapUpstream } from '../upstream/mapResponse.ts';
import { medicationListSchema } from '../upstream/schemas/medication.ts';
import type { IssueCardDeps } from './allergies.ts';
import type { CardContext } from './header.ts';
import { resolvePatient, rowBelongsTo } from './patientRead.ts';

/** 4.05: the legacy card shows dosage instructions next to the title; the REST route has none. */
export const DOSAGE_NOT_AVAILABLE: GapNote = { field: 'dosage', text: 'Dosage instructions: not available via API' };

/**
 * The Medications card (W2D-3, slice 01-02-03): `rest.patient.read` resolves
 * the integer pid (10.04), then `rest.medication.list` for that pid. Rules:
 * `filterActiveIssues` on the raw `outcome`/`enddate`, then `begdate` ascending
 * with NULLs first (the route itself sorts by `date DESC`, a different column);
 * title only. A 404 with an empty body is this route's "no rows" (6.04) and
 * means "Nothing Recorded"; any other 404 is an error. A 500 (e.g. the
 * null-uuid path, 6.07) is an error like any other.
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
  return { kind: 'ok', patientId, rows: active.map((row): MedicationRow => ({ title: row.title })), notes: [DOSAGE_NOT_AVAILABLE] };
}
