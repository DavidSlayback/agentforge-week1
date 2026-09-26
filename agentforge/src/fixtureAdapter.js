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
  /**
   * Every synthetic patient's identifiers, for refusing a follow-up question
   * that names a different patient: ref, display name, and the chart ids
   * (`pid`, `pubpid`, `mrn`) on its identity records.
   */
  listPatientIdentifiers() {
    const byRef = new Map();
    for (const item of this.cases) {
      const entry = byRef.get(item.patient.patient_ref) || { patient_ref: item.patient.patient_ref, names: [], record_ids: [] };
      entry.names.push(item.patient.display_name);
      for (const record of item.records) {
        if (record.field !== 'identity' || !record.value || typeof record.value !== 'object') continue;
        for (const key of ['pid', 'pubpid', 'mrn']) if (record.value[key]) entry.record_ids.push(String(record.value[key]));
      }
      byRef.set(item.patient.patient_ref, entry);
    }
    return [...byRef.values()];
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
