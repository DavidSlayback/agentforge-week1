import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashScopeMultimodalProvider, DeterministicProvider, OpenAICompatibleProvider, OpenAIResponsesProvider, ResilientProvider } from './modelProvider.js';
import { OpenEMRRefreshTokenProvider, OpenEMRRestAdapter, SimulatedOpenEMRAdapter } from './openemrAdapter.js';
import { issueSignedContext, verifySignedContext } from './accessContext.js';
import { AgentForgeService, defaultFixturePath } from './service.js';
import { validateBriefingResponse, validateFollowUpRequest, validateFollowUpResponse, validatePrepareRequest } from './contracts.js';
import { renderAgentForgePage, renderEvaluatorPage } from './ui.js';
import { PreparationCache } from './preparationCache.js';
import { LangfuseTraceSink, createReadinessChecker, evaluateAlerts } from '../../observability/index.js';

/**
 * Environment selects deterministic or external-primary model mode and live
 * REST or synthetic-fixture retrieval mode. External providers are wrapped
 * with retries and deterministic fallback.
 */
const providerOptions = { endpoint: process.env.AGENTFORGE_MODEL_ENDPOINT, apiKey: process.env.AGENTFORGE_MODEL_API_KEY, model: process.env.AGENTFORGE_MODEL || 'configured-model', timeoutMs: Number(process.env.AGENTFORGE_MODEL_TIMEOUT_MS || 8000) };
const configuredProvider = process.env.AGENTFORGE_MODEL_ENDPOINT ? (process.env.AGENTFORGE_MODEL_PROTOCOL === 'dashscope-multimodal' ? new DashScopeMultimodalProvider(providerOptions) : process.env.AGENTFORGE_MODEL_PROTOCOL === 'responses' ? new OpenAIResponsesProvider(providerOptions) : new OpenAICompatibleProvider({ ...providerOptions, siteUrl: process.env.AGENTFORGE_MODEL_SITE_URL || '', siteName: process.env.AGENTFORGE_MODEL_SITE_NAME || 'AgentForge' })) : new DeterministicProvider();
const publicBasePath = process.env.AGENTFORGE_PUBLIC_BASE_PATH || '';
const provider = new ResilientProvider({ primary: configuredProvider, fallback: new DeterministicProvider() });
const openEMRMode = process.env.AGENTFORGE_OPENEMR_MODE || 'synthetic';
const liveOpenEMR = openEMRMode === 'live';
const validOpenEMRMode = openEMRMode === 'synthetic' || openEMRMode === 'live';
const openEMRTokenProvider = liveOpenEMR && process.env.AGENTFORGE_OPENEMR_CLIENT_ID && process.env.AGENTFORGE_OPENEMR_CLIENT_SECRET && process.env.AGENTFORGE_OPENEMR_TOKEN_URL && process.env.AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH
  ? new OpenEMRRefreshTokenProvider({ tokenUrl: process.env.AGENTFORGE_OPENEMR_TOKEN_URL, clientId: process.env.AGENTFORGE_OPENEMR_CLIENT_ID, clientSecret: process.env.AGENTFORGE_OPENEMR_CLIENT_SECRET, cachePath: process.env.AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH, timeoutMs: Number(process.env.AGENTFORGE_OPENEMR_TIMEOUT_MS || 5000) })
  : null;
// Live mode requires caller-supplied signed context. This server does not
// establish OpenEMR session identity or bind it to that context.
const adapter = liveOpenEMR ? new OpenEMRRestAdapter({ baseUrl: process.env.AGENTFORGE_OPENEMR_BASE_URL, accessToken: process.env.AGENTFORGE_OPENEMR_ACCESS_TOKEN, tokenProvider: openEMRTokenProvider, requiredIssuer: 'openemr-module', requiredAuthn: 'openemr-session', requiredRole: 'clinician', timeoutMs: Number(process.env.AGENTFORGE_OPENEMR_TIMEOUT_MS || 5000) }) : new SimulatedOpenEMRAdapter({ fixturePath: process.env.AGENTFORGE_FIXTURES || defaultFixturePath() });
// FileTraceSink redacts before persistence and listing; these endpoints expose
// operational metadata, not raw briefing or chart content.
const traceSink = new LangfuseTraceSink({ filePath: process.env.AGENTFORGE_TRACE_PATH || path.join('/tmp', 'agentforge', 'traces.json'), maxTraces: 100, retentionMs: Number(process.env.AGENTFORGE_TRACE_RETENTION_MS || 24 * 60 * 60 * 1000), onExportError: () => {} });
const alertThresholds = { p95LatencyMs: Number(process.env.AGENTFORGE_ALERT_P95_MS || 2000), errorRate: Number(process.env.AGENTFORGE_ALERT_ERROR_RATE || 0.05), toolFailureRate: Number(process.env.AGENTFORGE_ALERT_TOOL_FAILURE_RATE || 0.02) };
const alertWindowMs = Number(process.env.AGENTFORGE_ALERT_WINDOW_MS || 5 * 60 * 1000);
const preparationCache = new PreparationCache({ ttlMs: Number(process.env.AGENTFORGE_PREPARATION_CACHE_TTL_MS || 5 * 60 * 1000) });
const service = new AgentForgeService({ adapter, provider, traceSink, cache: preparationCache, freshRetrievalDeadlineMs: Number(process.env.AGENTFORGE_FRESH_RETRIEVAL_DEADLINE_MS || 8000) });
// `/ready` reports configured dependency checks, not provider reachability,
// output quality, or production compliance. `/health` is process liveness.
const readiness = createReadinessChecker({
  configuration: { checkReady: async () => validOpenEMRMode && Boolean(process.env.AGENTFORGE_DEMO_SECRET) && (liveOpenEMR || process.env.AGENTFORGE_SYNTHETIC_CONTEXT === 'true') },
  retrieval: adapter,
  model: provider,
  trace: { checkReady: async () => traceSink.health().status === 'ok' },
});
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evalsRoot = path.join(projectRoot, 'evals');
const readEvidence = (name) => JSON.parse(fs.readFileSync(path.join(evalsRoot, name), 'utf8'));
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const html = (res, body) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };
const observabilityPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentForge observability</title><style>body{font-family:system-ui,sans-serif;max-width:72rem;margin:2rem auto;padding:0 1rem;color:#17202a;background:#f7f9fb}main{background:#fff;border:1px solid #d9e2ec;border-radius:.75rem;padding:1.25rem;box-shadow:0 2px 8px #17202a12}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:.65rem}.card{border:1px solid #d9e2ec;border-radius:.5rem;padding:.7rem}.value{display:block;font-size:1.35rem;font-weight:700}.muted{color:#52606d;font-size:.85rem}.ok{color:#087443}.warn{color:#8a5a00;background:#fff8df;padding:.65rem;border-left:4px solid #d49b00}pre{white-space:pre-wrap;overflow:auto;background:#f7f9fb;padding:.75rem;border-radius:.4rem}</style></head><body><main><h1>AgentForge observability</h1><p class="warn">Synthetic, redacted operational view. It reconstructs service behavior; it does not expose chart content or prove production compliance.</p><section><h2>Live metrics</h2><div id="cards" class="grid">Loading…</div></section><section><h2>Alert rules and current state</h2><pre id="alerts">Loading…</pre></section><section><h2>Recent redacted traces</h2><pre id="traces">Loading…</pre></section></main><script>(()=>{const basePath=location.pathname.startsWith('/agentforge')?'/agentforge':'';Promise.all([fetch(basePath+'/v1/metrics').then(r=>r.json()),fetch(basePath+'/v1/alerts').then(r=>r.json()),fetch(basePath+'/v1/traces').then(r=>r.json())]).then(([m,a,t])=>{const telemetry=m.telemetry||{};cards.innerHTML=[['Requests',m.requests],['Errors',m.errors],['p50 latency',m.latencyMs?.p50+' ms'],['p95 latency',m.latencyMs?.p95+' ms'],['Retries',m.retries],['Provider fallbacks',m.providerFallbacks],['Telemetry queue',telemetry.pendingExports??m.queueDepth],['Telemetry dropped',telemetry.droppedExports??0],['Verification',JSON.stringify(m.verificationOutcomes||{})],['Display',JSON.stringify(m.displayOutcomes||{})]].map(([k,v])=>'<div class="card"><span class="value">'+String(v)+'</span><span class="muted">'+k+'</span></div>').join('');alerts.textContent=JSON.stringify(a,null,2);traces.textContent=JSON.stringify(t,null,2)}).catch(error=>{alerts.textContent='Dashboard data unavailable: '+error;traces.textContent='Dashboard data unavailable'})})()</script></body></html>`;
const invalidContract = (res, error, issues) => json(res, 400, { error, issues });
const invalidResponse = (res, error, issues) => json(res, 500, { error, issues });
const tokenPayload = (token) => verifySignedContext(token, process.env.AGENTFORGE_DEMO_SECRET);
const verifiedContextFor = (body) => tokenPayload(body.demo_token);
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && req.url === '/ready') { const result = await readiness.ready(); return json(res, result.status === 'ready' ? 200 : 503, result); }
    // These endpoints have no separate request authorization. Redaction is
    // their current safety boundary, not a production access policy.
    if (req.method === 'GET' && req.url === '/v1/traces') return json(res, 200, traceSink.list());
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
    if (req.method === 'GET' && req.url === '/evals/deployed-service-results.json') return json(res, 200, readEvidence('deployed-service-results.json'));
    if (req.method === 'GET' && req.url === '/evals/error-analysis.json') return json(res, 200, readEvidence('error-analysis.json'));
    if (req.method === 'GET' && req.url === '/evals') { const golden = readEvidence('deployed-service-results.json'); const errorAnalysis = readEvidence('error-analysis.json'); return html(res, renderEvaluatorPage({ golden, errorAnalysis, basePath: publicBasePath })); }
    if (req.method === 'GET' && (req.url === '/observability' || req.url === '/observability/')) return html(res, observabilityPage);
    if (req.method === 'GET' && req.url.startsWith('/')) { const token = new URL(req.url, 'http://localhost').searchParams.get('demo_token') || ''; return html(res, renderAgentForgePage({ token, payload: tokenPayload(token), publicBasePath, liveOpenEMR })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'invalid_json' }); }
    if (req.method === 'POST' && req.url === '/v1/briefings') { const validation = validatePrepareRequest(body); if (!validation.valid) return invalidContract(res, 'invalid_prepare_request', validation.issues); const token = verifiedContextFor(body); if (body.demo_token && (!token || token.patient_uuid !== body.patient_uuid)) return json(res, 403, { error: 'invalid_demo_context' }); if (token) body.clinician_uuid = token.clinician_uuid; const result = await service.prepare(body, { verifiedContext: token }); const responseValidation = validateBriefingResponse(result); return responseValidation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_briefing_response', responseValidation.issues); }
    const match = req.url.match(/^\/v1\/conversations\/([^/]+)\/messages$/);
    if (req.method === 'POST' && match) { const validation = validateFollowUpRequest(body); if (!validation.valid) return invalidContract(res, 'invalid_follow_up_request', validation.issues); const token = verifiedContextFor(body); if (body.demo_token && (!token || token.patient_uuid !== body.patient_uuid)) return json(res, 403, { error: 'invalid_demo_context' }); if (token) body.clinician_uuid = token.clinician_uuid; const result = await service.followUp(match[1], body, { verifiedContext: token }); const responseValidation = validateFollowUpResponse(result); return responseValidation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_follow_up_response', responseValidation.issues); }
    return json(res, 404, { error: 'not_found' });
  } catch (error) { return json(res, error.message === 'PATIENT_NOT_FOUND' ? 404 : 500, { error: error.message }); }
});
server.listen(process.env.PORT || 8787, '0.0.0.0', () => console.log('AgentForge listening'));
