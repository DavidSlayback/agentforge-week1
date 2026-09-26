import assert from 'node:assert/strict';
import test from 'node:test';
import { RETRIEVAL_QUERY_EXPANSIONS } from '../src/clinicalVocabulary.js';
import { contextualChunkText, queryExpansionTerms } from '../src/retrievalContext.js';

const CHUNK = Object.freeze({ source_id: 'x', publisher: 'CDC', title: 'A1C Test for Diabetes and Prediabetes', section: 'A1C Ranges', text: 'Normal: below 5.7%' });

test('contextualChunkText prepends publisher, title and section to the verbatim chunk text', () => {
  const text = contextualChunkText(CHUNK);
  assert.equal(text, 'CDC | A1C Test for Diabetes and Prediabetes | A1C Ranges\nNormal: below 5.7%');
  assert.ok(text.endsWith(CHUNK.text), 'the chunk text itself is unchanged');
});

test('queryExpansionTerms maps a test name to its condition terms, including through synonyms', () => {
  for (const query of ['Abnormal findings: A1C test result abnormal.', 'Hemoglobin A1C high', 'glycated hemoglobin elevated', 'HbA1c 7.2']) {
    const terms = queryExpansionTerms(query);
    assert.ok(terms.includes('diabetes'), `${query} -> diabetes`);
    assert.ok(terms.includes('glucose'), `${query} -> glucose`);
    assert.ok(!terms.includes('anemia'), `${query} is an A1C finding, not a hemoglobin (anemia) finding`);
  }
  assert.ok(queryExpansionTerms('Hemoglobin test result low').includes('anemia'));
  assert.ok(queryExpansionTerms('hgb low').includes('anemia'), 'hgb is a hemoglobin synonym');
  assert.ok(queryExpansionTerms('low eGFR').includes('kidney'));
  assert.deepEqual(queryExpansionTerms('quasar galaxies nebula astronomy'), []);
  assert.deepEqual(queryExpansionTerms(''), []);
});

test('queryExpansionTerms skips a test whose condition the query already names', () => {
  assert.deepEqual(queryExpansionTerms('A1C blood sugar diabetes diagnosis threshold'), [], 'already about diabetes');
  assert.deepEqual(queryExpansionTerms('What A1C percentage counts as prediabetes versus diabetes?'), []);
  const mixed = queryExpansionTerms('Hemoglobin test result low, A1C test result high. A1C blood sugar diabetes diagnosis threshold');
  assert.ok(mixed.includes('anemia'), 'the hemoglobin finding still expands');
  assert.ok(!mixed.includes('prediabetes'), 'the A1C finding does not, since diabetes is named');
});

test('queryExpansionTerms is deterministic and never passes query text through', () => {
  const allowed = new Set(Object.values(RETRIEVAL_QUERY_EXPANSIONS).flatMap((group) => group.terms));
  const phiLike = 'Test Patient One DOB 1980-04-12 phone 555-0100 lives at 12 Main St, A1C 7.2% hemoglobin 9.1';
  const first = queryExpansionTerms(phiLike);
  assert.deepEqual(queryExpansionTerms(phiLike), first);
  assert.ok(first.length, 'the lab names still expand');
  for (const term of first) assert.ok(allowed.has(term), `${term} comes from the fixed expansion vocabulary`);
  for (const leaked of ['test patient', 'patient', 'one', '1980', '555', 'main', '7.2', '9.1']) assert.ok(!first.join(' ').toLowerCase().split(' ').includes(leaked), `${leaked} must not appear in the expansion`);
});

test('every expansion word is a token the guideline corpus actually contains', async () => {
  const { loadGuidelineCorpus } = await import('../src/guidelineEvidence.js');
  const { tokenize } = await import('../src/bm25.js');
  const corpusTokens = new Set(loadGuidelineCorpus().flatMap((chunk) => tokenize(`${chunk.title} ${chunk.section} ${chunk.text}`)));
  for (const [test, group] of Object.entries(RETRIEVAL_QUERY_EXPANSIONS)) {
    for (const term of [...group.terms, ...group.unlessQueryHas]) assert.ok(corpusTokens.has(term), `${test} -> ${term} is not a corpus token`);
  }
});

test('sparse-only retrieval uses the expansion: "hgb low" ranks an anemia chunk first only with it on', async () => {
  const { retrieveGuidelineEvidence } = await import('../src/guidelineEvidence.js');
  const top = (contextualRetrieval) => retrieveGuidelineEvidence('hgb low, tired and pale', { topK: 3, contextualRetrieval }).evidence[0].citation.source_id;
  const anemia = ['medlineplus-cbc-hemoglobin-anemia', 'nhlbi-anemia-fatigue-symptoms', 'nhlbi-anemia-definition'];
  assert.ok(anemia.includes(top(undefined)));
  assert.ok(!anemia.includes(top({ queryExpansion: false })));
});

test('the hybrid retriever sends the same text to embed and rerank, and the same rerank pool, with expansion on or off', async () => {
  const { createGeminiHybridGuidelineRetriever, loadGuidelineCorpus } = await import('../src/guidelineEvidence.js');
  const { stubEmbedding } = await import('../src/geminiClient.js');
  const corpus = loadGuidelineCorpus();
  const embeddings = { vectors: Object.fromEntries(corpus.map((chunk) => [chunk.source_id, stubEmbedding(`${chunk.title}\n${chunk.section}\n${chunk.text}`)])) };
  const capture = async (contextualRetrieval) => {
    const calls = { embed: [], rerank: [] };
    const embedClient = { name: 'capture', model: 'capture', async embed(text) { calls.embed.push(text); return { values: stubEmbedding(text), usage: { source: 'recorded' } }; } };
    const reranker = { name: 'capture', async rerank(query, candidates) { calls.rerank.push({ query, candidates }); return { results: candidates.map((candidate, index) => ({ id: candidate.id, score: 1 - index / 100 })), usage: { source: 'recorded' } }; } };
    await createGeminiHybridGuidelineRetriever({ embedClient, reranker, corpus, embeddings, contextualRetrieval }).retrieve('Abnormal findings: Hemoglobin test result low, A1C test result high. hgb', { topK: 3 });
    return calls;
  };
  const on = await capture(undefined);
  const off = await capture({ queryExpansion: false });
  assert.deepEqual(on, off);
  assert.ok(!on.embed[0].includes('anemia'), 'no expansion word leaves the process');
});

test('retrievalIssues flags the wrong mode, an irrelevant top chunk and a finding with no guideline', async () => {
  const { retrievalIssues } = await import('../src/extensionCases/retrieval.js');
  const evidence = (ids, degraded = 'sparse_only', status = 'ready') => ({ output_status: status, degraded, guideline_evidence: ids.map((id) => ({ citation: { source_id: id } })) });
  assert.deepEqual(retrievalIssues(evidence(['a', 'b', 'c']), { degraded: 'sparse_only', topOneOf: ['a'], topThreeIncludes: [['a'], ['c']] }), []);
  assert.deepEqual(retrievalIssues(evidence(['x', 'b', 'c']), { degraded: 'sparse_only', topOneOf: ['a'] }), ['top_guideline_not_relevant']);
  assert.deepEqual(retrievalIssues(evidence(['a', 'b', 'c', 'd']), { degraded: 'sparse_only', topThreeIncludes: [['a'], ['d']] }), ['finding_1_has_no_guideline_in_top_3']);
  assert.deepEqual(retrievalIssues(evidence(['a'], null), { degraded: 'sparse_only' }), ['retrieval_mode_null_expected_sparse_only']);
  assert.deepEqual(retrievalIssues(evidence([], 'sparse_only', 'qualified'), { degraded: 'sparse_only' }), ['evidence_status_qualified', 'no_guideline_evidence']);
  assert.deepEqual(retrievalIssues(undefined, { degraded: 'sparse_only' }), ['evidence_worker_did_not_run']);
});
