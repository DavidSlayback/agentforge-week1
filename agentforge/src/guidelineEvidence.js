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
  return { status: 'complete', query: String(query), evidence: ranked.map(({ document, sparseScore, denseScore, score, overlap }) => ({ source_type: 'guideline', source_id: document.id, title: document.title, version: document.version, section: document.section, location: document.uri, quote: document.text, sparse_score: sparseScore, dense_score: Number(denseScore.toFixed(6)), rerank_score: Number(score.toFixed(6)), matched_terms: overlap })), issues: [] };
}
