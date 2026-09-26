import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isCoverageUnavailable, coverageGroupForField, validateRetrievalResult } from './contracts.js';
import { localLexicalGuidelineRetriever } from './guidelineEvidence.js';
import { runActiveSupervisor } from './supervisor.js';
import { traceSafeHandoff } from './activeWorkers.js';
import { extractScanForm } from './scanFormAdapter.js';
import { ALTERNATE_OCR_MODE, DEFAULT_OCR_MODE, extractPdfScanFixture } from './pdfScanAdapter.js';
import { chartReadOrigin, chartRecordCitationSource, isLiveChartRead } from './chartSource.js';
import { resolveChartAdapter, selectChartSource } from './chartSourceRouter.js';
import { mentionsOtherPatient } from './patientMentions.js';
import { findUntrustedNarrative } from './recordTrust.js';
import { PreVisitPreparation } from './preVisitPreparation.js';
import { recordBelongsToPatient } from './recordScope.js';
import { composeGroundedAnswer, DeterministicAnswerComposer, partitionAnswerInputs } from './answerComposer.js';
import { applyCriticVerdicts, criticAppliedSummary, criticNotRunSummary, DEFAULT_CRITIC_TIMEOUT_MS, runCriticWorker } from './critic.js';
import { computeRuntimeEvaluation } from './runtimeEvaluation.js';
import { labResultsForModule } from './openemrModuleWriteback.js';
import { buildLabTrends } from './labTrend.js';

/** Coordinates the public AgentForge facade while delegating briefing lifecycle policy. */
export class AgentForgeService {
  constructor({ adapter = null, chartAdapter = adapter, writeback = adapter, guidelineRetriever = null, provider, conversationProvider = null, answerProvider = null, scanProvider = null, ocrEngine = null, patientDemographics = chartAdapter, traceSink, cache, freshRetrievalDeadlineMs = 8000, allowExternalLiveProvider = false, maxPrewarmJobs = 8, prewarmDeadlineMs = 8000, scanDeadlineMs = 25000, criticProvider = null, criticTimeoutMs = DEFAULT_CRITIC_TIMEOUT_MS, criticDisabledReason = null, now = () => Date.now() }) {
    this.adapter = chartAdapter;
    // null keeps the pdfScanAdapter default (real pdftoppm + Tesseract).
    this.ocrEngine = ocrEngine;
    // PatientDemographicsSource: any object with getPatientDemographics(patientRef) → {name, dob} | null.
    this.patientDemographics = patientDemographics;
    this.chartAdapter = chartAdapter;
    this.writeback = writeback;
    this.guidelineRetriever = guidelineRetriever || localLexicalGuidelineRetriever;
    this.provider = provider;
    // The W2 grounded-answer composer's model provider (answerComposer.js).
    // Distinct from `provider` (briefing synthesis): its fallback must be a
    // `DeterministicAnswerComposer`, not the briefing-shaped `DeterministicProvider`.
    // `null` means every scan-supervisor answer uses the deterministic composer.
    this.answerProvider = answerProvider;
    // F8 review fix: honored the same way PreVisitPreparation honors it for
    // briefings -- a live OpenEMR chart adapter with no explicit external-
    // provider approval forces the deterministic composer, never a real model.
    this.allowExternalLiveProvider = allowExternalLiveProvider;
    // F6 review fix: a per-scan-request deadline. Its AbortSignal is passed to
    // the low-confidence OCR retry and to the answer composer's provider call;
    // once it fires, the answer is composed deterministically
    // (`model_rejected_reason: 'deadline'`) rather than hanging the request.
    this.scanDeadlineMs = scanDeadlineMs;
    // E2 critic (critic.js): an LLM that can only veto answer claims. `null`
    // means disabled, and every scan answer is labeled `critic_status:
    // 'disabled'` with `criticDisabledReason`. It runs only when the time
    // left before `scanDeadlineMs` is at least `criticTimeoutMs`.
    this.criticProvider = criticProvider;
    this.criticTimeoutMs = criticTimeoutMs;
    this.criticDisabledReason = criticDisabledReason;
    this.now = now;
    this.scanProvider = scanProvider;
    this.scanPreparations = new Map();
    // Backs the supervisor's `extraction_cached` decision: one extraction
    // handoff cached per content-hash + OCR mode, shared across calls to this
    // service instance (supervisor.js keeps its own default when a caller
    // does not pass one, so this is additive/opt-in).
    this.extractionCache = new Map();
    // F6 review fix: which OCR mode's preparation actually produced the
    // typed facts a document's workflow shipped (the low-confidence retry
    // can upgrade this mid-request) -- `prepareScanSource` and the source
    // preview/scan-form-evidence routes must render *that* preparation's
    // boxes, not silently default back to the initial mode.
    this.resolvedOcrMode = new Map();
    this.traceSink = traceSink;
    this.preparation = new PreVisitPreparation({ adapter: chartAdapter, provider, conversationProvider, traceSink, cache, freshRetrievalDeadlineMs, allowExternalLiveProvider, maxPrewarmJobs, prewarmDeadlineMs, now });
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
  async persistDerivedEvidence(sourceDocument, extraction, request, { verifiedContext = null, finalState } = {}) {
    if (typeof this.writeback?.persistDerivedEvidence !== 'function') return null;
    // E5, fail closed: derived facts and lab rows are written only for a
    // READY or QUALIFIED workflow. A BLOCKED one (e.g. a lab report whose
    // header names another patient) writes nothing, and a missing state throws.
    if (!workflowMayPersist(finalState)) return { status: 'not_persisted', reason: finalState === 'BLOCKED' ? 'workflow_blocked' : 'workflow_not_ready', persistence_boundary: this.writeback.persistenceBoundary };
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

  /**
   * E5 lab trends for the authorized patient, built only from the
   * persistence layer's read-back (OpenEMR through the module, or the
   * in-memory synthetic store in fixture mode), never from an upload response.
   */
  async readLabTrends(request, { verifiedContext = null } = {}) {
    const authorization = this.chartAdapter.authorize ? this.chartAdapter.authorize(request, verifiedContext) : { status: 'blocked', reason: 'server_context_missing_or_invalid' };
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    if (typeof this.writeback?.readLabObservationHistory !== 'function') return { status: 'blocked', reason: 'lab_history_not_configured' };
    const history = await this.writeback.readLabObservationHistory({ patientRef: authorization.patient_uuid, verifiedContext });
    return { status: 'read', synthetic_only: true, patient_uuid: authorization.patient_uuid, ...buildLabTrends(history) };
  }

  /**
   * Fixture mode only: after a validated lab extraction, keep its lab rows in
   * the in-memory synthetic store so the trend chart has a read-back. The
   * OpenEMR module path writes lab rows in `persistDerivedEvidence` instead,
   * so this returns null there. A BLOCKED workflow stores nothing.
   */
  async recordSyntheticLabHistory(sourceDocument, extraction, request, { verifiedContext = null, finalState } = {}) {
    if (typeof this.writeback?.persistSyntheticLabObservations !== 'function' || sourceDocument?.document_type !== 'lab_pdf') return null;
    if (!workflowMayPersist(finalState)) return { status: 'not_persisted', reason: finalState === 'BLOCKED' ? 'workflow_blocked' : 'workflow_not_ready', persistence_boundary: 'in-memory-synthetic' };
    const authorization = this.authorizeWriteback(request, verifiedContext, { requiredScope: 'write-source-document', requiredAcl: 'write' });
    if (authorization.status !== 'authorized') return { status: 'not_persisted', reason: 'persistence_not_authorized', persistence_boundary: 'in-memory-synthetic' };
    const mapped = labResultsForModule(extraction);
    if (!mapped.results.length) return { status: 'not_persisted', reason: 'no_mappable_lab_results', persistence_boundary: 'in-memory-synthetic', unmapped_lab_results: mapped.unmapped };
    return { ...this.writeback.persistSyntheticLabObservations({ patientRef: authorization.patient_uuid, sourceDocument, rows: mapped.results }), unmapped_lab_results: mapped.unmapped };
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

  async extractScanFormEvidence(id, request, { verifiedContext = null } = {}) {
    const source = await this.readSourceDocument(id, request, { verifiedContext });
    if (source.status !== 'read') return source;
    const egress = this.externalEgressFor(verifiedContext);
    if (egress.status === 'blocked') return egress;
    const prepared = await this.prepareScanSource(source, { allowExternalScan: egress.allowed });
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
    // E9: the chart this scan's answer reads, from the verified claims only.
    // An OpenEMR-session request with live reads off is refused here, loudly;
    // it never falls back to the fixture chart.
    const chartSelection = selectChartSource(this.chartAdapter, verifiedContext);
    if (chartSelection.status !== 'selected') return { status: 'blocked', reason: chartSelection.reason };
    const chartReader = chartSelection.adapter;
    const chartRead = { chart_source: chartSelection.chart_source, label: chartSelection.label, status: 'not_read', reason: null };
    // F8 review fix, extended by E9: a live OpenEMR read with no explicit
    // external-provider approval makes no outbound call at all: no answer
    // model, no critic, no external OCR, and a local-only guideline
    // retriever (no embed or rerank call).
    const liveExternalBlocked = isLiveChartRead(chartReader) && !this.allowExternalLiveProvider;
    const guidelineRetriever = liveExternalBlocked ? localLexicalGuidelineRetriever : this.guidelineRetriever;
    let source;
    try {
      source = await this.readSourceDocument(id, request, { verifiedContext });
    } catch (error) {
      if ((error.code || error.message) === 'DOCUMENT_SCOPE_MISMATCH') return { status: 'blocked', reason: 'document_scope_mismatch' };
      throw error;
    }
    if (source.status !== 'read') return source;
    const trace = this.traceSink?.start?.({ correlationId: `w2-scan-${randomUUID()}`, operation: 'w2-scan-supervisor', interactionType: 'scan_form', scope: { patientRef: request.patient_uuid } });
    // F6 review fix: a per-request deadline whose AbortSignal is passed to the
    // low-confidence OCR retry and to the answer composer's provider call, so
    // a slow retry or a slow model cannot hang the request indefinitely --
    // once it fires, both fall back to their safe, synchronous defaults.
    const deadline = new AbortController();
    const requestStartedAt = this.now();
    const deadlineTimer = setTimeout(() => deadline.abort(new Error('SCAN_DEADLINE_EXCEEDED')), this.scanDeadlineMs);
    try {
      trace?.startStage('source_preparation');
      let prepared;
      try {
        prepared = await this.prepareScanSource(source, { allowExternalScan: !liveExternalBlocked });
        trace?.finishStage('source_preparation', { status: 'complete' });
      } catch (error) {
        const errorCode = error.code || String(error.message || '').split(':')[0];
        trace?.finishStage('source_preparation', { status: 'failed', errorCode: errorCode || 'source_preparation_failed' });
        if (isUnreadableDocumentError(errorCode)) {
          // The document never reached extraction, so there is no answer to
          // grade -- the same `computeRuntimeEvaluation` "fail-loud refusal"
          // branch used for every other BLOCKED stop below.
          const { evaluation, verification } = computeRuntimeEvaluation({ workflow: { readiness: 'stopped', final_state: 'BLOCKED', stop_reason: 'document_unreadable', qualification: { required: true, reasons: ['document_unreadable'] } } });
          trace?.setEvaluation(evaluation);
          trace?.setVerification(verification);
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
      // The default demographics source is the chart adapter, so it follows
      // the request's chart source; an explicitly injected one is kept.
      const demographicsSource = this.patientDemographics === this.chartAdapter ? chartReader : this.patientDemographics;
      let targetPatient = null;
      try {
        targetPatient = await demographicsSource?.getPatientDemographics?.(source.source_document.patient_ref) ?? null;
      } catch (error) {
        // Identity then reads `unverified`, never a match; the reason is kept.
        chartRead.identity_error = error.code || 'demographics_read_failed';
      }
      // W1-SF4: a question naming another patient gets no answer. The
      // document's own extraction still runs and is stored; only the answer
      // is refused, and the question is not sent to retrieval either.
      const answerRefused = await this.questionNamesOtherPatient(query, source.source_document.patient_ref, chartReader);
      const answerQuery = answerRefused ? '' : query;
      let answerParts = null;
      const composeAnswer = async ({ extraction, evidence }) => {
        trace?.startStage('answer');
        let answer = null;
        try {
          // A chart read failure leaves the answer without chart facts, and
          // says so in `chart_source` and the trace; it is never silent.
          const chart = await this.retrievePatientChartFacts(source.source_document.patient_ref, null, { verifiedContext, adapter: chartReader }).catch((error) => ({ status: error.message === 'PATIENT_NOT_FOUND' ? 'patient_not_found' : 'failed', reason: error.code || error.message || 'chart_read_failed', patient_facts: [], coverage: [] }));
          chartRead.status = chart.status === 'ready' ? (chart.patient_facts.length ? 'read' : 'empty') : chart.status;
          chartRead.reason = chart.status === 'ready' ? null : chart.reason || null;
          if (chart.failed_patient_groups?.length) chartRead.failed_groups = chart.failed_patient_groups;
          for (const group of chart.coverage || []) trace?.recordRetrievalAttempt({ adapter: chartReadOrigin(chartReader), group: group.group, status: group.status, attempts: group.attempts, errorCode: group.error_class });
          if (!chart.coverage?.length) trace?.recordRetrievalAttempt({ adapter: chartReadOrigin(chartReader), group: 'chart', status: chartRead.status === 'failed' ? 'failed' : chartRead.status, attempts: 1, errorCode: chartRead.reason });
          const inputs = { labResults: extraction?.lab_results || [], intakeForm: extraction?.intake_form || null, medicationList: extraction?.medication_list || null, guidelineEvidence: evidence?.guideline_evidence || [], patientFacts: chart.patient_facts || [] };
          answerParts = partitionAnswerInputs(inputs);
          const withheldReview = (chart.withheld_patient_fields || []).map((item) => ({ kind: 'patient_record', field: item.field, reason: `${item.reason}_withheld` }));
          const liveProviderBlocked = liveExternalBlocked && this.answerProvider && this.answerProvider.name !== 'deterministic' && this.answerProvider.name !== 'deterministic-answer-composer';
          answer = await composeGroundedAnswer(
            { ...inputs, question: answerQuery },
            { provider: liveProviderBlocked ? new DeterministicAnswerComposer() : this.answerProvider, trace, correlationId: trace?.correlationId || '', signal: deadline.signal },
          );
          if (withheldReview.length) answer = { ...answer, needs_review: [...answer.needs_review, ...withheldReview] };
          return answer;
        } finally {
          trace?.finishStage('answer', { status: answer ? answer.composer : 'failed' });
        }
      };
      const criticEnabled = Boolean(this.criticProvider) && !liveExternalBlocked;
      const critic = {
        enabled: criticEnabled,
        // A configured critic that may not see a live read is skipped with its
        // own status (skipped_not_approved), never labeled reviewed or disabled.
        notApproved: Boolean(this.criticProvider) && liveExternalBlocked,
        disabledReason: this.criticProvider ? 'live_external_provider_not_approved' : (this.criticDisabledReason || 'critic_model_not_configured'),
        // Remaining scan budget, measured from the start of this request; the
        // critic never widens the deadline, it is skipped instead.
        budgetOk: () => !deadline.signal.aborted && this.scanDeadlineMs - (this.now() - requestStartedAt) >= this.criticTimeoutMs,
        run: async (answer) => {
          const handoff = await runCriticWorker({ answer, provider: this.criticProvider, timeoutMs: this.criticTimeoutMs, signal: deadline.signal, now: this.now });
          const applied = applyCriticVerdicts(answer, handoff, answerParts);
          return { handoff, answer: applied, summary: criticAppliedSummary(handoff, applied) };
        },
        skip: (answer, status, reason) => ({ answer: { ...answer, critic_status: status, critic_rejected: 0, critic_claims_not_sent: 0, critic_topup_unreviewed: 0 }, summary: criticNotRunSummary(status, reason) }),
      };
      const workflow = await runActiveSupervisor({
        sourceDocumentId: source.source_document.id,
        documentType: source.source_document.document_type,
        layoutId: layoutMatch?.[1] || (pdf ? `pdf-ocr-${source.source_document.document_type}` : 'unknown'),
        pageCount: Number(pageCountMatch?.[1] || prepared.pageCount || 1),
        content,
        query: answerQuery,
        observer: trace,
        documentText: pdf ? prepared.ocrText : contentText,
        targetPatient,
        retrievalAdapter: guidelineRetriever,
        extractionCache: this.extractionCache,
        ocrMode: pdf ? (prepared.ocrMode || DEFAULT_OCR_MODE) : DEFAULT_OCR_MODE,
        signal: deadline.signal,
        reextractWithAlternateOcr: pdf ? async () => {
          const alternate = await this.prepareScanSource(source, { ocrMode: ALTERNATE_OCR_MODE, allowExternalScan: !liveExternalBlocked });
          return { content: alternate.content, ocrMode: ALTERNATE_OCR_MODE };
        } : null,
        // E2: ANSWER composes inside the supervisor loop, so its decision
        // can route on to CRITIQUE (or a labeled DONE) like any other step.
        composeAnswer: answerRefused ? null : composeAnswer,
        critic,
      });
      if (pdf) workflow.typed_outputs.extraction.provider = prepared.provider;
      // F6 review fix: remember which OCR mode this document's workflow
      // actually used, so a later preview/evidence read renders that
      // extraction's boxes, not always the initial default.
      if (workflow.ocr_mode) this.resolvedOcrMode.set(source.source_document.id, workflow.ocr_mode);
      for (const handoff of workflow.handoffs || []) trace?.recordHandoff(traceSafeHandoff(handoff));
      // The per-encounter runtime evaluation (W2 PRD §7 "eval outcome"),
      // distinct from the offline golden-set gate (`npm run eval:gate`) --
      // see runtimeEvaluation.js for the exact status rule and why OpenEMR
      // read-back is not yet wired at this call site.
      const { evaluation, verification } = computeRuntimeEvaluation({ workflow, readBack: null });
      trace?.setEvaluation(evaluation);
      trace?.setVerification(verification);
      trace?.complete({ status: workflow.readiness === 'stopped' ? 'failure' : 'success' });
      return { status: 'completed', synthetic_only: true, source_document: source.source_document, chart_source: chartRead, workflow, ...(answerRefused ? { answer_refusal: { disposition: 'blocked', reason: 'out_of_scope_patient' } } : {}), ...(pdf ? { pdf_ocr: { page_count: prepared.pageCount, candidate_fields: prepared.candidateFields } } : {}) };
    } catch (error) {
      trace?.complete({ status: 'failure' });
      throw error;
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  async prepareScanSource(source, { ocrMode, allowExternalScan = true } = {}) {
    // F6 review fix: default to whichever OCR mode this document's workflow
    // actually settled on (set by `runActiveSupervisorForDocument` below),
    // not always the initial default -- so a later `/source-preview` or
    // `/scan-form-evidence` read renders the boxes of the extraction that
    // was actually used, even after a low-confidence retry upgraded it.
    const resolvedOcrMode = ocrMode || this.resolvedOcrMode.get(source.source_document.id) || DEFAULT_OCR_MODE;
    // An external scan provider (Gemini) only when the request may send data
    // out (E9); the cache key keeps the two preparations apart.
    const scanProvider = allowExternalScan ? this.scanProvider : null;
    const id = `${source.source_document.id}:${resolvedOcrMode}:${scanProvider ? 'external' : 'local'}`;
    const cached = this.scanPreparations.get(id);
    if (cached) return cached;
    const pdf = source.content.subarray(0, 5).toString() === '%PDF-';
    const prepared = Promise.resolve().then(async () => pdf
      ? { ...(await extractPdfScanFixture({ content: source.content, documentType: source.source_document.document_type, scanProvider, ocrMode: resolvedOcrMode, ...(this.ocrEngine ? { ocrEngine: this.ocrEngine } : {}) })), pdf: true }
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

  /**
   * Chart-record facts for the W2 answer's "patient record" section and for
   * `/v1/follow-up-evidence`'s `patient_facts`, each carrying the standard
   * 5-key `Citation` (`source_type: 'openemr_record'` for a live OpenEMR read,
   * `'synthetic_chart_fixture'` for the fixture chart) alongside the
   * existing flat fields (S2 review finding 8). Does not authorize on its
   * own -- every caller has already authorized patient-scoped read access
   * (the scan-supervisor path via `readSourceDocument`; `retrieveFollowUpEvidence`
   * via its own `chartAdapter.authorize` call) before calling this. Does not
   * catch `chartAdapter.getCase`'s `PATIENT_NOT_FOUND` -- callers that must
   * tolerate an unknown chart patient (the scan-supervisor path, where a
   * document can be uploaded for a patient the fixture chart never seeded)
   * catch it themselves; `retrieveFollowUpEvidence` deliberately still lets
   * it propagate to the server's existing 404 handling.
   */
  async retrievePatientChartFacts(patientRef, caseId = null, { verifiedContext = null, adapter = null } = {}) {
    // E9: read through the request's own chart adapter (chartSourceRouter.js).
    const chart = adapter || resolveChartAdapter(this.chartAdapter, verifiedContext);
    const item = await chart.getCase(patientRef, caseId);
    const retrieved = await chart.retrieve(item);
    const validation = validateRetrievalResult(retrieved);
    if (!validation.valid) return { status: 'blocked', reason: 'retrieval_contract_invalid', patient_facts: [], failed_patient_groups: [], withheld_patient_fields: [], chart_source: chartRecordCitationSource(chart).chart_source };
    // Label the citation by the adapter that actually read the record: a
    // fixture read is never cited as an OpenEMR record (chartSource.js).
    const citationSource = chartRecordCitationSource(chart);
    const scopedRecords = retrieved.records.filter((record) => recordBelongsToPatient(record, item.patient.patient_ref) && recordIsCovered(record, retrieved.coverage));
    // Narrative that addresses an automated reader is withheld, never cited,
    // so injected text reaches neither the answer model nor the display.
    const untrustedFields = findUntrustedNarrative(scopedRecords);
    const withheldPatientFields = untrustedFields.map((field) => ({ field, reason: 'untrusted_narrative' }));
    const patientFacts = scopedRecords.filter((record) => !untrustedFields.includes(record.field)).map((record) => {
      const quote = record.value === null || record.value === undefined ? '' : String(record.value).trim();
      const citation = record.source_ref && record.field && quote
        ? { source_type: citationSource.source_type, source_id: record.source_ref, page_or_section: citationSource.page_or_section, field_or_chunk_id: record.field, quote_or_value: quote }
        : null;
      return { source_type: 'patient_record', patient_ref: item.patient.patient_ref, source_id: record.source_ref, field: record.field, value: record.value, recorded_at: record.recorded_at, author: record.author, citation };
    });
    const failedGroups = retrieved.coverage.filter((group) => isCoverageUnavailable(group.status)).map((group) => group.group);
    return { status: 'ready', patient_facts: patientFacts, failed_patient_groups: failedGroups, withheld_patient_fields: withheldPatientFields, coverage: retrieved.coverage, chart_source: citationSource.chart_source };
  }

  async retrieveFollowUpEvidence(request, { verifiedContext = null, topK = 3 } = {}) {
    const authorization = this.chartAdapter.authorize ? this.chartAdapter.authorize(request, verifiedContext) : { status: 'blocked', reason: 'server_context_missing_or_invalid' };
    if (authorization.status !== 'authorized') return { status: 'blocked', reason: authorization.reason };
    // W1-SF4: a question naming another patient is refused before any chart
    // read, so neither patient's data is disclosed.
    if (await this.questionNamesOtherPatient(request.message, authorization.patient_uuid, resolveChartAdapter(this.chartAdapter, verifiedContext))) return { status: 'blocked', disposition: 'blocked', reason: 'out_of_scope_patient' };
    const chart = await this.retrievePatientChartFacts(authorization.patient_uuid, request.case_id, { verifiedContext });
    if (chart.status !== 'ready') return { status: 'blocked', reason: chart.reason };
    const patientFacts = chart.patient_facts;
    const failedGroups = chart.failed_patient_groups;
    const withheldFields = chart.withheld_patient_fields || [];
    // E9: a live read without external-provider approval makes no outbound
    // call, so the question is ranked by the local retriever only.
    const guidelineRetriever = isLiveChartRead(resolveChartAdapter(this.chartAdapter, verifiedContext)) && !this.allowExternalLiveProvider ? localLexicalGuidelineRetriever : this.guidelineRetriever;
    let guideline;
    try {
      guideline = await guidelineRetriever.retrieve(request.message, { topK });
    } catch {
      // An error code only — never `error.message`, which can carry
      // upstream HTTP/network detail (e.g. an internal host or a raw
      // provider error string) that must not reach an API response or trace.
      guideline = { status: 'qualified', provider: guidelineRetriever.name || 'unknown', evidence: [], issues: ['guideline_retrieval_failed'] };
    }
    return { status: 'ready', synthetic_only: true, patient_facts: patientFacts, guideline_evidence: guideline.evidence, retrieval: { guideline_provider: guideline.provider || guidelineRetriever.name || 'bm25-sparse-only', guideline_status: guideline.status, guideline_issues: guideline.issues, guideline_usage: guideline.usage || null, failed_patient_groups: failedGroups, withheld_patient_fields: withheldFields, chart_source: chart.chart_source }, qualification: { required: Boolean(failedGroups.length || withheldFields.length || guideline.status !== 'complete'), reasons: [...failedGroups.map((group) => `patient_${group}_unavailable`), ...withheldFields.map((item) => `${item.reason}:${item.field}`), ...guideline.issues] } };
  }

  /**
   * True when `message` names a patient other than `patientRef` (W1-SF4; see
   * patientMentions.js). Uses the chart adapter's patient list when it has
   * one; live OpenEMR REST has none, so only identifier shapes are checked.
   */
  async questionNamesOtherPatient(message, patientRef, chart = this.chartAdapter) {
    if (!String(message ?? '').trim()) return false;
    const knownPatients = typeof chart?.listPatientIdentifiers === 'function' ? chart.listPatientIdentifiers() : [];
    // The request's chart (E9 router) unless demographics were injected.
    const demographicsSource = this.patientDemographics === this.chartAdapter ? chart : this.patientDemographics;
    const demographics = await demographicsSource?.getPatientDemographics?.(patientRef) ?? null;
    return mentionsOtherPatient({ message, currentPatient: { patient_ref: patientRef, display_name: demographics?.name }, knownPatients });
  }

  prepare(...args) { return this.preparation.prepare(...args); }

  prewarm(...args) { return this.preparation.prewarm(...args); }

  openPrepared(...args) { return this.preparation.openPrepared(...args); }

  followUp(...args) { return this.preparation.followUp(...args); }

  /**
   * E9: may this request's data leave the process (answer model, critic,
   * external OCR, guideline embed/rerank)? Always for the fixture chart; for
   * a live OpenEMR read only with AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED.
   */
  externalEgressFor(verifiedContext) {
    const selection = selectChartSource(this.chartAdapter, verifiedContext);
    if (selection.status !== 'selected') return { status: 'blocked', reason: selection.reason };
    return { status: 'selected', allowed: !isLiveChartRead(selection.adapter) || this.allowExternalLiveProvider };
  }

  authorizeWriteback(request, verifiedContext, options = {}) {
    return this.writeback?.authorize
      ? this.writeback.authorize(request, verifiedContext, options)
      : { status: 'blocked', reason: 'synthetic_writeback_unavailable' };
  }
}

// Workflow final states whose derived facts and lab rows may be written.
// Anything else is refused; an absent or unknown state is a caller bug and
// throws, so dropping the state at a call site can never re-enable writes.
const PERSISTABLE_FINAL_STATES = new Set(['READY', 'QUALIFIED']);
const NON_PERSISTABLE_FINAL_STATES = new Set(['BLOCKED', 'CLARIFY']);
export function workflowMayPersist(finalState) {
  if (PERSISTABLE_FINAL_STATES.has(finalState)) return true;
  if (NON_PERSISTABLE_FINAL_STATES.has(finalState)) return false;
  throw Object.assign(new Error('WORKFLOW_FINAL_STATE_REQUIRED'), { code: 'WORKFLOW_FINAL_STATE_REQUIRED' });
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
