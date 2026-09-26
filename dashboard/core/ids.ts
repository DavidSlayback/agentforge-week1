/**
 * Branded identifiers. Each is built only by its parser, so a `Pid` can never
 * be passed where a `PatientUuid` is expected (MIGRATION-REACT.md §5).
 *
 * The session-implicit integer pid of the legacy page (`set_pid`, catalog
 * 3.01 / 5.09) is replaced by an explicit, validated id in every call.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** OpenEMR patient uuid (lower-case canonical form). */
export type PatientUuid = Brand<string, 'PatientUuid'>;
/** OpenEMR integer `patient_data.pid`; only ever taken from the patient's own API response (10.04). */
export type Pid = Brand<number, 'Pid'>;
/** Medical record number, OpenEMR `pubpid` (FHIR identifier type `PT`). */
export type Mrn = Brand<string, 'Mrn'>;
/**
 * The uuid of a non-patient FHIR resource (Practitioner, Organization) that a
 * patient-bound response referenced, e.g. a CareTeam participant. Never a
 * patient id, so it cannot be passed where a `PatientUuid` is expected.
 */
export type ResourceUuid = Brand<string, 'ResourceUuid'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PID_RE = /^[1-9][0-9]{0,9}$/;
// pubpid is free text in OpenEMR; the port accepts a conservative subset so the
// value is safe in a path segment and in a FHIR token search.
const MRN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export function parsePatientUuid(value: unknown): PatientUuid | null {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  return UUID_RE.test(lower) ? (lower as PatientUuid) : null;
}

export function parseResourceUuid(value: unknown): ResourceUuid | null {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  return UUID_RE.test(lower) ? (lower as ResourceUuid) : null;
}

export function parsePid(value: unknown): Pid | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? (value as Pid) : null;
  }
  if (typeof value === 'string' && PID_RE.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? (n as Pid) : null;
  }
  return null;
}

export function parseMrn(value: unknown): Mrn | null {
  if (typeof value !== 'string') return null;
  return MRN_RE.test(value) ? (value as Mrn) : null;
}
