import type { ZodType } from 'zod';
import { assertNever, type CardResult, type ErrorCode } from '../../../core/cardResult.ts';
import type { PatientUuid } from '../../../core/ids.ts';
import type { UpstreamOutcome } from './client.ts';

/** How a route's successful body is shaped. */
export type ResponseShape =
  /** REST `{validationErrors, internalErrors, data}` envelope; `data` is parsed. */
  | 'rest-envelope'
  /**
   * A bare JSON array, as `RestControllerHelper::responseHandler()` writes it
   * (`/api/list/:name`, `/api/patient/:pid/medication`). `[]` is an empty success.
   */
  | 'rest-array'
  /** One FHIR resource; a Bundle or OperationOutcome here is an error. */
  | 'fhir-resource'
  /** A FHIR search Bundle. */
  | 'fhir-bundle';

export interface MapOptions<T> {
  readonly shape: ResponseShape;
  readonly schema: ZodType<T>;
  /**
   * What an empty success means. `'error'` unless the caller has established
   * that emptiness is legitimate (6.03: an empty FHIR Bundle is "Nothing
   * Recorded" only after the patient read succeeded in the same chain).
   */
  readonly emptyMeans: 'empty' | 'error';
}

/** Non-value outcomes, before they are tied to a patient. */
export type Failure =
  | { readonly kind: 'reauth' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'error'; readonly code: ErrorCode };

export type Mapped<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failure'; readonly failure: Failure };

/** The upstream conditions of MIGRATION-REACT.md §2.5, in the order they are tested. */
type Condition =
  | { readonly c: 'timeout' }
  | { readonly c: 'network' }
  | { readonly c: 'unauthorized' }
  | { readonly c: 'forbidden' }
  | { readonly c: 'bad-status' }
  | { readonly c: 'rest-errors' }
  | { readonly c: 'operation-outcome' }
  | { readonly c: 'bad-shape' }
  | { readonly c: 'empty-success' }
  | { readonly c: 'body'; readonly body: unknown };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmpty(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (isRecord(v)) return Object.keys(v).length > 0;
  return false;
}

function classify(outcome: UpstreamOutcome, shape: ResponseShape): Condition {
  if (outcome.kind === 'timeout') return { c: 'timeout' };
  if (outcome.kind === 'network') return { c: 'network' };
  if (outcome.status === 401) return { c: 'unauthorized' };
  if (outcome.status === 403) return { c: 'forbidden' };
  if (outcome.status < 200 || outcome.status > 299) return { c: 'bad-status' };
  const body = outcome.body;
  if (isRecord(body) && body['resourceType'] === 'OperationOutcome') return { c: 'operation-outcome' };
  switch (shape) {
    case 'rest-envelope': {
      // Not an envelope at all (a bare array, null, non-JSON): never "Nothing Recorded".
      if (!isRecord(body)) return { c: 'bad-shape' };
      // 6.02: OpenEMR can answer HTTP 200 with validation or internal errors.
      if (nonEmpty(body['validationErrors']) || nonEmpty(body['internalErrors'])) return { c: 'rest-errors' };
      const data = body['data'];
      if (data === undefined || data === null) return { c: 'bad-shape' };
      if (Array.isArray(data) && data.length === 0) return { c: 'empty-success' };
      if (isRecord(data) && Object.keys(data).length === 0) return { c: 'empty-success' };
      return { c: 'body', body: data };
    }
    case 'rest-array': {
      if (isRecord(body) && (nonEmpty(body['validationErrors']) || nonEmpty(body['internalErrors']))) return { c: 'rest-errors' };
      if (Array.isArray(body) && body.length === 0) return { c: 'empty-success' };
      return { c: 'body', body };
    }
    case 'fhir-bundle': {
      if (isRecord(body) && body['resourceType'] === 'Bundle') {
        const entries = body['entry'];
        if (!Array.isArray(entries) || entries.length === 0) return { c: 'empty-success' };
      }
      return { c: 'body', body };
    }
    case 'fhir-resource':
      return { c: 'body', body };
    default:
      return assertNever(shape);
  }
}

/**
 * Map one upstream outcome to a value, an empty result or a failure
 * (MIGRATION-REACT.md §2.5). Exhaustive over the conditions; upstream text is
 * never carried into the result.
 */
export function mapUpstream<T>(outcome: UpstreamOutcome, options: MapOptions<T>): Mapped<T> {
  const condition = classify(outcome, options.shape);
  const fail = (code: ErrorCode): Mapped<T> => ({ kind: 'failure', failure: { kind: 'error', code } });
  switch (condition.c) {
    case 'timeout':
      return fail('UPSTREAM_TIMEOUT');
    case 'network':
      return fail('UPSTREAM_UNAVAILABLE');
    case 'unauthorized':
      return { kind: 'failure', failure: { kind: 'reauth' } };
    case 'forbidden':
      return { kind: 'failure', failure: { kind: 'forbidden' } };
    case 'bad-status':
      return fail('UPSTREAM_STATUS');
    case 'rest-errors':
      return fail('UPSTREAM_VALIDATION');
    case 'operation-outcome':
      return fail('UPSTREAM_OPERATION_OUTCOME');
    case 'bad-shape':
      return fail('SCHEMA_MISMATCH');
    case 'empty-success':
      return options.emptyMeans === 'empty' ? { kind: 'empty' } : fail('SCHEMA_MISMATCH');
    case 'body': {
      const parsed = options.schema.safeParse(condition.body);
      return parsed.success ? { kind: 'value', value: parsed.data } : fail('SCHEMA_MISMATCH');
    }
    default:
      return assertNever(condition);
  }
}

/** Tie a failure to the requested patient as a `CardResult`. */
export function failureToCard(failure: Failure, patientId: PatientUuid, correlationId: string): CardResult<never> {
  switch (failure.kind) {
    case 'reauth':
      return { kind: 'reauth' };
    case 'forbidden':
      return { kind: 'forbidden', patientId };
    case 'error':
      return { kind: 'error', patientId, correlationId, code: failure.code };
    default:
      return assertNever(failure);
  }
}
