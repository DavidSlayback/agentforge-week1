import { CONTRACT_VERSION, correlationId, blockedResult, MAX_RETRIES } from './contracts.js';
import { fileURLToPath } from 'node:url';
import { PreparationCache } from './preparationCache.js';

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
    const authorization = this.adapter.authorize ? this.adapter.authorize(request, verifiedContext) : { status: request.authorization?.status === 'authorized' && request.clinician_uuid && request.patient_uuid ? 'authorized' : 'blocked', reason: 'identity_or_authorization_not_established', patient_uuid: request.patient_uuid, clinician_uuid: request.clinician_uuid };
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
    const item = this.adapter.getCase(authorization.patient_uuid, scopedRequest.case_id);
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
    for (const group of retrieved.coverage) trace?.recordRetrievalAttempt({ adapter: 'fixtures', group: group.group, status: group.status, attempts: group.attempts, errorCode: group.error_class });
    trace?.finishStage('retrieval', { status: retrieved.coverage.some((group) => ['failed', 'timeout'].includes(group.status)) ? 'partial' : 'success' });
    const expected = item.expected || {};
    const withheld = expected.withhold_fields || [];
    const claims = item.records.filter((record) => !withheld.includes(record.field)).map((record) => ({ field: record.field, value: record.value, patient_ref: item.patient.patient_ref, source_ref: record.source_ref, evidence: [evidence(record, item.patient.patient_ref)], reassessment_documented: Boolean(record.reassessment_documented) }));
    const failed = retrieved.coverage.filter((group) => ['failed', 'timeout', 'unauthorized'].includes(group.status));
    const qualification = { required: Boolean(expected.qualification_required || failed.length), reasons: failed.length ? failed.map((group) => `${group.group}:${group.status}`) : (expected.qualification_required ? ['fixture_requires_qualification'] : []) };
    const response = { contract_version: CONTRACT_VERSION, correlation_id: id, context: { patient_ref: item.patient.patient_ref, requester_ref: authorization.clinician_uuid, authorized: true, authorization_source: authorization.source }, patient: item.patient, disposition: expected.brief_disposition || (qualification.required ? 'qualified' : 'complete'), claims, withheld_fields: withheld, coverage: retrieved.coverage, qualification, operations: [{ type: 'read', operation: 'retrieve_simulated_openemr' }] };
    trace?.startStage('verification');
    const verification = (await import('./verifier.js')).verify({ patientRef: item.patient.patient_ref, claims, coverage: retrieved.coverage, qualification, operations: response.operations });
    trace?.finishStage('verification', { status: verification.status });
    response.verification = verification;
    if (verification.status !== 'passed') response.disposition = 'blocked';
    trace?.startStage('model');
    const prompt = `Prepare a read-only return-visit orientation for ${item.patient.display_name}. Use only these evidence-backed fields: ${claims.map((claim) => `${claim.field}=${String(claim.value)}`).join('; ')}. Do not recommend new clinical actions.`;
    const generated = await this.provider.generate({ patient: item.patient, claims, qualification, prompt }, { trace });
    trace?.recordModelUsage({ provider: this.provider.name, model: this.provider.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens, estimatedCostUsd: generated.estimatedCostUsd, provider_fallback: generated.provider_fallback, provider_status: generated.provider_status, provider_error_code: generated.provider_error_code });
    trace?.finishStage('model', { status: generated.provider_fallback ? 'fallback' : 'success', provider_status: generated.provider_status || 'primary' });
    response.text = generated.text;
    response.model = { provider: this.provider.name, model: this.provider.model, input_tokens: generated.inputTokens, output_tokens: generated.outputTokens, estimated_cost_usd: generated.estimatedCostUsd };
    this.cache.put({ correlationId: id, patientRef: item.patient.patient_ref, clinicianRef: authorization.clinician_uuid, verifiedContext, request: scopedRequest, response, sourceRevision: item.id, scheduleRevision: 'fixture-calendar-v1' });
    trace?.setCache({ status: 'stored', sourceRevision: item.id, scheduleRevision: 'fixture-calendar-v1' });
    trace?.setCoverage({ status: failed.length ? 'partial' : 'complete', groups: retrieved.coverage.map((group) => group.group) });
    trace?.setVerification(verification);
    trace?.startStage('display');
    trace?.setDisplay({ status: verification.status === 'passed' ? 'displayed' : 'withheld' });
    trace?.finishStage('display', { status: verification.status === 'passed' ? 'displayed' : 'withheld' });
    trace?.complete({ status: verification.status === 'passed' ? 'success' : 'failure', deadlineOutcome: deadlineMs ? 'within_deadline' : 'not_applicable' });
    return response;
  }
  async followUp(id, request, { verifiedContext = null } = {}) {
    const cacheResult = this.cache.get(id);
    const authorization = this.adapter.authorize ? this.adapter.authorize(request, verifiedContext) : { status: request.authorization?.status === 'authorized' ? 'authorized' : 'blocked', patient_uuid: request.patient_uuid, clinician_uuid: request.clinician_uuid };
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
      const refreshed = await this.prepare({ ...cacheResult.entry.request, correlation_id: id, authorization: request.authorization }, { verifiedContext, interactionType: 'fresh_followup', deadlineMs: this.freshRetrievalDeadlineMs });
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
    trace?.finishStage('display', { status: response.disposition === 'blocked' ? 'withheld' : 'displayed' });
    trace?.setCache({ status: 'hit', sourceRevision: cacheResult.entry.sourceRevision, scheduleRevision: cacheResult.entry.scheduleRevision });
    trace?.setVerification(response.verification);
    trace?.setDisplay({ status: response.disposition === 'blocked' ? 'withheld' : 'displayed' });
    trace?.complete({ status: response.disposition === 'blocked' ? 'blocked' : 'success', deadlineOutcome: 'within_deadline' });
    return response;
  }
}

function followUpFromBriefing(id, briefing, message) {
  if (briefing.disposition === 'blocked' || briefing.disposition === 'deadline-exceeded') {
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

export function defaultFixturePath() { return fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url)); }
