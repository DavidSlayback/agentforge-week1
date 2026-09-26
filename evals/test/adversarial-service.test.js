const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runAdversarialSuite, ADVERSARIAL_CASES } = require('../lib/adversarial');
const { startTestServer } = require('../../agentforge/test/helpers/testServer.js');

// The secret startTestServer gives the spawned service.
const TEST_SECRET = 'synthetic-test-secret';
const PORT = 18955;

async function withServer(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-adversarial-'));
  const child = await startTestServer(PORT, { AGENTFORGE_TRACE_PATH: path.join(root, 'traces.json') });
  try {
    return await fn(`http://127.0.0.1:${PORT}`);
  } finally {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('unauthorized and ambiguous cases pass against the running service', async () => {
  const report = await withServer((baseUrl) => runAdversarialSuite(baseUrl, { demoSecret: TEST_SECRET }));
  const failed = report.cases.filter((item) => !item.passed);
  assert.deepEqual(failed, [], JSON.stringify(failed, null, 2));
  assert.equal(report.total_cases, ADVERSARIAL_CASES.length);
  assert.deepEqual(report.unauthorized, { total: 6, passed: 6 });
  assert.deepEqual(report.ambiguous, { total: 3, passed: 3 });
  assert.equal(report.not_run_cases, 0);
  assert.equal(report.gate_passed, true);
});

test('a protection case that cannot run fails the suite instead of passing', async () => {
  const report = await withServer((baseUrl) => runAdversarialSuite(baseUrl, { demoSecret: null, waitForExpiry: false }));
  const expired = report.cases.find((item) => item.case_id === 'unauth_expired_token');
  assert.equal(expired.passed, false);
  assert.equal(expired.issues[0].code, 'CASE_NOT_RUN');
  assert.equal(report.not_run_cases, 1);
  assert.equal(report.gate_passed, false);
});

test('a wrong signing secret is reported as not run, not as a pass', async () => {
  // A token re-signed with the wrong secret would be refused for its
  // signature, which proves nothing about expiry. The case's control request
  // catches that and reports CASE_NOT_RUN.
  const report = await withServer((baseUrl) => runAdversarialSuite(baseUrl, { demoSecret: 'not-the-service-secret' }));
  const expired = report.cases.find((item) => item.case_id === 'unauth_expired_token');
  assert.equal(expired.passed, false);
  assert.equal(expired.issues[0].code, 'CASE_NOT_RUN');
  assert.equal(report.gate_passed, false);
});
