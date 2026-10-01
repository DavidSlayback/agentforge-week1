const test = require('node:test');
const assert = require('node:assert/strict');
const { redactPayload, InMemoryTraceSink } = require('../index.js');

// W3 hardening (H2). The real-trace checks are in
// agentforge/test/w3h-service-security.test.js; these pin the rules.

test('code-only keys keep code-shaped strings and redact free text and dates', () => {
  const result = redactPayload({
    reason: 'conversation_scope_invalid',
    errorCode: 'TRACE_STORE_CORRUPT',
    correlationId: 'af-0123456789abcdef',
    issues: ['guideline_retrieval_failed', 'Jane Doe', '1980-04-12', '04-12-1980'],
    nested: { error_code: 'lookup failed for Jane', correlation_id: 'Jane Doe', reasons: ['conflict:medication.lisinopril.dose'] },
    count: 3,
  });
  assert.equal(result.reason, 'conversation_scope_invalid');
  assert.equal(result.errorCode, 'TRACE_STORE_CORRUPT');
  assert.equal(result.correlationId, 'af-0123456789abcdef');
  assert.deepEqual(result.issues, ['guideline_retrieval_failed', '[REDACTED]', '[REDACTED]', '[REDACTED]']);
  assert.equal(result.nested.error_code, '[REDACTED]');
  assert.equal(result.nested.correlation_id, '[REDACTED]');
  assert.deepEqual(result.nested.reasons, ['conflict:medication.lisinopril.dose']);
  assert.equal(result.count, 3);
});

test('refusals are counted by code, outside requests, error rate and latency', () => {
  const sink = new InMemoryTraceSink();
  sink.start({ correlationId: 'af-1', operation: 'briefing' }).complete({ status: 'success' });
  for (let index = 0; index < 50; index += 1) sink.countRefusal('invalid_demo_context');
  sink.countRefusal('Jane Doe');
  const snapshot = sink.snapshot();
  assert.equal(snapshot.requests, 1);
  assert.equal(snapshot.errorRate, 0);
  assert.deepEqual(snapshot.refusals, { total: 51, byReason: { invalid_demo_context: 50, other: 1 } });
});
