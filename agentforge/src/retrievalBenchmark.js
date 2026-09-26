import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BENCHMARK_PATH = fileURLToPath(new URL('../test/fixtures/retrieval-benchmark.json', import.meta.url));

/**
 * Load the labeled guideline-retrieval benchmark
 * (`test/fixtures/retrieval-benchmark.json`): about 20 queries, each with the
 * corpus chunk ids a clinician would accept as a relevant answer, labeled by
 * reading `corpus/guidelines/corpus.json`. Used only by
 * `scripts/benchmark-retrieval.mjs` and tests, never by the request path.
 */
export function loadRetrievalBenchmark(path = BENCHMARK_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed?.queries) || !parsed.queries.length) throw new Error('RETRIEVAL_BENCHMARK_EMPTY');
  const sets = parsed.sets || {};
  // "$NAME" in a relevant list expands to the named shared set; an unknown
  // name throws rather than silently labeling the query with nothing.
  const expand = (id) => {
    if (!id.startsWith('$')) return [id];
    const set = sets[id.slice(1)];
    if (!Array.isArray(set)) throw new Error(`RETRIEVAL_BENCHMARK_UNKNOWN_SET:${id}`);
    return set;
  };
  const queries = parsed.queries.map((query) => ({ ...query, relevant: [...new Set(query.relevant.flatMap(expand))] }));
  return { ...parsed, queries };
}

/**
 * Recall at k with the denominator capped at k: |relevant ∩ top-k| /
 * min(k, |relevant|). Capping keeps a query with five acceptable A1C chunks
 * from being unable to exceed 0.6 when only three results are returned.
 */
export function recallAtK(ranked, relevant, k) {
  const wanted = new Set(relevant);
  if (!wanted.size) return 0;
  const hits = ranked.slice(0, k).filter((id) => wanted.has(id)).length;
  return hits / Math.min(k, wanted.size);
}

/** 1 / rank of the first relevant id within the top k, or 0 when none is there. */
export function reciprocalRankAtK(ranked, relevant, k) {
  const wanted = new Set(relevant);
  const index = ranked.slice(0, k).findIndex((id) => wanted.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
}

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

/**
 * Average recall@k, MRR@k and hit@1 over the rows a stage could actually
 * measure. A row is unmeasured when the stage would have needed a live call
 * that has no recorded fixture; it is counted, never scored as 0 and never
 * replaced by a stub result.
 */
export function summarizeStage(rows, { k = 3 } = {}) {
  const measured = rows.filter((row) => row.measured);
  return {
    measured: measured.length,
    unmeasured: rows.length - measured.length,
    [`recall_at_${k}`]: mean(measured.map((row) => recallAtK(row.ranked, row.relevant, k))),
    [`mrr_at_${k}`]: mean(measured.map((row) => reciprocalRankAtK(row.ranked, row.relevant, k))),
    hit_at_1: mean(measured.map((row) => reciprocalRankAtK(row.ranked, row.relevant, 1))),
  };
}
