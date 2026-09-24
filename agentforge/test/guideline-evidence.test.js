import test from 'node:test';
import assert from 'node:assert/strict';
import { createCohereGuidelineRetriever, createGeminiHybridGuidelineRetriever, loadGuidelineCorpus, retrieveGuidelineEvidence, sanitizeForExternalModel } from '../src/guidelineEvidence.js';
import { createRecordedOrStubGeminiClient, stubEmbedding } from '../src/geminiClient.js';
import { createGeminiReranker } from '../src/reranker.js';
import { GuidelineEvidence, parseOrIssues } from '../src/schemas.js';
import { startTestServer } from './helpers/testServer.js';

test('real BM25 ranks a relevant real-corpus guideline for an on-topic query, with full provenance', () => {
  const result = retrieveGuidelineEvidence('A1C blood sugar diabetes diagnosis threshold');
  assert.equal(result.status, 'complete');
  assert.equal(result.provider, 'bm25-sparse-only');
  assert.equal(result.degraded, 'sparse_only');
  const top = result.evidence[0];
  assert.equal(top.citation.source_type, 'guideline');
  assert.ok(top.citation.page_or_section.length > 0);
  assert.ok(top.matched_terms.includes('a1c'));
  assert.equal(top.degraded, 'sparse_only');
  assert.equal(parseOrIssues(GuidelineEvidence, top).ok, true);
  // Real IDF-weighted BM25, not a raw overlap count: scores strictly descend.
  for (let index = 1; index < result.evidence.length; index += 1) assert.ok(result.evidence[index].rerank_score <= result.evidence[index - 1].rerank_score);
});

test('guideline retrieval qualifies empty or off-topic questions', () => {
  assert.equal(retrieveGuidelineEvidence('').status, 'qualified');
  const result = retrieveGuidelineEvidence('quasar galaxies nebula astronomy');
  assert.equal(result.status, 'qualified');
  assert.ok(result.issues.includes('insufficient_guideline_evidence'));
});

test('the real corpus loads 20-60 chunks, each with full source metadata and no synthetic placeholders', () => {
  const corpus = loadGuidelineCorpus();
  assert.ok(corpus.length >= 20 && corpus.length <= 60, `expected 20-60 chunks, got ${corpus.length}`);
  for (const chunk of corpus) {
    for (const key of ['source_id', 'title', 'publisher', 'url', 'section', 'version_or_date', 'retrieved_at', 'text']) {
      assert.ok(typeof chunk[key] === 'string' && chunk[key].length > 0, `chunk ${chunk.source_id} is missing ${key}`);
    }
    assert.ok(chunk.url.startsWith('https://'), `chunk ${chunk.source_id} url must be a real https link`);
    assert.notEqual(chunk.publisher, 'synthetic-placeholder');
  }
  const ids = new Set(corpus.map((chunk) => chunk.source_id));
  assert.equal(ids.size, corpus.length, 'source_id must be unique per chunk');
});

function stubEmbeddingsFor(corpus) {
  return { vectors: Object.fromEntries(corpus.map((chunk) => [chunk.source_id, stubEmbedding(`${chunk.title}\n${chunk.section}\n${chunk.text}`)])) };
}

test('sanitizeForExternalModel strips a name, a date of birth, and a phone number, keeping only clinical vocabulary words', () => {
  const corpus = loadGuidelineCorpus();
  const vocabulary = new Set(corpus.flatMap((chunk) => `${chunk.title} ${chunk.section} ${chunk.text}`.toLowerCase().match(/[a-z0-9]+/g) || []));
  for (const word of ['abnormal', 'test', 'result', 'a1c']) vocabulary.add(word);
  const withPhi = "Patient David Smith, DOB 04/12/1980, phone 555-0100, A1C test result abnormal";
  const sanitized = sanitizeForExternalModel(withPhi, vocabulary);
  assert.equal(/david/i.test(sanitized), false);
  assert.equal(/smith/i.test(sanitized), false);
  assert.equal(/04|12|1980|0100|555/.test(sanitized), false);
  assert.match(sanitized, /\ba1c\b/i);
  assert.match(sanitized, /abnormal/i);
});

test('the hybrid retriever never sends the raw client message to any external model: a name/DOB/phone-bearing clinician question is stripped before the embed/rerank calls', async () => {
  const corpus = loadGuidelineCorpus();
  const embedCalls = [];
  const rerankCalls = [];
  const capturingClient = {
    name: 'capturing-fake',
    async embed(text) { embedCalls.push(text); return { values: stubEmbedding(text), usage: { stage: 'embed', provider: 'google', model: 'fake', inputTokens: 1, outputTokens: 0, estimatedCostUsd: 0 } }; },
    async rerank(query, candidates) { rerankCalls.push(query); return { results: candidates.map((candidate) => ({ chunk_id: candidate.id, relevance_score: 0.9 })), usage: { stage: 'rerank', provider: 'google', model: 'fake', inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 } }; },
  };
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient: capturingClient, reranker: createGeminiReranker(capturingClient), corpus, embeddings: stubEmbeddingsFor(corpus) });
  const phiBearingQuestion = 'Abnormal findings: A1C test result abnormal. Please call patient David Smith at 555-0100, DOB 04/12/1980, about the A1C result.';
  await retriever.retrieve(phiBearingQuestion, { topK: 3 });
  assert.ok(embedCalls.length > 0 && rerankCalls.length > 0, 'the capturing client must actually have been called');
  for (const sentText of [...embedCalls, ...rerankCalls]) {
    assert.equal(/david/i.test(sentText), false, `sent text still contains a name: ${sentText}`);
    assert.equal(/smith/i.test(sentText), false, `sent text still contains a name: ${sentText}`);
    assert.equal(/555.0100/.test(sentText), false, `sent text still contains a phone number: ${sentText}`);
    assert.equal(/04.12.1980/.test(sentText), false, `sent text still contains a date of birth: ${sentText}`);
    assert.match(sentText, /a1c/i, 'sanitization must not drop real clinical vocabulary along with PHI');
  }
});

test('the hybrid retriever degrades to sparse-only, not a fabricated empty embed call, when nothing in the query survives sanitization', async () => {
  const corpus = loadGuidelineCorpus();
  let called = false;
  const client = { name: 'should-not-be-called', embed: async () => { called = true; return { values: [], usage: {} }; }, rerank: async () => { called = true; return { results: [], usage: {} }; } };
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient: client, reranker: createGeminiReranker(client), corpus, embeddings: stubEmbeddingsFor(corpus) });
  const result = await retriever.retrieve('David Smith 555-0100', { topK: 3 });
  assert.equal(called, false);
  assert.equal(result.degraded, 'sparse_only');
});

test('the hybrid retriever unions sparse+dense candidates, reranks, and honestly labels a stub-backed run', async () => {
  const corpus = loadGuidelineCorpus();
  const geminiClient = createRecordedOrStubGeminiClient();
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient: geminiClient, reranker: createGeminiReranker(geminiClient), corpus, embeddings: stubEmbeddingsFor(corpus) });
  const result = await retriever.retrieve('A1C blood sugar diabetes diagnosis threshold', { topK: 3 });
  assert.equal(result.status, 'complete');
  assert.ok(result.provider.startsWith('hybrid:'));
  assert.ok(result.evidence.length > 0 && result.evidence.length <= 3);
  // No fixture has been recorded for this exact request, so `recorded-or-stub`
  // fell back to its deterministic stand-in for both calls — the result ran
  // the full hybrid shape, but must say `stub`, never `null`, under a
  // `hybrid:` name (never present a simulation as the real thing).
  assert.equal(result.degraded, 'stub');
  for (const item of result.evidence) {
    assert.equal(parseOrIssues(GuidelineEvidence, item).ok, true);
    assert.equal(item.degraded, 'stub');
    assert.equal(item.citation.source_type, 'guideline');
  }
  // The rerank step must actually rank, not just pass candidates through:
  // the top result is a genuinely A1C-relevant chunk, and scores descend.
  assert.equal(result.evidence[0].citation.source_id, 'cdc-a1c-test-definition');
  for (let index = 1; index < result.evidence.length; index += 1) assert.ok(result.evidence[index].rerank_score <= result.evidence[index - 1].rerank_score);
  assert.ok(Array.isArray(result.usage) && result.usage.length === 2);
  assert.deepEqual(result.usage.map((usage) => usage.stage), ['embed', 'rerank']);
  assert.ok(result.usage.every((usage) => usage.provider === 'stub'), 'stub usage must never claim provider google');
});

test('the hybrid retriever reports degraded: null only for a genuinely non-stub (real or recorded) client', async () => {
  const corpus = loadGuidelineCorpus();
  // A fake "real" client: same interface, but its usage carries no
  // `source: 'stub'` tag (as createLiveGeminiClient's and a populated
  // recorded-fixture hit both would not).
  const realish = {
    name: 'google-fake-embed+fake-rerank',
    async embed(text) { return { values: stubEmbedding(text), usage: { stage: 'embed', provider: 'google', model: 'fake', inputTokens: 10, outputTokens: 0, estimatedCostUsd: 0.00001 } }; },
    async rerank(query, candidates) { return { results: candidates.map((candidate, index) => ({ chunk_id: candidate.id, relevance_score: index === 0 ? 0.9 : 0.1 })), usage: { stage: 'rerank', provider: 'google', model: 'fake', inputTokens: 20, outputTokens: 5, estimatedCostUsd: 0.00002 } }; },
  };
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient: realish, reranker: createGeminiReranker(realish), corpus, embeddings: stubEmbeddingsFor(corpus) });
  const result = await retriever.retrieve('A1C blood sugar diabetes diagnosis threshold', { topK: 3 });
  assert.equal(result.degraded, null);
  assert.ok(result.evidence.every((item) => item.degraded === null));
});

test('the hybrid retriever degrades to sparse-only, never labeled hybrid, when embeddings are missing', async () => {
  const geminiClient = createRecordedOrStubGeminiClient();
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient: geminiClient, reranker: createGeminiReranker(geminiClient), embeddings: null });
  const result = await retriever.retrieve('A1C blood sugar diabetes diagnosis threshold', { topK: 3 });
  assert.equal(result.degraded, 'sparse_only');
  assert.equal(result.provider, 'bm25-sparse-only');
  assert.ok(result.evidence.every((item) => item.degraded === 'sparse_only'));
});

test('the hybrid retriever degrades to sparse-only when no embed client is configured', async () => {
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient: null, reranker: null });
  const result = await retriever.retrieve('A1C blood sugar diabetes diagnosis threshold', { topK: 3 });
  assert.equal(result.degraded, 'sparse_only');
  assert.equal(retriever.name, 'bm25-sparse-only');
});

test('the hybrid retriever degrades to sparse-only when embeddings are configured but no reranker is', async () => {
  const corpus = loadGuidelineCorpus();
  const geminiClient = createRecordedOrStubGeminiClient();
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient: geminiClient, reranker: null, corpus, embeddings: stubEmbeddingsFor(corpus) });
  const result = await retriever.retrieve('A1C blood sugar diabetes diagnosis threshold', { topK: 3 });
  assert.equal(result.degraded, 'sparse_only');
  assert.equal(retriever.name, 'bm25-sparse-only');
});

test('the hybrid retriever degrades to sparse-only, without leaking the failure detail, when the embed step throws', async () => {
  const corpus = loadGuidelineCorpus();
  const failingClient = { name: 'failing-gemini', embed: async () => { throw new Error('boom: internal host detail that must never reach a client'); }, rerank: async () => { throw new Error('unreachable'); } };
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient: failingClient, reranker: createGeminiReranker(failingClient), corpus, embeddings: stubEmbeddingsFor(corpus) });
  const result = await retriever.retrieve('A1C blood sugar diabetes diagnosis threshold', { topK: 3 });
  assert.equal(result.degraded, 'sparse_only');
  assert.equal(result.provider, 'bm25-sparse-only');
  assert.equal(JSON.stringify(result).includes('internal host detail'), false);
});

test('a reranker failure with embeddings OK fuses sparse+dense by reciprocal rank, labeled degraded: no_rerank, never a full hybrid result', async () => {
  const corpus = loadGuidelineCorpus();
  const embedOnlyClient = { name: 'embed-only-fake', async embed(text) { return { values: stubEmbedding(text), usage: { stage: 'embed', provider: 'google', model: 'fake', inputTokens: 5, outputTokens: 0, estimatedCostUsd: 0.000001 } }; } };
  const failingReranker = { name: 'failing-reranker:test', rerank: async () => { throw new Error('boom: internal rerank endpoint detail that must never reach a client'); } };
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient: embedOnlyClient, reranker: failingReranker, corpus, embeddings: stubEmbeddingsFor(corpus) });
  const result = await retriever.retrieve('A1C blood sugar diabetes diagnosis threshold', { topK: 3 });
  assert.equal(result.degraded, 'no_rerank');
  assert.equal(result.degraded_reason, 'reranker_failed');
  assert.ok(result.provider.startsWith('hybrid:'), 'a no_rerank result is still hybrid-shaped, just missing a real rerank judgment');
  assert.ok(result.evidence.length > 0 && result.evidence.length <= 3);
  for (const item of result.evidence) {
    assert.equal(parseOrIssues(GuidelineEvidence, item).ok, true);
    assert.equal(item.degraded, 'no_rerank');
  }
  assert.equal(JSON.stringify(result).includes('internal rerank endpoint detail'), false);
  // Only the embed usage is real; there is no rerank usage to report since
  // the reranker never returned one.
  assert.equal(result.usage.length, 1);
  assert.equal(result.usage[0].stage, 'embed');
});

test('a query/corpus embedding dimension mismatch degrades to sparse-only instead of silently scoring every chunk 0 and calling it hybrid', async () => {
  const corpus = loadGuidelineCorpus();
  // Corpus embeddings are 64-dimensional (stubEmbeddingsFor's default); the
  // client's query embedding here is a different size, as if the query and
  // the precomputed corpus file came from two different embedding
  // models/configurations. rerank still succeeds normally (it does not
  // depend on embedding dimensions) — the mismatch must be caught at the
  // cosine-similarity step itself, not masked by a downstream failure.
  const mismatchedClient = {
    name: 'mismatched-dimension-fake',
    async embed() { return { values: [0.1, 0.2, 0.3], usage: { stage: 'embed', provider: 'google', model: 'fake', inputTokens: 1, outputTokens: 0, estimatedCostUsd: 0 } }; },
    async rerank(query, candidates) { return { results: candidates.map((candidate, index) => ({ chunk_id: candidate.id, relevance_score: index === 0 ? 0.9 : 0.6 })), usage: { stage: 'rerank', provider: 'google', model: 'fake', inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 } }; },
  };
  const retriever = createGeminiHybridGuidelineRetriever({ embedClient: mismatchedClient, reranker: createGeminiReranker(mismatchedClient), corpus, embeddings: stubEmbeddingsFor(corpus) });
  const result = await retriever.retrieve('A1C blood sugar diabetes diagnosis threshold', { topK: 3 });
  // Without the dimension-mismatch guard, cosineSimilarity's own defensive
  // length check would silently score every dense candidate 0 (not throw),
  // so the pipeline would "successfully" complete a rerank over sparse-only
  // candidates and report a plain, ungrounded `null` (not degraded) result —
  // dense_score: 0 everywhere, never actually compared against the corpus.
  assert.equal(result.degraded, 'sparse_only');
  assert.equal(result.provider, 'bm25-sparse-only');
  assert.ok(result.evidence.every((item) => item.degraded === 'sparse_only'));
});

test('Cohere retriever embeds synthetic corpus and query, reranks, and preserves provenance', async () => {
  const calls = [];
  const retriever = createCohereGuidelineRetriever({
    apiKey: 'unit-test-key',
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      calls.push({ url, headers: options.headers, payload });
      if (url.endsWith('/v2/embed')) {
        const vectors = payload.texts.map((text) => text.toLowerCase().includes('diabetes') ? [1, 0] : [0, 1]);
        return { ok: true, json: async () => ({ embeddings: { float: vectors }, meta: { billed_units: { input_tokens: payload.texts.length } } }) };
      }
      return { ok: true, json: async () => ({ results: [{ index: 0, relevance_score: 0.98 }], meta: { billed_units: { search_units: 1 } } }) };
    },
  });
  const result = await retriever.retrieve('diabetes medication follow-up', { topK: 1 });
  assert.equal(result.status, 'complete');
  assert.equal(result.provider, 'cohere');
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].citation.source_type, 'guideline');
  assert.ok(result.evidence[0].citation.page_or_section.length > 0);
  assert.equal(parseOrIssues(GuidelineEvidence, result.evidence[0]).ok, true);
  assert.equal(calls.filter(({ url }) => url.endsWith('/v2/embed')).length, 2);
  assert.equal(calls.find(({ url }) => url.endsWith('/v2/rerank')).payload.model, 'rerank-v4.0-fast');
  assert.equal(calls.find(({ url }) => url.endsWith('/v2/rerank')).payload.query, 'synthetic diabetes follow-up documented glycemic values medication history');
  assert.ok(calls.every(({ headers }) => headers.authorization === 'Bearer unit-test-key'));
});

test('Cohere retriever requires a server-side key and sanitizes provider failures', async () => {
  assert.throws(() => createCohereGuidelineRetriever(), /COHERE_API_KEY_REQUIRED/);
  const retriever = createCohereGuidelineRetriever({ apiKey: 'unit-test-key', fetchImpl: async () => { throw new Error('secret-bearing network detail'); } });
  await assert.rejects(retriever.retrieve('diabetes follow-up'), /COHERE_REQUEST_FAILED/);
});

test('Cohere retriever does not transmit free-form unsupported user text', async () => {
  let calls = 0;
  const retriever = createCohereGuidelineRetriever({ apiKey: 'unit-test-key', fetchImpl: async () => { calls += 1; throw new Error('should not be called'); } });
  const result = await retriever.retrieve('Patient David Smith at 123 Example Street needs help with astronomy');
  assert.equal(result.status, 'qualified');
  assert.deepEqual(result.issues, ['no_approved_synthetic_query']);
  assert.equal(calls, 0);
});

test('follow-up evidence API separates patient facts from guideline evidence', async () => {
  const port = 18807;
  const child = await startTestServer(port);
  try {
    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const response = await fetch(`http://127.0.0.1:${port}/v1/follow-up-evidence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: context.demo_token, message: 'What should I review for diabetes medication follow-up?' }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.patient_facts[0].source_type, 'patient_record');
    assert.equal(body.guideline_evidence[0].citation.source_type, 'guideline');
    assert.ok(body.guideline_evidence[0].citation.page_or_section.length > 0);
  } finally {
    child.kill();
  }
});

test('follow-up evidence never leaks a retrieval failure message, only an error code', async () => {
  // A retriever that throws with sensitive detail; server.js has no env knob
  // for this, so exercise the service directly instead of over HTTP.
  const { AgentForgeService, defaultFixturePath } = await import('../src/service.js');
  const { FixtureAdapter } = await import('../src/fixtureAdapter.js');
  const failingRetriever = { name: 'failing-retriever', retrieve: async () => { throw new Error('boom: internal connection string or stack trace'); } };
  const service = new AgentForgeService({ chartAdapter: new FixtureAdapter(defaultFixturePath()), guidelineRetriever: failingRetriever, provider: { name: 'deterministic', checkReady: async () => true } });
  const { issueSignedContext, verifySignedContext } = await import('../src/accessContext.js');
  const secret = 'unit-test-secret';
  const context = verifySignedContext(issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', scope: 'read-briefing', acl: 'read', secret }), secret);
  const result = await service.retrieveFollowUpEvidence({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', case_id: 'complete_return_visit', message: 'diabetes follow-up' }, { verifiedContext: context });
  assert.deepEqual(result.retrieval.guideline_issues, ['guideline_retrieval_failed']);
  assert.equal(JSON.stringify(result).includes('boom'), false);
  assert.equal(JSON.stringify(result).includes('connection string'), false);
});
