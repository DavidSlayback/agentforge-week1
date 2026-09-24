import { parseBoundingBox, parseSourceFields } from './sourceEvidenceParsing.js';

const REQUIRED_FIELDS = ['test', 'value', 'unit', 'reference_range', 'collection_date', 'abnormal', 'page', 'field_id', 'quote', 'bounding_box'];

function issue(code, detail = '') { return detail ? `${code}:${detail}` : code; }

function parseBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function parseRecord(line, sourceDocumentId, lineNumber) {
  const values = parseSourceFields(line, 'LAB|');
  const missing = REQUIRED_FIELDS.filter((field) => !String(values[field] || '').trim());
  if (missing.length) return { fact: null, issues: [issue('missing_fields', missing.join(','))] };
  const abnormal = parseBoolean(values.abnormal);
  const page = Number(values.page);
  const boundingBox = parseBoundingBox(values.bounding_box);
  const issues = [];
  if (abnormal === null) issues.push(issue('invalid_abnormal_flag', values.abnormal));
  if (!Number.isInteger(page) || page < 1) issues.push(issue('invalid_page', values.page));
  if (!boundingBox) issues.push(issue('invalid_bounding_box', values.bounding_box));
  if (issues.length) return { fact: null, issues };
  return {
    fact: {
      source_document_id: sourceDocumentId,
      field_id: values.field_id,
      test: values.test,
      value: values.value,
      unit: values.unit,
      reference_range: values.reference_range,
      collection_date: values.collection_date,
      abnormal,
      citation: { source_type: 'lab_pdf', source_document_id: sourceDocumentId, page, field_id: values.field_id, quote: values.quote, bounding_box: boundingBox, line_number: lineNumber },
    },
    issues: [],
  };
}

/** Parse the bounded synthetic lab-PDF text representation used by local tests. */
export function extractLabEvidence({ sourceDocumentId, content }) {
  if (!sourceDocumentId || !Buffer.isBuffer(content)) return { status: 'qualified', facts: [], issues: ['invalid_source'] };
  const lines = content.toString('utf8').split(/\r?\n/);
  const candidates = lines.map((line, index) => ({ line: line.trim(), lineNumber: index + 1 })).filter(({ line }) => line.startsWith('LAB|'));
  if (!candidates.length) return { status: 'qualified', facts: [], issues: ['unreadable_or_missing_lab_records'] };
  const facts = [];
  const issues = [];
  for (const candidate of candidates) {
    const parsed = parseRecord(candidate.line, sourceDocumentId, candidate.lineNumber);
    facts.push(...(parsed.fact ? [parsed.fact] : []));
    issues.push(...parsed.issues.map((value) => issue('record', `${candidate.lineNumber}:${value}`)));
  }
  const byKey = new Map();
  for (const fact of facts) {
    const key = `${fact.test}|${fact.collection_date}`;
    const existing = byKey.get(key);
    if (existing && (existing.value !== fact.value || existing.unit !== fact.unit)) issues.push(issue('conflicting_values', key));
    else byKey.set(key, fact);
  }
  const uniqueFacts = [...byKey.values()];
  return { status: issues.length ? 'qualified' : 'complete', facts: uniqueFacts, issues: [...new Set(issues)] };
}
