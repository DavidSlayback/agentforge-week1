const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileTraceSink, evaluateAlerts } = require('../index');

test('synthetic retrieval failure produces a redacted alert drill record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-incident-drill-'));
  const sink = new FileTraceSink({
    filePath: path.join(root, 'traces.json'),
    retentionMs: 60_000,
    clock: () => '2026-09-18T00:00:00.000Z',
  });

  const trace = sink.start({ correlationId: 'corr-incident-drill', operation: 'briefing' });
  trace.recordRetrievalAttempt({
    source: 'synthetic-openemr',
    status: 'failed',
    patientId: 'patient-secret',
    errorCode: 'UPSTREAM_TIMEOUT',
  });
  trace.complete({ status: 'failure' });

  const snapshot = sink.snapshot();
  const alert = evaluateAlerts(snapshot);
  const record = sink.list()[0];

  assert.equal(alert.status, 'firing');
  assert.deepEqual(alert.fired, ['error_rate', 'tool_failure_rate']);
  assert.equal(record.retrieval.attempts[0].patientId, '[REDACTED]');
  assert.equal(record.retrieval.attempts[0].errorCode, 'UPSTREAM_TIMEOUT');
  assert.equal(record.correlationId, 'corr-incident-drill');

  fs.rmSync(root, { recursive: true, force: true });
});
