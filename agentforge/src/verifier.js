export function verify({ patientRef, claims, coverage, qualification, operations }) {
  const issues = [];
  if (claims.some((claim) => claim.patient_ref !== patientRef || !claim.source_ref)) issues.push('UNSUPPORTED_CLAIM');
  if (operations.some((operation) => operation.type !== 'read')) issues.push('WRITE_CAPABLE_BEHAVIOR');
  if (coverage.some((item) => ['failed', 'timeout', 'unauthorized'].includes(item.status)) && !qualification.required) issues.push('UNQUALIFIED_PARTIAL_RESULT');
  return { status: issues.length ? 'failed' : 'passed', issues, evidence_grounding: issues.includes('UNSUPPORTED_CLAIM') ? 'failed' : 'passed', patient_scope: claims.every((claim) => claim.patient_ref === patientRef) ? 'passed' : 'failed', read_only: issues.includes('WRITE_CAPABLE_BEHAVIOR') ? 'failed' : 'passed' };
}

export function verifyGeneratedText({ text, claims }) {
  const issues = [];
  if (typeof text !== 'string' || !text.trim()) issues.push('EMPTY_MODEL_OUTPUT');
  if (typeof text === 'string' && text.length > 2000) issues.push('MODEL_OUTPUT_TOO_LONG');
  if (typeof text === 'string' && /\b(diagnos|recommend|prescrib|start|stop|increase|decrease|order|treat|urgent)\w*/i.test(text)) issues.push('UNSAFE_CLINICAL_ACTION_LANGUAGE');
  const anchored = (claims || []).some((claim) => text.includes(claim.field) && text.includes(String(claim.value)));
  if ((claims || []).length && !anchored) issues.push('OUTPUT_NOT_EVIDENCE_ANCHORED');
  return { status: issues.length ? 'failed' : 'passed', issues, evidence_grounding: issues.includes('OUTPUT_NOT_EVIDENCE_ANCHORED') ? 'failed' : 'passed', read_only: issues.includes('UNSAFE_CLINICAL_ACTION_LANGUAGE') ? 'failed' : 'passed' };
}
