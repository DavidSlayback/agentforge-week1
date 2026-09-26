import type { CardResult, GapNote } from '../../../core/cardResult.ts';
import type { PrescriptionRow } from '../../../core/dto.ts';
import { prescriptionDetails, sortPrescriptions } from '../../../core/rules/prescriptions.ts';
import type { UpstreamClient } from '../upstream/client.ts';
import { failureToCard, mapUpstream } from '../upstream/mapResponse.ts';
import { prescriptionListSchema } from '../upstream/schemas/prescription.ts';
import type { CardContext } from './header.ts';
import { resolvePatient } from './patientRead.ts';

export interface PrescriptionCardDeps {
  readonly upstream: UpstreamClient;
}

/** M-7 / 5.06: the legacy card shows `refills`; `PrescriptionService` never selects it. */
export const REFILLS_NOT_AVAILABLE: GapNote = {
  field: 'refills',
  text: 'Refills: not available via API (OpenEMR stores them, but its prescription API does not return them).',
};

/** 4.10: the legacy Details text can end in " in <form> <interval>"; the API never returns the form. */
export const FORM_NOT_AVAILABLE: GapNote = {
  field: 'form',
  text: 'Dosage form: not available via API, so Details omits it.',
};

/**
 * The Prescriptions card (W2D-3, slice 01-03-01): `rest.patient.read`
 * resolves the integer pid (10.04), then `rest.prescription.search` with
 * exactly `patient_id=<pid>` and `source_table=prescriptions`, both built
 * here from constants and the resolved pid, never from browser input (M-1 /
 * 2.01; the allow-list rejects any other key). Every row must be the
 * requested patient's (`puuid`), else `PATIENT_MISMATCH`. ALL rows are shown
 * (5.03) in the legacy order. HTTP 200 with `data: []` is the legacy "None".
 */
export async function loadPrescriptions(deps: PrescriptionCardDeps, ctx: CardContext): Promise<CardResult<PrescriptionRow>> {
  const { patientId, accessToken, correlationId } = ctx;
  const patient = await resolvePatient(deps.upstream, ctx);
  if (patient.kind === 'failed') return patient.card;

  const mapped = mapUpstream(
    await deps.upstream.get({ routeId: 'rest.prescription.search', query: { patient_id: patient.pid }, accessToken, correlationId }),
    { shape: 'rest-envelope', schema: prescriptionListSchema, emptyMeans: 'empty' },
  );
  if (mapped.kind === 'failure') return failureToCard(mapped.failure, patientId, correlationId);
  if (mapped.kind === 'empty') return { kind: 'empty', patientId };
  if (!mapped.value.every((row) => row.puuid?.toLowerCase() === patientId)) {
    return { kind: 'error', patientId, correlationId, code: 'PATIENT_MISMATCH' };
  }

  const rows = sortPrescriptions(mapped.value).map(
    (row): PrescriptionRow => ({
      drug: row.drug ?? '',
      details: prescriptionDetails(row),
      quantity: row.quantity === null || row.quantity === undefined ? '' : String(row.quantity),
      refills: null,
      filled: row.date_added ?? '',
    }),
  );
  return { kind: 'ok', patientId, rows, notes: [REFILLS_NOT_AVAILABLE, FORM_NOT_AVAILABLE] };
}
