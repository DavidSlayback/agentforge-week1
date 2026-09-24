/**
 * Word lists and patterns used by the grounding verifier. Data only; the
 * matching logic lives in groundingText.js and claimBinding.js.
 */

/**
 * Synonyms collapse to one canonical token before matching. Longer phrases
 * come first so "hemoglobin a1c" becomes hba1c, not hemoglobin.
 */
export const TERM_SYNONYMS = Object.freeze([
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
]);

/**
 * Alternate names a `patient_fact` claim may use for a cited `LabResult`'s
 * own test, keyed by that result's raw `test_name` (lowercased, exactly as
 * the source document/OCR prints it). Limited to the lab tests present in
 * the W2 golden-truth fixtures (`test/fixtures/golden/truth/*.json`):
 * "Hemoglobin" and "A1C" (recorded as either "A1C" alone or the combined
 * "Hemoglobin A1C" on different fixtures).
 *
 * `claimBinding.js#bindingFact` looks up a `LabResult` fact's own raw label
 * here and adds only that entry's tokens to that one fact's allowed words --
 * never to any other fact. A claim that names "A1C" while citing the plain
 * "Hemoglobin" result still fails: "a1c"/"hba1c" is not in the "hemoglobin"
 * entry's alias list, so it is an unsupported token there.
 */
export const LAB_NAME_ALIASES = Object.freeze({
  a1c: ['a1c', 'hba1c', 'hemoglobin a1c', 'glycated hemoglobin', 'glycosylated hemoglobin'],
  'hemoglobin a1c': ['a1c', 'hba1c', 'hemoglobin a1c', 'glycated hemoglobin', 'glycosylated hemoglobin'],
  hemoglobin: ['hemoglobin', 'hgb', 'hb'],
});

const DRUGS = [
  'lisinopril', 'metformin', 'warfarin', 'amoxicillin', 'ampicillin', 'penicillin', 'piperacillin',
  'nafcillin', 'sulfamethoxazole', 'trimethoprim', 'sulfadiazine', 'insulin', 'atorvastatin',
  'simvastatin', 'rosuvastatin', 'amlodipine', 'losartan', 'hydrochlorothiazide', 'furosemide',
  'metoprolol', 'carvedilol', 'aspirin', 'ibuprofen', 'naproxen', 'acetaminophen', 'prednisone',
  'albuterol', 'levothyroxine', 'synthroid', 'omeprazole', 'apixaban', 'eliquis', 'rivaroxaban',
  'heparin', 'clopidogrel', 'gabapentin', 'sertraline', 'fluoxetine', 'citalopram', 'digoxin',
  'spironolactone', 'glipizide', 'semaglutide', 'empagliflozin', 'jardiance', 'tacrolimus',
  'ciprofloxacin', 'azithromycin', 'doxycycline', 'cephalexin', 'oxycodone', 'hydrocodone',
  'morphine', 'tramadol', 'lithium', 'anticoagulant', 'statin', 'antibiotic', 'opioid',
];
const ALLERGY_TERMS = ['allergy', 'anaphylaxis', 'hives', 'urticaria', 'angioedema', 'sulfa', 'latex', 'peanut', 'shellfish', 'codeine', 'iodine'];
const PROBLEMS = [
  'hypertension', 'diabetes', 'prediabetes', 'asthma', 'copd', 'heartfailure', 'afib', 'ckd', 'cad',
  'hyperlipidemia', 'depression', 'anxiety', 'cancer', 'stroke', 'pneumonia', 'obesity',
  'hypothyroidism', 'hyperthyroidism', 'sepsis', 'anemia', 'hyperkalemia', 'hypokalemia',
  'hyperglycemia', 'hypoglycemia', 'infarction',
];
const LABS_AND_VITALS = [
  'potassium', 'sodium', 'glucose', 'hba1c', 'hemoglobin', 'creatinine', 'egfr', 'ldl', 'hdl',
  'cholesterol', 'triglycerides', 'tsh', 'inr', 'platelets', 'wbc', 'bun', 'troponin',
  'bloodpressure', 'heartrate', 'bmi', 'weight', 'temperature',
];
/** Drug, allergy, problem, lab, and vital terms (canonical forms). */
export const CLINICAL_TERMS = new Set([...DRUGS, ...ALLERGY_TERMS, ...PROBLEMS, ...LABS_AND_VITALS]);

/** Common drug-name suffixes catch drugs missing from the explicit list. */
export const DRUG_SUFFIX = /^[a-z]{3,}(?:pril|sartan|olol|statin|formin|cillin|mycin|floxacin|cycline|dipine|prazole|tidine|oxetine|azepam|parin|xaban|gliptin|gliflozin|glutide|lukast|terol|azole|limus)$/;

/** Number plus optional unit, as used by the sentence-level (text) check. */
export const QUANTITY = /(\d+(?:\.\d+)?)\s*(mg\/dl|g\/dl|g\/l|mmol\/l|mmol\/mol|meq\/l|mmhg|mcg|mg|kg|lbs?|ml|iu|units?|bpm|%|percent)?(?![a-z0-9])/g;

export const MONTHS = Object.freeze({
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9,
  october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
});

export const SPELLED_NUMBERS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'thousand', 'half', 'double',
  'single', 'once', 'twice', 'thrice',
]);
export const COMPARATIVES = new Set([
  'higher', 'lower', 'more', 'less', 'greater', 'fewer', 'increased', 'decreased', 'doubled',
  'halved', 'tripled', 'reduced', 'raised', 'up', 'down', 'better', 'worse', 'improved', 'worsened',
]);
export const STATUS_WORDS = new Set([
  'started', 'stopped', 'discontinued', 'resumed', 'held', 'paused', 'initiated', 'ceased', 'changed',
  'switched', 'titrated', 'added', 'removed', 'active', 'inactive', 'resolved', 'chronic', 'new',
]);
export const FREQUENCY_WORDS = new Set(['daily', 'twice', 'bid', 'tid', 'qid', 'qd', 'weekly', 'monthly', 'nightly', 'hourly', 'prn', 'every', 'per']);
export const UNIT_WORDS = new Set([
  'mg', 'mcg', 'g', 'kg', 'lb', 'lbs', 'ml', 'l', 'iu', 'unit', 'units', 'bpm', 'mmhg', '%', 'percent',
  'mg/dl', 'g/dl', 'g/l', 'mmol/l', 'mmol/mol', 'meq/l', 'milligram', 'milligrams', 'gram', 'grams',
]);
/** Interpretive words are supported only by typed flags or reference ranges. */
export const INTERPRETIVE_WORDS = new Set([
  'low', 'high', 'critical', 'critically', 'abnormal', 'normal', 'elevated', 'above', 'below',
  'within', 'borderline', 'markedly', 'severely', 'mildly', 'significant', 'significantly',
]);
export const INTERPRETIVE_BY_FLAG = Object.freeze({
  high: ['high', 'elevated', 'above', 'abnormal'],
  low: ['low', 'below', 'abnormal'],
  abnormal: ['abnormal'],
  normal: ['normal', 'within'],
  unknown: [],
});
export const NEGATION_CUES = new Set(['no', 'not', 'denies', 'denied', 'without', 'negative', 'none', 'never', 'nkda']);

/**
 * Words a patient-fact claim may use without citation support: function
 * words and neutral reporting verbs. Anything else must come from the values
 * the claim cites (closed vocabulary).
 */
export const BINDING_VOCABULARY = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'of',
  'on', 'in', 'at', 'for', 'to', 'from', 'with', 'by', 'and', 'or', 'as', 'this', 'that', 'these',
  'those', 'it', 'its', 'their', 'there', 'which', 'who', 'also', 'both', 'each', 'patient',
  'patients', 's', 'pt', 'record', 'records', 'recorded', 'documented', 'document', 'documents',
  'chart', 'charted', 'lists', 'listed', 'list', 'shows', 'shown', 'notes', 'noted', 'reports',
  'reported', 'states', 'stated', 'form', 'intake', 'lab', 'labs', 'result', 'results', 'value',
  'values', 'level', 'levels', 'dose', 'dosage', 'takes', 'taking', 'current', 'currently', 'most',
  'recent', 'latest', 'last', 'collected', 'dated', 'date', 'measured', 'reading', 'test', 'tested',
  'file', 'source', 'visit', 'range', 'reference', 'reason', 'flag', 'flagged',
]);
/** Extra words allowed outside the verbatim span of a guideline claim. */
export const GUIDELINE_VOCABULARY = new Set([
  'recommends', 'recommend', 'recommendation', 'recommendations', 'according', 'guideline',
  'guidelines', 'standards', 'standard', 'care', 'per', 'says', 'advises', 'section', 'quote',
]);
/** Extra words a framing claim may use; framing states no clinical content. */
export const FRAMING_VOCABULARY = new Set([
  'here', 'following', 'summary', 'briefing', 'answer', 'question', 'evidence',
  'available', 'found', 'retrieved', 'review', 'reviewed', 'incomplete', 'withheld', 'conflicting',
  'conflict', 'conflicts', 'qualified', 'cannot', 'could', 'not', 'no', 'established', 'determined',
  'unavailable', 'because', 'only', 'based', 'data', 'information', 'what', 'provided', 'missing',
  'partial', 'unresolved', 'sources', 'documentation', 'see', 'details', 'if', 'any', 'why', 'how',
]);

/**
 * Broad directive check kept for verifyGeneratedText (W1 briefing prose): any
 * directive stem fails the whole text.
 */
export const DIRECTIVE_LANGUAGE = /\b(diagnos|recommend|prescrib|start|stop|increase|decrease|order|treat|urgent)\w*/i;

const ACTION = 'start|stop|increase|decrease|begin|discontinue|hold|titrate|add|switch|order|prescribe|give|administer|consider|continue|avoid|reduce|resume|initiate|check|repeat|refer|schedule|take|treat|use';
const ACTION_STEM = 'start|stop|increas|decreas|begin|begun|discontinu|hold|held|titrat|add|switch|order|prescrib|give|given|administ|continu|avoid|reduc|resum|initiat|refer|treat';
const ACTION_GERUND = 'starting|stopping|increasing|decreasing|beginning|discontinuing|holding|titrating|adding|switching|ordering|prescribing|giving|initiating|resuming|treating';
/**
 * Scoped directive check for claims: imperative, second-person, or
 * recommendation-to-act forms aimed at the clinician or patient. Descriptive
 * past tense ("was started", "was diagnosed", "current treatment") passes.
 */
export const DIRECTIVE_PATTERNS = Object.freeze([
  new RegExp(`^(?:please\\s+)?(?:${ACTION})\\b`),
  /\b(?:you|we)\s+(?:should|must|need to|ought to|may want to|might want to|could|can|will)\b/,
  new RegExp(`\\b(?:should|must|needs? to|ought to)\\s+(?:be\\s+)?(?:${ACTION_STEM})\\w*`),
  new RegExp(`\\b(?:consider|recommend(?:s|ed)?|advise[sd]?|suggest(?:s|ed)?)\\s+(?:${ACTION_GERUND}|to\\s+(?:${ACTION}))\\b`),
  /\bi\s+(?:recommend|suggest|advise)\b/,
  /\b(?:it is|is)\s+(?:recommended|advised|suggested)\s+(?:to|that)\b/,
]);
