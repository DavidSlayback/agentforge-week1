import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GEMINI_RERANK_MODEL } from '../src/geminiClient.js';
import {
  configuredRerankProviderAndModel,
  createCohereReranker,
  createGeminiReranker,
  createQwenReranker,
  createRecordedOrStubReranker,
  createRecordingReranker,
  createRerankerFromEnv,
  DEFAULT_QWEN_RERANK_MODEL,
  rerankFixtureHash,
} from '../src/reranker.js';

const CANDIDATES = [
  { id: 'cdc-a1c-test-definition', text: 'The A1C test measures average blood glucose over 2-3 months.' },
  { id: 'niddk-a1c-test-uses', text: 'A1C is used to diagnose prediabetes and diabetes.' },
];

function fakeQwenFetch({ outputText, usage = { input_tokens: 40, output_tokens: 15 } }) {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ output_text: outputText, usage }) };
  };
  return { bodies, fetchImpl };
}

// ---------------------------------------------------------------------------
// Qwen listwise reranker
// ---------------------------------------------------------------------------

test('Qwen reranker: interface conformance, thinking off, and honest (unknown) cost', async () => {
  const { bodies, fetchImpl } = fakeQwenFetch({ outputText: JSON.stringify({ results: [{ n: 1, score: 0.95 }, { n: 2, score: 0.4 }] }) });
  const reranker = createQwenReranker({ endpoint: 'https://example.test/v1/responses', apiKey: 'k', fetchImpl });
  assert.equal(reranker.name, `alibaba-qwen:${DEFAULT_QWEN_RERANK_MODEL}`);
  const { results, usage } = await reranker.rerank('A1C diagnosis threshold', CANDIDATES, {});
  assert.deepEqual(results, [{ id: 'cdc-a1c-test-definition', score: 0.95 }, { id: 'niddk-a1c-test-uses', score: 0.4 }]);
  assert.equal(bodies[0].enable_thinking, false);
  assert.equal(bodies[0].model, DEFAULT_QWEN_RERANK_MODEL);
  assert.equal(usage.stage, 'rerank');
  assert.equal(usage.provider, 'alibaba-qwen');
  assert.equal(usage.model, DEFAULT_QWEN_RERANK_MODEL);
  assert.equal(usage.inputTokens, 40);
  assert.equal(usage.outputTokens, 15);
  // No official Alibaba Model Studio price for qwen3.8-flash was confirmed
  // (pricing.js) -- cost must be recorded as unknown (null), never a silent 0.
  assert.equal(usage.estimatedCostUsd, null);
});

test('Qwen reranker rejects a candidate number outside the list instead of trusting the model JSON', async () => {
  const { fetchImpl } = fakeQwenFetch({ outputText: JSON.stringify({ results: [{ n: 1, score: 0.9 }, { n: 99, score: 0.99 }] }) });
  const reranker = createQwenReranker({ endpoint: 'https://example.test/v1/responses', apiKey: 'k', fetchImpl });
  const { results } = await reranker.rerank('q', CANDIDATES, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'cdc-a1c-test-definition');
  assert.equal(results.some((result) => result.id === 'not-a-real-candidate-id'), false);
});

test('Qwen reranker throws a fixed code (never the raw text) on malformed JSON', async () => {
  const { fetchImpl } = fakeQwenFetch({ outputText: 'this is not json' });
  const reranker = createQwenReranker({ endpoint: 'https://example.test/v1/responses', apiKey: 'k', fetchImpl });
  await assert.rejects(reranker.rerank('q', CANDIDATES, {}), /RERANK_JSON_INVALID/);
});

test('Qwen reranker tolerates a markdown-fenced JSON response', async () => {
  const { fetchImpl } = fakeQwenFetch({ outputText: '```json\n{"results":[{"n":1,"score":0.7}]}\n```' });
  const reranker = createQwenReranker({ endpoint: 'https://example.test/v1/responses', apiKey: 'k', fetchImpl });
  const { results } = await reranker.rerank('q', CANDIDATES, {});
  assert.deepEqual(results, [{ id: 'cdc-a1c-test-definition', score: 0.7 }]);
});

test('Qwen reranker throws a fixed schema-invalid code when the JSON does not match the shape', async () => {
  const { fetchImpl } = fakeQwenFetch({ outputText: JSON.stringify({ results: [{ n: 1 }] }) });
  const reranker = createQwenReranker({ endpoint: 'https://example.test/v1/responses', apiKey: 'k', fetchImpl });
  await assert.rejects(reranker.rerank('q', CANDIDATES, {}), /RERANK_SCHEMA_INVALID/);
});

test('Qwen reranker never leaks an underlying request-failure message', async () => {
  const fetchImpl = async () => { throw new Error('secret internal endpoint detail'); };
  const reranker = createQwenReranker({ endpoint: 'https://example.test/v1/responses', apiKey: 'k', fetchImpl });
  await assert.rejects(reranker.rerank('q', CANDIDATES, {}), (error) => {
    assert.equal(error.message, 'QWEN_RERANK_REQUEST_FAILED');
    return true;
  });
});

test('createQwenReranker requires an endpoint and key', () => {
  assert.throws(() => createQwenReranker({ endpoint: '', apiKey: 'k' }), /QWEN_RERANK_NOT_CONFIGURED/);
  assert.throws(() => createQwenReranker({ endpoint: 'https://example.test', apiKey: '' }), /QWEN_RERANK_NOT_CONFIGURED/);
});

// ---------------------------------------------------------------------------
// Gemini reranker adapter (wraps geminiClient.js's existing listwise reranker)
// ---------------------------------------------------------------------------

test('Gemini reranker adapter maps chunk_id/relevance_score to the id/score interface and preserves usage', async () => {
  const fakeGeminiClient = {
    name: 'google-gemini-embedding-2+gemini-3.8-flash',
    async rerank(query, candidates) {
      return { results: candidates.map((candidate, index) => ({ chunk_id: candidate.id, relevance_score: index === 0 ? 0.8 : 0.2 })), usage: { stage: 'rerank', provider: 'google', model: 'gemini-3.8-flash', inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.0001, tokens_estimated: false } };
    },
  };
  const reranker = createGeminiReranker(fakeGeminiClient);
  assert.equal(reranker.name, `google:${GEMINI_RERANK_MODEL}`);
  const { results, usage } = await reranker.rerank('q', CANDIDATES, {});
  assert.deepEqual(results, [{ id: 'cdc-a1c-test-definition', score: 0.8 }, { id: 'niddk-a1c-test-uses', score: 0.2 }]);
  assert.equal(usage.provider, 'google');
});

test('createGeminiReranker requires a client exposing rerank()', () => {
  assert.throws(() => createGeminiReranker(null), /GEMINI_RERANK_CLIENT_REQUIRED/);
  assert.throws(() => createGeminiReranker({ name: 'no-rerank-method' }), /GEMINI_RERANK_CLIENT_REQUIRED/);
});

// ---------------------------------------------------------------------------
// Cohere reranker (real adapter, not deployed by default)
// ---------------------------------------------------------------------------

test('Cohere reranker maps its index-based response back to candidate ids and records unknown cost', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ results: [{ index: 1, relevance_score: 0.77 }, { index: 0, relevance_score: 0.11 }], meta: { billed_units: { search_units: 1 } } }) };
  };
  const reranker = createCohereReranker({ apiKey: 'unit-test-key', fetchImpl });
  assert.equal(reranker.name, 'cohere:rerank-v4.0-fast');
  const { results, usage } = await reranker.rerank('q', CANDIDATES, {});
  assert.deepEqual(results, [{ id: 'niddk-a1c-test-uses', score: 0.77 }, { id: 'cdc-a1c-test-definition', score: 0.11 }]);
  assert.equal(calls[0].url.endsWith('/v2/rerank'), true);
  assert.equal(calls[0].body.documents.length, CANDIDATES.length);
  // No cohere/* entry exists in pricing.js's PRICE_TABLE -- unknown, not $0.
  assert.equal(usage.estimatedCostUsd, null);
  assert.equal(usage.provider, 'cohere');
});

test('Cohere reranker requires a server-side key and never leaks a request failure message', async () => {
  assert.throws(() => createCohereReranker(), /COHERE_API_KEY_REQUIRED/);
  const reranker = createCohereReranker({ apiKey: 'k', fetchImpl: async () => { throw new Error('secret-bearing network detail'); } });
  await assert.rejects(reranker.rerank('q', CANDIDATES, {}), (error) => {
    assert.equal(error.message, 'COHERE_RERANK_REQUEST_FAILED');
    return true;
  });
});

// ---------------------------------------------------------------------------
// Recorded-or-stub / recording reranker (fixtures keyed by provider+model)
// ---------------------------------------------------------------------------

test('recorded-or-stub reranker falls back to an honestly-labeled deterministic stand-in when no fixture exists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rerank-fixtures-'));
  const reranker = createRecordedOrStubReranker({ provider: 'alibaba-qwen', model: 'qwen3.8-flash', fixturesDir: dir });
  const { results, usage } = await reranker.rerank('A1C diagnosis threshold', CANDIDATES);
  assert.equal(results.length, CANDIDATES.length);
  assert.equal(usage.provider, 'stub');
  assert.notEqual(usage.model, 'qwen3.8-flash');
  assert.equal(usage.source, 'stub');
});

test('createRecordingReranker writes a fixture the matching recorded-or-stub reranker then finds and replays', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rerank-fixtures-'));
  const liveReranker = { name: 'fake-live', async rerank() { return { results: [{ id: 'cdc-a1c-test-definition', score: 0.6 }], usage: { stage: 'rerank', provider: 'alibaba-qwen', model: 'qwen3.8-flash', inputTokens: 12, outputTokens: 3, estimatedCostUsd: null, tokens_estimated: false } }; } };
  const recording = createRecordingReranker({ liveReranker, provider: 'alibaba-qwen', model: 'qwen3.8-flash', fixturesDir: dir });
  await recording.rerank('A1C diagnosis threshold', CANDIDATES);
  const replay = createRecordedOrStubReranker({ provider: 'alibaba-qwen', model: 'qwen3.8-flash', fixturesDir: dir });
  const { results, usage } = await replay.rerank('A1C diagnosis threshold', CANDIDATES);
  assert.deepEqual(results, [{ id: 'cdc-a1c-test-definition', score: 0.6 }]);
  assert.equal(usage.source, 'recorded');
  assert.equal(usage.provider, 'alibaba-qwen');
});

test('rerankFixtureHash depends on the reranker provider, so switching providers never reuses a fixture recorded for a different one', () => {
  const query = 'A1C diagnosis threshold';
  const qwenHash = rerankFixtureHash({ provider: 'alibaba-qwen', model: 'qwen3.8-flash', query, candidates: CANDIDATES });
  const geminiHash = rerankFixtureHash({ provider: 'google', model: 'gemini-3.8-flash', query, candidates: CANDIDATES });
  assert.notEqual(qwenHash, geminiHash);
});

// ---------------------------------------------------------------------------
// Env-driven provider selection (AGENTFORGE_RERANK_PROVIDER)
// ---------------------------------------------------------------------------

test('configuredRerankProviderAndModel defaults to qwen for W2', () => {
  const { providerKey, providerLabel, model } = configuredRerankProviderAndModel({});
  assert.equal(providerKey, 'qwen');
  assert.equal(providerLabel, 'alibaba-qwen');
  assert.equal(model, DEFAULT_QWEN_RERANK_MODEL);
});

test('configuredRerankProviderAndModel selects gemini and its default model', () => {
  const { providerKey, providerLabel, model } = configuredRerankProviderAndModel({ AGENTFORGE_RERANK_PROVIDER: 'gemini' });
  assert.equal(providerKey, 'gemini');
  assert.equal(providerLabel, 'google');
  assert.equal(model, GEMINI_RERANK_MODEL);
});

test('configuredRerankProviderAndModel honors an explicit AGENTFORGE_RERANK_MODEL override', () => {
  const { model } = configuredRerankProviderAndModel({ AGENTFORGE_RERANK_PROVIDER: 'qwen', AGENTFORGE_RERANK_MODEL: 'qwen3.8-flash-custom' });
  assert.equal(model, 'qwen3.8-flash-custom');
});

test('configuredRerankProviderAndModel rejects an unrecognized provider loudly', () => {
  assert.throws(() => configuredRerankProviderAndModel({ AGENTFORGE_RERANK_PROVIDER: 'not-a-real-provider' }), /AGENTFORGE_RERANK_PROVIDER/);
});

test('createRerankerFromEnv builds a working, honestly-named Qwen reranker when configured', () => {
  const reranker = createRerankerFromEnv({ AGENTFORGE_RERANK_PROVIDER: 'qwen', AGENTFORGE_MODEL_ENDPOINT: 'https://example.test/v1/responses', AGENTFORGE_MODEL_API_KEY: 'k' });
  assert.equal(reranker.name, `alibaba-qwen:${DEFAULT_QWEN_RERANK_MODEL}`);
});

test('createRerankerFromEnv returns null (never throws) when the selected provider is unconfigured', () => {
  assert.equal(createRerankerFromEnv({ AGENTFORGE_RERANK_PROVIDER: 'qwen' }), null);
  assert.equal(createRerankerFromEnv({ AGENTFORGE_RERANK_PROVIDER: 'gemini' }), null);
  assert.equal(createRerankerFromEnv({ AGENTFORGE_RERANK_PROVIDER: 'cohere' }), null);
});

test('createRerankerFromEnv builds the Gemini adapter when GEMINI_API_KEY is set', () => {
  const reranker = createRerankerFromEnv({ AGENTFORGE_RERANK_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' });
  assert.equal(reranker.name, `google:${GEMINI_RERANK_MODEL}`);
});

test('createRerankerFromEnv builds Cohere when AGENTFORGE_COHERE_API_KEY is set', () => {
  const reranker = createRerankerFromEnv({ AGENTFORGE_RERANK_PROVIDER: 'cohere', AGENTFORGE_COHERE_API_KEY: 'k' });
  assert.equal(reranker.name, 'cohere:rerank-v4.0-fast');
});

test('Qwen reranker output budget scales with the candidate count', async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ output_text: JSON.stringify({ results: [{ n: 1, score: 0.9 }] }), usage: { input_tokens: 1, output_tokens: 1 } }) }; };
  const { createQwenReranker } = await import('../src/reranker.js');
  const rr = createQwenReranker({ endpoint: 'https://example.test/v1/responses', apiKey: 'k', fetchImpl });
  await rr.rerank('a1c', Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, text: `chunk ${i}` })));
  assert.ok(bodies[0].max_output_tokens >= 40 + 12 * 12, `budget ${bodies[0].max_output_tokens}`);
});

test('hybrid retriever reranks at most RERANK_CANDIDATE_LIMIT candidates', async () => {
  const { createGeminiHybridGuidelineRetriever, loadGuidelineCorpus, RERANK_CANDIDATE_LIMIT } = await import('../src/guidelineEvidence.js');
  const corpus = loadGuidelineCorpus();
  const dims = 8;
  const vec = (seed) => Array.from({ length: dims }, (_, i) => Math.sin(seed * (i + 1)) + 1.1);
  const embeddings = { vectors: Object.fromEntries(corpus.map((c, i) => [c.source_id, vec(i + 1)])) };
  const embedClient = { name: 'fake-embed', async embed() { return { values: vec(3), usage: { stage: 'embed', provider: 'stub', model: 'fake' } }; } };
  let seen = 0;
  const reranker = { name: 'fake-rerank', async rerank(_q, candidates) { seen = candidates.length; return { results: candidates.map((c, i) => ({ id: c.id, score: 1 - i / 100 })), usage: { stage: 'rerank', provider: 'stub', model: 'fake' } }; } };
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient, reranker, corpus, embeddings });
  await retriever.retrieve('A1C test result blood sugar diabetes blood pressure cholesterol kidney anemia medication', { topK: 3 });
  assert.ok(seen > 0 && seen <= RERANK_CANDIDATE_LIMIT, `reranked ${seen}`);
});
