/**
 * Parity rules for the Prescriptions card, reproduced from the PHP card
 * (`walkthroughs/PRESCRIPTIONS.md`): `Prescription::prescriptions_factory()`
 * and `templates/prescription/general_fragment.html`. Pure.
 */
import { normalizeLocalDateTime } from './issues.ts';

/** The prescription columns the rules read, as `GET /api/prescription` serializes them. */
export interface PrescriptionSortFields {
  readonly uuid: string;
  /** `prescriptions.active` ("1" / "0"; ADODB returns strings). */
  readonly active?: string | number | null | undefined;
  /** `prescriptions.date_modified`, a naive local datetime or null. */
  readonly date_modified?: string | null | undefined;
  /** `prescriptions.date_added`, a naive local datetime. */
  readonly date_added?: string | null | undefined;
}

function activeKey(active: string | number | null | undefined): number | null {
  if (typeof active === 'number') return Number.isFinite(active) ? active : null;
  if (typeof active === 'string' && /^-?\d+$/.test(active.trim())) return Number(active.trim());
  return null;
}

function dateKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return normalizeLocalDateTime(value);
}

/**
 * MySQL `DESC` on one key: larger first, NULL last. Returns <0 when `a` sorts
 * first, >0 when `b` does, 0 on a tie.
 */
function compareDescNullsLast<K extends string | number>(a: K | null, b: K | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a > b ? -1 : 1;
}

/**
 * The legacy order `ORDER BY active DESC, date_modified DESC, date_added DESC`
 * (`library/classes/Prescription.class.php:1208-1209@legacy-baseline`; MySQL
 * puts NULLs last under DESC), plus `uuid` ascending as a documented tiebreak:
 * the legacy query has none, so ties there come back in whatever order MySQL
 * returns. The API itself has no `ORDER BY` at all. Returns a new array; ALL
 * rows are kept: the legacy `active` filter never fires (U-3, catalog 5.03).
 */
export function sortPrescriptions<T extends PrescriptionSortFields>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      compareDescNullsLast(activeKey(a.active), activeKey(b.active)) ||
      compareDescNullsLast(dateKey(a.date_modified), dateKey(b.date_modified)) ||
      compareDescNullsLast(dateKey(a.date_added), dateKey(b.date_added)) ||
      (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0),
  );
}

/** The fields the Details column is built from, as the API names them. */
export interface PrescriptionDetailFields {
  /** `prescriptions.size`. */
  readonly prescription_drug_size?: string | number | null | undefined;
  /** `drug_units` title for `unit` (the legacy `get_unit_display()`). */
  readonly unit_title?: string | null | undefined;
  readonly dosage?: string | number | null | undefined;
  /** `prescriptions.interval` (a `drug_interval` option id). */
  readonly interval?: string | number | null | undefined;
  readonly interval_title?: string | null | undefined;
}

/** PHP `empty()` on a scalar column value. */
function phpEmpty(v: string | number | null | undefined): boolean {
  return v === null || v === undefined || v === '' || v === '0' || v === 0;
}

const text = (v: string | number | null | undefined): string => (v === null || v === undefined ? '' : String(v));

/**
 * The Details cell: `get_size()` + `get_unit_display()`, a space, then
 * `get_dosage_display()` (`general_fragment.html:31-32`). The legacy dosage
 * display appends " in <form> <interval>" when the row has a form or an
 * interval. The API never selects `form` (a documented gap), so the port
 * appends " in <interval title>" only when an interval is set; with neither,
 * the cell is size+unit and dosage, as in the legacy card.
 */
export function prescriptionDetails(row: PrescriptionDetailFields): string {
  const sizeUnit = `${text(row.prescription_drug_size)}${text(row.unit_title)}`;
  const dosage = phpEmpty(row.interval) ? text(row.dosage) : `${text(row.dosage)} in ${text(row.interval_title)}`.trimEnd();
  return `${sizeUnit} ${dosage}`.trim();
}
