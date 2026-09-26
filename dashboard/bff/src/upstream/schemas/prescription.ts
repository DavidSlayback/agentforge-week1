import { z } from 'zod';
import { localDateTimeSchema } from './issues.ts';

const scalar = z.union([z.string(), z.number()]).nullable().optional();

/**
 * One row of `GET /api/prescription?patient_id=<pid>&source_table=prescriptions`
 * (`PrescriptionService::getAll()` → `getBaseSql()`, the `prescriptions`
 * branch of the UNION; `src/Services/PrescriptionService.php:56-338`), inside
 * the REST envelope (`createProcessingResultResponse()`). The outer SELECT has
 * no `patient_id` or `pid` column, so the patient check uses `puuid`; `refills`
 * and `form` are never selected (M-7, 4.10). Only the fields the card reads are
 * declared.
 */
export const prescriptionRowSchema = z.object({
  uuid: z.string().min(1),
  // Anything but the prescriptions branch is a schema mismatch: the BFF asked for this table only.
  source_table: z.literal('prescriptions'),
  // Nullable: a row whose patient no longer resolves has no puuid, and fails the patient check.
  puuid: z.string().min(1).nullable(),
  drug: z.string().nullable(),
  active: scalar,
  date_added: localDateTimeSchema,
  date_modified: localDateTimeSchema,
  prescription_drug_size: scalar,
  unit_title: z.string().nullable().optional(),
  dosage: scalar,
  quantity: scalar,
  interval: scalar,
  interval_title: z.string().nullable().optional(),
});
export type PrescriptionApiRow = z.infer<typeof prescriptionRowSchema>;

export const prescriptionListSchema = z.array(prescriptionRowSchema);
