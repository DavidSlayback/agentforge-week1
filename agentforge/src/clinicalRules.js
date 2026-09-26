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
 *     same for a `low` flag).
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
 * Out of scope, on purpose: age-specific potassium limits (the fixtures are
 * adults), cross-reactivity between classes (e.g. penicillin and
 * cephalosporins), and low-confidence facts (already in needs review, so
 * no rule speaks for them).
 */
import { loadGuidelineCorpus } from './guidelineEvidence.js';

export const SAFETY_FLAG_CODES = Object.freeze(['critical_value', 'diabetes_range', 'drug_allergy_conflict']);

/** Needs-review reason codes a rule can add (codes only; no values). */
export const RULE_REVIEW_REASONS = Object.freeze(['flag_contradicts_range', 'rule_unit_unrecognized', 'rule_value_unparseable']);

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
 * class. Generic names from ATC J01C / J01E, plus brand names whose generic
 * is in the class (Augmentin = amoxicillin/clavulanate; Bactrim/Septra =
 * sulfamethoxazole/trimethoprim).
 */
export const DRUG_ALLERGY_CLASSES = Object.freeze([
  Object.freeze({
    id: 'penicillins',
    label: 'penicillin',
    allergy: /\b(?:penicillins?|pcn|amoxicillin|ampicillin)\b/i,
    drugs: /\b(?:penicillin(?:\s+[gv])?|amoxicillin|ampicillin|dicloxacillin|nafcillin|oxacillin|piperacillin|ticarcillin|benzylpenicillin|phenoxymethylpenicillin|augmentin)\b/i,
  }),
  Object.freeze({
    id: 'sulfonamide_antibiotics',
    label: 'sulfonamide',
    allergy: /\b(?:sulfa|sulpha|sulfonamides?|sulfamethoxazole|co-?trimoxazole)\b/i,
    drugs: /\b(?:sulfamethoxazole|co-?trimoxazole|sulfadiazine|sulfisoxazole|bactrim|septra)\b/i,
  }),
]);

/** An allergy entry that records the absence or an unknown status is not a documented allergy. */
const NOT_AN_ALLERGY = /\b(?:no known|none|nkda|nka|denies|denied|negative|unknown|not allergic|resolved|inactive|entered in error)\b/i;

// ---- Helpers ------------------------------------------------------------------

const normalizeUnit = (unit) => String(unit || '').trim().toLowerCase().replace(/\s+/g, '');
const NUMERIC = /^\d+(?:\.\d+)?$/;
const fieldOf = (citation) => String(citation?.field_or_chunk_id || '');

/** Which rule-covered test a lab result is, from its own name or field id. */
export function labKind(result) {
  const name = String(result?.test_name || '').trim().toLowerCase();
  const field = fieldOf(result?.citation).toLowerCase();
  if (/\b(?:hb)?a1c\b/.test(name) || /^lab\.(?:hb)?a1c\./.test(field)) return 'a1c';
  if (/^(?:potassium|k\+?|serum potassium|potassium,? serum)$/.test(name) || /^lab\.(?:k|potassium)\./.test(field)) return 'potassium';
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

/** What the flag text shows for one cited fact: a document line's printed value (after "<label>:"), or a chart fact's field id and value. */
const quotedValue = (citation) => {
  const quote = String(citation?.quote_or_value || '');
  if (citation?.source_type !== 'document') return `${fieldOf(citation)}: ${quote}`;
  const separator = quote.indexOf(':');
  return separator > 0 && /^(?:allerg|medication|current medication)/i.test(quote.slice(0, separator).trim()) ? quote.slice(separator + 1) : quote;
};

const isAllergyCitation = (citation) => /^allerg/i.test(fieldOf(citation));
const isMedicationCitation = (citation) => /^medication/i.test(fieldOf(citation));

// ---- Rules ----------------------------------------------------------------------

function potassiumRule(result) {
  const unit = normalizeUnit(result.unit);
  if (!POTASSIUM_UNITS.has(unit)) return { review: 'rule_unit_unrecognized' };
  const value = String(result.value).trim();
  if (!NUMERIC.test(value)) return { review: 'rule_value_unparseable' };
  const number = Number(value);
  const low = number <= POTASSIUM_CRITICAL_LOW_MMOL_L;
  const high = number >= POTASSIUM_CRITICAL_HIGH_MMOL_L;
  if (!low && !high) return {};
  const limit = low ? `${POTASSIUM_CRITICAL_LOW_MMOL_L.toFixed(1)} mmol/L or less` : `${POTASSIUM_CRITICAL_HIGH_MMOL_L.toFixed(1)} mmol/L or greater`;
  return {
    flag: {
      code: 'critical_value',
      rule_id: 'potassium_critical_range',
      severity: 'critical',
      text: `${result.test_name} ${value} ${result.unit} on ${result.collection_date} is in the critical range used by this rule (${limit}).`,
      citations: [result.citation],
      threshold_source: POTASSIUM_SOURCE,
    },
  };
}

function a1cRule(result) {
  if (normalizeUnit(result.unit) !== '%') return { review: 'rule_unit_unrecognized' };
  const value = String(result.value).trim();
  if (!NUMERIC.test(value)) return { review: 'rule_value_unparseable' };
  if (Number(value) < A1C_DIABETES_THRESHOLD_PERCENT) return {};
  // The document's own flag says "normal" (or "low") for a value in the diabetes range:
  // one of the two is wrong, and the rule cannot tell which. Neither is trusted.
  if (result.abnormal_flag === 'normal' || result.abnormal_flag === 'low') return { review: 'flag_contradicts_range' };
  const source = A1C_SOURCE();
  return {
    flag: {
      code: 'diabetes_range',
      rule_id: 'a1c_diabetes_range',
      severity: 'warning',
      text: `${result.test_name} ${value} ${result.unit} on ${result.collection_date} is in the CDC diabetes range (6.5% or above).`,
      citations: [result.citation, source.citation],
      threshold_source: source,
    },
  };
}

/**
 * Allergy vs medication class. `citations` are every intake, medication-list
 * and chart citation the answer may use; allergies and medications are told
 * apart by their field id (`allergies`/`allergy.*`, `medications`/
 * `medication.*`), never by guessing from free text.
 */
function drugAllergyFlags(citations) {
  const allergies = citations.filter(isAllergyCitation).filter((citation) => !NOT_AN_ALLERGY.test(citationText(citation)));
  const medications = citations.filter(isMedicationCitation);
  const flags = [];
  const seen = new Set();
  for (const drugClass of DRUG_ALLERGY_CLASSES) {
    for (const allergy of allergies) {
      if (!drugClass.allergy.test(citationText(allergy))) continue;
      for (const medication of medications) {
        const drug = citationText(medication).match(drugClass.drugs)?.[0];
        if (!drug) continue;
        const key = `${drugClass.id}|${allergy.source_id}:${fieldOf(allergy)}|${medication.source_id}:${fieldOf(medication)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        flags.push({
          code: 'drug_allergy_conflict',
          rule_id: 'allergy_medication_class',
          severity: 'critical',
          text: `A ${drugClass.label} allergy is recorded (${quotedValue(allergy).trim()}) and a ${drugClass.label}-class medication is listed (${quotedValue(medication).trim()}).`,
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
    if (outcome.flag) safetyFlags.push(outcome.flag);
  }
  safetyFlags.push(...drugAllergyFlags(factCitations));
  return { labResults, needsReview, safetyFlags };
}

/** Codes and a count only, for the trace: one code per flag, sorted. */
export function summarizeSafetyFlags(flags = []) {
  return { count: flags.length, codes: flags.map((flag) => flag.code).sort() };
}
