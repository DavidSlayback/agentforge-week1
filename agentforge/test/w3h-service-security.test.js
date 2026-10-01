import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryTraceSink, redactPayload } from '../../observability/index.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { AgentForgeService } from '../src/service.js';
import { SyntheticWriteback } from '../src/syntheticWriteback.js';

// W3 hardening lane H2 (service security), service-level checks. HTTP-level
// checks for the same lane live in w3h-server-security.test.js.

const fixturePath = fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url));
const labScan = fs.readFileSync(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url));
const SECRET = 'w3h-h2-test-secret';
const context = (patient, scope = 'read-briefing') => verifySignedContext(issueSignedContext({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', scope, acl: scope === 'read-briefing' ? 'read' : 'write', secret: SECRET }), SECRET);

function buildService(overrides = {}) {
  const traceSink = new InMemoryTraceSink();
  const service = new AgentForgeService({ chartAdapter: new FixtureAdapter(fixturePath), writeback: new SyntheticWriteback(), provider: new DeterministicProvider(), traceSink, ...overrides });
  const upload = (patient) => service.ingestSourceDocument({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', document_type: 'lab_pdf', filename: 'lab.scan.txt', content: labScan }, { verifiedContext: context(patient, 'write-source-document') });
  return { service, traceSink, upload };
}

test('item 1: the same bytes uploaded for two patients never carry the first upload\'s document id into the second answer', async () => {
  const { service, upload } = buildService();
  const first = await upload('fixture-patient-001');
  const second = await upload('fixture-patient-002');
  assert.notEqual(first.source_document.id, second.source_document.id);
  const a = await service.runActiveSupervisorForDocument(first.source_document.id, { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context('fixture-patient-001'), query: 'glycemic follow-up' });
  const b = await service.runActiveSupervisorForDocument(second.source_document.id, { patient_uuid: 'fixture-patient-002', clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context('fixture-patient-002'), query: 'glycemic follow-up' });
  assert.equal(a.status, 'completed');
  assert.equal(b.status, 'completed');
  assert.deepEqual(b.workflow.decisions[0], { next: 'EXTRACT', reason: 'extraction_needed' });
  const extraction = b.workflow.typed_outputs.extraction;
  assert.ok(extraction.facts.length > 0);
  assert.ok(extraction.facts.every((fact) => fact.citation.source_id === second.source_document.id), 'every fact cites patient B\'s document');
  assert.ok(!JSON.stringify(b.workflow).includes(first.source_document.id), 'patient A\'s document id never reaches patient B\'s workflow');
});

const PHI_MESSAGE = 'chart lookup failed for Jane Doe born 1980-04-12';

test('item 4: an uncoded chart-read failure reaches the answer and the trace as a code, never as its message', async () => {
  class FailingChart extends FixtureAdapter {
    getCase() { throw new Error(PHI_MESSAGE); }
  }
  const { service, traceSink, upload } = buildService({ chartAdapter: new FailingChart(fixturePath), patientDemographics: new FixtureAdapter(fixturePath) });
  const doc = await upload('fixture-patient-001');
  const result = await service.runActiveSupervisorForDocument(doc.source_document.id, { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context('fixture-patient-001'), query: 'glycemic follow-up' });
  assert.equal(result.status, 'completed');
  assert.equal(result.chart_source.status, 'failed');
  assert.equal(result.chart_source.reason, 'chart_read_failed');
  const serialized = JSON.stringify({ result, traces: traceSink.list() });
  assert.ok(!serialized.includes('Jane Doe') && !serialized.includes('lookup failed'), 'the exception message reaches neither the result nor the trace');
  assert.ok(traceSink.list()[0].retrieval.attempts.some((attempt) => attempt.errorCode === 'chart_read_failed'));
});

test('item 4: a failed demographics read labels the answer degraded instead of failing the request', async () => {
  const failingDemographics = { getPatientDemographics() { throw new Error(PHI_MESSAGE); } };
  const { service, upload } = buildService({ patientDemographics: failingDemographics });
  const doc = await upload('fixture-patient-001');
  const scan = await service.runActiveSupervisorForDocument(doc.source_document.id, { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context('fixture-patient-001'), query: 'glycemic follow-up' });
  assert.equal(scan.status, 'completed');
  assert.equal(scan.chart_source.name_check_error, 'demographics_read_failed');
  const evidence = await service.retrieveFollowUpEvidence({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message: 'What changed in glycemic control?' }, { verifiedContext: context('fixture-patient-001') });
  assert.equal(evidence.status, 'ready');
  assert.equal(evidence.qualification.required, true);
  assert.ok(evidence.qualification.reasons.includes('patient_name_check_unavailable:demographics_read_failed'));
  assert.ok(!JSON.stringify({ scan, evidence }).includes('Jane Doe'));
});

test('item 4: errorCodeOf keeps codes and replaces free text', async () => {
  const { errorCodeOf } = await import('../src/clientResponse.js');
  assert.equal(errorCodeOf(Object.assign(new Error('x'), { code: 'OPENEMR_MODULE_TIMEOUT' })), 'OPENEMR_MODULE_TIMEOUT');
  assert.equal(errorCodeOf(new Error('DOCUMENT_SCOPE_MISMATCH')), 'DOCUMENT_SCOPE_MISMATCH');
  assert.equal(errorCodeOf(new Error(PHI_MESSAGE)), 'internal_error');
  assert.equal(errorCodeOf(new URIError('URI malformed')), 'internal_error');
  assert.equal(errorCodeOf(null, 'fallback_code'), 'fallback_code');
});

test('item 5: the page-render wait queue is bounded', { timeout: 5000 }, async () => {
  const { createPageRenderLimiter, PAGE_RENDER_QUEUE_FULL } = await import('../src/pageRenderQueue.js');
  const limiter = createPageRenderLimiter({ maxConcurrent: 1, maxWaiting: 1 });
  let release;
  const running = limiter.run(() => new Promise((resolve) => { release = resolve; }));
  const waiting = limiter.run(async () => 'second');
  await assert.rejects(limiter.run(async () => 'third'), (error) => error.code === PAGE_RENDER_QUEUE_FULL);
  assert.deepEqual(limiter.status(), { active: 1, waiting: 1, maxConcurrent: 1, maxWaiting: 1 });
  release('first');
  assert.equal(await running, 'first');
  assert.equal(await waiting, 'second');
  assert.equal(await limiter.run(async () => 'after'), 'after');
});

test('item 6: the module-client timeout covers a stalled response body', { timeout: 5000 }, async () => {
  const { OpenEMRModuleClient } = await import('../src/openemrModuleClient.js');
  const server = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"ok":'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new OpenEMRModuleClient({ baseUrl: `http://127.0.0.1:${server.address().port}/api.php`, secret: 'synthetic-hmac', timeoutMs: 200 });
    const started = Date.now();
    await assert.rejects(client.health(), (error) => error.code === 'OPENEMR_MODULE_TIMEOUT' && error.httpStatus === 504);
    assert.ok(Date.now() - started < 3000, 'the request ends at the deadline, not when the server gives up');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('item 6: a token cache that failed to load is read again once it is fixed', async () => {
  const { OpenEMRRefreshTokenProvider } = await import('../src/openemrAdapter.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-token-'));
  const cachePath = path.join(dir, 'token.json');
  try {
    fs.writeFileSync(cachePath, '{"access_token":');
    const provider = new OpenEMRRefreshTokenProvider({ tokenUrl: 'https://openemr.test/oauth2/default/token', clientId: 'c', clientSecret: 's', cachePath, fetchImpl: async () => { throw new Error('no network in this test'); } });
    await assert.rejects(provider.getAccessToken(), SyntaxError);
    fs.writeFileSync(cachePath, JSON.stringify({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600 * 1000 }));
    assert.equal(await provider.getAccessToken(), 'synthetic-access');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('item 7: a free-text value under errorCode in a real briefing trace is redacted', async () => {
  class FreeTextCoverage extends FixtureAdapter {
    retrieve(item) {
      const retrieved = super.retrieve(item);
      return { ...retrieved, coverage: retrieved.coverage.map((group, index) => (index === 0 ? { ...group, error_class: 'Jane Doe 1980-04-12' } : group)) };
    }
  }
  const { service, traceSink } = buildService({ chartAdapter: new FreeTextCoverage(fixturePath) });
  const briefing = await service.prepare({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context('fixture-patient-001') });
  assert.notEqual(briefing.disposition, 'blocked');
  const [trace] = traceSink.list();
  assert.equal(trace.operation, 'visit_briefing');
  assert.equal(trace.retrieval.attempts[0].errorCode, '[REDACTED]');
  assert.ok(!JSON.stringify(trace).includes('Jane Doe') && !JSON.stringify(trace).includes('1980-04-12'));
});

test('item 7: on a real scan trace, code fields keep their codes and free text injected into reason, errorCode, issues or correlationId is redacted', async () => {
  const { service, traceSink, upload } = buildService();
  const doc = await upload('fixture-patient-001');
  await service.runActiveSupervisorForDocument(doc.source_document.id, { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context('fixture-patient-001'), query: 'glycemic follow-up', correlationId: 'af-0123456789abcdef0123456789abcdef' });
  const [trace] = traceSink.list();
  assert.equal(trace.operation, 'w2-scan-supervisor');
  // No over-redaction: every value in the real trace survives a second pass.
  assert.deepEqual(redactPayload(trace), trace);
  assert.equal(trace.correlationId, 'af-0123456789abcdef0123456789abcdef');
  assert.ok(trace.decisions.length > 0 && trace.decisions.every((decision) => decision.reason !== '[REDACTED]'));
  const injected = structuredClone(trace);
  injected.correlationId = 'Jane Doe';
  injected.stages[0].errorCode = 'lookup failed for Jane Doe';
  injected.decisions[0].reason = 'patient Jane Doe';
  injected.evaluation.issues = ['ok_code', 'dob 1980-04-12', '1980-04-12'];
  injected.retrieval.attempts[0].error_code = 'Jane Doe';
  injected.verification.reasons = ['no_documented_records', 'Smith, Jane'];
  const redacted = redactPayload(injected);
  assert.equal(redacted.correlationId, '[REDACTED]');
  assert.equal(redacted.stages[0].errorCode, '[REDACTED]');
  assert.equal(redacted.decisions[0].reason, '[REDACTED]');
  assert.deepEqual(redacted.evaluation.issues, ['ok_code', '[REDACTED]', '[REDACTED]']);
  assert.equal(redacted.retrieval.attempts[0].error_code, '[REDACTED]');
  assert.deepEqual(redacted.verification.reasons, ['no_documented_records', '[REDACTED]']);
  assert.ok(!JSON.stringify(redacted).includes('Jane'));
});
