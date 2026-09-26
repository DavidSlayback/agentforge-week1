/**
 * Parity rules for the Vitals card (`walkthroughs/VITALS.md`), reproduced from
 * `interface/forms/vitals/report.php` (`vitals_report()`), with the one
 * deliberate deviation: the port shows the latest NON-DELETED set (catalog
 * 5.01), which the REST per-encounter route guarantees. Pure.
 */
import { formatAge } from '../format.ts';
import { normalizeLocalDateTime } from './issues.ts';

/** At most this many encounters are walked per card load; past it the card is an error, never "Nothing Recorded". */
export const MAX_ENCOUNTER_SCAN = 50;

/** A value as the REST vitals route serializes it (strings from the DB, numbers after a unit conversion). */
export type VitalValue = string | number | null | undefined;

/** The fields of one `GET /api/patient/:pid/encounter/:eid/vital` row the card reads. */
export interface VitalsSet {
  readonly id: string | number;
  readonly date?: string | null | undefined;
  readonly bps?: VitalValue;
  readonly bpd?: VitalValue;
  readonly bps_unit?: string | undefined;
  readonly height?: VitalValue;
  readonly height_unit?: string | undefined;
  readonly weight?: VitalValue;
  readonly weight_unit?: string | undefined;
  readonly temperature?: VitalValue;
  readonly temperature_unit?: string | undefined;
  readonly temp_method?: VitalValue;
  readonly pulse?: VitalValue;
  readonly pulse_unit?: string | undefined;
  readonly respiration?: VitalValue;
  readonly respiration_unit?: string | undefined;
  readonly note?: VitalValue;
  readonly BMI?: VitalValue;
  readonly BMI_unit?: string | undefined;
  readonly BMI_status?: VitalValue;
  readonly waist_circ?: VitalValue;
  readonly waist_circ_unit?: string | undefined;
  readonly head_circ?: VitalValue;
  readonly head_circ_unit?: string | undefined;
  readonly oxygen_saturation?: VitalValue;
  readonly oxygen_saturation_unit?: string | undefined;
  readonly oxygen_flow_rate?: VitalValue;
  readonly oxygen_flow_rate_unit?: string | undefined;
  readonly ped_weight_height?: VitalValue;
  readonly ped_bmi?: VitalValue;
  readonly ped_head_circ?: VitalValue;
  readonly inhaled_oxygen_concentration?: VitalValue;
  readonly inhaled_oxygen_concentration_unit?: string | undefined;
}

/**
 * The newest set within one encounter's rows: the latest `date`, ties to the
 * higher `id`. The route already sorts `encounter_date DESC, date DESC`
 * (`VitalsService.php:199`); the port does not rely on it. `null` for no rows.
 */
export function latestVitalsSet<T extends VitalsSet>(rows: readonly T[]): T | null {
  let best: T | null = null;
  let bestKey = '';
  for (const row of rows) {
    const key = `${(row.date ? normalizeLocalDateTime(row.date) : null) ?? ''}|${String(row.id).padStart(20, '0')}`;
    if (best === null || key > bestKey) {
      best = row;
      bestKey = key;
    }
  }
  return best;
}

/**
 * Pediatric as `vitals_report()` decides it: `getPatientAge($dob) <= 20` or an
 * age in months (`report.php:39-40`). Unknown DOB is treated as adult.
 */
export function isPediatric(birthDate: string | null, today: string): boolean {
  const age = formatAge(birthDate, today);
  if (age === null) return false;
  if (age.includes('month')) return true;
  return Number(age) <= 20;
}

/** PHP `number_format($v, $decimals)`: half away from zero, `,` thousands separator. */
export function phpNumberFormat(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  const [int = '0', frac] = Math.abs(rounded).toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '-' : ''}${grouped}${frac === undefined ? '' : `.${frac}`}`;
}

/** PHP `floatval()` echoed as text: `176.000000` → `176`, `98.200000` → `98.2`. */
function phpFloatText(value: number): string {
  return String(value);
}

/**
 * The legacy skip rule (`report.php:48-54`): `Utilities::isDateEmpty($value)`
 * (null, '', a zero date) or `$value == "0.0"` (PHP 8: a numeric string or
 * number equal to zero).
 */
function isShown(value: VitalValue): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0;
  const v = value.trim();
  if (v === '' || v === '0000-00-00' || v === '0000-00-00 00:00:00') return false;
  return !(/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(v) && Number(v) === 0);
}

const asNumber = (value: VitalValue): number => (typeof value === 'number' ? value : Number(String(value).trim()));
const asText = (value: VitalValue): string => (value === null || value === undefined ? '' : String(value));

/**
 * The unit labels the legacy card prints, keyed by the UCUM code the REST route
 * returns in `<field>_unit` (`VitalsService.php:249-283`). An unknown code is
 * shown as returned, never guessed.
 */
const UNIT_LABELS: Readonly<Record<string, string>> = {
  lb: 'lb',
  kg: 'kg',
  in: 'in',
  cm: 'cm',
  degF: 'F',
  Cel: 'C',
  '/min': 'per min',
  '%': '%',
  'L/min': 'l/min',
  'kg/m2': 'kg/m^2',
  'mm[Hg]': 'mmHg',
};

function unitLabel(unit: string | undefined): string {
  if (unit === undefined || unit === '') return '';
  return UNIT_LABELS[unit] ?? unit;
}

const withUnit = (text: string, unit: string | undefined): string => {
  const label = unitLabel(unit);
  return label === '' ? text : `${text} ${label}`;
};

export interface VitalsField {
  readonly label: string;
  readonly value: string;
}

/**
 * The card's fields in the legacy order (the `form_vitals` column order that
 * `report.php` iterates, 7.20), with the legacy labels, skip rule and number
 * formats, and the unit each value came with from the API (one unit system;
 * the legacy metric secondary is not computed). Blood pressure shows only
 * when both parts are present. Pediatric percentiles show, and BMI Status reads
 * "See Growth-Chart", only for a pediatric patient, as in the legacy card.
 * `external_id` and `last_updated` are not shown.
 */
export function vitalsFields(set: VitalsSet, pediatric: boolean): VitalsField[] {
  const out: VitalsField[] = [];
  const add = (label: string, value: string): void => {
    out.push({ label, value });
  };
  if (isShown(set.bps) && isShown(set.bpd)) add('Blood Pressure', withUnit(`${asText(set.bps)}/${asText(set.bpd)}`, set.bps_unit));
  if (isShown(set.height)) add('Height', withUnit(phpFloatText(asNumber(set.height)), set.height_unit));
  if (isShown(set.weight)) add('Weight', withUnit(phpFloatText(asNumber(set.weight)), set.weight_unit));
  if (isShown(set.temperature)) add('Temperature', withUnit(phpFloatText(asNumber(set.temperature)), set.temperature_unit));
  if (isShown(set.temp_method)) add('Temp Method', asText(set.temp_method));
  if (isShown(set.pulse)) add('Pulse', withUnit(phpNumberFormat(asNumber(set.pulse), 0), set.pulse_unit));
  if (isShown(set.respiration)) add('Respiration', withUnit(phpNumberFormat(asNumber(set.respiration), 0), set.respiration_unit));
  if (isShown(set.note)) add('Note', asText(set.note));
  if (isShown(set.BMI)) add('BMI', withUnit(phpNumberFormat(asNumber(set.BMI), 0), set.BMI_unit));
  if (isShown(set.BMI_status)) add('BMI Status', pediatric ? 'See Growth-Chart' : asText(set.BMI_status));
  if (isShown(set.waist_circ)) add('Waist Circ', withUnit(phpFloatText(asNumber(set.waist_circ)), set.waist_circ_unit));
  if (isShown(set.head_circ)) add('Head Circ', withUnit(phpFloatText(asNumber(set.head_circ)), set.head_circ_unit));
  if (isShown(set.oxygen_saturation)) add('Oxygen Saturation', withUnit(phpNumberFormat(asNumber(set.oxygen_saturation), 0), set.oxygen_saturation_unit));
  if (isShown(set.oxygen_flow_rate)) add('Oxygen Flow Rate', withUnit(phpNumberFormat(asNumber(set.oxygen_flow_rate), 2), set.oxygen_flow_rate_unit));
  if (pediatric) {
    if (isShown(set.ped_weight_height)) add('Pediatric Height Weight Percentile', `${phpNumberFormat(asNumber(set.ped_weight_height), 0)} %`);
    if (isShown(set.ped_bmi)) add('Pediatric BMI Percentile', `${phpNumberFormat(asNumber(set.ped_bmi), 0)} %`);
    if (isShown(set.ped_head_circ)) add('Pediatric Head Circumference Percentile', `${phpNumberFormat(asNumber(set.ped_head_circ), 0)} %`);
  }
  if (isShown(set.inhaled_oxygen_concentration)) {
    add('Inhaled Oxygen Concentration', withUnit(asText(set.inhaled_oxygen_concentration), set.inhaled_oxygen_concentration_unit));
  }
  return out;
}
