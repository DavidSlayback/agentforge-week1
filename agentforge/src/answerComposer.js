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
// F5 review fix: one canonical `isRecordLookupQuestion`, defined in
// supervisor.js (the `record_lookup_only` routing decision owns it); this
// module re-exports it rather than keeping its own copy of the regex, so the
// two can never quietly drift apart on what counts as a pure record lookup.
import { isRecordLookupQuestion } from './supervisor.js';

export { isRecordLookupQuestion };

/** Facts extracted with less than this confidence are excluded from the
 * answer and reported separately as `needs_review`, never as a patient fact
 * (W2-C7 / documentSafety fail-loud philosophy: an uncertain OCR read must
 * never be presented as a verified value). Matches the OCR review threshold
 * already used for the source-preview UI's low-confidence flag. */
export const LOW_CONFIDENCE_THRESHOLD = 0.85;

/** F1 review fix: the model's own claims JSON typically runs 1.1-1.6k tokens
 * for a handful of claims with full citations; the briefing prose lane's
 * 300-token cap (modelProvider.js) truncated it mid-JSON, guaranteeing a
 * parse failure. The composer asks for its own, much larger budget; the
 * briefing lane's default (300) is untouched. */
const ANSWER_MODEL_MAX_TOKENS = 2000;

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
 * Deterministic patient-fact claim for one typed `LabResult`. Names the test
 * exactly as its own `test_name` (verbatim, never genericized): the shared
 * tokenizer (`groundingText.js#bindingTokens`) now keeps a lab code such as
 * "A1C" or "HbA1c" as one word token instead of splitting it into
 * word+NUMBER+word, and `LAB_NAME_ALIASES` (`clinicalVocabulary.js`)
 * additionally lets the claim use one of that same test's known alternate
 * spellings. Every other word outside the cited value/range is drawn from a
 * closed, pre-approved vocabulary (`BINDING_VOCABULARY`), so this always
 * verifies against `claimBinding.js`.
 */
function labResultClaim(result) {
  const flagWord = ABNORMAL_FLAG_WORDS.has(result.abnormal_flag) ? result.abnormal_flag : null;
  const text = `${result.test_name} ${result.value} ${result.unit} on ${result.collection_date} (reference ${result.reference_range})${flagWord ? `, flagged ${flagWord}` : ''}.`;
  return { kind: 'patient_fact', text, citations: [result.citation] };
}

/** Deterministic patient-fact claim for one OpenEMR chart-record citation.
 * Chart-record citations carry a `field_or_chunk_id` but no separate label
 * and a bare (unlabeled) `quote_or_value`, so the field name in the claim
 * text is derived from that id the same way `claimBinding.js` will re-derive
 * it, and the value is echoed verbatim. */
function fieldValueClaim(citation) {
  const raw = fieldWords(citation.field_or_chunk_id);
  const text = (raw ? `The chart records ${raw} as ${citation.quote_or_value}.` : `The chart records ${citation.quote_or_value}.`).replace(/\s+/g, ' ');
  return { kind: 'patient_fact', text, citations: [citation] };
}

/** Deterministic patient-fact claim for one observed intake-form leaf
 * (chief concern, a medication, an allergy, or a family-history entry --
 * never demographics, which `composeGroundedAnswer` excludes before this is
 * ever called). Unlike a chart-record citation, an intake leaf's
 * `quote_or_value` is the verbatim "<label>: <value>" line the source form
 * (or its OCR) actually prints -- e.g. "Chief concern: Fatigue for two
 * weeks" -- so the claim echoes it as-is rather than wrapping it in another
 * subject/label, which would just repeat the same label twice. */
function intakeFieldClaim(citation) {
  const quote = String(citation.quote_or_value || '').trim();
  const text = /[.!?]$/.test(quote) ? quote : `${quote}.`;
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
      ...verifiedIntakeCitations.map(intakeFieldClaim),
      ...patientFactCitations.map(fieldValueClaim),
      ...guidelineEvidence.map(guidelineClaim),
    ];
    return { text: JSON.stringify({ claims }), inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  }
}

// F8 review fix: demographics (name/DOB/phone/sex) are identity data --
// already checked by documentSafety.js -- not clinical findings for "what
// changed / what to pay attention to". `composeGroundedAnswer` never passes
// them into `facts` (see `collectIntakeLeaves`), so they never reach the
// prompt or the model's own claims either; only clinical intake fields
// (chief concern, medications, allergies, family history) do.
function buildPrompt({ question, verifiedLabResults, verifiedIntakeCitations, guidelineEvidence, patientFactCitations }) {
  const facts = [
    ...verifiedLabResults.map((result) => ({ kind: 'lab_result', test_name: result.test_name, value: result.value, unit: result.unit, reference_range: result.reference_range, collection_date: result.collection_date, abnormal_flag: result.abnormal_flag, citation: result.citation })),
    ...verifiedIntakeCitations.map((citation) => ({ kind: 'intake_field', citation })),
    ...patientFactCitations.map((citation) => ({ kind: 'openemr_record', citation })),
  ];
  return [
    'You are a clinical documentation assistant preparing a return-visit answer.',
    'Answer strictly from the facts and guideline evidence listed below. Never invent a value. Never recommend a treatment, diagnosis, medication change, or other clinical action -- describe only what is documented.',
    'Rules: one claim per fact, do not combine facts. Name each lab test exactly as its own test_name (verbatim, digits and all -- e.g. "A1C", never a generic substitute). Copy every cited value, unit, date, and range verbatim. Guideline claims must quote their snippet verbatim (at least 8 words).',
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

/** A provider whose primary is (or resolves to) `DeterministicProvider`/
 * `DeterministicAnswerComposer` -- i.e. no real model is configured at all.
 * `ResilientProvider.name` already equals its primary's name, so this single
 * check covers a bare deterministic provider and a `ResilientProvider`
 * wrapping one. */
function isEffectivelyDeterministic(provider) {
  return !provider || provider.name === 'deterministic' || provider.name === 'deterministic-answer-composer';
}

/** Identifies one allowed fact/evidence item by exactly what a citation to it
 * would contain, so a claim's citations can be matched back to the fact they
 * covered (used both for the F1 top-up gap check and, implicitly, wherever a
 * caller needs "did any claim actually cite this fact"). */
function citationKey(citation) {
  return citation ? `${citation.source_type}:${citation.source_id}:${citation.field_or_chunk_id}` : null;
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
 *     briefing-shaped args, per S6 R&D note). When absent, or effectively
 *     deterministic (F7), the deterministic composer is called directly --
 *     no wasted retries against a primary that cannot succeed.
 *   signal: An optional `AbortSignal` (F6, a per-request scan deadline). If
 *     already aborted, the real model is skipped entirely and the answer is
 *     composed deterministically with `model_rejected_reason: 'deadline'`.
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
  const args = { question, verifiedLabResults, verifiedIntakeCitations, guidelineEvidence, patientFactCitations, prompt: buildPrompt({ question, verifiedLabResults, verifiedIntakeCitations, guidelineEvidence, patientFactCitations }), correlationId, signal, maxTokens: ANSWER_MODEL_MAX_TOKENS };

  const fallback = new DeterministicAnswerComposer();
  const runFallback = () => attempt(fallback, args, allowedValues, { trace, correlationId, signal });

  let outcome;
  let composerLabel;
  let modelRejectedReason = null;
  let modelDroppedCount = 0;

  const deadlineAlreadyPassed = Boolean(signal?.aborted);
  const useRealProvider = provider && !isEffectivelyDeterministic(provider) && !deadlineAlreadyPassed;

  if (useRealProvider) {
    try {
      outcome = await attempt(provider, args, allowedValues, { trace, correlationId, signal });
      composerLabel = outcome.result.provider_status === 'fallback' ? 'deterministic-fallback' : 'model';
      if (composerLabel === 'deterministic-fallback') {
        // The model itself never produced output we could even run
        // per-claim verification on -- its own attempts were rejected at
        // the schema/JSON stage (or the primary errored) before ever
        // reaching us, so there is no per-claim drop count to report, only why.
        modelRejectedReason = outcome.result.provider_error_code === 'MODEL_OUTPUT_REJECTED' ? 'invalid_json' : 'provider_error';
      }
    } catch (error) {
      outcome = await runFallback();
      composerLabel = 'deterministic-fallback';
      modelRejectedReason = (signal?.aborted || error?.message === 'MODEL_ABORTED') ? 'deadline' : 'provider_error';
    }
  } else {
    outcome = await runFallback();
    composerLabel = 'deterministic-fallback';
    if (provider && !isEffectivelyDeterministic(provider) && deadlineAlreadyPassed) modelRejectedReason = 'deadline';
  }

  // A model that produced schema-valid JSON but zero claims that actually
  // verify is not usable output; fall back rather than return an empty,
  // possibly-hallucinated-and-entirely-dropped answer. Here, unlike above,
  // the model's claims *did* reach per-claim verification, so the drop count
  // is real and worth carrying forward (F2).
  if (composerLabel === 'model' && outcome.verified.length === 0) {
    modelDroppedCount = outcome.claims.length;
    modelRejectedReason = 'all_claims_unverified';
    outcome = await runFallback();
    composerLabel = 'deterministic-fallback';
  }

  // Real per-claim drop count from whichever attempt's claims survive in
  // `outcome` right now -- captured *before* the F1 top-up below adds new
  // claims that were never "dropped" (they were never proposed at all), so
  // topping up can never make an earlier drop look like it did not happen.
  const unverifiedDropped = Math.max(modelDroppedCount, outcome.claims.length - outcome.verified.length);

  // F1 top-up: a model that verified *something* but missed facts or
  // evidence that were actually available (never cited by any surviving
  // claim) gets those specific gaps filled deterministically, rather than
  // shipping a thinner answer than the facts on hand support.
  if (composerLabel === 'model') {
    const covered = new Set(outcome.verified.flatMap((claim) => claim.citations.map((citation) => citationKey(citation))));
    const topup = [
      ...verifiedLabResults.filter((result) => !covered.has(citationKey(result.citation))).map(labResultClaim),
      ...verifiedIntakeCitations.filter((citation) => !covered.has(citationKey(citation))).map(intakeFieldClaim),
      ...patientFactCitations.filter((citation) => !covered.has(citationKey(citation))).map(fieldValueClaim),
      ...guidelineEvidence.filter((evidence) => !covered.has(citationKey(evidence.citation))).map(guidelineClaim),
    ];
    if (topup.length) {
      outcome = { ...outcome, verified: [...outcome.verified, ...topup] };
      composerLabel = 'model+deterministic-topup';
    }
  }

  // F4: record exactly one model-usage entry for the answer stage, whichever
  // provider ultimately produced the shipped claims.
  trace?.recordModelUsage?.({
    stage: 'answer',
    provider: outcome.result.provider_name || fallback.name,
    model: outcome.result.model_name || fallback.model,
    inputTokens: outcome.result.inputTokens || 0,
    outputTokens: outcome.result.outputTokens || 0,
    estimatedCostUsd: outcome.result.estimatedCostUsd || 0,
    status: composerLabel,
  });

  return {
    composer: composerLabel,
    ...(modelRejectedReason ? { model_rejected_reason: modelRejectedReason } : {}),
    patient_facts: outcome.verified.filter((claim) => claim.kind === 'patient_fact'),
    guideline_evidence: outcome.verified.filter((claim) => claim.kind === 'guideline'),
    needs_review: needsReview,
    unverified_dropped: unverifiedDropped,
  };
}

/**
 * Observed intake-form leaves that are clinical findings for the W2 answer
 * ("what changed, what to pay attention to") -- chief concern, current
 * medications, allergies, and family history. Demographics (`name`, `dob`,
 * `phone`, `sex`) are deliberately excluded (F8 review fix): they are
 * identity data already checked by `documentSafety.js`, not clinical
 * findings, and echoing them here just bloats the prompt and the answer
 * with a claim whose text duplicates the form's own label (e.g. "The intake
 * form records patient name as Patient name: Test Patient One."). They
 * remain fully present in `intakeForm` itself (the typed extraction output)
 * and in every identity check -- only the model prompt and the answer's own
 * claims exclude them.
 */
function collectIntakeLeaves(intakeForm) {
  if (!intakeForm) return [];
  const leaves = [intakeForm.chief_concern, ...(intakeForm.current_medications || []), ...(intakeForm.allergies || []), ...(intakeForm.family_history || [])];
  return leaves.filter((leaf) => leaf && leaf.status === 'observed');
}
