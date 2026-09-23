import { fileURLToPath } from 'node:url';
import { isCoverageUnavailable, coverageGroupForField, validateRetrievalResult } from './contracts.js';
import { extractLabEvidence } from './labEvidence.js';
import { extractIntakeEvidence } from './intakeEvidence.js';
import { retrieveGuidelineEvidence } from './guidelineEvidence.js';
import { runDeterministicSupervisor } from './supervisor.js';
import { runActiveSupervisor } from './supervisor.js';
import { extractScanForm } from './scanFormAdapter.js';
import { PreVisitPreparation } from './preVisitPreparation.js';

/** Coordinates the public AgentForge facade while delegating briefing lifecycle policy. */
export class AgentForgeService {
  constructor({ adapter = null, chartAdapter = adapter, writeback = adapter, provider, conversationProvider = null, traceSink, cache, freshRetrievalDeadlineMs = 8000, allowExternalLiveProvider = false, maxPrewarmJobs = 8, prewarmDeadlineMs = 8000 }) {
    this.adapter = chartAdapter;
    this.chartAdapter = chartAdapter;
    this.writeback = writeback;
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
    const authorization = this.authorizeWriteback(request, verifiedContext);
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
    const layoutMatch = source.content.toString('utf8').match(/layout=([^|\r\n]+)/);
    const pageCountMatch = source.content.toString('utf8').match(/page_count=(\d+)/);
    const extraction = extractScanForm({ sourceDocumentId: source.source_document.id, documentType: source.source_document.document_type, layoutId: layoutMatch?.[1] || 'unknown', pageCount: Number(pageCountMatch?.[1] || 1), content: source.content });
    const observations = [];
    if (typeof this.writeback?.persistObservation !== 'function') return { status: 'failed', reason: 'OBSERVATION_WRITE_UNAVAILABLE', extraction };
    for (const fact of extraction.facts) observations.push(this.writeback.persistObservation({ patientRef: source.source_document.patient_ref, sourceDocumentId: source.source_document.id, fact }));
    return { status: 'extracted', synthetic_only: true, source_document: source.source_document, extraction, observations };
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
    const guideline = retrieveGuidelineEvidence(request.message, { topK });
    return { status: 'ready', synthetic_only: true, patient_facts: patientFacts, guideline_evidence: guideline.evidence, retrieval: { guideline_status: guideline.status, guideline_issues: guideline.issues, failed_patient_groups: failedGroups }, qualification: { required: Boolean(failedGroups.length || guideline.status !== 'complete'), reasons: [...failedGroups.map((group) => `patient_${group}_unavailable`), ...guideline.issues] } };
  }

  async runSupervisorWorkflow(request, { verifiedContext = null, intakeResult = { status: 'not_requested', facts: [] }, unsafe = false } = {}) {
    const evidence = await this.retrieveFollowUpEvidence(request, { verifiedContext });
    if (evidence.status === 'blocked') return runDeterministicSupervisor({ intakeResult, evidenceResult: null, unsafe: unsafe || evidence.reason === 'retrieval_contract_invalid' });
    return runDeterministicSupervisor({ intakeResult, evidenceResult: evidence, unsafe });
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
