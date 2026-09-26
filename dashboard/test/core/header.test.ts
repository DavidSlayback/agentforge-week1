import { describe, expect, it } from 'vitest';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { deriveHeader, deriveStatus, extractMrn, type FhirPatientInput } from '../../core/rules/header.ts';
import { fhirPatientSchema } from '../../bff/src/upstream/schemas/patient.ts';
import { PATIENT, routeFixture } from '../support/harness.ts';

const TODAY = '2026-09-25';

function fixturePatient(file: string): FhirPatientInput {
  return fhirPatientSchema.parse(routeFixture(file, 'fhir.patient.read').body);
}

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}

describe('header parity: status is derived from deceased fields, never Patient.active', () => {
  it('pid 12 (deceasedDateTime set) is Deceased with "Age at death"', () => {
    const h = deriveHeader(uuid(PATIENT.p12), fixturePatient('shaped/patient-12.json'), TODAY);
    expect(h.status).toBe('Deceased');
    expect(h.ageLabel).toBe('Age at death');
    expect(h.deceasedDate).toBe('2026-08-30');
    expect(h.age).toBe('31'); // 1995-07-20 → 2026-08-30
  });

  it('pid 13 (deceasedBoolean false) is Active with every field present', () => {
    const h = deriveHeader(uuid(PATIENT.p13), fixturePatient('shaped/patient-13.json'), TODAY);
    expect(h.status).toBe('Active');
    expect(h.ageLabel).toBe('Age');
    expect(h.deceasedDate).toBeNull();
    expect(h.mrn).toBe('13');
    expect(h.sex).toBe('Male');
    expect(h.birthDate).toBe('1974-02-10');
    expect(h.age).toBe('52');
    expect(h.name).not.toBeNull();
  });

  it('pid 3 (empty-state patient) is Active with every field present', () => {
    const h = deriveHeader(uuid(PATIENT.p3), fixturePatient('shaped/patient-3.json'), TODAY);
    expect(h.status).toBe('Active');
    expect([h.name, h.birthDate, h.sex, h.mrn, h.age].every((v) => v !== null)).toBe(true);
    expect(h.sex).toBe('Female');
    expect(h.age).toBe('19');
  });

  it('DASH-SYN-02 (dedicated deceased patient) is Deceased', () => {
    const h = deriveHeader(uuid(PATIENT.dashSyn02), fixturePatient('shaped/dash-syn-02.json'), TODAY);
    expect(h.status).toBe('Deceased');
    expect(h.mrn).toBe('DASH-SYN-02');
  });

  it('active:false with no deceased fields is still Active (Patient.active is ignored)', () => {
    expect(deriveStatus({ id: PATIENT.p13, active: false, deceasedBoolean: false })).toBe('Active');
    expect(deriveStatus({ id: PATIENT.p13, active: false })).toBe('Active');
  });

  it('active:true with a deceasedDateTime is Deceased', () => {
    expect(deriveStatus({ id: PATIENT.p12, active: true, deceasedDateTime: '2026-08-30T14:00:00+00:00' })).toBe('Deceased');
  });

  it('deceasedBoolean true (no date) is Deceased; false is Active', () => {
    expect(deriveStatus({ id: PATIENT.p12, active: true, deceasedBoolean: true })).toBe('Deceased');
    expect(deriveStatus({ id: PATIENT.p12, active: true, deceasedBoolean: false })).toBe('Active');
  });

  it('MRN is the PT identifier only', () => {
    expect(extractMrn({ id: 'x', identifier: [{ type: { coding: [{ code: 'SS' }] }, value: '999' }] })).toBeNull();
    expect(
      extractMrn({
        id: 'x',
        identifier: [
          { type: { coding: [{ code: 'SS' }] }, value: '999' },
          { type: { coding: [{ code: 'PT' }] }, value: 'DASH-SYN-01' },
        ],
      }),
    ).toBe('DASH-SYN-01');
  });

  it('missing fields become null (rendered "Not recorded"), never invented', () => {
    const h = deriveHeader(uuid(PATIENT.p13), { id: PATIENT.p13 }, TODAY);
    expect(h).toMatchObject({ name: null, birthDate: null, age: null, sex: null, mrn: null, status: 'Active' });
  });
});
