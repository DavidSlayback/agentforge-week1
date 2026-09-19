import fs from 'node:fs';
import { authorizeRequest } from './accessContext.js';

export class FixtureAdapter {
  constructor(path) { this.cases = JSON.parse(fs.readFileSync(path, 'utf8')).cases; }
  authorize(request, verifiedContext = null) { return authorizeRequest({ request, verifiedContext }); }
  getCase(patientRef, caseId) {
    const found = caseId ? this.cases.find((item) => item.id === caseId) : this.cases.find((item) => item.patient.patient_ref === patientRef);
    if (!found || found.patient.patient_ref !== patientRef) throw new Error('PATIENT_NOT_FOUND');
    return found;
  }
  retrieve(item) {
    const successfulGroups = new Set(item.retrieval.filter((group) => group.status === 'success' && (group.records || 0) > 0).map((group) => group.group));
    const records = item.records.filter((record) => successfulGroups.has(recordGroup(record)));
    return { records, coverage: item.retrieval.map((group) => ({
      group: group.group, status: group.status, records: group.records || 0,
      attempts: group.attempts || 1, error_class: group.error_class || null
    })) };
  }
  async checkReady() { return true; }
}

function recordGroup(record) {
  const [root] = String(record.field || '').split('.');
  return { encounter: 'encounters', medication: 'medications', problem: 'problems', allergy: 'allergies', note: 'notes', identity: 'identity' }[root] || root;
}
