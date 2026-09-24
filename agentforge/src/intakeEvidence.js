import { formatPageOrSection, parseBoundingBox, parseSourceFields } from './sourceEvidenceParsing.js';

const ALLOWED_FIELDS = new Set(['demographics', 'chief_concern', 'medication', 'allergy', 'family_history']);

/** Parse the bounded synthetic intake-form representation used by local tests. */
export function extractIntakeEvidence({ sourceDocumentId, content }) {
  if (!sourceDocumentId || !Buffer.isBuffer(content)) return { status: 'qualified', facts: [], issues: ['invalid_source'] };
  const lines = content.toString('utf8').split(/\r?\n/);
  const candidates = lines.map((line, index) => ({ line: line.trim(), lineNumber: index + 1 })).filter(({ line }) => line.startsWith('INTAKE|'));
  if (!candidates.length) return { status: 'qualified', facts: [], issues: ['unreadable_or_missing_intake_fields'] };
  const facts = [];
  const issues = [];
  for (const { line, lineNumber } of candidates) {
    const values = parseSourceFields(line, 'INTAKE|');
    const missing = ['field', 'value', 'section', 'page', 'field_id', 'quote', 'bounding_box'].filter((field) => !String(values[field] || '').trim());
    const root = String(values.field || '').split('.')[0];
    const page = Number(values.page);
    const boundingBox = parseBoundingBox(values.bounding_box);
    if (missing.length) { issues.push(`record:${lineNumber}:missing_fields:${missing.join(',')}`); continue; }
    if (!ALLOWED_FIELDS.has(root)) { issues.push(`record:${lineNumber}:field_not_supported:${root}`); continue; }
    if (!Number.isInteger(page) || page < 1) { issues.push(`record:${lineNumber}:invalid_page`); continue; }
    if (!boundingBox) { issues.push(`record:${lineNumber}:invalid_bounding_box`); continue; }
    facts.push({ source_document_id: sourceDocumentId, field: values.field, field_id: values.field_id, value: values.value, section: values.section, citation: { source_type: 'document', source_id: sourceDocumentId, page_or_section: formatPageOrSection(page, values.section), field_or_chunk_id: values.field_id, quote_or_value: values.quote, bounding_box: boundingBox } });
  }
  const byKey = new Map();
  for (const fact of facts) {
    const key = `${fact.field}|${fact.section}`;
    const existing = byKey.get(key);
    if (existing && existing.value !== fact.value) issues.push(`conflicting_values:${key}`);
    else byKey.set(key, fact);
  }
  return { status: issues.length ? 'qualified' : 'complete', facts: [...byKey.values()], issues: [...new Set(issues)] };
}
