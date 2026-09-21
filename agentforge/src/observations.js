import crypto from 'node:crypto';

export class SyntheticObservationStore {
  constructor() {
    this.records = new Map();
    this.byDedupKey = new Map();
  }

  persist({ patientRef, sourceDocumentId, fact, now = () => new Date().toISOString() }) {
    const dedupKey = `${sourceDocumentId}|${fact.field_id}|${fact.collection_date}`;
    const existingId = this.byDedupKey.get(dedupKey);
    if (existingId) return { duplicate: true, observation: this.records.get(existingId) };
    const id = `obs-${crypto.createHash('sha256').update(`${patientRef}|${dedupKey}`).digest('hex').slice(0, 24)}`;
    const observation = {
      id,
      patient_ref: patientRef,
      source_document_id: sourceDocumentId,
      field_id: fact.field_id,
      value: fact.value,
      unit: fact.unit,
      reference_range: fact.reference_range,
      collection_date: fact.collection_date,
      abnormal: fact.abnormal,
      citation: fact.citation,
      ingestion_revision: 1,
      persisted_at: now(),
      synthetic_only: true,
      persistence_boundary: 'simulated-openemr-observation-adapter',
    };
    this.records.set(id, observation);
    this.byDedupKey.set(dedupKey, id);
    return { duplicate: false, observation };
  }

  list(patientRef) { return [...this.records.values()].filter((record) => record.patient_ref === patientRef); }
}
