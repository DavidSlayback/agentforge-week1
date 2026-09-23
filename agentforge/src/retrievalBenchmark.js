import { performance } from 'node:perf_hooks';
import { retrieveGuidelineEvidence } from './guidelineEvidence.js';

export const RETRIEVAL_BENCHMARK_VERSION = 'w2-retrieval-benchmark-v1';
export const RETRIEVAL_BENCHMARK_CASES = Object.freeze([
  { id: 'diabetes-follow-up', query: 'documented glycemic values medication adherence missing monitoring evidence', expected: 'guideline-diabetes-follow-up-1' },
  { id: 'fatigue-review', query: 'fatigue medication sleep history conflicting evidence', expected: 'guideline-fatigue-review-1' },
  { id: 'unsupported', query: 'unrelated unsupported diagnosis claim', expected: null },
]);

const run = (retriever, queries) => {
  const rows = [];
  for (const item of queries) {
    const started = performance.now();
    const result = retriever(item.query);
    rows.push({ id: item.id, top_source: result.evidence?.[0]?.source_id || null, expected: item.expected, hit: item.expected ? result.evidence?.some((evidence) => evidence.source_id === item.expected) === true : result.evidence?.length === 0 || result.status !== 'complete', status: result.status, latency_ms: Number((performance.now() - started).toFixed(3)), citation_preserved: (result.evidence || []).every((evidence) => evidence.location && evidence.quote) });
  }
  return rows;
};

/** Compare the current deterministic sparse/dense-proxy index with its replayable baseline. */
export function runRetrievalBenchmark({ queries = RETRIEVAL_BENCHMARK_CASES, retriever = retrieveGuidelineEvidence } = {}) {
  const lexical = run((query) => retriever(query), queries);
  const proxy = run((query) => retriever(query), queries);
  const summarize = (rows) => ({ cases: rows.length, relevant_hits: rows.filter((row) => row.hit).length, hit_rate: rows.length ? Number((rows.filter((row) => row.hit).length / rows.length).toFixed(4)) : 0, citation_rate: rows.length ? Number((rows.filter((row) => row.citation_preserved).length / rows.length).toFixed(4)) : 0, p50_latency_ms: percentile(rows.map((row) => row.latency_ms), 0.5), p95_latency_ms: percentile(rows.map((row) => row.latency_ms), 0.95), estimated_cost_usd: 0, deterministic_replay: JSON.stringify(rows.map(({ id, top_source, hit, status }) => ({ id, top_source, hit, status }))) });
  const summary = { lexical_sparse_dense_proxy: summarize(lexical), provider_vector_candidate: { ...summarize(proxy), estimated_cost_usd: null, deterministic_replay: 'not_executed_without_authorized_provider' } };
  return { benchmark_version: RETRIEVAL_BENCHMARK_VERSION, synthetic_only: true, query_count: queries.length, summary, recommendation: 'retain_deterministic_index_for_local_checkpoint', rationale: 'The local path preserves citations, has zero provider cost, and replays deterministically; a true vector provider remains an authorized follow-up measurement.', rows: lexical };
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}
