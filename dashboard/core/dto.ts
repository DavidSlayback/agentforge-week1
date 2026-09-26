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

/**
 * One row of the Medical Problems card (W2D-3): title only, as in the legacy
 * card. Rows arrive filtered and sorted by `begdate` ascending, NULLs first.
 */
export interface ProblemRow {
  readonly title: string;
}

/**
 * One row of the Medications card (W2D-3): title only. The legacy card also
 * shows `lists_medication.drug_dosage_instructions`, which the REST route does
 * not return (4.05); the card says so in a note. Rows arrive filtered and
 * sorted by `begdate` ascending, NULLs first.
 */
export interface MedicationRow {
  readonly title: string;
}

/**
 * One row of the Prescriptions card (W2D-3): the legacy columns Drug, Details,
 * Qty, Refills and Filled. Rows arrive sorted `active` DESC, `date_modified`
 * DESC, `date_added` DESC (then `uuid`), and ALL rows are shown, as the legacy
 * card shows them (its `active` filter never fires, 5.03).
 */
export interface PrescriptionRow {
  readonly drug: string;
  /** size + unit, a space, dosage (+ " in <interval>"); the dosage form is not in the API. */
  readonly details: string;
  /** `quantity` as stored; "" when none. */
  readonly quantity: string;
  /** Always null: `refills` is never selected by the API (M-7), shown as "Not available via API", never 0. */
  readonly refills: null;
  /** Raw `date_added` (`YYYY-MM-DD HH:MM:SS`, OpenEMR local time), as the legacy card prints it. */
  readonly filled: string;
}

/**
 * One member row of the Care Team card: the legacy columns Type, Member, Role,
 * Facility and Since. Status and Note have no FHIR field (M-6) and are shown
 * as "Not available via API" by the SPA, so they are not on the wire.
 */
export interface CareTeamMemberRow {
  readonly type: 'Provider' | 'Related Person';
  /** From `Practitioner.name`; null when the name could not be read (shown as "Name unavailable"). */
  readonly name: string | null;
  /** `participant.role[0].coding[0].display`, the `care_team_roles` title; "" when none. */
  readonly role: string;
  /** From the `onBehalfOf` Organization's name; "" when the member has none, null when it could not be read. */
  readonly facility: string | null;
  /** `participant.period.start` (providers only); "" when none. */
  readonly since: string;
}

/**
 * The Care Team card (W2D-3): the one team the legacy card would pick, with
 * every member FHIR returns. Inactive members cannot be told apart (5.05 / M-6).
 */
export interface CareTeamDto {
  readonly teamName: string;
  /** The `Care_Team_Status` title of the team ("Active"). */
  readonly statusTitle: string;
  readonly members: readonly CareTeamMemberRow[];
}

/**
 * The Vitals card (W2D-4): the latest non-deleted vitals set, as "Most recent
 * vitals from: <date>" plus label/value pairs in the legacy order.
 */
export interface VitalsDto {
  /** Raw `form_vitals.date` (`YYYY-MM-DD HH:MM:SS`, OpenEMR local time), as the legacy card prints it. */
  readonly date: string;
  readonly fields: readonly { readonly label: string; readonly value: string }[];
}
