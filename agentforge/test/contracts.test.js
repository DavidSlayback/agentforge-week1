import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBriefingResponse, validateFollowUpRequest, validatePrepareRequest } from '../src/contracts.js';

test('canonical request contracts distinguish valid denied requests from malformed input', () => {
  const denied = validatePrepareRequest({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', authorization: { status: 'denied', scope: 'read-briefing' } });
  assert.equal(denied.valid, true);
  const malformed = validatePrepareRequest({ patient_uuid: 42, clinician_uuid: 'fixture-physician-001', authorization: { status: 'authorized', scope: 'read-briefing' } });
  assert.equal(malformed.valid, false);
  assert.ok(malformed.issues.includes('patient_uuid_must_be_string'));
  const extraField = validatePrepareRequest({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', authorization: { status: 'authorized', scope: 'read-briefing' }, arbitrary_tool: 'not-allowed' });
  assert.equal(extraField.valid, false);
  assert.ok(extraField.issues.includes('arbitrary_tool_is_not_in_contract'));
});

test('canonical follow-up and briefing responses reject missing contract fields', () => {
  const followUp = validateFollowUpRequest({ patient_uuid: 'fixture-patient-001', message: 'What changed?', clinician_uuid: 'fixture-physician-001', authorization: { status: 'authorized', scope: 'read-briefing' } });
  assert.equal(followUp.valid, true);
  const invalidResponse = validateBriefingResponse({ contract_version: '0.1', correlation_id: 'test', disposition: 'complete', patient: null });
  assert.equal(invalidResponse.valid, false);
  assert.ok(invalidResponse.issues.includes('claims_is_required'));
});
