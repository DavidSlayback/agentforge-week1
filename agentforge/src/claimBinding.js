import {
  BINDING_VOCABULARY, COMPARATIVES, FRAMING_VOCABULARY, FREQUENCY_WORDS, GUIDELINE_VOCABULARY,
  INTERPRETIVE_WORDS, NEGATION_CUES, SPELLED_NUMBERS, STATUS_WORDS, UNIT_WORDS,
} from './clinicalVocabulary.js';
import {
  bindingTokens, canonicalText, contextTermsFrom, isDirective, isNumberToken, judgeSentence,
  sentenceAnchors, splitSentences, termsIn, toAllowedFact,
} from './groundingText.js';

/**
 * Structural claim binding for answer composers (the W2 grounded answer).
 *
 * This is a term- and number-level structural check, not semantic
 * entailment. Every claim is bound to its citations, and its content must be
 * derivable from exactly what those citations point to:
 * - A citation must carry `source_id` and `field_or_chunk_id`, and both must
 *   equal an allowed value's. `quote_or_value` (and `source_type`) are then
 *   checked for consistency; they are never an alternative way to match.
 * - `patient_fact` claims cite `document` or `openemr_record` values only.
 *   Each claim must contain every cited value (normalized for case, spacing,
 *   trailing zeros, and unit spacing), and every other word must be a
 *   neutral reporting word or come from the cited values themselves (closed
 *   vocabulary). Numbers must be cited numbers; reference-range numbers count
 *   only when the claim talks about the range. Interpretive words (low, high,
 *   critical, normal...) need a typed abnormal_flag or reference range. A
 *   negation cue needs a cited value that is itself negated. Dates must equal
 *   a cited collection or recorded date.
 * - `guideline` claims cite `guideline` values only and must contain a
 *   verbatim span of each cited chunk (8 words, or the whole chunk if
 *   shorter). Words outside the span are limited to attribution words and
 *   the guideline's title, section, and version.
 * - `framing` claims need no citation but may state no clinical content: no
 *   numbers, dates, or clinical terms, and only reporting/framing words.
 *   Withheld or qualification context terms may be named, never with a
 *   value, change, or status.
 * - Directive language (imperative, second-person, or recommendation-to-act)
 *   fails; descriptive past tense does not. In guideline claims the verbatim
 *   span is exempt.
 *
 * Known limits: number formats such as "1,000" or "1 g" (for 1000 mg) and
 * unit conversions are not recognized and fail closed; relative dates
 * ("last week", "yesterday") are not resolved; synonyms are limited to the
 * table in clinicalVocabulary.js; a claim can still juxtapose cited facts in
 * a misleading order, because word order is checked only for cited values
 * and guideline spans.
 */

const CLAIM_KINDS = new Set(['patient_fact', 'guideline', 'framing']);
const PATIENT_SOURCE_TYPES = new Set(['document', 'openemr_record']);
const MIN_GUIDELINE_SPAN_WORDS = 8;
const UNANCHORED_REASONS = new Set([
  'UNSUPPORTED_TOKEN', 'UNSUPPORTED_NUMBER', 'UNSUPPORTED_INTERPRETATION', 'UNANCHORED_DATE', 'UNANCHORED_TERM',
  'UNANCHORED_QUANTITY', 'CITED_VALUE_MISSING', 'NEGATION_UNSUPPORTED', 'GUIDELINE_QUOTE_MISSING',
  'FRAMING_HAS_CLINICAL_CONTENT', 'CONTEXT_TERM_WITH_VALUE',
]);
const VALUE_WORDS = new Set([...SPELLED_NUMBERS, ...COMPARATIVES, ...STATUS_WORDS, ...INTERPRETIVE_WORDS, ...FREQUENCY_WORDS, ...UNIT_WORDS]);

const wordsOf = (tokens) => tokens.filter((token) => !isNumberToken(token));
const numbersOf = (tokens) => tokens.filter(isNumberToken);

/** Precompute the binding view of one allowed fact. */
function bindingFact(fact) {
  const value = bindingTokens(fact.value);
  const quote = fact.quote ? bindingTokens(fact.quote) : { tokens: [], dates: [] };
  const label = bindingTokens(fact.label);
  const field = fact.field ? bindingTokens(canonicalText(fact.field)) : { tokens: [] };
  const typed = Array.isArray(fact.interpretive);
  const ownWords = [...value.tokens, ...quote.tokens];
  // Typed results get interpretation only from their flag or range.
  const interpretive = typed ? fact.interpretive : ownWords.filter((token) => INTERPRETIVE_WORDS.has(token));
  const words = new Set([...wordsOf(ownWords), ...wordsOf(label.tokens), ...wordsOf(field.tokens), ...wordsOf(bindingTokens(fact.rangeText).tokens)]
    .filter((token) => !INTERPRETIVE_WORDS.has(token)));
  return {
    ...fact,
    valueTokens: value.tokens,
    quoteTokens: quote.tokens.length ? quote.tokens : value.tokens,
    words,
    numbers: new Set(numbersOf(ownWords)),
    labelWords: new Set(label.tokens),
    rangeNumbers: new Set(numbersOf(bindingTokens(fact.rangeText).tokens)),
    interpretive: new Set(interpretive),
    negated: ownWords.some((token) => NEGATION_CUES.has(token)),
    dates: new Set([...fact.dates, ...value.dates, ...quote.dates]),
  };
}

const sameTokens = (left, right) => left.length === right.length && left.every((token, index) => token === right[index]);

function containsRun(tokens, run) {
  if (!run.length) return false;
  for (let start = 0; start + run.length <= tokens.length; start += 1) {
    if (sameTokens(tokens.slice(start, start + run.length), run)) return true;
  }
  return false;
}

/** Longest contiguous run shared by claim and quote: { start, length } in the claim. */
function longestSharedRun(claimTokens, quoteTokens) {
  let best = { start: 0, length: 0 };
  for (let i = 0; i < claimTokens.length; i += 1) {
    for (let j = 0; j < quoteTokens.length; j += 1) {
      let length = 0;
      while (i + length < claimTokens.length && j + length < quoteTokens.length && claimTokens[i + length] === quoteTokens[j + length]) length += 1;
      if (length > best.length) best = { start: i, length };
    }
  }
  return best;
}

/** Resolve one citation to allowed facts by exact source_id and field_or_chunk_id. */
function resolveCitation(citation, facts) {
  const sourceId = citation?.source_id;
  const field = citation?.field_or_chunk_id;
  if (typeof sourceId !== 'string' || !sourceId || typeof field !== 'string' || !field) return { facts: [], errors: ['CITATION_INVALID'] };
  const matches = facts.filter((fact) => fact.sourceId === sourceId && fact.field === field);
  if (!matches.length) return { facts: [], errors: ['CITATION_NOT_ALLOWED'] };
  const errors = [];
  if (citation.source_type && matches.some((fact) => fact.sourceType && fact.sourceType !== citation.source_type)) errors.push('CITATION_SOURCE_TYPE_MISMATCH');
  if (typeof citation.quote_or_value === 'string' && citation.quote_or_value.trim()) {
    const quoted = bindingTokens(citation.quote_or_value).tokens;
    if (!matches.some((fact) => sameTokens(quoted, fact.quoteTokens) || sameTokens(quoted, fact.valueTokens))) errors.push('CITATION_QUOTE_MISMATCH');
  }
  return { facts: matches, errors };
}

function bindPatientFact(tokens, dates, facts, reasons) {
  for (const fact of facts) if (!containsRun(tokens, fact.valueTokens)) reasons.add('CITED_VALUE_MISSING');
  const knownDates = new Set(facts.flatMap((fact) => [...fact.dates]));
  if (dates.some((date) => !knownDates.has(date))) reasons.add('UNANCHORED_DATE');
  const rangeContext = tokens.includes('range') || tokens.includes('reference');
  if (tokens.some((token) => NEGATION_CUES.has(token)) && !facts.some((fact) => fact.negated)) reasons.add('NEGATION_UNSUPPORTED');
  for (const token of tokens) {
    if (isNumberToken(token)) {
      if (!facts.some((fact) => fact.numbers.has(token) || (rangeContext && fact.rangeNumbers.has(token)))) reasons.add('UNSUPPORTED_NUMBER');
    } else if (INTERPRETIVE_WORDS.has(token)) {
      if (!facts.some((fact) => fact.interpretive.has(token))) reasons.add('UNSUPPORTED_INTERPRETATION');
    } else if (!NEGATION_CUES.has(token) && !BINDING_VOCABULARY.has(token) && !facts.some((fact) => fact.words.has(token))) {
      reasons.add('UNSUPPORTED_TOKEN');
    }
  }
}

/** Returns the claim text outside the verbatim spans (for the directive check). */
function bindGuideline(tokens, dates, facts, reasons) {
  const quoted = new Set();
  for (const fact of facts) {
    const required = Math.min(MIN_GUIDELINE_SPAN_WORDS, fact.quoteTokens.length);
    const run = longestSharedRun(tokens, fact.quoteTokens);
    if (!required || run.length < required) {
      reasons.add('GUIDELINE_QUOTE_MISSING');
      continue;
    }
    for (let index = run.start; index < run.start + run.length; index += 1) quoted.add(index);
  }
  if (dates.length) reasons.add('UNANCHORED_DATE');
  const outside = tokens.filter((_, index) => !quoted.has(index));
  for (const token of outside) {
    const allowed = BINDING_VOCABULARY.has(token) || GUIDELINE_VOCABULARY.has(token) || facts.some((fact) => fact.labelWords.has(token));
    if (!allowed) reasons.add(isNumberToken(token) ? 'UNSUPPORTED_NUMBER' : 'UNSUPPORTED_TOKEN');
  }
  return outside.join(' ');
}

function bindFraming(tokens, dates, contextTokens, contextTerms, reasons) {
  const clinicalTerms = termsIn(tokens.join(' ')).map((match) => match.term);
  if (dates.length || tokens.some(isNumberToken) || clinicalTerms.some((term) => !contextTerms.includes(term))) reasons.add('FRAMING_HAS_CLINICAL_CONTENT');
  if (clinicalTerms.some((term) => contextTerms.includes(term)) && tokens.some((token) => VALUE_WORDS.has(token))) reasons.add('CONTEXT_TERM_WITH_VALUE');
  const allowed = (token) => BINDING_VOCABULARY.has(token) || FRAMING_VOCABULARY.has(token) || contextTokens.has(token);
  if (tokens.some((token) => !isNumberToken(token) && !allowed(token))) reasons.add('UNSUPPORTED_TOKEN');
}

function verdictForClaim(claim, index, facts, contextTerms, contextTokens) {
  const reasons = new Set();
  const kind = claim?.kind ?? 'patient_fact';
  const text = typeof claim?.text === 'string' ? claim.text : '';
  const citations = Array.isArray(claim?.citations) ? claim.citations : [];
  const { dates, tokens } = bindingTokens(text);
  if (!CLAIM_KINDS.has(kind)) reasons.add('INVALID_CLAIM_KIND');
  if (!text.trim()) reasons.add('EMPTY_CLAIM');
  let directiveText = text;
  if (kind === 'framing') {
    bindFraming(tokens, dates, contextTokens, contextTerms, reasons);
  } else if (CLAIM_KINDS.has(kind)) {
    if (!citations.length) reasons.add('UNCITED_CLAIM');
    const resolved = citations.map((citation) => resolveCitation(citation, facts));
    resolved.forEach((result) => result.errors.forEach((error) => reasons.add(error)));
    const cited = resolved.flatMap((result) => result.facts);
    if (kind === 'patient_fact') {
      if (cited.some((fact) => !PATIENT_SOURCE_TYPES.has(fact.sourceType))) reasons.add('GUIDELINE_CITED_FOR_PATIENT_FACT');
      bindPatientFact(tokens, dates, cited.filter((fact) => PATIENT_SOURCE_TYPES.has(fact.sourceType)), reasons);
    } else {
      if (cited.some((fact) => fact.sourceType !== 'guideline')) reasons.add('NON_GUIDELINE_CITATION');
      directiveText = bindGuideline(tokens, dates, cited.filter((fact) => fact.sourceType === 'guideline'), reasons);
    }
  }
  if (splitSentences(directiveText).some((sentence) => isDirective(sentence))) reasons.add('DIRECTIVE_LANGUAGE');
  const assertion = kind !== 'framing' && tokens.length > 0;
  const status = reasons.size ? 'unanchored' : assertion ? 'anchored' : 'no_clinical_assertion';
  return { kind: 'claim', claim_kind: kind, index, status, reasons: [...reasons] };
}

function summarize(verdicts, emptyCode) {
  const reasons = new Set(verdicts.flatMap((verdict) => verdict.reasons));
  const issues = [];
  if (!verdicts.length) issues.push(emptyCode);
  if ([...reasons].some((reason) => UNANCHORED_REASONS.has(reason))) issues.push('UNANCHORED_CLAIM');
  for (const reason of reasons) {
    if (reason === 'DIRECTIVE_LANGUAGE') issues.push('UNSAFE_CLINICAL_ACTION_LANGUAGE');
    else if (!UNANCHORED_REASONS.has(reason)) issues.push(reason);
  }
  return { status: issues.length ? 'failed' : 'passed', issues: [...new Set(issues)], verdicts };
}

/**
 * Verify composed output against allowed values.
 *
 * Claims mode (`claims: [{ kind, text, citations }]`) is the structural
 * binding described at the top of this module; `kind` defaults to
 * `patient_fact`. Text mode (`text`) is the sentence-level term and number
 * check used for free prose. `allowedValues` accepts Citations, typed
 * LabResult / IntakeForm leaves, GuidelineEvidence, briefing claims, chart
 * records, and (text mode only) strings. `contextTerms` are withheld fields or
 * qualification reasons that may be named but never carry values.
 *
 * Returns `{ status, issues, verdicts }`; verdicts carry indexes and reason
 * codes only, never text.
 */
export function verifyClaims({ text = null, claims = null, allowedValues = [], contextTerms = [], checkDirectiveLanguage = true } = {}) {
  const context = contextTermsFrom(contextTerms);
  if (Array.isArray(claims)) {
    const facts = (Array.isArray(allowedValues) ? allowedValues : []).map(toAllowedFact).filter((fact) => fact && fact.sourceId && fact.field).map(bindingFact);
    const contextTokens = new Set((Array.isArray(contextTerms) ? contextTerms : []).flatMap((term) => wordsOf(bindingTokens(term).tokens)));
    return summarize(claims.map((claim, index) => verdictForClaim(claim, index, facts, context, contextTokens)), 'NO_CLAIMS');
  }
  const anchors = sentenceAnchors(allowedValues);
  const verdicts = splitSentences(typeof text === 'string' ? text : '')
    .map((sentence, index) => ({ kind: 'sentence', index, ...judgeSentence(sentence, anchors, context, { checkDirectiveLanguage }) }));
  return summarize(verdicts, 'EMPTY_MODEL_OUTPUT');
}
