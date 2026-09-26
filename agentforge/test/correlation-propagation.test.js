import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import observability from '../../observability/index.js';
import { AgentForgeService, defaultFixturePath } from '../src/service.js';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { ChartSourceRouter } from '../src/chartSourceRouter.js';
import { OpenEMRRefreshTokenProvider, OpenEMRRestAdapter } from '../src/openemrAdapter.js';
import { OpenEMRModuleClient, OpenEMRModuleError } from '../src/openemrModuleClient.js';
import { OpenEMRModuleWriteback } from '../src/openemrModuleWriteback.js';
import { createGeminiHybridGuidelineRetriever, loadGuidelineCorpus } from '../src/guidelineEvidence.js';
import { createLiveGeminiClient } from '../src/geminiClient.js';
import { createQwenReranker } from '../src/reranker.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { startFakeOpenEMRModule } from './fake-openemr-module.js';
import { fakeOpenEMRRestFetch, LIVE_PATIENT } from './helpers/fakeOpenemrRest.js';

// F-OBS item 5 (W2_ARCHITECTURE.md §4 debt #9): one request's correlation id
// reaches every outbound call it causes -- the chart getCase and reads, the
// OAuth token refresh, the guideline embed and rerank calls, and the OpenEMR
// module client -- instead of each minting its own. Every transport is a
// recording fake; nothing leaves the process.

const secret = 'synthetic-test-secret';
const hmacSecret = 'synthetic-module-hmac-secret';
const clinician = '6f1e2d3c-4b5a-4968-8776-655443322110';
const REQUEST_ID = 'corr-fobs-scan-0001';
const labEnvelope = [
  'SYNTHETIC_SCAN_FORM|layout=pdf-ocr-lab_pdf|page_count=1',
  ...[
    ['lab.a1c.test_name', 'A1C'], ['lab.a1c.value', '6.1'], ['lab.a1c.unit', '%'], ['lab.a1c.reference_range', 'under 5.7'], ['lab.a1c.collection_date', '2026-09-20'], ['lab.a1c.abnormal', 'Yes'],
  ].map(([fieldId, value], index) => `FIELD|field_id=${fieldId}|label=${fieldId}|value=${value}|unit=|quote=${fieldId}: ${value}|page=1|box=10,${20 + index * 20},300,${35 + index * 20}|confidence=0.97`),
].join('\n');

const headerId = (options) => options?.headers?.['x-correlation-id'] ?? null;

async function buildStack() {
  const calls = [];
  const record = (kind, id) => calls.push({ kind, id });
  const module = await startFakeOpenEMRModule({ hmacSecret, contextSecret: secret, allowlist: [LIVE_PATIENT] });
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-corr-'));
  const cachePath = path.join(cacheDir, 'token.json');
  fs.writeFileSync(cachePath, JSON.stringify({ access_token: 'expired', refresh_token: 'synthetic-refresh', expires_at: 0 }));
  const tokenProvider = new OpenEMRRefreshTokenProvider({
    tokenUrl: 'http://openemr.test/oauth2/default/token', clientId: 'client', clientSecret: 'client-secret', cachePath,
    fetchImpl: async (url, options) => { record('oauth_refresh', headerId(options)); return { ok: true, status: 200, async json() { return { access_token: 'synthetic-token', expires_in: 3600 }; } }; },
  });
  const restFetch = fakeOpenEMRRestFetch();
  const liveAdapter = new OpenEMRRestAdapter({
    baseUrl: 'http://openemr.test', tokenProvider,
    fetchImpl: (url, options) => { record(new URL(url).pathname === `/apis/default/api/patient/${LIVE_PATIENT}` ? 'openemr_get_case' : 'openemr_read', headerId(options)); return restFetch(url, options); },
  });
  const chartAdapter = new ChartSourceRouter({ fixtureAdapter: new FixtureAdapter(defaultFixturePath()), liveAdapter, liveReads: true, liveConfigured: true });
  const client = new OpenEMRModuleClient({ baseUrl: module.url, secret: hmacSecret, fetchImpl: (url, options) => { record('openemr_module', headerId(options)); return fetch(url, options); } });
  const writeback = new OpenEMRModuleWriteback({ client, secret, demoPatientAllowlist: new Set([LIVE_PATIENT]) });
  // Real Gemini client and Qwen reranker code over fake transports. Every
  // corpus chunk gets the same unit vector, so the dense step always runs.
  const corpus = loadGuidelineCorpus();
  const embeddings = { vectors: Object.fromEntries(corpus.map((document) => [document.source_id, [1, 0, 0]])) };
  const embedClient = createLiveGeminiClient({ apiKey: 'synthetic-gemini-key', fetchImpl: async (url, options) => { record('guideline_embed', headerId(options)); return { ok: true, status: 200, async json() { return { embedding: { values: [1, 0, 0] } }; } }; } });
  const reranker = createQwenReranker({ endpoint: 'http://qwen.test/v1/responses', apiKey: 'synthetic-qwen-key', fetchImpl: async (url, options) => { record('guideline_rerank', headerId(options)); return { ok: false, status: 503, async json() { return {}; } }; } });
  const guidelineRetriever = createGeminiHybridGuidelineRetriever({ embedClient, reranker, corpus, embeddings });
  const traceSink = new observability.InMemoryTraceSink();
  const service = new AgentForgeService({ chartAdapter, writeback, guidelineRetriever, provider: null, answerProvider: null, traceSink, allowExternalLiveProvider: true, livePatientAllowlist: new Set([LIVE_PATIENT]) });
  return { service, calls, traceSink, stop: async () => { await module.close(); fs.rmSync(cacheDir, { recursive: true, force: true }); } };
}

const writeContext = () => verifySignedContext(issueSignedContext({ patient_uuid: LIVE_PATIENT, clinician_uuid: clinician, scope: 'write-source-document', acl: 'write', issuer: 'openemr-module', authn: 'openemr-session', secret }), secret);

test('one scan request carries its correlation id into getCase, token refresh, embed, rerank and every module call', async () => {
  const stack = await buildStack();
  try {
    const context = writeContext();
    const request = { patient_uuid: LIVE_PATIENT, clinician_uuid: clinician };
    const uploaded = await stack.service.ingestSourceDocument({ ...request, document_type: 'lab_pdf', filename: 'lab-ocr-envelope.scan.txt', content: Buffer.from(labEnvelope) }, { verifiedContext: context, correlationId: 'corr-fobs-upload-0001' });
    assert.equal(uploaded.status, 'persisted');
    assert.deepEqual(stack.calls.map((call) => [call.kind, call.id]), [['openemr_module', 'corr-fobs-upload-0001']], 'the upload uses its own request id');
    stack.calls.length = 0;

    // One scan-supervisor request: the scan itself plus the derived-evidence write the server makes for it.
    const result = await stack.service.runActiveSupervisorForDocument(uploaded.source_document.id, request, { verifiedContext: context, query: 'What does the elevated A1C mean for diabetes follow up?', correlationId: REQUEST_ID });
    assert.equal(result.status, 'completed');
    const persisted = await stack.service.persistDerivedEvidence(result.source_document, result.workflow.typed_outputs.extraction, request, { verifiedContext: context, finalState: result.workflow.final_state, correlationId: REQUEST_ID });
    assert.equal(persisted.status, 'persisted');

    const kinds = new Set(stack.calls.map((call) => call.kind));
    for (const kind of ['openemr_module', 'openemr_get_case', 'openemr_read', 'oauth_refresh', 'guideline_embed', 'guideline_rerank']) assert.ok(kinds.has(kind), `no ${kind} call was made`);
    const wrong = stack.calls.filter((call) => call.id !== REQUEST_ID);
    assert.deepEqual(wrong, [], 'every outbound call carries the request id');
    assert.equal(stack.traceSink.list().at(-1).correlationId, REQUEST_ID, 'the trace is filed under the same id');
  } finally {
    await stack.stop();
  }
});

test('without a request id the scan trace keeps its own id and the module client mints one per call', async () => {
  const stack = await buildStack();
  try {
    const context = writeContext();
    const request = { patient_uuid: LIVE_PATIENT, clinician_uuid: clinician };
    await stack.service.ingestSourceDocument({ ...request, document_type: 'lab_pdf', filename: 'lab-ocr-envelope.scan.txt', content: Buffer.from(labEnvelope) }, { verifiedContext: context });
    const [call] = stack.calls;
    assert.match(call.id, /^af-[0-9a-f-]{36}$/);
  } finally {
    await stack.stop();
  }
});

test('module errors carry the request id', async () => {
  const client = new OpenEMRModuleClient({ baseUrl: 'http://module.test/api.php', secret: hmacSecret, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(client.health({ correlationId: REQUEST_ID }), (error) => error instanceof OpenEMRModuleError && error.code === 'OPENEMR_MODULE_UNREACHABLE' && error.correlationId === REQUEST_ID);
});

test('a failed token refresh carries the request id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-corr-token-'));
  try {
    const cachePath = path.join(dir, 'token.json');
    fs.writeFileSync(cachePath, JSON.stringify({ access_token: 'expired', refresh_token: 'synthetic-refresh', expires_at: 0 }));
    const provider = new OpenEMRRefreshTokenProvider({ tokenUrl: 'http://openemr.test/token', clientId: 'c', clientSecret: 's', cachePath, fetchImpl: async () => ({ ok: false, status: 400, async json() { return {}; } }) });
    await assert.rejects(provider.getAccessToken({ correlationId: REQUEST_ID }), (error) => error.code === 'OPENEMR_TOKEN_HTTP_400' && error.correlationId === REQUEST_ID);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
