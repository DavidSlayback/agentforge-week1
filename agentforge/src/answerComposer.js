/**
 * W2 grounded-answer composer (S6, PLAN.md "Supervisor decisions and the
 * grounded answer").
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    AgentForge
 * @copyright Copyright (c) 2026 AgentForge
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 *
 * Answers the W2 scenario question ("what changed, what should I pay
 * attention to, and what evidence supports the recommendation") from exactly
 * three inputs: this document's typed extraction (lab results / intake
 * form), the top guideline evidence the evidence-retrieval worker already
 * found, and patient-record facts read from the chart. A model composes
 * `{claims:[{kind, text, citations}]}` (the `GroundedAnswer` Zod contract);
 * every claim is then run through `verifyClaims` (claimBinding.js) against
 * exactly those inputs. A claim that does not verify is dropped, not
 * repaired or trusted — the composer never returns a claim the verifier did
 * not independently confirm.
 *
 * Two composers, one contract: `runComposer` calls whichever provider it is
 * given (the real model, or `DeterministicAnswerComposer`) and always
 * verifies the result the same way, so the fallback is not a "trust me"
 * shortcut — it is graded by the identical rule.
 */
import { verifyClaims } from './claimBinding.js';
import { canonicalText } from './groundingText.js';
import { GroundedAnswer, parseOrIssues } from './schemas.js';

/** Facts extracted with less than this confidence are excluded from the
 * answer and reported separately as `needs_review`, never as a patient fact
 * (W2-C7 / documentSafety fail-loud philosophy: an uncertain OCR read must
 * never be presented as a verified value). Matches the OCR review threshold
 * already used for the source-preview UI's low-confidence flag. */
export const LOW_CONFIDENCE_THRESHOLD = 0.85;

/** A direct "what was the X value/result/level" question. Documented, simple
 * rule used by both the supervisor's `record_lookup_only` routing decision
 * and (here) to decide whether guideline evidence belongs in the prompt at
 * all; kept in one place so the two never disagree. */
const RECORD_LOOKUP_QUESTION = /^\s*what\s+(?:is|was|are|were)\s+the\s+[a-z0-9 /%.'-]+?\s+(?:value|values|result|results|level|levels|reading|readings)s?\s*\??\s*$/i;

export function isRecordLookupQuestion(query) {
  return RECORD_LOOKUP_QUESTION.test(String(query || '').trim());
}

/** Human-readable words derived only from a citation's own `field_or_chunk_id`
 * (e.g. "patient.date_of_birth" -> "patient date of birth"), so a claim that
 * names the field is always built from words `claimBinding.js` will also
 * derive from that same citation — never an invented label. */
function fieldWords(fieldOrChunkId) {
  return canonicalText(String(fieldOrChunkId || ''))
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ABNORMAL_FLAG_WORDS = new Set(['high', 'low', 'normal', 'abnormal']);

/**
 * `claimBinding.js`'s tokenizer (`groundingText.js#bindingTokens`) matches a
 * bare `\d+` for numbers with no guard against a letter immediately
 * following (unlike the sentence-level `quantitiesIn`, which excludes that
 * case). A lab code such as "A1C" or "HbA1c" therefore tokenizes as
 * word+NUMBER+word ("hba", "1", "c"), and that stray "1" has no citation to
 * match -- `UNSUPPORTED_NUMBER` -- even though it is part of a name, not a
 * value. Rather than change that shared tokenizer, the deterministic
 * templates below simply never spell out a label containing a digit; a
 * label without one (e.g. "Hemoglobin") is safe to name directly.
 */
const hasEmbeddedDigit = (text) => /\d/.test(String(text || ''));

/**
 * Deterministic patient-fact claim for one typed `LabResult`. Every word
 * outside the cited value/range is drawn from a closed, pre-approved
 * vocabulary (`clinicalVocabulary.js` `BINDING_VOCABULARY`) or the result's
 * own test name, so this always verifies against `claimBinding.js`.
 */
function labResultClaim(result) {
  const flagWord = ABNORMAL_FLAG_WORDS.has(result.abnormal_flag) ? result.abnormal_flag : null;
  const subject = hasEmbeddedDigit(result.test_name) ? 'A lab result' : result.test_name;
  const text = `${subject} was recorded at ${result.value} ${result.unit} on ${result.collection_date}, reference range ${result.reference_range}${flagWord ? `, and is ${flagWord}` : ''}.`;
  return { kind: 'patient_fact', text, citations: [result.citation] };
}

/** Deterministic patient-fact claim for one observed intake-form leaf or one
 * OpenEMR chart-record citation. Both shapes carry a `citation` with a
 * `field_or_chunk_id` but no separate label, so the field name in the claim
 * text is derived from that id the same way `claimBinding.js` will re-derive
 * it, and the value is echoed verbatim. */
function fieldValueClaim(citation) {
  const subject = citation.source_type === 'openemr_record' ? 'The chart records' : 'The intake form records';
  const raw = fieldWords(citation.field_or_chunk_id);
  const descriptor = hasEmbeddedDigit(raw) ? '' : raw;
  const text = (descriptor ? `${subject} ${descriptor} as ${citation.quote_or_value}.` : `${subject} ${citation.quote_or_value}.`).replace(/\s+/g, ' ');
  return { kind: 'patient_fact', text, citations: [citation] };
}

/** Deterministic guideline claim. Quotes the entire chunk verbatim (always
 * satisfies the >= 8-word verbatim-span requirement), with the title/section/
 * version and a short closed set of attribution words outside the quote. */
function guidelineClaim(evidence) {
  const text = `Per ${evidence.title} guideline, section ${evidence.section} (${evidence.version}): "${evidence.snippet}"`;
  return { kind: 'guideline', text, citations: [evidence.citation] };
}

/** Local fallback composer: never calls a model, builds claims directly from
 * the given typed facts so they are guaranteed to verify. Distinct from the
 * W1 `DeterministicProvider` (modelProvider.js), whose `generate()` expects
 * briefing-shaped args (`patient`, `qualification`, `comparison`) the
 * composer never has and would throw on. */
export class DeterministicAnswerComposer {
  name = 'deterministic-answer-composer';
  model = 'fixture-v1';
  async checkReady() { return true; }
  async generate({ verifiedLabResults = [], verifiedIntakeCitations = [], guidelineEvidence = [], patientFactCitations = [] } = {}) {
    const claims = [
      ...verifiedLabResults.map(labResultClaim),
      ...verifiedIntakeCitations.map(fieldValueClaim),
      ...patientFactCitations.map(fieldValueClaim),
      ...guidelineEvidence.map(guidelineClaim),
    ];
    return { text: JSON.stringify({ claims }), inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  }
}

function buildPrompt({ question, verifiedLabResults, verifiedIntakeCitations, guidelineEvidence, patientFactCitations }) {
  const facts = [
    ...verifiedLabResults.map((result) => ({ kind: 'lab_result', test_name: result.test_name, value: result.value, unit: result.unit, reference_range: result.reference_range, collection_date: result.collection_date, abnormal_flag: result.abnormal_flag, citation: result.citation })),
    ...verifiedIntakeCitations.map((citation) => ({ kind: 'intake_field', citation })),
    ...patientFactCitations.map((citation) => ({ kind: 'openemr_record', citation })),
  ];
  return [
    'You are a clinical documentation assistant preparing a return-visit answer.',
    'Answer strictly from the facts and guideline evidence listed below. Copy every cited value, date, and guideline quote verbatim from its source. Never invent a value. Never recommend a treatment, diagnosis, medication change, or other clinical action -- describe only what is documented.',
    'Return ONLY a JSON object of this exact shape, no prose outside it:',
    '{"claims":[{"kind":"patient_fact"|"guideline","text":"...","citations":[{"source_type":"document"|"guideline"|"openemr_record","source_id":"...","page_or_section":"...","field_or_chunk_id":"...","quote_or_value":"..."}]}]}',
    `Clinician question: ${question || '(none provided)'}`,
    `Patient-record facts (JSON): ${JSON.stringify(facts)}`,
    `Guideline evidence (JSON): ${JSON.stringify(guidelineEvidence.map((item) => ({ title: item.title, section: item.section, version: item.version, snippet: item.snippet, citation: item.citation })))}`,
  ].join('\n');
}

/** ResilientProvider `validate` hook: only checks that the candidate is
 * well-formed JSON matching the `GroundedAnswer` contract. Truthfulness is
 * never checked here -- that is `verifyClaims`'s job, after generation. */
function validateModelJson(candidate) {
  let parsed;
  try {
    parsed = JSON.parse(candidate.text);
  } catch {
    return { status: 'failed', issues: ['INVALID_JSON'] };
  }
  const result = parseOrIssues(GroundedAnswer, parsed);
  return result.ok ? { status: 'passed', issues: [] } : { status: 'failed', issues: result.issues };
}

function parseClaims(text) {
  try {
    const parsed = JSON.parse(text);
    const result = parseOrIssues(GroundedAnswer, parsed);
    return result.ok ? result.data.claims : [];
  } catch {
    return [];
  }
}

/** Run one composer attempt end to end: generate, then verify every claim
 * against exactly the given allowed values. Returns the raw claims, the
 * verdicts, and which ones verified. */
async function attempt(provider, args, allowedValues, { trace, correlationId, signal } = {}) {
  const result = await provider.generate(args, { trace, validate: validateModelJson, signal });
  const claims = parseClaims(result.text);
  const verification = verifyClaims({ claims, allowedValues });
  const verified = claims.filter((_, index) => verification.verdicts[index]?.status === 'anchored');
  return { result, claims, verification, verified };
}

/**
 * Compose the W2 grounded answer.
 *
 * Args:
 *   labResults: This document's typed `LabResult`s (already excludes nothing
 *     -- confidence filtering happens here).
 *   intakeForm: This document's typed `IntakeForm`, or `null`.
 *   guidelineEvidence: Top guideline evidence from the evidence-retrieval
 *     worker (already citation-checked); empty for a record-lookup-only or
 *     off-topic question.
 *   patientFacts: Chart records from `service.retrievePatientChartFacts`,
 *     each `{..., citation: Citation|null}`.
 *   question: The clinician's question, for the model prompt only (never
 *     used to select which facts are "allowed" -- that is always exactly the
 *     facts/evidence given).
 *   provider: A `ResilientProvider`-shaped `{generate(args, opts)}`. Its
 *     fallback must be a `DeterministicAnswerComposer` (or throws on
 *     briefing-shaped args, per S6 R&D note).
 *
 * Returns a `GroundedAnswerResult`-shaped object (schemas.js), the exact
 * contract the server validates before ever sending `workflow.answer`.
 */
export async function composeGroundedAnswer({ labResults = [], intakeForm = null, guidelineEvidence = [], patientFacts = [], question = '' } = {}, { provider, trace = null, correlationId = '', signal } = {}) {
  const needsReview = [];
  const verifiedLabResults = [];
  for (const result of labResults) {
    if (typeof result.confidence === 'number' && result.confidence < LOW_CONFIDENCE_THRESHOLD) needsReview.push({ kind: 'lab_result', field: result.citation?.field_or_chunk_id || result.test_name, reason: 'low_confidence' });
    else verifiedLabResults.push(result);
  }
  const intakeLeaves = collectIntakeLeaves(intakeForm);
  const verifiedIntakeCitations = [];
  for (const leaf of intakeLeaves) {
    if (typeof leaf.confidence === 'number' && leaf.confidence < LOW_CONFIDENCE_THRESHOLD) needsReview.push({ kind: 'intake_field', field: leaf.citation?.field_or_chunk_id || 'intake_field', reason: 'low_confidence' });
    else if (leaf.citation) verifiedIntakeCitations.push(leaf.citation);
  }
  const patientFactCitations = [];
  for (const fact of patientFacts) {
    if (!fact.citation) { needsReview.push({ kind: 'patient_record', field: fact.field || 'patient_record', reason: 'missing_citation' }); continue; }
    patientFactCitations.push(fact.citation);
  }

  const allowedValues = [...verifiedLabResults, ...verifiedIntakeCitations, ...guidelineEvidence, ...patientFactCitations];
  const args = { question, verifiedLabResults, verifiedIntakeCitations, guidelineEvidence, patientFactCitations, prompt: buildPrompt({ question, verifiedLabResults, verifiedIntakeCitations, guidelineEvidence, patientFactCitations }), correlationId, signal };

  const fallback = new DeterministicAnswerComposer();
  let outcome;
  let composerLabel;
  if (provider) {
    try {
      outcome = await attempt(provider, args, allowedValues, { trace, correlationId, signal });
      composerLabel = outcome.result.provider_status === 'fallback' ? 'deterministic-fallback' : 'model';
    } catch {
      outcome = await attempt(fallback, args, allowedValues, { trace, correlationId, signal });
      composerLabel = 'deterministic-fallback';
    }
  } else {
    outcome = await attempt(fallback, args, allowedValues, { trace, correlationId, signal });
    composerLabel = 'deterministic-fallback';
  }

  // A model that produced schema-valid JSON but zero claims that actually
  // verify is not usable output; fall back rather than return an empty,
  // possibly-hallucinated-and-entirely-dropped answer.
  if (composerLabel === 'model' && outcome.verified.length === 0) {
    outcome = await attempt(fallback, args, allowedValues, { trace, correlationId, signal });
    composerLabel = 'deterministic-fallback';
  }

  const unverifiedDropped = outcome.claims.length - outcome.verified.length;
  return {
    composer: composerLabel,
    patient_facts: outcome.verified.filter((claim) => claim.kind === 'patient_fact'),
    guideline_evidence: outcome.verified.filter((claim) => claim.kind === 'guideline'),
    needs_review: needsReview,
    unverified_dropped: Math.max(0, unverifiedDropped),
  };
}

function collectIntakeLeaves(intakeForm) {
  if (!intakeForm) return [];
  const leaves = [intakeForm.demographics?.name, intakeForm.demographics?.dob, intakeForm.demographics?.phone, intakeForm.chief_concern, ...(intakeForm.current_medications || []), ...(intakeForm.allergies || []), ...(intakeForm.family_history || [])];
  return leaves.filter((leaf) => leaf && leaf.status === 'observed');
}
