import fs from 'node:fs';
import { authorizeRequest } from './accessContext.js';
import { coverageGroupForField } from './contracts.js';

export class FixtureAdapter {
  constructor(path) { this.cases = JSON.parse(fs.readFileSync(path, 'utf8')).cases; this.name = 'fixture'; }
  authorize(request, verifiedContext = null, options = {}) { return authorizeRequest({ request, verifiedContext, ...options }); }
  getCase(patientRef, caseId) {
    const found = caseId ? this.cases.find((item) => item.id === caseId) : this.cases.find((item) => item.patient.patient_ref === patientRef);
    if (!found || found.patient.patient_ref !== patientRef) throw new Error('PATIENT_NOT_FOUND');
    return found;
  }
  /** PatientDemographicsSource for synthetic mode: the fixture patient's `{name, dob}`, or `null` when unknown. */
  getPatientDemographics(patientRef) {
    const found = this.cases.find((item) => item.patient.patient_ref === patientRef);
    return found ? { name: found.patient.display_name, dob: found.patient.dob } : null;
  }
  retrieve(item) {
    const successfulGroups = new Set(item.retrieval.filter((group) => group.status === 'success' && (group.records || 0) > 0).map((group) => group.group));
    const records = item.records.filter((record) => successfulGroups.has(coverageGroupForField(record.field)));
    return { records, coverage: item.retrieval.map((group) => ({
      group: group.group, status: group.status, records: group.records || 0,
      attempts: group.attempts || 1, error_class: group.error_class || null
    })) };
  }
  async checkReady() { return true; }
}
