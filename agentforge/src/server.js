import http from 'node:http';
import path from 'node:path';
import { FixtureAdapter } from './fixtureAdapter.js';
import { DeterministicProvider } from './modelProvider.js';
import { AgentForgeService, defaultFixturePath } from './service.js';
import { InMemoryTraceSink } from '../../observability/index.js';

const service = new AgentForgeService({ adapter: new FixtureAdapter(process.env.AGENTFORGE_FIXTURES || defaultFixturePath()), provider: new DeterministicProvider(), traceSink: new InMemoryTraceSink({ maxTraces: 100 }) });
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && req.url === '/ready') return json(res, 200, { status: 'ready', dependencies: { retrieval: 'ready', model: 'ready', trace: 'ready' } });
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(`<!doctype html><title>AgentForge</title><main><h1>Prepare for visit</h1><p>Synthetic demonstration only. Use the API with an authorized fixture context.</p><form id="brief"><label>Patient <select name="patient_uuid"><option>fixture-patient-001</option><option>fixture-patient-002</option><option>fixture-patient-006</option></select></label><button>Prepare</button></form><pre id="out"></pre><script>brief.onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/v1/briefings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({patient_uuid:f.get('patient_uuid'),case_id:f.get('patient_uuid')==='fixture-patient-001'?'complete_return_visit':f.get('patient_uuid')==='fixture-patient-006'?'partial_retrieval':'conflicting_latest_values',clinician_uuid:'fixture-physician-001',authorization:{status:'authorized',scope:'read-briefing'}})});out.textContent=JSON.stringify(await r.json(),null,2)};</script></main>`); }
    let raw = ''; for await (const chunk of req) raw += chunk; const body = raw ? JSON.parse(raw) : {};
    if (req.method === 'GET' && req.url === '/v1/traces') return json(res, 200, service.traceSink?.list?.() || []);
    if (req.method === 'POST' && req.url === '/v1/briefings') return json(res, 200, await service.prepare(body));
    const match = req.url.match(/^\/v1\/conversations\/([^/]+)\/messages$/);
    if (req.method === 'POST' && match) return json(res, 200, await service.followUp(match[1], body));
    return json(res, 404, { error: 'not_found' });
  } catch (error) { return json(res, error.message === 'PATIENT_NOT_FOUND' ? 404 : 500, { error: error.message }); }
});
server.listen(process.env.PORT || 8787, '0.0.0.0', () => console.log('AgentForge listening'));
