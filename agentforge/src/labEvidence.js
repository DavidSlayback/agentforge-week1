import { formatPageOrSection, parseBoundingBox, parseSourceFields } from './sourceEvidenceParsing.js';
import { LabResult, parseOrIssues } from './schemas.js';

const REQUIRED_FIELDS = ['test', 'value', 'unit', 'reference_range', 'collection_date', 'abnormal', 'page', 'field_id', 'quote', 'bounding_box'];
// The LAB| text-fixture format carries no per-field confidence at all — a
// line either parses completely or the whole record is rejected — so there
// is no real extractor confidence to report. This constant makes that an
// explicit, documented fixture value rather than a silently invented `1`.
const TEXT_FIXTURE_CONFIDENCE = 1;

function issue(code, detail = '') { return detail ? `${code}:${detail}` : code; }

function parseBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function parseRecord(line, sourceDocumentId) {
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
      citation: { source_type: 'document', source_id: sourceDocumentId, page_or_section: formatPageOrSection(page), field_or_chunk_id: values.field_id, quote_or_value: values.quote, bounding_box: boundingBox },
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
    const parsed = parseRecord(candidate.line, sourceDocumentId);
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
  // Every LAB| record already carries every LabResult field, so a strict
  // typed view can be built directly alongside the legacy `facts` shape
  // that observation persistence and the UI still consume.
  const labResults = [];
  const allIssues = [...issues];
  for (const fact of uniqueFacts) {
    const parsed = parseOrIssues(LabResult, { test_name: fact.test, value: fact.value, unit: fact.unit, reference_range: fact.reference_range, collection_date: fact.collection_date, abnormal_flag: fact.abnormal ? 'abnormal' : 'normal', confidence: TEXT_FIXTURE_CONFIDENCE, citation: fact.citation });
    if (parsed.ok) labResults.push(parsed.data);
    else allIssues.push(...parsed.issues.map((value) => issue('typed_lab_result_invalid', value)));
  }
  return { status: issues.length ? 'qualified' : 'complete', facts: uniqueFacts, lab_results: labResults, issues: [...new Set(allIssues)] };
}
