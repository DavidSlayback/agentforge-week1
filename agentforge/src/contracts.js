export const CONTRACT_VERSION = '0.1';
export const COVERAGE_STATUSES = new Set(['success', 'empty', 'failed', 'timeout', 'unauthorized', 'not_requested']);
export const MAX_RETRIES = 2;

export const API_CONTRACTS = Object.freeze({
  prepareRequest: { required: ['patient_uuid', 'clinician_uuid', 'authorization'], optional: ['case_id', 'correlation_id', 'demo_token'], allowed: ['patient_uuid', 'clinician_uuid', 'authorization', 'case_id', 'correlation_id', 'demo_token'] },
  followUpRequest: { required: ['patient_uuid', 'message', 'clinician_uuid', 'authorization'], optional: ['demo_token'], allowed: ['patient_uuid', 'message', 'clinician_uuid', 'authorization', 'demo_token'] },
  briefingResponse: { required: ['contract_version', 'correlation_id', 'disposition', 'patient', 'claims', 'withheld_fields', 'coverage', 'qualification', 'verification', 'operations'], allowed: ['contract_version', 'correlation_id', 'context', 'disposition', 'patient', 'claims', 'withheld_fields', 'coverage', 'qualification', 'operations', 'verification', 'text', 'model'] },
  followUpResponse: { required: ['contract_version', 'correlation_id', 'patient', 'verification'], allowed: ['contract_version', 'correlation_id', 'context', 'disposition', 'patient', 'claims', 'withheld_fields', 'coverage', 'text', 'evidence', 'qualification', 'operations', 'verification'] },
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const typeIssue = (issues, value, field, type) => { if (typeof value[field] !== type) issues.push(`${field}_must_be_${type}`); };
const unknownFields = (issues, value, allowed) => { for (const field of Object.keys(value)) if (!allowed.includes(field)) issues.push(`${field}_is_not_in_contract`); };

export function validatePrepareRequest(value) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['request_must_be_object'] };
  unknownFields(issues, value, API_CONTRACTS.prepareRequest.allowed);
  typeIssue(issues, value, 'patient_uuid', 'string');
  typeIssue(issues, value, 'clinician_uuid', 'string');
  if (!isRecord(value.authorization)) issues.push('authorization_must_be_object');
  else {
    typeIssue(issues, value.authorization, 'status', 'string');
    typeIssue(issues, value.authorization, 'scope', 'string');
  }
  if (isRecord(value.authorization)) unknownFields(issues, value.authorization, ['status', 'scope']);
  for (const field of ['case_id', 'correlation_id', 'demo_token']) if (field in value && typeof value[field] !== 'string') issues.push(`${field}_must_be_string`);
  return { valid: issues.length === 0, issues };
}

export function validateFollowUpRequest(value) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['request_must_be_object'] };
  unknownFields(issues, value, API_CONTRACTS.followUpRequest.allowed);
  for (const field of ['patient_uuid', 'message', 'clinician_uuid']) typeIssue(issues, value, field, 'string');
  if (!isRecord(value.authorization)) issues.push('authorization_must_be_object');
  else {
    typeIssue(issues, value.authorization, 'status', 'string');
    typeIssue(issues, value.authorization, 'scope', 'string');
  }
  if (isRecord(value.authorization)) unknownFields(issues, value.authorization, ['status', 'scope']);
  if ('demo_token' in value && typeof value.demo_token !== 'string') issues.push('demo_token_must_be_string');
  return { valid: issues.length === 0, issues };
}

function validateCommonResponse(value, required, allowed) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['response_must_be_object'] };
  unknownFields(issues, value, allowed);
  for (const field of required) if (!(field in value)) issues.push(`${field}_is_required`);
  if (value.contract_version !== CONTRACT_VERSION) issues.push('unsupported_contract_version');
  if (typeof value.correlation_id !== 'string' || !value.correlation_id) issues.push('correlation_id_must_be_non_empty_string');
  if ('patient' in value && value.patient !== null && !isRecord(value.patient)) issues.push('patient_must_be_object_or_null');
  if ('claims' in value && !Array.isArray(value.claims)) issues.push('claims_must_be_array');
  if ('withheld_fields' in value && !Array.isArray(value.withheld_fields)) issues.push('withheld_fields_must_be_array');
  if ('coverage' in value && !Array.isArray(value.coverage)) issues.push('coverage_must_be_array');
  if (!isRecord(value.verification)) issues.push('verification_must_be_object');
  return { valid: issues.length === 0, issues };
}

export function validateBriefingResponse(value) {
  const result = validateCommonResponse(value, API_CONTRACTS.briefingResponse.required, API_CONTRACTS.briefingResponse.allowed);
  if (!result.valid) return result;
  if (!new Set(['complete', 'partial', 'qualified', 'blocked']).has(value.disposition)) result.issues.push('invalid_disposition');
  return { valid: result.issues.length === 0, issues: result.issues };
}

export function validateFollowUpResponse(value) {
  const result = validateCommonResponse(value, API_CONTRACTS.followUpResponse.required, API_CONTRACTS.followUpResponse.allowed);
  if (!result.valid) return result;
  if (value.disposition !== 'blocked' && typeof value.text !== 'string') result.issues.push('text_is_required_for_success');
  if (value.disposition !== 'blocked' && !Array.isArray(value.evidence)) result.issues.push('evidence_is_required_for_success');
  return { valid: result.issues.length === 0, issues: result.issues };
}

export function correlationId(value) {
  return value || `af-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function blockedResult(correlation_id, reason) {
  return { contract_version: CONTRACT_VERSION, correlation_id, disposition: 'blocked', patient: null,
    claims: [], withheld_fields: [], coverage: [], qualification: { required: true, reasons: [reason] },
    verification: { status: 'blocked' }, operations: [] };
}
