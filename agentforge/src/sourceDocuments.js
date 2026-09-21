import crypto from 'node:crypto';

export const SOURCE_DOCUMENT_TYPES = new Set(['lab_pdf', 'intake_form']);
export const MAX_SOURCE_DOCUMENT_BYTES = 5 * 1024 * 1024;

function requireString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function normalizeFilename(value) {
  const filename = requireString(value, 'SOURCE_DOCUMENT_FILENAME_REQUIRED');
  if (filename.length > 255 || filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') throw new Error('SOURCE_DOCUMENT_FILENAME_INVALID');
  return filename;
}

function normalizeContent(value) {
  if (!Buffer.isBuffer(value) || value.length === 0) throw new Error('SOURCE_DOCUMENT_CONTENT_INVALID');
  if (value.length > MAX_SOURCE_DOCUMENT_BYTES) throw new Error('SOURCE_DOCUMENT_TOO_LARGE');
  return Buffer.from(value);
}

export function validateSourceDocumentInput({ patientRef, documentType, filename, content, uploadedBy }) {
  requireString(patientRef, 'SOURCE_DOCUMENT_PATIENT_REQUIRED');
  if (!SOURCE_DOCUMENT_TYPES.has(documentType)) throw new Error('SOURCE_DOCUMENT_TYPE_INVALID');
  normalizeFilename(filename);
  normalizeContent(content);
  requireString(uploadedBy, 'SOURCE_DOCUMENT_UPLOADER_REQUIRED');
  return true;
}

function publicDocument(record) {
  const { content: _content, ...document } = record;
  return { ...document };
}

/** Synthetic-only source-document roundtrip with deterministic deduplication. */
export class SyntheticSourceDocumentStore {
  constructor({ now = () => new Date().toISOString() } = {}) {
    this.now = now;
    this.documents = new Map();
    this.byDedupKey = new Map();
  }

  persist({ patientRef, documentType, filename, content, uploadedBy, now = this.now }) {
    validateSourceDocumentInput({ patientRef, documentType, filename, content, uploadedBy });
    const normalizedContent = normalizeContent(content);
    const contentSha256 = crypto.createHash('sha256').update(normalizedContent).digest('hex');
    const dedupKey = `${patientRef}|${documentType}|${contentSha256}`;
    const existingId = this.byDedupKey.get(dedupKey);
    if (existingId) return { duplicate: true, document: publicDocument(this.documents.get(existingId)) };
    const id = `src-${crypto.createHash('sha256').update(dedupKey).digest('hex').slice(0, 24)}`;
    const record = {
      id,
      patient_ref: patientRef,
      document_type: documentType,
      filename: normalizeFilename(filename),
      content_sha256: contentSha256,
      size_bytes: normalizedContent.length,
      uploaded_by: uploadedBy,
      uploaded_at: now(),
      ingestion_revision: 1,
      synthetic_only: true,
      source_system: 'synthetic-roundtrip',
      persistence_boundary: 'simulated-openemr-adapter',
      content: normalizedContent,
    };
    this.documents.set(id, record);
    this.byDedupKey.set(dedupKey, id);
    return { duplicate: false, document: publicDocument(record) };
  }

  get(id, { patientRef } = {}) {
    const record = this.documents.get(id);
    if (!record) throw new Error('DOCUMENT_NOT_FOUND');
    if (record.patient_ref !== patientRef) throw new Error('DOCUMENT_SCOPE_MISMATCH');
    return { document: publicDocument(record), content: Buffer.from(record.content) };
  }

  list(patientRef) {
    return [...this.documents.values()]
      .filter((record) => record.patient_ref === patientRef)
      .map(publicDocument);
  }
}
