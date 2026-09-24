import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBm25Index, tokenize } from './bm25.js';

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

/**
 * Stable fingerprint of a corpus embeddings object: a hash of the parsed
 * vectors, so it is identical whatever line endings the file was checked out
 * with. The fixture recorder stores it in its completion manifest, and the
 * gate uses real embeddings only when the manifest matches.
 */
export function corpusEmbeddingsFingerprint(embeddings) {
  return createHash('sha256').update(JSON.stringify(embeddings?.vectors || {})).digest('hex');
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
export function retrieveGuidelineEvidence(query, { topK = 3, corpus } = {}) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return { status: 'qualified', provider: SPARSE_ONLY_PROVIDER, query: '', evidence: [], issues: ['empty_query'], degraded: 'sparse_only' };
  // Loaded here (not as a default parameter) so a missing/unreadable corpus
  // file surfaces as a qualified result with a loud, specific issue code —
  // never an uncaught exception that would crash the request (or, worse, the
  // whole process if a caller evaluates this at module load — see
  // createGeminiHybridGuidelineRetriever below for the same guard).
  let resolvedCorpus = corpus;
  if (!resolvedCorpus) {
    try { resolvedCorpus = loadGuidelineCorpus(); } catch { return { status: 'qualified', provider: SPARSE_ONLY_PROVIDER, query: trimmed, evidence: [], issues: ['guideline_corpus_unavailable'], degraded: 'sparse_only' }; }
  }
  const index = buildBm25Index(resolvedCorpus, { getText: chunkText });
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

// Query-scaffolding words `formulateEvidenceQuery` (activeWorkers.js) itself
// introduces around the patient-derived text ("Abnormal findings:", "Chief
// concern:", "test result", flag words) — allowed even though a given
// corpus edit might not happen to contain every one of them verbatim,
// since these come from our own code, never from patient or clinician text.
const QUERY_SCAFFOLD_VOCABULARY = ['abnormal', 'findings', 'chief', 'concern', 'test', 'result', 'results', 'high', 'low', 'normal', 'unknown'];

/**
 * Build the allowlist of words safe to send to an external model call
 * (Gemini's embed/rerank endpoints, or a reranker such as Qwen or Cohere):
 * the corpus's own vocabulary (every word appearing in a real guideline
 * chunk) plus a short list of query-scaffolding words. Anything else — a
 * patient or clinician's own free text, which may contain a name, a date of
 * birth, a phone number, or any other identifier — is not on this list by
 * construction, since a corpus of U.S. government guideline text does not
 * contain patient identifiers.
 */
function buildExternalModelVocabulary(corpus) {
  const vocabulary = new Set(QUERY_SCAFFOLD_VOCABULARY);
  for (const chunk of corpus) for (const token of tokenize(chunkText(chunk))) vocabulary.add(token);
  return vocabulary;
}

/**
 * Sanitize text before it leaves this process for any external model call —
 * Gemini's embed call or a reranker's rerank call (Qwen, Gemini, Cohere):
 * keep only whole words present in `vocabulary`, dropping everything else —
 * digits, dates, names, addresses, phone numbers, or any other free text the
 * vocabulary doesn't recognize as clinical/guideline vocabulary. This runs
 * only on the query sent to those external calls; the local BM25 search
 * (which never leaves this process) still searches the original,
 * unsanitized query for the best local retrieval quality.
 *
 * Named generically (not `sanitizeForGemini`) because the same allowlist now
 * gates every external call this pipeline makes, regardless of which vendor
 * a `Reranker` implementation happens to call (reranker.js).
 */
export function sanitizeForExternalModel(text, vocabulary) {
  // Must start with a letter (so a bare number, a date like "1980-04-12", or
  // a phone number never matches at all) but may contain digits after (so a
  // real test name like "A1C" or "HbA1c" survives as one token rather than
  // splitting into single letters at the digit).
  const words = String(text || '').match(/[A-Za-z][A-Za-z0-9'-]*/g) || [];
  return words.filter((word) => vocabulary.has(word.toLowerCase())).join(' ');
}

// Backward-compatible alias: existing callers/tests importing the original
// Gemini-specific name keep working unchanged.
export const sanitizeForGemini = sanitizeForExternalModel;

/**
 * Reciprocal-rank fusion of the sparse and dense candidate rankings — used
 * only for the `degraded: 'no_rerank'` path below, when the reranker itself
 * fails but the (more expensive) dense embedding work already succeeded.
 * Rank-based (not score-based) so it never has to reconcile BM25's unbounded
 * scores with cosine similarity's [-1, 1] scale; `k = 60` is the standard RRF
 * constant. This never claims to be a relevance judgment the way a rerank
 * score does — it exists only to give a better-than-BM25-alone ordering
 * while a real reranker is unavailable, honestly labeled as such.
 */
function reciprocalRankFusion(candidates, k = 60) {
  const bySparse = [...candidates].sort((left, right) => right.sparseScore - left.sparseScore);
  const byDense = [...candidates].sort((left, right) => right.denseScore - left.denseScore);
  const sparseRank = new Map(bySparse.map((candidate, index) => [candidate.document.source_id, index]));
  const denseRank = new Map(byDense.map((candidate, index) => [candidate.document.source_id, index]));
  return candidates.map((candidate) => ({
    ...candidate,
    fusedScore: 1 / (k + 1 + sparseRank.get(candidate.document.source_id)) + 1 / (k + 1 + denseRank.get(candidate.document.source_id)),
  }));
}

/**
 * Build the real hybrid retriever: BM25 top-K ∪ Gemini dense cosine top-K →
 * listwise rerank (any `Reranker`, reranker.js) → top-`topK` at or above
 * `rerankThreshold`.
 *
 * Dense retrieval and reranking are two independent collaborators
 * (`embedClient`/`reranker`), not one combined client — the owner decision
 * behind this split (2026-09-24): the Gemini free-tier key used for
 * retrieval exhausts itself on the rerank step alone (20 requests/day, 5/
 * min), so W2 keeps Gemini embeddings for dense retrieval but reranks with
 * Qwen; a later dedicated reranker (Cohere or equivalent) swaps in by
 * passing a different `reranker`, with no change here. `provider` on every
 * response names both collaborators, e.g.
 * `hybrid:gemini-embedding-2+alibaba-qwen:qwen3.8-flash`.
 *
 * Degrades to BM25-only (`degraded: 'sparse_only'` on every returned item
 * and on the response) whenever corpus embeddings are unavailable, no
 * `embedClient`/`reranker` was supplied, or the embed/dense-scoring step
 * throws — never silently relabeled as hybrid (AGENTS.md). When the embed
 * step succeeds but *only* the reranker throws, the response instead fuses
 * the sparse+dense candidates by reciprocal rank and labels the result
 * `degraded: 'no_rerank'` — a deliberate design choice over falling all the
 * way back to sparse-only: the dense embedding call already ran (and is
 * already billed), so discarding it would waste real, already-paid-for
 * signal on a failure mode (the reranker specifically) that is expected to
 * be more common than an embed failure, exactly the free-tier-exhaustion
 * scenario this task exists to handle. Both degraded modes are covered by
 * `guideline-evidence.test.js`. The response's `provider` and each evidence
 * item's `degraded` field always reflect the mode that actually produced
 * that response, not the retriever's static configuration.
 *
 * Args:
 *   embedClient: `{name, model, embed(text, taskType)}` — either
 *     `createLiveGeminiClient` (production) or
 *     `createRecordedOrStubGeminiClient` (tests/gate), from geminiClient.js.
 *     `null`/`undefined` forces sparse-only.
 *   reranker: A `Reranker` (reranker.js) — `createQwenReranker`,
 *     `createGeminiReranker(geminiClient)`, `createCohereReranker`, or a
 *     recorded-or-stub variant. `null`/`undefined` forces sparse-only.
 *   corpus: Guideline chunks (defaults to the real corpus file).
 *   embeddings: `{vectors: {[source_id]: number[]}}` (defaults to the real
 *     precomputed file, or `null` if absent).
 *   candidateCount: How many sparse and dense candidates to union before
 *     reranking (assignment: top 20 each).
 *   rerankThreshold: Minimum rerank relevance score to keep a chunk.
 */
export function createGeminiHybridGuidelineRetriever({
  embedClient = null,
  reranker = null,
  corpus,
  embeddings,
  candidateCount = 20,
  rerankThreshold = 0.5,
} = {}) {
  // Resolved here, inside the factory body, rather than as a default
  // parameter: a default parameter expression runs eagerly as part of the
  // call, so a caller invoking this factory at module load (server.js does,
  // for the deployed retriever) would have a missing/unreadable corpus file
  // crash the whole process at boot. Falling back to `[]` here instead makes
  // it a loud but recoverable "guideline_corpus_unavailable" result on every
  // call — visible in /ready and in traces — never an unhandled boot crash.
  let corpusError = null;
  let resolvedCorpus = corpus;
  if (!resolvedCorpus) {
    try { resolvedCorpus = loadGuidelineCorpus(); } catch (error) { corpusError = error?.message || 'GUIDELINE_CORPUS_UNAVAILABLE'; resolvedCorpus = []; }
  }
  const resolvedEmbeddings = embeddings !== undefined ? embeddings : (corpusError ? null : loadCorpusEmbeddings());
  const bm25 = buildBm25Index(resolvedCorpus, { getText: chunkText });
  const embeddingsUsable = Boolean(resolvedEmbeddings?.vectors && Object.keys(resolvedEmbeddings.vectors).length);
  const hybridProvider = `hybrid:${embedClient?.model || embedClient?.name || 'unconfigured'}+${reranker?.name || 'unconfigured'}`;
  // Built once, from the corpus that is actually loaded — so the allowlist
  // never depends on the query itself and can't be widened by patient text.
  const externalModelVocabulary = buildExternalModelVocabulary(resolvedCorpus);

  function sparseOnly(query, topK, issue, extraUsage = []) {
    const ranked = bm25.search(query, { topK: Math.max(topK, 1) });
    const evidence = ranked.slice(0, topK).map(({ document, score, matchedTerms }) => guidelineEvidenceItem(document, { sparseScore: score, denseScore: 0, rerankScore: score, matchedTerms, degraded: 'sparse_only' }));
    return {
      status: evidence.length ? 'complete' : 'qualified',
      provider: SPARSE_ONLY_PROVIDER,
      query,
      evidence,
      issues: evidence.length ? [] : [corpusError ? 'guideline_corpus_unavailable' : 'insufficient_guideline_evidence'],
      degraded: 'sparse_only',
      degraded_reason: issue,
      // An embed call already made (and billed) before the failure is still
      // real usage and must still reach the trace, even though the response
      // itself degraded to sparse-only.
      usage: extraUsage.filter(Boolean),
    };
  }

  async function retrieve(query, { topK = 3 } = {}) {
    const trimmed = String(query || '').trim();
    // No retrieval work of any kind ran (not even a BM25 search), so this is
    // never labeled hybrid, even when embedClient/reranker are configured.
    if (!trimmed) return { status: 'qualified', provider: SPARSE_ONLY_PROVIDER, query: '', evidence: [], issues: ['empty_query'], degraded: 'sparse_only', usage: [] };
    if (!embedClient) return sparseOnly(trimmed, topK, 'embed_client_not_configured');
    if (!reranker) return sparseOnly(trimmed, topK, 'reranker_not_configured');
    if (!embeddingsUsable) return sparseOnly(trimmed, topK, 'corpus_embeddings_missing');
    // Never send the client's own text to an external model: only the words
    // this corpus's own vocabulary recognizes leave this process (MEDIUM
    // review item 7). The unsanitized `trimmed` query is still used for the
    // local BM25 search below, which never leaves this process.
    const sanitizedQuery = sanitizeForExternalModel(trimmed, externalModelVocabulary);
    if (!sanitizedQuery) return sparseOnly(trimmed, topK, 'no_sanitizable_query_terms');

    // Captured outside the try block so a later reranker failure can still
    // report the embed cost that was actually incurred.
    let embedUsage = null;
    let candidates;
    try {
      const sparseCandidates = bm25.search(trimmed, { topK: candidateCount });
      const embedResult = await embedClient.embed(sanitizedQuery, 'RETRIEVAL_QUERY');
      const queryVector = embedResult.values;
      embedUsage = embedResult.usage;
      if (!Array.isArray(queryVector) || !queryVector.length) throw new Error('EMBED_RESPONSE_INVALID');
      const denseScored = resolvedCorpus
        .map((document) => {
          const vector = resolvedEmbeddings.vectors[document.source_id];
          // A dimension mismatch is a real configuration error (query and
          // corpus embeddings came from different models/output sizes), not
          // "no similarity" — treat it as a failure so the whole request
          // degrades to sparse-only rather than silently scoring every chunk
          // 0 and calling that a successful hybrid rank.
          if (Array.isArray(vector) && vector.length && vector.length !== queryVector.length) throw new Error('EMBED_DIMENSION_MISMATCH');
          return { document, score: cosineSimilarity(queryVector, vector) };
        })
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
      candidates = [...byId.values()];
    } catch {
      // A fixed code only, never the caught error's message: it may carry
      // upstream HTTP/network detail that must not reach a trace or an API
      // response (matches service.js's retrieveFollowUpEvidence).
      return sparseOnly(trimmed, topK, 'embed_failed', [embedUsage]);
    }

    if (!candidates.length) return { status: 'qualified', provider: hybridProvider, query: trimmed, evidence: [], issues: ['insufficient_guideline_evidence'], degraded: embedUsage?.source === 'stub' ? 'stub' : null, usage: [embedUsage] };

    let rerankResults;
    let rerankUsage = null;
    try {
      const rerankOutcome = await reranker.rerank(sanitizedQuery, candidates.map((candidate) => ({ id: candidate.document.source_id, text: chunkText(candidate.document) })));
      rerankResults = rerankOutcome.results;
      rerankUsage = rerankOutcome.usage;
    } catch {
      // The reranker failed but embeddings succeeded: fuse sparse+dense by
      // reciprocal rank instead of discarding that already-paid-for dense
      // work (see `reciprocalRankFusion`'s doc comment for the rationale).
      // Still honestly labeled `degraded: 'no_rerank'` — never presented as
      // a full hybrid rerank.
      const fused = reciprocalRankFusion(candidates).sort((left, right) => right.fusedScore - left.fusedScore).slice(0, topK);
      const evidence = fused.map((candidate) => guidelineEvidenceItem(candidate.document, { sparseScore: candidate.sparseScore, denseScore: candidate.denseScore, rerankScore: candidate.fusedScore, matchedTerms: candidate.matchedTerms, degraded: 'no_rerank' }));
      return {
        status: evidence.length ? 'complete' : 'qualified',
        provider: hybridProvider,
        query: trimmed,
        evidence,
        issues: evidence.length ? [] : ['insufficient_guideline_evidence'],
        degraded: 'no_rerank',
        degraded_reason: 'reranker_failed',
        usage: [embedUsage].filter(Boolean),
      };
    }

    const scoreById = new Map(rerankResults.map((result) => [result.id, result.score]));
    const ranked = candidates
      .filter((candidate) => scoreById.has(candidate.document.source_id))
      .map((candidate) => ({ ...candidate, rerankScore: scoreById.get(candidate.document.source_id) }))
      .sort((left, right) => right.rerankScore - left.rerankScore)
      .filter((candidate) => candidate.rerankScore >= rerankThreshold)
      .slice(0, topK);

    // The pipeline ran its full hybrid shape, but if either call fell back
    // to the deterministic stand-in (no recorded fixture for this exact
    // request), the result is not a genuine hybrid rank and must say so —
    // `degraded: 'stub'`, never `null` under a `hybrid:` name (AGENTS.md:
    // never present a simulation as the real thing).
    const usedStub = embedUsage?.source === 'stub' || rerankUsage?.source === 'stub';
    const itemDegraded = usedStub ? 'stub' : null;
    const evidence = ranked.map((candidate) => guidelineEvidenceItem(candidate.document, { sparseScore: candidate.sparseScore, denseScore: candidate.denseScore, rerankScore: candidate.rerankScore, matchedTerms: candidate.matchedTerms, degraded: itemDegraded }));
    return {
      status: evidence.length ? 'complete' : 'qualified',
      provider: hybridProvider,
      query: trimmed,
      evidence,
      issues: evidence.length ? [] : ['insufficient_guideline_evidence'],
      degraded: itemDegraded,
      usage: [embedUsage, rerankUsage],
    };
  }

  return Object.freeze({ name: (embedClient && reranker) ? hybridProvider : SPARSE_ONLY_PROVIDER, retrieve });
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
