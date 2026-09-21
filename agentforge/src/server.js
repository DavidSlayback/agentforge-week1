import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashScopeMultimodalProvider, DeterministicProvider, OpenAICompatibleProvider, OpenAIResponsesProvider, ResilientProvider } from './modelProvider.js';
import { OpenEMRRefreshTokenProvider, OpenEMRRestAdapter, SimulatedOpenEMRAdapter } from './openemrAdapter.js';
import { issueSignedContext, verifySignedContext } from './accessContext.js';
import { AgentForgeService, defaultFixturePath } from './service.js';
import { validateBriefingResponse, validateFollowUpRequest, validateFollowUpResponse, validatePrepareRequest, validateSourceDocumentRequest } from './contracts.js';
import { renderAgentForgePage, renderEvaluatorPage } from './ui.js';
import { renderObservabilityPage } from './observabilityPage.js';
import { PreparationCache } from './preparationCache.js';
import { LangfuseTraceSink, createReadinessChecker, evaluateAlerts } from '../../observability/index.js';

/**
 * Environment selects deterministic or external-primary model mode and live
 * REST or synthetic-fixture retrieval mode. External providers are wrapped
 * with retries and deterministic fallback.
 */
const providerMode = process.env.AGENTFORGE_PROVIDER_MODE || 'qwen';
const conversationProviderMode = process.env.AGENTFORGE_CONVERSATION_PROVIDER_MODE || '';
const buildProvider = (mode, role = 'synthesis') => {
  if (!mode || mode === 'deterministic') return new DeterministicProvider();
  const prefix = role === 'conversation' ? 'AGENTFORGE_CONVERSATION_' : '';
  const openRouter = mode === 'openrouter';
  const endpoint = process.env[`${prefix}${openRouter ? 'OPENROUTER_ENDPOINT' : 'MODEL_ENDPOINT'}`] || process.env[openRouter ? 'AGENTFORGE_OPENROUTER_ENDPOINT' : 'AGENTFORGE_MODEL_ENDPOINT'] || (openRouter ? 'https://openrouter.ai/api/v1/chat/completions' : '');
  const apiKey = process.env[`${prefix}${openRouter ? 'OPENROUTER_API_KEY' : 'MODEL_API_KEY'}`] || process.env[openRouter ? 'AGENTFORGE_OPENROUTER_API_KEY' : 'AGENTFORGE_MODEL_API_KEY'];
  const model = process.env[`${prefix}${openRouter ? 'OPENROUTER_MODEL' : 'MODEL'}`] || process.env[openRouter ? 'AGENTFORGE_OPENROUTER_MODEL' : 'AGENTFORGE_MODEL'] || '';
  const timeoutMs = Number(process.env[`${prefix}${openRouter ? 'OPENROUTER_TIMEOUT_MS' : 'MODEL_TIMEOUT_MS'}`] || process.env[openRouter ? 'AGENTFORGE_OPENROUTER_TIMEOUT_MS' : 'AGENTFORGE_MODEL_TIMEOUT_MS'] || 8000);
  const protocol = process.env[`${prefix}MODEL_PROTOCOL`] || process.env.AGENTFORGE_MODEL_PROTOCOL || 'compatible';
  if (!endpoint && !apiKey) return new DeterministicProvider();
  const options = { endpoint, apiKey, model, timeoutMs };
  const configured = openRouter || protocol === 'compatible' ? new OpenAICompatibleProvider({ ...options, siteUrl: process.env[`${prefix}${openRouter ? 'OPENROUTER_SITE_URL' : 'MODEL_SITE_URL'}`] || '', siteName: process.env[`${prefix}${openRouter ? 'OPENROUTER_SITE_NAME' : 'MODEL_SITE_NAME'}`] || 'AgentForge' }) : protocol === 'dashscope-multimodal' ? new DashScopeMultimodalProvider(options) : new OpenAIResponsesProvider(options);
  return new ResilientProvider({ primary: configured, fallback: new DeterministicProvider() });
};
const publicBasePath = process.env.AGENTFORGE_PUBLIC_BASE_PATH || '';
const provider = buildProvider(providerMode);
// Optional cheap interactive lane. It is deliberately opt-in so the existing
// Qwen-only deployment remains unchanged until a model and budget are approved.
const conversationProvider = conversationProviderMode ? buildProvider(conversationProviderMode, 'conversation') : null;
const openEMRMode = process.env.AGENTFORGE_OPENEMR_MODE || 'synthetic';
const liveOpenEMR = openEMRMode === 'live';
const validOpenEMRMode = openEMRMode === 'synthetic' || openEMRMode === 'live';
const openEMRTokenProvider = liveOpenEMR && process.env.AGENTFORGE_OPENEMR_CLIENT_ID && process.env.AGENTFORGE_OPENEMR_CLIENT_SECRET && process.env.AGENTFORGE_OPENEMR_TOKEN_URL && process.env.AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH
  ? new OpenEMRRefreshTokenProvider({ tokenUrl: process.env.AGENTFORGE_OPENEMR_TOKEN_URL, clientId: process.env.AGENTFORGE_OPENEMR_CLIENT_ID, clientSecret: process.env.AGENTFORGE_OPENEMR_CLIENT_SECRET, cachePath: process.env.AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH, timeoutMs: Number(process.env.AGENTFORGE_OPENEMR_TIMEOUT_MS || 5000) })
  : null;
// Live mode requires caller-supplied signed context. This server does not
// establish OpenEMR session identity or bind it to that context.
// Test-only fault injection keeps persistence-failure coverage at the HTTP
// boundary without adding a user-controlled production behavior.
const syntheticSourceDocumentStore = process.env.AGENTFORGE_TEST_SOURCE_DOCUMENT_FAILURE === 'true'
  ? { persist() { throw Object.assign(new Error('SOURCE_DOCUMENT_PERSISTENCE_FAILED'), { code: 'SOURCE_DOCUMENT_PERSISTENCE_FAILED' }); } }
  : undefined;
const adapter = liveOpenEMR ? new OpenEMRRestAdapter({ baseUrl: process.env.AGENTFORGE_OPENEMR_BASE_URL, accessToken: process.env.AGENTFORGE_OPENEMR_ACCESS_TOKEN, tokenProvider: openEMRTokenProvider, requiredIssuer: 'openemr-module', requiredAuthn: 'openemr-session', requiredRole: 'clinician', timeoutMs: Number(process.env.AGENTFORGE_OPENEMR_TIMEOUT_MS || 5000) }) : new SimulatedOpenEMRAdapter({ fixturePath: process.env.AGENTFORGE_FIXTURES || defaultFixturePath(), ...(syntheticSourceDocumentStore ? { sourceDocumentStore: syntheticSourceDocumentStore } : {}) });
const hasExternalProvider = [provider, conversationProvider].some((candidate) => candidate && candidate.name !== 'deterministic');
const liveExternalProviderAllowed = !liveOpenEMR || !hasExternalProvider || process.env.AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED === 'true';
// FileTraceSink redacts before persistence and listing; these endpoints expose
// operational metadata, not raw briefing or chart content.
const traceSink = new LangfuseTraceSink({ filePath: process.env.AGENTFORGE_TRACE_PATH || path.join('/tmp', 'agentforge', 'traces.json'), maxTraces: 100, retentionMs: Number(process.env.AGENTFORGE_TRACE_RETENTION_MS || 24 * 60 * 60 * 1000), onExportError: () => {} });
const alertThresholds = { p95LatencyMs: Number(process.env.AGENTFORGE_ALERT_P95_MS || 2000), errorRate: Number(process.env.AGENTFORGE_ALERT_ERROR_RATE || 0.05), toolFailureRate: Number(process.env.AGENTFORGE_ALERT_TOOL_FAILURE_RATE || 0.02) };
const alertWindowMs = Number(process.env.AGENTFORGE_ALERT_WINDOW_MS || 5 * 60 * 1000);
const preparationCache = new PreparationCache({ ttlMs: Number(process.env.AGENTFORGE_PREPARATION_CACHE_TTL_MS || 5 * 60 * 1000) });
const service = new AgentForgeService({ adapter, provider, conversationProvider, traceSink, cache: preparationCache, freshRetrievalDeadlineMs: Number(process.env.AGENTFORGE_FRESH_RETRIEVAL_DEADLINE_MS || 8000), allowExternalLiveProvider: liveExternalProviderAllowed, maxPrewarmJobs: Number(process.env.AGENTFORGE_MAX_PREWARM_JOBS || 8), prewarmDeadlineMs: Number(process.env.AGENTFORGE_PREWARM_DEADLINE_MS || 8000) });
// `/ready` checks configured dependencies and a cached, bounded non-clinical
// provider probe; it is not output-quality or production-compliance proof.
// `/health` is process liveness.
let providerProbe = new Map();
const modelReadiness = { checkReady: async () => {
  for (const candidate of [provider, conversationProvider].filter(Boolean)) {
    if (!await candidate.checkReady()) return false;
    if (candidate.name === 'deterministic') continue;
    const now = Date.now();
    const cached = providerProbe.get(candidate);
    if (cached && now - cached.checkedAt < 30000) { if (!cached.reachable) return false; continue; }
    const reachable = await candidate.checkReachable();
    providerProbe.set(candidate, { checkedAt: now, reachable });
    if (!reachable) return false;
  }
  return true;
} };
const readiness = createReadinessChecker({
  configuration: { checkReady: async () => ['qwen', 'openrouter'].includes(providerMode) && validOpenEMRMode && liveExternalProviderAllowed && Boolean(process.env.AGENTFORGE_DEMO_SECRET) && (liveOpenEMR || process.env.AGENTFORGE_SYNTHETIC_CONTEXT === 'true') },
  retrieval: adapter,
  model: modelReadiness,
  trace: { checkReady: async () => traceSink.health().status === 'ok' },
});
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evalsRoot = path.join(projectRoot, 'evals');
const readEvidence = (name) => JSON.parse(fs.readFileSync(path.join(evalsRoot, name), 'utf8'));
const readGoldenEvidence = () => process.env.AGENTFORGE_EVAL_REPORT_PATH ? JSON.parse(fs.readFileSync(process.env.AGENTFORGE_EVAL_REPORT_PATH, 'utf8')) : readEvidence('deployed-service-results.json');
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const html = (res, body) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };
const invalidContract = (res, error, issues) => json(res, 400, { error, issues });
const invalidResponse = (res, error, issues) => json(res, 500, { error, issues });
const tokenPayload = (token) => verifySignedContext(token, process.env.AGENTFORGE_DEMO_SECRET);
const verifiedContextFor = (body) => tokenPayload(body.demo_token);
const syntheticWritebackEnabled = () => adapter.name === 'simulated-openemr' && typeof adapter.persistSourceDocument === 'function';
const sourceDocumentErrorStatus = (error) => {
  const code = error.code || error.message;
  const contractCodes = new Set(['SOURCE_DOCUMENT_PATIENT_REQUIRED', 'SOURCE_DOCUMENT_TYPE_INVALID', 'SOURCE_DOCUMENT_FILENAME_REQUIRED', 'SOURCE_DOCUMENT_FILENAME_INVALID', 'SOURCE_DOCUMENT_CONTENT_INVALID', 'SOURCE_DOCUMENT_UPLOADER_REQUIRED']);
  return code === 'SOURCE_DOCUMENT_TOO_LARGE' ? 413 : code === 'DOCUMENT_NOT_FOUND' ? 404 : code === 'DOCUMENT_SCOPE_MISMATCH' ? 403 : contractCodes.has(code) ? 400 : 500;
};
// The source-document contract accepts up to 5 MiB of decoded bytes. JSON
// base64 encoding needs headroom above that limit before source validation.
const maxRequestBodyBytes = Number(process.env.AGENTFORGE_MAX_REQUEST_BODY_BYTES || 8 * 1024 * 1024);
async function readJsonBody(req) {
  if (Number(req.headers['content-length'] || 0) > maxRequestBodyBytes) throw Object.assign(new Error('REQUEST_BODY_TOO_LARGE'), { code: 'REQUEST_BODY_TOO_LARGE' });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > maxRequestBodyBytes) throw Object.assign(new Error('REQUEST_BODY_TOO_LARGE'), { code: 'REQUEST_BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && req.url === '/ready') { const result = await readiness.ready(); return json(res, result.status === 'ready' ? 200 : 503, result); }
    // These endpoints have no separate request authorization. Redaction is
    // their current safety boundary, not a production access policy.
    if (req.method === 'GET' && req.url === '/v1/traces') { await traceSink.flush?.(); return json(res, 200, traceSink.list()); }
    if (req.method === 'GET' && req.url === '/v1/metrics') return json(res, 200, traceSink.snapshot());
    if (req.method === 'GET' && req.url === '/v1/alerts') return json(res, 200, evaluateAlerts(traceSink.snapshot({ windowMs: alertWindowMs }), alertThresholds));
    if (req.method === 'GET' && req.url.startsWith('/v1/demo-context')) {
      if (liveOpenEMR) return json(res, 404, { error: 'openemr_context_required' });
      if (process.env.AGENTFORGE_SYNTHETIC_CONTEXT !== 'true') return json(res, 404, { error: 'synthetic_context_disabled' });
      const patient = new URL(req.url, 'http://localhost').searchParams.get('patient_uuid');
      if (!patient || (!/^fixture-patient-\d{3}$/.test(patient) && patient !== 'fixture-patient-dup')) return json(res, 400, { error: 'invalid_synthetic_patient' });
      const token = issueSignedContext({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', issuer: 'synthetic-demo', authn: 'synthetic', secret: process.env.AGENTFORGE_DEMO_SECRET });
      return json(res, 200, { demo_token: token, patient_uuid: patient, clinician_uuid: 'fixture-physician-001', expires_in_seconds: 300, synthetic_only: true });
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/source-document-context')) {
      if (liveOpenEMR) return json(res, 403, { error: 'synthetic_writeback_only' });
      if (process.env.AGENTFORGE_SYNTHETIC_CONTEXT !== 'true') return json(res, 404, { error: 'synthetic_context_disabled' });
      const patient = new URL(req.url, 'http://localhost').searchParams.get('patient_uuid');
      if (!patient || (!/^fixture-patient-\d{3}$/.test(patient) && patient !== 'fixture-patient-dup')) return json(res, 400, { error: 'invalid_synthetic_patient' });
      const token = issueSignedContext({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', scope: 'write-source-document', acl: 'write', issuer: 'synthetic-demo', authn: 'synthetic', secret: process.env.AGENTFORGE_DEMO_SECRET });
      return json(res, 200, { demo_token: token, patient_uuid: patient, clinician_uuid: 'fixture-physician-001', expires_in_seconds: 300, synthetic_only: true, scope: 'write-source-document' });
    }
    if (req.method === 'GET' && req.url === '/evals/deployed-service-results.json') return json(res, 200, readEvidence('deployed-service-results.json'));
    if (req.method === 'GET' && req.url === '/evals/error-analysis.json') return json(res, 200, readEvidence('error-analysis.json'));
    if (req.method === 'GET' && req.url === '/evals/active-service-results.json') return json(res, 200, readGoldenEvidence());
    if (req.method === 'GET' && req.url === '/evals') { const golden = readGoldenEvidence(); const errorAnalysis = readEvidence('error-analysis.json'); return html(res, renderEvaluatorPage({ golden, errorAnalysis, basePath: publicBasePath, localReport: Boolean(process.env.AGENTFORGE_EVAL_REPORT_PATH) })); }
    const sourceDocumentMatch = req.url.match(/^\/v1\/source-documents\/([^?]+)(?:\?(.*))?$/);
    if (req.method === 'GET' && sourceDocumentMatch) {
      if (!syntheticWritebackEnabled()) return json(res, 403, { error: 'synthetic_writeback_only' });
      const query = new URL(req.url, 'http://localhost').searchParams;
      const patient_uuid = query.get('patient_uuid') || '';
      const token = tokenPayload(query.get('demo_token') || '');
      if (!token || token.patient_uuid !== patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      try {
        const result = service.readSourceDocument(decodeURIComponent(sourceDocumentMatch[1]), { patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token });
        if (result.status !== 'read') return json(res, 403, { error: result.reason });
        return json(res, 200, { synthetic_only: true, source_document: result.source_document, content_base64: result.content.toString('base64') });
      } catch (error) {
        if ((error.code || error.message) === 'DOCUMENT_SCOPE_MISMATCH') return json(res, 403, { error: 'invalid_demo_context' });
        return json(res, sourceDocumentErrorStatus(error), { error: error.code || error.message });
      }
    }
    if (req.method === 'GET' && (req.url === '/observability' || req.url === '/observability/')) return html(res, renderObservabilityPage());
    if (req.method === 'GET' && req.url.startsWith('/')) { const token = new URL(req.url, 'http://localhost').searchParams.get('demo_token') || ''; return html(res, renderAgentForgePage({ token, payload: tokenPayload(token), publicBasePath, liveOpenEMR })); }
    let body;
    try { body = await readJsonBody(req); } catch (error) { return json(res, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, { error: error.code === 'REQUEST_BODY_TOO_LARGE' ? error.code.toLowerCase() : 'invalid_json' }); }
    if (req.method === 'POST' && req.url === '/v1/source-documents') {
      if (!syntheticWritebackEnabled()) return json(res, 403, { error: 'synthetic_writeback_only' });
      const validation = validateSourceDocumentRequest(body);
      if (!validation.valid) return invalidContract(res, 'invalid_source_document_request', validation.issues);
      const token = verifiedContextFor(body);
      if (!token || token.patient_uuid !== body.patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      body.clinician_uuid = token.clinician_uuid;
      try {
        const result = service.ingestSourceDocument({ ...body, content: Buffer.from(body.content_base64, 'base64') }, { verifiedContext: token });
        if (result.status !== 'persisted') return json(res, 403, { error: result.reason });
        return json(res, 200, result);
      } catch (error) {
        return json(res, sourceDocumentErrorStatus(error), { error: error.code || error.message });
      }
    }
    if (req.method === 'POST' && req.url === '/v1/briefings') { const validation = validatePrepareRequest(body); if (!validation.valid) return invalidContract(res, 'invalid_prepare_request', validation.issues); const token = verifiedContextFor(body); if (body.demo_token && (!token || token.patient_uuid !== body.patient_uuid)) return json(res, 403, { error: 'invalid_demo_context' }); if (token) body.clinician_uuid = token.clinician_uuid; const result = await service.prepare(body, { verifiedContext: token, reusePrepared: true, interactionType: 'background_preparation' }); const responseValidation = validateBriefingResponse(result); return responseValidation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_briefing_response', responseValidation.issues); }
    if (req.method === 'POST' && req.url === '/v1/prewarm') { if (typeof body.patient_uuid !== 'string' || typeof body.clinician_uuid !== 'string' || typeof body.schedule_revision !== 'string' || !body.schedule_revision.trim()) return invalidContract(res, 'invalid_prewarm_request', ['patient_uuid, clinician_uuid, and schedule_revision are required']); const token = verifiedContextFor(body); if (!token || token.patient_uuid !== body.patient_uuid) return json(res, 403, { error: 'invalid_demo_context' }); body.clinician_uuid = token.clinician_uuid; const result = service.prewarm(body, { verifiedContext: token, scheduleRevision: body.schedule_revision, sourceRevision: body.source_revision }); if (result.status === 'blocked') return json(res, 403, { error: result.reason }); if (result.status === 'busy') return json(res, 429, { error: result.reason, status: result.status, synthetic_only: true }); return json(res, 202, { status: result.status, correlation_id: result.correlation_id, duplicate: result.duplicate, synthetic_only: true }); }
    const preparedMatch = req.url.match(/^\/v1\/prewarm\/([^/]+)\/open$/);
    if (req.method === 'POST' && preparedMatch) { const token = verifiedContextFor(body); if (!token || token.patient_uuid !== body.patient_uuid) return json(res, 403, { error: 'invalid_demo_context' }); body.clinician_uuid = token.clinician_uuid; const result = service.openPrepared(preparedMatch[1], body, { verifiedContext: token, resetConversation: body.reset_conversation === true }); return result.status === 'ready' ? json(res, 200, result.response) : json(res, 409, { error: result.reason, status: result.status }); }
    const match = req.url.match(/^\/v1\/conversations\/([^/]+)\/messages$/);
    if (req.method === 'POST' && match) { const validation = validateFollowUpRequest(body); if (!validation.valid) return invalidContract(res, 'invalid_follow_up_request', validation.issues); const token = verifiedContextFor(body); if (body.demo_token && (!token || token.patient_uuid !== body.patient_uuid)) return json(res, 403, { error: 'invalid_demo_context' }); if (token) body.clinician_uuid = token.clinician_uuid; const result = await service.followUp(match[1], body, { verifiedContext: token }); const responseValidation = validateFollowUpResponse(result); return responseValidation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_follow_up_response', responseValidation.issues); }
    return json(res, 404, { error: 'not_found' });
  } catch (error) { console.error('AgentForge request failed', error); return json(res, error.message === 'PATIENT_NOT_FOUND' ? 404 : 500, { error: error.message === 'PATIENT_NOT_FOUND' ? 'patient_not_found' : 'internal_error' }); }
});
server.listen(process.env.PORT || 8787, process.env.HOST || '0.0.0.0', () => console.log('AgentForge listening'));
