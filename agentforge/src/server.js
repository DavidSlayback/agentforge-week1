import http from 'node:http';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashScopeMultimodalProvider, DeterministicProvider, OpenAICompatibleProvider, OpenAIResponsesProvider, ResilientProvider, modelExtraBodyFromEnv } from './modelProvider.js';
import { OpenEMRRefreshTokenProvider, OpenEMRRestAdapter } from './openemrAdapter.js';
import { FixtureAdapter } from './fixtureAdapter.js';
import { ChartSourceRouter, describeLaunchChartSource, parseLiveReads } from './chartSourceRouter.js';
import { SyntheticClinicalActionStore } from './clinicalActions.js';
import { SyntheticWriteback } from './syntheticWriteback.js';
import { createOpenEMRModuleWritebackFromEnv, parseUuidAllowlist } from './openemrModuleWriteback.js';
import { issueSignedContext, verifySignedContext } from './accessContext.js';
import { LaunchSessionStore, launchSessionCookie } from './launchSession.js';
import { AgentForgeService, defaultFixturePath } from './service.js';
import { validateBriefingResponse, validateClinicalActionConfirmationRequest, validateClinicalActionDraftRequest, validateClinicalActionResponse, validateFollowUpEvidenceResponse, validateFollowUpRequest, validateFollowUpResponse, validatePrepareRequest, validateScanExtractionTypedOutput, validateSourceDocumentRequest } from './contracts.js';
import { DeterministicAnswerComposer } from './answerComposer.js';
import { createCriticProviderFromEnv } from './critic.js';
import { GroundedAnswerResult, parseOrIssues } from './schemas.js';
import { renderAgentForgePage, renderEvaluatorPage, renderScanSourcePreview } from './ui.js';
import { renderObservabilityPage } from './observabilityPage.js';
import { handleLabTrendRoute } from './labTrend.js';
import { PreparationCache } from './preparationCache.js';
import { AlertMonitor, DEFAULT_TRACE_LIMIT, LangfuseTraceSink, cachedCheck, createReadinessChecker, evaluateAlerts, positiveIntegerFromEnv } from '../../observability/index.js';
import { createCohereGuidelineRetriever, createGeminiHybridGuidelineRetriever, loadGuidelineCorpus } from './guidelineEvidence.js';
import { validateActiveSupervisorRequest } from './scanFormContracts.js';
import { createGeminiScanAdapter } from './geminiScanAdapter.js';
import { createLiveGeminiClient } from './geminiClient.js';
import { createRerankerFromEnv } from './reranker.js';
import { readBuildSha } from './buildInfo.js';
import { renderPdfPagePng } from './pdfScanAdapter.js';

const gitSha = readBuildSha();
const renderedPageCache = new Map();
const PAGE_IMAGE_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
const MAX_CONCURRENT_PAGE_RENDERS = 2;
let renderedPageCacheBytes = 0;
let activePageRenders = 0;
const waitingPageRenders = [];

async function withPageRenderLimit(render) {
  if (activePageRenders >= MAX_CONCURRENT_PAGE_RENDERS) await new Promise((resolve) => waitingPageRenders.push(resolve));
  activePageRenders += 1;
  try { return await render(); }
  finally {
    activePageRenders -= 1;
    waitingPageRenders.shift()?.();
  }
}

function cachedPageImage(key, render) {
  let entry = renderedPageCache.get(key);
  if (entry) {
    renderedPageCache.delete(key);
    renderedPageCache.set(key, entry);
    return entry.promise;
  }
  entry = { bytes: 0, promise: null };
  entry.promise = withPageRenderLimit(render).then((image) => {
    if (renderedPageCache.get(key) !== entry) return image;
    if (image.length > PAGE_IMAGE_CACHE_BUDGET_BYTES) {
      renderedPageCache.delete(key);
      return image;
    }
    entry.bytes = image.length;
    renderedPageCacheBytes += entry.bytes;
    while (renderedPageCacheBytes > PAGE_IMAGE_CACHE_BUDGET_BYTES) {
      const oldest = [...renderedPageCache.entries()].find(([, candidate]) => candidate.bytes > 0);
      if (!oldest) break;
      renderedPageCache.delete(oldest[0]);
      renderedPageCacheBytes -= oldest[1].bytes;
    }
    return image;
  }).catch((error) => {
    if (renderedPageCache.get(key) === entry) renderedPageCache.delete(key);
    throw error;
  });
  renderedPageCache.set(key, entry);
  return entry.promise;
}

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
  // AGENTFORGE_MODEL_ENABLE_THINKING=false turns off Qwen reasoning: about 2x
  // faster with identical JSON on the composer task (measured 2026-09-24).
  const extraBody = modelExtraBodyFromEnv(process.env, prefix);
  // Cost pricing key (pricing.js's PRICE_TABLE): only the qwen lane has a
  // confirmed per-token price today ('alibaba-qwen/<model>'). The OpenRouter
  // lane keeps its existing behavior of trusting OpenRouter's own reported
  // `usage.cost` per call (modelProvider.js's `resolveCostUsd` falls back to
  // `null`, never a guessed/silent `0`, when neither a reported cost nor a
  // priceKey is available).
  const priceKey = mode === 'qwen' && model ? `alibaba-qwen/${model}` : null;
  const options = { endpoint, apiKey, model, timeoutMs, extraBody, priceKey };
  const configured = openRouter || protocol === 'compatible' ? new OpenAICompatibleProvider({ ...options, siteUrl: process.env[`${prefix}${openRouter ? 'OPENROUTER_SITE_URL' : 'MODEL_SITE_URL'}`] || '', siteName: process.env[`${prefix}${openRouter ? 'OPENROUTER_SITE_NAME' : 'MODEL_SITE_NAME'}`] || 'AgentForge' }) : protocol === 'dashscope-multimodal' ? new DashScopeMultimodalProvider(options) : new OpenAIResponsesProvider(options);
  return new ResilientProvider({ primary: configured, fallback: new DeterministicProvider() });
};
const publicBasePath = process.env.AGENTFORGE_PUBLIC_BASE_PATH || '';
const provider = buildProvider(providerMode);
// The W2 answer composer (answerComposer.js) reuses the same configured
// model client and env (AGENTFORGE_PROVIDER_MODE / AGENTFORGE_MODEL_*) as
// `provider` above -- no separate model configuration -- but wraps it in its
// own ResilientProvider whose fallback is the deterministic *composer*, not
// the briefing-shaped `DeterministicProvider` (which expects `patient`/
// `qualification`/`comparison` args the composer never has and would throw
// on). When `provider` is itself already deterministic (no model
// configured), the answer composer is deterministic too.
const answerProvider = new ResilientProvider({ primary: provider instanceof ResilientProvider ? provider.primary : provider, fallback: new DeterministicAnswerComposer() });
// Optional cheap interactive lane. It is deliberately opt-in so the existing
// Qwen-only deployment remains unchanged until a model and budget are approved.
const conversationProvider = conversationProviderMode ? buildProvider(conversationProviderMode, 'conversation') : null;
// E2 critic (critic.js): an LLM through the OpenRouter lane that can only veto
// answer claims. AGENTFORGE_CRITIC_MODEL has no default; unset, the critic is
// disabled and every scan answer is labeled critic_status: disabled.
const criticConfig = createCriticProviderFromEnv(process.env);
const openEMRMode = process.env.AGENTFORGE_OPENEMR_MODE || 'synthetic';
const liveOpenEMR = openEMRMode === 'live';
const validOpenEMRMode = openEMRMode === 'synthetic' || openEMRMode === 'live';
// E9: in the synthetic mode, a request whose verified context was minted by the
// OpenEMR module launcher (issuer openemr-module, authn openemr-session) reads
// the real chart through the REST adapter when this is `on`; with `off` (the
// default) such a request is refused with openemr_live_reads_disabled, never
// served from fixtures. The public demo's own tokens always read fixtures.
const liveReadsEnabled = parseLiveReads(process.env.AGENTFORGE_OPENEMR_LIVE_READS);
// The designated synthetic patients (AGENTFORGE_LIVE_PATIENT_UUIDS): a live
// read may leave the process only for them, and only with the approval flag.
const livePatientAllowlist = parseUuidAllowlist(process.env.AGENTFORGE_LIVE_PATIENT_UUIDS || '');
if (liveReadsEnabled && liveOpenEMR) throw new Error('AGENTFORGE_OPENEMR_LIVE_READS applies to the synthetic OpenEMR mode only; the live mode already reads every request from OpenEMR');
const scanProviderMode = process.env.AGENTFORGE_SCAN_PROVIDER_MODE || 'local';
if (!['local', 'gemini'].includes(scanProviderMode)) throw new Error('AGENTFORGE_SCAN_PROVIDER_MODE must be local or gemini');
if (scanProviderMode === 'gemini' && liveOpenEMR) throw new Error('Gemini scan extraction is restricted to synthetic mode');
const scanProvider = scanProviderMode === 'gemini'
  ? createGeminiScanAdapter({ apiKey: process.env.GEMINI_API_KEY, model: process.env.AGENTFORGE_GEMINI_SCAN_MODEL || 'gemini-3.8-flash', timeoutMs: Number(process.env.AGENTFORGE_GEMINI_SCAN_TIMEOUT_MS || 45000), dailyLimit: Number(process.env.AGENTFORGE_GEMINI_SCAN_DAILY_LIMIT || 12) })
  : null;
// gemini-hybrid (D2′, docs/agentforge/PLAN.md): real BM25 sparse ∪ Gemini
// dense embeddings, reranked by a Gemini flash model. It degrades itself to
// sparse-only (never silently relabeled as hybrid) when GEMINI_API_KEY or the
// precomputed corpus embeddings file is missing. The default here stays
// `local-lexical` — unset, this is shared code with the frozen W1
// `agentforge` service (D8) — the `agentforge-w2` compose block sets
// `AGENTFORGE_RAG_PROVIDER=gemini-hybrid` explicitly to make it the W2
// default without touching W1's behavior.
const ragProviderMode = process.env.AGENTFORGE_RAG_PROVIDER || 'local-lexical';
if (!['local-lexical', 'cohere', 'gemini-hybrid'].includes(ragProviderMode)) throw new Error('AGENTFORGE_RAG_PROVIDER must be local-lexical, cohere, or gemini-hybrid');
if (ragProviderMode === 'cohere' && liveOpenEMR) throw new Error('Cohere RAG is restricted to the synthetic OpenEMR mode');
if (ragProviderMode === 'gemini-hybrid' && liveOpenEMR) throw new Error('Gemini hybrid RAG is restricted to the synthetic OpenEMR mode');
// Dense retrieval (embeddings) and reranking are independently configured
// (owner decision 2026-09-24): the Gemini free-tier key exhausts itself on
// the listwise rerank alone (20 requests/day, 5/min), so W2 keeps Gemini
// embeddings for dense retrieval but reranks with Qwen by default
// (AGENTFORGE_RERANK_PROVIDER=qwen); `AGENTFORGE_RERANK_PROVIDER=gemini`
// keeps the original all-Gemini pipeline, and a later dedicated reranker
// (Cohere or equivalent) drops in the same way — see reranker.js.
const guidelineEmbedClient = process.env.GEMINI_API_KEY ? createLiveGeminiClient({ apiKey: process.env.GEMINI_API_KEY }) : null;
const guidelineReranker = createRerankerFromEnv(process.env);
const guidelineRetriever = ragProviderMode === 'cohere'
  ? createCohereGuidelineRetriever({ apiKey: process.env.AGENTFORGE_COHERE_API_KEY })
  : ragProviderMode === 'gemini-hybrid'
    ? createGeminiHybridGuidelineRetriever({ embedClient: guidelineEmbedClient, reranker: guidelineReranker })
    : null;
const openEMRTokenProvider = (liveOpenEMR || liveReadsEnabled) && process.env.AGENTFORGE_OPENEMR_CLIENT_ID && process.env.AGENTFORGE_OPENEMR_CLIENT_SECRET && process.env.AGENTFORGE_OPENEMR_TOKEN_URL && process.env.AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH
  ? new OpenEMRRefreshTokenProvider({ tokenUrl: process.env.AGENTFORGE_OPENEMR_TOKEN_URL, clientId: process.env.AGENTFORGE_OPENEMR_CLIENT_ID, clientSecret: process.env.AGENTFORGE_OPENEMR_CLIENT_SECRET, cachePath: process.env.AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH, timeoutMs: Number(process.env.AGENTFORGE_OPENEMR_TIMEOUT_MS || 5000) })
  : null;
// Live mode requires caller-supplied signed context. This server does not
// establish OpenEMR session identity or bind it to that context.
// Test-only fault injection keeps persistence-failure coverage at the HTTP
// boundary without adding a user-controlled production behavior.
const syntheticSourceDocumentStore = process.env.AGENTFORGE_TEST_SOURCE_DOCUMENT_FAILURE === 'true'
  ? { persist() { throw Object.assign(new Error('SOURCE_DOCUMENT_PERSISTENCE_FAILED'), { code: 'SOURCE_DOCUMENT_PERSISTENCE_FAILED' }); } }
  : undefined;
const syntheticClinicalActionStore = process.env.AGENTFORGE_TEST_CLINICAL_ACTION_FAILURE === 'true'
  ? new SyntheticClinicalActionStore({ persist() { throw Object.assign(new Error('CLINICAL_ACTION_PERSISTENCE_FAILED'), { code: 'CLINICAL_ACTION_PERSISTENCE_FAILED' }); } })
  : undefined;
// Test-only fault injection: corrupts a scan extraction after the adapter
// built it, so a test can prove the HTTP boundary re-validates the typed
// contract (Citation/LabResult/IntakeForm) rather than trusting whatever the
// service layer returns. No production code path sets this env var.
const testInvalidScanExtraction = process.env.AGENTFORGE_TEST_INVALID_SCAN_EXTRACTION === 'true';
function injectTestScanExtractionFault(extraction) {
  if (!testInvalidScanExtraction) return extraction;
  return { ...extraction, lab_results: [...(extraction.lab_results || []), { test_name: 'test-only-invalid-injection' }] };
}
// Test-only fault injection: corrupts a composed grounded answer, so a test
// can prove F10 -- the server validates `workflow.answer` and refuses to
// persist derived facts *before* ever attempting the write, not after. No
// production code path sets this env var.
const testInvalidAnswer = process.env.AGENTFORGE_TEST_INVALID_ANSWER === 'true';
function injectTestAnswerFault(answer) {
  if (!testInvalidAnswer || !answer) return answer;
  return { ...answer, composer: 'test-only-invalid-injection' };
}
const buildRestAdapter = () => new OpenEMRRestAdapter({ baseUrl: process.env.AGENTFORGE_OPENEMR_BASE_URL, accessToken: process.env.AGENTFORGE_OPENEMR_ACCESS_TOKEN, tokenProvider: openEMRTokenProvider, requiredIssuer: 'openemr-module', requiredAuthn: 'openemr-session', requiredRole: 'clinician', timeoutMs: Number(process.env.AGENTFORGE_OPENEMR_TIMEOUT_MS || 5000) });
// The synthetic mode routes each request by its verified claims (E9,
// chartSourceRouter.js); the live mode reads every request from OpenEMR.
// Live reads on without OpenEMR access settings: log the missing names (never
// values), keep /ready at 503, and refuse each live request with
// openemr_live_reads_not_configured.
const liveReadsMissingSettings = liveReadsEnabled ? [
  ...(process.env.AGENTFORGE_OPENEMR_BASE_URL ? [] : ['AGENTFORGE_OPENEMR_BASE_URL']),
  ...(process.env.AGENTFORGE_OPENEMR_ACCESS_TOKEN || openEMRTokenProvider ? [] : ['AGENTFORGE_OPENEMR_TOKEN_URL', 'AGENTFORGE_OPENEMR_CLIENT_ID', 'AGENTFORGE_OPENEMR_CLIENT_SECRET', 'AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH'].filter((name) => !process.env[name])),
] : [];
if (liveReadsMissingSettings.length) console.error('AgentForge live reads are on but OpenEMR access is not configured; live requests are refused and /ready is 503', { missing: liveReadsMissingSettings });
const chartAdapter = liveOpenEMR ? buildRestAdapter() : new ChartSourceRouter({ fixtureAdapter: new FixtureAdapter(process.env.AGENTFORGE_FIXTURES || defaultFixturePath()), liveAdapter: liveReadsEnabled ? buildRestAdapter() : null, liveReads: liveReadsEnabled, liveConfigured: liveReadsMissingSettings.length === 0 });
// Persistence is chosen independently of the chart mode: the W2 service keeps
// the synthetic chart but stores uploads in OpenEMR through the module.
const persistenceMode = process.env.AGENTFORGE_PERSISTENCE_MODE || 'in-memory-synthetic';
if (!['in-memory-synthetic', 'openemr-module'].includes(persistenceMode)) throw new Error('AGENTFORGE_PERSISTENCE_MODE must be in-memory-synthetic or openemr-module');
const writeback = persistenceMode === 'openemr-module' ? createOpenEMRModuleWritebackFromEnv(process.env) : liveOpenEMR ? null : new SyntheticWriteback({ ...(syntheticSourceDocumentStore ? { sourceDocumentStore: syntheticSourceDocumentStore } : {}), ...(syntheticClinicalActionStore ? { clinicalActionStore: syntheticClinicalActionStore } : {}) });
const hasExternalProvider = [provider, conversationProvider, criticConfig.provider].some((candidate) => candidate && candidate.name !== 'deterministic');
const liveExternalProviderAllowed = !liveOpenEMR || !hasExternalProvider || process.env.AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED === 'true';
// The same approval covers E9 live reads: without it, a request that read the
// OpenEMR chart gets the deterministic composer and no critic, and a briefing
// is blocked (live_external_provider_not_approved). /ready keeps the W1 rule.
const serviceExternalProviderAllowed = !(liveOpenEMR || liveReadsEnabled) || !hasExternalProvider || process.env.AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED === 'true';
// FileTraceSink redacts before persistence and listing; these endpoints expose
// operational metadata, not raw briefing or chart content. The store keeps at
// most AGENTFORGE_TRACE_LIMIT traces (default 500) for at most
// AGENTFORGE_TRACE_RETENTION_MS; the W2 compose block puts the file on a named
// volume so traces survive a container replacement. /v1/traces and the
// dashboard show everything retained, so the limit is also their cap.
const traceLimit = positiveIntegerFromEnv(process.env.AGENTFORGE_TRACE_LIMIT, DEFAULT_TRACE_LIMIT, 'AGENTFORGE_TRACE_LIMIT');
const traceSink = new LangfuseTraceSink({ filePath: process.env.AGENTFORGE_TRACE_PATH || path.join('/tmp', 'agentforge', 'traces.json'), maxTraces: traceLimit, retentionMs: Number(process.env.AGENTFORGE_TRACE_RETENTION_MS || 24 * 60 * 60 * 1000), onExportError: () => {} });
const alertThresholds = { p95LatencyMs: Number(process.env.AGENTFORGE_ALERT_P95_MS || 2000), errorRate: Number(process.env.AGENTFORGE_ALERT_ERROR_RATE || 0.05), toolFailureRate: Number(process.env.AGENTFORGE_ALERT_TOOL_FAILURE_RATE || 0.02) };
const alertWindowMs = Number(process.env.AGENTFORGE_ALERT_WINDOW_MS || 5 * 60 * 1000);
// Alerts are evaluated in the background every AGENTFORGE_ALERT_EVAL_INTERVAL_MS
// (default 60 s), not only on GET /v1/alerts; each ok<->firing change of a rule
// is logged once as one JSON line with codes only (AlertMonitor).
const alertMonitor = new AlertMonitor({ evaluate: () => evaluateAlerts(traceSink.snapshot({ windowMs: alertWindowMs }), alertThresholds), intervalMs: positiveIntegerFromEnv(process.env.AGENTFORGE_ALERT_EVAL_INTERVAL_MS, 60 * 1000, 'AGENTFORGE_ALERT_EVAL_INTERVAL_MS') });
const preparationCache = new PreparationCache({ ttlMs: Number(process.env.AGENTFORGE_PREPARATION_CACHE_TTL_MS || 5 * 60 * 1000) });
const service = new AgentForgeService({ chartAdapter, writeback, guidelineRetriever, provider, conversationProvider, answerProvider, scanProvider, traceSink, cache: preparationCache, freshRetrievalDeadlineMs: Number(process.env.AGENTFORGE_FRESH_RETRIEVAL_DEADLINE_MS || 8000), allowExternalLiveProvider: serviceExternalProviderAllowed, livePatientAllowlist, maxPrewarmJobs: Number(process.env.AGENTFORGE_MAX_PREWARM_JOBS || 8), prewarmDeadlineMs: Number(process.env.AGENTFORGE_PREWARM_DEADLINE_MS || 8000), scanDeadlineMs: Number(process.env.AGENTFORGE_SCAN_DEADLINE_MS || 25000), criticProvider: criticConfig.provider, criticTimeoutMs: criticConfig.timeoutMs, criticDisabledReason: criticConfig.disabledReason });
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
// Network probes are cached for 30 s: the compose healthcheck calls /ready
// every 30 s, and each module health call is a signed request.
const READINESS_PROBE_TTL_MS = 30000;
const openemrModuleReadiness = persistenceMode === 'openemr-module' ? { checkReady: cachedCheck(() => writeback.checkReady(), { ttlMs: READINESS_PROBE_TTL_MS }) } : null;
const traceStoreWriteProbe = cachedCheck(() => traceSink.probeWritable(), { ttlMs: READINESS_PROBE_TTL_MS });
const langfuseReadiness = traceSink.exporter?.isConfigured?.() ? { checkReady: cachedCheck(() => traceSink.exporter.checkReachable(), { ttlMs: READINESS_PROBE_TTL_MS }) } : null;
const readiness = createReadinessChecker({
  configuration: { checkReady: async () => ['qwen', 'openrouter'].includes(providerMode) && validOpenEMRMode && liveExternalProviderAllowed && Boolean(process.env.AGENTFORGE_DEMO_SECRET) && (liveOpenEMR || process.env.AGENTFORGE_SYNTHETIC_CONTEXT === 'true') },
  retrieval: chartAdapter,
  ...(liveReadsEnabled ? { openemrLiveReadsConfiguration: { checkReady: async () => liveReadsMissingSettings.length === 0 } } : {}),
  model: modelReadiness,
  // Store state (a corrupt file recovered at startup, a failed write, a
  // missing directory) on every call; a real write next to the trace file,
  // cached and coalesced like the network probes.
  traceStore: { checkReady: async () => {
    const health = traceSink.health();
    if (health.status !== 'ok') return { ready: false, reason: health.errorCode || 'TRACE_STORE_UNAVAILABLE' };
    return await traceStoreWriteProbe() ? { ready: true } : { ready: false, reason: 'TRACE_STORE_WRITE_FAILED' };
  } },
  // The OpenEMR module (persistence) and Langfuse (export) only when configured.
  ...(openemrModuleReadiness ? { openemrModule: openemrModuleReadiness } : {}),
  ...(langfuseReadiness ? { langfuse: langfuseReadiness } : {}),
  // A missing/unreadable corpus/guidelines/corpus.json no longer crashes the
  // process (guidelineEvidence.js resolves it lazily and degrades to
  // sparse-only per request); this surfaces the same condition loudly
  // instead, in /ready, for local-lexical and gemini-hybrid modes (cohere
  // uses its own in-memory synthetic corpus and never reads this file).
  ...(ragProviderMode === 'cohere' ? {} : { guidelineCorpus: { checkReady: async () => { try { loadGuidelineCorpus(); return true; } catch { return false; } } } }),
});
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evalsRoot = path.join(projectRoot, 'evals');
const readEvidence = (name) => JSON.parse(fs.readFileSync(path.join(evalsRoot, name), 'utf8'));
// The W2 gate runs in the pre-commit hook, not per request: it swaps process-wide
// console/stdout capture and takes seconds. The server serves the committed report.
const readW2Baseline = () => ({ ...JSON.parse(fs.readFileSync(path.join(projectRoot, 'docs/agentforge/evidence/W2_BASELINE_REPORT.json'), 'utf8')), served_from: 'committed_baseline_report' });
const readGoldenEvidence = () => process.env.AGENTFORGE_EVAL_REPORT_PATH ? JSON.parse(fs.readFileSync(process.env.AGENTFORGE_EVAL_REPORT_PATH, 'utf8')) : readEvidence('deployed-service-results.json');
// Context tokens travel in URLs and bodies (E9): no response is cached, and no
// page sends its URL on as a Referer.
const NO_STORE_HEADERS = Object.freeze({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', ...NO_STORE_HEADERS }); res.end(JSON.stringify(body)); };
const html = (res, body, status = 200, headers = {}) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS, ...headers }); res.end(body); };
const invalidContract = (res, error, issues) => json(res, 400, { error, issues });
const invalidResponse = (res, error, issues) => json(res, 500, { error, issues });
// Scan-extraction responses carry the typed W2 contract (citations,
// LabResult[], IntakeForm) that a client relies on for grounded claims.
// Re-validate it here, at the HTTP boundary, before it goes out: never
// forward an extraction whose typed contract failed, and never leak
// document content in the failure — only the (PHI-free) issue paths are
// logged server-side, and the client gets a generic error.
const sendValidatedScanExtraction = (res, status, body, extraction) => {
  const validation = validateScanExtractionTypedOutput(extraction);
  if (!validation.valid) {
    console.error('AgentForge scan extraction response failed contract validation', { issues: validation.issues, correlation_id: res.getHeader('x-correlation-id') || null });
    return json(res, 500, { error: 'response_contract_invalid' });
  }
  return json(res, status, body);
};
const verifyContextToken = (token) => verifySignedContext(token, process.env.AGENTFORGE_DEMO_SECRET);
// F-LIVE: an OpenEMR launch token (issuer openemr-module) is exchanged once,
// on the first page load, for a launch session (launchSession.js). The API
// accepts only the session's handle plus its HttpOnly cookie, never the launch
// token itself, so a replayed launch URL or token is refused.
const launchSessions = new LaunchSessionStore();
const requestContext = (token, req) => {
  if (LaunchSessionStore.isHandle(token)) return launchSessions.resolve(token, req.headers.cookie);
  const payload = verifyContextToken(token);
  return payload && payload.issuer === 'openemr-module' ? null : payload;
};
const LAUNCH_REFUSED_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AgentForge</title></head><body><main><h1>Launch link already used or expired</h1><p>An AgentForge launch link works once. Open AgentForge again from the OpenEMR patient chart ("Prepare for visit").</p></main></body></html>';
const syntheticWritebackEnabled = () => Boolean(writeback && typeof writeback.persistSourceDocument === 'function');
const syntheticClinicalActionWritebackEnabled = () => Boolean(writeback && typeof writeback.draftClinicalAction === 'function' && typeof writeback.confirmClinicalAction === 'function');
const sourceDocumentErrorStatus = (error) => {
  // OpenEMR module failures carry the status this API should answer with.
  if (error.name === 'OpenEMRModuleError') return error.httpStatus;
  const code = error.code || error.message;
  if (code === 'SOURCE_DOCUMENT_TYPE_UNSUPPORTED_FOR_OPENEMR') return 400;
  const contractCodes = new Set(['SOURCE_DOCUMENT_PATIENT_REQUIRED', 'SOURCE_DOCUMENT_TYPE_INVALID', 'SOURCE_DOCUMENT_FILENAME_REQUIRED', 'SOURCE_DOCUMENT_FILENAME_INVALID', 'SOURCE_DOCUMENT_CONTENT_INVALID', 'SOURCE_DOCUMENT_UPLOADER_REQUIRED']);
  return code === 'SOURCE_DOCUMENT_TOO_LARGE' ? 413 : code === 'DOCUMENT_NOT_FOUND' ? 404 : code === 'DOCUMENT_SCOPE_MISMATCH' ? 403 : ['SOURCE_DOCUMENT_TYPE_MISMATCH'].includes(code) || contractCodes.has(code) ? 400 : 500;
};
const clinicalActionErrorStatus = (error) => {
  const code = error.code || error.message;
  if (['CLINICAL_ACTION_DRAFT_NOT_FOUND', 'CLINICAL_ACTION_NOT_FOUND'].includes(code)) return 404;
  if (code === 'CLINICAL_ACTION_SCOPE_MISMATCH') return 403;
  if (['CLINICAL_ACTION_PATIENT_REQUIRED', 'CLINICAL_ACTION_CLINICIAN_REQUIRED', 'CLINICAL_ACTION_INSTRUCTION_REQUIRED', 'CLINICAL_ACTION_INSTRUCTION_TOO_LONG', 'CLINICAL_ACTION_TYPE_INVALID', 'CLINICAL_ACTION_INSTRUCTION_SOURCE_INVALID', 'CLINICAL_ACTION_CONFIRMATION_REQUIRED', 'CLINICAL_ACTION_EVENT_ID_REQUIRED', 'CLINICAL_ACTION_ACTOR_INVALID'].includes(code)) return 400;
  return 500;
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
// One correlation id per request. A caller's `x-correlation-id` is accepted
// only when it cannot carry a name or date: a UUID, or 16-64 lowercase hex
// characters. Anything else is dropped (never logged, stored or forwarded)
// and the server mints `af-<uuid>`. The id is echoed on the response, names
// the scan trace, rides on every outbound call the request makes, and
// appears in this server's error logs.
const ACCEPTED_CORRELATION_ID = /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-f]{16,64})$/;
const requestCorrelationId = (req) => {
  const header = req.headers['x-correlation-id'];
  return typeof header === 'string' && ACCEPTED_CORRELATION_ID.test(header) ? header : `af-${randomUUID()}`;
};
const server = http.createServer(async (req, res) => {
  const correlationId = requestCorrelationId(req);
  res.setHeader('x-correlation-id', correlationId);
  const tokenPayload = (token) => requestContext(token, req);
  const verifiedContextFor = (body) => tokenPayload(body.demo_token);
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok', git_sha: gitSha });
    if (req.method === 'GET' && req.url === '/ready') { const result = await readiness.ready(); return json(res, result.status === 'ready' ? 200 : 503, result); }
    // These endpoints have no separate request authorization. Redaction is
    // their current safety boundary, not a production access policy.
    if (req.method === 'GET' && req.url === '/v1/traces') { await traceSink.flush?.(); return json(res, 200, traceSink.list()); }
    if (req.method === 'GET' && req.url === '/v1/metrics') return json(res, 200, traceSink.snapshot());
    if (req.method === 'GET' && req.url === '/v1/alerts') return json(res, 200, { ...alertMonitor.evaluate(), evaluation: alertMonitor.status() });
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
    if (req.method === 'GET' && req.url === '/v1/demo-scan-fixture') {
      if (liveOpenEMR || process.env.AGENTFORGE_SYNTHETIC_CONTEXT !== 'true') return json(res, 403, { error: 'synthetic_fixture_unavailable' });
      const fixturePath = path.join(projectRoot, 'docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt');
      return json(res, 200, { synthetic_only: true, filename: 'lab-layout-a-complete.scan.txt', document_type: 'lab_pdf', content_base64: fs.readFileSync(fixturePath).toString('base64') });
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/demo-scan-pdf')) {
      if (liveOpenEMR || process.env.AGENTFORGE_SYNTHETIC_CONTEXT !== 'true') return json(res, 403, { error: 'synthetic_fixture_unavailable' });
      const sample = new URL(req.url, 'http://localhost').searchParams.get('sample');
      const pdfSamples = {
        'lab-a': 'filled-lab-a.pdf', 'lab-b': 'filled-lab-b.pdf',
        'intake-a': 'filled-intake-a.pdf', 'intake-b': 'filled-intake-b.pdf',
        'medlist-a': 'filled-medlist-a.pdf', 'medlist-b': 'filled-medlist-b.pdf',
        'lab-c': 'filled-lab-c.pdf', // E5: earlier lab for the trend chart
      };
      const filename = pdfSamples[sample];
      if (!filename) return json(res, 400, { error: 'invalid_synthetic_pdf_sample' });
      const content = fs.readFileSync(path.join(projectRoot, 'docs/agentforge/fixtures/scan-forms/pdf-samples', filename));
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="agentforge-${sample}-synthetic.pdf"`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-agentforge-synthetic': 'true' });
      return res.end(content);
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/clinical-action-context')) {
      if (liveOpenEMR) return json(res, 403, { error: 'synthetic_writeback_only' });
      if (process.env.AGENTFORGE_SYNTHETIC_CONTEXT !== 'true') return json(res, 404, { error: 'synthetic_context_disabled' });
      const patient = new URL(req.url, 'http://localhost').searchParams.get('patient_uuid');
      if (!patient || (!/^fixture-patient-\d{3}$/.test(patient) && patient !== 'fixture-patient-dup')) return json(res, 400, { error: 'invalid_synthetic_patient' });
      const token = issueSignedContext({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', scope: 'write-clinical-action', acl: 'write', issuer: 'synthetic-demo', authn: 'synthetic', secret: process.env.AGENTFORGE_DEMO_SECRET });
      return json(res, 200, { demo_token: token, patient_uuid: patient, clinician_uuid: 'fixture-physician-001', expires_in_seconds: 300, synthetic_only: true, scope: 'write-clinical-action' });
    }
    if (req.method === 'GET' && req.url === '/evals/deployed-service-results.json') return json(res, 200, readEvidence('deployed-service-results.json'));
    if (req.method === 'GET' && req.url === '/evals/error-analysis.json') return json(res, 200, readEvidence('error-analysis.json'));
    if (req.method === 'GET' && req.url === '/evals/active-service-results.json') return json(res, 200, readGoldenEvidence());
    if (req.method === 'GET' && req.url === '/evals/w2-baseline.json') return json(res, 200, readW2Baseline());
    if (req.method === 'GET' && req.url === '/evals') { const golden = readGoldenEvidence(); const errorAnalysis = readEvidence('error-analysis.json'); const w2Gate = readW2Baseline(); return html(res, renderEvaluatorPage({ golden, errorAnalysis, w2Gate, basePath: publicBasePath, localReport: Boolean(process.env.AGENTFORGE_EVAL_REPORT_PATH) })); }
    const scanFormEvidenceMatch = req.url.match(/^\/v1\/source-documents\/([^/]+)\/scan-form-evidence(?:\?(.*))?$/);
    if (req.method === 'GET' && scanFormEvidenceMatch) {
      if (!syntheticWritebackEnabled()) return json(res, 403, { error: 'synthetic_writeback_only' });
      const query = new URL(req.url, 'http://localhost').searchParams;
      const patient_uuid = query.get('patient_uuid') || '';
      const token = tokenPayload(query.get('demo_token') || '');
      if (!token || token.patient_uuid !== patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      try {
        const result = await service.extractScanFormEvidence(decodeURIComponent(scanFormEvidenceMatch[1]), { patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token, correlationId });
        if (result.status === 'blocked') return json(res, 403, { error: result.reason });
        if (result.status === 'failed') return json(res, 500, { error: result.reason });
        const extraction = injectTestScanExtractionFault(result.extraction);
        const sourcePreview = extraction.facts.map((fact) => ({ field_id: fact.field_id, page_or_section: fact.citation.page_or_section, bounding_box: fact.citation.bounding_box, quote_or_value: fact.citation.quote_or_value, source_id: fact.citation.source_id }));
        return sendValidatedScanExtraction(res, 200, { synthetic_only: true, source_document: result.source_document, extraction, observations: result.observations, source_preview: sourcePreview }, extraction);
      } catch (error) {
        if ((error.code || error.message) === 'DOCUMENT_SCOPE_MISMATCH') return json(res, 403, { error: 'invalid_demo_context' });
        return json(res, sourceDocumentErrorStatus(error), { error: error.code || error.message });
      }
    }
    const openemrObservationsMatch = req.url.match(/^\/v1\/source-documents\/([^/]+)\/openemr-observations(?:\?(.*))?$/);
    if (req.method === 'GET' && openemrObservationsMatch) {
      const query = new URL(req.url, 'http://localhost').searchParams;
      const patient_uuid = query.get('patient_uuid') || '';
      const token = tokenPayload(query.get('demo_token') || '');
      if (!token || token.patient_uuid !== patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      try {
        const result = await service.readOpenEMRLabObservations(decodeURIComponent(openemrObservationsMatch[1]), { patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token, correlationId });
        if (result.status !== 'read') return json(res, 403, { error: result.reason });
        return json(res, 200, result.bundle);
      } catch (error) {
        return json(res, sourceDocumentErrorStatus(error), { error: error.code || error.message });
      }
    }
    // E5 lab trends (labTrend.js): read-back only, same demo-context check.
    if (await handleLabTrendRoute(req, res, { service, verifyToken: tokenPayload, json, html, basePath: publicBasePath, errorStatus: sourceDocumentErrorStatus, correlationId })) return;
    const sourcePageMatch = req.url.match(/^\/v1\/source-documents\/([^/]+)\/pages\/(\d+)\.png(?:\?(.*))?$/);
    if (req.method === 'GET' && sourcePageMatch) {
      if (!syntheticWritebackEnabled()) return json(res, 403, { error: 'synthetic_writeback_only' });
      const query = new URL(req.url, 'http://localhost').searchParams;
      const patient_uuid = query.get('patient_uuid') || '';
      const token = tokenPayload(query.get('demo_token') || '');
      if (!token || token.patient_uuid !== patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      const page = Number(sourcePageMatch[2]);
      try {
        const id = decodeURIComponent(sourcePageMatch[1]);
        const result = await service.readSourceDocument(id, { patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token, correlationId });
        if (result.status !== 'read') return json(res, 403, { error: result.reason });
        if (result.content.subarray(0, 5).toString() !== '%PDF-') return json(res, 404, { error: 'source_page_not_found' });
        const cacheKey = `${id}:${page}`;
        const png = await cachedPageImage(cacheKey, () => renderPdfPagePng(result.content, page));
        res.writeHead(200, { 'content-type': 'image/png', ...NO_STORE_HEADERS });
        return res.end(png);
      } catch (error) {
        if (error instanceof URIError) return json(res, 400, { error: 'invalid_source_document_id' });
        const code = error.code || error.message;
        if (code === 'PDF_OCR_RUNTIME_UNAVAILABLE') return json(res, 503, { error: 'ocr_runtime_unavailable' });
        if (code === 'PDF_PAGE_RENDER_FAILED' || code === 'PDF_PAGE_INFO_INVALID') return json(res, 422, { error: 'pdf_page_render_failed' });
        if (code === 'PDF_PAGE_NOT_FOUND') return json(res, 404, { error: 'source_page_not_found' });
        return json(res, sourceDocumentErrorStatus(error), { error: code });
      }
    }
    const scanSourcePreviewMatch = req.url.match(/^\/v1\/source-documents\/([^/]+)\/source-preview(?:\?(.*))?$/);
    if (req.method === 'GET' && scanSourcePreviewMatch) {
      if (!syntheticWritebackEnabled()) return json(res, 403, { error: 'synthetic_writeback_only' });
      const query = new URL(req.url, 'http://localhost').searchParams;
      const patient_uuid = query.get('patient_uuid') || '';
      const token = tokenPayload(query.get('demo_token') || '');
      if (!token || token.patient_uuid !== patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      const result = await service.extractScanFormEvidence(decodeURIComponent(scanSourcePreviewMatch[1]), { patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token, correlationId });
      if (result.status === 'blocked') return json(res, 403, { error: result.reason });
      if (result.status === 'failed') return json(res, 500, { error: result.reason });
      return html(res, renderScanSourcePreview({ sourceDocument: result.source_document, extraction: result.extraction, basePath: publicBasePath, patient_uuid, demo_token: query.get('demo_token') || '' }));
    }
    const sourceDocumentMatch = req.url.match(/^\/v1\/source-documents\/([^?]+)(?:\?(.*))?$/);
    if (req.method === 'GET' && sourceDocumentMatch) {
      if (!syntheticWritebackEnabled()) return json(res, 403, { error: 'synthetic_writeback_only' });
      const query = new URL(req.url, 'http://localhost').searchParams;
      const patient_uuid = query.get('patient_uuid') || '';
      const token = tokenPayload(query.get('demo_token') || '');
      if (!token || token.patient_uuid !== patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      try {
        const result = await service.readSourceDocument(decodeURIComponent(sourceDocumentMatch[1]), { patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token, correlationId });
        if (result.status !== 'read') return json(res, 403, { error: result.reason });
        return json(res, 200, { synthetic_only: true, source_document: result.source_document, content_base64: result.content.toString('base64') });
      } catch (error) {
        if ((error.code || error.message) === 'DOCUMENT_SCOPE_MISMATCH') return json(res, 403, { error: 'invalid_demo_context' });
        return json(res, sourceDocumentErrorStatus(error), { error: error.code || error.message });
      }
    }
    if (req.method === 'GET' && (req.url === '/observability' || req.url === '/observability/')) return html(res, renderObservabilityPage());
    const clinicalActionMatch = req.url.match(/^\/v1\/clinical-actions\/([^?]+)(?:\?(.*))?$/);
    if (req.method === 'GET' && clinicalActionMatch) {
      if (!syntheticClinicalActionWritebackEnabled()) return json(res, 403, { error: 'synthetic_writeback_only' });
      const query = new URL(req.url, 'http://localhost').searchParams;
      const patient_uuid = query.get('patient_uuid') || '';
      const token = tokenPayload(query.get('demo_token') || '');
      if (!token || token.patient_uuid !== patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      try {
        const result = service.readClinicalAction(decodeURIComponent(clinicalActionMatch[1]), { patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token });
        if (result.status === 'blocked') return json(res, 403, { error: result.reason });
        const response = { synthetic_only: true, status: result.status, action: result.action };
        const validation = validateClinicalActionResponse(response);
        return validation.valid ? json(res, 200, response) : invalidResponse(res, 'invalid_clinical_action_response', validation.issues);
      } catch (error) { return json(res, clinicalActionErrorStatus(error), { error: error.code || error.message }); }
    }
    if (req.method === 'GET' && req.url.startsWith('/')) {
      const query = new URL(req.url, 'http://localhost').searchParams;
      let token = query.get('demo_token') || '';
      const payload = verifyContextToken(token);
      if (payload?.issuer !== 'openemr-module') {
        // Not an OpenEMR launch: the public demo page, unchanged.
        const designatedPatient = Boolean(payload && livePatientAllowlist.has(String(payload.patient_uuid).toLowerCase()));
        return html(res, renderAgentForgePage({ token, payload, publicBasePath, liveOpenEMR, writeToken: '', chartSource: describeLaunchChartSource(chartAdapter, payload), designatedPatient }));
      }
      // E9: the module launcher also hands over a write-source-document token.
      // It is used only when it is verified and belongs to the same OpenEMR
      // session, patient and clinician as the read token.
      const writeCandidate = query.get('write_token') || '';
      const writePayload = writeCandidate ? verifyContextToken(writeCandidate) : null;
      const writeAccepted = Boolean(writePayload && writePayload.issuer === 'openemr-module' && writePayload.authn === 'openemr-session' && writePayload.scope === 'write-source-document' && writePayload.patient_uuid === payload.patient_uuid && writePayload.clinician_uuid === payload.clinician_uuid);
      // F-LIVE: exchange the launch token(s) once for a launch session; a second load is refused.
      const exchange = launchSessions.exchange({ readToken: token, readContext: payload, writeToken: writeAccepted ? writeCandidate : '', writeContext: writeAccepted ? writePayload : null });
      if (exchange.status !== 'created') return html(res, LAUNCH_REFUSED_PAGE, 401);
      token = exchange.readHandle;
      const designatedPatient = livePatientAllowlist.has(String(payload.patient_uuid).toLowerCase());
      return html(res, renderAgentForgePage({ token, payload, publicBasePath, liveOpenEMR, writeToken: exchange.writeHandle, chartSource: describeLaunchChartSource(chartAdapter, payload), designatedPatient }), 200, { 'set-cookie': launchSessionCookie(exchange, publicBasePath) });
    }
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
        const result = await service.ingestSourceDocument({ ...body, content: Buffer.from(body.content_base64, 'base64') }, { verifiedContext: token, correlationId });
        if (result.status !== 'persisted') return json(res, 403, { error: result.reason });
        return json(res, 200, result);
      } catch (error) {
        return json(res, sourceDocumentErrorStatus(error), { error: error.code || error.message });
      }
    }
    if (req.method === 'POST' && req.url === '/v1/scan-supervisor') {
      const validation = validateActiveSupervisorRequest(body);
      if (!validation.valid) return invalidContract(res, 'invalid_scan_supervisor_request', validation.issues);
      const token = verifiedContextFor(body);
      if (!token || token.patient_uuid !== body.patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      const result = await service.runActiveSupervisorForDocument(body.source_document_id, { patient_uuid: body.patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token, query: body.message, correlationId });
      if (result.status === 'blocked') return json(res, 403, { error: result.reason });
      if (result.status === 'unreadable') return json(res, 422, { error: result.reason, final_state: result.final_state, synthetic_only: true });
      const extraction = injectTestScanExtractionFault(result.workflow.typed_outputs.extraction);
      const answer = injectTestAnswerFault(result.workflow.answer);
      const responseBody = { ...result, workflow: { ...result.workflow, typed_outputs: { ...result.workflow.typed_outputs, extraction }, ...(result.workflow.answer ? { answer } : {}) } };
      // F10 review fix: the S6 grounded answer (when the workflow reached far
      // enough to compose one) is validated against its own strict contract
      // *before* any write below -- a contract failure must write nothing,
      // not persist derived facts and then answer 500. Never leak
      // claim/citation content in the failure log.
      if (responseBody.workflow?.answer) {
        const answerValidation = parseOrIssues(GroundedAnswerResult, responseBody.workflow.answer);
        if (!answerValidation.ok) {
          console.error('AgentForge grounded answer failed contract validation', { issues: answerValidation.issues, correlation_id: correlationId });
          return json(res, 500, { error: 'response_contract_invalid' });
        }
      }
      // Derived facts are persisted only from an extraction whose typed
      // contract validates; an invalid one is answered with 500 below.
      if (validateScanExtractionTypedOutput(extraction).valid) {
        const openemr = await service.persistDerivedEvidence(result.source_document, extraction, { patient_uuid: body.patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token, finalState: result.workflow.final_state, correlationId });
        if (openemr) responseBody.openemr = openemr;
        // E5, fixture mode only: lab rows for the trend chart's synthetic read-back.
        const syntheticLabHistory = await service.recordSyntheticLabHistory(result.source_document, extraction, { patient_uuid: body.patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token, finalState: result.workflow.final_state });
        if (syntheticLabHistory) responseBody.synthetic_lab_history = syntheticLabHistory;
      }
      return sendValidatedScanExtraction(res, 200, responseBody, extraction);
    }
    if (req.method === 'POST' && req.url === '/v1/clinical-actions/drafts') {
      if (!syntheticClinicalActionWritebackEnabled()) return json(res, 403, { error: 'synthetic_writeback_only' });
      const validation = validateClinicalActionDraftRequest(body);
      if (!validation.valid) return invalidContract(res, 'invalid_clinical_action_draft_request', validation.issues);
      const token = verifiedContextFor(body);
      if (!token || token.patient_uuid !== body.patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      body.clinician_uuid = token.clinician_uuid;
      try {
        const result = service.draftClinicalAction(body, { verifiedContext: token });
        if (result.status === 'blocked') return json(res, 403, { error: result.reason });
        const validation = validateClinicalActionResponse(result);
        return validation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_clinical_action_response', validation.issues);
      } catch (error) { return json(res, clinicalActionErrorStatus(error), { error: error.code || error.message }); }
    }
    const clinicalActionConfirmMatch = req.url.match(/^\/v1\/clinical-actions\/([^/]+)\/confirm$/);
    if (req.method === 'POST' && clinicalActionConfirmMatch) {
      if (!syntheticClinicalActionWritebackEnabled()) return json(res, 403, { error: 'synthetic_writeback_only' });
      const validation = validateClinicalActionConfirmationRequest(body);
      if (!validation.valid) return invalidContract(res, 'invalid_clinical_action_confirmation_request', validation.issues);
      const token = verifiedContextFor(body);
      if (!token || token.patient_uuid !== body.patient_uuid) return json(res, 403, { error: 'invalid_demo_context' });
      body.clinician_uuid = token.clinician_uuid;
      try {
        const result = service.confirmClinicalAction(decodeURIComponent(clinicalActionConfirmMatch[1]), body, { verifiedContext: token });
        if (result.status === 'blocked') return json(res, 403, { error: result.reason });
        const validation = validateClinicalActionResponse(result);
        return validation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_clinical_action_response', validation.issues);
      } catch (error) { return json(res, clinicalActionErrorStatus(error), { error: error.code || error.message }); }
    }
    if (req.method === 'POST' && req.url === '/v1/briefings') { const validation = validatePrepareRequest(body); if (!validation.valid) return invalidContract(res, 'invalid_prepare_request', validation.issues); const token = verifiedContextFor(body); if (body.demo_token && (!token || token.patient_uuid !== body.patient_uuid)) return json(res, 403, { error: 'invalid_demo_context' }); if (token) body.clinician_uuid = token.clinician_uuid; const result = await service.prepare(body, { verifiedContext: token, reusePrepared: true, interactionType: 'background_preparation' }); const responseValidation = validateBriefingResponse(result); return responseValidation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_briefing_response', responseValidation.issues); }
    if (req.method === 'POST' && req.url === '/v1/prewarm') { if (typeof body.patient_uuid !== 'string' || typeof body.clinician_uuid !== 'string' || typeof body.schedule_revision !== 'string' || !body.schedule_revision.trim()) return invalidContract(res, 'invalid_prewarm_request', ['patient_uuid, clinician_uuid, and schedule_revision are required']); const token = verifiedContextFor(body); if (!token || token.patient_uuid !== body.patient_uuid) return json(res, 403, { error: 'invalid_demo_context' }); body.clinician_uuid = token.clinician_uuid; const result = service.prewarm(body, { verifiedContext: token, scheduleRevision: body.schedule_revision, sourceRevision: body.source_revision }); if (result.status === 'blocked') return json(res, 403, { error: result.reason }); if (result.status === 'busy') return json(res, 429, { error: result.reason, status: result.status, synthetic_only: true }); return json(res, 202, { status: result.status, correlation_id: result.correlation_id, duplicate: result.duplicate, synthetic_only: true }); }
    const preparedMatch = req.url.match(/^\/v1\/prewarm\/([^/]+)\/open$/);
    if (req.method === 'POST' && preparedMatch) { const token = verifiedContextFor(body); if (!token || token.patient_uuid !== body.patient_uuid) return json(res, 403, { error: 'invalid_demo_context' }); body.clinician_uuid = token.clinician_uuid; const result = service.openPrepared(preparedMatch[1], body, { verifiedContext: token, resetConversation: body.reset_conversation === true }); return result.status === 'ready' ? json(res, 200, result.response) : json(res, 409, { error: result.reason, status: result.status }); }
    const match = req.url.match(/^\/v1\/conversations\/([^/]+)\/messages$/);
    if (req.method === 'POST' && match) { const validation = validateFollowUpRequest(body); if (!validation.valid) return invalidContract(res, 'invalid_follow_up_request', validation.issues); const token = verifiedContextFor(body); if (body.demo_token && (!token || token.patient_uuid !== body.patient_uuid)) return json(res, 403, { error: 'invalid_demo_context' }); if (token) body.clinician_uuid = token.clinician_uuid; const result = await service.followUp(match[1], body, { verifiedContext: token }); const responseValidation = validateFollowUpResponse(result); return responseValidation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_follow_up_response', responseValidation.issues); }
    if (req.method === 'POST' && req.url === '/v1/follow-up-evidence') { const validation = validateFollowUpRequest(body); if (!validation.valid) return invalidContract(res, 'invalid_follow_up_request', validation.issues); const token = verifiedContextFor(body); if (!token || token.patient_uuid !== body.patient_uuid) return json(res, 403, { error: 'invalid_demo_context' }); body.clinician_uuid = token.clinician_uuid; const result = await service.retrieveFollowUpEvidence(body, { verifiedContext: token, correlationId }); if (result.status === 'blocked') return json(res, 403, { error: result.reason }); const responseValidation = validateFollowUpEvidenceResponse(result); return responseValidation.valid ? json(res, 200, result) : invalidResponse(res, 'invalid_follow_up_evidence_response', responseValidation.issues); }
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    // Module errors carry only a code and statuses (no bodies), so they are safe to surface.
    if (error?.name === 'OpenEMRModuleError') { console.error('AgentForge OpenEMR module call failed', { code: error.code, status: error.status, correlation_id: error.correlationId || correlationId }); return json(res, error.httpStatus, { error: error.code.toLowerCase() }); }
    console.error('AgentForge request failed', { correlation_id: correlationId, code: error?.code || null }, error); return json(res, error.message === 'PATIENT_NOT_FOUND' ? 404 : 500, { error: error.message === 'PATIENT_NOT_FOUND' ? 'patient_not_found' : 'internal_error' }); }
});
server.listen(process.env.PORT || 8787, process.env.HOST || '0.0.0.0', () => { alertMonitor.start(); console.log('AgentForge listening'); });
