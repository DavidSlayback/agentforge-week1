import test from 'node:test';
import assert from 'node:assert/strict';
import { correlationId, validateBriefingResponse, validateFollowUpRequest, validateFollowUpResponse, validatePrepareRequest } from '../src/contracts.js';

test('canonical request contracts reject body authorization and malformed input', () => {
  const legacy = validatePrepareRequest({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', authorization: { status: 'authorized', scope: 'read-briefing' } });
  assert.equal(legacy.valid, false);
  assert.ok(legacy.issues.includes('authorization_is_not_in_contract'));
  const malformed = validatePrepareRequest({ patient_uuid: 42, clinician_uuid: 'fixture-physician-001' });
  assert.equal(malformed.valid, false);
  assert.ok(malformed.issues.includes('patient_uuid_must_be_string'));
  const extraField = validatePrepareRequest({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', authorization: { status: 'authorized', scope: 'read-briefing' }, arbitrary_tool: 'not-allowed' });
  assert.equal(extraField.valid, false);
  assert.ok(extraField.issues.includes('arbitrary_tool_is_not_in_contract'));
  assert.equal(validatePrepareRequest({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: 'signed.context' }).valid, true);
});

test('canonical follow-up and briefing responses reject missing contract fields', () => {
  const followUp = validateFollowUpRequest({ patient_uuid: 'fixture-patient-001', message: 'What changed?', clinician_uuid: 'fixture-physician-001' });
  assert.equal(followUp.valid, true);
  const invalidResponse = validateBriefingResponse({ contract_version: '0.1', correlation_id: 'test', disposition: 'complete', patient: null });
  assert.equal(invalidResponse.valid, false);
  assert.ok(invalidResponse.issues.includes('claims_is_required'));
});

test('follow-up contract permits only the signed demo context token as an extension', () => {
  const valid = validateFollowUpRequest({ patient_uuid: 'fixture-patient-001', message: 'What changed?', clinician_uuid: 'fixture-physician-001', demo_token: 'encoded.signature' });
  assert.equal(valid.valid, true);
  const invalid = validateFollowUpRequest({ patient_uuid: 'fixture-patient-001', message: 'What changed?', clinician_uuid: 'fixture-physician-001', arbitrary_tool: 'nope' });
  assert.equal(invalid.valid, false);
});

test('follow-up contract represents bounded deadline outcomes without patient content', () => {
  const result = validateFollowUpResponse({ contract_version: '0.1', correlation_id: 'corr-deadline', disposition: 'deadline-exceeded', patient: null, verification: { status: 'blocked' }, deadline: { outcome: 'deadline-exceeded', deadline_ms: 8000 } });
  assert.equal(result.valid, true);
});

test('opaque correlation IDs remain stable across stale refreshes', () => {
  const first = correlationId('fixture-patient-001-clinician-secret');
  assert.match(first, /^af-[0-9a-f]{32}$/);
  assert.equal(correlationId(first), first);
});
