#!/usr/bin/env node
/**
 * AgentForge load test: 10 and 50 concurrent virtual users against one base
 * URL, a realistic route mix, raw per-request results and p50/p95/p99.
 *
 *   # the freeze run (the orchestrator runs this; it costs model calls)
 *   node agentforge/scripts/load-test.mjs --base-url https://dtstest.64.177.10.182.nip.io/agentforge-w2 --live
 *
 *   # the same mix against a local server spawned from this checkout
 *   node agentforge/scripts/load-test.mjs --dry-run
 *
 *   # merge CPU/memory samples collected with `docker stats` into a report
 *   node agentforge/scripts/load-test.mjs attach-resources --report <sha>-10.json --stats <sha>-10.docker-stats.jsonl
 *
 * Mix per level (default 200 requests): GET /health, GET /ready,
 * GET /v1/demo-context, POST /v1/briefings (the UI's call: no case_id, so a
 * prepared briefing is reused for 5 minutes), and a small, capped number of
 * POST /v1/scan-supervisor calls on one synthetic sample. Each scan costs
 * model calls (answer composer, reranker, embedding, critic), so the count is
 * `min(--max-scans, round(requests * --scan-share))` and --max-scans cannot
 * exceed HARD_MAX_SCANS. See docs/agentforge/LOAD_TEST.md for the cost.
 *
 * Output: one JSON file per level, `<sha>-<level>.json`, in --out-dir
 * (default docs/agentforge/evidence/load). `<sha>` is the git SHA the target
 * reports on /health, so the evidence names the build it measured. No
 * response body, token or patient value is written; only route, status,
 * latency and an error code.
 *
 * Exit code: 1 when any counted request failed (the reports are still
 * written), 2 on a usage error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HARD_MAX_SCANS = 10;
export const MIN_REQUESTS_PER_LEVEL = 200;
export const DEFAULT_LEVELS = [10, 50];
export const DEFAULT_WEIGHTS = Object.freeze({ health: 0.2, ready: 0.15, 'demo-context': 0.25, briefing: 0.4 });
const CLINICIAN = 'fixture-physician-001';
// Read-only fixture patients; the dup fixture is excluded (not a normal visit).
const BRIEFING_PATIENTS = ['fixture-patient-001', 'fixture-patient-002', 'fixture-patient-003', 'fixture-patient-004', 'fixture-patient-005', 'fixture-patient-006', 'fixture-patient-007', 'fixture-patient-008'];
// Writes are allowlisted to this synthetic patient on the deployed service.
const SCAN_PATIENT = 'fixture-patient-001';
const SCAN_MESSAGE = 'What changed and what should I pay attention to?';
const TOKEN_REFRESH_MS = 200_000; // tokens live 300 s
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const SCAN_SAMPLES = Object.freeze({
  'lab-a': { file: 'docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-a.pdf', filename: 'filled-lab-a.pdf', document_type: 'lab_pdf' },
  'scan-fixture': { file: 'docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', filename: 'lab-layout-a-complete.scan.txt', document_type: 'lab_pdf' },
});
// W2_COST_LATENCY.md §1-2 (list price, Singapore rate) plus the E2 critic call.
export const SCAN_COST_USD = Object.freeze({ typical: 0.00058 + 0.00006, worst_case: 0.0013 + 0.00006 });

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in agentforge/test/load-test.test.js)

/**
 * Nearest-rank percentile: the smallest value with at least p% of the
 * samples at or below it. `p` is 0..100. Returns null for no samples.
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new RangeError('percentile p must be between 0 and 100');
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const round = (value, digits = 2) => (value === null || value === undefined ? null : Number(value.toFixed(digits)));

/** Latency distribution for a list of samples, in ms. */
export function latencySummary(latencies) {
  if (!latencies.length) return { count: 0, min: null, mean: null, p50: null, p95: null, p99: null, max: null };
  const sum = latencies.reduce((total, value) => total + value, 0);
  return { count: latencies.length, min: round(Math.min(...latencies)), mean: round(sum / latencies.length), p50: round(percentile(latencies, 50)), p95: round(percentile(latencies, 95)), p99: round(percentile(latencies, 99)), max: round(Math.max(...latencies)) };
}

/** Totals, error rate, throughput and a per-route breakdown for one level. */
export function summarize(results, wallMs) {
  const errors = results.filter((result) => !result.ok);
  const perRoute = {};
  for (const route of [...new Set(results.map((result) => result.route))].sort()) {
    const routeResults = results.filter((result) => result.route === route);
    const routeErrors = routeResults.filter((result) => !result.ok);
    const statuses = {};
    for (const result of routeResults) statuses[result.status] = (statuses[result.status] || 0) + 1;
    const errorCodes = {};
    for (const result of routeErrors) errorCodes[result.error] = (errorCodes[result.error] || 0) + 1;
    perRoute[route] = { requests: routeResults.length, errors: routeErrors.length, error_rate: round(routeErrors.length / routeResults.length, 4), statuses, error_codes: errorCodes, latency_ms: latencySummary(routeResults.map((result) => result.latency_ms)) };
  }
  return {
    requests: results.length,
    successful: results.length - errors.length,
    errors: errors.length,
    error_rate: results.length ? round(errors.length / results.length, 4) : 0,
    wall_ms: round(wallMs),
    throughput_rps: wallMs > 0 ? round(results.length / (wallMs / 1000), 3) : null,
    latency_ms: latencySummary(results.map((result) => result.latency_ms)),
    per_route: perRoute,
  };
}

/** Number of scans for a level: the share of requests, capped. */
export function plannedScanCount(requests, scanShare, maxScans) {
  if (!Number.isFinite(scanShare) || scanShare < 0 || scanShare > 0.1) throw new RangeError('--scan-share must be between 0 and 0.1');
  if (!Number.isInteger(maxScans) || maxScans < 0 || maxScans > HARD_MAX_SCANS) throw new RangeError(`--max-scans must be an integer from 0 to ${HARD_MAX_SCANS}`);
  return Math.min(maxScans, Math.round(requests * scanShare));
}

/** Small seeded PRNG (mulberry32) so a plan is reproducible from its seed. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The ordered request plan for one level: `scans` scan-supervisor calls spread
 * evenly, the rest drawn from `weights` by largest remainder and shuffled with
 * a seeded PRNG. Returns a list of route names.
 */
export function buildPlan({ requests, scans, weights = DEFAULT_WEIGHTS, seed = 1 }) {
  const other = requests - scans;
  const names = Object.keys(weights);
  const totalWeight = names.reduce((sum, name) => sum + weights[name], 0);
  const exact = names.map((name) => ({ name, exact: (other * weights[name]) / totalWeight }));
  const counts = Object.fromEntries(exact.map(({ name, exact: value }) => [name, Math.floor(value)]));
  let remaining = other - Object.values(counts).reduce((sum, value) => sum + value, 0);
  for (const { name } of [...exact].sort((a, b) => (b.exact % 1) - (a.exact % 1))) { if (remaining-- <= 0) break; counts[name] += 1; }
  const pool = names.flatMap((name) => Array(counts[name]).fill(name));
  const random = rng(seed);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  const plan = [...pool];
  for (let scan = 0; scan < scans; scan += 1) plan.splice(Math.floor(((scan + 0.5) * requests) / scans), 0, 'scan-supervisor');
  return plan.slice(0, requests);
}

/** Expected model spend for a planned run (scans only; see LOAD_TEST.md for briefings). */
export function expectedScanCost(scans) {
  return { scans, typical_usd: round(scans * SCAN_COST_USD.typical, 5), worst_case_usd: round(scans * SCAN_COST_USD.worst_case, 5), basis: 'W2_COST_LATENCY.md per-scan list price (Singapore rate) + E2 critic call; worst case = 3 answer attempts' };
}

const parsePercent = (value) => { const number = Number.parseFloat(String(value).replace('%', '')); return Number.isFinite(number) ? number : null; };
const UNITS = { B: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1024 ** 2, GB: 1e9, GIB: 1024 ** 3 };
const parseBytes = (value) => { const match = String(value).trim().match(/^([\d.]+)\s*([A-Za-z]+)$/); if (!match) return null; const unit = UNITS[match[2].toUpperCase()]; return unit ? Number(match[1]) * unit : null; };

/**
 * Peak and mean CPU% and memory per container from `docker stats --no-stream
 * --format '{{json .}}'` lines (optionally prefixed with an ISO timestamp and
 * a space). Unparseable lines are counted, not guessed.
 */
export function summarizeDockerStats(text) {
  const containers = {};
  let unparsed = 0;
  let firstAt = null;
  let lastAt = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const brace = line.indexOf('{');
    if (brace < 0) { unparsed += 1; continue; }
    const prefix = line.slice(0, brace).trim();
    let sample;
    try { sample = JSON.parse(line.slice(brace)); } catch { unparsed += 1; continue; }
    if (prefix) { firstAt ??= prefix; lastAt = prefix; }
    const name = sample.Name || sample.Container;
    const cpu = parsePercent(sample.CPUPerc);
    const [usage, limit] = String(sample.MemUsage || '').split('/');
    const memory = parseBytes(usage);
    if (!name || cpu === null || memory === null) { unparsed += 1; continue; }
    const entry = containers[name] ||= { samples: 0, cpu_percent: { max: 0, sum: 0 }, memory_bytes: { max: 0, sum: 0 }, memory_limit_bytes: parseBytes(limit) };
    entry.samples += 1;
    entry.cpu_percent.max = Math.max(entry.cpu_percent.max, cpu);
    entry.cpu_percent.sum += cpu;
    entry.memory_bytes.max = Math.max(entry.memory_bytes.max, memory);
    entry.memory_bytes.sum += memory;
  }
  const result = {};
  for (const [name, entry] of Object.entries(containers)) {
    result[name] = { samples: entry.samples, cpu_percent: { max: round(entry.cpu_percent.max), mean: round(entry.cpu_percent.sum / entry.samples) }, memory_mib: { max: round(entry.memory_bytes.max / 1024 ** 2), mean: round(entry.memory_bytes.sum / entry.samples / 1024 ** 2) }, memory_limit_mib: entry.memory_limit_bytes ? round(entry.memory_limit_bytes / 1024 ** 2) : null };
  }
  return { first_sample_at: firstAt, last_sample_at: lastAt, unparsed_lines: unparsed, containers: result };
}

// ---------------------------------------------------------------------------
// Runner

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { args._.push(value); continue; }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; index += 1; }
  }
  return args;
}

function usageError(message) { const error = new Error(message); error.usage = true; return error; }

const positiveInteger = (value, flag) => { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw usageError(`${flag} must be a positive integer`); return number; };

const isLocalHost = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

async function timedFetch(url, init, timeoutMs) {
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    if ((response.headers.get('content-type') || '').includes('application/json')) body = await response.json().catch(() => null);
    else await response.arrayBuffer().catch(() => null);
    return { status: response.status, body, latency_ms: performance.now() - started, error: null };
  } catch (error) {
    return { status: 0, body: null, latency_ms: performance.now() - started, error: error.name === 'TimeoutError' ? 'client_timeout' : (error.cause?.code || error.name || 'fetch_failed') };
  }
}

const postJson = (baseUrl, route, body, timeoutMs) => timedFetch(`${baseUrl}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs);
const getJson = (baseUrl, route, timeoutMs) => timedFetch(`${baseUrl}${route}`, { method: 'GET' }, timeoutMs);

/** Short-lived signed tokens, refreshed well before their 300 s expiry. */
class TokenCache {
  constructor(baseUrl, timeoutMs) { this.baseUrl = baseUrl; this.timeoutMs = timeoutMs; this.tokens = new Map(); }
  remember(key, token) { this.tokens.set(key, { token, at: Date.now() }); }
  async get(route, patient) {
    const key = `${route}:${patient}`;
    const cached = this.tokens.get(key);
    if (cached && Date.now() - cached.at < TOKEN_REFRESH_MS) return cached.token;
    const result = await getJson(this.baseUrl, `${route}?patient_uuid=${encodeURIComponent(patient)}`, this.timeoutMs);
    if (result.status !== 200 || typeof result.body?.demo_token !== 'string') throw Object.assign(new Error('TOKEN_UNAVAILABLE'), { code: `token_${result.status || result.error}` });
    this.remember(key, result.body.demo_token);
    return result.body.demo_token;
  }
}

/** Run one planned request; returns a result row (route, status, latency, ok, error). */
async function execute(route, index, context) {
  const { baseUrl, timeoutMs, tokens, sourceDocumentId } = context;
  const patient = BRIEFING_PATIENTS[index % BRIEFING_PATIENTS.length];
  let result;
  let ok = false;
  let error = null;
  try {
    if (route === 'health') {
      result = await getJson(baseUrl, '/health', timeoutMs);
      ok = result.status === 200 && result.body?.status === 'ok';
    } else if (route === 'ready') {
      result = await getJson(baseUrl, '/ready', timeoutMs);
      ok = result.status === 200 && result.body?.status === 'ready';
    } else if (route === 'demo-context') {
      result = await getJson(baseUrl, `/v1/demo-context?patient_uuid=${encodeURIComponent(patient)}`, timeoutMs);
      ok = result.status === 200 && typeof result.body?.demo_token === 'string';
      if (ok) tokens.remember(`/v1/demo-context:${patient}`, result.body.demo_token);
    } else if (route === 'briefing') {
      const token = await tokens.get('/v1/demo-context', patient);
      result = await postJson(baseUrl, '/v1/briefings', { patient_uuid: patient, clinician_uuid: CLINICIAN, demo_token: token }, timeoutMs);
      ok = result.status === 200 && !['blocked', 'deadline-exceeded'].includes(result.body?.disposition);
      if (result.status === 200 && !ok) error = `disposition_${result.body?.disposition ?? 'missing'}`;
    } else if (route === 'scan-supervisor') {
      const token = await tokens.get('/v1/source-document-context', SCAN_PATIENT);
      result = await postJson(baseUrl, '/v1/scan-supervisor', { patient_uuid: SCAN_PATIENT, clinician_uuid: CLINICIAN, demo_token: token, source_document_id: sourceDocumentId, message: SCAN_MESSAGE }, timeoutMs);
      const finalState = result.body?.workflow?.final_state;
      ok = result.status === 200 && ['READY', 'QUALIFIED'].includes(finalState);
      if (result.status === 200 && !ok) error = `final_state_${finalState ?? 'missing'}`;
    } else throw new Error(`unknown route ${route}`);
  } catch (caught) {
    return { index, route, status: 0, latency_ms: 0, ok: false, error: caught.code || 'client_error' };
  }
  if (!ok && !error) error = result.error || (typeof result.body?.error === 'string' ? result.body.error.slice(0, 60) : `http_${result.status}`);
  return { index, route, status: result.status, latency_ms: round(result.latency_ms), ok, error };
}

async function setup(baseUrl, timeoutMs, scanSample, scans) {
  const health = await getJson(baseUrl, '/health', timeoutMs);
  if (health.status !== 200 || typeof health.body?.git_sha !== 'string') throw usageError(`target /health did not answer 200 with git_sha (status ${health.status || health.error})`);
  const tokens = new TokenCache(baseUrl, timeoutMs);
  for (const patient of BRIEFING_PATIENTS) await tokens.get('/v1/demo-context', patient);
  let sourceDocumentId = null;
  if (scans > 0) {
    // Upload the sample once; every scan reuses it, so the load measures the
    // scan, not repeated uploads. A repeat upload is deduplicated anyway.
    const sample = SCAN_SAMPLES[scanSample];
    const content = fs.readFileSync(path.join(repoRoot, sample.file));
    const token = await tokens.get('/v1/source-document-context', SCAN_PATIENT);
    const upload = await postJson(baseUrl, '/v1/source-documents', { patient_uuid: SCAN_PATIENT, clinician_uuid: CLINICIAN, demo_token: token, document_type: sample.document_type, filename: sample.filename, content_base64: content.toString('base64') }, timeoutMs);
    sourceDocumentId = upload.body?.source_document?.id;
    if (upload.status !== 200 || typeof sourceDocumentId !== 'string') throw usageError(`sample upload failed (status ${upload.status || upload.error}, ${upload.body?.error ?? 'no error code'})`);
  }
  return { gitSha: health.body.git_sha, tokens, sourceDocumentId };
}

async function runLevel({ level, plan, context }) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < plan.length) {
      const index = next;
      next += 1;
      results.push(await execute(plan[index], index, context));
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: Math.min(level, plan.length) }, worker));
  const wallMs = performance.now() - started;
  return { results: results.sort((a, b) => a.index - b.index), wallMs };
}

async function startLocalServer() {
  const { startTestServer } = await import('../test/helpers/testServer.js');
  const port = 18960 + Math.floor(Math.random() * 30);
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-load-'));
  const child = await startTestServer(port, { AGENTFORGE_TRACE_PATH: path.join(traceDir, 'traces.json') });
  return { baseUrl: `http://127.0.0.1:${port}`, stop: () => { child.kill(); fs.rmSync(traceDir, { recursive: true, force: true }); } };
}

function localGitSha() {
  try { return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(); } catch { return 'unversioned'; }
}

async function run(args) {
  const dryRun = Boolean(args['dry-run']);
  const requests = positiveInteger(args.requests ?? MIN_REQUESTS_PER_LEVEL, '--requests');
  if (requests < MIN_REQUESTS_PER_LEVEL) throw usageError(`--requests must be at least ${MIN_REQUESTS_PER_LEVEL} per level`);
  const levels = String(args.levels ?? DEFAULT_LEVELS.join(',')).split(',').map((value) => positiveInteger(value.trim(), '--levels'));
  const timeoutMs = positiveInteger(args['timeout-ms'] ?? 60000, '--timeout-ms');
  const scanShare = Number(args['scan-share'] ?? 0.02);
  const maxScans = Number(args['max-scans'] ?? 4);
  let scans;
  try { scans = plannedScanCount(requests, scanShare, maxScans); } catch (error) { throw usageError(error.message); }
  const scanSample = String(args['scan-sample'] ?? (dryRun ? 'scan-fixture' : 'lab-a'));
  if (!SCAN_SAMPLES[scanSample]) throw usageError(`--scan-sample must be one of ${Object.keys(SCAN_SAMPLES).join(', ')}`);
  const seed = positiveInteger(args.seed ?? 1, '--seed');

  let baseUrl = args['base-url'] ? String(args['base-url']).replace(/\/+$/, '') : null;
  let server = null;
  if (dryRun) {
    if (baseUrl && !isLocalHost(baseUrl)) throw usageError('--dry-run only targets a local server');
    if (!baseUrl) { server = await startLocalServer(); baseUrl = server.baseUrl; }
  } else {
    if (!baseUrl) throw usageError('--base-url is required (or use --dry-run)');
    if (!isLocalHost(baseUrl) && !args.live) throw usageError('a non-local --base-url needs --live: this run sends real traffic and model-costing scans');
  }
  const outDir = path.resolve(String(args['out-dir'] ?? (dryRun ? path.join(os.tmpdir(), 'agentforge-load-dry-run') : path.join(repoRoot, 'docs/agentforge/evidence/load'))));

  let anyErrors = false;
  try {
    const { gitSha, tokens, sourceDocumentId } = await setup(baseUrl, timeoutMs, scanSample, scans);
    const sha = gitSha === 'unversioned' ? `local-${localGitSha()}` : gitSha.slice(0, 8);
    fs.mkdirSync(outDir, { recursive: true });
    for (const level of levels) {
      const plan = buildPlan({ requests, scans, seed: seed + level });
      const startedAt = new Date().toISOString();
      const { results, wallMs } = await runLevel({ level, plan, context: { baseUrl, timeoutMs, tokens, sourceDocumentId } });
      const metrics = await getJson(baseUrl, '/v1/metrics', timeoutMs);
      const summary = summarize(results, wallMs);
      anyErrors ||= summary.errors > 0;
      const report = {
        schema_version: '1',
        kind: 'agentforge-load-test',
        mode: dryRun ? 'dry-run: local server from this checkout, deterministic provider, no model calls' : 'live',
        target: { base_url: baseUrl, reported_git_sha: gitSha },
        level: { concurrent_users: level },
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        config: { requests, timeout_ms: timeoutMs, seed: seed + level, weights: DEFAULT_WEIGHTS, briefing_patients: BRIEFING_PATIENTS.length, briefing_request: 'UI shape: patient_uuid + clinician_uuid + demo_token, no case_id (prepared briefing reused for 5 min)', scan: { planned: scans, share: scanShare, max: maxScans, hard_max: HARD_MAX_SCANS, sample: scanSample, patient: SCAN_PATIENT } },
        expected_scan_model_cost: dryRun ? { scans, typical_usd: 0, worst_case_usd: 0, basis: 'dry run: deterministic provider, no model calls' } : expectedScanCost(scans),
        summary,
        resources: { status: 'not_attached', how: 'docs/agentforge/LOAD_TEST.md: sample `docker stats --no-stream` during the run, then `load-test.mjs attach-resources`' },
        service_metrics_after_level: metrics.status === 200 ? metrics.body : { unavailable: metrics.status || metrics.error },
        raw_results: results,
      };
      const file = path.join(outDir, `${sha}-${level}.json`);
      fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`level ${level}: ${summary.successful}/${summary.requests} ok, error rate ${summary.error_rate}, p50 ${summary.latency_ms.p50} ms, p95 ${summary.latency_ms.p95} ms, p99 ${summary.latency_ms.p99} ms, ${summary.throughput_rps} req/s -> ${path.relative(repoRoot, file)}`);
    }
  } finally {
    server?.stop();
  }
  if (anyErrors) process.exitCode = 1;
}

function attachResources(args) {
  if (!args.report || !args.stats) throw usageError('attach-resources needs --report <file.json> and --stats <docker-stats.jsonl>');
  const report = JSON.parse(fs.readFileSync(String(args.report), 'utf8'));
  report.resources = { status: 'attached', source: path.basename(String(args.stats)), method: 'docker stats --no-stream sampled during the run', ...summarizeDockerStats(fs.readFileSync(String(args.stats), 'utf8')) };
  fs.writeFileSync(String(args.report), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`attached ${Object.keys(report.resources.containers).length} container(s) to ${args.report}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] === 'attach-resources' ? attachResources : run;
  Promise.resolve().then(() => command(args)).catch((error) => {
    console.error(error.usage ? `load-test: ${error.message}` : error);
    process.exitCode = error.usage ? 2 : 1;
  });
}
