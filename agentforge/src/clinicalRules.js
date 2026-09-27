/**
 * Deterministic clinical domain rules for the W2 grounded answer (lane
 * F-CLIN; W1 review debt item 3, PLAN.md row W1-SF2).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    AgentForge
 * @copyright Copyright (c) 2026 AgentForge
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 *
 * Three rules, no model calls. A rule reads only typed facts that already
 * cleared the answer's confidence threshold (`answerComposer.js#
 * partitionAnswerInputs`) and can do exactly two things:
 *
 *   1. add a cited safety flag (`safety_flags` on the grounded answer), whose
 *      `citations` are the unchanged 5-key citations of the facts that
 *      triggered it; or
 *   2. move a lab result out of the answer and into `needs_review` with a
 *      reason code, when the rule cannot be applied safely (unrecognized
 *      unit, unparseable value) or the document's own flag contradicts the
 *      numeric range.
 *
 * A rule never invents, converts or rewrites a value. Each threshold names
 * its source in `threshold_source`:
 *
 *   - Critical potassium: an adult result of 3.0 mmol/L or less, or 6.0
 *     mmol/L or greater, is a `critical_value` flag. The guideline corpus has
 *     no potassium chunk, so the source is a public laboratory critical-value
 *     list: Parrish Medical Center, "Clinical Laboratory Critical Value List"
 *     (QC.doc.11, revised 2017-01-31), Potassium, Adult (no hemolysis): "Low:
 *     3.0 mmol/L or less", "High: 6.0 mmol/L or greater". Critical limits
 *     vary by laboratory (a 2002 CAP survey of 623 US laboratories found low
 *     limits from 2.5 to 3.0 mmol/L), so this is one documented list, not a
 *     universal cutoff. mEq/L equals mmol/L for a monovalent ion such as K+.
 *   - A1C diabetes range: an A1C of 6.5 % or above is a `diabetes_range`
 *     flag, citing the CDC "A1C Ranges" chunk already in the corpus
 *     (`cdc-a1c-diagnostic-ranges`: "Diabetes: 6.5% or above"). If the
 *     document flags that result `normal`, the result goes to needs review
 *     as `flag_contradicts_range` and is not stated as a patient fact (the
 *     same for a `low` flag). An A1C of 20 % or more is implausible and goes
 *     to review as `implausible_value`. Potassium follows the same rule: a
 *     critical value the document flags `normal` (or the opposite direction)
 *     goes to review as `flag_contradicts_range`.
 *   - Allergy vs medication class: a documented penicillin allergy with a
 *     penicillin-class drug among the medications (intake form, medication
 *     list or chart), or a sulfonamide allergy with a sulfonamide
 *     antibiotic, is a `drug_allergy_conflict` flag citing both facts.
 *     Class membership: MedlinePlus Drug Information ("Amoxicillin is in a
 *     class of medications called penicillin-like antibiotics", a685001;
 *     "Ampicillin is in a class of medications called penicillins",
 *     a685002; "Co-trimoxazole is in a class of medications called
 *     sulfonamides", a684026) and the WHO ATC index groups J01C
 *     (beta-lactam antibacterials, penicillins) and J01E (sulfonamides and
 *     trimethoprim).
 *
 * Allergy entries: only a whole-entry "none"/NKDA/NKA statement records no
 * allergy. A named substance with an unknown reaction is an allergy. A
 * medication recorded as stopped or ended (in its line, or by a chart
 * status/end-date record) does not trigger a conflict.
 *
 * Flags are not trusted because a rule produced them: flag text is a fixed
 * template (see "Rules" below), and `answerComposer.js#verifySafetyFlags`
 * runs every flag's grounding facts through `verifyClaims` before it ships
 * (a failure is dropped and counted as `safety_flags_dropped`). The critic
 * reviews flags like claims, but a veto only marks a verified flag
 * questioned (`critic_flags_questioned`); it never hides it (`critic.js`).
 *
 * Out of scope, on purpose: age-specific potassium limits (the fixtures are
 * adults), cross-reactivity between classes (e.g. penicillin and
 * cephalosporins), and low-confidence facts (already in needs review, so
 * no rule speaks for them).
 */
import { loadGuidelineCorpus } from './guidelineEvidence.js';

export const SAFETY_FLAG_CODES = Object.freeze(['critical_value', 'diabetes_range', 'drug_allergy_conflict']);

/** Needs-review reason codes a rule can add (codes only; no values). */
export const RULE_REVIEW_REASONS = Object.freeze(['flag_contradicts_range', 'rule_unit_unrecognized', 'rule_value_unparseable', 'implausible_value']);

// ---- Potassium ------------------------------------------------------------

export const POTASSIUM_CRITICAL_LOW_MMOL_L = 3.0;
export const POTASSIUM_CRITICAL_HIGH_MMOL_L = 6.0;
const POTASSIUM_SOURCE = Object.freeze({
  kind: 'public_reference',
  publisher: 'Parrish Medical Center Laboratory',
  title: 'Clinical Laboratory Critical Value List (QC.doc.11, revised 2017-01-31): Potassium, Adult (no hemolysis)',
  url: 'https://www.parrishhealthcare.com/documents/content/Laboratory-Critical-Value-List3.pdf',
});
const POTASSIUM_UNITS = new Set(['mmol/l', 'meq/l']);

// ---- A1C --------------------------------------------------------------------

export const A1C_DIABETES_THRESHOLD_PERCENT = 6.5;
const A1C_CHUNK_ID = 'cdc-a1c-diagnostic-ranges';
const A1C_CHUNK_SPAN = 'Diabetes: 6.5% or above';

/**
 * The A1C threshold's source, read from the corpus the retriever serves.
 * Throws if the chunk is missing or no longer states the 6.5% threshold:
 * the rule must not keep citing a source that stopped saying it.
 */
function a1cThresholdSource(corpus = loadGuidelineCorpus()) {
  const chunk = corpus.find((item) => item.source_id === A1C_CHUNK_ID);
  if (!chunk || !chunk.text.includes(A1C_CHUNK_SPAN)) throw new Error('CLINICAL_RULE_SOURCE_MISSING:a1c_diabetes_range');
  return Object.freeze({
    kind: 'guideline_corpus',
    publisher: chunk.publisher || 'CDC',
    title: `${chunk.title}: ${chunk.section}`,
    url: chunk.url,
    citation: Object.freeze({ source_type: 'guideline', source_id: chunk.source_id, page_or_section: chunk.section, field_or_chunk_id: chunk.source_id, quote_or_value: chunk.text }),
  });
}

let a1cSourceCache = null;
const A1C_SOURCE = () => (a1cSourceCache ||= a1cThresholdSource());

// ---- Drug classes -------------------------------------------------------------

const CLASS_SOURCE = Object.freeze({
  kind: 'public_reference',
  publisher: 'MedlinePlus (U.S. National Library of Medicine); WHO ATC/DDD Index',
  title: 'MedlinePlus Drug Information (amoxicillin a685001, ampicillin a685002, co-trimoxazole a684026); ATC groups J01C and J01E',
  url: 'https://medlineplus.gov/druginfo/meds/a685001.html',
});

/**
 * Allergy class -> the words that name the allergy, and the drugs in that
 * class. Generic names from ATC J01C / J01E, plus common combinations and
 * brand names whose generic is in the class (Augmentin = amoxicillin/
 * clavulanate; Zosyn = piperacillin/tazobactam; Unasyn = ampicillin/
 * sulbactam; Bactrim/Septra/TMP-SMX = trimethoprim/sulfamethoxazole).
 * `drugs` only ever returns one of these closed names, which is the only
 * patient-derived word a flag's text carries.
 */
export const DRUG_ALLERGY_CLASSES = Object.freeze([
  Object.freeze({
    id: 'penicillins',
    label: 'penicillin',
    allergy: /\b(?:penicillins?|pcn|amoxicillin|ampicillin|piperacillin|augmentin|zosyn|unasyn)\b/i,
    drugs: /\b(?:penicillin(?:\s+[gv]\b)?|amoxicillin|ampicillin|dicloxacillin|nafcillin|oxacillin|piperacillin|ticarcillin|benzylpenicillin|phenoxymethylpenicillin|augmentin|zosyn|unasyn)\b/i,
  }),
  Object.freeze({
    id: 'sulfonamide_antibiotics',
    label: 'sulfonamide',
    allergy: /\b(?:sulfa|sulpha|sulfonamides?|sulfamethoxazole|co-?trimoxazole|bactrim|septra|tmp[\s/-]*smx|smx[\s/-]*tmp)\b/i,
    drugs: /\b(?:sulfamethoxazole|co-?trimoxazole|sulfadiazine|sulfisoxazole|bactrim|septra|tmp[\s/-]*smx|smx[\s/-]*tmp)\b/i,
  }),
]);

/**
 * An allergy entry that states no allergy at all: the whole recorded value
 * is an explicit "none"/NKDA/NKA statement. Only the whole entry counts. A
 * named substance with an unknown or absent reaction ("allergy.penicillin:
 * unknown") IS an allergy, and "Penicillin - hives; no known food allergies"
 * still records a penicillin allergy.
 */
const NO_ALLERGY_ENTRY = /^(?:none|none known|nkda|nka|no known allergies|no known drug allergies|no allergies|no drug allergies|denies allergies|denies any allergies)\.?$/i;

// ---- Helpers ------------------------------------------------------------------

const normalizeUnit = (unit) => String(unit || '').trim().toLowerCase().replace(/\s+/g, '');
const NUMERIC = /^\d+(?:\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const fieldOf = (citation) => String(citation?.field_or_chunk_id || '');

/** Specimen words that may sit next to a test name without changing the test. */
const SPECIMEN_WORDS = new Set(['serum', 'plasma', 'blood', 'whole', 'level', 'lvl', 's', 'p']);

/**
 * Which rule-covered test a lab result is, from its own name or field id.
 * The name is normalized to words first: "Potassium (K)", "K, serum",
 * "Potassium, plasma", "Serum K" and "K+" are potassium; "Vitamin K" is not.
 */
export function labKind(result) {
  const name = String(result?.test_name || '').trim().toLowerCase();
  const field = fieldOf(result?.citation).toLowerCase();
  if (/\b(?:hb)?a1c\b/.test(name) || /\b(?:glycated|glycosylated) (?:hemoglobin|haemoglobin)\b/.test(name) || /^lab\.(?:hb)?a1c\./.test(field)) return 'a1c';
  const words = name.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const core = words.filter((word) => !SPECIMEN_WORDS.has(word));
  if (core.includes('potassium') && core.every((word) => word === 'potassium' || word === 'k')) return 'potassium';
  if (core.length === 1 && core[0] === 'k') return 'potassium';
  if (/^lab\.(?:k|potassium)\./.test(field)) return 'potassium';
  return null;
}

/**
 * The text a rule may read from a citation. A chart fact names the drug or
 * allergen in its field id (`medication.lisinopril.dose`, `allergy.penicillin`)
 * and holds a dose or reaction as its value, so both are read. A document
 * citation is read from its verbatim quote only: some document field ids are
 * fixed labels (the legacy intake layout uses `allergy.penicillin` for any
 * allergy line), so the id says nothing about what the line printed.
 */
const citationText = (citation) => (citation?.source_type === 'document'
  ? String(citation.quote_or_value || '')
  : `${fieldOf(citation).replace(/[._]/g, ' ')} ${citation?.quote_or_value || ''}`);

/** A document line's printed value after its "<label>:", or the whole quote. */
const printedValue = (citation) => {
  const quote = String(citation?.quote_or_value || '');
  const separator = quote.indexOf(':');
  return (separator > 0 ? quote.slice(separator + 1) : quote).trim();
};

/**
 * Whether an allergy citation records no allergy. A chart allergy names its
 * substance in the field id (`allergy.penicillin`), so it states none only
 * when that slug itself is "none"/"nkda"; its value is the reaction or status.
 * A document line states none only when its whole printed value is an
 * explicit NKDA/NKA statement.
 */
function recordsNoAllergy(citation) {
  if (citation?.source_type !== 'document') {
    const slug = fieldOf(citation).split('.').slice(1).join(' ').replace(/_/g, ' ');
    return NO_ALLERGY_ENTRY.test(slug.trim());
  }
  return NO_ALLERGY_ENTRY.test(printedValue(citation));
}

const isAllergyCitation = (citation) => /^allerg/i.test(fieldOf(citation));
const isMedicationCitation = (citation) => /^medication/i.test(fieldOf(citation));

/** A medication line that says it was stopped or ended. */
const ENDED_MEDICATION = /\b(?:discontinued|stopped|ended|completed|no longer taking|d\/c'?d|end(?:ed)?(?:\s+date)?\s*:?\s*\d{4}-\d{2}-\d{2})\b/i;
/** A chart medication status/end-date field (`medication.<drug>.status`, `.end_date`). */
const CHART_MEDICATION_END_FIELD = /^medication\.([a-z0-9_-]+)\.(?:status|end_date|enddate|date_end)$/i;

/**
 * Drugs whose chart record says they ended: a status field whose value says
 * stopped/ended/inactive, or any end-date field with a date. Keyed by the
 * drug slug in the field id, so every chart citation for that drug is skipped.
 */
function endedChartDrugs(citations) {
  const ended = new Set();
  for (const citation of citations) {
    if (citation?.source_type === 'document') continue;
    const match = fieldOf(citation).match(CHART_MEDICATION_END_FIELD);
    if (!match) continue;
    const value = String(citation.quote_or_value || '');
    const isStatus = /status$/i.test(fieldOf(citation));
    if (isStatus ? /\b(?:stopped|discontinued|ended|inactive|completed)\b/i.test(value) : /\d{4}-\d{2}-\d{2}/.test(value)) ended.add(match[1].toLowerCase());
  }
  return ended;
}

function isEndedMedication(citation, endedDrugs) {
  if (ENDED_MEDICATION.test(citationText(citation))) return true;
  if (citation?.source_type === 'document') return false;
  const drug = fieldOf(citation).split('.')[1]?.toLowerCase();
  return Boolean(drug && endedDrugs.has(drug));
}

/** " on 2026-09-20" when the collection date is an ISO date; otherwise nothing (never free text). */
const onDate = (date) => (ISO_DATE.test(String(date || '').trim()) ? ` on ${String(date).trim()}` : '');

// ---- Rules ----------------------------------------------------------------------
//
// Flag text is a fixed template. The only patient-derived parts are a value
// that matched NUMERIC, a unit from a closed set, an ISO date, and a drug
// name from the closed `DRUG_ALLERGY_CLASSES` lists. No raw document or chart
// line is ever copied into it, so a line such as "Amoxicillin - stop taking"
// cannot carry an instruction into a flag.

const POTASSIUM_UNIT_LABEL = Object.freeze({ 'mmol/l': 'mmol/L', 'meq/l': 'mEq/L' });

function potassiumRule(result) {
  const unit = normalizeUnit(result.unit);
  if (!POTASSIUM_UNITS.has(unit)) return { review: 'rule_unit_unrecognized' };
  const value = String(result.value).trim();
  if (!NUMERIC.test(value)) return { review: 'rule_value_unparseable' };
  const number = Number(value);
  const low = number <= POTASSIUM_CRITICAL_LOW_MMOL_L;
  const high = number >= POTASSIUM_CRITICAL_HIGH_MMOL_L;
  if (!low && !high) return {};
  // Same rule as A1C: a document flag that disagrees with the critical range
  // ("normal", or the opposite direction) means one of the two is wrong.
  const documentFlag = result.abnormal_flag;
  if (documentFlag === 'normal' || (low && documentFlag === 'high') || (high && documentFlag === 'low')) return { review: 'flag_contradicts_range' };
  const limit = low ? `${POTASSIUM_CRITICAL_LOW_MMOL_L.toFixed(1)} mmol/L or less` : `${POTASSIUM_CRITICAL_HIGH_MMOL_L.toFixed(1)} mmol/L or greater`;
  return {
    flag: {
      code: 'critical_value',
      rule_id: 'potassium_critical_range',
      severity: 'critical',
      text: `Potassium ${value} ${POTASSIUM_UNIT_LABEL[unit]}${onDate(result.collection_date)} is in the critical range used by this rule (${limit}).`,
      citations: [result.citation],
      threshold_source: POTASSIUM_SOURCE,
    },
    grounding: { labResult: result },
  };
}

/** An A1C at or above this is not a plausible reading; it goes to review, never to a flag. */
export const A1C_IMPLAUSIBLE_PERCENT = 20;

function a1cRule(result) {
  if (normalizeUnit(result.unit) !== '%') return { review: 'rule_unit_unrecognized' };
  const value = String(result.value).trim();
  if (!NUMERIC.test(value)) return { review: 'rule_value_unparseable' };
  const number = Number(value);
  if (number >= A1C_IMPLAUSIBLE_PERCENT) return { review: 'implausible_value' };
  if (number < A1C_DIABETES_THRESHOLD_PERCENT) return {};
  // The document's own flag says "normal" (or "low") for a value in the diabetes range:
  // one of the two is wrong, and the rule cannot tell which. Neither is trusted.
  if (result.abnormal_flag === 'normal' || result.abnormal_flag === 'low') return { review: 'flag_contradicts_range' };
  const source = A1C_SOURCE();
  return {
    flag: {
      code: 'diabetes_range',
      rule_id: 'a1c_diabetes_range',
      severity: 'warning',
      text: `A1C ${value} %${onDate(result.collection_date)} is in the CDC diabetes range (6.5% or above).`,
      citations: [result.citation, source.citation],
      threshold_source: source,
    },
    grounding: { labResult: result },
  };
}

/**
 * Allergy vs medication class. `citations` are every intake, medication-list
 * and chart citation the answer may use; allergies and medications are told
 * apart by their field id (`allergies`/`allergy.*`, `medications`/
 * `medication.*`), never by guessing from free text. A medication recorded
 * as stopped or ended is skipped.
 */
function drugAllergyFlags(citations) {
  const allergies = citations.filter(isAllergyCitation).filter((citation) => !recordsNoAllergy(citation));
  const endedDrugs = endedChartDrugs(citations);
  const medications = citations.filter(isMedicationCitation).filter((citation) => !isEndedMedication(citation, endedDrugs));
  const flags = [];
  const seen = new Set();
  for (const drugClass of DRUG_ALLERGY_CLASSES) {
    for (const allergy of allergies) {
      if (!drugClass.allergy.test(citationText(allergy))) continue;
      for (const medication of medications) {
        const drug = citationText(medication).match(drugClass.drugs)?.[0];
        if (!drug) continue;
        // One flag per allergy, drug and source record: a chart drug has
        // several records (dose, status), and they are one medication.
        const medicationKey = medication.source_type === 'document' ? `${medication.source_id}:${fieldOf(medication)}` : `chart:${fieldOf(medication).split('.')[1] || fieldOf(medication)}`;
        const key = `${drugClass.id}|${allergy.source_id}:${fieldOf(allergy)}|${medicationKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        flags.push({
          code: 'drug_allergy_conflict',
          rule_id: 'allergy_medication_class',
          severity: 'critical',
          text: `Recorded allergy to a ${drugClass.label} and a recorded ${drugClass.label}-class medication (${drug.toLowerCase().replace(/\s+/g, ' ')}).`,
          citations: [allergy, medication],
          threshold_source: CLASS_SOURCE,
        });
      }
    }
  }
  return flags;
}

/**
 * Apply every rule to the answer's confident inputs.
 *
 * Args:
 *   verifiedLabResults: typed `LabResult`s at or above the confidence
 *     threshold.
 *   factCitations: intake, medication-list and chart citations at or above
 *     the threshold (the allergy/medication rule reads these).
 *
 * Returns `{ labResults, needsReview, safetyFlags }`: `labResults` are the
 * results the answer may still state (a result a rule sent to review is
 * removed), `needsReview` the `NeedsReviewItem`s the rules added, and
 * `safetyFlags` the cited flags.
 */
export function applyClinicalRules({ verifiedLabResults = [], factCitations = [] } = {}) {
  const labResults = [];
  const needsReview = [];
  const safetyFlags = [];
  for (const result of verifiedLabResults) {
    const kind = labKind(result);
    const outcome = kind === 'potassium' ? potassiumRule(result) : kind === 'a1c' ? a1cRule(result) : {};
    if (outcome.review) {
      needsReview.push({ kind: 'lab_result', field: result.citation?.field_or_chunk_id || result.test_name, reason: outcome.review });
      continue;
    }
    labResults.push(result);
    // `grounding` (the typed result behind a lab flag) is kept off the
    // shipped flag: the composer uses it to verify the flag, then drops it.
    if (outcome.flag) safetyFlags.push(Object.defineProperty(outcome.flag, 'grounding', { value: outcome.grounding, enumerable: false }));
  }
  safetyFlags.push(...drugAllergyFlags(factCitations));
  return { labResults, needsReview, safetyFlags };
}

/** Codes and a count only, for the trace: one code per flag, sorted. */
export function summarizeSafetyFlags(flags = []) {
  return { count: flags.length, codes: flags.map((flag) => flag.code).sort() };
}
