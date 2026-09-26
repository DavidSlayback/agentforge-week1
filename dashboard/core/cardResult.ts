import type { PatientUuid } from './ids.ts';

/**
 * Why a card (or the header) failed. Codes only: upstream error text is never
 * carried, because OpenEMR error bodies can contain SQL and paths (6.01).
 */
export type ErrorCode =
  | 'UPSTREAM_STATUS' // any other 4xx/5xx
  | 'UPSTREAM_TIMEOUT' // no answer within the per-call budget
  | 'UPSTREAM_UNAVAILABLE' // network error
  | 'UPSTREAM_VALIDATION' // HTTP 200 carrying validationErrors / internalErrors (6.02)
  | 'UPSTREAM_OPERATION_OUTCOME' // FHIR OperationOutcome where a resource was expected (6.03)
  | 'SCHEMA_MISMATCH' // a 2xx body that fails the route's schema
  | 'PATIENT_MISMATCH' // a response about another patient (5.04)
  | 'BFF_UNAVAILABLE'; // SPA only: the BFF itself could not be reached or answered unexpectedly

/** A documented API gap shown next to the data ("Not available via API"). */
export interface GapNote {
  readonly field: string;
  readonly text: string;
}

/**
 * The one result shape shared by the BFF and the SPA. Every card renders
 * exactly one of these (plus a client-only loading state), which designs out
 * the unhandled `fetchHtml` failures of the legacy page (6.05).
 */
export type CardResult<T> =
  | { readonly kind: 'ok'; readonly patientId: PatientUuid; readonly rows: readonly T[]; readonly notes: readonly GapNote[] }
  | { readonly kind: 'empty'; readonly patientId: PatientUuid }
  | { readonly kind: 'forbidden'; readonly patientId: PatientUuid }
  | { readonly kind: 'reauth' }
  | { readonly kind: 'error'; readonly patientId: PatientUuid; readonly correlationId: string; readonly code: ErrorCode };

export type CardKind = CardResult<unknown>['kind'];

/** Exhaustiveness guard for `switch` over closed unions (no catch-all branch). */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
