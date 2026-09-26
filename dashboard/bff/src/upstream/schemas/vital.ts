import { z } from 'zod';
import { localDateTimeSchema, pidSchema } from './issues.ts';

/** A measurement as stored (numeric string), converted (number), or absent. Anything else is a schema mismatch. */
const measure = z.union([z.number(), z.string().regex(/^\s*[+-]?(\d+(\.\d*)?|\.\d+)\s*$/), z.literal(''), z.null()]).optional();
const text = z.string().nullable().optional();
/** `VitalsService` sets a `<field>_unit` key for every measurement (`convertArrayValue()`); it is required. */
const unit = z.string();

/**
 * One row of `GET /api/patient/:pid/encounter/:eid/vital`
 * (`VitalsService::getVitalsForPatientEncounter()`: `deleted=0 AND
 * formdir='vitals'`, then `search()`; `src/Services/VitalsService.php:85-283,
 * 504-518`), written as a bare JSON array by `responseHandler()`, or HTTP 404
 * with an empty body when the encounter has no live vitals form.
 */
export const vitalRowSchema = z.object({
  id: z.union([z.string().min(1), z.number()]),
  pid: pidSchema.nullable(),
  puuid: z.string().min(1).nullable(),
  eid: z.union([z.string().min(1), z.number()]).nullable(),
  date: localDateTimeSchema,
  bps: measure,
  bps_unit: unit,
  bpd: measure,
  bpd_unit: unit,
  height: measure,
  height_unit: unit,
  weight: measure,
  weight_unit: unit,
  temperature: measure,
  temperature_unit: unit,
  temp_method: text,
  pulse: measure,
  pulse_unit: unit,
  respiration: measure,
  respiration_unit: unit,
  note: text,
  BMI: measure,
  BMI_unit: unit,
  BMI_status: text,
  waist_circ: measure,
  waist_circ_unit: unit,
  head_circ: measure,
  head_circ_unit: unit,
  oxygen_saturation: measure,
  oxygen_saturation_unit: unit,
  oxygen_flow_rate: measure,
  oxygen_flow_rate_unit: unit,
  ped_weight_height: measure,
  ped_bmi: measure,
  ped_head_circ: measure,
  inhaled_oxygen_concentration: measure,
  inhaled_oxygen_concentration_unit: unit,
});
export type VitalApiRow = z.infer<typeof vitalRowSchema>;

export const vitalListSchema = z.array(vitalRowSchema);
