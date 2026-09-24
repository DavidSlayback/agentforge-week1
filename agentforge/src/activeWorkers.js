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

const NON_ABNORMAL_FLAGS = new Set(['normal', 'unknown']);

/**
 * Describe a document's abnormal lab findings for the retrieval query, e.g.
 * `"Abnormal findings: A1C abnormal, Hemoglobin low."`. Normal and
 * unreadable (`unknown`) flags are excluded — an evidence query built from
 * "everything the form mentions" would drown a genuinely abnormal result in
 * noise from the tests that came back fine.
 */
function abnormalLabPhrase(labResults) {
  const abnormal = (labResults || []).filter((result) => result?.test_name && result.abnormal_flag && !NON_ABNORMAL_FLAGS.has(result.abnormal_flag));
  if (!abnormal.length) return '';
  return `Abnormal findings: ${abnormal.map((result) => `${result.test_name} ${result.abnormal_flag}`).join(', ')}.`;
}

/** Describe the intake form's chief concern for the retrieval query, or '' when it was never observed on the form. */
function chiefConcernPhrase(intakeForm) {
  const field = intakeForm?.chief_concern;
  if (!field || field.status !== 'observed' || !field.value) return '';
  return `Chief concern: ${field.value}.`;
}

/**
 * Build the guideline-retrieval query from the extraction's own typed
 * output, not from whatever text the client happened to send.
 *
 * The primary signal is the document's abnormal lab findings and the
 * intake's chief concern — both grounded in what was actually extracted.
 * `clinicianQuestion` (the client-supplied free-text `message`) is appended
 * only as an optional, secondary refinement; when there is no typed
 * evidence to build from (no lab results, no intake form, or none of their
 * fields are abnormal/observed), the formulated query is exactly the
 * clinician's question, unchanged.
 */
export function formulateEvidenceQuery({ labResults = [], intakeForm = null, clinicianQuestion = '' } = {}) {
  const formulated = [abnormalLabPhrase(labResults), chiefConcernPhrase(intakeForm)].filter(Boolean).join(' ');
  const question = String(clinicianQuestion || '').trim();
  return [formulated, question].filter(Boolean).join(' ');
}

/**
 * Independently testable retrieval workflow that separates patient facts from
 * guidelines. `retrieve` may be sync or async (e.g. the Gemini hybrid
 * retriever); the result is always awaited so an async retriever's Promise is
 * never mistaken for evidence. A retriever that throws or rejects is caught
 * here and turned into a qualified result carrying an error code, never the
 * raw exception text.
 *
 * `extraction` (the scan-form extraction worker's typed output, carrying
 * `lab_results`/`intake_form`) and `clinicianQuestion` (the client's raw
 * `message`, if any) feed `formulateEvidenceQuery` — this worker owns query
 * formulation, not its callers.
 */
export async function runEvidenceWorker({ clinicianQuestion = '', patientFacts = [], documentFacts = [], extraction = null, retrieve = retrieveGuidelineEvidence, topK = 3 }) {
  const steps = [{ name: 'inspect', decision: 'accepted scoped evidence request' }];
  const normalizedQuery = formulateEvidenceQuery({ labResults: extraction?.lab_results, intakeForm: extraction?.intake_form, clinicianQuestion });
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
  const documentFactsOut = documentFacts.length ? documentFacts : extraction?.facts || [];
  return {
    contract_version: SCAN_FORM_CONTRACT_VERSION,
    worker: 'evidence-retrieval-worker',
    input_type: 'patient-facts-and-follow-up-question',
    output_status: qualified ? 'qualified' : 'ready',
    steps,
    retry_count: 0,
    citations: usable.map((item) => item.citation),
    redacted_metrics: { patient_fact_count: patientFacts.length, document_fact_count: documentFactsOut.length, guideline_hit_count: usable.length, query_length: normalizedQuery.length },
    patient_facts: patientFacts,
    document_facts: documentFactsOut,
    guideline_evidence: usable,
    // Surfaced so a caller can trace the retriever's *actual* mode (never a
    // hard-coded default) and forward per-call model usage without needing
    // to know which retriever produced this result.
    provider: guideline.provider || null,
    degraded: guideline.degraded ?? null,
    usage: guideline.usage || null,
    qualification: { required: qualified, reasons: qualified ? (guideline.issues || ['insufficient_evidence']) : [] },
  };
}
