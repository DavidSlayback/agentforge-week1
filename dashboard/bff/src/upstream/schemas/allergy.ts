import { z } from 'zod';
import { localDateTimeSchema, outcomeSchema, pidSchema } from './issues.ts';

/**
 * One row of `GET /api/patient/:puuid/allergy` (`data[]` of the REST envelope),
 * from `AllergyIntoleranceService::search()`
 * (`src/Services/AllergyIntoleranceService.php:44-138@legacy-baseline`):
 * `lists.*` plus `puuid`, `patient_id`, `reaction_title` and friends.
 */
export const allergyRowSchema = z.object({
  uuid: z.string().min(1),
  puuid: z.string().min(1),
  pid: pidSchema,
  title: z.string(),
  begdate: localDateTimeSchema,
  enddate: localDateTimeSchema,
  outcome: outcomeSchema,
  /** Raw `lists.severity_al` code (e.g. "severe", "1"); the label is looked up separately. */
  severity_al: z.string().nullable().optional(),
  reaction_title: z.string().nullable().optional(),
});
export type AllergyApiRow = z.infer<typeof allergyRowSchema>;

export const allergyListSchema = z.array(allergyRowSchema);
