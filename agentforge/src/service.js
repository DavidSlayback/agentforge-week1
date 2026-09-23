import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isCoverageUnavailable, coverageGroupForField, validateRetrievalResult } from './contracts.js';
import { extractLabEvidence } from './labEvidence.js';
import { extractIntakeEvidence } from './intakeEvidence.js';
import { retrieveGuidelineEvidence } from './guidelineEvidence.js';
import { executeSupervisorWorkflow, runActiveSupervisor } from './supervisor.js';
import { extractScanForm } from './scanFormAdapter.js';
import { PreVisitPreparation } from './preVisitPreparation.js';

/** Coordinates the public AgentForge facade while delegating briefing lifecycle policy. */
export class AgentForgeService {
  constructor({ adapter = null, chartAdapter = adapter, writeback = adapter, guidelineRetriever = null, provider, conversationProvider = null, traceSink, cache, freshRetrievalDeadlineMs = 8000, allowExternalLiveProvider = false, maxPrewarmJobs = 8, prewarmDeadlineMs = 8000 }) {
    this.adapter = chartAdapter;
    this.chartAdapter = chartAdapter;
    this.writeback = writeback;
    this.guidelineRetriever = guidelineRetriever || { name: 'local-lexical-proxy', retrieve: (query, options) => retrieveGuidelineEvidence(query, options) };
    this.provider = provider;
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

  /** W2 synthetic-only ingestion seam. */
  ingestSourceDocument(request, { verifiedContext = null } = {}) {
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-source-document', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    if (typeof this.writeback?.persistSourceDocument !== 'function') return { status: 'blocked', reason: 'synthetic_writeback_unavailable' };
    const result = this.writeback.persistSourceDocument({
      patientRef: authorization.patient_uuid,
      documentType: request.document_type,
      filename: request.filename,
      content: request.content,
      uploadedBy: authorization.clinician_uuid,
    });
    return { status: 'persisted', synthetic_only: true, duplicate: result.duplicate, source_document: result.document };
  }

  readSourceDocument(id, request, { verifiedContext = null } = {}) {
    const authorization = verifiedContext?.scope === 'write-source-document'
      ? this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-source-document', requiredAcl: 'write' })
      : this.chartAdapter.authorize ? this.chartAdapter.authorize(request, verifiedContext) : { status: 'blocked', reason: 'server_context_missing_or_invalid' };
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    if (typeof this.writeback?.getSourceDocument !== 'function') return { status: 'blocked', reason: 'synthetic_writeback_unavailable' };
    const result = this.writeback.getSourceDocument(id, { patientRef: authorization.patient_uuid });
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

  extractLabEvidence(id, request, { verifiedContext = null } = {}) {
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-source-document', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    const source = this.readSourceDocument(id, request, { verifiedContext });
    if (source.status !== 'read') return source;
    if (source.source_document.document_type !== 'lab_pdf') return { status: 'blocked', reason: 'SOURCE_DOCUMENT_TYPE_MISMATCH' };
    const extraction = extractLabEvidence({ sourceDocumentId: source.source_document.id, content: source.content });
    const observations = [];
    if (typeof this.writeback?.persistObservation !== 'function') return { status: 'failed', reason: 'OBSERVATION_WRITE_UNAVAILABLE', extraction };
    for (const fact of extraction.facts) observations.push(this.writeback.persistObservation({ patientRef: source.source_document.patient_ref, sourceDocumentId: source.source_document.id, fact }));
    return { status: 'extracted', synthetic_only: true, source_document: source.source_document, extraction, observations };
  }

  extractIntakeEvidence(id, request, { verifiedContext = null } = {}) {
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-source-document', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    const source = this.readSourceDocument(id, request, { verifiedContext });
    if (source.status !== 'read') return source;
    if (source.source_document.document_type !== 'intake_form') return { status: 'blocked', reason: 'SOURCE_DOCUMENT_TYPE_MISMATCH' };
    const extraction = extractIntakeEvidence({ sourceDocumentId: source.source_document.id, content: source.content });
    const observations = [];
    if (typeof this.writeback?.persistObservation !== 'function') return { status: 'failed', reason: 'OBSERVATION_WRITE_UNAVAILABLE', extraction };
    for (const fact of extraction.facts) observations.push(this.writeback.persistObservation({ patientRef: source.source_document.patient_ref, sourceDocumentId: source.source_document.id, fact }));
    return { status: 'extracted', synthetic_only: true, source_document: source.source_document, extraction, observations };
  }

  extractScanFormEvidence(id, request, { verifiedContext = null } = {}) {
    const source = this.readSourceDocument(id, request, { verifiedContext });
    if (source.status !== 'read') return source;
    const contentText = source.content.toString('utf8');
    const layoutMatch = contentText.match(/layout=([^|\r\n]+)/);
    const pageCountMatch = contentText.match(/page_count=(\d+)/);
    const extraction = extractScanForm({ sourceDocumentId: source.source_document.id, documentType: source.source_document.document_type, layoutId: layoutMatch?.[1] || 'unknown', pageCount: Number(pageCountMatch?.[1] || 1), content: source.content });
    return { status: 'extracted', synthetic_only: true, source_document: source.source_document, extraction, observations: [] };
  }

  runActiveSupervisorForDocument(id, request, { verifiedContext = null, query = '' } = {}) {
    const source = this.readSourceDocument(id, request, { verifiedContext });
    if (source.status !== 'read') return source;
    const contentText = source.content.toString('utf8');
    const layoutMatch = contentText.match(/layout=([^|\r\n]+)/);
    const pageCountMatch = contentText.match(/page_count=(\d+)/);
    return { status: 'completed', synthetic_only: true, source_document: source.source_document, workflow: runActiveSupervisor({ sourceDocumentId: source.source_document.id, documentType: source.source_document.document_type, layoutId: layoutMatch?.[1] || 'unknown', pageCount: Number(pageCountMatch?.[1] || 1), content: source.content, query }) };
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
              const source = this.readSourceDocument(id, workflowRequest, { verifiedContext: sourceDocumentContext });
              if (source.status !== 'read') {
                documents.push({ source_document_id: id, status: 'blocked', issue: 'source_read_blocked' });
                issues.push('source_read_blocked');
                continue;
              }
              const extracted = source.source_document.document_type === 'lab_pdf'
                ? this.extractLabEvidence(id, workflowRequest, { verifiedContext: sourceDocumentContext })
                : source.source_document.document_type === 'intake_form'
                  ? this.extractIntakeEvidence(id, workflowRequest, { verifiedContext: sourceDocumentContext })
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

function recordIsCovered(record, coverage) {
  const group = coverageGroupForField(record.field);
  const status = coverage.find((item) => item.group === group);
  return Boolean(status && status.status === 'success' && status.records > 0);
}

function recordBelongsToPatient(record, patientRef) {
  return !record?.patient_ref || String(record.patient_ref) === String(patientRef);
}

export function defaultFixturePath() { return fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url)); }
