export function verify({ patientRef, claims, coverage, qualification, operations }) {
  const issues = [];
  if (claims.some((claim) => claim.patient_ref !== patientRef || !claim.source_ref)) issues.push('UNSUPPORTED_CLAIM');
  if (operations.some((operation) => operation.type !== 'read')) issues.push('WRITE_CAPABLE_BEHAVIOR');
  if (coverage.some((item) => ['failed', 'timeout', 'unauthorized'].includes(item.status)) && !qualification.required) issues.push('UNQUALIFIED_PARTIAL_RESULT');
  return { status: issues.length ? 'failed' : 'passed', issues, evidence_grounding: issues.includes('UNSUPPORTED_CLAIM') ? 'failed' : 'passed', patient_scope: claims.every((claim) => claim.patient_ref === patientRef) ? 'passed' : 'failed', read_only: issues.includes('WRITE_CAPABLE_BEHAVIOR') ? 'failed' : 'passed' };
}
