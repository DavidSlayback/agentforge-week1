import { z } from 'zod';

/**
 * Fields shared by the `lists` rows behind the three issue cards. OpenEMR's
 * legacy DB layer returns every column as a string (or null), so numbers are
 * accepted as strings too. Only the fields the cards read are declared.
 */

/**
 * A MySQL `datetime` as serialized (`YYYY-MM-DD HH:MM:SS`), a bare date, `''`
 * or null. Anything else is a schema mismatch (fail loudly), so the active-issue
 * rule never has to guess at a date format.
 */
export const localDateTimeSchema = z
  .union([z.null(), z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/)])
  .optional();

/** `lists.outcome` (e.g. "0", "1", "6"). */
export const outcomeSchema = z.union([z.string(), z.number()]).nullable().optional();

/** `lists.pid` / `patient_id`, as a string or number. */
export const pidSchema = z.union([z.string().min(1), z.number()]);
