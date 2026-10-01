import { fakePlantingComposer } from './critic.js';

/**
 * H5 gate integrity: the gate's independent claim judge (`gateClaimJudge.js`)
 * on the model answer path. A gate-only fake composer returns the
 * deterministic composer's claims plus one planted bad claim. The production
 * verifier (`claimBinding.js#verifyClaims`) must drop the planted claim, so
 * the answer ships the remaining claims from the model path. If the verifier
 * fails open, the planted claim ships and the judge, which shares no code with
 * the verifier, fails the case. `fc-08` in the 50-case gate plants an uncited
 * claim too, but there every model claim is dropped and the composer falls
 * back; these cases cover the path where a model answer actually ships.
 */
const UNCITED_TEXT = 'Hemoglobin 9.1 g/dL.';
// The cited value, unit and date are right; only the range low bound (9.1) is not in the cited source.
const WRONG_NUMBER_TEXT = 'Hemoglobin 11.9 g/dL on 2026-09-21 (reference 9.1-16.0).';

const modelAnswerIssues = (run, planted) => {
  const answer = run.result?.workflow?.answer;
  if (!answer) return ['answer_missing'];
  const issues = [];
  if (!String(answer.composer).startsWith('model')) issues.push(`composer_${answer.composer}_expected_model_path`);
  if (answer.unverified_dropped < 1) issues.push('planted_claim_not_dropped_and_counted');
  if ([...answer.patient_facts, ...answer.guideline_evidence].some((claim) => claim.text === planted)) issues.push('planted_claim_shipped');
  return issues;
};

export function claimJudgeCases({ kase, scan }) {
  const labCitation = (args) => args.verifiedLabResults.find((result) => result.test_name === 'Hemoglobin')?.citation;
  return [
    kase('xh5-judge-uncited-model-claim', 'citation_present', 'The claim verifier stops rejecting a model claim with no citation (UNCITED_CLAIM), so an uncited patient fact ships in a model-path answer; the gate\'s independent judge must catch it even though the production verifier passed it.',
      scan('lab-b', 'lab_pdf', { answer_provider: () => fakePlantingComposer(() => [{ kind: 'patient_fact', text: UNCITED_TEXT, citations: [] }]) }),
      { answer: { verified: true }, custom: (run) => modelAnswerIssues(run, UNCITED_TEXT) }),
    kase('xh5-judge-number-not-in-cited-source', 'factually_consistent', 'The claim verifier stops checking numbers against the cited value, so a model claim citing the real hemoglobin line but stating a number the source does not hold ships; the gate\'s independent judge must catch the number that is not in the cited source.',
      scan('lab-b', 'lab_pdf', { answer_provider: () => fakePlantingComposer((args) => (labCitation(args) ? [{ kind: 'patient_fact', text: WRONG_NUMBER_TEXT, citations: [labCitation(args)] }] : [])) }),
      { answer: { verified: true }, custom: (run) => modelAnswerIssues(run, WRONG_NUMBER_TEXT) }),
  ];
}
