import { CONTRACT_VERSION, correlationId, blockedResult, isCoverageFailure, isCoverageUnavailable, validateBriefingResponse, validateFollowUpResponse } from './contracts.js';
import { fileURLToPath } from 'node:url';
import { PreparationCache } from './preparationCache.js';

// Stable redacted trace label shared by fixture and live paths; it is not
// evidence that live OpenEMR supplied the cached response.
const TRACE_CACHE_SOURCE_REVISION = 'openemr-live';
const CACHE_SCHEDULE_REVISION = 'agentforge-calendar-v1';

/** Apply a response deadline; timing out does not cancel underlying work. */
const runWithinDeadline = async (work, deadlineMs) => {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return { timedOut: false, value: await work() };
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(work).then((value) => ({ timedOut: false, value })),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), deadlineMs); }),
    ]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

function evidence(record, patientRef) {
  return { patient_ref: patientRef, source_ref: record.source_ref, record_type: record.field.split('.')[0], recorded_at: record.recorded_at, author: record.author, excerpt: typeof record.value === 'string' ? record.value.slice(0, 300) : JSON.stringify(record.value) };
}

/** Hash client-controlled conversation IDs before they enter traces. */
/** Orchestrates the read-only authorization, retrieval, verification, and display boundary. */
export class AgentForgeService {
  constructor({ adapter, provider, traceSink, cache = new PreparationCache(), freshRetrievalDeadlineMs = 8000 }) {
    this.adapter = adapter;
    this.provider = provider;
    this.traceSink = traceSink;
    this.cache = cache;
    this.freshRetrievalDeadlineMs = freshRetrievalDeadlineMs;
  }
  async prepare(request, { verifiedContext = null, interactionType = 'briefing', deadlineMs = null } = {}) {
    const id = correlationId(request.correlation_id);
    const authorization = this.adapter.authorize ? this.adapter.authorize(request, verifiedContext) : { status: 'blocked', reason: 'server_context_missing_or_invalid' };
    // Keep the API conversation ID available to the client/cache, but never
    // trust a client-supplied value as a safe trace identifier.
    const trace = this.traceSink?.start({ correlationId: id, operation: 'visit_briefing', interactionType, deadlineMs, scope: authorization.status === 'authorized' ? { clinicianRef: authorization.clinician_uuid, patientRef: authorization.patient_uuid } : {} });
    trace?.markAcknowledged();
    if (authorization.status !== 'authorized') {
      const result = blockedResult(id, authorization.reason);
      trace?.setDisplay({ status: 'withheld' });
      trace?.complete({ status: 'blocked' });
      return result;
    }
    const scopedRequest = { ...request, patient_uuid: authorization.patient_uuid, clinician_uuid: authorization.clinician_uuid };
    trace?.startStage('authorization');
    trace?.finishStage('authorization', { status: 'success' });
    const item = await this.adapter.getCase(authorization.patient_uuid, scopedRequest.case_id);
    trace?.startStage('retrieval');
    const retrieval = await runWithinDeadline(() => this.adapter.retrieve(item), deadlineMs);
    if (retrieval.timedOut) {
      const result = { ...blockedResult(id, 'deadline-exceeded', 'deadline-exceeded'), deadline: { outcome: 'deadline-exceeded', deadline_ms: deadlineMs } };
      trace?.finishStage('retrieval', { status: 'timeout' });
      trace?.setDisplay({ status: 'withheld' });
      trace?.complete({ status: 'deadline-exceeded', deadlineOutcome: 'deadline-exceeded' });
      return result;
    }
    const retrieved = retrieval.value;
    // Operational adapter label only; it does not prove live OpenEMR or
    // production reachability.
    const retrievalAdapter = this.adapter.constructor?.name === 'OpenEMRRestAdapter' ? 'openemr' : 'fixture';
    for (const group of retrieved.coverage) trace?.recordRetrievalAttempt({ adapter: retrievalAdapter, group: group.group, status: group.status, attempts: group.attempts, errorCode: group.error_class });
    const coverage = Array.isArray(retrieved.coverage) ? retrieved.coverage : [];
    trace?.finishStage('retrieval', { status: coverage.some((group) => isCoverageUnavailable(group.status)) ? 'partial' : 'success' });
    const expected = item.expected || {};
    const withheld = expected.withhold_fields || [];
    const claims = (Array.isArray(retrieved.records) ? retrieved.records : [])
      .filter((record) => recordBelongsToPatient(record, item.patient.patient_ref))
      .filter((record) => !withheld.includes(record.field) && recordIsCovered(record, coverage))
      .map((record) => ({ field: record.field, value: record.value, patient_ref: item.patient.patient_ref, source_ref: record.source_ref, evidence: [evidence(record, item.patient.patient_ref)], reassessment_documented: Boolean(record.reassessment_documented) }));
    const failed = coverage.filter((group) => isCoverageUnavailable(group.status));
    const qualification = { required: Boolean(expected.qualification_required || failed.length), reasons: failed.length ? failed.map((group) => `${group.group}:${group.status}`) : (expected.qualification_required ? ['fixture_requires_qualification'] : []) };
    const response = { contract_version: CONTRACT_VERSION, correlation_id: id, context: { patient_ref: item.patient.patient_ref, requester_ref: authorization.clinician_uuid, authorized: true, authorization_source: authorization.source }, patient: item.patient, disposition: expected.brief_disposition || (qualification.required ? 'qualified' : 'complete'), claims, withheld_fields: withheld, coverage: retrieved.coverage, qualification, operations: [{ type: 'read', operation: 'retrieve_openemr_read' }] };
    trace?.startStage('verification');
    const verification = (await import('./verifier.js')).verify({ patientRef: item.patient.patient_ref, claims, coverage: retrieved.coverage, qualification, operations: response.operations, disposition: response.disposition });
    trace?.finishStage('verification', { status: verification.status });
    response.verification = verification;
    if (verification.status !== 'passed') {
      // Failed verification must not reach synthesis, display, or the cache.
      const result = blockedResult(id, 'verification_failed');
      result.verification = { ...verification, status: 'blocked' };
      trace?.setVerification(result.verification);
      trace?.startStage('display');
      trace?.setDisplay({ status: 'withheld' });
      trace?.finishStage('display', { status: 'withheld' });
      trace?.complete({ status: 'failure', deadlineOutcome: deadlineMs ? 'within_deadline' : 'not_applicable' });
      return result;
    }
    trace?.startStage('model');
    const prompt = `Prepare a read-only return-visit orientation for ${item.patient.display_name}. Use only these exact evidence-backed field/value pairs: ${claims.map((claim) => `${claim.field}=${String(claim.value)}`).join('; ')}. Repeat at least one exact field/value pair in the response. Do not diagnose, recommend, prescribe, order, or suggest a medication change. Return no more than two sentences.`;
    const { verifyGeneratedText } = await import('./verifier.js');
    const generated = await this.provider.generate({ patient: item.patient, claims, qualification, prompt }, { trace, validate: (candidate) => verifyGeneratedText({ text: candidate.text, claims }) });
    trace?.recordModelUsage({ provider: generated.provider_name || this.provider.name, model: generated.model_name || this.provider.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens, estimatedCostUsd: generated.estimatedCostUsd, provider_fallback: generated.provider_fallback, provider_status: generated.provider_status, provider_error_code: generated.provider_error_code });
    trace?.finishStage('model', { status: generated.provider_fallback ? 'fallback' : 'success', provider_status: generated.provider_status || 'primary' });
    response.text = generated.text;
    response.model = { provider: generated.provider_name || this.provider.name, model: generated.model_name || this.provider.model, input_tokens: generated.inputTokens, output_tokens: generated.outputTokens, estimated_cost_usd: generated.estimatedCostUsd };
    const responseValidation = validateBriefingResponse(response);
    if (!responseValidation.valid) {
      const result = blockedResult(id, 'response_contract_invalid');
      trace?.setDisplay({ status: 'withheld' });
      trace?.complete({ status: 'blocked', deadlineOutcome: deadlineMs ? 'within_deadline' : 'not_applicable' });
      return result;
    }
    this.cache.put({ correlationId: id, patientRef: item.patient.patient_ref, clinicianRef: authorization.clinician_uuid, verifiedContext, request: scopedRequest, response, sourceRevision: item.id, scheduleRevision: CACHE_SCHEDULE_REVISION });
    trace?.setCache({ status: 'stored', sourceRevision: TRACE_CACHE_SOURCE_REVISION, scheduleRevision: CACHE_SCHEDULE_REVISION });
    trace?.setCoverage({ status: failed.length ? 'partial' : 'complete', groups: retrieved.coverage.map((group) => group.group) });
    trace?.setVerification(verification);
    trace?.startStage('display');
    trace?.setDisplay({ status: verification.status === 'passed' ? 'displayed' : 'withheld' });
    trace?.finishStage('display', { status: verification.status === 'passed' ? 'displayed' : 'withheld' });
    trace?.complete({ status: verification.status === 'passed' ? 'success' : 'failure', deadlineOutcome: deadlineMs ? 'within_deadline' : 'not_applicable' });
    return response;
  }
  async followUp(id, request, { verifiedContext = null } = {}) {
    // Follow-ups stay scoped to patient and clinician; missing or mismatched
    // cache scope is withheld.
    const cacheResult = this.cache.get(id);
    const authorization = this.adapter.authorize ? this.adapter.authorize(request, verifiedContext) : { status: 'blocked', reason: 'server_context_missing_or_invalid' };
    const trace = this.traceSink?.start({ correlationId: id, operation: 'conversation_followup', interactionType: cacheResult.status === 'stale' ? 'fresh_followup' : 'cache_followup', deadlineMs: cacheResult.status === 'stale' ? this.freshRetrievalDeadlineMs : null, scope: authorization.status === 'authorized' ? { clinicianRef: authorization.clinician_uuid, patientRef: authorization.patient_uuid } : {} });
    trace?.markAcknowledged();
    if (!cacheResult.entry || authorization.status !== 'authorized' || cacheResult.entry.patientRef !== authorization.patient_uuid || cacheResult.entry.clinicianRef !== authorization.clinician_uuid) {
      const result = blockedResult(id, 'conversation_scope_invalid');
      trace?.setCache({ status: cacheResult.status });
      trace?.setDisplay({ status: 'withheld' });
      trace?.complete({ status: 'blocked' });
      return result;
    }
    if (cacheResult.status === 'stale') {
      trace?.setCache({ status: 'stale', staleDiscarded: true });
      // Remove expired evidence before refresh; only a verified fresh response
      // may repopulate this correlation ID.
      this.cache.delete(id);
      const refreshed = await this.prepare({ ...cacheResult.entry.request, correlation_id: id }, { verifiedContext, interactionType: 'fresh_followup', deadlineMs: this.freshRetrievalDeadlineMs });
      const response = followUpFromBriefing(id, refreshed, request.message);
      trace?.setDisplay({ status: response.disposition === 'blocked' || response.disposition === 'deadline-exceeded' ? 'withheld' : 'displayed' });
      trace?.complete({ status: response.disposition === 'complete' || response.disposition === 'partial' || response.disposition === 'qualified' ? 'success' : response.disposition, deadlineOutcome: response.deadline?.outcome || 'within_deadline' });
      return response;
    }
    const conversation = cacheResult.entry;
    trace?.startStage('authorization');
    trace?.finishStage('authorization', { status: 'success' });
    trace?.startStage('cache');
    trace?.finishStage('cache', { status: 'hit' });
    trace?.startStage('verification');
    trace?.finishStage('verification', { status: conversation.response.verification.status });
    trace?.startStage('display');
    const response = followUpFromBriefing(id, conversation.response, request.message);
    const responseValidation = validateFollowUpResponse(response);
    if (!responseValidation.valid) {
      const result = blockedResult(id, 'response_contract_invalid');
      trace?.finishStage('display', { status: 'withheld' });
      trace?.setDisplay({ status: 'withheld' });
      trace?.complete({ status: 'blocked', deadlineOutcome: 'within_deadline' });
      return result;
    }
    trace?.finishStage('display', { status: response.disposition === 'blocked' ? 'withheld' : 'displayed' });
    trace?.setCache({ status: 'hit', sourceRevision: TRACE_CACHE_SOURCE_REVISION, scheduleRevision: cacheResult.entry.scheduleRevision });
    trace?.setVerification(response.verification);
    trace?.setDisplay({ status: response.disposition === 'blocked' ? 'withheld' : 'displayed' });
    trace?.complete({ status: response.disposition === 'blocked' ? 'blocked' : 'success', deadlineOutcome: 'within_deadline' });
    return response;
  }
}

function followUpFromBriefing(id, briefing, message) {
  if (briefing.disposition === 'blocked' || briefing.disposition === 'deadline-exceeded' || briefing.verification?.status !== 'passed') {
    return { ...blockedResult(id, briefing.qualification?.reasons?.[0] || briefing.disposition, briefing.disposition), deadline: briefing.deadline };
  }
  return {
    contract_version: CONTRACT_VERSION,
    correlation_id: id,
    disposition: briefing.disposition,
    context: briefing.context,
    patient: briefing.patient,
    claims: briefing.claims,
    withheld_fields: briefing.withheld_fields,
    coverage: briefing.coverage,
    qualification: briefing.qualification,
    operations: briefing.operations,
    text: `Follow-up for ${briefing.context.patient_ref}: ${message || 'No question supplied.'} See the cited evidence in the briefing.`,
    evidence: briefing.claims.flatMap((claim) => claim.evidence),
    verification: briefing.verification,
    ...(briefing.deadline ? { deadline: briefing.deadline } : {}),
  };
}

/** Map wire fields to coverage groups and fail closed for unavailable data. */
function recordIsCovered(record, coverage) {
  const group = recordGroup(record);
  const status = coverage.find((item) => item.group === group);
  return Boolean(status && status.status === 'success' && status.records > 0 && !isCoverageFailure(status.status));
}

/** Never relabel a source record whose explicit patient identity disagrees. */
function recordBelongsToPatient(record, patientRef) {
  return !record?.patient_ref || String(record.patient_ref) === String(patientRef);
}

function recordGroup(record) {
  const root = String(record.field || '').split('.')[0];
  return { encounter: 'encounters', medication: 'medications', problem: 'problems', allergy: 'allergies', note: 'notes', identity: 'identity' }[root] || root;
}

export function defaultFixturePath() { return fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url)); }
