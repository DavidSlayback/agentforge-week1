import { runEvidenceWorker, runExtractionWorker } from './activeWorkers.js';

const STATES = Object.freeze({ START: 'START', INTAKE_EXTRACTOR: 'INTAKE_EXTRACTOR', EVIDENCE_RETRIEVER: 'EVIDENCE_RETRIEVER', VERIFY: 'VERIFY', READY: 'READY', QUALIFIED: 'QUALIFIED', CLARIFY: 'CLARIFY', BLOCKED: 'BLOCKED' });

function hasUsableCitation(item) {
  return item && typeof item.source_id === 'string' && item.source_id && typeof item.location === 'string' && item.location && typeof item.quote === 'string' && item.quote;
}

/** Inspectable deterministic state graph for the synthetic evidence workflow. */
export function runDeterministicSupervisor({ intakeResult = { status: 'not_requested', facts: [] }, evidenceResult = null, unsafe = false } = {}) {
  const transitions = [STATES.START];
  const handoffs = [];
  const stop = (state, reason) => ({ workflow_version: 'w2-supervisor-v1', final_state: state, readiness: 'stopped', stop_reason: reason, transitions, handoffs, typed_outputs: { intake: intakeResult, evidence: evidenceResult } });
  if (unsafe) return stop(STATES.BLOCKED, 'unsafe_input');
  if (intakeResult.status !== 'not_requested') {
    transitions.push(STATES.INTAKE_EXTRACTOR);
    handoffs.push({
      worker: 'intake-extractor',
      input_type: 'source_documents',
      document_types: (intakeResult.documents || []).map((document) => document.document_type).filter(Boolean),
      output_status: intakeResult.status,
    });
    if (!['complete', 'qualified'].includes(intakeResult.status)) return stop(STATES.BLOCKED, 'intake_extractor_failed');
  }
  transitions.push(STATES.EVIDENCE_RETRIEVER);
  handoffs.push({ worker: 'evidence-retriever', input_type: 'follow_up_question', output_status: evidenceResult?.status || 'missing' });
  if (!evidenceResult || evidenceResult.status !== 'ready') return stop(STATES.CLARIFY, 'evidence_retrieval_incomplete');
  if (!Array.isArray(evidenceResult.patient_facts) || !Array.isArray(evidenceResult.guideline_evidence)) return stop(STATES.BLOCKED, 'typed_evidence_contract_invalid');
  if (evidenceResult.guideline_evidence.some((item) => !hasUsableCitation(item))) return stop(STATES.BLOCKED, 'uncited_guideline_evidence');
  transitions.push(STATES.VERIFY);
  handoffs.push({ worker: 'deterministic-verifier', input_type: 'typed_evidence', output_status: 'checked' });
  if (evidenceResult.qualification?.required) {
    transitions.push(STATES.QUALIFIED);
    return { workflow_version: 'w2-supervisor-v1', final_state: STATES.QUALIFIED, readiness: 'qualified', stop_reason: null, transitions, handoffs, typed_outputs: { intake: intakeResult, evidence: evidenceResult } };
  }
  transitions.push(STATES.READY);
  return { workflow_version: 'w2-supervisor-v1', final_state: STATES.READY, readiness: 'ready', stop_reason: null, transitions, handoffs, typed_outputs: { intake: intakeResult, evidence: evidenceResult } };
}

/** Execute the W2 workers under an inspectable deterministic supervisor.
 *
 * Args:
 *   request: Patient-scoped question and workflow options.
 *   sourceDocumentIds: Synthetic source-document IDs requiring extraction.
 *   workers: The document extractor and evidence retriever implementations.
 *   unsafe: Whether the request failed an upstream safety check.
 *
 * Returns:
 *   Final graph state with typed outputs from workers that actually ran.
 */
export async function executeSupervisorWorkflow({ request, sourceDocumentIds = [], workers, unsafe = false } = {}) {
  if (!workers || typeof workers.evidenceRetriever !== 'function' || (sourceDocumentIds.length && typeof workers.intakeExtractor !== 'function')) {
    return runDeterministicSupervisor({ evidenceResult: { status: 'blocked' }, unsafe: true });
  }
  let intakeResult = { status: 'not_requested', facts: [], documents: [] };
  if (sourceDocumentIds.length) {
    try {
      intakeResult = await workers.intakeExtractor({ request, sourceDocumentIds });
    } catch {
      intakeResult = { status: 'failed', facts: [], documents: [], issues: ['intake_worker_failed'] };
    }
  }
  let evidenceResult;
  try {
    evidenceResult = await workers.evidenceRetriever(request);
  } catch {
    evidenceResult = { status: 'blocked', patient_facts: [], guideline_evidence: [], issues: ['evidence_worker_failed'] };
  }
  return runDeterministicSupervisor({ intakeResult, evidenceResult, unsafe });
}

/** Run the inspectable multi-worker scan-form path against synthetic input. */
export function runActiveSupervisor({ sourceDocumentId, documentType, layoutId, pageCount = 1, content, sourceClass = 'synthetic_fixture', syntheticOnly = true, processingMode = 'deterministic_local', query, patientFacts = [], extractionAdapter, retrievalAdapter, observer = null } = {}) {
  const transitions = [STATES.START];
  observer?.startStage('extraction');
  let extractionWorker;
  try {
    extractionWorker = runExtractionWorker({ sourceDocumentId, documentType, layoutId, pageCount, content, sourceClass, syntheticOnly, processingMode, ...(extractionAdapter ? { adapter: extractionAdapter } : {}) });
  } finally {
    observer?.finishStage('extraction', { status: extractionWorker?.output_status || 'failed' });
  }
  observer?.setExtraction({ status: extractionWorker.output_status, confidence: null, document_count: 1, fact_count: extractionWorker.extraction?.facts?.length || 0, issue_count: extractionWorker.extraction?.issues?.length || 0 });
  transitions.push(STATES.INTAKE_EXTRACTOR);
  if (extractionWorker.output_status === 'blocked') return activeStop(STATES.BLOCKED, 'extraction_contract_invalid', transitions, extractionWorker, null);
  observer?.startStage('retrieval');
  let evidenceWorker;
  try {
    evidenceWorker = runEvidenceWorker({ query, patientFacts, documentFacts: extractionWorker.extraction.facts, ...(retrievalAdapter ? { retrieve: retrievalAdapter } : {}) });
  } finally {
    observer?.finishStage('retrieval', { status: evidenceWorker?.output_status || 'failed' });
  }
  observer?.recordRetrievalAttempt({ tool: 'evidence-retriever', provider: 'local-lexical-proxy', status: evidenceWorker.output_status === 'ready' ? 'complete' : 'qualified', hit_count: evidenceWorker.guideline_evidence?.length || 0 });
  transitions.push(STATES.EVIDENCE_RETRIEVER);
  if (evidenceWorker.output_status === 'ready') transitions.push(STATES.VERIFY, STATES.READY);
  else transitions.push(STATES.CLARIFY);
  return { workflow_version: 'w2-active-supervisor-v1', final_state: evidenceWorker.output_status === 'ready' ? STATES.READY : STATES.QUALIFIED, readiness: evidenceWorker.output_status === 'ready' ? 'ready' : 'qualified', stop_reason: null, transitions, handoffs: [extractionWorker, evidenceWorker], typed_outputs: { extraction: extractionWorker.extraction, evidence: evidenceWorker } };
}

function activeStop(state, reason, transitions, extraction, evidence) {
  return { workflow_version: 'w2-active-supervisor-v1', final_state: state, readiness: 'stopped', stop_reason: reason, transitions, handoffs: [extraction, ...(evidence ? [evidence] : [])], typed_outputs: { extraction: extraction.extraction, evidence } };
}

export { STATES as SUPERVISOR_STATES };
