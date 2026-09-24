const tokenize = (value) => new Set(String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));

export const GUIDELINE_CORPUS = Object.freeze([
  { id: 'guideline-diabetes-follow-up-1', title: 'Synthetic primary-care diabetes follow-up', version: '2026.1', section: 'Follow-up review', uri: 'synthetic://guidelines/diabetes/follow-up#review', text: 'Review documented glycemic values, medication history, adherence, symptoms, and missing monitoring evidence before clinician decisions.' },
  { id: 'guideline-fatigue-review-1', title: 'Synthetic primary-care fatigue review', version: '2026.1', section: 'Initial review', uri: 'synthetic://guidelines/fatigue/review#initial', text: 'For fatigue review, separate the patient-reported concern from documented findings, medication context, sleep history, and missing or conflicting evidence.' },
  { id: 'guideline-medication-reconciliation-1', title: 'Synthetic medication reconciliation', version: '2026.1', section: 'Reconciliation', uri: 'synthetic://guidelines/medications/reconciliation#core', text: 'Medication reconciliation should compare the current documented list with prior records and surface discrepancies for clinician review.' },
]);

function scoreDocument(queryTokens, document) {
  const textTokens = tokenize(`${document.title} ${document.section} ${document.text}`);
  const overlap = [...queryTokens].filter((token) => textTokens.has(token));
  const sparseScore = overlap.length;
  const denseScore = queryTokens.size ? overlap.length / new Set([...queryTokens, ...textTokens]).size : 0;
  return { sparseScore, denseScore, score: sparseScore + denseScore, overlap };
}

/** Deterministic sparse+dense proxy over a versioned, provenance-tracked corpus. */
export function retrieveGuidelineEvidence(query, { topK = 3, corpus = GUIDELINE_CORPUS } = {}) {
  const queryTokens = tokenize(query);
  if (!queryTokens.size) return { status: 'qualified', query: String(query || ''), evidence: [], issues: ['empty_query'] };
  const ranked = corpus.map((document) => ({ document, ...scoreDocument(queryTokens, document) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id))
    .slice(0, Math.max(0, topK));
  if (!ranked.length) return { status: 'qualified', query: String(query), evidence: [], issues: ['insufficient_guideline_evidence'] };
  return { status: 'complete', provider: 'local-lexical-proxy', query: String(query), evidence: ranked.map(({ document, sparseScore, denseScore, score, overlap }) => guidelineEvidenceItem(document, { sparseScore, denseScore, rerankScore: score, matchedTerms: overlap })), issues: [] };
}

/**
 * Named default retriever wrapping the deterministic local lexical/dense
 * proxy. The name is the single source of truth for the "local-lexical-proxy"
 * provider label; callers that inject a retriever (the scan supervisor, the
 * service) read `.name` instead of hardcoding the string.
 */
export const localLexicalGuidelineRetriever = Object.freeze({ name: 'local-lexical-proxy', retrieve: retrieveGuidelineEvidence });

/**
 * Build one `GuidelineEvidence` item (schemas.js) from a corpus document and
 * its retrieval scores. `citation.source_id`/`citation.field_or_chunk_id`
 * are both the document id because today's corpus has exactly one chunk per
 * document; `citation.page_or_section` carries the guideline section title.
 */
function guidelineEvidenceItem(document, { sparseScore, denseScore, rerankScore, matchedTerms }) {
  return {
    title: document.title,
    section: document.section,
    version: document.version,
    snippet: document.text,
    sparse_score: sparseScore,
    dense_score: Number(denseScore.toFixed(6)),
    rerank_score: Number(rerankScore.toFixed(6)),
    matched_terms: matchedTerms,
    citation: { source_type: 'guideline', source_id: document.id, page_or_section: document.section, field_or_chunk_id: document.id, quote_or_value: document.text },
  };
}

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

function documentText(document) {
  return `${document.title}\n${document.section}\n${document.text}`;
}

function canonicalSyntheticQuery(value) {
  const tokens = tokenize(value);
  if ([...tokens].some((token) => ['diabetes', 'glycemic', 'glucose'].includes(token))) return 'synthetic diabetes follow-up documented glycemic values medication history';
  if ([...tokens].some((token) => ['fatigue', 'sleep', 'tiredness'].includes(token))) return 'synthetic fatigue review documented symptoms medication context sleep history';
  if ([...tokens].some((token) => ['medication', 'medications', 'reconciliation'].includes(token))) return 'synthetic medication reconciliation current documented list prior records';
  return '';
}

/** Create a Cohere Embed + Rerank retriever for the synthetic guideline corpus.
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
  corpus = GUIDELINE_CORPUS,
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
    if (!normalizedQuery) return { status: 'qualified', provider: 'cohere', query: '', evidence: [], issues: ['no_approved_synthetic_query'] };
    const texts = corpus.map(documentText);
    corpusEmbeddingPromise ||= embed(texts, 'search_document');
    const [corpusEmbeddings, queryEmbedding] = await Promise.all([
      corpusEmbeddingPromise,
      embed([normalizedQuery], 'search_query'),
    ]);
    const queryTokens = tokenize(normalizedQuery);
    const ranked = corpus.map((document, index) => {
      const textTokens = tokenize(texts[index]);
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
    if (!candidates.length) return { status: 'qualified', provider: 'cohere', query: normalizedQuery, evidence: [], issues: ['insufficient_guideline_evidence'] };
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
      return [guidelineEvidenceItem(candidate.document, { sparseScore: candidate.sparseScore, denseScore: candidate.denseScore, rerankScore: result.relevance_score, matchedTerms: candidate.matchedTerms })];
    });
    return {
      status: evidence.length ? 'complete' : 'qualified',
      provider: 'cohere',
      query: normalizedQuery,
      evidence,
      issues: evidence.length ? [] : ['insufficient_guideline_evidence'],
      usage: { embed_billed_units: [corpusEmbeddings.billedUnits, queryEmbedding.billedUnits], rerank_billed_units: rerank.meta?.billed_units || null },
    };
  }

  return Object.freeze({ name: 'cohere-embed-rerank', retrieve });
}
