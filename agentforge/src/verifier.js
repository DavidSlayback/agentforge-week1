import { COMPLETE_COVERAGE_GROUPS, COVERAGE_STATUSES, coverageGroupForField, isAllowedReadOperation, isCoverageUnavailable } from './contracts.js';
import { clinicalLabel } from './clinicalLanguage.js';
import { DIRECTIVE_LANGUAGE } from './clinicalVocabulary.js';
import { contextTermsFrom, judgeSentence, sentenceAnchors, splitSentences } from './groundingText.js';

export { verifyClaims } from './claimBinding.js';

/** Verify patient scope, coverage qualification, and the read-only operation set. */
export function verify({ patientRef, claims = [], coverage = [], qualification = {}, operations = [], disposition = null }) {
  const issues = [];
  const unsupported = (claim) => claim.patient_ref !== patientRef || !claim.source_ref || !Array.isArray(claim.evidence)
    || claim.evidence.some((item) => item.patient_ref !== patientRef || !item.source_ref);
  if (claims.some(unsupported)) issues.push('UNSUPPORTED_CLAIM');
  if (operations.some((operation) => operation.type !== 'read' || !isAllowedReadOperation(operation.operation))) issues.push('WRITE_CAPABLE_BEHAVIOR');
  if (coverage.some((item) => !COVERAGE_STATUSES.has(item.status))) issues.push('INVALID_COVERAGE_STATUS');
  if (coverage.some((item) => isCoverageUnavailable(item.status)) && !qualification.required) issues.push('UNQUALIFIED_PARTIAL_RESULT');
  if (coverage.some((item) => ['empty', 'failed', 'timeout', 'unauthorized', 'not_requested'].includes(item.status) && item.records !== 0)) issues.push('UNAVAILABLE_COVERAGE_HAS_RECORDS');
  const groups = new Map(coverage.map((item) => [item.group, item]));
  if (claims.some((claim) => {
    const group = groups.get(coverageGroupForField(claim.field));
    return !group || group.status !== 'success' || group.records < 1;
  })) issues.push('CLAIM_COVERAGE_UNAVAILABLE');
  if (disposition === 'complete' && coverage.some((item) => isCoverageUnavailable(item.status))) issues.push('COMPLETE_WITH_UNAVAILABLE_COVERAGE');
  if (disposition === 'complete') {
    const present = new Set(coverage.map((item) => item.group));
    if (COMPLETE_COVERAGE_GROUPS.some((group) => !present.has(group))) issues.push('COMPLETE_COVERAGE_GROUP_MISSING');
  }
  return {
    status: issues.length ? 'failed' : 'passed',
    issues,
    evidence_grounding: issues.some((issue) => ['UNSUPPORTED_CLAIM', 'CLAIM_COVERAGE_UNAVAILABLE'].includes(issue)) ? 'failed' : 'passed',
    patient_scope: claims.every((claim) => claim.patient_ref === patientRef) ? 'passed' : 'failed',
    read_only: issues.includes('WRITE_CAPABLE_BEHAVIOR') ? 'failed' : 'passed',
  };
}

/**
 * Reject model prose that is empty, clinically directive, or that states any
 * clinical fact not anchored to the patient's verified claims.
 *
 * Every sentence is checked (`every`, not `some`). This is a term- and
 * number-level check, not semantic entailment. A sentence makes a clinical
 * assertion when it contains a number, a date, or a clinical term (drug,
 * allergy or reaction, problem or diagnosis, lab or vital). Each element must
 * be anchored:
 * - a clinical term must appear in a verified claim (field or value), or in a
 *   withheld field or qualification reason that the service itself produced;
 * - a quantity must appear in the value of a claim that names the clinical
 *   term nearest to it in the sentence (a number with no clinical term fails);
 * - a date must match a claim's recorded date;
 * - a sentence naming a withheld-only term may not state a value, change, or
 *   status for it, and withheld terms never anchor numbers.
 * The public signature is unchanged; `withheldFields` and
 * `qualificationReasons` are optional. For structured, cited claims use
 * `verifyClaims` (claimBinding.js), which binds each claim to its citations.
 * Known limits: a sentence with no number, date, or lexicon term (generic
 * prose, or a drug outside the lexicon and suffix list) is not treated as a
 * clinical assertion; number formats such as "1,000" and relative dates are
 * not understood and fail closed or pass as prose respectively.
 */
export function verifyGeneratedText({ text, claims, withheldFields = [], qualificationReasons = [] }) {
  const issues = [];
  const claimList = Array.isArray(claims) ? claims : [];
  if (typeof text !== 'string' || !text.trim()) issues.push('EMPTY_MODEL_OUTPUT');
  if (typeof text === 'string' && text.length > 2000) issues.push('MODEL_OUTPUT_TOO_LONG');
  if (typeof text === 'string' && DIRECTIVE_LANGUAGE.test(text)) issues.push('UNSAFE_CLINICAL_ACTION_LANGUAGE');
  const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedText = normalize(text || '');
  // Whole-output grounding: the text must name at least one verified value.
  const anchored = typeof text === 'string' && claimList.some((claim) => {
    const value = normalize(claim.value);
    const label = normalize(clinicalLabel(claim.field));
    // Short generic values such as "active" must name the clinical concept.
    // Longer verbatim note excerpts may carry their own specific context.
    return value && normalizedText.includes(value) && (normalizedText.includes(label) || value.split(' ').length >= 5);
  });
  if (claimList.length && !anchored) issues.push('OUTPUT_NOT_EVIDENCE_ANCHORED');
  // Per-sentence grounding: every clinical assertion must be anchored.
  const unanchored = typeof text === 'string' ? findUnanchoredSentences(text, claimList, [...withheldFields, ...qualificationReasons]) : [];
  if (unanchored.length) issues.push('UNANCHORED_CLAIM');
  return {
    status: issues.length ? 'failed' : 'passed',
    issues,
    // Sentence indexes and reasons only; model text never leaves the verifier.
    unanchored_sentences: unanchored,
    evidence_grounding: issues.some((issue) => ['OUTPUT_NOT_EVIDENCE_ANCHORED', 'UNANCHORED_CLAIM'].includes(issue)) ? 'failed' : 'passed',
    read_only: issues.includes('UNSAFE_CLINICAL_ACTION_LANGUAGE') ? 'failed' : 'passed',
  };
}

function findUnanchoredSentences(text, claims, context) {
  const anchors = sentenceAnchors(claims);
  const contextTerms = contextTermsFrom(context);
  return splitSentences(text)
    .map((sentence, index) => ({ sentence_index: index, ...judgeSentence(sentence, anchors, contextTerms) }))
    .filter((verdict) => verdict.status === 'unanchored')
    .map(({ sentence_index, reasons }) => ({ sentence_index, reasons }));
}
