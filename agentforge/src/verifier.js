import { COMPLETE_COVERAGE_GROUPS, COVERAGE_STATUSES, coverageGroupForField, isAllowedReadOperation, isCoverageUnavailable } from './contracts.js';

/** Verify patient scope, coverage qualification, and the read-only operation set. */
export function verify({ patientRef, claims = [], coverage = [], qualification = {}, operations = [], disposition = null }) {
  const issues = [];
  if (claims.some((claim) => claim.patient_ref !== patientRef || !claim.source_ref || !Array.isArray(claim.evidence) || claim.evidence.some((item) => item.patient_ref !== patientRef || !item.source_ref))) issues.push('UNSUPPORTED_CLAIM');
  if (operations.some((operation) => operation.type !== 'read' || !isAllowedReadOperation(operation.operation))) issues.push('WRITE_CAPABLE_BEHAVIOR');
  if (coverage.some((item) => !COVERAGE_STATUSES.has(item.status))) issues.push('INVALID_COVERAGE_STATUS');
  if (coverage.some((item) => isCoverageUnavailable(item.status)) && !qualification.required) issues.push('UNQUALIFIED_PARTIAL_RESULT');
  if (coverage.some((item) => ['empty', 'failed', 'timeout', 'unauthorized', 'not_requested'].includes(item.status) && item.records !== 0)) issues.push('UNAVAILABLE_COVERAGE_HAS_RECORDS');
  const groups = new Map(coverage.map((item) => [item.group, item]));
  if (claims.some((claim) => {
    const group = groups.get(coverageGroupForField(claim.field));
    return !group || group.status !== 'success' || group.records < 1;
  })) issues.push('CLAIM_COVERAGE_UNAVAILABLE');
  if (disposition === 'complete' && coverage.some((item) => isCoverageUnavailable(item.status))) issues.push('COMPLETE_WITH_UNAVAILABLE_COVERAGE');
  if (disposition === 'complete') {
    const present = new Set(coverage.map((item) => item.group));
    if (COMPLETE_COVERAGE_GROUPS.some((group) => !present.has(group))) issues.push('COMPLETE_COVERAGE_GROUP_MISSING');
  }
  return { status: issues.length ? 'failed' : 'passed', issues, evidence_grounding: issues.some((issue) => ['UNSUPPORTED_CLAIM', 'CLAIM_COVERAGE_UNAVAILABLE'].includes(issue)) ? 'failed' : 'passed', patient_scope: claims.every((claim) => claim.patient_ref === patientRef) ? 'passed' : 'failed', read_only: issues.includes('WRITE_CAPABLE_BEHAVIOR') ? 'failed' : 'passed' };
}

/** Reject model output that is empty, ungrounded, or clinically directive. */
export function verifyGeneratedText({ text, claims }) {
  const issues = [];
  if (typeof text !== 'string' || !text.trim()) issues.push('EMPTY_MODEL_OUTPUT');
  if (typeof text === 'string' && text.length > 2000) issues.push('MODEL_OUTPUT_TOO_LONG');
  if (typeof text === 'string' && /\b(diagnos|recommend|prescrib|start|stop|increase|decrease|order|treat|urgent)\w*/i.test(text)) issues.push('UNSAFE_CLINICAL_ACTION_LANGUAGE');
  const anchored = typeof text === 'string' && (claims || []).some((claim) => text.includes(claim.field) && text.includes(String(claim.value)));
  if ((claims || []).length && !anchored) issues.push('OUTPUT_NOT_EVIDENCE_ANCHORED');
  return { status: issues.length ? 'failed' : 'passed', issues, evidence_grounding: issues.includes('OUTPUT_NOT_EVIDENCE_ANCHORED') ? 'failed' : 'passed', read_only: issues.includes('UNSAFE_CLINICAL_ACTION_LANGUAGE') ? 'failed' : 'passed' };
}
