import { createGeminiHybridGuidelineRetriever, loadCorpusEmbeddings, localLexicalGuidelineRetriever } from '../guidelineEvidence.js';
import { configuredRerankProviderAndModel, createRecordedOrStubReranker } from '../reranker.js';

/**
 * X-5 contextual retrieval (E3): query expansion from the extracted lab test
 * names (`retrievalContext.js`). Expansion changes the ranking only where
 * BM25 alone decides the answer: the `local-lexical` provider, and the
 * deployed hybrid retriever's `sparse_only` fallback when the Gemini embed
 * call fails. These cases run those two paths through the full scan
 * workflow and fail when expansion is turned off
 * (`DEFAULT_CONTEXTUAL_RETRIEVAL.queryExpansion = false`).
 */

const ANEMIA_CHUNKS = Object.freeze(['medlineplus-cbc-hemoglobin-anemia', 'nhlbi-anemia-fatigue-symptoms', 'nhlbi-anemia-definition']);
const A1C_CHUNKS = Object.freeze(['cdc-a1c-diagnostic-ranges', 'cdc-a1c-test-definition', 'medlineplus-a1c-results-meaning', 'medlineplus-a1c-what-it-is', 'niddk-a1c-test-uses']);

/**
 * The deployed hybrid retriever (`AGENTFORGE_RAG_PROVIDER=gemini-hybrid`)
 * with an embed client that always fails, so every request takes its
 * `sparse_only` fallback. No network call is made.
 */
export function hybridRetrieverWithFailingEmbed() {
  const { providerLabel, model } = configuredRerankProviderAndModel();
  const embedClient = { name: 'extension-case-failing-embed', model: 'gemini-embedding-2', async embed() { throw new Error('EMBED_UNAVAILABLE'); } };
  return createGeminiHybridGuidelineRetriever({ embedClient, reranker: createRecordedOrStubReranker({ provider: providerLabel, model }), embeddings: loadCorpusEmbeddings() });
}

/**
 * Pure check over the evidence worker's output (exported for unit tests).
 *
 * Args:
 *   evidence: `workflow.typed_outputs.evidence` from a scan run.
 *   degraded: The retrieval mode the case must have exercised.
 *   topOneOf: Chunk ids acceptable as the first result.
 *   topThreeIncludes: Groups of chunk ids; each group needs one id in the top 3.
 */
export function retrievalIssues(evidence, { degraded, topOneOf = null, topThreeIncludes = [] }) {
  if (!evidence) return ['evidence_worker_did_not_run'];
  const issues = [];
  if (evidence.output_status !== 'ready') issues.push(`evidence_status_${evidence.output_status}`);
  if (evidence.degraded !== degraded) issues.push(`retrieval_mode_${evidence.degraded}_expected_${degraded}`);
  const ids = (evidence.guideline_evidence || []).map((item) => item.citation?.source_id);
  if (!ids.length) return [...issues, 'no_guideline_evidence'];
  if (topOneOf && !topOneOf.includes(ids[0])) issues.push('top_guideline_not_relevant');
  for (const [index, group] of topThreeIncludes.entries()) if (!ids.slice(0, 3).some((id) => group.includes(id))) issues.push(`finding_${index}_has_no_guideline_in_top_3`);
  return issues;
}

const evidenceOf = (run) => run.result?.workflow?.typed_outputs?.evidence;

export function retrievalCases({ kase, scan }) {
  return [
    kase('x5-retrieval-lexical-hgb-question', 'factually_consistent', 'The local-lexical retriever stops expanding a lab abbreviation into its condition, so a fatigue intake with the question "what does the low hgb suggest" ranks an unrelated kidney-test chunk first instead of an anemia chunk.', scan('intake-a', 'intake_form', { query: 'what does the low hgb suggest', service_overrides: () => ({ guidelineRetriever: localLexicalGuidelineRetriever }) }), { custom: async (run) => retrievalIssues(evidenceOf(run), { degraded: 'sparse_only', topOneOf: ANEMIA_CHUNKS }) }),
    kase('x5-retrieval-hybrid-fallback-both-findings', 'factually_consistent', 'When the Gemini embed call fails and the deployed hybrid retriever falls back to BM25, a lab report with a low hemoglobin and a high A1C gets three A1C chunks and no anemia guideline, because the hemoglobin finding is no longer expanded to its condition.', scan('gen-lab-d-flags', 'lab_pdf', { query: '', service_overrides: () => ({ guidelineRetriever: hybridRetrieverWithFailingEmbed() }) }), { custom: async (run) => retrievalIssues(evidenceOf(run), { degraded: 'sparse_only', topOneOf: A1C_CHUNKS, topThreeIncludes: [A1C_CHUNKS, ANEMIA_CHUNKS] }) }),
  ];
}
