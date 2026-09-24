import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isCoverageUnavailable, coverageGroupForField, validateRetrievalResult } from './contracts.js';
import { extractLabEvidence } from './labEvidence.js';
import { extractIntakeEvidence } from './intakeEvidence.js';
import { retrieveGuidelineEvidence } from './guidelineEvidence.js';
import { executeSupervisorWorkflow, runActiveSupervisor } from './supervisor.js';
import { traceSafeHandoff } from './activeWorkers.js';
import { extractScanForm } from './scanFormAdapter.js';
import { extractPdfScanFixture } from './pdfScanAdapter.js';
import { PreVisitPreparation } from './preVisitPreparation.js';
import { recordBelongsToPatient } from './recordScope.js';

/** Coordinates the public AgentForge facade while delegating briefing lifecycle policy. */
export class AgentForgeService {
  constructor({ adapter = null, chartAdapter = adapter, writeback = adapter, guidelineRetriever = null, provider, conversationProvider = null, scanProvider = null, ocrEngine = null, patientDemographics = chartAdapter, traceSink, cache, freshRetrievalDeadlineMs = 8000, allowExternalLiveProvider = false, maxPrewarmJobs = 8, prewarmDeadlineMs = 8000 }) {
    this.adapter = chartAdapter;
    // null keeps the pdfScanAdapter default (real pdftoppm + Tesseract).
    this.ocrEngine = ocrEngine;
    // PatientDemographicsSource: any object with getPatientDemographics(patientRef) → {name, dob} | null.
    this.patientDemographics = patientDemographics;
    this.chartAdapter = chartAdapter;
    this.writeback = writeback;
    this.guidelineRetriever = guidelineRetriever || { name: 'local-lexical-proxy', retrieve: (query, options) => retrieveGuidelineEvidence(query, options) };
    this.provider = provider;
    this.scanProvider = scanProvider;
    this.scanPreparations = new Map();
    this.traceSink = traceSink;
    this.preparation = new PreVisitPreparation({ adapter: chartAdapter, provider, conversationProvider, traceSink, cache, freshRetrievalDeadlineMs, allowExternalLiveProvider, maxPrewarmJobs, prewarmDeadlineMs });
    // Preserve the established facade access used by callers and tests while
    // keeping cache ownership inside the preparation module.
    this.cache = this.preparation.cache;
  }

  get conversationProvider() {
    return this.preparation.conversationProvider;
  }

  set conversationProvider(value) {
    this.preparation.conversationProvider = value;
  }

  /** W2 source-document ingestion; the writeback decides where it persists (in-memory synthetic store or the OpenEMR module). */
  async ingestSourceDocument(request, { verifiedContext = null } = {}) {
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-source-document', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    if (typeof this.writeback?.persistSourceDocument !== 'function') return { status: 'blocked', reason: 'synthetic_writeback_unavailable' };
    const result = await this.writeback.persistSourceDocument({
      patientRef: authorization.patient_uuid,
      documentType: request.document_type,
      filename: request.filename,
      content: request.content,
      uploadedBy: authorization.clinician_uuid,
      verifiedContext,
    });
    return { status: 'persisted', synthetic_only: true, duplicate: result.duplicate, source_document: result.document, ...(result.document.openemr ? { openemr: result.document.openemr } : {}) };
  }

  /**
   * After a validated extraction: persist derived facts (and lab rows) when the
   * writeback is OpenEMR-backed; null otherwise. It is a write, so the caller's
   * own context must be write-scoped; a read context gets an explicit
   * not_persisted result, never a silent success.
   */
  async persistDerivedEvidence(sourceDocument, extraction, request, { verifiedContext = null } = {}) {
    if (typeof this.writeback?.persistDerivedEvidence !== 'function') return null;
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-source-document', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'not_persisted', reason: 'persistence_not_authorized', authorization: authorization.reason, persistence_boundary: this.writeback.persistenceBoundary };
    return this.writeback.persistDerivedEvidence({ patientRef: authorization.patient_uuid, sourceDocument, extraction, verifiedContext });
  }

  async readOpenEMRLabObservations(id, request, { verifiedContext = null } = {}) {
    const authorization = this.chartAdapter.authorize ? this.chartAdapter.authorize(request, verifiedContext) : { status: 'blocked', reason: 'server_context_missing_or_invalid' };
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    if (typeof this.writeback?.readLabObservations !== 'function') return { status: 'blocked', reason: 'openemr_persistence_not_configured' };
    return { status: 'read', bundle: await this.writeback.readLabObservations(id, { patientRef: authorization.patient_uuid, verifiedContext }) };
  }

  async readSourceDocument(id, request, { verifiedContext = null } = {}) {
    const authorization = verifiedContext?.scope === 'write-source-document'
      ? this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-source-document', requiredAcl: 'write' })
      : this.chartAdapter.authorize ? this.chartAdapter.authorize(request, verifiedContext) : { status: 'blocked', reason: 'server_context_missing_or_invalid' };
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    if (typeof this.writeback?.getSourceDocument !== 'function') return { status: 'blocked', reason: 'synthetic_writeback_unavailable' };
    const result = await this.writeback.getSourceDocument(id, { patientRef: authorization.patient_uuid, verifiedContext });
    return { status: 'read', synthetic_only: true, source_document: result.document, content: result.content };
  }

  draftClinicalAction(request, { verifiedContext = null } = {}) {
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-clinical-action', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    if (typeof this.writeback?.draftClinicalAction !== 'function') return { status: 'blocked', reason: 'clinical_action_write_unavailable' };
    const result = this.writeback.draftClinicalAction({ patientRef: authorization.patient_uuid, clinicianRef: authorization.clinician_uuid, actionType: request.action_type, instruction: request.instruction, instructionSource: request.instruction_source });
    return { status: 'drafted', synthetic_only: true, duplicate: result.duplicate, action: result.action };
  }

  confirmClinicalAction(id, request, { verifiedContext = null } = {}) {
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-clinical-action', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    if (typeof this.writeback?.confirmClinicalAction !== 'function') return { status: 'blocked', reason: 'clinical_action_write_unavailable' };
    const result = this.writeback.confirmClinicalAction(id, { patientRef: authorization.patient_uuid, clinicianRef: authorization.clinician_uuid, confirmationEvent: request.confirmation_event });
    return { status: result.status, synthetic_only: true, duplicate: result.duplicate, action: result.action, ...(result.cancellation_event_id ? { cancellation_event_id: result.cancellation_event_id } : {}) };
  }

  readClinicalAction(id, request, { verifiedContext = null } = {}) {
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-clinical-action', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    if (typeof this.writeback?.getClinicalAction !== 'function') return { status: 'blocked', reason: 'clinical_action_read_unavailable' };
    const result = this.writeback.getClinicalAction(id, { patientRef: authorization.patient_uuid, clinicianRef: authorization.clinician_uuid });
    return { status: 'read', synthetic_only: true, action: result.action };
  }

  async extractLabEvidence(id, request, { verifiedContext = null } = {}) {
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-source-document', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    const source = await this.readSourceDocument(id, request, { verifiedContext });
    if (source.status !== 'read') return source;
    if (source.source_document.document_type !== 'lab_pdf') return { status: 'blocked', reason: 'SOURCE_DOCUMENT_TYPE_MISMATCH' };
    const extraction = extractLabEvidence({ sourceDocumentId: source.source_document.id, content: source.content });
    const observations = [];
    if (typeof this.writeback?.persistObservation !== 'function') return { status: 'failed', reason: 'OBSERVATION_WRITE_UNAVAILABLE', extraction };
    for (const fact of extraction.facts) observations.push(this.writeback.persistObservation({ patientRef: source.source_document.patient_ref, sourceDocumentId: source.source_document.id, fact }));
    return { status: 'extracted', synthetic_only: true, source_document: source.source_document, extraction, observations };
  }

  async extractIntakeEvidence(id, request, { verifiedContext = null } = {}) {
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-source-document', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    const source = await this.readSourceDocument(id, request, { verifiedContext });
    if (source.status !== 'read') return source;
    if (source.source_document.document_type !== 'intake_form') return { status: 'blocked', reason: 'SOURCE_DOCUMENT_TYPE_MISMATCH' };
    const extraction = extractIntakeEvidence({ sourceDocumentId: source.source_document.id, content: source.content });
    const observations = [];
    if (typeof this.writeback?.persistObservation !== 'function') return { status: 'failed', reason: 'OBSERVATION_WRITE_UNAVAILABLE', extraction };
    for (const fact of extraction.facts) observations.push(this.writeback.persistObservation({ patientRef: source.source_document.patient_ref, sourceDocumentId: source.source_document.id, fact }));
    return { status: 'extracted', synthetic_only: true, source_document: source.source_document, extraction, observations };
  }

  async extractScanFormEvidence(id, request, { verifiedContext = null } = {}) {
    const source = await this.readSourceDocument(id, request, { verifiedContext });
    if (source.status !== 'read') return source;
    const prepared = await this.prepareScanSource(source);
    const pdf = Boolean(prepared.pdf);
    const content = prepared.content;
    const contentText = content.toString('utf8');
    const layoutMatch = contentText.match(/layout=([^|\r\n]+)/);
    const pageCountMatch = contentText.match(/page_count=(\d+)/);
    const extraction = extractScanForm({ sourceDocumentId: source.source_document.id, documentType: source.source_document.document_type, layoutId: layoutMatch?.[1] || (pdf ? `pdf-ocr-${source.source_document.document_type}` : 'unknown'), pageCount: Number(pageCountMatch?.[1] || prepared.pageCount || 1), content });
    if (pdf) extraction.provider = prepared.provider;
    return { status: 'extracted', synthetic_only: true, source_document: source.source_document, extraction, observations: [], ...(pdf ? { pdf_ocr: { page_count: prepared.pageCount, candidate_fields: prepared.candidateFields } } : {}) };
  }

  async runActiveSupervisorForDocument(id, request, { verifiedContext = null, query = '' } = {}) {
    let source;
    try {
      source = await this.readSourceDocument(id, request, { verifiedContext });
    } catch (error) {
      if ((error.code || error.message) === 'DOCUMENT_SCOPE_MISMATCH') return { status: 'blocked', reason: 'document_scope_mismatch' };
      throw error;
    }
    if (source.status !== 'read') return source;
    const trace = this.traceSink?.start?.({ correlationId: `w2-scan-${randomUUID()}`, operation: 'w2-scan-supervisor', interactionType: 'scan_form', scope: { patientRef: request.patient_uuid } });
    try {
      trace?.startStage('source_preparation');
      let prepared;
      try {
        prepared = await this.prepareScanSource(source);
        trace?.finishStage('source_preparation', { status: 'complete' });
      } catch (error) {
        const errorCode = error.code || String(error.message || '').split(':')[0];
        trace?.finishStage('source_preparation', { status: 'failed', errorCode: errorCode || 'source_preparation_failed' });
        if (isUnreadableDocumentError(errorCode)) {
          trace?.complete({ status: 'blocked' });
          return { status: 'unreadable', synthetic_only: true, reason: 'document_unreadable', final_state: 'BLOCKED', source_document: source.source_document };
        }
        throw error;
      }
      const pdf = Boolean(prepared.pdf);
      const content = prepared.content;
      const contentText = content.toString('utf8');
      const layoutMatch = contentText.match(/layout=([^|\r\n]+)/);
      const pageCountMatch = contentText.match(/page_count=(\d+)/);
      const targetPatient = await this.patientDemographics?.getPatientDemographics?.(source.source_document.patient_ref) ?? null;
      const workflow = await runActiveSupervisor({ sourceDocumentId: source.source_document.id, documentType: source.source_document.document_type, layoutId: layoutMatch?.[1] || (pdf ? `pdf-ocr-${source.source_document.document_type}` : 'unknown'), pageCount: Number(pageCountMatch?.[1] || prepared.pageCount || 1), content, query, observer: trace, documentText: pdf ? prepared.ocrText : contentText, targetPatient });
      if (pdf) workflow.typed_outputs.extraction.provider = prepared.provider;
      for (const handoff of workflow.handoffs || []) trace?.recordHandoff(traceSafeHandoff(handoff));
      trace?.setEvaluation({ status: 'not_run', reason: 'the golden-set gate runs separately from an individual document workflow' });
      trace?.complete({ status: workflow.readiness === 'stopped' ? 'failure' : 'success' });
      return { status: 'completed', synthetic_only: true, source_document: source.source_document, workflow, ...(pdf ? { pdf_ocr: { page_count: prepared.pageCount, candidate_fields: prepared.candidateFields } } : {}) };
    } catch (error) {
      trace?.complete({ status: 'failure' });
      throw error;
    }
  }

  async prepareScanSource(source) {
    const id = source.source_document.id;
    const cached = this.scanPreparations.get(id);
    if (cached) return cached;
    const pdf = source.content.subarray(0, 5).toString() === '%PDF-';
    const prepared = Promise.resolve().then(async () => pdf
      ? { ...(await extractPdfScanFixture({ content: source.content, documentType: source.source_document.document_type, scanProvider: this.scanProvider, ...(this.ocrEngine ? { ocrEngine: this.ocrEngine } : {}) })), pdf: true }
      : { content: source.content, pageCount: 1, pdf: false });
    if (this.scanPreparations.size >= 50) this.scanPreparations.delete(this.scanPreparations.keys().next().value);
    this.scanPreparations.set(id, prepared);
    try {
      return await prepared;
    } catch (error) {
      if (this.scanPreparations.get(id) === prepared) this.scanPreparations.delete(id);
      throw error;
    }
  }

  async retrieveFollowUpEvidence(request, { verifiedContext = null, topK = 3 } = {}) {
    const authorization = this.chartAdapter.authorize ? this.chartAdapter.authorize(request, verifiedContext) : { status: 'blocked', reason: 'server_context_missing_or_invalid' };
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    const item = await this.chartAdapter.getCase(authorization.patient_uuid, request.case_id);
    const retrieved = await this.chartAdapter.retrieve(item);
    const validation = validateRetrievalResult(retrieved);
    if (!validation.valid) return { status: 'blocked', reason: 'retrieval_contract_invalid' };
    const patientFacts = retrieved.records.filter((record) => recordBelongsToPatient(record, item.patient.patient_ref) && recordIsCovered(record, retrieved.coverage)).map((record) => ({ source_type: 'patient_record', patient_ref: item.patient.patient_ref, source_id: record.source_ref, field: record.field, value: record.value, recorded_at: record.recorded_at, author: record.author }));
    const failedGroups = retrieved.coverage.filter((group) => isCoverageUnavailable(group.status)).map((group) => group.group);
    let guideline;
    try {
      guideline = await this.guidelineRetriever.retrieve(request.message, { topK });
    } catch (error) {
      guideline = { status: 'qualified', provider: this.guidelineRetriever.name || 'unknown', evidence: [], issues: [error.message || 'retrieval_failed'] };
    }
    return { status: 'ready', synthetic_only: true, patient_facts: patientFacts, guideline_evidence: guideline.evidence, retrieval: { guideline_provider: guideline.provider || this.guidelineRetriever.name || 'local-lexical-proxy', guideline_status: guideline.status, guideline_issues: guideline.issues, guideline_usage: guideline.usage || null, failed_patient_groups: failedGroups }, qualification: { required: Boolean(failedGroups.length || guideline.status !== 'complete'), reasons: [...failedGroups.map((group) => `patient_${group}_unavailable`), ...guideline.issues] } };
  }

  async runSupervisorWorkflow(request, { verifiedContext = null, sourceDocumentContext = null, unsafe = false } = {}) {
    const sourceDocumentIds = request.source_document_ids || [];
    const trace = this.traceSink?.start?.({ correlationId: `w2-${randomUUID()}`, operation: 'w2-supervisor', interactionType: 'follow_up', scope: { patientRef: request.patient_uuid } });
    const workflow = await executeSupervisorWorkflow({
      request,
      sourceDocumentIds,
      unsafe,
      workers: {
        intakeExtractor: async ({ request: workflowRequest, sourceDocumentIds: ids }) => {
          trace?.startStage('extraction');
          let result;
          try {
            if (!sourceDocumentContext) return { status: 'blocked', facts: [], documents: [], issues: ['synthetic_source_context_required'] };
            const documents = [];
            const facts = [];
            const issues = [];
            for (const id of ids) {
              const source = await this.readSourceDocument(id, workflowRequest, { verifiedContext: sourceDocumentContext });
              if (source.status !== 'read') {
                documents.push({ source_document_id: id, status: 'blocked', issue: 'source_read_blocked' });
                issues.push('source_read_blocked');
                continue;
              }
              const extracted = source.source_document.document_type === 'lab_pdf'
                ? await this.extractLabEvidence(id, workflowRequest, { verifiedContext: sourceDocumentContext })
                : source.source_document.document_type === 'intake_form'
                  ? await this.extractIntakeEvidence(id, workflowRequest, { verifiedContext: sourceDocumentContext })
                  : { status: 'blocked', reason: 'source_type_unsupported' };
              const extraction = extracted.extraction;
              documents.push({ source_document_id: id, document_type: source.source_document.document_type, status: extracted.status, fact_count: extraction?.facts?.length || 0, issue_count: extraction?.issues?.length || 0 });
              if (extracted.status !== 'extracted') issues.push(extracted.reason || 'extraction_failed');
              facts.push(...(extraction?.facts || []));
            }
            const status = issues.length ? (facts.length ? 'qualified' : 'blocked') : documents.some((item) => item.status === 'extracted' && item.issue_count > 0) ? 'qualified' : 'complete';
            result = { status, facts, documents, issues: [...new Set(issues)] };
            trace?.setExtraction({ status, confidence: null, document_count: documents.length, fact_count: facts.length, issue_count: issues.length });
            return result;
          } finally {
            trace?.finishStage('extraction', { status: result?.status || 'blocked' });
          }
        },
        evidenceRetriever: async (workflowRequest) => {
          trace?.startStage('retrieval');
          let evidence;
          try {
            evidence = await this.retrieveFollowUpEvidence(workflowRequest, { verifiedContext });
            trace?.recordRetrievalAttempt({ tool: 'evidence-retriever', provider: evidence.retrieval?.guideline_provider, status: evidence.retrieval?.guideline_status, hit_count: evidence.guideline_evidence?.length || 0, usage: evidence.retrieval?.guideline_usage || null });
            return evidence;
          } finally {
            trace?.finishStage('retrieval', { status: evidence?.status || 'blocked' });
          }
        },
      },
    });
    for (const handoff of workflow.handoffs || []) trace?.recordHandoff(handoff);
    trace?.setEvaluation({ status: 'not_run', reason: 'the golden-set gate runs in CI, not per encounter' });
    trace?.complete({ status: workflow.readiness === 'stopped' ? 'failure' : 'success' });
    return workflow;
  }

  prepare(...args) { return this.preparation.prepare(...args); }

  prewarm(...args) { return this.preparation.prewarm(...args); }

  openPrepared(...args) { return this.preparation.openPrepared(...args); }

  followUp(...args) { return this.preparation.followUp(...args); }

  authorizeWriteback(request, verifiedContext, options = {}) {
    return this.writeback?.authorize
      ? this.writeback.authorize(request, verifiedContext, options)
      : { status: 'blocked', reason: 'synthetic_writeback_unavailable' };
  }
}

// Faults of the uploaded file itself. PDF_OCR_RUNTIME_UNAVAILABLE (missing
// binaries) is an operational failure and still surfaces as a 500.
function isUnreadableDocumentError(code) {
  return ['SOURCE_DOCUMENT_PDF_INVALID', 'PDF_PAGE_LIMIT_EXCEEDED', 'PDF_OCR_COMMAND_FAILED', 'PDF_OCR_COMMAND_TIMEOUT', 'PDF_OCR_OUTPUT_LIMIT_EXCEEDED'].includes(code);
}

function recordIsCovered(record, coverage) {
  const group = coverageGroupForField(record.field);
  const status = coverage.find((item) => item.group === group);
  return Boolean(status && status.status === 'success' && status.records > 0);
}

export function defaultFixturePath() { return fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url)); }
