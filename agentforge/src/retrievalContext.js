import { RETRIEVAL_QUERY_EXPANSIONS, TERM_SYNONYMS } from './clinicalVocabulary.js';

/**
 * Contextual retrieval helpers (E3, X-5). Both are deterministic, local and
 * make no model call.
 */

/**
 * The text BM25 indexes for a chunk when contextual chunk headers are on:
 * a header line naming the publisher, document title and section, then the
 * verbatim chunk text. The citation still quotes only `chunk.text`.
 */
export function contextualChunkText(chunk) {
  return `${chunk.publisher} | ${chunk.title} | ${chunk.section}\n${chunk.text}`;
}

function canonicalTokens(text) {
  let normalized = String(text || '').toLowerCase();
  for (const [pattern, canonical] of TERM_SYNONYMS) normalized = normalized.replace(pattern, canonical);
  return normalized.match(/[a-z0-9]+/g) || [];
}

/**
 * Condition and synonym words for every lab test the query names, e.g. an
 * "A1C" finding adds diabetes, prediabetes, glucose and sugar, unless the
 * query already names one of those conditions. The result is built only from
 * `RETRIEVAL_QUERY_EXPANSIONS` values, never from the query's own words, so
 * it cannot carry a name, date or other patient text.
 */
export function queryExpansionTerms(query) {
  const canonical = canonicalTokens(query);
  const present = new Set([...canonical, ...(String(query || '').toLowerCase().match(/[a-z0-9]+/g) || [])]);
  const terms = [];
  for (const token of new Set(canonical)) {
    const group = RETRIEVAL_QUERY_EXPANSIONS[token];
    if (!group || group.unlessQueryHas.some((word) => present.has(word))) continue;
    for (const term of group.terms) if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

/** The local BM25 query: the original query plus its expansion terms. */
export function expandLexicalQuery(query) {
  const terms = queryExpansionTerms(query);
  return terms.length ? `${query} ${terms.join(' ')}` : String(query || '');
}
