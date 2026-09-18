import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeRequest, issueSignedContext, verifySignedContext } from '../src/accessContext.js';

const now = () => 1_000;

test('signed synthetic context verifies and expires', () => {
  const token = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret: 'secret', ttlSeconds: 60, now });
  assert.deepEqual(verifySignedContext(token, 'secret', now), { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', scope: 'read-briefing', expires_at: 1_060 });
  assert.equal(verifySignedContext(token, 'wrong', now), null);
  assert.equal(verifySignedContext(token, 'secret', () => 1_061), null);
});

test('authorization uses server context rather than browser-selected identity', () => {
  const request = { patient_uuid: 'fixture-patient-001', clinician_uuid: 'browser-user', authorization: { status: 'authorized', scope: 'read-briefing' } };
  const context = { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', scope: 'read-briefing' };
  assert.equal(authorizeRequest({ request, verifiedContext: context, requireSignedContext: true }).status, 'blocked');
  assert.equal(authorizeRequest({ request: { ...request, clinician_uuid: 'fixture-physician-001' }, verifiedContext: context, requireSignedContext: true }).status, 'authorized');
  assert.equal(authorizeRequest({ request, verifiedContext: null, requireSignedContext: true }).reason, 'server_context_missing_or_invalid');
});
