import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTraceSink } from '../../observability/index.js';
import { partitionAnswerInputs } from '../src/answerComposer.js';
import {
  CRITIC_REASON_CODES, applyCriticVerdicts, buildCriticPrompt, buildCriticRequest, createCriticProviderFromEnv,
  criticTraceSummary, parseCriticVerdicts, runCriticWorker,
} from '../src/critic.js';
import { criticCases, scriptedFakeCritic } from '../src/extensionCases/critic.js';
import { computeRuntimeEvaluation } from '../src/runtimeEvaluation.js';
import { GroundedAnswerResult, parseOrIssues } from '../src/schemas.js';
import { DECISIONS, decideNext, runActiveSupervisor } from '../src/supervisor.js';
import { harness, kase, loadGoldenFixtures, runScenario, scan, withCapturedOutput } from '../src/w2RegressionGate.js';

/**
 * E2 critic: an LLM that can only veto claims. Every critic model here is a
 * deterministic fake, named as one; no test makes a network call.
 */

const citation = (id, quote, type = 'openemr_record') => ({ source_type: type, source_id: id, page_or_section: 'OpenEMR chart record', field_or_chunk_id: id, quote_or_value: quote });
const factClaim = (id, text, quote) => ({ kind: 'patient_fact', text, citations: [citation(id, quote)] });
const answerWith = (patientFacts, guidelines = [], overrides = {}) => ({ composer: 'model', patient_facts: patientFacts, guideline_evidence: guidelines, needs_review: [], unverified_dropped: 0, model_claims_proposed: patientFacts.length, model_claims_verified: patientFacts.length, ...overrides });

/** A fake critic model returning `text` (or throwing / hanging) and recording prompts. */
function fakeCriticModel({ text = null, verdicts = null, throwError = null, hang = false } = {}) {
  const prompts = [];
  return {
    name: 'fake-critic-model', model: 'fake-critic-v1', prompts,
    async generate({ prompt, signal }) {
      prompts.push(prompt);
      if (throwError) throw new Error(throwError);
      if (hang) return new Promise(() => {});
      const ids = [...prompt.matchAll(/^(C\d+) \[/gm)].map((match) => match[1]);
      const body = text ?? JSON.stringify({ verdicts: ids.map((id) => verdicts?.[id] || { id, verdict: 'keep' }).map((verdict, index) => ({ id: ids[index], ...verdict })) });
      if (signal?.aborted) throw new Error('MODEL_ABORTED');
      return { text: body, inputTokens: 50, outputTokens: 10, estimatedCostUsd: null, costSource: 'unknown' };
    },
  };
}

// --- configuration ---------------------------------------------------------

test('createCriticProviderFromEnv: no model configured means disabled; there is no default model', () => {
  const config = createCriticProviderFromEnv({ AGENTFORGE_OPENROUTER_API_KEY: 'test-key' });
  assert.equal(config.provider, null);
  assert.equal(config.disabledReason, 'critic_model_not_configured');
  assert.equal(config.timeoutMs, 4000);
});

test('createCriticProviderFromEnv: a model without the OpenRouter key is disabled, labeled with why', () => {
  const config = createCriticProviderFromEnv({ AGENTFORGE_CRITIC_MODEL: 'vendor/model-a' });
  assert.equal(config.provider, null);
  assert.equal(config.disabledReason, 'critic_api_key_missing');
});

test('createCriticProviderFromEnv: an unsupported provider or a bad timeout fails at startup', () => {
  assert.throws(() => createCriticProviderFromEnv({ AGENTFORGE_CRITIC_PROVIDER: 'other' }), /AGENTFORGE_CRITIC_PROVIDER/);
  assert.throws(() => createCriticProviderFromEnv({ AGENTFORGE_CRITIC_TIMEOUT_MS: '0' }), /AGENTFORGE_CRITIC_TIMEOUT_MS/);
  assert.throws(() => createCriticProviderFromEnv({ AGENTFORGE_CRITIC_TIMEOUT_MS: 'soon' }), /AGENTFORGE_CRITIC_TIMEOUT_MS/);
});

test('createCriticProviderFromEnv: OpenRouter lane request carries the model, the prompt and usage accounting, nothing else', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body), headers: init.headers }; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"verdicts":[]}' } }], usage: { prompt_tokens: 7, completion_tokens: 3, cost: 0.00001 } }) }; };
  const config = createCriticProviderFromEnv({ AGENTFORGE_CRITIC_MODEL: 'vendor/model-a', AGENTFORGE_OPENROUTER_API_KEY: 'test-key', AGENTFORGE_CRITIC_TIMEOUT_MS: '2500' }, { fetchImpl });
  assert.equal(config.provider.name, 'openrouter');
  assert.equal(config.timeoutMs, 2500);
  const result = await config.provider.generate({ prompt: 'critic prompt', maxTokens: 600 });
  assert.equal(sent.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.deepEqual(Object.keys(sent.body).sort(), ['max_tokens', 'messages', 'model', 'temperature', 'usage']);
  assert.equal(sent.body.model, 'vendor/model-a');
  assert.deepEqual(sent.body.messages, [{ role: 'user', content: 'critic prompt' }]);
  assert.deepEqual(sent.body.usage, { include: true });
  assert.equal(result.estimatedCostUsd, 0.00001);
  assert.equal(result.costSource, 'provider_reported');
});

// --- parsing ---------------------------------------------------------------

test('parseCriticVerdicts: strict JSON, one verdict per sent id, closed reason codes', () => {
  const ok = parseCriticVerdicts('{"verdicts":[{"id":"C1","verdict":"keep"},{"id":"C2","verdict":"reject","reason":"UNSAFE_ACTION"}]}', ['C1', 'C2']);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.verdicts, [{ id: 'C1', verdict: 'keep', reason: null }, { id: 'C2', verdict: 'reject', reason: 'UNSAFE_ACTION' }]);
  assert.equal(parseCriticVerdicts('```json\n{"verdicts":[{"id":"C1","verdict":"keep"}]}\n```', ['C1']).ok, true);
  assert.deepEqual(parseCriticVerdicts('Looks fine.', ['C1']), { ok: false, error: 'invalid_json' });
  assert.deepEqual(parseCriticVerdicts('[]', ['C1']), { ok: false, error: 'invalid_shape' });
  assert.deepEqual(parseCriticVerdicts('{"verdicts":[]}', ['C1']), { ok: false, error: 'missing_verdict' });
  assert.deepEqual(parseCriticVerdicts('{"verdicts":[{"id":"C1","verdict":"reject","reason":"TOO_LONG"}]}', ['C1']), { ok: false, error: 'invalid_verdict' });
  assert.deepEqual(parseCriticVerdicts('{"verdicts":[{"id":"C1","verdict":"rewrite"}]}', ['C1']), { ok: false, error: 'invalid_verdict' });
  assert.deepEqual(parseCriticVerdicts('{"verdicts":[{"id":"C1","verdict":"keep"},{"id":"C1","verdict":"keep"}]}', ['C1']), { ok: false, error: 'duplicate_verdict' });
});

test('parseCriticVerdicts: an entry for an id that was never sent (an added claim) is ignored, never applied', () => {
  const parsed = parseCriticVerdicts('{"verdicts":[{"id":"C1","verdict":"keep","text":"rewritten"},{"id":"C7","verdict":"reject","reason":"UNCITED","text":"new claim"}]}', ['C1']);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.verdicts, [{ id: 'C1', verdict: 'keep', reason: null }]);
  assert.equal(parsed.ignoredEntries, 1);
});

// --- request and PHI -------------------------------------------------------

test('buildCriticRequest: only claim text and citation quotes; identity-field claims are never sent', () => {
  const answer = answerWith([
    factClaim('medication.lisinopril.dose', 'The chart records medication lisinopril dose as 10 mg daily.', '10 mg daily'),
    { kind: 'patient_fact', text: 'Name: Test Patient One.', citations: [{ ...citation('intake-1', 'Name: Test Patient One', 'document'), field_or_chunk_id: 'demographics.name' }] },
  ]);
  const request = buildCriticRequest(answer);
  assert.equal(request.items.length, 1);
  assert.equal(request.notSent, 1);
  const prompt = buildCriticPrompt(request.items);
  assert.match(prompt, /C1 \[patient record fact\]: "The chart records medication lisinopril dose as 10 mg daily\."/);
  assert.match(prompt, /quote: "10 mg daily"/);
  for (const forbidden of ['Test Patient One', 'medication.lisinopril.dose', 'intake-1', 'openemr_record']) assert.ok(!prompt.includes(forbidden), forbidden);
});

// --- the worker ------------------------------------------------------------

const twoClaimAnswer = () => answerWith([
  factClaim('medication.lisinopril.dose', 'The chart records medication lisinopril dose as 10 mg daily.', '10 mg daily'),
  factClaim('encounter.reason', 'The chart records encounter reason as blood-pressure follow-up.', 'blood-pressure follow-up'),
]);

test('runCriticWorker: a valid reply is reviewed; verdicts carry claim indexes and codes only', async () => {
  const provider = fakeCriticModel({ verdicts: { C2: { verdict: 'reject', reason: 'UNSUPPORTED_BY_SOURCE' } } });
  const handoff = await runCriticWorker({ answer: twoClaimAnswer(), provider, timeoutMs: 1000 });
  assert.equal(handoff.output_status, 'reviewed');
  assert.equal(handoff.worker, 'critic-worker');
  assert.deepEqual(handoff.verdicts, [{ index: 0, verdict: 'keep', reason: null }, { index: 1, verdict: 'reject', reason: 'UNSUPPORTED_BY_SOURCE' }]);
  assert.deepEqual(handoff.redacted_metrics.reason_counts, { UNCITED: 0, UNSUPPORTED_BY_SOURCE: 1, UNSAFE_ACTION: 0 });
  assert.equal(handoff.usage.stage, 'critic');
  assert.equal(handoff.usage.estimatedCostUsd, null);
});

test('runCriticWorker: invalid JSON, a provider error, a timeout and the scan deadline are all failed, never reviewed', async () => {
  const invalid = await runCriticWorker({ answer: twoClaimAnswer(), provider: fakeCriticModel({ text: 'keep all' }), timeoutMs: 1000 });
  assert.equal(invalid.output_status, 'failed');
  assert.equal(invalid.error_code, 'invalid_json');
  const errored = await runCriticWorker({ answer: twoClaimAnswer(), provider: fakeCriticModel({ throwError: 'MODEL_HTTP_503' }), timeoutMs: 1000 });
  assert.equal(errored.output_status, 'failed');
  assert.equal(errored.error_code, 'provider_error');
  const hung = await runCriticWorker({ answer: twoClaimAnswer(), provider: fakeCriticModel({ hang: true }), timeoutMs: 30 });
  assert.equal(hung.output_status, 'failed');
  assert.equal(hung.error_code, 'timeout');
  assert.equal(hung.usage.cost_source, 'no_response');
  const deadline = new AbortController();
  deadline.abort(new Error('SCAN_DEADLINE_EXCEEDED'));
  const late = await runCriticWorker({ answer: twoClaimAnswer(), provider: fakeCriticModel(), timeoutMs: 1000, signal: deadline.signal });
  assert.equal(late.output_status, 'failed');
  assert.equal(late.error_code, 'deadline');
});

test('runCriticWorker: an answer with no claims is skipped without a model call', async () => {
  const provider = fakeCriticModel();
  const handoff = await runCriticWorker({ answer: answerWith([]), provider });
  assert.equal(handoff.output_status, 'skipped_no_claims');
  assert.equal(provider.prompts.length, 0);
});

// --- applying verdicts -----------------------------------------------------

test('applyCriticVerdicts: the critic only removes claims; kept claims are byte-identical', () => {
  const answer = twoClaimAnswer();
  const handoff = { output_status: 'reviewed', verdicts: [{ index: 0, verdict: 'reject', reason: 'UNSAFE_ACTION' }, { index: 1, verdict: 'keep', reason: null }] };
  const applied = applyCriticVerdicts(answer, handoff, null);
  assert.deepEqual(applied.patient_facts, [answer.patient_facts[1]]);
  assert.equal(applied.critic_status, 'reviewed');
  assert.equal(applied.critic_rejected, 1);
  assert.ok(parseOrIssues(GroundedAnswerResult, applied).ok);
});

test('applyCriticVerdicts: a gap left by a veto is refilled by the composer top-up, but a vetoed text is never re-added', () => {
  const parts = partitionAnswerInputs({ patientFacts: [
    { field: 'medication.lisinopril.dose', citation: citation('medication.lisinopril.dose', '10 mg daily') },
    { field: 'encounter.reason', citation: citation('encounter.reason', 'blood-pressure follow-up') },
  ] });
  const modelClaim = factClaim('medication.lisinopril.dose', 'The patient has to be taking lisinopril 10 mg daily.', '10 mg daily');
  const deterministicClaim = factClaim('encounter.reason', 'The chart records encounter reason as blood-pressure follow-up.', 'blood-pressure follow-up');
  const answer = answerWith([modelClaim, deterministicClaim]);
  const rejectBoth = { output_status: 'reviewed', verdicts: [{ index: 0, verdict: 'reject', reason: 'UNSAFE_ACTION' }, { index: 1, verdict: 'reject', reason: 'UNCITED' }] };
  const applied = applyCriticVerdicts(answer, rejectBoth, parts);
  // The model's directive is replaced by the deterministic template claim for
  // the same chart fact; the vetoed deterministic text itself stays out.
  assert.deepEqual(applied.patient_facts.map((claim) => claim.text), ['The chart records medication lisinopril dose as 10 mg daily.']);
  assert.equal(applied.composer, 'model+deterministic-topup');
  assert.equal(applied.critic_rejected, 2);
});

test('applyCriticVerdicts: any status but reviewed ships the answer unchanged, labeled with that status', () => {
  const answer = twoClaimAnswer();
  for (const status of ['failed', 'skipped_no_claims']) {
    const applied = applyCriticVerdicts(answer, { output_status: status, verdicts: [{ index: 0, verdict: 'reject', reason: 'UNCITED' }] }, null);
    assert.deepEqual(applied.patient_facts, answer.patient_facts);
    assert.equal(applied.critic_status, status);
    assert.equal(applied.critic_rejected, 0);
  }
});

test('criticTraceSummary: codes and counts only; an unpriced model has null cost with a reason, never a number', () => {
  const summary = criticTraceSummary({ output_status: 'reviewed', provider: 'openrouter', model: 'vendor/model-a', duration_ms: 12, redacted_metrics: { claims_reviewed: 2, claims_kept: 1, claims_rejected: 1, claims_not_sent: 0, reason_counts: { UNCITED: 1, UNSUPPORTED_BY_SOURCE: 0, UNSAFE_ACTION: 0 } }, usage: { inputTokens: 50, outputTokens: 10, estimatedCostUsd: null, cost_source: 'unknown' } });
  assert.equal(summary.cost_usd, null);
  assert.equal(summary.cost_source, 'unpriced_model');
  assert.equal(summary.claims_rejected, 1);
  const sink = new InMemoryTraceSink();
  const trace = sink.start({ correlationId: 'critic-test', operation: 'w2-scan-supervisor' });
  trace.setCritic(summary);
  trace.complete({ status: 'success' });
  assert.deepEqual(sink.list()[0].critic, summary);
});

// --- routing ---------------------------------------------------------------

const answered = { extraction: { output_status: 'complete' }, safetyBlocking: [], confidenceSummary: { mean: 0.9 }, evidence: { output_status: 'ready' }, answer: twoClaimAnswer() };

test('decideNext: after ANSWER, CRITIQUE when a critic is configured and the budget allows, then DONE', () => {
  assert.deepEqual(decideNext({ ...answered, criticEnabled: true, criticBudgetOk: true }), { next: DECISIONS.CRITIQUE, reason: 'answer_needs_review' });
  assert.deepEqual(decideNext({ ...answered, criticEnabled: true, criticBudgetOk: true, critique: { output_status: 'reviewed' } }), { next: DECISIONS.DONE, reason: 'critique_reviewed' });
  assert.deepEqual(decideNext({ ...answered, criticEnabled: true, criticBudgetOk: true, critique: { output_status: 'failed' } }), { next: DECISIONS.DONE, reason: 'critique_failed' });
});

test('decideNext: a disabled critic, an empty answer and a short budget each end at DONE without CRITIQUE', () => {
  assert.deepEqual(decideNext({ ...answered, criticEnabled: false, criticBudgetOk: true }), { next: DECISIONS.DONE, reason: 'critic_disabled' });
  assert.deepEqual(decideNext({ ...answered, answer: answerWith([]), criticEnabled: true, criticBudgetOk: true }), { next: DECISIONS.DONE, reason: 'no_claims_to_review' });
  assert.deepEqual(decideNext({ ...answered, criticEnabled: true, criticBudgetOk: false }), { next: DECISIONS.DONE, reason: 'critic_skipped_budget' });
});

test('decideNext: without an answer the pre-critic routing is unchanged', () => {
  assert.deepEqual(decideNext({ ...answered, answer: null, criticEnabled: true, criticBudgetOk: true }), { next: DECISIONS.ANSWER, reason: 'facts_and_evidence_ready' });
});

const envelope = Buffer.from([
  'SYNTHETIC_SCAN_FORM|layout=pdf-ocr-lab_pdf|page_count=1',
  ...[['lab.hgb.test_name', 'Hemoglobin test name', 'Hemoglobin', ''], ['lab.hgb.value', 'Hemoglobin value', '13.2', 'g/dL'], ['lab.hgb.unit', 'Hemoglobin unit', 'g/dL', ''], ['lab.hgb.reference_range', 'Hemoglobin reference range', '12.0-15.5', ''], ['lab.hgb.collection_date', 'Hemoglobin collection date', '2026-01-05', ''], ['lab.hgb.abnormal', 'Hemoglobin abnormal', 'normal', '']]
    .map(([id, label, value, unit]) => `FIELD|field_id=${id}|label=${label}|value=${value}|unit=${unit}|quote=${label}: ${value}|page=1|box=0,0,10,10|confidence=0.95`),
].join('\n'));

test('active supervisor: with the answer and critic seams, the loop records ANSWER -> CRITIQUE -> DONE and the critic handoff', async () => {
  const recorded = { decisions: [], critic: null, stages: [] };
  const observer = { startStage: (name) => recorded.stages.push(name), finishStage() {}, setExtraction() {}, recordRetrievalAttempt() {}, recordModelUsage() {}, recordDecision: (decision) => recorded.decisions.push(decision), setCritic: (value) => { recorded.critic = value; } };
  const critic = {
    enabled: true, disabledReason: null, budgetOk: () => true,
    run: async (answer) => ({ handoff: { worker: 'critic-worker', output_status: 'reviewed', verdicts: [], usage: null }, answer: { ...answer, critic_status: 'reviewed', critic_rejected: 0 }, summary: { status: 'reviewed' } }),
    skip: () => { throw new Error('skip must not be called'); },
  };
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-critic-1', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope, query: 'documented glycemic values medication adherence', observer, composeAnswer: async () => twoClaimAnswer(), critic });
  assert.deepEqual(result.decisions.map((decision) => `${decision.next}:${decision.reason}`), ['EXTRACT:extraction_needed', 'RETRIEVE:evidence_needed', 'ANSWER:facts_and_evidence_ready', 'CRITIQUE:answer_needs_review', 'DONE:critique_reviewed']);
  assert.deepEqual(recorded.decisions, result.decisions);
  assert.deepEqual(result.handoffs.map((handoff) => handoff.worker), ['scan-form-extraction-worker', 'evidence-retrieval-worker', 'critic-worker']);
  assert.equal(result.answer.critic_status, 'reviewed');
  assert.deepEqual(recorded.critic, { status: 'reviewed' });
  assert.ok(recorded.stages.includes('critic'));
});

test('active supervisor: a disabled critic labels the answer disabled and records no critic handoff', async () => {
  let skipped = null;
  const critic = { enabled: false, disabledReason: 'critic_model_not_configured', budgetOk: () => true, run: async () => { throw new Error('run must not be called'); }, skip: (answer, status, reason) => { skipped = { status, reason }; return { answer: { ...answer, critic_status: status, critic_rejected: 0 }, summary: { status, reason } }; } };
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-critic-2', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope, query: 'documented glycemic values medication adherence', composeAnswer: async () => twoClaimAnswer(), critic });
  assert.deepEqual(result.decisions.at(-1), { next: 'DONE', reason: 'critic_disabled' });
  assert.deepEqual(skipped, { status: 'disabled', reason: 'critic_model_not_configured' });
  assert.equal(result.answer.critic_status, 'disabled');
  assert.ok(!result.handoffs.some((handoff) => handoff.worker === 'critic-worker'));
  assert.equal(result.final_state === 'READY' || result.final_state === 'QUALIFIED', true);
});

// --- the deployed service path ---------------------------------------------

/** Run one golden scan through the real service with the given overrides (E0's `service_overrides`). */
async function serviceScan(doc, type, overrides, extra = {}) {
  const { value } = await withCapturedOutput(() => runScenario(scan(doc, type, { service_overrides: () => overrides, ...extra })));
  return value;
}

test('service: a critic configured but with too little scan budget left is skipped_budget, never called and never reviewed', async () => {
  // Injected clock: 22 s of a 25 s deadline already spent when the answer is
  // ready (live p95 is ~22 s), so 3 s remain -- under the 4 s critic timeout.
  let calls = 0;
  const now = () => { calls += 1; return calls === 1 ? 0 : 22000; };
  const critic = scriptedFakeCritic();
  const run = await serviceScan('lab-a', 'lab_pdf', { criticProvider: critic, criticTimeoutMs: 4000, scanDeadlineMs: 25000, now });
  assert.equal(run.error, null);
  const workflow = run.result.workflow;
  assert.equal(workflow.answer.critic_status, 'skipped_budget');
  assert.equal(critic.requests.length, 0);
  assert.deepEqual(workflow.decisions.at(-1), { next: 'DONE', reason: 'critic_skipped_budget' });
  const trace = run.h.traceSink.list().find((item) => item.operation === 'w2-scan-supervisor');
  assert.equal(trace.critic.status, 'skipped_budget');
  assert.equal(trace.evaluation.critic_status, 'skipped_budget');
  assert.equal(trace.evaluation.status, 'degraded');
});

test('service: with 5 s left the same 4 s critic runs and the answer is reviewed', async () => {
  let calls = 0;
  const now = () => { calls += 1; return calls === 1 ? 0 : 20000; };
  const critic = scriptedFakeCritic();
  const run = await serviceScan('lab-a', 'lab_pdf', { criticProvider: critic, criticTimeoutMs: 4000, scanDeadlineMs: 25000, now });
  assert.equal(run.result.workflow.answer.critic_status, 'reviewed');
  assert.equal(critic.requests.length, 1);
});

test('service: the critic trace and request carry no synthetic identifiers or claim text', async () => {
  const critic = scriptedFakeCritic();
  const run = await serviceScan('intake-a', 'intake_form', { criticProvider: critic });
  const truth = loadGoldenFixtures().docs.get('intake-a').truth;
  const form = truth.intake_form;
  const request = critic.requests.join('\n');
  for (const identifier of [form.name, form.dob, form.phone, 'fixture-patient-001', run.sourceIds[0]]) assert.ok(!request.includes(identifier), 'identifier in critic request');
  const traceText = JSON.stringify(run.h.traceSink.list());
  for (const identifier of [form.name, form.dob, form.phone, form.chief_concern, ...form.current_medications, ...form.allergies]) assert.ok(!traceText.includes(identifier), 'identifier in trace');
  for (const claim of [...run.result.workflow.answer.patient_facts, ...run.result.workflow.answer.guideline_evidence]) assert.ok(!traceText.includes(claim.text), 'claim text in trace');
});

test('harness: the gate harness honors service_overrides for the critic (E0 seam)', () => {
  const critic = scriptedFakeCritic();
  const h = harness({ serviceOverrides: { criticProvider: critic, criticTimeoutMs: 1234 } });
  assert.equal(h.service.criticProvider, critic);
  assert.equal(h.service.criticTimeoutMs, 1234);
});

// --- runtime evaluation ----------------------------------------------------

test('runtime evaluation reflects the critic status', () => {
  const workflow = (answer) => ({ final_state: 'READY', readiness: 'ready', stop_reason: null, qualification: { required: false, reasons: [] }, answer });
  const base = answerWith([factClaim('encounter.reason', 'x', 'y')], [], { composer: 'deterministic-fallback' });
  assert.equal(computeRuntimeEvaluation({ workflow: workflow({ ...base, critic_status: 'reviewed', critic_rejected: 0 }) }).evaluation.status, 'passed');
  const rejected = computeRuntimeEvaluation({ workflow: workflow({ ...base, critic_status: 'reviewed', critic_rejected: 1 }) }).evaluation;
  assert.equal(rejected.status, 'passed');
  assert.ok(rejected.issues.includes('critic_rejected_claims'));
  for (const status of ['failed', 'skipped_budget']) {
    const evaluation = computeRuntimeEvaluation({ workflow: workflow({ ...base, critic_status: status, critic_rejected: 0 }) }).evaluation;
    assert.equal(evaluation.status, 'degraded', status);
    assert.equal(evaluation.critic_status, status);
  }
  assert.equal(computeRuntimeEvaluation({ workflow: workflow({ ...base, critic_status: 'disabled', critic_rejected: 0 }) }).evaluation.status, 'passed');
});

// --- the extension-suite cases (critic.js) ---------------------------------

test('critic extension cases: every case passes on the real scan path, in the five W2 categories', async () => {
  const cases = criticCases({ kase, scan });
  assert.ok(cases.length >= 5);
  for (const testCase of cases) {
    assert.ok(['schema_valid', 'citation_present', 'factually_consistent', 'safe_refusal', 'no_phi_in_logs'].includes(testCase.category), testCase.id);
    const { value: run } = await withCapturedOutput(() => runScenario(testCase.scenario));
    assert.equal(run.error, null, testCase.id);
    assert.deepEqual(await testCase.expect.custom(run, ''), [], testCase.id);
  }
});

test('critic extension cases: a critic that accepts everything lets the planted claims ship, and the cases say so', async () => {
  const cases = criticCases({ kase, scan }).filter((testCase) => ['x2-critic-rejects-uncited-statement', 'x2-critic-rejects-unsafe-directive'].includes(testCase.id));
  assert.equal(cases.length, 2);
  for (const testCase of cases) {
    const scenario = { ...testCase.scenario, service_overrides: () => ({ criticProvider: scriptedFakeCritic() }) };
    const { value: run } = await withCapturedOutput(() => runScenario(scenario));
    const issues = await testCase.expect.custom(run, '');
    assert.ok(issues.includes('planted_claim_shipped'), `${testCase.id}: ${issues}`);
  }
});

test('critic reason codes are the closed set the PRD names', () => {
  assert.deepEqual([...CRITIC_REASON_CODES], ['UNCITED', 'UNSUPPORTED_BY_SOURCE', 'UNSAFE_ACTION']);
});
