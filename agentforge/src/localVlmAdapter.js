import { EXTRACTION_STATUSES, requiredScanFields, SCAN_FORM_CONTRACT_VERSION, validateScanExtraction, validateScanInput } from './scanFormContracts.js';
import { formatPageOrSection } from './sourceEvidenceParsing.js';

export const LOCAL_VLM_PROVIDER = 'local-vlm-adapter';

const issue = (code, detail = '') => detail ? `${code}:${detail}` : code;
const normalizeCitationText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function blockedResult({ sourceClass = 'public_blank', model = 'unconfigured', reason = 'local_vlm_runtime_not_configured' } = {}) {
  return {
    contract_version: SCAN_FORM_CONTRACT_VERSION,
    provider: LOCAL_VLM_PROVIDER,
    model,
    status: EXTRACTION_STATUSES[3],
    facts: [],
    missing_fields: [],
    uncertain_fields: [],
    conflicts: [],
    issues: [reason],
    metrics: { pages: 0, candidate_fields: 0, accepted_fields: 0, duration_ms: 0 },
    synthetic_only: false,
    source_class: sourceClass,
  };
}

function citationFor(sourceDocumentId, layoutId, field) {
  const quote = String(field.quote || [field.label, field.value, field.unit, field.reference_range].filter(Boolean).join(': ')).trim();
  return {
    source_type: 'document',
    source_id: sourceDocumentId,
    page_or_section: formatPageOrSection(field.page, field.section),
    field_or_chunk_id: field.field_id,
    quote_or_value: quote,
    bounding_box: field.bounding_box,
  };
}

function normalizeRunnerOutput(raw) {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { fields: [], missing: [], unreadable: [], conflicts: [], issues: ['local_vlm_response_invalid_json'] };
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { fields: [], missing: [], unreadable: [], conflicts: [], issues: ['local_vlm_output_must_be_object'] };
  return {
    fields: Array.isArray(raw.fields) ? raw.fields : [],
    missing: Array.isArray(raw.missing) ? raw.missing : [],
    unreadable: Array.isArray(raw.unreadable) ? raw.unreadable : [],
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
    issues: Array.isArray(raw.issues) ? raw.issues.filter((value) => typeof value === 'string') : [],
  };
}

/**
 * Local-only VLM extraction seam.
 *
 * `runModel` is deliberately injected: it is the boundary where a pinned local
 * runtime such as PaddleOCR-VL or another local vision-language runner plugs in.
 * The adapter owns input/data-class checks, normalization, citations, and the
 * fail-closed behavior when the runtime is absent or malformed.
 */
export function createLocalVlmAdapter({ runModel = null, model = 'unconfigured', modelRevision = 'unconfigured' } = {}) {
  return function extractWithLocalVlm({ sourceDocumentId, documentType, layoutId, pageCount = 1, content, sourceClass = 'public_blank', syntheticOnly = false, processingMode = 'local_only' }) {
    const input = {
      contract_version: SCAN_FORM_CONTRACT_VERSION,
      source_document_id: sourceDocumentId,
      document_type: documentType,
      layout_id: layoutId,
      page_count: pageCount,
      content,
      source_class: sourceClass,
      synthetic_only: syntheticOnly,
      processing_mode: processingMode,
    };
    const inputValidation = validateScanInput(input);
    if (!inputValidation.valid) return blockedResult({ sourceClass, model, reason: inputValidation.issues.join(',') });
    if (typeof runModel !== 'function') return blockedResult({ sourceClass, model });

    const started = performance.now();
    let raw;
    try {
      raw = runModel({ content, documentType, layoutId, pageCount, sourceDocumentId });
    } catch (error) {
      return blockedResult({ sourceClass, model, reason: issue('local_vlm_runtime_failed', error?.name || 'unknown_error') });
    }
    const parsed = normalizeRunnerOutput(raw);
    const expected = requiredScanFields({ documentType, layoutId });
    const issues = [...parsed.issues];
    const facts = [];
    const byField = new Map();
    const conflicts = [...parsed.conflicts];
    const uncertainFields = [];
    const conflictedFieldIds = new Set();

    for (const field of parsed.fields) {
      if (!field || typeof field !== 'object' || !field.field_id) {
        issues.push('invalid_local_vlm_field');
        continue;
      }
      if (!expected.includes(field.field_id)) {
        issues.push(issue('unexpected_field', field.field_id));
        continue;
      }
      if (typeof field.label !== 'string' || !field.label.trim() || !field.value || !Number.isInteger(field.page) || field.page < 1 || field.page > pageCount || !Array.isArray(field.bounding_box) || field.bounding_box.length !== 4 || !field.bounding_box.every((item) => Number.isFinite(item) && item >= 0) || !Number.isFinite(field.confidence)) {
        issues.push(issue('invalid_local_vlm_field', field.field_id));
        continue;
      }
      if (field.quote && (!normalizeCitationText(field.quote).includes(normalizeCitationText(field.label)) || !normalizeCitationText(field.quote).includes(normalizeCitationText(field.value)))) {
        issues.push(issue('citation_quote_missing_label_or_value', field.field_id));
        continue;
      }
      const citation = citationFor(sourceDocumentId, layoutId, field);
      if (conflictedFieldIds.has(field.field_id)) continue;
      const previous = byField.get(field.field_id);
      if (previous) {
        conflicts.push({ field_id: field.field_id, values: [previous.value, String(field.value)], citations: [previous.citation, citation] });
        byField.delete(field.field_id);
        conflictedFieldIds.add(field.field_id);
        continue;
      }
      const fact = { field_id: field.field_id, value: String(field.value), confidence: field.confidence, disposition: 'observed', citation, uncertainty: field.confidence < 0.85 ? 'low_confidence_requires_human_review' : null };
      byField.set(field.field_id, fact);
      if (fact.uncertainty) uncertainFields.push({ field_id: field.field_id, reason: fact.uncertainty });
    }
    for (const fact of byField.values()) facts.push(fact);
    const explicitMissing = new Map(parsed.missing.filter((item) => item?.field_id).map((item) => [item.field_id, item.reason || 'missing']));
    const explicitUnreadable = new Map(parsed.unreadable.filter((item) => item?.field_id).map((item) => [item.field_id, item.reason || 'unreadable']));
    const missingFields = expected.filter((fieldId) => !byField.has(fieldId) && !explicitUnreadable.has(fieldId)).map((fieldId) => ({ field_id: fieldId, reason: explicitMissing.get(fieldId) || 'not_observed' }));
    const unreadableFields = [...explicitUnreadable.entries()].map(([field_id, reason]) => ({ field_id, reason }));
    uncertainFields.push(...unreadableFields.map(({ field_id, reason }) => ({ field_id, reason: `unreadable:${reason}` })));
    if (conflicts.length) issues.push('conflicting_values_require_review');
    if (unreadableFields.length) issues.push('unreadable_fields_require_review');
    if (missingFields.length) issues.push('missing_fields_require_review');
    const status = conflicts.length || unreadableFields.length || issues.length || (!facts.length && missingFields.length) ? 'qualified' : missingFields.length ? 'partial' : 'complete';
    const result = {
      contract_version: SCAN_FORM_CONTRACT_VERSION,
      provider: LOCAL_VLM_PROVIDER,
      model,
      model_revision: modelRevision,
      status,
      facts,
      missing_fields: missingFields,
      uncertain_fields: uncertainFields,
      conflicts,
      issues: [...new Set(issues)],
      metrics: { pages: pageCount, candidate_fields: parsed.fields.length, accepted_fields: facts.length, duration_ms: Number((performance.now() - started).toFixed(3)) },
      synthetic_only: false,
      source_class: sourceClass,
    };
    const validation = validateScanExtraction(result, { sourceDocumentId, documentType, layoutId });
    return validation.valid ? result : blockedResult({ sourceClass, model, reason: [...result.issues, ...validation.issues].join(',') });
  };
}

export const extractWithLocalVlm = createLocalVlmAdapter();
