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
        case 'reference':
          // A single-resource read by an id taken from a patient-bound response: one uuid path
          // parameter, no query keys, a `.read` route id (never a collection).
          expect(spec.id, spec.id).toMatch(/\.read$/);
          expect(spec.pathParams, spec.id).toEqual([{ name: 'id', kind: 'resourceUuid' }]);
          expect(spec.query, spec.id).toEqual([]);
          break;
      }
    }
  });

  it('builds the Medical Problems route under encounters/notes, with no query keys (01-02-02)', () => {
    expect(buildUpstreamPath('rest.problem.list', { puuid: PATIENT.p13 })).toBe(`/apis/default/api/patient/${PATIENT.p13}/medical_problem`);
    expect(UPSTREAM_ROUTES['rest.problem.list'].acl).toBe('encounters/notes');
    expect(() => buildUpstreamPath('rest.problem.list', { puuid: PATIENT.p13 }, { 'clinical-status': 'active' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.problem.list', { pid: 13 })).toThrow(AllowListViolation);
  });

  it('builds the Medications route from an integer pid only (01-02-03)', () => {
    expect(buildUpstreamPath('rest.medication.list', { pid: 13 })).toBe('/apis/default/api/patient/13/medication');
    expect(() => buildUpstreamPath('rest.medication.list', { pid: PATIENT.p13 })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.medication.list', { pid: '13 OR 1=1' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.medication.list', { pid: 0 })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.medication.list', { pid: 13 }, { type: 'allergy' })).toThrow(AllowListViolation);
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

  it('builds the prescription search with exactly patient_id and the fixed source_table (01-03-01, M-1)', () => {
    expect(buildUpstreamPath('rest.prescription.search', {}, { patient_id: 14 })).toBe('/apis/default/api/prescription?patient_id=14&source_table=prescriptions');
    expect(UPSTREAM_ROUTES['rest.prescription.search'].query.map((q) => q.key)).toEqual(['patient_id', 'source_table']);
    expect(UPSTREAM_ROUTES['rest.prescription.search'].acl).toBe('patients/med');
  });

  it('rejects any client-supplied extra key on the prescription search: the route builds SQL from key NAMES (M-1 / 2.01)', () => {
    // Keys an attacker (or a careless SPA) might try: a legitimate-looking column, the other
    // patient key, a sort, and a key that is itself SQL.
    for (const extra of ['pid', 'drug', '_sort', 'active', "patient_id`=1 OR 1=1 -- "]) {
      expect(() => buildUpstreamPath('rest.prescription.search', {}, { patient_id: 14, [extra]: '1' }), extra).toThrow(AllowListViolation);
    }
    // The fixed key cannot be overridden (e.g. to reach the `lists` branch), and the pid must be an integer.
    expect(() => buildUpstreamPath('rest.prescription.search', {}, { patient_id: 14, source_table: 'lists' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.prescription.search', {}, {})).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.prescription.search', {}, { patient_id: PATIENT.dashSyn01 })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.prescription.search', {}, { patient_id: '14 OR 1=1' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.prescription.search', { pid: 14 }, { patient_id: 14 })).toThrow(AllowListViolation);
  });

  it('builds the CareTeam search by patient uuid only, and the name reads by a validated uuid (01-04-01)', () => {
    expect(buildUpstreamPath('fhir.careteam.search', {}, { patient: PATIENT.p13 })).toBe(`/apis/default/fhir/CareTeam?patient=${PATIENT.p13}`);
    expect(() => buildUpstreamPath('fhir.careteam.search', {}, { patient: PATIENT.p13, status: 'active' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('fhir.careteam.search', {}, { patient: '13' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('fhir.careteam.search', {}, {})).toThrow(AllowListViolation);
    const id = 'a2c331a5-4021-4f9b-893f-cd7dc6db1147';
    expect(buildUpstreamPath('fhir.practitioner.read', { id })).toBe(`/apis/default/fhir/Practitioner/${id}`);
    expect(buildUpstreamPath('fhir.organization.read', { id: id.toUpperCase() })).toBe(`/apis/default/fhir/Organization/${id}`);
    expect(() => buildUpstreamPath('fhir.practitioner.read', { id: '../Patient/x' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('fhir.practitioner.read', { id: '5' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('fhir.organization.read', {})).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('fhir.organization.read', { id }, { _include: '*' })).toThrow(AllowListViolation);
  });

  it('builds the encounter list by puuid and the per-encounter vitals by integer pid and eid (01-05-01)', () => {
    expect(buildUpstreamPath('rest.encounter.list', { puuid: PATIENT.dashSyn01 })).toBe(`/apis/default/api/patient/${PATIENT.dashSyn01}/encounter`);
    expect(buildUpstreamPath('rest.vital.list', { pid: 14, eid: 370 })).toBe('/apis/default/api/patient/14/encounter/370/vital');
    expect(UPSTREAM_ROUTES['rest.encounter.list'].acl).toBe('encounters/auth_a');
    expect(UPSTREAM_ROUTES['rest.vital.list'].acl).toBe('encounters/notes');
    expect(() => buildUpstreamPath('rest.vital.list', { pid: 14 })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.vital.list', { pid: 14, eid: '370/vital/36' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.vital.list', { pid: 14, eid: 0 })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.vital.list', { pid: PATIENT.dashSyn01, eid: 370 })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.vital.list', { pid: 14, eid: 370, vid: 36 })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('rest.encounter.list', { puuid: PATIENT.dashSyn01 }, { _sort: 'date' })).toThrow(AllowListViolation);
  });

  it('builds the MedicationRequest search with exactly the patient uuid and the fixed intent=plan (01-06-04)', () => {
    expect(buildUpstreamPath('fhir.medicationrequest.search', {}, { patient: PATIENT.dashSyn01 })).toBe(
      `/apis/default/fhir/MedicationRequest?patient=${PATIENT.dashSyn01}&intent=plan`,
    );
    expect(UPSTREAM_ROUTES['fhir.medicationrequest.search'].acl).toBe('patients/med');
    expect(UPSTREAM_ROUTES['fhir.medicationrequest.search'].scope).toBe('user/MedicationRequest.rs');
    // The intent is fixed (no reaching prescriptions' `order` rows), and nothing else is forwarded.
    expect(() => buildUpstreamPath('fhir.medicationrequest.search', {}, { patient: PATIENT.dashSyn01, intent: 'order' })).toThrow(AllowListViolation);
    for (const extra of ['status', '_id', '_lastUpdated', '_revinclude']) {
      expect(() => buildUpstreamPath('fhir.medicationrequest.search', {}, { patient: PATIENT.dashSyn01, [extra]: 'x' }), extra).toThrow(AllowListViolation);
    }
    expect(() => buildUpstreamPath('fhir.medicationrequest.search', {}, { patient: '14' })).toThrow(AllowListViolation);
    expect(() => buildUpstreamPath('fhir.medicationrequest.search', {}, {})).toThrow(AllowListViolation);
  });

  it('has no FHIR Observation route: FHIR vitals include soft-deleted sets (5.02 / M-5)', () => {
    for (const spec of Object.values(UPSTREAM_ROUTES)) expect(spec.pathTemplate, spec.id).not.toMatch(/Observation/i);
  });

  it('declares a scope and ACL for every route', () => {
    for (const spec of Object.values(UPSTREAM_ROUTES)) {
      expect(spec.scope, spec.id).toMatch(/^user\/[A-Za-z_]+\.[rs]+$/);
      expect(spec.acl, spec.id).toMatch(/^[a-z_]+\/[a-z_]+$/);
    }
  });
});
