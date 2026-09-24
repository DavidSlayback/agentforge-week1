import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBm25Index } from './bm25.js';

const CORPUS_PATH = fileURLToPath(new URL('../corpus/guidelines/corpus.json', import.meta.url));
const EMBEDDINGS_PATH = fileURLToPath(new URL('../corpus/embeddings.json', import.meta.url));

let corpusCache = null;

/**
 * Load the real guideline corpus (`corpus/guidelines/corpus.json`) — 20-60
 * chunks of verbatim public-domain U.S. government guideline text, each with
 * `{source_id, title, publisher, url, section, version_or_date, retrieved_at,
 * text}` (see `corpus/guidelines/README.md`). Throws rather than silently
 * falling back to an empty or synthetic corpus, since a caller that treats a
 * missing corpus as "zero evidence" would misreport a config error as a
 * legitimate "no relevant guideline" result.
 */
export function loadGuidelineCorpus(path = CORPUS_PATH) {
  if (corpusCache && path === CORPUS_PATH) return corpusCache;
  if (!existsSync(path)) throw new Error('GUIDELINE_CORPUS_MISSING');
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('GUIDELINE_CORPUS_EMPTY');
  const chunks = Object.freeze(parsed.map((chunk) => Object.freeze({ ...chunk })));
  if (path === CORPUS_PATH) corpusCache = chunks;
  return chunks;
}

/**
 * Load precomputed corpus embeddings (`corpus/embeddings.json`), built
 * offline by `scripts/build-corpus-embeddings.mjs` against a real
 * `GEMINI_API_KEY` (this process never calls the embedding API for the
 * corpus itself, only for the query at request time). Returns `null` when
 * the file is missing, unreadable, or carries no vectors — the caller must
 * treat that as "dense retrieval unavailable", not throw, since an absent
 * embeddings file is an expected, recoverable degraded-mode trigger, not a
 * configuration error.
 */
export function loadCorpusEmbeddings(path = EMBEDDINGS_PATH) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.vectors || !Object.keys(parsed.vectors).length) return null;
    return parsed;
  } catch {
    return null;
  }
}

const chunkText = (chunk) => `${chunk.title}\n${chunk.section}\n${chunk.text}`;

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

/**
 * Build one `GuidelineEvidence` item (schemas.js) from a corpus chunk and its
 * retrieval scores. `citation.source_id`/`citation.field_or_chunk_id` are
 * both the chunk id (today's corpus has one chunk per `source_id`);
 * `citation.quote_or_value` is the verbatim chunk text, never a
 * reconstruction or summary.
 */
function guidelineEvidenceItem(chunk, { sparseScore, denseScore, rerankScore, matchedTerms, degraded }) {
  return {
    title: chunk.title,
    section: chunk.section,
    version: chunk.version_or_date,
    url: chunk.url,
    publisher: chunk.publisher,
    snippet: chunk.text,
    sparse_score: Number(sparseScore.toFixed(6)),
    dense_score: Number(denseScore.toFixed(6)),
    rerank_score: Number(rerankScore.toFixed(6)),
    matched_terms: matchedTerms,
    degraded: degraded ?? null,
    citation: { source_type: 'guideline', source_id: chunk.source_id, page_or_section: chunk.section, field_or_chunk_id: chunk.source_id, quote_or_value: chunk.text },
  };
}

const SPARSE_ONLY_PROVIDER = 'bm25-sparse-only';

/**
 * Real BM25 (Okapi, IDF + k1/b) over the corpus — sparse-only. This is also
 * the fallback every hybrid retriever below degrades to, so its provider
 * name (`bm25-sparse-only`) and `degraded: 'sparse_only'` marker are shared
 * with the degraded-mode path: a sparse-only result looks the same whether
 * it came from an explicit sparse-only configuration or from a hybrid
 * pipeline that could not reach Gemini.
 */
export function retrieveGuidelineEvidence(query, { topK = 3, corpus = loadGuidelineCorpus() } = {}) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return { status: 'qualified', provider: SPARSE_ONLY_PROVIDER, query: '', evidence: [], issues: ['empty_query'], degraded: 'sparse_only' };
  const index = buildBm25Index(corpus, { getText: chunkText });
  const ranked = index.search(trimmed, { topK: Math.max(topK, 1) });
  if (!ranked.length) return { status: 'qualified', provider: SPARSE_ONLY_PROVIDER, query: trimmed, evidence: [], issues: ['insufficient_guideline_evidence'], degraded: 'sparse_only' };
  const evidence = ranked.slice(0, topK).map(({ document, score, matchedTerms }) => guidelineEvidenceItem(document, { sparseScore: score, denseScore: 0, rerankScore: score, matchedTerms, degraded: 'sparse_only' }));
  return { status: 'complete', provider: SPARSE_ONLY_PROVIDER, query: trimmed, evidence, issues: [], degraded: 'sparse_only' };
}

/**
 * Named default retriever: real BM25 over the real corpus, sparse-only. Used
 * whenever no retriever is injected (`AGENTFORGE_RAG_PROVIDER=local-lexical`,
 * and as the hard-wired default the scan supervisor and service fall back to
 * when a caller omits `guidelineRetriever`/`retrievalAdapter` entirely).
 */
export const localLexicalGuidelineRetriever = Object.freeze({ name: SPARSE_ONLY_PROVIDER, retrieve: retrieveGuidelineEvidence });

/**
 * Build the real hybrid retriever: BM25 top-K ∪ Gemini dense cosine top-K →
 * Gemini listwise rerank → top-`topK` at or above `rerankThreshold`.
 *
 * Degrades to BM25-only (`degraded: 'sparse_only'` on every returned item
 * and on the response) whenever corpus embeddings are unavailable, no
 * `geminiClient` was supplied, or any Gemini call throws — never silently
 * relabeled as hybrid (AGENTS.md). The response's `provider` and each
 * evidence item's `degraded` field always reflect the mode that actually
 * produced that response, not the retriever's static configuration.
 *
 * Args:
 *   geminiClient: `{name, embed(text, taskType), rerank(query, candidates)}`
 *     — either `createLiveGeminiClient` (production) or
 *     `createRecordedOrStubGeminiClient` (tests/gate). `null`/`undefined`
 *     forces sparse-only.
 *   corpus: Guideline chunks (defaults to the real corpus file).
 *   embeddings: `{vectors: {[source_id]: number[]}}` (defaults to the real
 *     precomputed file, or `null` if absent).
 *   candidateCount: How many sparse and dense candidates to union before
 *     reranking (assignment: top 20 each).
 *   rerankThreshold: Minimum rerank relevance score to keep a chunk.
 */
export function createGeminiHybridGuidelineRetriever({
  geminiClient = null,
  corpus = loadGuidelineCorpus(),
  embeddings = loadCorpusEmbeddings(),
  candidateCount = 20,
  rerankThreshold = 0.5,
} = {}) {
  const bm25 = buildBm25Index(corpus, { getText: chunkText });
  const embeddingsUsable = Boolean(embeddings?.vectors && Object.keys(embeddings.vectors).length);
  const hybridProvider = `gemini-hybrid:${geminiClient?.name || 'unconfigured'}`;

  function sparseOnly(query, topK, issue) {
    const ranked = bm25.search(query, { topK: Math.max(topK, 1) });
    const evidence = ranked.slice(0, topK).map(({ document, score, matchedTerms }) => guidelineEvidenceItem(document, { sparseScore: score, denseScore: 0, rerankScore: score, matchedTerms, degraded: 'sparse_only' }));
    return {
      status: evidence.length ? 'complete' : 'qualified',
      provider: SPARSE_ONLY_PROVIDER,
      query,
      evidence,
      issues: evidence.length ? [] : ['insufficient_guideline_evidence'],
      degraded: 'sparse_only',
      degraded_reason: issue,
      usage: [],
    };
  }

  async function retrieve(query, { topK = 3 } = {}) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return { status: 'qualified', provider: geminiClient ? hybridProvider : SPARSE_ONLY_PROVIDER, query: '', evidence: [], issues: ['empty_query'], degraded: geminiClient ? null : 'sparse_only', usage: [] };
    if (!geminiClient) return sparseOnly(trimmed, topK, 'gemini_client_not_configured');
    if (!embeddingsUsable) return sparseOnly(trimmed, topK, 'corpus_embeddings_missing');

    try {
      const sparseCandidates = bm25.search(trimmed, { topK: candidateCount });
      const { values: queryVector, usage: embedUsage } = await geminiClient.embed(trimmed, 'RETRIEVAL_QUERY');
      const denseScored = corpus
        .map((document) => ({ document, score: cosineSimilarity(queryVector, embeddings.vectors[document.source_id]) }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score);
      const denseCandidates = denseScored.slice(0, candidateCount);

      const byId = new Map();
      for (const candidate of sparseCandidates) byId.set(candidate.document.source_id, { document: candidate.document, sparseScore: candidate.score, denseScore: 0, matchedTerms: candidate.matchedTerms });
      for (const candidate of denseCandidates) {
        const existing = byId.get(candidate.document.source_id);
        if (existing) existing.denseScore = candidate.score;
        else byId.set(candidate.document.source_id, { document: candidate.document, sparseScore: 0, denseScore: candidate.score, matchedTerms: [] });
      }
      const candidates = [...byId.values()];
      if (!candidates.length) return { status: 'qualified', provider: hybridProvider, query: trimmed, evidence: [], issues: ['insufficient_guideline_evidence'], degraded: null, usage: [embedUsage] };

      const { results, usage: rerankUsage } = await geminiClient.rerank(trimmed, candidates.map((candidate) => ({ id: candidate.document.source_id, text: chunkText(candidate.document) })));
      const scoreById = new Map(results.map((result) => [result.chunk_id, result.relevance_score]));
      const ranked = candidates
        .filter((candidate) => scoreById.has(candidate.document.source_id))
        .map((candidate) => ({ ...candidate, rerankScore: scoreById.get(candidate.document.source_id) }))
        .sort((left, right) => right.rerankScore - left.rerankScore)
        .filter((candidate) => candidate.rerankScore >= rerankThreshold)
        .slice(0, topK);

      const evidence = ranked.map((candidate) => guidelineEvidenceItem(candidate.document, { sparseScore: candidate.sparseScore, denseScore: candidate.denseScore, rerankScore: candidate.rerankScore, matchedTerms: candidate.matchedTerms, degraded: null }));
      return {
        status: evidence.length ? 'complete' : 'qualified',
        provider: hybridProvider,
        query: trimmed,
        evidence,
        issues: evidence.length ? [] : ['insufficient_guideline_evidence'],
        degraded: null,
        usage: [embedUsage, rerankUsage],
      };
    } catch {
      // A fixed code only, never the caught error's message: it may carry
      // upstream HTTP/network detail that must not reach a trace or an API
      // response (matches service.js's retrieveFollowUpEvidence).
      return sparseOnly(trimmed, topK, 'gemini_hybrid_failed');
    }
  }

  return Object.freeze({ name: geminiClient ? hybridProvider : SPARSE_ONLY_PROVIDER, retrieve });
}

function documentText(document) {
  return `${document.title}\n${document.section}\n${document.text}`;
}

function canonicalSyntheticQuery(value) {
  const tokens = new Set(String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (['diabetes', 'glycemic', 'glucose'].some((token) => tokens.has(token))) return 'synthetic diabetes follow-up documented glycemic values medication history';
  if (['fatigue', 'sleep', 'tiredness'].some((token) => tokens.has(token))) return 'synthetic fatigue review documented symptoms medication context sleep history';
  if (['medication', 'medications', 'reconciliation'].some((token) => tokens.has(token))) return 'synthetic medication reconciliation current documented list prior records';
  return '';
}

/**
 * Cohere Embed + Rerank retriever (D2 in `docs/agentforge/PLAN.md`),
 * superseded for the deployed default by the Gemini hybrid retriever above
 * (D2′) but kept behind the same `{name, retrieve}` interface for a later
 * revisit. Restricted to a fixed set of canonical synthetic queries — it
 * predates the real corpus and real query formulation and must not be
 * pointed at real patient-derived queries or the real guideline corpus.
 *
 * Args:
 *   apiKey: Server-only Cohere API key.
 *   fetchImpl: Fetch-compatible function, injectable for deterministic tests.
 *   baseUrl: Cohere API base URL.
 *   embedModel: Cohere Embed model identifier.
 *   rerankModel: Cohere Rerank model identifier.
 *   timeoutMs: Per-request timeout in milliseconds.
 *
 * Returns:
 *   An async retriever that merges sparse and cosine candidates before Cohere
 *   reranking. Call only with synthetic queries and the static synthetic corpus.
 */
export function createCohereGuidelineRetriever({
  apiKey,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.cohere.com',
  embedModel = 'embed-v4.0',
  rerankModel = 'rerank-v4.0-fast',
  timeoutMs = 8000,
  candidateCount = 8,
  corpus = SYNTHETIC_COHERE_CORPUS,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('COHERE_API_KEY_REQUIRED');
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');
  let corpusEmbeddingPromise;

  async function post(endpoint, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${endpoint}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-client-name': 'AgentForge' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`COHERE_HTTP_${response.status}`);
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('COHERE_REQUEST_TIMEOUT');
      if (error?.message?.startsWith('COHERE_HTTP_')) throw error;
      throw new Error('COHERE_REQUEST_FAILED');
    } finally {
      clearTimeout(timer);
    }
  }

  async function embed(texts, inputType) {
    const response = await post('/v2/embed', { model: embedModel, texts, input_type: inputType, embedding_types: ['float'] });
    const vectors = response?.embeddings?.float;
    if (!Array.isArray(vectors) || vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector) || !vector.every(Number.isFinite))) {
      throw new Error('COHERE_EMBED_RESPONSE_INVALID');
    }
    return { vectors, billedUnits: response?.meta?.billed_units || null };
  }

  async function retrieve(query, { topK = 3 } = {}) {
    const userQuery = String(query || '').trim();
    const normalizedQuery = canonicalSyntheticQuery(userQuery);
    if (!normalizedQuery) return { status: 'qualified', provider: 'cohere', query: '', evidence: [], issues: ['no_approved_synthetic_query'], degraded: null };
    const texts = corpus.map(documentText);
    corpusEmbeddingPromise ||= embed(texts, 'search_document');
    const [corpusEmbeddings, queryEmbedding] = await Promise.all([
      corpusEmbeddingPromise,
      embed([normalizedQuery], 'search_query'),
    ]);
    const queryTokens = new Set(normalizedQuery.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const ranked = corpus.map((document, index) => {
      const textTokens = new Set(texts[index].toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      const matchedTerms = [...queryTokens].filter((token) => textTokens.has(token));
      return {
        document,
        denseScore: cosineSimilarity(queryEmbedding.vectors[0], corpusEmbeddings.vectors[index]),
        sparseScore: matchedTerms.length,
        matchedTerms,
      };
    });
    const sparseCandidates = [...ranked].sort((left, right) => right.sparseScore - left.sparseScore || left.document.id.localeCompare(right.document.id)).slice(0, candidateCount);
    const denseCandidates = [...ranked].sort((left, right) => right.denseScore - left.denseScore || left.document.id.localeCompare(right.document.id)).slice(0, candidateCount);
    const candidatesById = new Map([...sparseCandidates, ...denseCandidates].map((candidate) => [candidate.document.id, candidate]));
    const candidates = [...candidatesById.values()];
    if (!candidates.length) return { status: 'qualified', provider: 'cohere', query: normalizedQuery, evidence: [], issues: ['insufficient_guideline_evidence'], degraded: null };
    const rerank = await post('/v2/rerank', {
      model: rerankModel,
      query: normalizedQuery,
      documents: candidates.map(({ document }) => documentText(document)),
      top_n: Math.min(Math.max(1, topK), candidates.length),
    });
    if (!Array.isArray(rerank?.results)) throw new Error('COHERE_RERANK_RESPONSE_INVALID');
    const evidence = rerank.results.flatMap((result) => {
      const candidate = candidates[result.index];
      if (!candidate || !Number.isFinite(result.relevance_score)) return [];
      return [{
        title: candidate.document.title,
        section: candidate.document.section,
        version: candidate.document.version,
        url: candidate.document.uri,
        publisher: 'synthetic-placeholder',
        snippet: candidate.document.text,
        sparse_score: candidate.sparseScore,
        dense_score: Number(candidate.denseScore.toFixed(6)),
        rerank_score: Number(result.relevance_score.toFixed(6)),
        matched_terms: candidate.matchedTerms,
        degraded: null,
        citation: { source_type: 'guideline', source_id: candidate.document.id, page_or_section: candidate.document.section, field_or_chunk_id: candidate.document.id, quote_or_value: candidate.document.text },
      }];
    });
    return {
      status: evidence.length ? 'complete' : 'qualified',
      provider: 'cohere',
      query: normalizedQuery,
      evidence,
      issues: evidence.length ? [] : ['insufficient_guideline_evidence'],
      degraded: null,
      usage: { embed_billed_units: [corpusEmbeddings.billedUnits, queryEmbedding.billedUnits], rerank_billed_units: rerank.meta?.billed_units || null },
    };
  }

  return Object.freeze({ name: 'cohere-embed-rerank', retrieve });
}

/**
 * The Cohere lane's own tiny corpus. This is a **synthetic fixture**, named
 * as such (never `GUIDELINE_CORPUS`, never imported by production retrieval
 * code) — it predates and is unrelated to the real corpus in
 * `corpus/guidelines/corpus.json`; it exists only so
 * `createCohereGuidelineRetriever`'s fixed canonical-query lane keeps working
 * for its own tests until D2 is revisited.
 */
export const SYNTHETIC_COHERE_CORPUS = Object.freeze([
  { id: 'synthetic-guideline-diabetes-follow-up-1', title: 'Synthetic primary-care diabetes follow-up', version: '2026.1', section: 'Follow-up review', uri: 'synthetic://guidelines/diabetes/follow-up#review', text: 'Review documented glycemic values, medication history, adherence, symptoms, and missing monitoring evidence before clinician decisions.' },
  { id: 'synthetic-guideline-fatigue-review-1', title: 'Synthetic primary-care fatigue review', version: '2026.1', section: 'Initial review', uri: 'synthetic://guidelines/fatigue/review#initial', text: 'For fatigue review, separate the patient-reported concern from documented findings, medication context, sleep history, and missing or conflicting evidence.' },
  { id: 'synthetic-guideline-medication-reconciliation-1', title: 'Synthetic medication reconciliation', version: '2026.1', section: 'Reconciliation', uri: 'synthetic://guidelines/medications/reconciliation#core', text: 'Medication reconciliation should compare the current documented list with prior records and surface discrepancies for clinician review.' },
]);
