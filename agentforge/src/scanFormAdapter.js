import { EXTRACTION_STATUSES, requiredScanFields, SCAN_FORM_CONTRACT_VERSION, validateScanExtraction, validateScanInput } from './scanFormContracts.js';

const parseAttributes = (line) => Object.fromEntries(line.split('|').slice(1).map((part) => {
  const separator = part.indexOf('=');
  return separator < 0 ? [part.trim(), ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
}));

const parseBox = (value) => {
  const box = String(value || '').split(',').map(Number);
  return box.length === 4 && box.every((item) => Number.isFinite(item) && item >= 0) ? box : null;
};

const issue = (code, detail = '') => detail ? `${code}:${detail}` : code;

function parseFixture(content) {
  const lines = content.toString('utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines.find((line) => line.startsWith('SYNTHETIC_SCAN_FORM|'));
  if (!header) return { header: null, fields: [], missing: [], unreadable: [], issues: ['scan_form_header_missing'] };
  const fields = [];
  const missing = [];
  const unreadable = [];
  const issues = [];
  for (const line of lines.filter((item) => !item.startsWith('SYNTHETIC_SCAN_FORM|'))) {
    const [kind] = line.split('|');
    const attrs = parseAttributes(line);
    if (kind === 'FIELD') fields.push({ ...attrs, page: Number(attrs.page), bounding_box: parseBox(attrs.box), confidence: Number(attrs.confidence) });
    else if (kind === 'MISSING') missing.push({ field_id: attrs.field_id, reason: attrs.reason || 'missing' });
    else if (kind === 'UNREADABLE') unreadable.push({ field_id: attrs.field_id, reason: attrs.reason || 'unreadable' });
    else issues.push(issue('unknown_fixture_row', kind));
  }
  return { header: parseAttributes(header), fields, missing, unreadable, issues };
}

function citationFor(sourceDocumentId, layoutId, field) {
  const quote = [field.label, field.value, field.unit, field.reference_range].filter(Boolean).join(': ');
  return { source_type: 'synthetic_scan_form', source_document_id: sourceDocumentId, page: field.page, field_id: field.field_id, quote, bounding_box: field.bounding_box, layout_id: layoutId };
}

/**
 * Provider-neutral local scan-form extraction seam.
 *
 * The current implementation parses controlled synthetic form fixtures. It is
 * intentionally not represented as a real OCR/VLM accuracy claim; a future
 * provider can replace the parser behind this contract.
 */
export function extractScanForm({ sourceDocumentId, documentType, layoutId, pageCount = 1, content }) {
  const input = { contract_version: SCAN_FORM_CONTRACT_VERSION, source_document_id: sourceDocumentId, document_type: documentType, layout_id: layoutId, page_count: pageCount, content, synthetic_only: true };
  const inputValidation = validateScanInput(input);
  if (!inputValidation.valid) return blockedResult(inputValidation.issues);
  const started = performance.now();
  const parsed = parseFixture(content);
  if (!parsed.header) return blockedResult(parsed.issues);
  const expected = requiredScanFields({ documentType, layoutId });
  const issues = [...parsed.issues];
  const facts = [];
  const conflicts = [];
  const uncertainFields = [];
  const byField = new Map();
  for (const field of parsed.fields) {
    if (!field.field_id || !field.value || !Number.isInteger(field.page) || !field.bounding_box || !Number.isFinite(field.confidence)) {
      issues.push(issue('invalid_field_row', field.field_id || 'unknown'));
      continue;
    }
    const previous = byField.get(field.field_id);
    if (previous && previous.value !== field.value) {
      conflicts.push({ field_id: field.field_id, values: [previous.value, field.value], citations: [previous.citation, citationFor(sourceDocumentId, parsed.header.layout, field)] });
      byField.delete(field.field_id);
      continue;
    }
    const citation = citationFor(sourceDocumentId, parsed.header.layout, field);
    const fact = { field_id: field.field_id, value: field.value, confidence: field.confidence, disposition: 'observed', citation, uncertainty: field.confidence < 0.85 ? 'low_confidence_requires_human_review' : null };
    byField.set(field.field_id, fact);
    if (fact.uncertainty) uncertainFields.push({ field_id: field.field_id, reason: fact.uncertainty });
  }
  for (const fact of byField.values()) facts.push(fact);
  const explicitMissing = new Map(parsed.missing.map((item) => [item.field_id, item.reason]));
  const explicitUnreadable = new Map(parsed.unreadable.map((item) => [item.field_id, item.reason]));
  const missingFields = expected.filter((fieldId) => !byField.has(fieldId) && !explicitUnreadable.has(fieldId)).map((fieldId) => ({ field_id: fieldId, reason: explicitMissing.get(fieldId) || 'not_observed' }));
  const unreadableFields = [...explicitUnreadable.entries()].map(([field_id, reason]) => ({ field_id, reason }));
  uncertainFields.push(...unreadableFields.map(({ field_id, reason }) => ({ field_id, reason: `unreadable:${reason}` })));
  if (conflicts.length) issues.push('conflicting_values_require_review');
  if (unreadableFields.length) issues.push('unreadable_fields_require_review');
  if (missingFields.length) issues.push('missing_fields_require_review');
  const status = conflicts.length || unreadableFields.length || (!facts.length && missingFields.length) ? 'qualified' : missingFields.length ? 'partial' : 'complete';
  const result = { contract_version: SCAN_FORM_CONTRACT_VERSION, provider: 'synthetic-ocr-vlm-adapter', status, facts, missing_fields: missingFields, uncertain_fields: uncertainFields, conflicts, issues: [...new Set(issues)], metrics: { pages: pageCount, candidate_fields: parsed.fields.length, accepted_fields: facts.length, duration_ms: Number((performance.now() - started).toFixed(3)) }, synthetic_only: true };
  const validation = validateScanExtraction(result, { sourceDocumentId, documentType, layoutId });
  return validation.valid ? result : blockedResult([...result.issues, ...validation.issues]);
}

function blockedResult(issues) {
  return { contract_version: SCAN_FORM_CONTRACT_VERSION, provider: 'synthetic-ocr-vlm-adapter', status: EXTRACTION_STATUSES[3], facts: [], missing_fields: [], uncertain_fields: [], conflicts: [], issues: [...new Set(issues)], metrics: { pages: 0, candidate_fields: 0, accepted_fields: 0, duration_ms: 0 }, synthetic_only: true };
}
