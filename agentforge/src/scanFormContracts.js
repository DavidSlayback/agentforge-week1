import { Citation, IntakeForm, LabResult, MedicationList, ScanExtractionMetadata, parseOrIssues } from './schemas.js';

export const SCAN_FORM_CONTRACT_VERSION = 'w2-scan-v1';
export const SCAN_DOCUMENT_TYPES = Object.freeze(['lab_pdf', 'intake_form', 'medication_list']);
export const EXTRACTION_STATUSES = Object.freeze(['complete', 'partial', 'qualified', 'blocked']);
export const FIELD_DISPOSITIONS = Object.freeze(['observed', 'missing', 'unreadable', 'conflicting']);
export const SCAN_SOURCE_CLASSES = Object.freeze(['synthetic_fixture', 'public_blank']);

export const REQUIRED_SCAN_FIELDS = Object.freeze({
  lab_pdf: Object.freeze(['lab.hgb', 'lab.a1c']),
  intake_form: Object.freeze(['chief_concern', 'medication.metformin', 'allergy.penicillin']),
  // A medication list must show its date and at least one fully read row.
  medication_list: Object.freeze(['medlist.list_date', 'medication.1.name', 'medication.1.dose', 'medication.1.unit', 'medication.1.frequency', 'medication.1.route']),
});

export const PDF_SCAN_FIELDS = Object.freeze({
  lab_pdf: Object.freeze(['lab.hgb.test_name', 'lab.hgb.value', 'lab.hgb.unit', 'lab.hgb.reference_range', 'lab.hgb.collection_date', 'lab.hgb.abnormal', 'lab.a1c.test_name', 'lab.a1c.value', 'lab.a1c.unit', 'lab.a1c.reference_range', 'lab.a1c.collection_date', 'lab.a1c.abnormal']),
  intake_form: Object.freeze(['patient.name', 'patient.date_of_birth', 'patient.phone', 'chief_concern', 'medications', 'allergies', 'family_history']),
  medication_list: REQUIRED_SCAN_FIELDS.medication_list,
});

/**
 * Fields a medication list may carry beyond its required ones: the optional
 * prescriber/source, the printed patient identity, and every part of any row
 * (`medication.<n>.<part>`, n = 1..99). Only row 1 is required, because a
 * list may hold any number of rows.
 */
const MEDICATION_LIST_OPTIONAL_FIELDS = new Set(['medlist.prescriber_or_source', 'patient.name', 'patient.date_of_birth']);
export const MEDICATION_ROW_FIELD = /^medication\.([1-9][0-9]?)\.(name|dose|unit|frequency|route)$/;

export const EXTERNAL_FORM_FIELDS = Object.freeze({
  'external-lab-hawaii': Object.freeze(['submitter.name', 'submitter.organization', 'patient.patient_id', 'patient.name', 'patient.date_of_birth', 'specimen.specimen_id', 'specimen.date_collected', 'specimen.source', 'specimen.description', 'specimen.analysis_requested']),
  'external-lab-maine': Object.freeze(['patient.name', 'patient.date_of_birth', 'patient.address', 'patient.gender', 'patient.race_ethnicity', 'patient.pregnant', 'provider.name', 'provider.phone', 'clinical.symptom_onset_date', 'specimen.acute_serum', 'specimen.convalescent_serum', 'specimen.csf', 'specimen.urine']),
  'external-intake-broom-road': Object.freeze(['patient.surname', 'patient.forenames', 'patient.nhs_number', 'patient.date_of_birth', 'patient.address', 'patient.telephone_home', 'patient.email', 'patient.next_of_kin', 'medical.illnesses', 'medications', 'allergies', 'family_history', 'vaccination.flu', 'signature']),
  'external-intake-erskine': Object.freeze(['patient.title', 'patient.surname', 'patient.date_of_birth', 'patient.forenames', 'patient.address', 'patient.post_code', 'patient.home_telephone', 'patient.mobile', 'medical.previous_history', 'medical.present_problems', 'medications', 'allergies', 'family_history', 'lifestyle.smoking', 'women.cervical_smear', 'women.mammogram']),
});

export function requiredScanFields({ documentType, layoutId } = {}) {
  if (layoutId === `pdf-ocr-${documentType}`) return PDF_SCAN_FIELDS[documentType] || [];
  return EXTERNAL_FORM_FIELDS[layoutId] || REQUIRED_SCAN_FIELDS[documentType] || [];
}

/** Whether `fieldId` may appear in an extraction of this document type and layout. */
export function allowedScanField({ documentType, layoutId, fieldId } = {}) {
  if (requiredScanFields({ documentType, layoutId }).includes(fieldId)) return true;
  if (documentType !== 'medication_list') return false;
  return MEDICATION_LIST_OPTIONAL_FIELDS.has(fieldId) || MEDICATION_ROW_FIELD.test(String(fieldId || ''));
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

export function validateScanInput(value) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['scan_input_must_be_object'] };
  if (value.contract_version !== SCAN_FORM_CONTRACT_VERSION) issues.push('scan_input_contract_version_invalid');
  if (!nonEmpty(value.source_document_id)) issues.push('source_document_id_required');
  if (!SCAN_DOCUMENT_TYPES.includes(value.document_type)) issues.push('document_type_invalid');
  if (!nonEmpty(value.layout_id)) issues.push('layout_id_required');
  if (!Number.isInteger(value.page_count) || value.page_count < 1) issues.push('page_count_invalid');
  if (!Buffer.isBuffer(value.content) || value.content.length === 0) issues.push('content_required');
  if (value.synthetic_only === true) {
    if (value.source_class && value.source_class !== 'synthetic_fixture') issues.push('synthetic_source_class_invalid');
  } else if (value.synthetic_only === false) {
    if (value.source_class !== 'public_blank') issues.push('public_blank_source_class_required');
    if (value.processing_mode !== 'local_only') issues.push('local_only_processing_required');
  } else {
    issues.push('synthetic_only_boolean_required');
  }
  return { valid: issues.length === 0, issues };
}

/** Validate a document citation against the strict W2 `Citation` Zod schema (`schemas.js`), the source of truth for the five-key citation contract. */
export function validateCitation(value, { sourceDocumentId = null } = {}) {
  const parsed = parseOrIssues(Citation, value);
  const issues = parsed.issues.map((issue) => `citation_${issue}`);
  if (sourceDocumentId && parsed.ok && parsed.data.source_id !== sourceDocumentId) issues.push('citation_source_document_mismatch');
  return { valid: issues.length === 0, issues };
}

export function validateExtractedField(value, { sourceDocumentId = null } = {}) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['field_must_be_object'] };
  if (!nonEmpty(value.field_id)) issues.push('field_id_required');
  if (!nonEmpty(value.value)) issues.push('value_required');
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) issues.push('confidence_invalid');
  if (value.disposition !== 'observed') issues.push('observed_field_disposition_required');
  const citation = validateCitation(value.citation, { sourceDocumentId });
  issues.push(...citation.issues);
  if (value.uncertainty !== null && !nonEmpty(value.uncertainty)) issues.push('uncertainty_must_be_null_or_string');
  return { valid: issues.length === 0, issues };
}

export function validateScanExtraction(value, { sourceDocumentId = null, documentType = null, layoutId = null } = {}) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['extraction_must_be_object'] };
  if (value.contract_version !== SCAN_FORM_CONTRACT_VERSION) issues.push('extraction_contract_version_invalid');
  if (!nonEmpty(value.provider)) issues.push('provider_required');
  if (!EXTRACTION_STATUSES.includes(value.status)) issues.push('extraction_status_invalid');
  for (const field of ['facts', 'missing_fields', 'uncertain_fields', 'conflicts', 'issues']) if (!Array.isArray(value[field])) issues.push(`${field}_must_be_array`);
  if ('page_sizes' in value) issues.push(...parseOrIssues(ScanExtractionMetadata, { page_sizes: value.page_sizes }).issues.map((issue) => `page_sizes_${issue}`));
  if (Array.isArray(value.facts)) value.facts.forEach((fact) => issues.push(...validateExtractedField(fact, { sourceDocumentId }).issues));
  if (documentType && Array.isArray(value.facts)) {
    value.facts.forEach((fact) => { if (!allowedScanField({ documentType, layoutId, fieldId: fact.field_id })) issues.push(`unexpected_field:${fact.field_id}`); });
  }
  if (!isRecord(value.metrics)) issues.push('metrics_must_be_object');
  else for (const field of ['pages', 'candidate_fields', 'accepted_fields', 'duration_ms']) if (!Number.isFinite(value.metrics[field]) || value.metrics[field] < 0) issues.push(`metrics_${field}_invalid`);
  // The typed view is the contract a caller should trust; validate it here
  // too so a bad `LabResult`/`IntakeForm` can never slip through a scan
  // extraction as "valid" just because the legacy untyped facts looked fine.
  if ('lab_results' in value) {
    if (!Array.isArray(value.lab_results)) issues.push('lab_results_must_be_array');
    else value.lab_results.forEach((result, index) => issues.push(...parseOrIssues(LabResult, result).issues.map((issue) => `lab_results[${index}].${issue}`)));
  }
  if ('intake_form' in value && value.intake_form !== null) issues.push(...parseOrIssues(IntakeForm, value.intake_form).issues.map((issue) => `intake_form.${issue}`));
  if ('medication_list' in value && value.medication_list !== null) issues.push(...parseOrIssues(MedicationList, value.medication_list).issues.map((issue) => `medication_list.${issue}`));
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function validateWorkerHandoff(value) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['handoff_must_be_object'] };
  if (value.contract_version !== SCAN_FORM_CONTRACT_VERSION) issues.push('handoff_contract_version_invalid');
  for (const field of ['worker', 'input_type', 'output_status']) if (!nonEmpty(value[field])) issues.push(`${field}_required`);
  if (!Array.isArray(value.steps) || value.steps.length < 3) issues.push('handoff_requires_three_steps');
  if (Array.isArray(value.steps)) value.steps.forEach((step) => { if (!isRecord(step) || !nonEmpty(step.name) || !nonEmpty(step.decision)) issues.push('handoff_step_invalid'); });
  if (!Number.isInteger(value.retry_count) || value.retry_count < 0) issues.push('retry_count_invalid');
  if (!Array.isArray(value.citations)) issues.push('handoff_citations_must_be_array');
  if (!isRecord(value.redacted_metrics)) issues.push('redacted_metrics_must_be_object');
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

// `message` is an optional clinician question (activeWorkers.js formulates
// the actual retrieval query from the document's own typed findings and
// appends this only as a refinement) — absent or an empty string are both
// valid; a non-string value is still rejected.
export function validateActiveSupervisorRequest(value) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['request_must_be_object'] };
  for (const field of ['patient_uuid', 'clinician_uuid', 'demo_token', 'source_document_id']) if (!nonEmpty(value[field])) issues.push(`${field}_required`);
  if ('message' in value && typeof value.message !== 'string') issues.push('message_must_be_string');
  const allowed = new Set(['patient_uuid', 'clinician_uuid', 'demo_token', 'source_document_id', 'message']);
  for (const field of Object.keys(value)) if (!allowed.has(field)) issues.push(`${field}_not_allowed`);
  return { valid: issues.length === 0, issues };
}
