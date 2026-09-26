import { z } from 'zod';
import { pidSchema } from './issues.ts';

/**
 * One row of `GET /api/patient/:puuid/encounter` (`EncounterService::search()`,
 * `src/Services/EncounterService.php:152-333`, `ORDER BY fe.eid DESC`), inside
 * the REST envelope. `eid` is `form_encounter.encounter` (the encounter
 * number the vitals route matches), not `form_encounter.id`. Only the fields
 * the card reads are declared.
 */
export const encounterRowSchema = z.object({
  eid: z.union([z.string().min(1), z.number()]),
  pid: pidSchema,
  puuid: z.string().min(1).nullable(),
});
export type EncounterApiRow = z.infer<typeof encounterRowSchema>;

export const encounterListSchema = z.array(encounterRowSchema);
