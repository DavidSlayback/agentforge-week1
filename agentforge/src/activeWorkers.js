import { extractScanForm } from './scanFormAdapter.js';
import { SCAN_FORM_CONTRACT_VERSION, validateScanExtraction, validateWorkerHandoff } from './scanFormContracts.js';
import { retrieveGuidelineEvidence } from './guidelineEvidence.js';

const redactedMetrics = (value) => ({
  fact_count: Number(value?.facts?.length || 0),
  missing_count: Number(value?.missing_fields?.length || 0),
  uncertain_count: Number(value?.uncertain_fields?.length || 0),
  conflict_count: Number(value?.conflicts?.length || 0),
});

/**
 * Allowlisted, PHI-free view of a worker handoff for traces.
 *
 * Handoffs carry typed extraction output (lab values, dates, quotes). Trace
 * redaction is key-name based and misses keys such as `collection_date` or
 * `test_name`, so only these operational fields may reach a trace.
 */
export function traceSafeHandoff(handoff) {
  return {
    worker: handoff?.worker,
    input_type: handoff?.input_type,
    output_status: handoff?.output_status,
    retry_count: handoff?.retry_count,
    step_names: (handoff?.steps || []).map((step) => step.name),
    citation_count: handoff?.citations?.length || 0,
    redacted_metrics: handoff?.redacted_metrics,
  };
}

/** Independently testable extraction workflow with explicit inspect/act/qualify steps. */
export function runExtractionWorker({ sourceDocumentId, documentType, layoutId, pageCount = 1, content, sourceClass = 'synthetic_fixture', syntheticOnly = true, processingMode = 'deterministic_local', maxRetries = 1, adapter = extractScanForm }) {
  const steps = [{ name: 'inspect', decision: `accepted ${sourceClass} scan-form envelope` }];
  let retryCount = 0;
  let extraction = adapter({ sourceDocumentId, documentType, layoutId, pageCount, content, sourceClass, syntheticOnly, processingMode });
  steps.push({ name: 'extract', decision: `${extraction.provider}:${extraction.status}` });
  let validation = validateScanExtraction(extraction, { sourceDocumentId, documentType, layoutId });
  if (!validation.valid && retryCount < maxRetries) {
    retryCount += 1;
    extraction = adapter({ sourceDocumentId, documentType, layoutId, pageCount, content, sourceClass, syntheticOnly, processingMode });
    steps.push({ name: 'retry', decision: 'replayed provider-neutral adapter after contract mismatch' });
    validation = validateScanExtraction(extraction, { sourceDocumentId, documentType, layoutId });
  }
  const outputStatus = !validation.valid ? 'blocked' : extraction.status;
  steps.push({ name: 'validate_or_qualify', decision: validation.valid ? outputStatus : `blocked:${validation.issues.join(',')}` });
  const handoff = {
    contract_version: SCAN_FORM_CONTRACT_VERSION,
    worker: 'scan-form-extraction-worker',
    input_type: documentType,
    output_status: outputStatus,
    steps,
    retry_count: retryCount,
    citations: extraction.facts.map((fact) => fact.citation),
    redacted_metrics: redactedMetrics(extraction),
    extraction,
  };
  const handoffValidation = validateWorkerHandoff(handoff);
  return handoffValidation.valid ? handoff : { ...handoff, output_status: 'blocked', steps: [...steps, { name: 'handoff_validation', decision: handoffValidation.issues.join(',') }] };
}

/**
 * Independently testable retrieval workflow that separates patient facts from
 * guidelines. `retrieve` may be sync or async (e.g. a Cohere embed+rerank
 * retriever); the result is always awaited so an async retriever's Promise is
 * never mistaken for evidence. A retriever that throws or rejects is caught
 * here and turned into a qualified result carrying an error code, never the
 * raw exception text.
 */
export async function runEvidenceWorker({ query, patientFacts = [], documentFacts = [], retrieve = retrieveGuidelineEvidence, topK = 3 }) {
  const steps = [{ name: 'inspect', decision: 'accepted scoped evidence request' }];
  const normalizedQuery = String(query || '').trim();
  steps.push({ name: 'formulate_query', decision: normalizedQuery ? 'query_ready' : 'empty_query' });
  let guideline;
  try {
    guideline = await retrieve(normalizedQuery, { topK });
  } catch {
    guideline = { status: 'qualified', evidence: [], issues: ['guideline_retrieval_failed'] };
  }
  const evidence = guideline.evidence || [];
  const usable = evidence.filter((item) => item.citation?.source_type === 'guideline' && item.citation.source_id && item.citation.page_or_section && item.citation.quote_or_value);
  steps.push({ name: 'retrieve_and_check', decision: usable.length ? `usable_guideline_hits:${usable.length}` : 'insufficient_grounded_evidence' });
  const qualified = !normalizedQuery || !usable.length || guideline.status !== 'complete';
  steps.push({ name: 'qualify', decision: qualified ? 'withhold_unsupported_claims' : 'grounded_evidence_ready' });
  return {
    contract_version: SCAN_FORM_CONTRACT_VERSION,
    worker: 'evidence-retrieval-worker',
    input_type: 'patient-facts-and-follow-up-question',
    output_status: qualified ? 'qualified' : 'ready',
    steps,
    retry_count: 0,
    citations: usable.map((item) => item.citation),
    redacted_metrics: { patient_fact_count: patientFacts.length, document_fact_count: documentFacts.length, guideline_hit_count: usable.length, query_length: normalizedQuery.length },
    patient_facts: patientFacts,
    document_facts: documentFacts,
    guideline_evidence: usable,
    qualification: { required: qualified, reasons: qualified ? (guideline.issues || ['insufficient_evidence']) : [] },
  };
}
