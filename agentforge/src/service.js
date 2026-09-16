import path from 'node:path';
import { correlationId, blockedResult, MAX_RETRIES } from './contracts.js';

function evidence(record, patientRef) {
  return { patient_ref: patientRef, source_ref: record.source_ref, record_type: record.field.split('.')[0], recorded_at: record.recorded_at, author: record.author, excerpt: typeof record.value === 'string' ? record.value.slice(0, 300) : JSON.stringify(record.value) };
}

export class AgentForgeService {
  constructor({ adapter, provider, traceSink }) { this.adapter = adapter; this.provider = provider; this.traceSink = traceSink; this.conversations = new Map(); }
  async prepare(request) {
    const id = correlationId(request.correlation_id);
    if (request.authorization?.status !== 'authorized' || !request.clinician_uuid || !request.patient_uuid) return blockedResult(id, 'identity_or_authorization_not_established');
    const trace = this.traceSink?.start({ correlationId: id, operation: 'visit_briefing', scope: { clinicianRef: request.clinician_uuid, patientRef: request.patient_uuid } });
    const item = this.adapter.getCase(request.patient_uuid, request.case_id);
    const retrieved = this.adapter.retrieve(item);
    const expected = item.expected || {};
    const withheld = expected.withhold_fields || [];
    const claims = item.records.filter((record) => !withheld.includes(record.field)).map((record) => ({ field: record.field, value: record.value, patient_ref: item.patient.patient_ref, source_ref: record.source_ref, evidence: [evidence(record, item.patient.patient_ref)], reassessment_documented: Boolean(record.reassessment_documented) }));
    const failed = retrieved.coverage.filter((group) => ['failed', 'timeout', 'unauthorized'].includes(group.status));
    const qualification = { required: Boolean(expected.qualification_required || failed.length), reasons: failed.length ? failed.map((group) => `${group.group}:${group.status}`) : (expected.qualification_required ? ['fixture_requires_qualification'] : []) };
    const response = { contract_version: '0.1', correlation_id: id, context: { patient_ref: item.patient.patient_ref, requester_ref: request.clinician_uuid, authorized: true }, patient: item.patient, disposition: expected.brief_disposition || (qualification.required ? 'qualified' : 'complete'), claims, withheld_fields: withheld, coverage: retrieved.coverage, qualification, operations: [{ type: 'read', operation: 'retrieve_fixture' }] };
    const verification = (await import('./verifier.js')).verify({ patientRef: item.patient.patient_ref, claims, coverage: retrieved.coverage, qualification, operations: response.operations });
    response.verification = verification;
    if (verification.status !== 'passed') response.disposition = 'blocked';
    const generated = await this.provider.generate({ patient: item.patient, claims, qualification });
    response.text = generated.text;
    response.model = { provider: this.provider.name, model: this.provider.model, input_tokens: generated.inputTokens, output_tokens: generated.outputTokens, estimated_cost_usd: generated.estimatedCostUsd };
    this.conversations.set(id, { patientRef: item.patient.patient_ref, request, response });
    trace?.complete({ status: 'success', coverage: retrieved.coverage, verification, model: response.model });
    return response;
  }
  async followUp(id, request) {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.patientRef !== request.patient_uuid || request.authorization?.status !== 'authorized') return blockedResult(id, 'conversation_scope_invalid');
    return { correlation_id: id, patient: conversation.response.patient, text: `Follow-up for ${conversation.patientRef}: ${request.message || 'No question supplied.'} See the cited evidence in the briefing.`, evidence: conversation.response.claims.flatMap((claim) => claim.evidence), verification: conversation.response.verification };
  }
}

export function defaultFixturePath() { return path.resolve(process.cwd(), 'docs/agentforge/fixtures/clinical-cases.json'); }
