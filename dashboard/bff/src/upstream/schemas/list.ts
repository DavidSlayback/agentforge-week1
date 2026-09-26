import { z } from 'zod';

/**
 * `GET /api/list/severity_ccda`: a bare array of `list_options` rows
 * (`ListService::getOptionsByListName()`, `src/Services/ListService.php:121-140@legacy-baseline`).
 */
export const listOptionsSchema = z.array(
  z.object({
    option_id: z.string(),
    title: z.string().nullable().optional(),
    activity: z.union([z.string(), z.number()]).nullable().optional(),
  }),
);
export type ListOptions = z.infer<typeof listOptionsSchema>;
