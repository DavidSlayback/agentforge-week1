import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveGeminiClient, createRecordedOrStubGeminiClient, responseText, rerankFixtureHash } from '../src/geminiClient.js';

test('live client embed prefixes text per the documented task convention and never sends taskType', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }) };
  };
  const client = createLiveGeminiClient({ apiKey: 'k', fetchImpl: fakeFetch });
  await client.embed('elevated A1C', 'RETRIEVAL_QUERY');
  await client.embed('A1C is a blood test', 'RETRIEVAL_DOCUMENT', { title: 'A1C Test' });
  assert.equal(calls[0].body.content.parts[0].text, 'task: search result | query: elevated A1C');
  assert.equal(calls[1].body.content.parts[0].text, 'title: A1C Test | text: A1C is a blood test');
  for (const call of calls) {
    assert.equal('taskType' in call.body, false, 'gemini-embedding-2 ignores taskType and must not be sent it');
    assert.match(call.url, /gemini-embedding-2:embedContent$/);
  }
});

test('live client embed accepts both the singular embedding.values and the embeddings[].values response shapes', async () => {
  const singular = createLiveGeminiClient({ apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ embedding: { values: [1, 2] } }) }) });
  assert.deepEqual((await singular.embed('x', 'RETRIEVAL_QUERY')).values, [1, 2]);
  const plural = createLiveGeminiClient({ apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ embeddings: [{ values: [3, 4] }] }) }) });
  assert.deepEqual((await plural.embed('x', 'RETRIEVAL_QUERY')).values, [3, 4]);
});

test('live client rerank sends store: false and parses a steps[]-shaped interactions response', async () => {
  let sentBody = null;
  const fakeFetch = async (url, options) => {
    sentBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        steps: [{ type: 'text', text: JSON.stringify({ results: [{ chunk_id: 'a', relevance_score: 0.9 }] }) }],
        usage: { total_input_tokens: 123, total_output_tokens: 45 },
      }),
    };
  };
  const client = createLiveGeminiClient({ apiKey: 'k', fetchImpl: fakeFetch });
  const { results, usage } = await client.rerank('q', [{ id: 'a', text: 'chunk a' }]);
  assert.equal(sentBody.store, false);
  assert.deepEqual(results, [{ chunk_id: 'a', relevance_score: 0.9 }]);
  assert.equal(usage.inputTokens, 123);
  assert.equal(usage.outputTokens, 45);
  assert.equal(usage.tokens_estimated, false);
});

test('responseText reads the documented steps[] shape, the content-array step shape, and falls back to the legacy output shape', () => {
  assert.equal(responseText({ steps: [{ type: 'text', text: 'from-steps-direct' }] }), 'from-steps-direct');
  assert.equal(responseText({ steps: [{ content: [{ type: 'text', text: 'from-steps-content' }] }] }), 'from-steps-content');
  assert.equal(responseText({ output: [{ content: [{ type: 'text', text: 'from-legacy-output' }] }] }), 'from-legacy-output');
  assert.equal(responseText({ output_text: 'from-output-text' }), 'from-output-text');
  assert.equal(responseText({}), '');
});

test('rerankFixtureHash is stable across candidate-set reordering (order is not part of the request identity)', () => {
  const candidatesA = [{ id: 'x', text: 'X' }, { id: 'y', text: 'Y' }];
  const candidatesB = [{ id: 'y', text: 'Y' }, { id: 'x', text: 'X' }];
  assert.equal(rerankFixtureHash({ model: 'm', query: 'q', candidates: candidatesA }), rerankFixtureHash({ model: 'm', query: 'q', candidates: candidatesB }));
});

test('the recorded-or-stub client never claims google/the real model when it falls back to the stub', async () => {
  const client = createRecordedOrStubGeminiClient({ fixturesDir: 'C:/nonexistent-fixtures-dir-for-this-test' });
  const embedResult = await client.embed('some query text', 'RETRIEVAL_QUERY');
  assert.equal(embedResult.usage.provider, 'stub');
  assert.notEqual(embedResult.usage.model, 'gemini-embedding-2');
  assert.equal(embedResult.usage.source, 'stub');
  const rerankResult = await client.rerank('q', [{ id: 'a', text: 'a text' }]);
  assert.equal(rerankResult.usage.provider, 'stub');
  assert.notEqual(rerankResult.usage.model, 'gemini-3.8-flash');
  assert.equal(rerankResult.usage.source, 'stub');
});
