import { z } from 'zod';
import { localDateTimeSchema, outcomeSchema, pidSchema } from './issues.ts';

/**
 * One row of `GET /api/patient/:pid/medication`: `SELECT * FROM lists WHERE
 * pid=? AND type=? ORDER BY date DESC` (`ListService::getAll()`,
 * `src/Services/ListService.php:48-60@legacy-baseline`), written as a bare JSON
 * array. There is no `puuid` column and no `lists_medication` join, so
 * `drug_dosage_instructions` is absent (4.05); the card joins it in from FHIR
 * `MedicationRequest` by `uuid` (`schemas/medicationRequest.ts`).
 */
export const medicationRowSchema = z.object({
  uuid: z.string().min(1),
  pid: pidSchema,
  type: z.literal('medication'),
  title: z.string(),
  begdate: localDateTimeSchema,
  enddate: localDateTimeSchema,
  outcome: outcomeSchema,
});
export type MedicationApiRow = z.infer<typeof medicationRowSchema>;

export const medicationListSchema = z.array(medicationRowSchema);
