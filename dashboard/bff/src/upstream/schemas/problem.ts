import { z } from 'zod';
import { localDateTimeSchema, outcomeSchema, pidSchema } from './issues.ts';

/**
 * One row of `GET /api/patient/:puuid/medical_problem` (`data[]` of the REST
 * envelope), from `ConditionService::search()`
 * (`src/Services/ConditionService.php:42-94@legacy-baseline`): `lists.*` plus
 * `puuid`, `condition_uuid`, encounter and provider columns. `diagnosis` is a
 * coded map on this route and is not read (the card shows the title only).
 */
export const problemRowSchema = z.object({
  uuid: z.string().min(1),
  puuid: z.string().min(1),
  pid: pidSchema,
  title: z.string(),
  begdate: localDateTimeSchema,
  enddate: localDateTimeSchema,
  outcome: outcomeSchema,
});
export type ProblemApiRow = z.infer<typeof problemRowSchema>;

export const problemListSchema = z.array(problemRowSchema);
