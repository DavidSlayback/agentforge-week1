#!/usr/bin/env node
// Offline guideline-retrieval benchmark (E3 / X-5).
//
//   node agentforge/scripts/benchmark-retrieval.mjs [--json] [--verbose]
//
// Runs every labeled query in test/fixtures/retrieval-benchmark.json through
// the retrieval stages that can be measured without a live API call, and
// reports recall@3 (denominator capped at min(3, |relevant|)), MRR@3 and
// hit@1 per stage. It makes no network call and needs no key.
//
// Stages and what each number covers:
//   sparse_bm25      BM25 over the real corpus: the `local-lexical` provider
//                    and the hybrid retriever's `sparse_only` degraded mode.
//                    Every query is measured.
//   rerank_pool      Recall@12 of the fused BM25 + real Gemini dense pool the
//                    reranker sees. Measured only for queries whose query
//                    embedding was recorded (the W2 gate queries); the corpus
//                    vectors are the real corpus/embeddings.json.
//   rrf_no_rerank    Top 3 of that pool by reciprocal-rank fusion: the
//                    hybrid retriever's `no_rerank` degraded mode. Same
//                    queries as rerank_pool.
//   hybrid_recorded  The full deployed pipeline (BM25 + dense + Qwen rerank +
//                    0.5 threshold), measured only when BOTH the embed and
//                    the rerank call for that exact request were recorded.
//                    A query whose rerank pool has no recorded response is
//                    counted as unmeasured, never scored from the stub.
//
// Each stage runs once per configuration (guidelineEvidence.js
// DEFAULT_CONTEXTUAL_RETRIEVAL): `off` (no contextual change), `headers`
// (contextual chunk headers only; measured, not kept) and `on` (the deployed
// default: weighted query expansion). Read-only: writes nothing.
import { createRecordedOrStubGeminiClient, readRetrievalFixtureManifest } from '../src/geminiClient.js';
import { corpusEmbeddingsFingerprint, createGeminiHybridGuidelineRetriever, loadCorpusEmbeddings, loadGuidelineCorpus, retrieveGuidelineEvidence } from '../src/guidelineEvidence.js';
import { configuredRerankProviderAndModel, createRecordedOrStubReranker } from '../src/reranker.js';
import { loadRetrievalBenchmark, summarizeStage } from '../src/retrievalBenchmark.js';

const asJson = process.argv.includes('--json');
const verbose = process.argv.includes('--verbose');

const benchmark = loadRetrievalBenchmark();
const corpus = loadGuidelineCorpus();
const realEmbeddings = loadCorpusEmbeddings();
const manifest = readRetrievalFixtureManifest();
const { providerLabel, model: rerankModel } = configuredRerankProviderAndModel();
// Same rule as the gate (w2RegressionGate.js): use the real corpus vectors
// only when the recorded fixtures were made against exactly these vectors and
// this reranker; otherwise the dense stages are skipped, not stubbed.
const denseAvailable = Boolean(realEmbeddings && manifest?.embeddings_fingerprint === corpusEmbeddingsFingerprint(realEmbeddings) && manifest?.rerank_provider === providerLabel && manifest?.rerank_model === rerankModel);

const CONFIGURATIONS = Object.freeze({
  off: { chunkHeaders: false, queryExpansion: false },
  headers: { chunkHeaders: true, queryExpansion: false },
  on: undefined,
});

const ids = (result) => (result?.evidence || []).map((item) => item.citation.source_id);

function capturingReranker(inner) {
  const reranker = {
    name: inner.name,
    lastPool: [],
    async rerank(query, candidates, options) {
      reranker.lastPool = candidates.map((candidate) => candidate.id);
      return inner.rerank(query, candidates, options);
    },
  };
  return reranker;
}

const failingReranker = { name: 'benchmark-failing-reranker', async rerank() { throw new Error('BENCHMARK_RERANK_DISABLED'); } };

async function runConfiguration(contextualRetrieval) {
  const rows = { sparse_bm25: [], rerank_pool: [], rrf_no_rerank: [], hybrid_recorded: [] };
  const embedClient = createRecordedOrStubGeminiClient();
  const reranker = capturingReranker(createRecordedOrStubReranker({ provider: providerLabel, model: rerankModel }));
  const hybrid = denseAvailable ? createGeminiHybridGuidelineRetriever({ embedClient, reranker, corpus, embeddings: realEmbeddings, contextualRetrieval }) : null;
  const noRerank = denseAvailable ? createGeminiHybridGuidelineRetriever({ embedClient, reranker: failingReranker, corpus, embeddings: realEmbeddings, contextualRetrieval }) : null;
  for (const item of benchmark.queries) {
    const base = { id: item.id, relevant: item.relevant };
    const sparse = retrieveGuidelineEvidence(item.query, { topK: 3, corpus, contextualRetrieval });
    rows.sparse_bm25.push({ ...base, measured: true, ranked: ids(sparse) });
    if (!hybrid) {
      for (const stage of ['rerank_pool', 'rrf_no_rerank', 'hybrid_recorded']) rows[stage].push({ ...base, measured: false, ranked: [], reason: 'dense_unavailable' });
      continue;
    }
    reranker.lastPool = [];
    const full = await hybrid.retrieve(item.query, { topK: 3 });
    const embedRecorded = full.usage?.[0]?.source === 'recorded';
    const rerankRecorded = full.usage?.[1]?.source === 'recorded';
    rows.rerank_pool.push({ ...base, measured: embedRecorded, ranked: embedRecorded ? reranker.lastPool : [], reason: embedRecorded ? null : 'embed_not_recorded' });
    rows.hybrid_recorded.push({ ...base, measured: embedRecorded && rerankRecorded && full.degraded === null, ranked: ids(full), reason: !embedRecorded ? 'embed_not_recorded' : (!rerankRecorded ? 'rerank_pool_not_recorded' : null) });
    const fused = await noRerank.retrieve(item.query, { topK: 3 });
    const fusedMeasured = fused.degraded === 'no_rerank' && fused.usage?.[0]?.source === 'recorded';
    rows.rrf_no_rerank.push({ ...base, measured: fusedMeasured, ranked: fusedMeasured ? ids(fused) : [], reason: fusedMeasured ? null : 'embed_not_recorded' });
  }
  return {
    rows,
    summary: {
      sparse_bm25: summarizeStage(rows.sparse_bm25, { k: 3 }),
      rerank_pool: summarizeStage(rows.rerank_pool, { k: 12 }),
      rrf_no_rerank: summarizeStage(rows.rrf_no_rerank, { k: 3 }),
      hybrid_recorded: summarizeStage(rows.hybrid_recorded, { k: 3 }),
    },
  };
}

const results = {};
for (const [name, contextualRetrieval] of Object.entries(CONFIGURATIONS)) results[name] = await runConfiguration(contextualRetrieval);

const report = {
  schema_version: 'agentforge-retrieval-benchmark-report-v1',
  queries: benchmark.queries.length,
  dense_available: denseAvailable,
  rerank: `${providerLabel}:${rerankModel}`,
  configurations: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.summary])),
};

if (asJson) {
  if (verbose) report.rows = Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.rows]));
  console.log(JSON.stringify(report, null, 2));
} else {
  const fmt = (value) => (value === null ? '   n/a' : value.toFixed(3).padStart(6));
  console.log(`Retrieval benchmark: ${report.queries} labeled queries; dense stages ${denseAvailable ? `use real recorded fixtures (${report.rerank})` : 'SKIPPED (no matching recorded fixtures)'}`);
  console.log('config  stage            measured  recall@k   MRR@k   hit@1');
  for (const [name, summary] of Object.entries(report.configurations)) {
    for (const [stage, metrics] of Object.entries(summary)) {
      const k = stage === 'rerank_pool' ? 12 : 3;
      console.log(`${name.padEnd(7)} ${stage.padEnd(16)} ${String(metrics.measured).padStart(3)}/${String(metrics.measured + metrics.unmeasured).padEnd(4)}  ${fmt(metrics[`recall_at_${k}`])}  ${fmt(metrics[`mrr_at_${k}`])}  ${fmt(metrics.hit_at_1)}`);
    }
  }
  if (verbose) {
    for (const [name, result] of Object.entries(results)) {
      console.log(`\n[${name}] per query (sparse_bm25 top 3 | hybrid_recorded top 3)`);
      for (const [index, row] of result.rows.sparse_bm25.entries()) {
        const hybridRow = result.rows.hybrid_recorded[index];
        const mark = (list, relevant) => list.map((id) => (relevant.includes(id) ? `*${id}` : id)).join(', ');
        console.log(`  ${row.id}: ${mark(row.ranked, row.relevant)} | ${hybridRow.measured ? mark(hybridRow.ranked, row.relevant) : `(${hybridRow.reason})`}`);
      }
    }
  }
}
