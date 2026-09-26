/**
 * The one set of display formatters (catalog 7.17, 7.18). Pure: callers pass
 * the reference date; nothing here reads a clock.
 */

/** Minimal FHIR `HumanName` shape the formatter needs. */
export interface HumanNameLike {
  readonly use?: string | undefined;
  readonly family?: string | undefined;
  readonly given?: readonly string[] | undefined;
  readonly suffix?: readonly string[] | undefined;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * One canonical patient name: `given… family suffix…`, the fuller legacy form
 * (`getPatientFullNameAsString()`: fname [mname] lname [suffix]) rather than the
 * shell bar's `fname lname` (7.18). Prefers the `official` name.
 */
export function formatName(names: readonly HumanNameLike[] | undefined): string | null {
  if (!names || names.length === 0) return null;
  const chosen = names.find((n) => n.use === 'official') ?? names[0];
  if (!chosen) return null;
  const parts = [...(chosen.given ?? []), chosen.family ?? '', ...(chosen.suffix ?? [])]
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** The `YYYY-MM-DD` date part of an ISO date or dateTime, as written by OpenEMR (its local time). */
export function isoDatePart(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = ISO_DATE_RE.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Age between two ISO dates, following `PatientService::getPatientAge()`
 * (`src/Services/PatientService.php:737-781@legacy-baseline`): whole years
 * above 24 months, otherwise "<n> month". The legacy deceased branch used a
 * second formatter (`oeFormatAge`) with a string-precedence bug; the port uses
 * this one rule for both living and "Age at death" (7.17).
 */
export function formatAge(birthDate: string | null, asOf: string | null): string | null {
  const dob = birthDate ? ISO_DATE_RE.exec(birthDate) : null;
  const now = asOf ? ISO_DATE_RE.exec(asOf) : null;
  if (!dob || !now) return null;
  const [dy, dm, dd] = [Number(dob[1]), Number(dob[2]), Number(dob[3])];
  const [ny, nm, nd] = [Number(now[1]), Number(now[2]), Number(now[3])];
  const dayDiff = nd - dd;
  const monthDiff = nm - dm;
  const yearDiff = ny - dy;
  let months = ny * 12 + nm - (dy * 12 + dm);
  if (dayDiff < 0) months -= 1;
  if (months < 0) return null;
  if (months > 24) {
    let years = yearDiff;
    if ((monthDiff === 0 && dayDiff < 0) || monthDiff < 0) years -= 1;
    return String(years);
  }
  return `${months} ${months === 1 ? 'month' : 'months'}`;
}

/** Display form of FHIR `gender` (derived by OpenEMR from `patient_data.sex`). */
export function formatSex(gender: string | undefined): string | null {
  switch (gender) {
    case 'male':
      return 'Male';
    case 'female':
      return 'Female';
    case 'other':
      return 'Other';
    case 'unknown':
      return 'Unknown';
    case undefined:
      return null;
    default:
      return null;
  }
}
