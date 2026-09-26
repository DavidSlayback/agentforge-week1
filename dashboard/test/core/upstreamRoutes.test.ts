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
      switch (spec.patientBinding) {
        case 'path':
          expect(patientPath, spec.id).toBe(true);
          break;
        case 'query':
          expect(patientQuery, spec.id).toBe(true);
          break;
        case 'none':
          // Only a fixed-literal code list: no parameters at all, no patient data.
          expect(spec.id).toBe('rest.list.read');
          expect(spec.pathParams).toEqual([]);
          expect(spec.query).toEqual([]);
          expect(spec.pathTemplate).toBe('/list/severity_ccda');
          break;
      }
    }
  });

  it('builds the issue-card routes with no query keys and a validated puuid (01-02-01)', () => {
    expect(buildUpstreamPath('rest.allergy.list', { puuid: PATIENT.p13 })).toBe(`/apis/default/api/patient/${PATIENT.p13}/allergy`);
    expect(buildUpstreamPath('rest.list.read')).toBe('/apis/default/api/list/severity_ccda');
    expect(() => buildUpstreamPath('rest.allergy.list', { puuid: '13' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.allergy.list', { puuid: PATIENT.p13 }, { title: 'x' })).toThrow(AllowListViolation);
    // The list name is fixed: it cannot be supplied as a parameter or a query key.
    expect(() => buildUpstreamPath('rest.list.read', { list_name: 'reaction' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.list.read', {}, { list_id: 'reaction' })).toThrow(AllowListViolation);
  });

  it('declares a scope and ACL for every route', () => {
    for (const spec of Object.values(UPSTREAM_ROUTES)) {
      expect(spec.scope, spec.id).toMatch(/^user\/[A-Za-z_]+\.[rs]+$/);
      expect(spec.acl, spec.id).toMatch(/^[a-z_]+\/[a-z_]+$/);
    }
  });
});
