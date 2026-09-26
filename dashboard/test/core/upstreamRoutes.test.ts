import { describe, expect, it } from 'vitest';
import { AllowListViolation, buildUpstreamPath, UPSTREAM_ROUTES, type UpstreamRouteId } from '../../core/upstreamRoutes.ts';
import { PATIENT } from '../support/harness.ts';

describe('upstream allow-list', () => {
  it('builds the header reads with no query keys', () => {
    expect(buildUpstreamPath('fhir.patient.read', { puuid: PATIENT.p13 })).toBe(`/apis/default/fhir/Patient/${PATIENT.p13}`);
    expect(buildUpstreamPath('rest.patient.read', { puuid: PATIENT.p13 })).toBe(`/apis/default/api/patient/${PATIENT.p13}`);
  });

  it('builds the MRN search with exactly one query key', () => {
    expect(buildUpstreamPath('fhir.patient.search', {}, { identifier: 'DASH-SYN-01' })).toBe('/apis/default/fhir/Patient?identifier=DASH-SYN-01');
  });

  it('throws on an unknown query key (a client-supplied key is never forwarded)', () => {
    expect(() => buildUpstreamPath('fhir.patient.read', { puuid: PATIENT.p13 }, { _sort: 'x' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('fhir.patient.search', {}, { identifier: '13', name: 'x' })).toThrow(AllowListViolation);
  });

  it('throws on a missing or invalid parameter', () => {
    expect(() => buildUpstreamPath('fhir.patient.read', {})).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('fhir.patient.read', { puuid: '13' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.patient.read', { puuid: '../../api/patient' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('fhir.patient.search', {}, {})).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('fhir.patient.search', {}, { identifier: "1' OR '1'='1" })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.patient.read', { puuid: PATIENT.p13, pid: 13 })).toThrow(AllowListViolation);
  });

  it('throws on an unknown route id', () => {
    // Simulates a caller outside the type system (e.g. JS) asking for an unlisted route.
    const unknownRoute = 'rest.patient.list' as UpstreamRouteId;
    expect(() => buildUpstreamPath(unknownRoute)).toThrow(AllowListViolation);
  });

  it('has no unscoped collection route (3.13): every route is bound to one patient', () => {
    for (const spec of Object.values(UPSTREAM_ROUTES)) {
      const patientPath = spec.pathParams.some((p) => p.kind === 'puuid' || p.kind === 'pid');
      const patientQuery = spec.query.some((q) => q.kind === 'puuid' || q.kind === 'pid' || q.kind === 'mrn');
      expect(spec.patientBinding === 'path' ? patientPath : patientQuery, spec.id).toBe(true);
    }
  });

  it('declares a scope and ACL for every route', () => {
    for (const spec of Object.values(UPSTREAM_ROUTES)) {
      expect(spec.scope, spec.id).toMatch(/^user\/[A-Za-z_]+\.[rs]+$/);
      expect(spec.acl, spec.id).toMatch(/^[a-z_]+\/[a-z_]+$/);
    }
  });
});
