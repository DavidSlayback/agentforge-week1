import { runEvidenceWorker, runExtractionWorker } from './activeWorkers.js';
import { assessDocumentSafety } from './documentSafety.js';

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
 */
export function runActiveSupervisor({ sourceDocumentId, documentType, layoutId, pageCount = 1, content, sourceClass = 'synthetic_fixture', syntheticOnly = true, processingMode = 'deterministic_local', query, patientFacts = [], extractionAdapter, retrievalAdapter, observer = null, documentText = '', targetPatient = null } = {}) {
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
  const safety = assessDocumentSafety({ documentType, documentText, extraction: extractionWorker.extraction, targetPatient });
  if (safety.blocking.length) return activeStop(STATES.BLOCKED, safety.blocking[0], transitions, extractionWorker, null, safety);
  observer?.startStage('retrieval');
  let evidenceWorker;
  try {
    evidenceWorker = runEvidenceWorker({ query, patientFacts, documentFacts: extractionWorker.extraction.facts, ...(retrievalAdapter ? { retrieve: retrievalAdapter } : {}) });
  } finally {
    observer?.finishStage('retrieval', { status: evidenceWorker?.output_status || 'failed' });
  }
  observer?.recordRetrievalAttempt({ tool: 'evidence-retriever', provider: 'local-lexical-proxy', status: evidenceWorker.output_status === 'ready' ? 'complete' : 'qualified', hit_count: evidenceWorker.guideline_evidence?.length || 0 });
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
