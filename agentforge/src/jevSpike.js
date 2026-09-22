import { runDeterministicSupervisor } from './supervisor.js';

export const JEV_SPIKE_CASE_COUNT = 20;

const baseEvidence = { status: 'ready', patient_facts: [{ source_type: 'patient_record', patient_ref: 'fixture-patient-001', source_id: 'problem-1', field: 'problem.diabetes.status', value: 'active' }], guideline_evidence: [{ source_type: 'guideline', source_id: 'guideline-1', title: 'Synthetic guideline', version: '2026.1', section: 'Review', location: 'synthetic://guidelines/review', quote: 'Review documented evidence.', matched_terms: ['review'] }], retrieval: { guideline_status: 'complete', guideline_issues: [], failed_patient_groups: [] }, qualification: { required: false, reasons: [] } };

export function buildJevSpikeCorpus() {
  return Array.from({ length: JEV_SPIKE_CASE_COUNT }, (_, index) => {
    const mode = index % 5;
    const evidence = mode === 1 ? { ...baseEvidence, qualification: { required: true, reasons: ['insufficient_guideline_evidence'] } } : mode === 2 ? null : mode === 3 ? { ...baseEvidence, guideline_evidence: [{ source_type: 'guideline', source_id: 'uncited' }] } : baseEvidence;
    return { id: `jev-spike-${String(index + 1).padStart(2, '0')}`, label: mode === 0 ? 'ready' : mode === 1 ? 'qualified' : mode === 2 ? 'clarify' : mode === 3 ? 'unsafe-citation' : 'ready', evidence, expected: mode === 0 || mode === 4 ? 'READY' : mode === 1 ? 'QUALIFIED' : mode === 2 ? 'CLARIFY' : 'BLOCKED' };
  });
}

function runTimed(runner, testCase) {
  const started = performance.now();
  return Promise.resolve()
    .then(() => runner(testCase))
    .then((result) => ({ status: 'complete', result, latency_ms: Number((performance.now() - started).toFixed(3)), cost_usd: Number(result?.cost_usd || 0), traceable: Array.isArray(result?.transitions) && Array.isArray(result?.handoffs) }))
    .catch((error) => ({ status: 'failed', error_class: error?.error_class || 'workflow_failure', error: String(error?.message || error), latency_ms: Number((performance.now() - started).toFixed(3)), cost_usd: 0, traceable: false }));
}

function safetyState(evidence) {
  if (!evidence || evidence.status !== 'ready') return 'CLARIFY';
  if (!Array.isArray(evidence.patient_facts) || !Array.isArray(evidence.guideline_evidence)) return 'BLOCKED';
  if (evidence.guideline_evidence.some((item) => !item?.source_id || !item?.location || !item?.quote)) return 'BLOCKED';
  return null;
}

function buildJevState(testCase) {
  const evidence = testCase.evidence;
  return {
    case_id: testCase.id,
    evidence_status: evidence?.status || 'missing',
    patient_facts: evidence?.patient_facts || [],
    guideline_evidence: evidence?.guideline_evidence || [],
    qualification: evidence?.qualification || { required: false, reasons: [] },
    safety_constraints: ['Synthetic fixture only.', 'Do not invent diagnoses, orders, or unsupported evidence.', 'Return BLOCKED for uncited guideline evidence and CLARIFY for missing evidence.']
  };
}

function normalizeJevAnswer(payload) {
  const answer = payload?.data?.answers?.route || payload?.answers?.route || payload?.data?.route || payload?.route;
  const choice = answer?.choice || answer?.value || answer?.answer;
  if (!['READY', 'QUALIFIED', 'CLARIFY', 'BLOCKED'].includes(choice)) {
    const error = new Error('Jev response did not contain a valid route choice');
    error.error_class = 'adapter_failure';
    throw error;
  }
  return { choice, confidence: answer?.confidence ?? null, probabilities: answer?.probabilities ?? null };
}

/** Build the live Jev adapter without storing or logging the API key. */
export function createJevDecisionRunner({ apiKey = process.env.JEV_API_KEY, endpoint = 'https://www.jevai.org/api/v1/decisions', fetchImpl = globalThis.fetch, model = 'typesafe-ai/jev' } = {}) {
  return async (testCase) => {
    if (!apiKey) {
      const error = new Error('JEV_API_KEY is not configured');
      error.error_class = 'jev_unavailable';
      throw error;
    }
    if (typeof fetchImpl !== 'function') {
      const error = new Error('No fetch implementation is available');
      error.error_class = 'service_failure';
      throw error;
    }
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        state: buildJevState(testCase),
        questions: {
          route: {
            type: 'choice',
            instructions: 'Choose the safest workflow state for this synthetic clinical evidence review.',
            criteria: {
              READY: 'All supplied evidence is sufficient, verified, and cited.',
              QUALIFIED: 'Evidence is insufficient for a complete answer but can be shown with an explicit qualification.',
              CLARIFY: 'Required evidence is missing or retrieval is incomplete.',
              BLOCKED: 'The result would be unsafe to present because evidence is uncited, malformed, or otherwise invalid.'
            }
          }
        }
      })
    });
    if (!response.ok) {
      const error = new Error(`Jev service returned HTTP ${response.status}`);
      error.error_class = 'service_failure';
      throw error;
    }
    const payload = await response.json();
    if (payload?.code !== undefined && payload.code !== 0) {
      const error = new Error('Jev service returned an error response');
      error.error_class = 'service_failure';
      throw error;
    }
    const answer = normalizeJevAnswer(payload);
    const guarded = safetyState(testCase.evidence);
    const finalState = guarded || answer.choice;
    return {
      workflow_version: 'w2-jev-v1',
      final_state: finalState,
      readiness: finalState === 'READY' ? 'ready' : 'stopped',
      stop_reason: finalState === 'CLARIFY' ? 'evidence_retrieval_incomplete' : finalState === 'BLOCKED' ? 'uncited_guideline_evidence' : null,
      transitions: ['START', 'JEV_ROUTER', finalState],
      handoffs: [{ worker: 'jev-router', input_type: 'typed-evidence-review', output_status: finalState.toLowerCase() }],
      typed_outputs: { evidence: testCase.evidence },
      jev: { raw_state: answer.choice, safety_override: Boolean(guarded), confidence: answer.confidence, probabilities: answer.probabilities },
      cost_usd: Number(payload?.data?.usage?.cost_usd || payload?.usage?.cost_usd || 0)
    };
  };
}

export async function runJevSpike({ cases = buildJevSpikeCorpus(), jevRunner = null, standardRunner = (testCase) => runDeterministicSupervisor({ evidenceResult: testCase.evidence }) } = {}) {
  const standard = await Promise.all(cases.map(async (testCase) => ({ id: testCase.id, expected: testCase.expected, run: await runTimed(standardRunner, testCase) })));
  const jev = jevRunner ? await Promise.all(cases.map(async (testCase) => ({ id: testCase.id, expected: testCase.expected, run: await runTimed(jevRunner, testCase) }))) : cases.map((testCase) => ({ id: testCase.id, expected: testCase.expected, run: { status: 'unavailable', error_class: 'jev_unavailable', latency_ms: null, cost_usd: null, traceable: false } }));
  const accuracy = (rows) => rows.length ? rows.filter((row) => row.run.result?.final_state === row.expected).length / rows.length : 0;
  const safeHandoffs = (rows) => rows.filter((row) => row.run.result?.final_state === 'BLOCKED' && row.run.result?.stop_reason === 'uncited_guideline_evidence').length;
  const standardCost = standard.reduce((sum, row) => sum + (row.run.cost_usd || 0), 0);
  const jevCost = jev.reduce((sum, row) => sum + (row.run.cost_usd || 0), 0);
  const recommendation = jevRunner && accuracy(jev) >= accuracy(standard) && jev.every((row) => row.run.traceable) && jevCost < standardCost ? 'promote_jev_candidate' : 'keep_standard';
  return { schema_version: 'w2-jev-spike-v1', synthetic_only: true, case_count: cases.length, standard: { accuracy: accuracy(standard), clarification_or_abstention: standard.filter((row) => ['CLARIFY', 'QUALIFIED'].includes(row.run.result?.final_state)).length, unsafe_handoffs: safeHandoffs(standard), total_latency_ms: Number(standard.reduce((sum, row) => sum + (row.run.latency_ms || 0), 0).toFixed(3)), total_cost_usd: standardCost, reproducible: true, rows: standard }, jev: { status: jevRunner ? 'available' : 'unavailable', accuracy: jevRunner ? accuracy(jev) : null, clarification_or_abstention: jevRunner ? jev.filter((row) => ['CLARIFY', 'QUALIFIED'].includes(row.run.result?.final_state)).length : null, unsafe_handoffs: jevRunner ? safeHandoffs(jev) : null, total_latency_ms: jevRunner ? Number(jev.reduce((sum, row) => sum + (row.run.latency_ms || 0), 0).toFixed(3)) : null, total_cost_usd: jevRunner ? jevCost : null, reproducible: Boolean(jevRunner), rows: jev }, recommendation, promotion_criteria: { no_safety_or_traceability_regression: true, quality_at_least_standard: true, lower_cost_than_standard: true, note: 'A zero-cost deterministic comparator cannot establish a lower priced provider; inject measured standard costs before promotion.' } };
}
