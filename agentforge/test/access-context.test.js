import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeRequest, issueSignedContext, verifySignedContext } from '../src/accessContext.js';

const now = () => 1_000;

test('signed synthetic context verifies and expires', () => {
  const token = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret: 'secret', ttlSeconds: 60, now });
  assert.deepEqual(verifySignedContext(token, 'secret', now), { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', scope: 'read-briefing', issuer: 'synthetic-demo', authn: 'synthetic', role: 'clinician', acl: 'read', expires_at: 1_060 });
  assert.equal(verifySignedContext(token, 'wrong', now), null);
  assert.equal(verifySignedContext(token, 'secret', () => 1_061), null);
});

test('authorization uses server context rather than browser-selected identity', () => {
  const request = { patient_uuid: 'fixture-patient-001', clinician_uuid: 'browser-user' };
  const token = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret: 'secret', ttlSeconds: 60, now });
  const context = verifySignedContext(token, 'secret', now);
  assert.equal(authorizeRequest({ request, verifiedContext: context, now }).status, 'blocked');
  assert.equal(authorizeRequest({ request: { ...request, clinician_uuid: 'fixture-physician-001' }, verifiedContext: context, now }).status, 'authorized');
  assert.equal(authorizeRequest({ request, verifiedContext: null, now }).reason, 'server_context_missing_or_invalid');
});

test('live authorization requires the OpenEMR module issuer and session authentication', () => {
  const token = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', issuer: 'synthetic-demo', authn: 'synthetic', secret: 'secret', ttlSeconds: 60, now });
  const context = verifySignedContext(token, 'secret', now);
  const request = { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' };
  assert.equal(authorizeRequest({ request, verifiedContext: context, requiredIssuer: 'openemr-module', requiredAuthn: 'openemr-session', requiredRole: 'clinician', now }).reason, 'server_context_issuer_invalid');
});

test('signed context TTL cannot exceed five minutes', () => {
  assert.throws(() => issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret: 'secret', ttlSeconds: 301, now }), /SIGNED_CONTEXT_CONFIG_REQUIRED/);
});

test('signed requests do not require a duplicate body authorization object', () => {
  const token = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret: 'secret', ttlSeconds: 60, now });
  const context = verifySignedContext(token, 'secret', now);
  assert.equal(authorizeRequest({ request: { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, verifiedContext: context, now }).status, 'authorized');
});

test('authorization rechecks signed context expiry and context objects are immutable', () => {
  const token = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret: 'secret', ttlSeconds: 60, now });
  const context = verifySignedContext(token, 'secret', now);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(authorizeRequest({ request: { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, verifiedContext: context, now: () => 1_061 }).reason, 'server_context_expired');
});
