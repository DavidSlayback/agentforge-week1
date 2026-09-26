import type { CardResult, ErrorCode, GapNote } from './cardResult.ts';
import type { AllergyRow, DemoPatient, HeaderDto, PatientLookupResult, SessionDto } from './dto.ts';
import { parsePatientUuid } from './ids.ts';

/**
 * Type guards for the BFF → SPA wire format. The SPA parses every BFF answer
 * with these (parse, don't cast); anything malformed becomes an error state.
 */

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'UPSTREAM_STATUS',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_VALIDATION',
  'UPSTREAM_OPERATION_OUTCOME',
  'SCHEMA_MISMATCH',
  'PATIENT_MISMATCH',
  'BFF_UNAVAILABLE',
]);

function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === 'string' && ERROR_CODES.has(v);
}

const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

function isGapNote(v: unknown): v is GapNote {
  return isRecord(v) && typeof v['field'] === 'string' && typeof v['text'] === 'string';
}

export function isCardResult<T>(v: unknown, isRow: (row: unknown) => row is T): v is CardResult<T> {
  if (!isRecord(v)) return false;
  const kind = v['kind'];
  if (kind === 'reauth') return true;
  if (parsePatientUuid(v['patientId']) === null) return false;
  switch (kind) {
    case 'ok':
      return Array.isArray(v['rows']) && v['rows'].every(isRow) && Array.isArray(v['notes']) && v['notes'].every(isGapNote);
    case 'empty':
    case 'forbidden':
      return true;
    case 'error':
      return typeof v['correlationId'] === 'string' && isErrorCode(v['code']);
    default:
      return false;
  }
}

export function isHeaderDto(v: unknown): v is HeaderDto {
  return (
    isRecord(v) &&
    parsePatientUuid(v['patientId']) !== null &&
    isStringOrNull(v['name']) &&
    isStringOrNull(v['birthDate']) &&
    (v['ageLabel'] === 'Age' || v['ageLabel'] === 'Age at death') &&
    isStringOrNull(v['age']) &&
    isStringOrNull(v['sex']) &&
    isStringOrNull(v['mrn']) &&
    (v['status'] === 'Active' || v['status'] === 'Deceased') &&
    isStringOrNull(v['deceasedDate'])
  );
}

function isDemoPatient(v: unknown): v is DemoPatient {
  return isRecord(v) && typeof v['label'] === 'string' && parsePatientUuid(v['patientId']) !== null;
}

export function isSessionDto(v: unknown): v is SessionDto {
  if (!isRecord(v)) return false;
  if (v['authenticated'] === false) return true;
  const dc = v['displayConfig'];
  return (
    v['authenticated'] === true &&
    isRecord(dc) &&
    dc['dateFormat'] === 'YYYY-MM-DD' &&
    dc['ageFormat'] === 'years-or-months' &&
    Array.isArray(v['demoPatients']) &&
    v['demoPatients'].every(isDemoPatient)
  );
}

export function isPatientLookupResult(v: unknown): v is PatientLookupResult {
  if (!isRecord(v)) return false;
  switch (v['kind']) {
    case 'found':
      return parsePatientUuid(v['patientId']) !== null;
    case 'not-found':
    case 'forbidden':
    case 'reauth':
      return true;
    case 'error':
      return typeof v['correlationId'] === 'string' && (isErrorCode(v['code']) || v['code'] === 'AMBIGUOUS_MRN');
    default:
      return false;
  }
}

export function isAllergyRow(v: unknown): v is AllergyRow {
  return (
    isRecord(v) &&
    typeof v['title'] === 'string' &&
    typeof v['severityLabel'] === 'string' &&
    typeof v['severe'] === 'boolean' &&
    isStringOrNull(v['reaction'])
  );
}
