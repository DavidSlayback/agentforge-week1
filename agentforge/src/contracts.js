import crypto from 'node:crypto';

/** Versioned request/response wire-shape authority; not an access grant. */
export const CONTRACT_VERSION = '0.1';
const correlationSecret = process.env.AGENTFORGE_DEMO_SECRET || crypto.randomBytes(32);
export const COVERAGE_STATUSES = new Set(['success', 'empty', 'failed', 'timeout', 'unauthorized', 'not_requested']);
export const COVERAGE_FAILURE_STATUSES = new Set(['failed', 'timeout', 'unauthorized']);
export const COVERAGE_UNAVAILABLE_STATUSES = new Set([...COVERAGE_FAILURE_STATUSES, 'not_requested']);
export const DISPOSITIONS = new Set(['complete', 'partial', 'qualified', 'blocked', 'deadline-exceeded']);
/** Groups required before a return-visit response may claim completeness. */
export const COMPLETE_COVERAGE_GROUPS = Object.freeze(['identity', 'encounters', 'problems', 'medications', 'notes']);
/** Additional primary-provider attempts after the initial attempt. */
export const MAX_RETRIES = 2;
/** The only chart operation the service may report or execute. */
export const ALLOWED_READ_OPERATIONS = Object.freeze(['retrieve_openemr_read']);

export const isAllowedReadOperation = (operation) => ALLOWED_READ_OPERATIONS.includes(operation);

/** Map a claim field to the retrieval group that must have supplied it. */
export function coverageGroupForField(field) {
  const root = String(field || '').split('.')[0];
  return { encounter: 'encounters', medication: 'medications', problem: 'problems', allergy: 'allergies', note: 'notes', identity: 'identity' }[root] || root;
}

// Allowlists define wire shape only; they grant neither patient access nor
// clinical correctness.
export const API_CONTRACTS = Object.freeze({
  prepareRequest: { required: ['patient_uuid', 'clinician_uuid'], optional: ['case_id', 'correlation_id', 'demo_token'], allowed: ['patient_uuid', 'clinician_uuid', 'case_id', 'correlation_id', 'demo_token'] },
  followUpRequest: { required: ['patient_uuid', 'message', 'clinician_uuid'], optional: ['demo_token'], allowed: ['patient_uuid', 'message', 'clinician_uuid', 'demo_token'] },
  briefingResponse: { required: ['contract_version', 'correlation_id', 'disposition', 'patient', 'claims', 'withheld_fields', 'coverage', 'qualification', 'verification', 'operations'], allowed: ['contract_version', 'correlation_id', 'context', 'disposition', 'patient', 'claims', 'withheld_fields', 'coverage', 'qualification', 'operations', 'verification', 'text', 'model', 'deadline'] },
  followUpResponse: { required: ['contract_version', 'correlation_id', 'patient', 'verification'], allowed: ['contract_version', 'correlation_id', 'context', 'disposition', 'patient', 'claims', 'withheld_fields', 'coverage', 'text', 'evidence', 'qualification', 'operations', 'verification', 'deadline'] },
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const typeIssue = (issues, value, field, type) => { if (typeof value[field] !== type) issues.push(`${field}_must_be_${type}`); };
const nonEmptyString = (issues, value, field) => {
  if (typeof value[field] !== 'string') issues.push(`${field}_must_be_string`);
  else if (!value[field].trim()) issues.push(`${field}_must_be_non_empty_string`);
};
const unknownFields = (issues, value, allowed) => { for (const field of Object.keys(value)) if (!allowed.includes(field)) issues.push(`${field}_is_not_in_contract`); };
const requiredFields = (issues, value, fields) => { for (const field of fields) if (!(field in value)) issues.push(`${field}_is_required`); };

function validateEvidence(value, issues, path) {
  if (!isRecord(value)) {
    issues.push(`${path}_must_be_object`);
    return;
  }
  for (const field of ['patient_ref', 'source_ref']) nonEmptyString(issues, value, field);
  for (const field of ['record_type', 'excerpt']) if (field in value && typeof value[field] !== 'string') issues.push(`${path}.${field}_must_be_string`);
}

function validateClaims(value, issues) {
  if (!Array.isArray(value)) {
    issues.push('claims_must_be_array');
    return;
  }
  value.forEach((claim, index) => {
    const path = `claims[${index}]`;
    if (!isRecord(claim)) {
      issues.push(`${path}_must_be_object`);
      return;
    }
    unknownFields(issues, claim, ['field', 'value', 'patient_ref', 'source_ref', 'evidence', 'reassessment_documented']);
    for (const field of ['field', 'patient_ref', 'source_ref']) nonEmptyString(issues, claim, field);
    if (!Array.isArray(claim.evidence) || !claim.evidence.length) issues.push(`${path}.evidence_must_be_non_empty_array`);
    else claim.evidence.forEach((item, evidenceIndex) => validateEvidence(item, issues, `${path}.evidence[${evidenceIndex}]`));
    if ('reassessment_documented' in claim && typeof claim.reassessment_documented !== 'boolean') issues.push(`${path}.reassessment_documented_must_be_boolean`);
  });
}

function validateCoverage(value, issues) {
  if (!Array.isArray(value)) {
    issues.push('coverage_must_be_array');
    return;
  }
  value.forEach((group, index) => {
    const path = `coverage[${index}]`;
    if (!isRecord(group)) {
      issues.push(`${path}_must_be_object`);
      return;
    }
    unknownFields(issues, group, ['group', 'status', 'records', 'attempts', 'error_class']);
    nonEmptyString(issues, group, 'group');
    if (!COVERAGE_STATUSES.has(group.status)) issues.push(`${path}.invalid_status`);
    if (!Number.isInteger(group.records) || group.records < 0) issues.push(`${path}.records_must_be_non_negative_integer`);
    if (!Number.isInteger(group.attempts) || group.attempts < 1) issues.push(`${path}.attempts_must_be_positive_integer`);
    if (!(group.error_class === null || typeof group.error_class === 'string')) issues.push(`${path}.error_class_must_be_string_or_null`);
    if (['empty', 'failed', 'timeout', 'unauthorized', 'not_requested'].includes(group.status) && group.records !== 0) issues.push(`${path}.unavailable_group_must_have_zero_records`);
  });
}

function validateClaimsAgainstCoverage(claims, coverage, issues) {
  if (!Array.isArray(claims) || !Array.isArray(coverage)) return;
  const groups = new Map(coverage.filter(isRecord).map((group) => [group.group, group]));
  claims.forEach((claim, index) => {
    if (!isRecord(claim) || typeof claim.field !== 'string') return;
    const group = groups.get(coverageGroupForField(claim.field));
    if (!group) issues.push(`claims[${index}].coverage_group_missing`);
    else if (group.status !== 'success' || group.records < 1) issues.push(`claims[${index}].coverage_unavailable`);
  });
}

function validateCoverageDisposition(value, issues) {
  if (!Array.isArray(value.coverage)) return;
  const blocking = value.coverage.some((group) => isRecord(group) && COVERAGE_UNAVAILABLE_STATUSES.has(group.status));
  if (blocking && !value.qualification?.required) issues.push('coverage_requires_qualification');
  if (blocking && value.disposition === 'complete') issues.push('complete_response_has_unavailable_coverage');
  if (value.disposition === 'complete') {
    const present = new Set(value.coverage.filter(isRecord).map((group) => group.group));
    for (const group of COMPLETE_COVERAGE_GROUPS) if (!present.has(group)) issues.push(`complete_response_missing_${group}_coverage`);
  }
}

function validateQualification(value, issues) {
  if (!isRecord(value)) {
    issues.push('qualification_must_be_object');
    return;
  }
  if (typeof value.required !== 'boolean') issues.push('qualification.required_must_be_boolean');
  if (!Array.isArray(value.reasons) || value.reasons.some((reason) => typeof reason !== 'string')) issues.push('qualification.reasons_must_be_string_array');
}

function validateOperations(value, issues) {
  if (!Array.isArray(value)) {
    issues.push('operations_must_be_array');
    return;
  }
  value.forEach((operation, index) => {
    const path = `operations[${index}]`;
    if (!isRecord(operation)) {
      issues.push(`${path}_must_be_object`);
      return;
    }
    unknownFields(issues, operation, ['type', 'operation']);
    if (operation.type !== 'read') issues.push(`${path}.must_be_read_only`);
    nonEmptyString(issues, operation, 'operation');
    if (!isAllowedReadOperation(operation.operation)) issues.push(`${path}.operation_not_allowed`);
  });
}

function validateVerification(value, issues) {
  if (!isRecord(value)) {
    issues.push('verification_must_be_object');
    return;
  }
  if (!new Set(['passed', 'failed', 'blocked']).has(value.status)) issues.push('verification.invalid_status');
  if ('issues' in value && (!Array.isArray(value.issues) || value.issues.some((issue) => typeof issue !== 'string'))) issues.push('verification.issues_must_be_string_array');
}

export function validatePrepareRequest(value) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['request_must_be_object'] };
  unknownFields(issues, value, API_CONTRACTS.prepareRequest.allowed);
  requiredFields(issues, value, API_CONTRACTS.prepareRequest.required);
  for (const field of ['patient_uuid', 'clinician_uuid']) if (field in value) nonEmptyString(issues, value, field);
  for (const field of ['case_id', 'correlation_id', 'demo_token']) if (field in value && typeof value[field] !== 'string') issues.push(`${field}_must_be_string`);
  return { valid: issues.length === 0, issues };
}

export function validateFollowUpRequest(value) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['request_must_be_object'] };
  unknownFields(issues, value, API_CONTRACTS.followUpRequest.allowed);
  requiredFields(issues, value, API_CONTRACTS.followUpRequest.required);
  for (const field of ['patient_uuid', 'message', 'clinician_uuid']) if (field in value) typeIssue(issues, value, field, 'string');
  if ('demo_token' in value && typeof value.demo_token !== 'string') issues.push('demo_token_must_be_string');
  return { valid: issues.length === 0, issues };
}

function validateCommonResponse(value, required, allowed) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: ['response_must_be_object'] };
  unknownFields(issues, value, allowed);
  for (const field of required) if (!(field in value)) issues.push(`${field}_is_required`);
  if (value.contract_version !== CONTRACT_VERSION) issues.push('unsupported_contract_version');
  if (typeof value.correlation_id !== 'string' || !value.correlation_id.trim()) issues.push('correlation_id_must_be_non_empty_string');
  if ('patient' in value && value.patient !== null && !isRecord(value.patient)) issues.push('patient_must_be_object_or_null');
  if ('claims' in value) validateClaims(value.claims, issues);
  if ('withheld_fields' in value && !Array.isArray(value.withheld_fields)) issues.push('withheld_fields_must_be_array');
  if ('coverage' in value) validateCoverage(value.coverage, issues);
  if ('claims' in value && 'coverage' in value) validateClaimsAgainstCoverage(value.claims, value.coverage, issues);
  if ('qualification' in value) validateQualification(value.qualification, issues);
  if ('operations' in value) validateOperations(value.operations, issues);
  validateVerification(value.verification, issues);
  return { valid: issues.length === 0, issues };
}

export function validateBriefingResponse(value) {
  const result = validateCommonResponse(value, API_CONTRACTS.briefingResponse.required, API_CONTRACTS.briefingResponse.allowed);
  if (!result.valid) return result;
  if (!DISPOSITIONS.has(value.disposition)) result.issues.push('invalid_disposition');
  validateCoverageDisposition(value, result.issues);
  if (!['blocked', 'deadline-exceeded'].includes(value.disposition) && typeof value.text !== 'string') result.issues.push('text_is_required_for_success');
  if (['blocked', 'deadline-exceeded'].includes(value.disposition)) {
    if (value.patient !== null || value.claims.length || ('text' in value) || ('model' in value)) result.issues.push('blocked_response_must_withhold_content');
  }
  return { valid: result.issues.length === 0, issues: result.issues };
}

export function validateFollowUpResponse(value) {
  const result = validateCommonResponse(value, API_CONTRACTS.followUpResponse.required, API_CONTRACTS.followUpResponse.allowed);
  if (!result.valid) return result;
  if (!DISPOSITIONS.has(value.disposition)) result.issues.push('invalid_disposition');
  validateCoverageDisposition(value, result.issues);
  if (!['blocked', 'deadline-exceeded'].includes(value.disposition) && typeof value.text !== 'string') result.issues.push('text_is_required_for_success');
  if (!['blocked', 'deadline-exceeded'].includes(value.disposition) && !Array.isArray(value.evidence)) result.issues.push('evidence_is_required_for_success');
  if (['blocked', 'deadline-exceeded'].includes(value.disposition)) {
    if (value.patient !== null || value.claims?.length || ('text' in value) || ('evidence' in value)) result.issues.push('blocked_response_must_withhold_content');
  }
  return { valid: result.issues.length === 0, issues: result.issues };
}

export const isCoverageFailure = (status) => COVERAGE_FAILURE_STATUSES.has(status);
export const isCoverageUnavailable = (status) => COVERAGE_UNAVAILABLE_STATUSES.has(status);

export function correlationId(value) {
  if (!value) return `af-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  if (/^af-[0-9a-f]{32}$/.test(String(value))) return String(value);
  // The response/cache identifier is also allowed to cross the trace boundary;
  // make it opaque even when a caller supplies a patient-like string.
  return `af-${crypto.createHmac('sha256', correlationSecret).update(String(value)).digest('hex').slice(0, 32)}`;
}

/** Build a response that withholds claims and operations after a safety stop. */
export function blockedResult(correlation_id, reason, disposition = 'blocked') {
  return { contract_version: CONTRACT_VERSION, correlation_id, disposition, patient: null,
    claims: [], withheld_fields: [], coverage: [], qualification: { required: true, reasons: [reason] },
    verification: { status: 'blocked' }, operations: [] };
}
