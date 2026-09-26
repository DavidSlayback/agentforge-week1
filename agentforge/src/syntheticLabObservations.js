import crypto from 'node:crypto';

export const SYNTHETIC_LAB_READ_PATH = 'in-memory-synthetic-lab-store';
export const SYNTHETIC_LAB_PERSISTENCE_BOUNDARY = 'in-memory-synthetic';

/**
 * In-memory SYNTHETIC lab result store for fixture mode and the eval gate.
 * It is not OpenEMR. It keeps the module's lab-results rows (the output of
 * `labResultsForModule`) per patient and source document and reads them back
 * as FHIR-shaped Observations, following the OpenEMR 8.0.0 mapping the module
 * relies on (a reference range only for "low-high"; the abnormal flag as the
 * interpretation text; the module's `agentforge:v1` note). Every result is
 * labeled with `SYNTHETIC_LAB_READ_PATH` and the in-memory-synthetic
 * boundary, so it can never be mistaken for an OpenEMR read-back.
 */
export class SyntheticLabObservationStore {
  constructor() {
    this.bySource = new Map();
  }

  /** Idempotent per patient and source document, like the module ledger key. */
  persist({ patientRef, sourceDocumentId, rows }) {
    if (typeof patientRef !== 'string' || !patientRef || typeof sourceDocumentId !== 'string' || !sourceDocumentId) throw Object.assign(new Error('SYNTHETIC_LAB_INPUT_INVALID'), { code: 'SYNTHETIC_LAB_INPUT_INVALID' });
    const key = `${patientRef}|${sourceDocumentId}`;
    const existing = this.bySource.get(key);
    if (existing) return { status: 'persisted', duplicate: true, persistence_boundary: SYNTHETIC_LAB_PERSISTENCE_BOUNDARY, source_document_id: sourceDocumentId, observation_ids: existing.results.map((result) => result.id) };
    const results = rows.map((row) => ({ id: `synthetic-obs-${crypto.createHash('sha256').update(`${key}|${row.field_id}`).digest('hex').slice(0, 20)}`, row: { ...row } }));
    this.bySource.set(key, { patientRef, sourceDocumentId, results });
    return { status: 'persisted', duplicate: false, persistence_boundary: SYNTHETIC_LAB_PERSISTENCE_BOUNDARY, source_document_id: sourceDocumentId, observation_ids: results.map((result) => result.id) };
  }

  /** Every stored result for one patient, never another patient's. */
  history({ patientRef }) {
    const entries = [];
    for (const stored of this.bySource.values()) {
      if (stored.patientRef !== patientRef) continue;
      for (const { id, row } of stored.results) {
        entries.push({ resource: syntheticObservation({ id, row, patientRef, sourceDocumentId: stored.sourceDocumentId }), source_document_id: stored.sourceDocumentId, field_id: row.field_id, page: row.page, collection_date: row.collection_date });
      }
    }
    return { read_path: SYNTHETIC_LAB_READ_PATH, persistence_boundary: SYNTHETIC_LAB_PERSISTENCE_BOUNDARY, synthetic_only: true, missing_observation_ids: [], entries };
  }
}

function syntheticObservation({ id, row, patientRef, sourceDocumentId }) {
  const numeric = /^-?\d+(?:\.\d+)?$/.test(row.value);
  const [low, high] = String(row.reference_range || '').split('-').map((part) => (/^\s*\d+(?:\.\d+)?\s*$/.test(part) ? Number(part) : null));
  return {
    resourceType: 'Observation',
    id,
    status: 'unknown',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: row.loinc_code, display: row.test_name }] },
    subject: { reference: `Patient/${patientRef}` },
    effectiveDateTime: `${row.collection_date}T00:00:00+00:00`,
    ...(numeric ? { valueQuantity: { value: Number(row.value), unit: row.unit } } : { valueString: row.value }),
    ...(low !== null && low !== undefined && high !== null && high !== undefined ? { referenceRange: [{ low: { value: low, unit: row.unit }, high: { value: high, unit: row.unit } }] } : {}),
    ...(row.abnormal ? { interpretation: [{ text: row.abnormal }] } : {}),
    note: [{ text: `agentforge:v1 doc=${sourceDocumentId} page=${row.page} field=${row.field_id}` }],
  };
}
