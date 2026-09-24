import { COMPLETE_COVERAGE_GROUPS, COVERAGE_STATUSES, coverageGroupForField, isAllowedReadOperation, isCoverageUnavailable } from './contracts.js';
import { clinicalLabel } from './clinicalLanguage.js';

/** Verify patient scope, coverage qualification, and the read-only operation set. */
export function verify({ patientRef, claims = [], coverage = [], qualification = {}, operations = [], disposition = null }) {
  const issues = [];
  if (claims.some((claim) => claim.patient_ref !== patientRef || !claim.source_ref || !Array.isArray(claim.evidence) || claim.evidence.some((item) => item.patient_ref !== patientRef || !item.source_ref))) issues.push('UNSUPPORTED_CLAIM');
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
  return { status: issues.length ? 'failed' : 'passed', issues, evidence_grounding: issues.some((issue) => ['UNSUPPORTED_CLAIM', 'CLAIM_COVERAGE_UNAVAILABLE'].includes(issue)) ? 'failed' : 'passed', patient_scope: claims.every((claim) => claim.patient_ref === patientRef) ? 'passed' : 'failed', read_only: issues.includes('WRITE_CAPABLE_BEHAVIOR') ? 'failed' : 'passed' };
}

/**
 * Reject model output that is empty, clinically directive, or that states any
 * clinical fact not anchored to the patient's verified claims.
 *
 * Every sentence is checked (`every`, not `some`). A sentence makes a clinical
 * assertion when it contains a number, a date, or a clinical term (drug,
 * allergy or reaction, problem or diagnosis, lab or vital). Each element must
 * be anchored:
 * - a clinical term must appear in a verified claim (field or value), or in a
 *   withheld field or qualification reason that the service itself produced;
 * - a quantity must appear in a verified claim value, in a claim that also
 *   names the clinical term nearest to that quantity in the sentence. Withheld
 *   fields and qualification reasons never anchor numbers;
 * - a date must match a claim's recorded date.
 * The public signature is unchanged; `withheldFields` and
 * `qualificationReasons` are optional. `verifyClaims` exposes the same check
 * with per-sentence and per-claim verdicts.
 * Known limit: a sentence with no number, date, or lexicon term (for example
 * generic prose, or a drug outside the lexicon and suffix list) is not
 * treated as a clinical assertion.
 */
export function verifyGeneratedText({ text, claims, withheldFields = [], qualificationReasons = [] }) {
  const issues = [];
  const claimList = Array.isArray(claims) ? claims : [];
  if (typeof text !== 'string' || !text.trim()) issues.push('EMPTY_MODEL_OUTPUT');
  if (typeof text === 'string' && text.length > 2000) issues.push('MODEL_OUTPUT_TOO_LONG');
  if (typeof text === 'string' && /\b(diagnos|recommend|prescrib|start|stop|increase|decrease|order|treat|urgent)\w*/i.test(text)) issues.push('UNSAFE_CLINICAL_ACTION_LANGUAGE');
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
  const unanchored = typeof text === 'string' ? findUnanchoredSentences(text, claimList, { withheldFields, qualificationReasons }) : [];
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

// Synonyms collapse to one canonical token before matching. Longer phrases
// come first so "hemoglobin a1c" becomes hba1c, not hemoglobin.
const TERM_SYNONYMS = [
  [/\b(?:hemoglobin a1c|haemoglobin a1c|glycated hemoglobin|glycosylated hemoglobin|hb a1c|hba1c|a1c)\b/g, 'hba1c'],
  [/\b(?:high blood pressure|htn)\b/g, 'hypertension'],
  [/\b(?:blood[ -]pressure|bp)\b/g, 'bloodpressure'],
  [/\b(?:blood sugar|blood glucose)\b/g, 'glucose'],
  [/\b(?:heart rate|pulse)\b/g, 'heartrate'],
  [/\b(?:hgb|haemoglobin)\b/g, 'hemoglobin'],
  [/\b(?:sulfonamides?|sulpha|sulfa drugs?)\b/g, 'sulfa'],
  [/\bpenicillins\b/g, 'penicillin'],
  [/\b(?:allergies|allergic)\b/g, 'allergy'],
  [/\banaphylactic\b/g, 'anaphylaxis'],
  [/\b(?:type [12] diabetes|diabetes mellitus|t2dm|dm2)\b/g, 'diabetes'],
  [/\bchronic kidney disease\b/g, 'ckd'],
  [/\b(?:heart failure|chf)\b/g, 'heartfailure'],
  [/\b(?:atrial fibrillation|afib)\b/g, 'afib'],
  [/\bcoronary artery disease\b/g, 'cad'],
];
const CLINICAL_TERMS = new Set([
  // Drugs and drug classes.
  'lisinopril', 'metformin', 'warfarin', 'amoxicillin', 'ampicillin', 'penicillin', 'piperacillin', 'nafcillin', 'sulfamethoxazole', 'trimethoprim', 'sulfadiazine', 'insulin', 'atorvastatin', 'simvastatin', 'rosuvastatin', 'amlodipine', 'losartan', 'hydrochlorothiazide', 'furosemide', 'metoprolol', 'carvedilol', 'aspirin', 'ibuprofen', 'naproxen', 'acetaminophen', 'prednisone', 'albuterol', 'levothyroxine', 'omeprazole', 'apixaban', 'rivaroxaban', 'heparin', 'clopidogrel', 'gabapentin', 'sertraline', 'fluoxetine', 'citalopram', 'digoxin', 'spironolactone', 'glipizide', 'semaglutide', 'ciprofloxacin', 'azithromycin', 'doxycycline', 'cephalexin', 'oxycodone', 'hydrocodone', 'morphine', 'tramadol', 'lithium', 'anticoagulant', 'statin', 'antibiotic', 'opioid',
  // Allergy and reaction terms.
  'allergy', 'anaphylaxis', 'hives', 'urticaria', 'angioedema', 'sulfa', 'latex', 'peanut', 'shellfish', 'codeine', 'iodine',
  // Problems and diagnoses.
  'hypertension', 'diabetes', 'prediabetes', 'asthma', 'copd', 'heartfailure', 'afib', 'ckd', 'cad', 'hyperlipidemia', 'depression', 'anxiety', 'cancer', 'stroke', 'pneumonia', 'obesity', 'hypothyroidism', 'hyperthyroidism', 'sepsis', 'anemia', 'hyperkalemia', 'hypokalemia', 'hyperglycemia', 'hypoglycemia', 'infarction',
  // Labs and vitals.
  'potassium', 'sodium', 'glucose', 'hba1c', 'hemoglobin', 'creatinine', 'egfr', 'ldl', 'hdl', 'cholesterol', 'triglycerides', 'tsh', 'inr', 'platelets', 'wbc', 'bun', 'troponin', 'bloodpressure', 'heartrate', 'bmi', 'weight', 'temperature',
]);
// Common drug-name suffixes catch drugs missing from the explicit list.
const DRUG_SUFFIX = /^[a-z]{3,}(?:pril|sartan|olol|statin|formin|cillin|mycin|floxacin|cycline|dipine|prazole|tidine|oxetine|azepam|parin|xaban|gliptin|gliflozin|glutide|lukast|terol|azole)$/;
const QUANTITY = /(\d+(?:\.\d+)?)\s*(mg\/dl|g\/dl|g\/l|mmol\/l|mmol\/mol|meq\/l|mmhg|mcg|mg|kg|lbs?|ml|iu|units?|bpm|%|percent)?(?![a-z0-9])/g;
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function canonicalText(value) {
  // Field separators become spaces so "problem.hypertension.status" matches.
  let text = String(value ?? '').toLowerCase().replace(/_+/g, ' ').replace(/:(?!\d)/g, ' ').replace(/\.(?=[a-z])/g, ' ');
  for (const [pattern, replacement] of TERM_SYNONYMS) text = text.replace(pattern, replacement);
  return text;
}

function termsIn(text) {
  const found = [];
  for (const match of text.matchAll(/[a-z][a-z0-9]*/g)) {
    if (CLINICAL_TERMS.has(match[0]) || DRUG_SUFFIX.test(match[0])) found.push({ term: match[0], index: match.index });
  }
  return found;
}

const unitKey = (unit) => (!unit ? null : unit === 'percent' ? '%' : unit.replace(/s$/, ''));

function quantitiesIn(text) {
  return [...text.matchAll(QUANTITY)].map((match) => ({ number: String(Number(match[1])), unit: unitKey(match[2]), index: match.index }));
}

const pad = (value) => String(value).padStart(2, '0');
/** Find date expressions as YYYY-MM-DD and remove them from the text. */
function extractDates(text) {
  const dates = [];
  let rest = text.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})(?:t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?)?(?![\d-])/g, (_, y, m, d) => { dates.push(`${y}-${pad(m)}-${pad(d)}`); return ' '; });
  rest = rest.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_, m, d, y) => { dates.push(`${y}-${pad(m)}-${pad(d)}`); return ' '; });
  rest = rest.replace(/\b([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})\b/g, (whole, month, d, y) => {
    if (!MONTHS[month]) return whole;
    dates.push(`${y}-${pad(MONTHS[month])}-${pad(d)}`);
    return ' ';
  });
  rest = rest.replace(/\b(\d{1,2}) ([a-z]{3,9}),? (\d{4})\b/g, (whole, d, month, y) => {
    if (!MONTHS[month]) return whole;
    dates.push(`${y}-${pad(MONTHS[month])}-${pad(d)}`);
    return ' ';
  });
  // A time of day is part of a date reference, not a clinical quantity.
  rest = rest.replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|z|utc))?\b/g, ' ');
  return { dates, rest };
}

/**
 * Normalize an allowed value into an anchor. Accepts a string, a briefing
 * claim ({ field, value, evidence[] }), a record ({ field, value,
 * recorded_at, source_ref }), or a W2 citation-like value
 * ({ source_id, field_or_chunk_id, quote_or_value }).
 */
function anchorFrom(entry) {
  const item = typeof entry === 'string' || typeof entry === 'number' ? { value: String(entry) } : (entry || {});
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  const rawValue = item.value ?? item.quote_or_value ?? '';
  const valueText = canonicalText(typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue));
  const field = item.field ?? item.field_or_chunk_id ?? '';
  const labelText = field ? canonicalText(`${clinicalLabel(field)} ${field}`) : '';
  const text = `${labelText} ${valueText} ${canonicalText([item.label, ...evidence.map((source) => source?.excerpt)].filter(Boolean).join(' '))}`;
  const dates = [item.recorded_at, item.collection_date, ...evidence.map((source) => source?.recorded_at)]
    .map((value) => String(value || '').slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const sourceIds = [item.id, item.source_ref, item.source_id, ...evidence.map((source) => source?.source_ref)].filter((value) => typeof value === 'string' && value);
  return {
    terms: new Set(termsIn(text).map((match) => match.term)),
    // Dates inside a value are dates, not quantities.
    quantities: quantitiesIn(extractDates(valueText).rest),
    dates: new Set(dates),
    sourceIds: new Set(sourceIds),
    field: typeof field === 'string' && field ? field : null,
    normalizedValue: valueText.replace(/[^a-z0-9%.]+/g, ' ').trim(),
  };
}

/**
 * A citation resolves to an allowed value when they share a source id and do
 * not name different fields (one document holds many fields), or when the
 * cited quote equals the allowed value.
 */
function citationResolves(cited, anchor) {
  const sameSource = [...cited.sourceIds].some((id) => anchor.sourceIds.has(id));
  const fieldsAgree = !cited.field || !anchor.field || cited.field === anchor.field;
  return (sameSource && fieldsAgree) || Boolean(cited.normalizedValue && anchor.normalizedValue === cited.normalizedValue);
}

function splitSentences(text) {
  return String(text).split(/(?<=[.!?…])["”’')\]]*\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
}

const DIRECTIVE_LANGUAGE = /\b(diagnos|recommend|prescrib|start|stop|increase|decrease|order|treat|urgent)\w*/i;

/**
 * Judge one sentence against anchors. `contextTerms` may be named but never
 * anchor a number. Returns { status, reasons } where status is `anchored`,
 * `unanchored`, or `no_clinical_assertion`.
 */
function judgeSentence(sentence, anchors, contextTerms, { checkDirectiveLanguage = false } = {}) {
  const knownTerms = new Set([...contextTerms, ...anchors.flatMap((anchor) => [...anchor.terms])]);
  const knownDates = new Set(anchors.flatMap((anchor) => [...anchor.dates]));
  const { dates, rest } = extractDates(canonicalText(sentence));
  const terms = termsIn(rest);
  const quantities = quantitiesIn(rest);
  const reasons = new Set();
  if (checkDirectiveLanguage && DIRECTIVE_LANGUAGE.test(sentence)) reasons.add('DIRECTIVE_LANGUAGE');
  if (dates.some((date) => !knownDates.has(date))) reasons.add('UNANCHORED_DATE');
  if (terms.some(({ term }) => !knownTerms.has(term))) reasons.add('UNANCHORED_TERM');
  for (const quantity of quantities) {
    // Pair each number with the nearest clinical term in the sentence, so a
    // real value cannot be borrowed from a different drug or lab.
    const nearest = terms.reduce((best, match) => (!best || Math.abs(match.index - quantity.index) < Math.abs(best.index - quantity.index) ? match : best), null);
    const supported = anchors.some((anchor) => (!nearest || anchor.terms.has(nearest.term)) && anchor.quantities.some((candidate) => candidate.number === quantity.number && (!quantity.unit || !candidate.unit || candidate.unit === quantity.unit)));
    if (!supported) reasons.add('UNANCHORED_QUANTITY');
  }
  const assertion = dates.length > 0 || terms.length > 0 || quantities.length > 0;
  return { status: reasons.size ? 'unanchored' : assertion ? 'anchored' : 'no_clinical_assertion', reasons: [...reasons] };
}

const contextTermsFrom = (values) => termsIn(canonicalText((Array.isArray(values) ? values : []).join(' '))).map((match) => match.term);

function findUnanchoredSentences(text, claims, { withheldFields = [], qualificationReasons = [] } = {}) {
  const anchors = claims.map(anchorFrom);
  const contextTerms = contextTermsFrom([...withheldFields, ...qualificationReasons]);
  return splitSentences(text)
    .map((sentence, index) => ({ sentence_index: index, ...judgeSentence(sentence, anchors, contextTerms) }))
    .filter((verdict) => verdict.status === 'unanchored')
    .map(({ sentence_index, reasons }) => ({ sentence_index, reasons }));
}

/**
 * Per-claim verification API for answer composers (the W1 briefing and the
 * W2 grounded answer).
 *
 * Input, one of:
 * - `text`: free text; each sentence gets a verdict against all allowed values.
 * - `claims`: `[{ text, citations? }]`; each claim gets a verdict. A claim that
 *   makes a clinical assertion must carry at least one citation. Each citation
 *   must resolve to an allowed value: same `source_id`/`source_ref`/`id` and
 *   no conflicting `field_or_chunk_id`/`field`, or an equal normalized
 *   `quote_or_value`. The claim is
 *   then checked only against the values its citations resolve to, so citing
 *   one record cannot launder a value from another.
 * `allowedValues`: the verified facts the answer may state (strings, briefing
 * claims, records, or citation-like objects).
 * `contextTerms`: optional strings (withheld fields, qualification reasons)
 * whose clinical terms may be named but never anchor numbers.
 *
 * Returns `{ status, issues, verdicts }`. Verdicts carry indexes and reason
 * codes only, never the text itself.
 */
export function verifyClaims({ text = null, claims = null, allowedValues = [], contextTerms = [], checkDirectiveLanguage = true } = {}) {
  const anchors = (Array.isArray(allowedValues) ? allowedValues : []).map(anchorFrom);
  const context = contextTermsFrom(contextTerms);
  const options = { checkDirectiveLanguage };
  const verdicts = Array.isArray(claims)
    ? claims.map((claim, index) => verdictForClaim(claim, index, anchors, context, options))
    : splitSentences(typeof text === 'string' ? text : '').map((sentence, index) => ({ kind: 'sentence', index, ...judgeSentence(sentence, anchors, context, options) }));
  const reasons = new Set(verdicts.flatMap((verdict) => verdict.reasons));
  const issues = [];
  if (!verdicts.length) issues.push('EMPTY_MODEL_OUTPUT');
  if ([...reasons].some((reason) => reason.startsWith('UNANCHORED_'))) issues.push('UNANCHORED_CLAIM');
  if (reasons.has('UNCITED_CLAIM')) issues.push('UNCITED_CLAIM');
  if (reasons.has('CITATION_NOT_ALLOWED')) issues.push('CITATION_NOT_ALLOWED');
  if (reasons.has('DIRECTIVE_LANGUAGE')) issues.push('UNSAFE_CLINICAL_ACTION_LANGUAGE');
  if (reasons.has('EMPTY_CLAIM')) issues.push('EMPTY_CLAIM');
  return { status: issues.length ? 'failed' : 'passed', issues, verdicts };
}

function verdictForClaim(claim, index, anchors, context, options) {
  const claimText = typeof claim?.text === 'string' ? claim.text : '';
  const citations = Array.isArray(claim?.citations) ? claim.citations : [];
  const reasons = new Set();
  let scoped = anchors;
  if (citations.length) {
    const resolved = citations.map((citation) => {
      const cited = anchorFrom(citation);
      return anchors.filter((anchor) => citationResolves(cited, anchor));
    });
    if (resolved.some((matches) => !matches.length)) reasons.add('CITATION_NOT_ALLOWED');
    scoped = resolved.flat();
  }
  const sentences = splitSentences(claimText).map((sentence, sentenceIndex) => ({ sentence_index: sentenceIndex, ...judgeSentence(sentence, scoped, context, options) }));
  sentences.forEach((sentence) => sentence.reasons.forEach((reason) => reasons.add(reason)));
  const assertion = sentences.some((sentence) => sentence.status !== 'no_clinical_assertion');
  if (assertion && !citations.length) reasons.add('UNCITED_CLAIM');
  if (!claimText.trim()) reasons.add('EMPTY_CLAIM');
  return { kind: 'claim', index, status: reasons.size ? 'unanchored' : assertion ? 'anchored' : 'no_clinical_assertion', reasons: [...reasons], sentences };
}

