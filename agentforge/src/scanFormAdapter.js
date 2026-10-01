import { EXTRACTION_STATUSES, requiredScanFields, SCAN_FORM_CONTRACT_VERSION, validateScanExtraction, validateScanInput } from './scanFormContracts.js';
import { formatPageOrSection } from './sourceEvidenceParsing.js';
import { buildTypedIntakeForm, buildTypedLabResults, buildTypedMedicationList } from './typedExtraction.js';
import { ScanExtractionMetadata, parseOrIssues } from './schemas.js';

const parseAttributes = (line) => Object.fromEntries(line.split('|').slice(1).map((part) => {
  const separator = part.indexOf('=');
  return separator < 0 ? [part.trim(), ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
}));

const parseBox = (value) => {
  const box = String(value || '').split(',').map(Number);
  return box.length === 4 && box.every((item) => Number.isFinite(item) && item >= 0) ? box : null;
};

const parsePageSizes = (value) => String(value || '').split(',').filter(Boolean).flatMap((entry) => {
  const match = entry.match(/^(\d+):(\d+)x(\d+)$/);
  return match ? [{ page: Number(match[1]), width: Number(match[2]), height: Number(match[3]) }] : [];
});

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
  const headerAttributes = parseAttributes(header);
  const pageSizes = parsePageSizes(headerAttributes.page_sizes);
  const declaredPageSizeCount = headerAttributes.page_sizes?.split(',').length || 0;
  if (headerAttributes.page_sizes && pageSizes.length !== declaredPageSizeCount) issues.push('page_sizes_invalid');
  return { header: headerAttributes, pageSizes, fields, missing, unreadable, issues };
}

function citationFor(sourceDocumentId, layoutId, field) {
  const quote = field.quote || [field.label, field.value, field.unit, field.reference_range].filter(Boolean).join(': ');
  return { source_type: 'document', source_id: sourceDocumentId, page_or_section: formatPageOrSection(field.page, field.section), field_or_chunk_id: field.field_id, quote_or_value: quote, bounding_box: field.bounding_box, coordinate_space: layoutId.startsWith('pdf-ocr-') ? 'raster_pixels_200dpi' : 'fixture_coordinates' };
}

/**
 * Label for an extraction parsed straight from a tagged-field envelope (an
 * uploaded `.scan.txt` file or a synthetic fixture). No OCR or vision model
 * ran: the values, confidences and boxes are the ones the envelope declares.
 * The PDF lane replaces this with the OCR engine or model that produced its
 * envelope (`service.js`).
 */
export const TAGGED_ENVELOPE_PROVIDER = 'uploaded-tagged-envelope';

/**
 * Provider-neutral local scan-form extraction seam.
 *
 * This adapter validates a normalized tagged-field envelope. The PDF lane
 * prepares that envelope with local OCR before calling this parser. The parser
 * itself performs no OCR and makes no model-accuracy claim.
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
  // A field printed with two different values stays conflicted however many
  // more copies follow: "11.2, 13.9, 11.2" is a conflict, not a vote, so a
  // later copy never re-admits the field as a fact.
  const conflictByField = new Map();
  for (const field of parsed.fields) {
    if (!field.field_id || !field.value || !Number.isInteger(field.page) || !field.bounding_box || !Number.isFinite(field.confidence)) {
      issues.push(issue('invalid_field_row', field.field_id || 'unknown'));
      continue;
    }
    const conflicted = conflictByField.get(field.field_id);
    if (conflicted) {
      if (!conflicted.values.includes(field.value)) conflicted.values.push(field.value);
      conflicted.citations.push(citationFor(sourceDocumentId, parsed.header.layout, field));
      continue;
    }
    const previous = byField.get(field.field_id);
    if (previous && previous.value !== field.value) {
      const conflict = { field_id: field.field_id, values: [previous.value, field.value], citations: [previous.citation, citationFor(sourceDocumentId, parsed.header.layout, field)] };
      conflicts.push(conflict);
      conflictByField.set(field.field_id, conflict);
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
  let status = conflicts.length || unreadableFields.length || (!facts.length && missingFields.length) ? 'qualified' : missingFields.length ? 'partial' : 'complete';
  // The strict typed view (LabResult[]/IntakeForm/MedicationList) is built ALONGSIDE the
  // untyped `facts` list rather than replacing it: `facts` still backs
  // observation persistence and the source-preview UI, while the typed
  // view is what a caller should validate a clinical claim against.
  const typedIssues = [];
  let labResults = [];
  let intakeForm = null;
  let medicationList = null;
  if (documentType === 'lab_pdf') {
    const typed = buildTypedLabResults(facts);
    labResults = typed.results;
    typedIssues.push(...typed.issues);
  } else if (documentType === 'intake_form') {
    const typed = buildTypedIntakeForm(facts);
    intakeForm = typed.ok ? typed.data : null;
    typedIssues.push(...typed.issues);
  } else if (documentType === 'medication_list') {
    const typed = buildTypedMedicationList(facts);
    medicationList = typed.ok ? typed.data : null;
    typedIssues.push(...typed.issues);
  }
  // A "complete" status must mean the typed contract actually came out
  // clean, not just that the untyped facts list looked fine — otherwise a
  // caller could see readiness "READY" backed by an empty or contradicted
  // typed view. Only `complete` is downgraded here: `partial`/`qualified`
  // already signal a degraded extraction through the untyped-fact checks.
  if (status === 'complete' && typedIssues.length) status = 'qualified';
  const pageMetadata = parsed.pageSizes.length ? { page_sizes: parsed.pageSizes } : {};
  const result = { contract_version: SCAN_FORM_CONTRACT_VERSION, provider: TAGGED_ENVELOPE_PROVIDER, status, facts, missing_fields: missingFields, uncertain_fields: uncertainFields, conflicts, issues: [...new Set(issues)], ...pageMetadata, lab_results: labResults, intake_form: intakeForm, medication_list: medicationList, typed_issues: [...new Set(typedIssues)], metrics: { pages: pageCount, candidate_fields: parsed.fields.length, accepted_fields: facts.length, duration_ms: Number((performance.now() - started).toFixed(3)) }, synthetic_only: true };
  const validation = validateScanExtraction(result, { sourceDocumentId, documentType, layoutId });
  return validation.valid ? result : blockedResult([...result.issues, ...validation.issues]);
}

function blockedResult(issues) {
  return { contract_version: SCAN_FORM_CONTRACT_VERSION, provider: TAGGED_ENVELOPE_PROVIDER, status: EXTRACTION_STATUSES[3], facts: [], missing_fields: [], uncertain_fields: [], conflicts: [], issues: [...new Set(issues)], lab_results: [], intake_form: null, medication_list: null, typed_issues: [], metrics: { pages: 0, candidate_fields: 0, accepted_fields: 0, duration_ms: 0 }, synthetic_only: true };
}
