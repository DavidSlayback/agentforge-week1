import { clinicalLabel } from './clinicalLanguage.js';
import {
  CLINICAL_TERMS, COMPARATIVES, DIRECTIVE_PATTERNS, DRUG_SUFFIX, INTERPRETIVE_BY_FLAG, INTERPRETIVE_WORDS,
  MONTHS, QUANTITY, SPELLED_NUMBERS, STATUS_WORDS, TERM_SYNONYMS,
} from './clinicalVocabulary.js';

/**
 * Text normalization and allowed-value parsing shared by the sentence-level
 * check (verifyGeneratedText, verifyClaims text mode) and the claim-level
 * structural binding (claimBinding.js).
 */

/** Lowercase, split field separators, and collapse synonyms to one token. */
export function canonicalText(value) {
  let text = String(value ?? '').toLowerCase()
    .replace(/_+/g, ' ')
    .replace(/:(?!\d)/g, ' ')
    .replace(/\.(?=[a-z])/g, ' ')
    .replace(/\[(\d+)\]/g, ' $1 ');
  for (const [pattern, replacement] of TERM_SYNONYMS) text = text.replace(pattern, replacement);
  return text;
}

/** Clinical lexicon terms in canonical text, with their positions. */
export function termsIn(text) {
  const found = [];
  for (const match of text.matchAll(/[a-z][a-z0-9]*/g)) {
    if (CLINICAL_TERMS.has(match[0]) || DRUG_SUFFIX.test(match[0])) found.push({ term: match[0], index: match.index });
  }
  return found;
}

const unitKey = (unit) => (!unit ? null : unit === 'percent' ? '%' : unit.replace(/s$/, ''));

/** Numbers with an optional unit, normalized ("13.20" becomes "13.2"). */
export function quantitiesIn(text) {
  return [...text.matchAll(QUANTITY)].map((match) => ({ number: String(Number(match[1])), unit: unitKey(match[2]), index: match.index }));
}

const pad = (value) => String(value).padStart(2, '0');
const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})(?:t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?)?(?![\d-])/g;

/** Find date expressions as YYYY-MM-DD and remove them (and times of day) from the text. */
export function extractDates(text) {
  const dates = [];
  const keep = (y, m, d) => {
    dates.push(`${y}-${pad(m)}-${pad(d)}`);
    return ' ';
  };
  let rest = text.replace(ISO_DATE, (_, y, m, d) => keep(y, m, d));
  rest = rest.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_, m, d, y) => keep(y, m, d));
  rest = rest.replace(/\b([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})\b/g, (whole, month, d, y) => (MONTHS[month] ? keep(y, MONTHS[month], d) : whole));
  rest = rest.replace(/\b(\d{1,2}) ([a-z]{3,9}),? (\d{4})\b/g, (whole, d, month, y) => (MONTHS[month] ? keep(y, MONTHS[month], d) : whole));
  // A time of day is part of a date reference, not a clinical quantity.
  rest = rest.replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|z|utc))?\b/g, ' ');
  return { dates, rest };
}

export function splitSentences(text) {
  return String(text).split(/(?<=[.!?…])["”’')\]]*\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
}

/**
 * Tokens for structural binding: numbers (normalized), words, unit tokens
 * such as "g/dl", and "%". Dates are returned separately.
 *
 * The alnum-word alternative (`[a-z]+[a-z0-9]*\d[a-z0-9]*`) is tried before
 * the bare-number alternative so a lab code such as "A1C" or "HbA1c" -- a
 * letter run containing a digit -- tokenizes as one word, not word+NUMBER+word
 * ("hba", "1", "c"). That split used to leave a stray digit with no citation
 * to match it (UNSUPPORTED_NUMBER) even though it was part of a name, not a
 * value; this mirrors the boundary guard `quantitiesIn` already applies to
 * real quantities (a digit run adjacent to a letter is never a bare number).
 */
export function bindingTokens(text) {
  const { dates, rest } = extractDates(canonicalText(text));
  const tokens = [...rest.matchAll(/[a-z]+[a-z0-9]*\d[a-z0-9]*|\d+(?:\.\d+)?|[a-z]+(?:\/[a-z]+)?|%/g)].map((match) => (/^\d/.test(match[0]) ? String(Number(match[0])) : match[0]));
  return { dates, tokens };
}

export const isNumberToken = (token) => /^\d/.test(token);

/** True when the text reads as an instruction to act, not a description. */
export function isDirective(text) {
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return DIRECTIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

const isoDay = (value) => {
  const day = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};

/** Interpretive words a typed lab result supports, from its flag or range. */
function interpretiveFromLab(value, flag, referenceRange) {
  if (flag && flag !== 'unknown') return INTERPRETIVE_BY_FLAG[flag] || [];
  const number = Number.parseFloat(value);
  const range = String(referenceRange || '').match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
  if (!Number.isFinite(number) || !range) return [];
  if (number < Number(range[1])) return INTERPRETIVE_BY_FLAG.low;
  if (number > Number(range[2])) return INTERPRETIVE_BY_FLAG.high;
  return INTERPRETIVE_BY_FLAG.normal;
}

/**
 * Normalize one allowed value into a fact. Accepted shapes:
 * - W2 Citation ({ source_type, source_id, field_or_chunk_id, quote_or_value });
 * - typed LabResult ({ test_name, value, unit, reference_range, collection_date,
 *   abnormal_flag, citation });
 * - typed IntakeForm leaf ({ status: 'observed', value, citation });
 * - GuidelineEvidence ({ title, section, snippet, citation });
 * - briefing claim or chart record ({ field, value, source_ref, recorded_at | evidence[] });
 * - a plain string (sentence-level checks only; it has no citation identity).
 * Returns null for values that cannot be cited, such as a not_found_on_form leaf.
 */
export function toAllowedFact(entry) {
  if (typeof entry === 'string' || typeof entry === 'number') {
    return { sourceType: null, sourceId: null, field: null, value: String(entry), label: '', quote: null, dates: [], rangeText: '', interpretive: null };
  }
  if (!entry || typeof entry !== 'object') return null;
  const citation = entry.citation && typeof entry.citation === 'object' ? entry.citation : null;
  if ('test_name' in entry && citation) {
    return {
      sourceType: citation.source_type ?? null, sourceId: citation.source_id ?? null, field: citation.field_or_chunk_id ?? null,
      value: `${entry.value ?? ''} ${entry.unit ?? ''}`.trim(), label: String(entry.test_name), quote: citation.quote_or_value ?? null,
      dates: [isoDay(entry.collection_date)].filter(Boolean), rangeText: String(entry.reference_range || ''),
      interpretive: interpretiveFromLab(entry.value, entry.abnormal_flag, entry.reference_range),
    };
  }
  if ('snippet' in entry && citation) {
    return {
      sourceType: citation.source_type ?? 'guideline', sourceId: citation.source_id ?? null, field: citation.field_or_chunk_id ?? null,
      value: String(entry.snippet), label: [entry.title, entry.section, entry.version].filter(Boolean).join(' '),
      quote: citation.quote_or_value ?? String(entry.snippet), dates: [], rangeText: '', interpretive: null,
    };
  }
  if (entry.status === 'not_found_on_form') return null;
  if (entry.status === 'observed' && citation) {
    return {
      sourceType: citation.source_type ?? null, sourceId: citation.source_id ?? null, field: citation.field_or_chunk_id ?? null,
      value: String(entry.value ?? ''), label: '', quote: citation.quote_or_value ?? null, dates: [], rangeText: '', interpretive: null,
    };
  }
  if ('quote_or_value' in entry && 'source_id' in entry) {
    return {
      sourceType: entry.source_type ?? null, sourceId: entry.source_id ?? null, field: entry.field_or_chunk_id ?? null,
      value: String(entry.quote_or_value ?? ''), label: '', quote: String(entry.quote_or_value ?? ''), dates: [], rangeText: '', interpretive: null,
    };
  }
  const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
  const rawValue = entry.value ?? '';
  return {
    sourceType: entry.source_type ?? 'openemr_record',
    sourceId: entry.source_ref ?? entry.source_id ?? entry.id ?? null,
    field: entry.field ?? null,
    value: typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue),
    label: [entry.label, ...evidence.map((source) => source?.excerpt)].filter(Boolean).join(' '),
    quote: null,
    dates: [entry.recorded_at, ...evidence.map((source) => source?.recorded_at)].map(isoDay).filter(Boolean),
    rangeText: '',
    interpretive: null,
  };
}

/** Sentence-level anchor derived from an allowed fact. */
function sentenceAnchor(fact) {
  const valueText = canonicalText(fact.value);
  const fieldText = fact.field ? canonicalText(`${clinicalLabel(fact.field)} ${fact.field}`) : '';
  const text = `${fieldText} ${valueText} ${canonicalText(fact.label)}`;
  const { dates: valueDates, rest } = extractDates(valueText);
  return {
    terms: new Set(termsIn(text).map((match) => match.term)),
    quantities: quantitiesIn(rest),
    dates: new Set([...fact.dates, ...valueDates]),
  };
}

export function sentenceAnchors(allowedValues) {
  return (Array.isArray(allowedValues) ? allowedValues : []).map(toAllowedFact).filter(Boolean).map(sentenceAnchor);
}

export const contextTermsFrom = (values) => termsIn(canonicalText((Array.isArray(values) ? values : []).join(' '))).map((match) => match.term);

/** Words that state a value or a change; a withheld term may not carry them. */
const VALUE_WORDS = new Set([...SPELLED_NUMBERS, ...COMPARATIVES, ...STATUS_WORDS, ...INTERPRETIVE_WORDS]);

/**
 * Judge one sentence against sentence-level anchors (term and number level).
 * `contextTerms` (withheld fields, qualification reasons) may be named, but a
 * sentence that names a context-only term may not state a value, a change,
 * or a status for it, and context terms never anchor numbers.
 * Returns { status: 'anchored' | 'unanchored' | 'no_clinical_assertion', reasons }.
 */
export function judgeSentence(sentence, anchors, contextTerms, { checkDirectiveLanguage = false } = {}) {
  const anchorTerms = new Set(anchors.flatMap((anchor) => [...anchor.terms]));
  const knownTerms = new Set([...contextTerms, ...anchorTerms]);
  const knownDates = new Set(anchors.flatMap((anchor) => [...anchor.dates]));
  const { dates, rest } = extractDates(canonicalText(sentence));
  const terms = termsIn(rest);
  const quantities = quantitiesIn(rest);
  const reasons = new Set();
  if (checkDirectiveLanguage && isDirective(sentence)) reasons.add('DIRECTIVE_LANGUAGE');
  if (dates.some((date) => !knownDates.has(date))) reasons.add('UNANCHORED_DATE');
  if (terms.some(({ term }) => !knownTerms.has(term))) reasons.add('UNANCHORED_TERM');
  const namesContextOnlyTerm = terms.some(({ term }) => !anchorTerms.has(term) && contextTerms.includes(term));
  if (namesContextOnlyTerm && [...rest.matchAll(/[a-z]+/g)].some((match) => VALUE_WORDS.has(match[0]))) reasons.add('CONTEXT_TERM_WITH_VALUE');
  for (const quantity of quantities) {
    // Pair each number with the nearest clinical term in the sentence, so a
    // real value cannot be borrowed from a different drug or lab. A number
    // with no clinical term to pair with is unanchored.
    const nearest = terms.reduce((best, match) => (!best || Math.abs(match.index - quantity.index) < Math.abs(best.index - quantity.index) ? match : best), null);
    const supported = Boolean(nearest) && anchors.some((anchor) => anchor.terms.has(nearest.term)
      && anchor.quantities.some((candidate) => candidate.number === quantity.number && (!quantity.unit || !candidate.unit || candidate.unit === quantity.unit)));
    if (!supported) reasons.add('UNANCHORED_QUANTITY');
  }
  const assertion = dates.length > 0 || terms.length > 0 || quantities.length > 0;
  return { status: reasons.size ? 'unanchored' : assertion ? 'anchored' : 'no_clinical_assertion', reasons: [...reasons] };
}
