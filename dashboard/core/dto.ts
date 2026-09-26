import type { ErrorCode } from './cardResult.ts';
import type { PatientUuid } from './ids.ts';

/** Active status is derived from the deceased fields only; never from `Patient.active`. */
export type PatientStatus = 'Active' | 'Deceased';

/** FHIR administrative gender, as served by `FhirPatientService`. */
export type AdministrativeGender = 'male' | 'female' | 'other' | 'unknown';

/**
 * The persistent patient header (W2D-2). Display strings are computed in the
 * BFF with the `core/format.ts` formatters so the SPA renders text only.
 * A `null` field renders as "Not recorded", never as an empty cell.
 */
export interface HeaderDto {
  readonly patientId: PatientUuid;
  readonly name: string | null;
  /** ISO `YYYY-MM-DD`; OpenEMR's local `date_display_format` is 0 (Y-m-d). */
  readonly birthDate: string | null;
  /** "Age" for the living, "Age at death" for the deceased (legacy `str_dob`). */
  readonly ageLabel: 'Age' | 'Age at death';
  readonly age: string | null;
  readonly sex: string | null;
  readonly mrn: string | null;
  readonly status: PatientStatus;
  /** ISO `YYYY-MM-DD` in OpenEMR's local time; present only when deceased. */
  readonly deceasedDate: string | null;
}

/** A demo patient link configured by `DASHBOARD_DEMO_PATIENTS` (neutral labels, no names). */
export interface DemoPatient {
  readonly label: string;
  readonly patientId: PatientUuid;
}

/** `GET /dashboard/bff/session`. */
export type SessionDto =
  | { readonly authenticated: false }
  | {
      readonly authenticated: true;
      readonly displayConfig: DisplayConfig;
      readonly demoPatients: readonly DemoPatient[];
    };

/**
 * Display configuration OpenEMR exposes through no API (data/CONFIG.md).
 * Values mirror the local stack's globals (`date_display_format=0`,
 * `age_display_format=0`, read with SELECT on 2026-09-25).
 */
export interface DisplayConfig {
  readonly dateFormat: 'YYYY-MM-DD';
  readonly ageFormat: 'years-or-months';
}

/** `GET /dashboard/bff/patients/by-mrn/:mrn`: patient selection by MRN (`pubpid`). */
export type PatientLookupResult =
  | { readonly kind: 'found'; readonly patientId: PatientUuid }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'reauth' }
  | { readonly kind: 'error'; readonly correlationId: string; readonly code: ErrorCode | 'AMBIGUOUS_MRN' };

/**
 * One row of the Allergies card (W2D-3), already filtered by
 * `filterActiveIssues` and kept in API order (no client sort, 4.03).
 */
export interface AllergyRow {
  readonly title: string;
  /** Text shown in parentheses: the `severity_ccda` label, else the raw code ("1"), else "". */
  readonly severityLabel: string;
  /** Highlighted like the legacy `bg-warning` span: severe, life-threatening or fatal only. */
  readonly severe: boolean;
  /** `reaction_title`, shown in the row's tooltip as in the legacy card; null when none. */
  readonly reaction: string | null;
}
