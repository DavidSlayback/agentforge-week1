import fs from 'node:fs';

export class FixtureAdapter {
  constructor(path) { this.cases = JSON.parse(fs.readFileSync(path, 'utf8')).cases; }
  getCase(patientRef, caseId) {
    const found = caseId ? this.cases.find((item) => item.id === caseId) : this.cases.find((item) => item.patient.patient_ref === patientRef);
    if (!found || found.patient.patient_ref !== patientRef) throw new Error('PATIENT_NOT_FOUND');
    return found;
  }
  retrieve(item) {
    return { records: item.records, coverage: item.retrieval.map((group) => ({
      group: group.group, status: group.status, records: group.records || 0,
      attempts: group.attempts || 1, error_class: group.error_class || null
    })) };
  }
  async checkReady() { return true; }
}
