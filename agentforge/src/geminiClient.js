import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { estimateCostUsd } from './pricing.js';
import { buildBm25Index, tokenize as bm25Tokenize } from './bm25.js';

/**
 * Shared Gemini HTTP plumbing (embeddings + generation) plus the
 * live/recorded/stub "seam" the assignment asks for (S5 item 7).
 *
 * The retry/backoff helper here is the same one `geminiScanAdapter.js` uses
 * for its own Gemini calls, extracted so both callers share one
 * implementation instead of two copies drifting apart.
 *
 * Endpoints:
 *   - Embeddings: the REST shape documented at
 *     https://ai.google.dev/api/embeddings (`POST
 *     {model=models/*}:embedContent`), model `gemini-embedding-2`
 *     (https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2),
 *     requested at `outputDimensionality: 768` (one of the model's
 *     documented Matryoshka options) to keep the corpus embeddings file
 *     small while remaining a supported configuration.
 *   - Generation (listwise rerank): the same `interactions` endpoint and
 *     JSON-schema response-format convention `geminiScanAdapter.js` already
 *     uses for `gemini-3.8-flash`, so every Gemini call in this codebase
 *     goes through one calling convention.
 */

export const GEMINI_EMBED_MODEL = 'gemini-embedding-2';
export const GEMINI_EMBED_DIMENSIONS = 768;
export const GEMINI_RERANK_MODEL = 'gemini-3.8-flash';
const EMBED_ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;
const GENERATION_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Compute the retry delay for one Gemini HTTP retry attempt.
 *
 * Honors `Retry-After` (seconds or HTTP-date) up to `maxDelayMs`; beyond that
 * (or when absent) falls back to bounded exponential backoff. Returns `null`
 * when the server's own requested delay exceeds what this caller is willing
 * to wait, so the caller fails fast instead of blocking indefinitely.
 *
 * Extracted from `geminiScanAdapter.js` so every Gemini caller in this
 * codebase shares one retry policy instead of copies that could drift.
 */
export function retryDelayMs(response, retryIndex, { baseDelayMs = BASE_RETRY_DELAY_MS, maxDelayMs = MAX_RETRY_DELAY_MS } = {}) {
  const retryAfter = response.headers?.get?.('retry-after')?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const parsed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(parsed) && parsed > maxDelayMs) return null;
    if (Number.isFinite(parsed) && parsed > 0) return Math.max(baseDelayMs * 2 ** retryIndex, parsed);
  }
  return Math.min(maxDelayMs, baseDelayMs * 2 ** retryIndex);
}

/**
 * POST `body` to `url` with a bounded number of attempts, retrying only the
 * standard set of transient HTTP statuses with backoff; timeouts and
 * malformed responses are not retried. Shared by every live Gemini call
 * (scan extraction, embeddings, rerank).
 */
export async function fetchWithGeminiRetry({ fetchImpl, url, headers, body, timeoutMs = 20000, maxAttempts = MAX_ATTEMPTS, retryableStatuses = RETRYABLE_STATUSES, baseDelayMs = BASE_RETRY_DELAY_MS, maxDelayMs = MAX_RETRY_DELAY_MS }) {
  let response;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      if (error?.name === 'AbortError') throw new Error('GEMINI_REQUEST_TIMEOUT');
      throw new Error('GEMINI_REQUEST_FAILED');
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) return response;
    if (!retryableStatuses.has(response.status) || attempt === maxAttempts - 1) throw new Error(`GEMINI_HTTP_${response.status}`);
    const delayMs = retryDelayMs(response, attempt, { baseDelayMs, maxDelayMs });
    if (delayMs === null) throw new Error(`GEMINI_HTTP_${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return response;
}

/**
 * Extract the text payload from an `interactions` response body (shared
 * with `geminiScanAdapter.js`).
 *
 * The documented shape (https://ai.google.dev/gemini-api/docs/interactions/*)
 * is a `steps[]` array — each element the assembled result of one
 * `step.start` -> `step.delta`(s) -> `step.stop` cycle, with generated text
 * carried as `{type: 'text', text}` parts (the same shape the streaming
 * delta events use). This is checked first; the flatter `output_text`/
 * `output[].content[]` shape some earlier interactions responses used is
 * kept as a fallback so a response in either shape is handled.
 */
export function responseText(body) {
  if (typeof body?.output_text === 'string') return body.output_text;
  const stepParts = (body?.steps || []).flatMap((step) => (Array.isArray(step?.content) ? step.content : step?.type === 'text' ? [step] : []));
  const fromSteps = stepParts.find((part) => part.type === 'text' && typeof part.text === 'string')?.text;
  if (fromSteps) return fromSteps;
  const parts = body?.output?.flatMap((item) => item.content || []) || [];
  return parts.find((part) => part.type === 'text' && typeof part.text === 'string')?.text || '';
}

// The documented interactions usage shape is `usage.total_input_tokens` /
// `usage.total_output_tokens` (https://ai.google.dev/gemini-api/docs/
// interactions/tokens). Older `usageMetadata`-style shapes are kept as a
// fallback, and a word-count-based estimate (~0.75 tokens per word) applies
// only when the response carries no usage information at all — always
// marked `estimated: true` so a trace never presents a guess as measured.
function extractTokenUsage(body, { fallbackInputText = '', fallbackOutputText = '' } = {}) {
  const usage = body?.usage;
  if (usage && (Number.isFinite(usage.total_input_tokens) || Number.isFinite(usage.total_output_tokens))) {
    return { inputTokens: usage.total_input_tokens ?? 0, outputTokens: usage.total_output_tokens ?? 0, estimated: false };
  }
  const meta = body?.usageMetadata || body?.usage_metadata;
  if (meta && (Number.isFinite(meta.promptTokenCount) || Number.isFinite(meta.prompt_tokens) || Number.isFinite(meta.input_tokens))) {
    return {
      inputTokens: meta.promptTokenCount ?? meta.prompt_tokens ?? meta.input_tokens ?? 0,
      outputTokens: meta.candidatesTokenCount ?? meta.completion_tokens ?? meta.output_tokens ?? 0,
      estimated: false,
    };
  }
  const estimateTokens = (text) => Math.ceil(String(text || '').split(/\s+/).filter(Boolean).length * 0.75);
  return { inputTokens: estimateTokens(fallbackInputText), outputTokens: estimateTokens(fallbackOutputText), estimated: true };
}

function usageRecord({ stage, model, tokenUsage }) {
  const priceKey = `google/${model}`;
  return {
    stage,
    provider: 'google',
    model,
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    estimatedCostUsd: estimateCostUsd(priceKey, tokenUsage),
    tokens_estimated: tokenUsage.estimated,
  };
}

/**
 * A live embed+rerank Gemini client, backed by real HTTP calls against a
 * server-only API key.
 */
// gemini-embedding-2 ignores the `taskType` request field entirely (it was
// deprecated for this model — the older gemini-embedding-001 still honors
// it). The documented replacement is an in-text instruction prefix, applied
// to the content itself before embedding:
// https://developers.googleblog.com/building-with-gemini-embedding-2/
//   query:    "task: search result | query: {content}"
//   document: "title: {title} | text: {content}"
// A `taskType` this codebase doesn't recognize (or none) is sent verbatim,
// unprefixed, rather than guessing a prefix.
function embedInputText(text, taskType, title) {
  if (taskType === 'RETRIEVAL_QUERY') return `task: search result | query: ${text}`;
  if (taskType === 'RETRIEVAL_DOCUMENT') return `title: ${title || 'none'} | text: ${text}`;
  return text;
}

export function createLiveGeminiClient({ apiKey, fetchImpl = globalThis.fetch, embedModel = GEMINI_EMBED_MODEL, rerankModel = GEMINI_RERANK_MODEL, outputDimensionality = GEMINI_EMBED_DIMENSIONS, embedTimeoutMs = 10000, rerankTimeoutMs = 20000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');

  async function embed(text, taskType, { title } = {}) {
    const response = await fetchWithGeminiRetry({
      fetchImpl,
      url: EMBED_ENDPOINT(embedModel),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ model: `models/${embedModel}`, content: { parts: [{ text: embedInputText(text, taskType, title) }] }, outputDimensionality }),
      timeoutMs: embedTimeoutMs,
    });
    const body = await response.json();
    // Handle both the singular `embedding.values` shape (gemini-embedding-001)
    // and the `embeddings[].values` array shape documented for
    // gemini-embedding-2 — Google's own docs are inconsistent about which
    // applies per model/endpoint version, so both are accepted rather than
    // assuming one and failing closed on the other.
    const values = body?.embedding?.values || body?.embeddings?.[0]?.values;
    if (!Array.isArray(values) || !values.length || !values.every(Number.isFinite)) throw new Error('GEMINI_EMBED_RESPONSE_INVALID');
    return { values, usage: usageRecord({ stage: 'embed', model: embedModel, tokenUsage: extractTokenUsage(body, { fallbackInputText: text }) }) };
  }

  async function rerank(query, candidates) {
    const prompt = buildRerankPrompt(query, candidates);
    const schema = rerankSchema(candidates);
    const response = await fetchWithGeminiRetry({
      fetchImpl,
      url: GENERATION_ENDPOINT,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      // store: false — this is a per-request rerank call over guideline text,
      // not a user-facing conversation; it must not be retained server-side
      // as interaction history.
      body: JSON.stringify({ model: rerankModel, input: [{ type: 'text', text: prompt }], response_format: { type: 'text', mime_type: 'application/json', schema }, generation_config: { thinking_level: 'low', max_output_tokens: 1024 }, store: false }),
      timeoutMs: rerankTimeoutMs,
    });
    const body = await response.json();
    const text = responseText(body);
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('GEMINI_RERANK_JSON_INVALID'); }
    const results = validateRerankResults(parsed, candidates);
    return { results, usage: usageRecord({ stage: 'rerank', model: rerankModel, tokenUsage: extractTokenUsage(body, { fallbackInputText: prompt, fallbackOutputText: text }) }) };
  }

  return Object.freeze({ name: `google-${embedModel}+${rerankModel}`, mode: 'live', embed, rerank });
}

function buildRerankPrompt(query, candidates) {
  const listed = candidates.map((candidate, index) => `${index + 1}. id=${candidate.id}\n${candidate.text}`).join('\n\n');
  return `You are ranking clinical guideline excerpts by relevance to a clinician's question. Question: "${query}"\n\nCandidates:\n${listed}\n\nReturn every candidate id with a relevance_score from 0 (irrelevant) to 1 (directly answers the question). Use only the ids listed above.`;
}

function rerankSchema(candidates) {
  return {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: { chunk_id: { type: 'string', enum: candidates.map((candidate) => candidate.id) }, relevance_score: { type: 'number', minimum: 0, maximum: 1 } },
          required: ['chunk_id', 'relevance_score'],
        },
      },
    },
    required: ['results'],
  };
}

const RerankResponseShape = z.object({ results: z.array(z.object({ chunk_id: z.string().min(1), relevance_score: z.number().min(0).max(1) }).strict()) }).strict();

/** Validate a rerank model response against the Zod shape and drop any id outside the candidate set — the model's JSON is untrusted input, never trusted to only name real candidates. */
function validateRerankResults(parsed, candidates) {
  const validated = RerankResponseShape.safeParse(parsed);
  if (!validated.success) throw new Error('GEMINI_RERANK_SCHEMA_INVALID');
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  return validated.data.results.filter((result) => candidateIds.has(result.chunk_id));
}

/**
 * Deterministic hash of the fields that define a Gemini request, used both
 * to name recorded fixtures and to look one up.
 */
export function geminiRequestHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

export function defaultRetrievalFixturesDir() {
  return fileURLToPath(new URL('../test/fixtures/retrieval/', import.meta.url));
}

// Shared by the recorded-or-stub client (lookup) and
// `scripts/record-retrieval-fixtures.mjs` (write) so a fixture recorded for
// one exact request is found by the other — the hash key is a single
// source of truth, never duplicated at each call site.
export const embedFixtureHash = ({ model, taskType, text, title }) => geminiRequestHash({ op: 'embed', model, taskType, text, title: title || null });
// Sorted by id so the hash is stable regardless of the candidate set's
// incidental ordering (e.g. a Map iteration order that depends on which of
// sparse/dense contributed a given id first) — only the query and the exact
// set of candidate {id, text} pairs define the request.
export const rerankFixtureHash = ({ model, query, candidates }) => geminiRequestHash({ op: 'rerank', model, query, candidates: [...candidates].map((candidate) => ({ id: candidate.id, text: candidate.text })).sort((left, right) => left.id.localeCompare(right.id)) });

function readFixture(fixturesDir, hash) {
  const file = path.join(fixturesDir, `${hash}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeFixture(fixturesDir, hash, payload) {
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(path.join(fixturesDir, `${hash}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}

// A fixed, small dimensionality for the deterministic stand-in embedding.
// This is a hashing-trick bag-of-words vector, not a semantic embedding —
// it exists only so the hybrid pipeline's *shape* (union candidates, cosine
// rank, rerank threshold) is exercised deterministically before real
// embeddings/rerank responses are recorded. Never used outside tests/the gate.
const STUB_EMBED_DIMENSIONS = 64;

/** Deterministic hashing-trick pseudo-embedding — an honest stand-in, not a semantic embedding. */
export function stubEmbedding(text, dimensions = STUB_EMBED_DIMENSIONS) {
  const vector = new Array(dimensions).fill(0);
  for (const token of bm25Tokenize(text)) {
    const hash = createHash('sha1').update(token).digest();
    const index = hash.readUInt32BE(0) % dimensions;
    const sign = hash[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }
  return vector;
}

/**
 * Deterministic BM25-over-the-candidate-set relevance scores in [0, 1] — an
 * honest stand-in for an LLM listwise rerank, not a model judgment. Scored
 * with a fresh BM25 index over just this request's candidates (so the
 * IDF reflects what's actually distinctive within them) and min-max
 * normalized against the top score, so the threshold in
 * `createGeminiHybridGuidelineRetriever` (relative to a 0-1 scale) behaves
 * sensibly regardless of the candidate set's absolute BM25 magnitudes. A
 * query with no lexical overlap with any candidate scores everything 0.
 */
function stubRerankResults(query, candidates) {
  if (!candidates.length) return [];
  const index = buildBm25Index(candidates, { getText: (candidate) => candidate.text });
  const ranked = index.search(query, { topK: candidates.length });
  const topScore = ranked[0]?.score || 0;
  const scoreById = new Map(ranked.map(({ document, score }) => [document.id, topScore ? score / topScore : 0]));
  return candidates.map((candidate) => ({ chunk_id: candidate.id, relevance_score: Number((scoreById.get(candidate.id) || 0).toFixed(6)) }));
}

/**
 * The GeminiClient seam used by tests and the eval gate (never by the
 * deployed server, which always uses `createLiveGeminiClient` when a key is
 * configured): for each request, look for a fixture recorded by
 * `scripts/record-retrieval-fixtures.mjs` (real Gemini output, keyed by a
 * hash of the request); if none has been recorded yet, fall back to a
 * deterministic, clearly-labeled stand-in so the pipeline shape is still
 * exercised. `.name`/`.mode` always say `recorded-or-stub` — never claim to
 * be the live client — and each usage record is tagged `source: 'recorded'`
 * or `source: 'stub'` so a trace can tell which one actually ran.
 */
export function createRecordedOrStubGeminiClient({ fixturesDir = defaultRetrievalFixturesDir(), embedModel = GEMINI_EMBED_MODEL, rerankModel = GEMINI_RERANK_MODEL } = {}) {
  async function embed(text, taskType, { title } = {}) {
    const hash = embedFixtureHash({ model: embedModel, taskType, text, title });
    const recorded = readFixture(fixturesDir, hash);
    if (recorded?.values) return { values: recorded.values, usage: { ...usageRecord({ stage: 'embed', model: embedModel, tokenUsage: recorded.tokenUsage || { inputTokens: 0, outputTokens: 0, estimated: true } }), source: 'recorded' } };
    // Honest stub usage: provider/model name the local hashing stand-in,
    // never `google`/the real model name — this never called Gemini, cost
    // nothing, and must not be presented in a trace as if it had.
    return { values: stubEmbedding(text), usage: { stage: 'embed', provider: 'stub', model: 'hashing-trick-embedding-stub', inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, tokens_estimated: false, source: 'stub' } };
  }

  async function rerank(query, candidates) {
    const hash = rerankFixtureHash({ model: rerankModel, query, candidates });
    const recorded = readFixture(fixturesDir, hash);
    if (recorded?.results) return { results: validateRerankResults({ results: recorded.results }, candidates), usage: { ...usageRecord({ stage: 'rerank', model: rerankModel, tokenUsage: recorded.tokenUsage || { inputTokens: 0, outputTokens: 0, estimated: true } }), source: 'recorded' } };
    const results = stubRerankResults(query, candidates);
    return { results, usage: { stage: 'rerank', provider: 'stub', model: 'bm25-rerank-stub', inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, tokens_estimated: false, source: 'stub' } };
  }

  return Object.freeze({ name: 'recorded-or-stub', mode: 'recorded-or-stub', embed, rerank });
}

/**
 * Wrap a live Gemini client so every embed/rerank call is also written to
 * `fixturesDir`, keyed by the same hash `createRecordedOrStubGeminiClient`
 * looks up. Used only by `scripts/record-retrieval-fixtures.mjs` — never by
 * the deployed server.
 */
export function createRecordingGeminiClient({ liveClient, fixturesDir = defaultRetrievalFixturesDir(), embedModel = GEMINI_EMBED_MODEL, rerankModel = GEMINI_RERANK_MODEL }) {
  async function embed(text, taskType, options = {}) {
    const result = await liveClient.embed(text, taskType, options);
    const hash = embedFixtureHash({ model: embedModel, taskType, text, title: options.title });
    writeFixture(fixturesDir, hash, { values: result.values, tokenUsage: { inputTokens: result.usage?.inputTokens || 0, outputTokens: result.usage?.outputTokens || 0, estimated: Boolean(result.usage?.tokens_estimated) } });
    return result;
  }

  async function rerank(query, candidates) {
    const result = await liveClient.rerank(query, candidates);
    const hash = rerankFixtureHash({ model: rerankModel, query, candidates });
    writeFixture(fixturesDir, hash, { results: result.results, tokenUsage: { inputTokens: result.usage?.inputTokens || 0, outputTokens: result.usage?.outputTokens || 0, estimated: Boolean(result.usage?.tokens_estimated) } });
    return result;
  }

  return Object.freeze({ name: liveClient.name, mode: 'recording', embed, rerank });
}
