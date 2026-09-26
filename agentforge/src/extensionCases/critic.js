import { DeterministicAnswerComposer, labelForCitation } from '../answerComposer.js';
import { ResilientProvider } from '../modelProvider.js';
import { runScenario } from '../w2RegressionGate.js';

/**
 * X-2 critic agent (E2): extension-suite cases for the LLM critic that can
 * only veto claims (`critic.js`).
 *
 * These cases test the critic's wiring and its veto contract on the deployed
 * scan path, not the model's judgment. The critic model is replaced by
 * honestly named fakes: `scriptedFakeCritic` knows which claims a case
 * planted and rejects exactly those, the way a correct model would. How well
 * a real model spots bad claims is measured by
 * `scripts/benchmark-critic-models.mjs`, not here.
 *
 * Planted claims are injected by `fakePlantingComposer`: the deterministic
 * composer's claims plus one planted claim. Each planted claim passes
 * `verifyClaims` (the structural verifier's documented gaps), so without the
 * critic it would ship; that is what makes these cases fail when the critic
 * is removed or accepts everything.
 */

const FAKE_CRITIC_MODEL = 'gate-fake-critic';

/** Claim text and id pairs parsed back out of a critic prompt (critic.js#buildCriticPrompt). */
function promptClaims(prompt) {
  return [...String(prompt).matchAll(/^(C\d+) \[[^\]]+\]: (".*")$/gm)].map((match) => ({ id: match[1], text: JSON.parse(match[2]) }));
}

/**
 * Gate-only fake critic model. `decide(text)` returns a reason code to reject
 * a claim or null to keep it; `reply` overrides the whole reply text (to test
 * invalid JSON or an "adding" critic). Records every prompt it receives in
 * `requests` so a case can inspect exactly what would leave the process.
 */
export function scriptedFakeCritic({ decide = () => null, reply = null } = {}) {
  const requests = [];
  return {
    name: 'fake-scripted-critic',
    model: FAKE_CRITIC_MODEL,
    requests,
    async generate({ prompt }) {
      requests.push(prompt);
      const claims = promptClaims(prompt);
      const text = reply ? reply(claims) : JSON.stringify({ verdicts: claims.map((claim) => {
        const reason = decide(claim.text);
        return reason ? { id: claim.id, verdict: 'reject', reason } : { id: claim.id, verdict: 'keep' };
      }) });
      return { text, inputTokens: 100, outputTokens: 20, estimatedCostUsd: null, costSource: 'unknown' };
    },
  };
}

/**
 * Gate-only fake answer composer: the deterministic composer's claims plus
 * whatever `plant(args)` returns (full-citation claims, which the composer
 * passes through to `verifyClaims` unchanged). Wrapped like a real model so
 * the planted claims take the model path.
 */
export function fakePlantingComposer(plant) {
  const primary = {
    name: 'fake-planting-composer',
    model: 'gate-test-only',
    async checkReady() { return true; },
    async generate(args) {
      const base = JSON.parse((await new DeterministicAnswerComposer().generate(args)).text).claims;
      return { text: JSON.stringify({ claims: [...base, ...plant(args)] }), inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
    },
  };
  return new ResilientProvider({ primary, fallback: new DeterministicAnswerComposer() });
}

// A guideline quote with one appended sentence that applies it to this
// patient. No quote says that; the verifier allows it because every appended
// word is framing vocabulary and "recommends this" matches no directive pattern.
const UNCITED_SENTENCE = 'The guideline recommends this for the patient.';
function plantUncitedStatement(args) {
  const evidence = args.guidelineEvidence?.[0];
  if (!evidence) return [];
  return [{ kind: 'guideline', text: `Per ${evidence.title} guideline, section ${evidence.section} (${evidence.version}): "${evidence.snippet}" ${UNCITED_SENTENCE}`, citations: [evidence.citation] }];
}

// A medication directive written only in the verifier's closed vocabulary
// ("has to be taking"), so its directive patterns do not fire.
const DIRECTIVE_PREFIX = 'The patient has to be taking lisinopril';
function plantDirective(args) {
  const citation = (args.patientFactCitations || []).find((item) => item.field_or_chunk_id === 'medication.lisinopril.dose');
  if (!citation) return [];
  return [{ kind: 'patient_fact', text: `${DIRECTIVE_PREFIX} ${citation.quote_or_value}.`, citations: [citation] }];
}

// The chart's lisinopril dose records (two facts); the not-reinserted case vetoes every claim naming it.
const LISINOPRIL = 'lisinopril';
const factKeyOf = (citation) => `${citation.source_type}:${citation.source_id}:${citation.field_or_chunk_id}`;
const answerOf = (run) => run.result?.workflow?.answer || null;
const claimsOf = (answer) => [...(answer?.patient_facts || []), ...(answer?.guideline_evidence || [])];
const traces = (run) => run.h.traceSink.list();
const scanTrace = (run) => traces(run).find((trace) => trace.operation === 'w2-scan-supervisor') || null;
const decisionReasons = (run) => (run.result?.workflow?.decisions || []).map((decision) => `${decision.next}:${decision.reason}`);

/** Issues shared by every case where the critic actually ran. */
function reviewedIssues(run, { rejected, reasonCode = null }) {
  const issues = [];
  const answer = answerOf(run);
  if (!answer) return ['answer_missing'];
  if (answer.critic_status !== 'reviewed') issues.push(`critic_status_${answer.critic_status}_expected_reviewed`);
  if (rejected !== null && answer.critic_rejected !== rejected) issues.push(`critic_rejected_${answer.critic_rejected}_expected_${rejected}`);
  const reasons = decisionReasons(run);
  const answerAt = reasons.indexOf('ANSWER:facts_and_evidence_ready');
  const critiqueAt = reasons.indexOf('CRITIQUE:answer_needs_review');
  if (answerAt < 0 || critiqueAt !== answerAt + 1 || reasons[critiqueAt + 1] !== 'DONE:critique_reviewed') issues.push('decisions_not_answer_critique_done');
  const handoff = (run.result?.workflow?.handoffs || []).find((item) => item?.worker === 'critic-worker');
  if (!handoff) issues.push('critic_handoff_missing');
  const trace = scanTrace(run);
  if (!trace?.handoffs?.some((item) => item.worker === 'critic-worker')) issues.push('critic_handoff_not_traced');
  if (trace?.critic?.status !== 'reviewed') issues.push('trace_critic_status_not_reviewed');
  if (rejected !== null && trace?.critic?.claims_rejected !== rejected) issues.push('trace_critic_rejected_count_wrong');
  if (reasonCode && trace?.critic?.reason_counts?.[reasonCode] !== rejected) issues.push(`trace_reason_count_${reasonCode}_wrong`);
  if (!trace?.stages?.some((stage) => stage.name === 'critic')) issues.push('critic_stage_not_traced');
  if (!trace?.modelUsage?.some((usage) => usage.stage === 'critic')) issues.push('critic_model_usage_not_traced');
  if (trace?.critic?.cost_usd !== null || trace?.critic?.cost_source !== 'unpriced_model') issues.push('unknown_critic_cost_not_null_with_reason');
  return issues;
}

/** The planted claim never ships, and the critic was the one that removed it. */
function plantedIssues(run, marker, reasonCode) {
  const issues = reviewedIssues(run, { rejected: 1, reasonCode });
  const provider = run.h.service.criticProvider;
  if (!provider?.requests?.some((prompt) => prompt.includes(marker))) issues.push('planted_claim_never_reached_critic');
  if (claimsOf(answerOf(run)).some((claim) => claim.text.includes(marker))) issues.push('planted_claim_shipped');
  return issues;
}

/** Scenario pieces for a case with a planted claim and a critic that rejects it with `reasonCode`. */
function plantedScenario(plant, marker, reasonCode) {
  return {
    answer_provider: () => fakePlantingComposer(plant),
    service_overrides: () => ({ criticProvider: scriptedFakeCritic({ decide: (text) => (text.includes(marker) ? reasonCode : null) }) }),
  };
}

/** The same claims the answer would carry without the critic (the clean-answer control). */
async function answerWithoutCritic(scenario) {
  const { service_overrides: _ignored, ...rest } = scenario;
  const control = await runScenario(rest);
  return control.result?.workflow?.answer || null;
}

const sameClaims = (left, right) => JSON.stringify(claimsOf(left)) === JSON.stringify(claimsOf(right));

/** Identifiers the critic request must never carry: demographics, the patient ref and the stored document id. */
function requestPhiIssues(run) {
  const truth = run.docs[0].truth;
  const form = truth.intake_form || {};
  const identifiers = [form.name, form.dob, form.phone, truth.header?.patient_name, truth.header?.dob, run.patient, ...run.sourceIds].filter(Boolean);
  const requests = run.h.service.criticProvider?.requests || [];
  if (!requests.length) return ['critic_never_called'];
  const text = requests.join('\n').toLowerCase();
  return identifiers.some((value) => text.includes(String(value).toLowerCase())) ? ['identifier_in_critic_request'] : [];
}

const ALLOWED_TRACE_CRITIC_KEYS = new Set(['status', 'reason', 'provider', 'model', 'duration_ms', 'input_tokens', 'output_tokens', 'cost_usd', 'cost_source', 'claims_reviewed', 'claims_kept', 'claims_rejected', 'claims_not_sent', 'claims_topup_unreviewed', 'reason_counts', 'error_code']);

export const criticCaseChecks = {
  async uncited(run) { return plantedIssues(run, UNCITED_SENTENCE, 'UNCITED'); },
  async directive(run) { return plantedIssues(run, DIRECTIVE_PREFIX, 'UNSAFE_ACTION'); },
  async clean(run, scenario) {
    const issues = reviewedIssues(run, { rejected: 0 });
    const control = await answerWithoutCritic(scenario);
    if (!control) issues.push('control_answer_missing');
    else if (!sameClaims(answerOf(run), control)) issues.push('clean_answer_changed_by_critic');
    return issues;
  },
  async ignoresAdditions(run, scenario) {
    const issues = reviewedIssues(run, { rejected: 0 });
    const control = await answerWithoutCritic(scenario);
    if (!control || !sameClaims(answerOf(run), control)) issues.push('critic_addition_or_rewrite_changed_answer');
    return issues;
  },
  async factNotReinserted(run, scenario) {
    const issues = reviewedIssues(run, { rejected: null, reasonCode: null });
    const control = await answerWithoutCritic(scenario);
    const barred = claimsOf(control).filter((claim) => claim.text.includes(LISINOPRIL)).flatMap((claim) => claim.citations.map(factKeyOf));
    if (!barred.length) issues.push('control_has_no_lisinopril_claim');
    const answer = answerOf(run);
    if (claimsOf(answer).some((claim) => claim.citations.some((citation) => barred.includes(factKeyOf(citation))))) issues.push('rejected_fact_reinserted');
    const removed = claimsOf(control).length - claimsOf(answer).length;
    if (answer?.critic_rejected !== removed || removed < 1) issues.push(`critic_rejected_${answer?.critic_rejected}_but_removed_${removed}`);
    if (answer?.critic_topup_unreviewed !== 0) issues.push('unreviewed_topup_after_veto');
    if (scanTrace(run)?.critic?.claims_rejected !== removed) issues.push('trace_rejected_count_not_what_was_removed');
    return issues;
  },
  async budgetSkip(run) {
    const issues = [];
    const answer = answerOf(run);
    if (answer?.critic_status !== 'skipped_budget') issues.push(`critic_status_${answer?.critic_status}_expected_skipped_budget`);
    if (run.h.service.criticProvider?.requests?.length) issues.push('critic_called_without_budget');
    if (!decisionReasons(run).includes('DONE:critic_skipped_budget')) issues.push('budget_skip_decision_missing');
    if (decisionReasons(run).some((reason) => reason.startsWith('CRITIQUE:'))) issues.push('critique_decided_without_budget');
    const trace = scanTrace(run);
    if (trace?.critic?.status !== 'skipped_budget') issues.push('trace_critic_status_not_skipped_budget');
    if (trace?.evaluation?.critic_status !== 'skipped_budget' || trace?.evaluation?.status !== 'degraded') issues.push('runtime_evaluation_does_not_reflect_budget_skip');
    return issues;
  },
  async invalidJson(run, scenario) {
    const issues = [];
    const answer = answerOf(run);
    if (answer?.critic_status !== 'failed') issues.push(`critic_status_${answer?.critic_status}_expected_failed`);
    const trace = scanTrace(run);
    if (trace?.critic?.error_code !== 'invalid_json') issues.push('trace_error_code_not_invalid_json');
    if (!decisionReasons(run).includes('DONE:critique_failed')) issues.push('critique_failed_decision_missing');
    if (trace?.evaluation?.status !== 'degraded') issues.push('runtime_evaluation_not_degraded_on_critic_failure');
    const control = await answerWithoutCritic(scenario);
    if (!control || !sameClaims(answer, control)) issues.push('failed_critic_changed_answer');
    return issues;
  },
  async disabled(run) {
    const issues = [];
    if (answerOf(run)?.critic_status !== 'disabled') issues.push(`critic_status_${answerOf(run)?.critic_status}_expected_disabled`);
    if (!decisionReasons(run).includes('DONE:critic_disabled')) issues.push('critic_disabled_decision_missing');
    if ((run.result?.workflow?.handoffs || []).some((item) => item?.worker === 'critic-worker')) issues.push('critic_ran_while_disabled');
    if (scanTrace(run)?.critic?.status !== 'disabled') issues.push('trace_critic_status_not_disabled');
    return issues;
  },
  async noPhi(run) {
    const issues = [...reviewedIssues(run, { rejected: 0 }), ...requestPhiIssues(run)];
    const block = scanTrace(run)?.critic || {};
    for (const key of Object.keys(block)) if (!ALLOWED_TRACE_CRITIC_KEYS.has(key)) issues.push(`trace_critic_unexpected_key:${key}`);
    return issues;
  },
};

const withFakeCritic = (options) => ({ service_overrides: () => ({ criticProvider: scriptedFakeCritic(options) }) });
const addingCriticReply = (claims) => JSON.stringify({ verdicts: [...claims.map((claim) => ({ id: claim.id, verdict: 'keep', text: 'rewritten by the critic' })), { id: 'C99', verdict: 'reject', reason: 'UNSAFE_ACTION', text: 'added by the critic' }] });

export function criticCases({ kase, scan }) {
  const clean = scan('lab-a', 'lab_pdf', withFakeCritic());
  const adding = scan('intake-a', 'intake_form', withFakeCritic({ reply: addingCriticReply }));
  const invalid = scan('lab-a', 'lab_pdf', withFakeCritic({ reply: () => 'All claims look fine to me.' }));
  const vetoFact = scan('intake-a', 'intake_form', withFakeCritic({ decide: (text) => (text.includes(LISINOPRIL) ? 'UNSUPPORTED_BY_SOURCE' : null) }));
  return [
    kase('x2-critic-rejects-uncited-statement', 'citation_present', 'A guideline claim with an appended sentence that no quote supports ("The guideline recommends this for the patient.") passes the structural verifier; the critic must veto it as UNCITED, and the veto must be applied and traced.', scan('lab-a', 'lab_pdf', plantedScenario(plantUncitedStatement, UNCITED_SENTENCE, 'UNCITED')), { custom: (run) => criticCaseChecks.uncited(run) }),
    kase('x2-critic-rejects-unsafe-directive', 'safe_refusal', 'A medication directive in the verifier\'s own vocabulary ("The patient has to be taking lisinopril ...") passes the structural verifier; the critic must veto it as UNSAFE_ACTION before it reaches the clinician.', scan('intake-a', 'intake_form', plantedScenario(plantDirective, DIRECTIVE_PREFIX, 'UNSAFE_ACTION')), { custom: (run) => criticCaseChecks.directive(run) }),
    kase('x2-critic-keeps-clean-answer', 'factually_consistent', 'A critic that keeps every claim still changes the answer (drops, reorders or rewrites a claim), or the answer is labeled something other than reviewed.', clean, { custom: (run) => criticCaseChecks.clean(run, clean) }),
    kase('x2-critic-ignores-added-or-rewritten-claims', 'factually_consistent', 'A critic reply that adds a claim id it was never sent, or carries rewritten text, changes the shipped answer; the critic may only veto.', adding, { custom: (run) => criticCaseChecks.ignoresAdditions(run, adding) }),
    kase('x2-critic-rejected-fact-not-reinserted', 'factually_consistent', 'After the critic vetoes every claim citing a fact, the deterministic top-up or fallback puts a claim citing that same fact back (a veto turned into a rewrite), or critic_rejected and the trace count differ from what was actually removed.', vetoFact, { custom: (run) => criticCaseChecks.factNotReinserted(run, vetoFact) }),
    kase('x2-critic-budget-skip-labeled', 'schema_valid', 'When the scan deadline leaves less time than the critic timeout, the critic is still called or the answer is labeled reviewed, instead of shipping as verified with critic_status skipped_budget and a degraded runtime evaluation.', scan('lab-a', 'lab_pdf', { service_overrides: () => ({ criticProvider: scriptedFakeCritic(), criticTimeoutMs: 30000 }) }), { custom: (run) => criticCaseChecks.budgetSkip(run) }),
    kase('x2-critic-invalid-json-failed', 'schema_valid', 'A critic reply that is not valid JSON is treated as a review (or crashes the request) instead of critic_status failed with the answer unchanged.', invalid, { custom: (run) => criticCaseChecks.invalidJson(run, invalid) }),
    kase('x2-critic-disabled-labeled', 'schema_valid', 'With no critic model configured the answer is unlabeled or labeled reviewed, instead of critic_status disabled with a DONE critic_disabled decision.', scan('intake-a', 'intake_form'), { custom: (run) => criticCaseChecks.disabled(run) }),
    kase('x2-critic-no-phi', 'no_phi_in_logs', 'The critic request carries the patient name, date of birth, phone, patient ref or document id, or the trace or console carries claim text or any synthetic identifier.', scan('intake-a', 'intake_form', withFakeCritic()), { no_phi: {}, custom: (run) => criticCaseChecks.noPhi(run) }),
  ];
}
