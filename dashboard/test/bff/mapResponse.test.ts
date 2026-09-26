import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { UpstreamOutcome } from '../../bff/src/upstream/client.ts';
import { mapUpstream } from '../../bff/src/upstream/mapResponse.ts';
import { fhirPatientBundleSchema, fhirPatientSchema, restPatientSchema } from '../../bff/src/upstream/schemas/patient.ts';
import { responseFixture, routeFixture } from '../support/harness.ts';

const resp = (status: number, body: unknown): UpstreamOutcome => ({ kind: 'response', status, body, bodyEmpty: body === null });
const fromFixture = (f: { status: number; body: unknown }): UpstreamOutcome => resp(f.status, f.body);
const rest = { shape: 'rest-envelope', schema: restPatientSchema, emptyMeans: 'error' } as const;
const restList = { shape: 'rest-envelope', schema: z.array(z.unknown()), emptyMeans: 'empty' } as const;
const fhir = { shape: 'fhir-resource', schema: fhirPatientSchema, emptyMeans: 'error' } as const;
const bundle = { shape: 'fhir-bundle', schema: fhirPatientBundleSchema, emptyMeans: 'empty' } as const;

describe('mapUpstream: every row of MIGRATION-REACT.md §2.5 that applies to this slice', () => {
  it('parses a good REST envelope and a good FHIR resource', () => {
    const r = mapUpstream(fromFixture(routeFixture('shaped/patient-13.json', 'rest.patient.read')), rest);
    expect(r.kind).toBe('value');
    const f = mapUpstream(fromFixture(routeFixture('shaped/patient-13.json', 'fhir.patient.read')), fhir);
    expect(f.kind).toBe('value');
  });

  it('HTTP 200 with validationErrors is an error, not data or empty (6.02)', () => {
    expect(mapUpstream(fromFixture(responseFixture('hand-built/rest-200-validation-errors.json')), restList)).toEqual({
      kind: 'failure',
      failure: { kind: 'error', code: 'UPSTREAM_VALIDATION' },
    });
  });

  it('REST 200 data:[] is empty only where the caller allows it', () => {
    const body = { validationErrors: [], internalErrors: [], data: [] };
    expect(mapUpstream(resp(200, body), restList)).toEqual({ kind: 'empty' });
    expect(mapUpstream(resp(200, body), rest)).toEqual({ kind: 'failure', failure: { kind: 'error', code: 'SCHEMA_MISMATCH' } });
  });

  it('a body that fails the schema is SCHEMA_MISMATCH, as is non-JSON', () => {
    expect(mapUpstream(resp(200, { validationErrors: [], internalErrors: [], data: { uuid: 1 } }), rest)).toMatchObject({
      failure: { code: 'SCHEMA_MISMATCH' },
    });
    expect(mapUpstream({ kind: 'response', status: 200, body: null, bodyEmpty: false }, fhir)).toMatchObject({ failure: { code: 'SCHEMA_MISMATCH' } });
  });

  it('a Bundle where a Patient was expected is an error', () => {
    expect(mapUpstream(fromFixture(responseFixture('hand-built/fhir-bundle-instead-of-patient.json')), fhir)).toMatchObject({
      failure: { code: 'SCHEMA_MISMATCH' },
    });
  });

  it('an OperationOutcome inside a 200 is an error (6.03)', () => {
    expect(mapUpstream(fromFixture(responseFixture('hand-built/fhir-operation-outcome-200.json')), fhir)).toMatchObject({
      failure: { code: 'UPSTREAM_OPERATION_OUTCOME' },
    });
  });

  it('an empty Bundle is empty only where the caller allows it (6.03)', () => {
    const empty = resp(200, { resourceType: 'Bundle', type: 'collection', total: 0 });
    expect(mapUpstream(empty, bundle)).toEqual({ kind: 'empty' });
    expect(mapUpstream(empty, { ...bundle, emptyMeans: 'error' })).toMatchObject({ failure: { code: 'SCHEMA_MISMATCH' } });
  });

  it('401 → reauth, 403 → forbidden, other statuses → error', () => {
    expect(mapUpstream(resp(401, null), fhir)).toEqual({ kind: 'failure', failure: { kind: 'reauth' } });
    expect(mapUpstream(resp(403, null), fhir)).toEqual({ kind: 'failure', failure: { kind: 'forbidden' } });
    expect(mapUpstream(resp(404, null), fhir)).toMatchObject({ failure: { code: 'UPSTREAM_STATUS' } });
    expect(mapUpstream(fromFixture(responseFixture('hand-built/rest-500-sqlstate.json')), rest)).toEqual({
      kind: 'failure',
      failure: { kind: 'error', code: 'UPSTREAM_STATUS' },
    });
  });

  it('timeouts and network errors are errors', () => {
    expect(mapUpstream({ kind: 'timeout' }, fhir)).toMatchObject({ failure: { code: 'UPSTREAM_TIMEOUT' } });
    expect(mapUpstream({ kind: 'network' }, fhir)).toMatchObject({ failure: { code: 'UPSTREAM_UNAVAILABLE' } });
  });

  it('a REST envelope without data, or no envelope at all, is SCHEMA_MISMATCH, never empty', () => {
    for (const body of [{}, { validationErrors: [], internalErrors: [] }, { validationErrors: [], internalErrors: [], data: null }, [], [{ uuid: 'x' }], 'text']) {
      expect(mapUpstream(resp(200, body), restList), JSON.stringify(body)).toMatchObject({ failure: { code: 'SCHEMA_MISMATCH' } });
    }
  });

  it('a bare REST array (responseHandler): [] is empty only where allowed; errors inside a 200 are errors', () => {
    const bare = { shape: 'rest-array', schema: z.array(z.object({ option_id: z.string() })), emptyMeans: 'empty' } as const;
    expect(mapUpstream(resp(200, []), bare)).toEqual({ kind: 'empty' });
    expect(mapUpstream(resp(200, []), { ...bare, emptyMeans: 'error' })).toMatchObject({ failure: { code: 'SCHEMA_MISMATCH' } });
    expect(mapUpstream(resp(200, [{ option_id: 'mild' }]), bare)).toEqual({ kind: 'value', value: [{ option_id: 'mild' }] });
    expect(mapUpstream(resp(200, { validationErrors: { pid: ['bad'] } }), bare)).toMatchObject({ failure: { code: 'UPSTREAM_VALIDATION' } });
    expect(mapUpstream(resp(200, { data: [] }), bare)).toMatchObject({ failure: { code: 'SCHEMA_MISMATCH' } });
    expect(mapUpstream(resp(404, null), bare)).toMatchObject({ failure: { code: 'UPSTREAM_STATUS' } });
  });

  it('404 with an empty body is empty only on a route that opts in (6.04); a 404 with a body never is', () => {
    const meds = { shape: 'rest-array', schema: z.array(z.unknown()), emptyMeans: 'empty', notFoundEmptyBodyIsEmpty: true } as const;
    const empty404: UpstreamOutcome = { kind: 'response', status: 404, body: null, bodyEmpty: true };
    expect(mapUpstream(empty404, meds)).toEqual({ kind: 'empty' });
    expect(mapUpstream({ kind: 'response', status: 404, body: { error: 'x' }, bodyEmpty: false }, meds)).toMatchObject({ failure: { code: 'UPSTREAM_STATUS' } });
    // Non-JSON text is not an empty body either.
    expect(mapUpstream({ kind: 'response', status: 404, body: null, bodyEmpty: false }, meds)).toMatchObject({ failure: { code: 'UPSTREAM_STATUS' } });
    expect(mapUpstream(empty404, { ...meds, notFoundEmptyBodyIsEmpty: false })).toMatchObject({ failure: { code: 'UPSTREAM_STATUS' } });
    expect(mapUpstream(empty404, restList)).toMatchObject({ failure: { code: 'UPSTREAM_STATUS' } });
    expect(mapUpstream({ kind: 'response', status: 410, body: null, bodyEmpty: true }, meds)).toMatchObject({ failure: { code: 'UPSTREAM_STATUS' } });
  });

  it('never carries upstream text into the result', () => {
    const out = JSON.stringify(mapUpstream(fromFixture(responseFixture('hand-built/rest-500-sqlstate.json')), rest));
    expect(out).not.toContain('SQLSTATE');
    expect(out).not.toContain('LEAKED_SQL_MARKER');
  });
});
