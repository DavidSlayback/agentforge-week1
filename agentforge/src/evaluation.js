export const W2_EVAL_LABELS = Object.freeze(['extraction', 'retrieval', 'citation', 'refusal', 'missing-data', 'follow-up']);

export function evaluateEvidenceCase({ id, label, result, expected }) {
  const issues = [];
  if (!id || !W2_EVAL_LABELS.includes(label)) issues.push('invalid_case_label');
  if (!result || typeof result !== 'object') issues.push('result_missing');
  if (expected?.must_be_qualified && result?.qualification?.required !== true) issues.push('expected_qualified');
  if (expected?.must_have_guideline && !(result?.guideline_evidence || []).length) issues.push('guideline_evidence_missing');
  if (expected?.must_refuse && !['blocked', 'qualified'].includes(result?.disposition || result?.readiness)) issues.push('expected_refusal');
  return { id, label, passed: issues.length === 0, issues };
}

export function runSyntheticEvidenceEval(cases) {
  const results = cases.map(evaluateEvidenceCase);
  return { schema_version: 'w2-eval-v1', synthetic_only: true, total_cases: results.length, passed_cases: results.filter((result) => result.passed).length, failed_cases: results.filter((result) => !result.passed).length, labels: [...W2_EVAL_LABELS], results };
}
