import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { estimateCostUsd } from './pricing.js';
import { buildBm25Index } from './bm25.js';
import { OpenAIResponsesProvider } from './modelProvider.js';
import { GEMINI_RERANK_MODEL, createLiveGeminiClient, defaultRetrievalFixturesDir, geminiRequestHash } from './geminiClient.js';

/**
 * The `Reranker` seam (owner decision 2026-09-24): the Gemini free-tier key
 * used for retrieval (gemini-3.8-flash, 20 requests/day, 5/min) exhausts
 * itself on the listwise rerank step alone. Dense retrieval stays on Gemini
 * embeddings (`embedClient` in `guidelineEvidence.js`); only the rerank step
 * is now pluggable behind this interface, so swapping it (Qwen today, a
 * dedicated reranker such as Cohere Rerank later) never touches retrieval
 * (BM25, embedding, candidate union, threshold/top-K) code.
 *
 * ```
 * Reranker = {
 *   name: string,   // honest identity of what actually runs, e.g. "alibaba-qwen:qwen3.8-flash"
 *   rerank(query: string, candidates: Array<{id: string, text: string}>, options?: {signal?: AbortSignal})
 *     => Promise<{ results: Array<{id: string, score: number}>, usage: object }>
 * }
 * ```
 *
 * Contract every implementation must honor:
 *   - `results[].id` is drawn only from `candidates[].id` — any id a model
 *     invents is dropped, never trusted (the model's JSON is untrusted
 *     input, same rule as the existing Gemini schema validation in
 *     `geminiClient.js`).
 *   - `results[].score` is a relevance score in `[0, 1]`; higher is more
 *     relevant. Callers (the hybrid retriever) apply the threshold/top-K cut,
 *     not the reranker itself.
 *   - `usage` follows the shared usage-record shape already used throughout
 *     this codebase: `{stage: 'rerank', provider, model, inputTokens,
 *     outputTokens, estimatedCostUsd, tokens_estimated}`, plus `source:
 *     'recorded'|'stub'` for the recorded-or-stub implementations. A price
 *     this environment cannot confirm from an official page is `null`
 *     (`pricing.js`'s `estimateCostUsd` returns `null` for an unlisted
 *     model), never `0` — a silent `0` would misreport an unknown cost as a
 *     free one.
 *   - A malformed response, a request failure, or a timeout throws — it
 *     never returns a fabricated or empty-but-successful result. The caller
 *     (`createGeminiHybridGuidelineRetriever`) decides what "the reranker
 *     failed" means for the overall retrieval response (see its
 *     `degraded: 'no_rerank'` doc comment).
 */

// ---------------------------------------------------------------------------
// Shared prompt/validation for the two listwise (LLM-driven) implementations
// below (Qwen today; Gemini's own listwise call lives in geminiClient.js and
// is adapted to this interface by `createGeminiReranker`). Cohere's rerank
// endpoint is a dedicated, non-generative ranking model, so it needs neither.
// ---------------------------------------------------------------------------

function buildListwiseRerankPrompt(query, candidates) {
  const listed = candidates.map((candidate, index) => `${index + 1}. id=${candidate.id}\n${candidate.text}`).join('\n\n');
  return `You are ranking clinical guideline excerpts by relevance to a clinician's question. Question: "${query}"\n\nCandidates:\n${listed}\n\nRespond with strict JSON only, no markdown fences and no other text: {"results": [{"n": <candidate number>, "score": <0 to 1 relevance>}, ...]}. Include every candidate number exactly once. Use only the numbers listed above.`;
}

const ListwiseRerankResponseShape = z.object({
  results: z.array(z.object({ n: z.number().int().min(1), score: z.number().min(0).max(1) }).strict()),
}).strict();

/**
 * Parse and validate a listwise rerank model's JSON output against the Zod
 * shape, then drop any id outside the candidate set — the model's JSON is
 * untrusted input, never trusted to only name real candidates (the same rule
 * `geminiClient.js`'s `validateRerankResults` already applies to Gemini's
 * own `chunk_id`/`relevance_score` shape). Throws `RERANK_SCHEMA_INVALID` on
 * a shape mismatch and `RERANK_JSON_INVALID` on unparsable text — both are
 * fixed codes only, never the raw model text, so a caller can log/trace them
 * without risking a leaked prompt or candidate content.
 */
function parseListwiseRerankResponse(rawText, candidates) {
  let parsed;
  try {
    // A model that ignores "no markdown fences" is tolerated by stripping a
    // ```json ... ``` wrapper before parsing; anything else unparsable still
    // throws RERANK_JSON_INVALID below.
    const unfenced = String(rawText || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    parsed = JSON.parse(unfenced);
  } catch {
    throw new Error('RERANK_JSON_INVALID');
  }
  const validated = ListwiseRerankResponseShape.safeParse(parsed);
  if (!validated.success) throw new Error('RERANK_SCHEMA_INVALID');
  // Candidates are numbered 1..n in the prompt; the model answers with those
  // short numbers because long hyphenated ids cost ~50 output tokens each and
  // truncated the JSON live (2026-09-24). Numbers outside 1..n are dropped,
  // exactly like an id outside the candidate set.
  return validated.data.results
    .filter((result) => result.n >= 1 && result.n <= candidates.length)
    .map((result) => ({ id: candidates[result.n - 1].id, score: result.score }));
}

// ---------------------------------------------------------------------------
// Gemini: adapt the existing listwise reranker (geminiClient.js) to the
// Reranker interface. The request/response plumbing (prompt, JSON schema,
// retry, `interactions` endpoint) is unchanged and stays in geminiClient.js
// so `createLiveGeminiClient`/`createRecordedOrStubGeminiClient` keep working
// exactly as today for existing callers; this is a thin field-mapping
// adapter (`chunk_id`/`relevance_score` -> `id`/`score`), not a rewrite.
// ---------------------------------------------------------------------------

/**
 * Wrap any object exposing `{name, rerank(query, candidates) => {results:
 * [{chunk_id, relevance_score}], usage}}` (a live, recorded-or-stub, or
 * recording Gemini client from `geminiClient.js`) as a `Reranker`.
 */
export function createGeminiReranker(geminiClient) {
  if (!geminiClient || typeof geminiClient.rerank !== 'function') throw new Error('GEMINI_RERANK_CLIENT_REQUIRED');
  async function rerank(query, candidates) {
    // geminiClient.rerank has no `signal`/abort parameter today; its own
    // `rerankTimeoutMs` (geminiClient.js) is the only bound on this call.
    const { results, usage } = await geminiClient.rerank(query, candidates);
    return { results: results.map((result) => ({ id: result.chunk_id, score: result.relevance_score })), usage };
  }
  return Object.freeze({ name: `google:${GEMINI_RERANK_MODEL}`, rerank });
}

// ---------------------------------------------------------------------------
// Qwen listwise reranker (AGENTFORGE_RERANK_PROVIDER=qwen, the W2 default).
// Reuses the OpenAI-responses wire (OpenAIResponsesProvider) already wired
// for the Qwen synthesis/composer lanes in modelProvider.js/server.js, with
// thinking off (a rerank's output is a short JSON id/score list, not a
// reasoning task) and a short output budget.
// ---------------------------------------------------------------------------

export const DEFAULT_QWEN_RERANK_MODEL = 'qwen3.8-flash';
export const DEFAULT_RERANK_TIMEOUT_MS = 6000;
const DEFAULT_RERANK_MAX_OUTPUT_TOKENS = 200;

/**
 * Build a Qwen listwise reranker over the OpenAI-responses wire.
 *
 * Args:
 *   endpoint/apiKey: The same `AGENTFORGE_MODEL_ENDPOINT`/
 *     `AGENTFORGE_MODEL_API_KEY` the Qwen synthesis/composer lanes already
 *     use (server.js) — one configured model endpoint, multiple models.
 *   model: `AGENTFORGE_RERANK_MODEL`, default `qwen3.8-flash`.
 *   timeoutMs: `AGENTFORGE_RERANK_TIMEOUT_MS`, default 6000 — a rerank call
 *     emits only a short JSON id/score list (measured ~1-3s with thinking
 *     off), far less than the ~9s/~12s measured for the longer synthesis/
 *     composer generations on this same wire.
 *
 * Cost: no official Alibaba Model Studio price for `qwen3.8-flash` could be
 * confirmed from this environment (unlike the confirmed
 * `google/gemini-embedding-2` and `google/gemini-3.8-flash` entries in
 * `pricing.js`), so no `alibaba-qwen/*` entry exists in `PRICE_TABLE` and
 * `estimateCostUsd` returns `null` for it here — recorded as unknown, never
 * as a silent `$0`.
 */
export function createQwenReranker({ endpoint, apiKey, model = DEFAULT_QWEN_RERANK_MODEL, timeoutMs = DEFAULT_RERANK_TIMEOUT_MS, fetchImpl = globalThis.fetch, maxOutputTokens = DEFAULT_RERANK_MAX_OUTPUT_TOKENS } = {}) {
  if (typeof endpoint !== 'string' || !endpoint.trim() || typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('QWEN_RERANK_NOT_CONFIGURED');
  const provider = new OpenAIResponsesProvider({ endpoint, apiKey, model, timeoutMs, fetchImpl, extraBody: { enable_thinking: false } });

  async function rerank(query, candidates, { signal } = {}) {
    const prompt = buildListwiseRerankPrompt(query, candidates);
    let generated;
    try {
      // Each {"id","score"} entry costs roughly 15-20 tokens; a fixed budget
      // truncated the JSON for longer candidate lists.
      generated = await provider.generate({ prompt, maxTokens: Math.max(maxOutputTokens, 40 + 12 * candidates.length), signal });
    } catch {
      // Never the underlying error's message: it may carry endpoint/host
      // detail that must not reach a trace or an API response (matches
      // geminiClient.js's own fixed-code-only rule).
      throw new Error('QWEN_RERANK_REQUEST_FAILED');
    }
    const results = parseListwiseRerankResponse(generated.text, candidates);
    return {
      results,
      usage: {
        stage: 'rerank',
        provider: 'alibaba-qwen',
        model,
        inputTokens: generated.inputTokens || 0,
        outputTokens: generated.outputTokens || 0,
        estimatedCostUsd: estimateCostUsd(`alibaba-qwen/${model}`, { inputTokens: generated.inputTokens || 0, outputTokens: generated.outputTokens || 0 }),
        tokens_estimated: false,
      },
    };
  }

  return Object.freeze({ name: `alibaba-qwen:${model}`, rerank });
}

// ---------------------------------------------------------------------------
// Cohere Rerank — a real, working adapter to this interface (not a stub),
// kept unwired from `AGENTFORGE_RERANK_PROVIDER`'s current default so
// selecting it requires an explicit key, exactly like the Qwen/Gemini paths.
// It exists to prove the seam: the next reranker (Cohere or another vendor)
// is a small, self-contained file, never a change to
// `createGeminiHybridGuidelineRetriever` or the BM25/embedding candidate
// pipeline. It reuses Cohere's dedicated `/v2/rerank` endpoint (the same one
// `guidelineEvidence.js`'s older, synthetic-corpus-only
// `createCohereGuidelineRetriever` already calls for D2) rather than a chat
// completion + JSON-schema prompt, since Cohere Rerank is a purpose-built
// ranking model, not a generative one — no prompt/JSON-parsing surface at
// all, only a documents/query list in and a relevance-ordered index list
// out. That also means no id-outside-candidate-set risk the way a listwise
// LLM has: Cohere's response references candidates strictly by their
// original array index, which this adapter maps back to `candidates[i].id`.
// ---------------------------------------------------------------------------

export function createCohereReranker({ apiKey, fetchImpl = globalThis.fetch, baseUrl = 'https://api.cohere.com', model = 'rerank-v4.0-fast', timeoutMs = DEFAULT_RERANK_TIMEOUT_MS } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('COHERE_API_KEY_REQUIRED');
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');

  async function rerank(query, candidates, { signal: parentSignal } = {}) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v2/rerank`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-client-name': 'AgentForge' },
        body: JSON.stringify({ model, query, documents: candidates.map((candidate) => candidate.text), top_n: candidates.length }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('COHERE_RERANK_TIMEOUT');
      throw new Error('COHERE_RERANK_REQUEST_FAILED');
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
    if (!response.ok) throw new Error(`COHERE_RERANK_HTTP_${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.results)) throw new Error('COHERE_RERANK_RESPONSE_INVALID');
    const results = body.results.flatMap((result) => {
      const candidate = candidates[result.index];
      if (!candidate || !Number.isFinite(result.relevance_score)) return [];
      return [{ id: candidate.id, score: result.relevance_score }];
    });
    return {
      results,
      usage: {
        stage: 'rerank',
        provider: 'cohere',
        model,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: estimateCostUsd(`cohere/${model}`, {}),
        tokens_estimated: false,
        billedUnits: body.meta?.billed_units || null,
      },
    };
  }

  return Object.freeze({ name: `cohere:${model}`, rerank });
}

// ---------------------------------------------------------------------------
// Recorded-or-stub / recording generic reranker: the same seam
// `geminiClient.js` already provides for embeddings, generalized across
// reranker providers so a fixture recorded for one provider+model is never
// silently reused for another (S5/S9 review finding this task fixes).
// ---------------------------------------------------------------------------

/**
 * Deterministic fixture identity for one rerank request: provider *and*
 * model (not just model) are part of the hash, so switching
 * `AGENTFORGE_RERANK_PROVIDER` (or its model) can never find and silently
 * reuse a fixture recorded against a different reranker. Order-independent
 * over the candidate set, like `geminiClient.js`'s original.
 */
export const rerankFixtureHash = ({ provider, model, query, candidates }) => geminiRequestHash({ op: 'rerank', provider, model, query, candidates: [...candidates].map((candidate) => ({ id: candidate.id, text: candidate.text })).sort((left, right) => left.id.localeCompare(right.id)) });

function readRerankFixture(fixturesDir, hash) {
  const file = path.join(fixturesDir, `${hash}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeRerankFixture(fixturesDir, hash, payload) {
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(path.join(fixturesDir, `${hash}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}

/** Deterministic BM25-over-the-candidate-set relevance scores in [0, 1] — an honest stand-in for a listwise rerank, not a model judgment. Same approach as `geminiClient.js`'s `stubRerankResults`, generalized to the `{id, score}` interface shape. */
function stubRerankScores(query, candidates) {
  if (!candidates.length) return [];
  const index = buildBm25Index(candidates, { getText: (candidate) => candidate.text });
  const ranked = index.search(query, { topK: candidates.length });
  const topScore = ranked[0]?.score || 0;
  const scoreById = new Map(ranked.map(({ document, score }) => [document.id, topScore ? score / topScore : 0]));
  return candidates.map((candidate) => ({ id: candidate.id, score: Number((scoreById.get(candidate.id) || 0).toFixed(6)) }));
}

/**
 * A `Reranker` for tests and the eval gate for any non-Gemini provider
 * (Gemini already has its own recorded-or-stub client in `geminiClient.js`;
 * use `createGeminiReranker(createRecordedOrStubGeminiClient())` for that
 * case instead of this one). Looks up a fixture `scripts/
 * record-retrieval-fixtures.mjs` recorded for this exact provider+model+
 * query+candidate-set; falls back to a deterministic BM25 stand-in when none
 * exists. `.name`/usage always say which provider+model this stands in for,
 * and `usage.source` is `'recorded'` or `'stub'` — never silently presented
 * as a live call.
 */
export function createRecordedOrStubReranker({ provider, model, fixturesDir = defaultRetrievalFixturesDir() } = {}) {
  async function rerank(query, candidates) {
    const hash = rerankFixtureHash({ provider, model, query, candidates });
    const recorded = readRerankFixture(fixturesDir, hash);
    if (recorded?.results) {
      const candidateIds = new Set(candidates.map((candidate) => candidate.id));
      return {
        results: recorded.results.filter((result) => candidateIds.has(result.id)),
        usage: {
          stage: 'rerank',
          provider,
          model,
          inputTokens: recorded.tokenUsage?.inputTokens || 0,
          outputTokens: recorded.tokenUsage?.outputTokens || 0,
          estimatedCostUsd: estimateCostUsd(`${provider}/${model}`, recorded.tokenUsage || {}),
          tokens_estimated: Boolean(recorded.tokenUsage?.estimated),
          source: 'recorded',
        },
      };
    }
    return {
      results: stubRerankScores(query, candidates),
      // Honest stub usage: provider/model name the local stand-in, never the
      // real provider/model — this never called a real rerank API and must
      // not be presented in a trace as if it had (matches geminiClient.js's
      // stub usage for embeddings/Gemini rerank).
      usage: { stage: 'rerank', provider: 'stub', model: `${provider}-rerank-stub`, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, tokens_estimated: false, source: 'stub' },
    };
  }
  return Object.freeze({ name: `${provider}:${model}`, mode: 'recorded-or-stub', rerank });
}

/**
 * Wrap any `Reranker` so every call is also written to `fixturesDir`, keyed
 * by `rerankFixtureHash({provider, model, ...})` — used only by
 * `scripts/record-retrieval-fixtures.mjs`, never by the deployed server.
 */
export function createRecordingReranker({ liveReranker, provider, model, fixturesDir = defaultRetrievalFixturesDir() }) {
  async function rerank(query, candidates, options) {
    const result = await liveReranker.rerank(query, candidates, options);
    const hash = rerankFixtureHash({ provider, model, query, candidates });
    writeRerankFixture(fixturesDir, hash, { results: result.results, tokenUsage: { inputTokens: result.usage?.inputTokens || 0, outputTokens: result.usage?.outputTokens || 0, estimated: Boolean(result.usage?.tokens_estimated) } });
    return result;
  }
  return Object.freeze({ name: liveReranker.name, mode: 'recording', rerank });
}

// ---------------------------------------------------------------------------
// Env-driven selection (AGENTFORGE_RERANK_PROVIDER).
// ---------------------------------------------------------------------------

export const DEFAULT_RERANK_PROVIDER = 'qwen';

/** The honest usage/provider label each `AGENTFORGE_RERANK_PROVIDER` value maps to — the string that actually appears in usage records and reranker `.name`s, distinct from the short env-selector word. */
export const RERANK_PROVIDER_LABELS = Object.freeze({ qwen: 'alibaba-qwen', gemini: 'google', cohere: 'cohere' });

/**
 * Resolve which reranker provider+model is *configured* (env selector only —
 * no network I/O, no secret required), for both `createRerankerFromEnv`
 * below and the gate's manifest-match check (`w2RegressionGate.js`), which
 * needs to know the configured provider+model without needing the live API
 * key the gate never has.
 */
export function configuredRerankProviderAndModel(env = process.env) {
  const providerKey = env.AGENTFORGE_RERANK_PROVIDER || DEFAULT_RERANK_PROVIDER;
  const providerLabel = RERANK_PROVIDER_LABELS[providerKey];
  if (!providerLabel) throw new Error(`AGENTFORGE_RERANK_PROVIDER must be one of: ${Object.keys(RERANK_PROVIDER_LABELS).join(', ')}`);
  const defaultModel = providerKey === 'qwen' ? DEFAULT_QWEN_RERANK_MODEL : providerKey === 'gemini' ? GEMINI_RERANK_MODEL : 'rerank-v4.0-fast';
  const model = env.AGENTFORGE_RERANK_MODEL || defaultModel;
  return { providerKey, providerLabel, model };
}

/**
 * Build the deployed `Reranker` from environment, or `null` if the selected
 * provider is not configured (missing key/endpoint) — the caller
 * (server.js) treats a `null` reranker exactly like a missing embeddings
 * file: the hybrid retriever degrades itself to sparse-only, honestly
 * labeled, never a crash at boot (same rationale as `guidelineEvidence.js`'s
 * lazy corpus loading).
 */
export function createRerankerFromEnv(env = process.env) {
  const { providerKey, model } = configuredRerankProviderAndModel(env);
  const timeoutMs = Number(env.AGENTFORGE_RERANK_TIMEOUT_MS || DEFAULT_RERANK_TIMEOUT_MS);
  try {
    if (providerKey === 'qwen') return createQwenReranker({ endpoint: env.AGENTFORGE_MODEL_ENDPOINT, apiKey: env.AGENTFORGE_MODEL_API_KEY, model, timeoutMs });
    if (providerKey === 'cohere') return createCohereReranker({ apiKey: env.AGENTFORGE_COHERE_API_KEY, model, timeoutMs });
    if (providerKey === 'gemini') {
      if (!env.GEMINI_API_KEY) return null;
      return createGeminiReranker(createLiveGeminiClient({ apiKey: env.GEMINI_API_KEY, rerankModel: model }));
    }
  } catch {
    return null;
  }
  return null;
}
