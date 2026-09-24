import { runEvidenceWorker, runExtractionWorker } from './activeWorkers.js';
import { assessDocumentSafety } from './documentSafety.js';
import { localLexicalGuidelineRetriever } from './guidelineEvidence.js';
import { summarizeExtractionConfidence } from './typedExtraction.js';

const STATES = Object.freeze({ START: 'START', INTAKE_EXTRACTOR: 'INTAKE_EXTRACTOR', EVIDENCE_RETRIEVER: 'EVIDENCE_RETRIEVER', VERIFY: 'VERIFY', READY: 'READY', QUALIFIED: 'QUALIFIED', CLARIFY: 'CLARIFY', BLOCKED: 'BLOCKED' });

/**
 * Run the inspectable multi-worker scan-form path against synthetic input.
 *
 * `documentText` (OCR text or the text envelope) and `targetPatient`
 * (`{name, dob}` or `null`) feed the fail-loud checks in `documentSafety.js`:
 * patient mismatch or zero facts stop at BLOCKED before retrieval; a
 * doc-type mismatch, an unverified intake identity or an incomplete
 * extraction caps the result at QUALIFIED. Every reason is listed in
 * `qualification.reasons`.
 *
 * Async: the evidence-retrieval worker awaits its retriever (it may be a
 * remote/async provider such as Cohere embed+rerank), so this supervisor must
 * itself be async and every caller must await it.
 *
 * `retrievalAdapter` is an injected `{name, retrieve}` guideline retriever
 * (sync or async — see `runEvidenceWorker`). It defaults to the deterministic
 * local lexical/dense proxy so behavior is unchanged when the caller does not
 * configure one (e.g. direct test calls that omit it entirely). The
 * retrieval provider label recorded on the observer trace always comes from
 * `retrievalAdapter.name`, never a hardcoded constant.
 */
export async function runActiveSupervisor({ sourceDocumentId, documentType, layoutId, pageCount = 1, content, sourceClass = 'synthetic_fixture', syntheticOnly = true, processingMode = 'deterministic_local', query, patientFacts = [], extractionAdapter, retrievalAdapter, observer = null, documentText = '', targetPatient = null } = {}) {
  const retriever = retrievalAdapter || localLexicalGuidelineRetriever;
  const transitions = [STATES.START];
  observer?.startStage('extraction');
  let extractionWorker;
  try {
    extractionWorker = runExtractionWorker({ sourceDocumentId, documentType, layoutId, pageCount, content, sourceClass, syntheticOnly, processingMode, ...(extractionAdapter ? { adapter: extractionAdapter } : {}) });
  } finally {
    observer?.finishStage('extraction', { status: extractionWorker?.output_status || 'failed' });
  }
  const confidenceSummary = summarizeExtractionConfidence(extractionWorker.extraction);
  observer?.setExtraction({ status: extractionWorker.output_status, confidence: confidenceSummary, document_count: 1, fact_count: extractionWorker.extraction?.facts?.length || 0, issue_count: extractionWorker.extraction?.issues?.length || 0 });
  transitions.push(STATES.INTAKE_EXTRACTOR);
  if (extractionWorker.output_status === 'blocked') return activeStop(STATES.BLOCKED, 'extraction_contract_invalid', transitions, extractionWorker, null);
  const safety = assessDocumentSafety({ documentType, documentText, extraction: extractionWorker.extraction, targetPatient });
  if (safety.blocking.length) return activeStop(STATES.BLOCKED, safety.blocking[0], transitions, extractionWorker, null, safety);
  observer?.startStage('retrieval');
  let evidenceWorker;
  try {
    evidenceWorker = await runEvidenceWorker({ query, patientFacts, documentFacts: extractionWorker.extraction.facts, retrieve: retriever.retrieve });
  } finally {
    observer?.finishStage('retrieval', { status: evidenceWorker?.output_status || 'failed' });
  }
  observer?.recordRetrievalAttempt({ tool: 'evidence-retriever', provider: retriever.name || 'local-lexical-proxy', status: evidenceWorker.output_status === 'ready' ? 'complete' : 'qualified', hit_count: evidenceWorker.guideline_evidence?.length || 0 });
  transitions.push(STATES.EVIDENCE_RETRIEVER);
  const ready = evidenceWorker.output_status === 'ready' && !safety.qualifying.length;
  if (evidenceWorker.output_status === 'ready') transitions.push(STATES.VERIFY);
  else transitions.push(STATES.CLARIFY);
  transitions.push(ready ? STATES.READY : STATES.QUALIFIED);
  const reasons = [...safety.qualifying, ...(evidenceWorker.output_status === 'ready' ? [] : evidenceWorker.qualification.reasons)];
  return { workflow_version: 'w2-active-supervisor-v1', final_state: ready ? STATES.READY : STATES.QUALIFIED, readiness: ready ? 'ready' : 'qualified', stop_reason: null, qualification: { required: !ready, reasons }, safety_checks: safety.checks, transitions, handoffs: [extractionWorker, evidenceWorker], typed_outputs: { extraction: extractionWorker.extraction, evidence: evidenceWorker } };
}

function activeStop(state, reason, transitions, extraction, evidence, safety = null) {
  return { workflow_version: 'w2-active-supervisor-v1', final_state: state, readiness: 'stopped', stop_reason: reason, qualification: { required: true, reasons: safety ? [...safety.blocking, ...safety.qualifying] : [reason] }, safety_checks: safety?.checks || null, transitions, handoffs: [extraction, ...(evidence ? [evidence] : [])], typed_outputs: { extraction: extraction.extraction, evidence } };
}

export { STATES as SUPERVISOR_STATES };
