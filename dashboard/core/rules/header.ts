import type { HeaderDto, PatientStatus } from '../dto.ts';
import type { PatientUuid } from '../ids.ts';
import { formatAge, formatName, formatSex, isoDatePart, type HumanNameLike } from '../format.ts';

/** The fields of a FHIR `Patient` the header reads (already schema-parsed by the BFF). */
export interface FhirPatientInput {
  readonly id: string;
  /**
   * Parsed for completeness but never used for status: OpenEMR hard-codes it
   * to `true` for every patient (`FhirPatientService.php:212@legacy-baseline`).
   */
  readonly active?: boolean | undefined;
  readonly name?: readonly HumanNameLike[] | undefined;
  readonly gender?: string | undefined;
  readonly birthDate?: string | undefined;
  readonly deceasedDateTime?: string | undefined;
  readonly deceasedBoolean?: boolean | undefined;
  readonly identifier?:
    | readonly {
        readonly type?: { readonly coding?: readonly { readonly code?: string | undefined }[] | undefined } | undefined;
        readonly value?: string | undefined;
      }[]
    | undefined;
}

/**
 * Status is "Deceased" iff OpenEMR serialized a `deceasedDateTime` (from
 * `patient_data.deceased_date`) or `deceasedBoolean: true`; otherwise "Active".
 * OpenEMR writes `deceasedBoolean: false` for the living
 * (`FhirPatientService.php:741-752@legacy-baseline`).
 */
export function deriveStatus(patient: FhirPatientInput): PatientStatus {
  const hasDeceasedDate = typeof patient.deceasedDateTime === 'string' && patient.deceasedDateTime.length > 0;
  return hasDeceasedDate || patient.deceasedBoolean === true ? 'Deceased' : 'Active';
}

/** MRN = the identifier whose type coding is `PT` (OpenEMR `pubpid`). */
export function extractMrn(patient: FhirPatientInput): string | null {
  const pt = patient.identifier?.find((id) => id.type?.coding?.some((c) => c.code === 'PT'));
  const value = pt?.value?.trim();
  return value ? value : null;
}

/**
 * Build the header from one FHIR `Patient`.
 *
 * Args:
 *   patientId: the requested (already validated) patient uuid.
 *   patient: the parsed FHIR Patient for that uuid.
 *   today: today's date (`YYYY-MM-DD`) in OpenEMR's timezone, supplied by the caller's clock.
 */
export function deriveHeader(patientId: PatientUuid, patient: FhirPatientInput, today: string): HeaderDto {
  const status = deriveStatus(patient);
  const birthDate = isoDatePart(patient.birthDate);
  const deceasedDate = status === 'Deceased' ? isoDatePart(patient.deceasedDateTime) : null;
  const ageAsOf = status === 'Deceased' ? deceasedDate : today;
  return {
    patientId,
    name: formatName(patient.name),
    birthDate,
    ageLabel: status === 'Deceased' ? 'Age at death' : 'Age',
    age: formatAge(birthDate, ageAsOf),
    sex: formatSex(patient.gender),
    mrn: extractMrn(patient),
    status,
    deceasedDate,
  };
}
