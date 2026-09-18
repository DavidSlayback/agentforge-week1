import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureAdapter } from './fixtureAdapter.js';
import { DeterministicProvider, OpenAICompatibleProvider } from './modelProvider.js';
import { AgentForgeService, defaultFixturePath } from './service.js';
import { validateBriefingResponse, validateFollowUpRequest, validateFollowUpResponse, validatePrepareRequest } from './contracts.js';
import { renderAgentForgePage, renderEvaluatorPage } from './ui.js';
import { FileTraceSink, createReadinessChecker } from '../../observability/index.js';

const provider = process.env.AGENTFORGE_MODEL_ENDPOINT ? new OpenAICompatibleProvider({ endpoint: process.env.AGENTFORGE_MODEL_ENDPOINT, apiKey: process.env.AGENTFORGE_MODEL_API_KEY, model: process.env.AGENTFORGE_MODEL || 'configured-model' }) : new DeterministicProvider();
const adapter = new FixtureAdapter(process.env.AGENTFORGE_FIXTURES || defaultFixturePath());
const traceSink = new FileTraceSink({ filePath: process.env.AGENTFORGE_TRACE_PATH || path.join('/tmp', 'agentforge', 'traces.json'), maxTraces: 100, retentionMs: Number(process.env.AGENTFORGE_TRACE_RETENTION_MS || 24 * 60 * 60 * 1000) });
const service = new AgentForgeService({ adapter, provider, traceSink });
const readiness = createReadinessChecker({ retrieval: adapter, model: provider, trace: { checkReady: async () => Boolean(traceSink.health()) } });
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evalsRoot = path.join(projectRoot, 'evals');
const readEvidence = (name) => JSON.parse(fs.readFileSync(path.join(evalsRoot, name), 'utf8'));
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const html = (res, body) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };
const invalidContract = (res, error, issues) => json(res, 400, { error, issues });
const invalidResponse = (res, error, issues) => json(res, 500, { error, issues });
const tokenPayload = (token) => {
  if (!token || !process.env.AGENTFORGE_DEMO_SECRET) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', process.env.AGENTFORGE_DEMO_SECRET).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); return payload.expires_at > Math.floor(Date.now() / 1000) ? payload : null; } catch { return null; }
};
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && req.url === '/ready') { const result = await readiness.ready(); return json(res, result.status === 'ready' ? 200 : 503, result); }
    if (req.method === 'GET' && req.url === '/v1/traces') return json(res, 200, traceSink.list());
    if (req.method === 'GET' && req.url === '/v1/metrics') return json(res, 200, traceSink.snapshot());
    if (req.method === 'GET' && req.url === '/evals/deployed-service-results.json') return json(res, 200, readEvidence('deployed-service-results.json'));
    if (req.method === 'GET' && req.url === '/evals/error-analysis.json') return json(res, 200, readEvidence('error-analysis.json'));
    if (req.method === 'GET' && req.url === '/evals') { const golden = readEvidence('deployed-service-results.json'); const errorAnalysis = readEvidence('error-analysis.json'); return html(res, renderEvaluatorPage({ golden, errorAnalysis })); }
    if (req.method === 'GET' && (req.url === '/observability' || req.url === '/observability/')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><title>AgentForge observability</title><main><h1>AgentForge observability</h1><pre id="metrics">Loading…</pre><h2>Recent redacted traces</h2><pre id="traces">Loading…</pre><script>const basePath=location.pathname.startsWith("/agentforge")?"/agentforge":"";Promise.all([fetch(basePath+"/v1/metrics").then(r=>r.json()),fetch(basePath+"/v1/traces").then(r=>r.json())]).then(([m,t])=>{metrics.textContent=JSON.stringify(m,null,2);traces.textContent=JSON.stringify(t,null,2)}).catch(error=>{metrics.textContent="Dashboard data unavailable: "+error})</script></main>'); }
    if (req.method === 'GET' && req.url.startsWith('/')) { const token = new URL(req.url, 'http://localhost').searchParams.get('demo_token') || ''; return html(res, renderAgentForgePage({ token, payload: tokenPayload(token) })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'invalid_json' }); }
    if (req.method === 'POST' && req.url === '/v1/briefings') { const validation = validatePrepareRequest(body); if (!validation.valid) return invalidContract(res, 'invalid_prepare_request', validation.issues); const token = tokenPayload(body.demo_token); if (body.demo_token && (!token || token.patient_uuid !== body.patient_uuid)) return json(res, 403, { error: 'invalid_demo_context' }); if (token) body.clinician_uuid = token.clinician_uuid; const result = await service.prepare(body); const responseValidation = validateBriefingResponse(result); return responseValidation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_briefing_response', responseValidation.issues); }
    const match = req.url.match(/^\/v1\/conversations\/([^/]+)\/messages$/);
    if (req.method === 'POST' && match) { const validation = validateFollowUpRequest(body); if (!validation.valid) return invalidContract(res, 'invalid_follow_up_request', validation.issues); const result = await service.followUp(match[1], body); const responseValidation = validateFollowUpResponse(result); return responseValidation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_follow_up_response', responseValidation.issues); }
    return json(res, 404, { error: 'not_found' });
  } catch (error) { return json(res, error.message === 'PATIENT_NOT_FOUND' ? 404 : 500, { error: error.message }); }
});
server.listen(process.env.PORT || 8787, '0.0.0.0', () => console.log('AgentForge listening'));
