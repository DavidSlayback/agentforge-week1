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
 * found, and patient-record facts read from the chart. Every fact/chunk
 * available to this answer is given a short label (`F1`, `F2`, ... for
 * patient-record facts, `G1`, `G2`, ... for guideline chunks --
 * `buildFactLabels` below), and a model composes `{claims:[{kind, text,
 * refs}]}` (the `GroundedAnswer` Zod contract) citing those labels only,
 * never a full citation object -- the same "reference by short number, not a
 * full id" fix already applied to the listwise reranker (`reranker.js`);
 * asking the model to echo a full citation per claim (a guideline
 * `quote_or_value` can be an entire ~100-word chunk) made a single real-model
 * call run >14s of output alone and blew the per-request scan deadline every
 * time (2026-09-24). `materializeClaims` maps each ref back to the exact
 * citation object it names; every claim is then run through `verifyClaims`
 * (claimBinding.js) against exactly those inputs, completely unchanged. A
 * claim that does not verify -- or whose refs never resolve to a known label,
 * leaving it with no citations at all -- is dropped, not repaired or trusted
 * — the composer never returns a claim the verifier did not independently
 * confirm.
 *
 * Two composers, one contract: `runComposer` calls whichever provider it is
 * given (the real model, or `DeterministicAnswerComposer`) and always
 * verifies the result the same way, so the fallback is not a "trust me"
 * shortcut — it is graded by the identical rule.
 */
import { verifyClaims } from './claimBinding.js';
import { BINDING_VOCABULARY } from './clinicalVocabulary.js';
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

/** Compact prompt line for one lab-result fact, e.g. "[lab] A1C 6.1 % on
 * 2026-09-20 (reference under 5.7), flagged abnormal" -- deliberately the
 * short summary form, never the guideline-chunk-sized JSON the old prompt
 * embedded per fact. */
function labFactLine(result) {
  const flagWord = ABNORMAL_FLAG_WORDS.has(result.abnormal_flag) ? result.abnormal_flag : null;
  return `[lab] ${result.test_name} ${result.value} ${result.unit} on ${result.collection_date} (reference ${result.reference_range})${flagWord ? `, flagged ${flagWord}` : ''} | must contain: "${result.value}"`;
}

// Each fact line ends with the exact run `claimBinding.js#bindPatientFact`
// requires (CITED_VALUE_MISSING otherwise). Measured live 2026-09-24: without
// it, 40% of real-model claims failed verification -- none for an invented
// value, all for paraphrasing a line the verifier needs verbatim.

/** Compact prompt line for one intake-form leaf: the form's own verbatim
 * "<label>: <value>" quote, same text `intakeFieldClaim` echoes. The
 * verifier binds on the whole quote, label included. */
function intakeFactLine(citation) {
  const source = MEDICATION_LIST_ROW_CITATION.test(citation.field_or_chunk_id || '') ? 'medication list' : 'intake form';
  return `[${source}] ${citation.quote_or_value} | must contain: "${citation.quote_or_value}"`;
}

// A medication-list row cites its name part (`medication.<n>.name`); intake
// medication leaves use `medications` or `medication.<drug>`.
const MEDICATION_LIST_ROW_CITATION = /^medication.d+.name$/;

/** Compact prompt line for one OpenEMR chart-record fact: the field it
 * belongs to (words the verifier derives from the same `field_or_chunk_id`)
 * and its verbatim value. A bare value ("active") gave the model nothing to
 * say about it but invented framing. */
function openemrFactLine(citation) {
  const field = fieldWords(citation.field_or_chunk_id);
  return `[chart record] ${field ? `${field}: ` : ''}${citation.quote_or_value} | must contain: "${citation.quote_or_value}"`;
}

/** Compact prompt line for one guideline chunk: title/section/version plus
 * the full snippet -- the snippet itself cannot be shortened (the model must
 * quote >= 8 verbatim words of it back), but it is listed once per chunk,
 * never repeated inside every claim's own citation the way the old per-claim
 * citation-object contract required. */
function guidelineFactLine(evidence) {
  return `[${evidence.title}, ${evidence.section}, ${evidence.version}]: ${evidence.snippet}`;
}

/**
 * Assign short `F1..Fn` / `G1..Gm` labels to every patient-record fact and
 * guideline chunk available to this answer, in the same fixed order the
 * prompt lists them (labs, then intake leaves, then chart facts; guideline
 * chunks separately as `G`) so a model's `refs` can name them by label only.
 * Returns `{ facts, guidelines }`, each an array of `{ label, citation, line
 * }` -- `citation` is the exact object `materializeClaims` will substitute
 * back in for a claim that cites this label, and `line` is what the prompt
 * shows for it (F1 review fix, 2026-09-24: see the module doc for why full
 * citation objects were never safe to ask the model to echo).
 */
function buildFactLabels({ verifiedLabResults, verifiedIntakeCitations, patientFactCitations, guidelineEvidence }) {
  let n = 0;
  const facts = [
    ...verifiedLabResults.map((result) => ({ label: `F${++n}`, citation: result.citation, line: labFactLine(result) })),
    ...verifiedIntakeCitations.map((citation) => ({ label: `F${++n}`, citation, line: intakeFactLine(citation) })),
    ...patientFactCitations.map((citation) => ({ label: `F${++n}`, citation, line: openemrFactLine(citation) })),
  ];
  let g = 0;
  const guidelines = guidelineEvidence.map((evidence) => ({ label: `G${++g}`, citation: evidence.citation, line: guidelineFactLine(evidence) }));
  return { facts, guidelines };
}

// F8 review fix: demographics (name/DOB/phone/sex) are identity data --
// already checked by documentSafety.js -- not clinical findings for "what
// changed / what to pay attention to". `composeGroundedAnswer` never passes
// them into `facts` (see `collectIntakeLeaves`), so they never reach the
// prompt or the model's own claims either; only clinical intake fields
// (chief concern, medications, allergies, family history) do.
// The verifier's closed framing vocabulary, stated to the model instead of
// discovered by rejection (the same list `bindPatientFact` accepts).
const FRAMING_WORD_LIST = [...BINDING_VOCABULARY].filter((word) => word.length > 1).join(', ');

function buildPrompt({ question, facts, guidelines }) {
  const factLines = facts.map((fact) => `${fact.label} ${fact.line}`).join('\n') || '(none)';
  const guidelineLines = guidelines.map((chunk) => `${chunk.label} ${chunk.line}`).join('\n') || '(none)';
  return [
    'You are a clinical documentation assistant preparing a return-visit answer.',
    'Answer strictly from the facts and guideline evidence listed below. Never invent a value. Never recommend a treatment, diagnosis, medication change, or other clinical action -- describe only what is documented.',
    'Rules for patient_fact claims: exactly one claim per F label, citing only that label. The claim text must contain the fact\'s "must contain" text as one unbroken, word-for-word run -- never paraphrase it or insert words inside it. Put everything about one lab (value, unit, date, reference range, flag) in that one claim; never split a lab into separate claims. Name each lab test exactly as its own test_name (e.g. "A1C"). Any other word must come from the fact line itself or from this list, or the claim is rejected (do not add words such as "prior", "another", "indicates", "includes", or a drug or condition name that is not on the line): ' + FRAMING_WORD_LIST + '.',
    'Rules for guideline claims: the text must contain a run of at least 8 consecutive words copied word-for-word from the chunk. A short list item such as "X: 6.5% or above" alone is rejected; when the chunk is a list, copy from the sentence that introduces it through the item you need.',
    'Every patient-record fact and guideline chunk below has a short label. Cite each claim by label only, in "refs" -- never restate a fact\'s value or a guideline\'s citation fields as JSON, and never invent a label that is not listed below.',
    'Return ONLY a JSON object of this exact shape, no prose outside it:',
    '{"claims":[{"kind":"patient_fact"|"guideline","text":"...","refs":["F1"]}]}',
    `Clinician question: ${question || '(none provided)'}`,
    'Patient-record facts:',
    factLines,
    'Guideline evidence:',
    guidelineLines,
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

/** Find the label list entry naming exactly this citation -- by object
 * identity (the common case: the same citation object `buildFactLabels` was
 * given) or, failing that, by `source_id`+`field_or_chunk_id` (so a
 * reconstructed/copied citation with the same identity still resolves, the
 * way an adversarial probe's forged citation does). Exported for tests/gate
 * fixtures that need to build a realistic `refs` array without duplicating
 * this matching rule. */
export function labelForCitation(labels, citation) {
  if (!citation) return undefined;
  const match = labels.find((entry) => entry.citation === citation
    || (entry.citation.source_id === citation.source_id && entry.citation.field_or_chunk_id === citation.field_or_chunk_id));
  return match?.label;
}

function citationForRef(ref, factLabels, guidelineLabels) {
  const match = [...factLabels, ...guidelineLabels].find((entry) => entry.label === ref);
  return match ? match.citation : null;
}

/**
 * Materialize the model's own ref-based claims into the same fully-cited
 * `{kind, text, citations}` shape `verifyClaims` has always taken. A ref that
 * does not name a known label is dropped, never trusted -- the model's JSON
 * is untrusted input, the same rule `reranker.js#parseListwiseRerankResponse`
 * already applies to an out-of-range candidate number. A claim citing a
 * label from the *other* namespace (e.g. a `patient_fact` claim with
 * `refs:["G1"]`) still resolves to that label's real citation object here;
 * `claimBinding.js#verifyClaims` is what then rejects the resulting
 * kind/source_type mismatch (`GUIDELINE_CITED_FOR_PATIENT_FACT` /
 * `NON_GUIDELINE_CITATION`), exactly as it always has for any wrongly-typed
 * citation -- this function only resolves labels, it never validates them.
 * A claim that already carries full `citations` (the deterministic
 * composer's own output, which never uses labels at all) passes through
 * unchanged.
 */
function materializeClaims(rawClaims, factLabels, guidelineLabels) {
  return rawClaims.map((claim) => {
    if (!claim || !Array.isArray(claim.refs)) return claim;
    const citations = claim.refs
      .filter((ref) => typeof ref === 'string')
      .map((ref) => citationForRef(ref, factLabels, guidelineLabels))
      .filter(Boolean);
    return { kind: claim.kind, text: claim.text, citations };
  });
}

/** Run one composer attempt end to end: generate, materialize any ref-based
 * claims back into fully-cited ones, then verify every claim against exactly
 * the given allowed values. Returns the raw claims, the verdicts, and which
 * ones verified. */
async function attempt(provider, args, allowedValues, { trace, correlationId, signal } = {}) {
  const result = await provider.generate(args, { trace, validate: validateModelJson, signal });
  const claims = materializeClaims(parseClaims(result.text), args.factLabels || [], args.guidelineLabels || []);
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
 * Split the composer's raw inputs into what an answer may cite and what is
 * held back for human review: lab results and intake leaves under
 * `LOW_CONFIDENCE_THRESHOLD`, and chart records with no citation, go to
 * `needsReview`; so do medication-list rows under it. Exported so the critic step (`critic.js`) reuses exactly
 * this rule when it tops up a gap its vetoes left, instead of re-deriving it.
 */
export function partitionAnswerInputs({ labResults = [], intakeForm = null, medicationList = null, guidelineEvidence = [], patientFacts = [] } = {}) {
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
  // Medication-list rows join the same verbatim-quote lane as intake leaves:
  // each row's citation quotes the whole printed row. A row is only as
  // confident as its least confident observed part.
  for (const item of medicationList?.medications || []) {
    const confidence = Math.min(...['name', 'dose', 'unit', 'frequency', 'route'].filter((key) => item[key]?.status === 'observed').map((key) => item[key].confidence));
    if (confidence < LOW_CONFIDENCE_THRESHOLD) needsReview.push({ kind: 'medication_list_item', field: item.citation?.field_or_chunk_id || 'medication_list_item', reason: 'low_confidence' });
    else if (item.citation) verifiedIntakeCitations.push(item.citation);
  }
  const patientFactCitations = [];
  for (const fact of patientFacts) {
    if (!fact.citation) { needsReview.push({ kind: 'patient_record', field: fact.field || 'patient_record', reason: 'missing_citation' }); continue; }
    patientFactCitations.push(fact.citation);
  }
  return { needsReview, verifiedLabResults, verifiedIntakeCitations, patientFactCitations, guidelineEvidence };
}

/**
 * The F1 top-up: a deterministic claim for every fact or guideline chunk in
 * `parts` (from `partitionAnswerInputs`) that no claim in `claims` cites.
 * Deterministic claims are built from the typed facts themselves, so they
 * verify by construction. Used by the composer (gaps the model left) and by
 * the critic step (gaps its vetoes left).
 */
export function deterministicTopUpClaims({ verifiedLabResults = [], verifiedIntakeCitations = [], patientFactCitations = [], guidelineEvidence = [] }, claims = []) {
  const covered = new Set(claims.flatMap((claim) => (claim.citations || []).map((citation) => citationKey(citation))));
  return [
    ...verifiedLabResults.filter((result) => !covered.has(citationKey(result.citation))).map(labResultClaim),
    ...verifiedIntakeCitations.filter((citation) => !covered.has(citationKey(citation))).map(intakeFieldClaim),
    ...patientFactCitations.filter((citation) => !covered.has(citationKey(citation))).map(fieldValueClaim),
    ...guidelineEvidence.filter((evidence) => !covered.has(citationKey(evidence.citation))).map(guidelineClaim),
  ];
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
export async function composeGroundedAnswer({ labResults = [], intakeForm = null, medicationList = null, guidelineEvidence = [], patientFacts = [], question = '' } = {}, { provider, trace = null, correlationId = '', signal } = {}) {
  const { needsReview, verifiedLabResults, verifiedIntakeCitations, patientFactCitations } = partitionAnswerInputs({ labResults, intakeForm, medicationList, guidelineEvidence, patientFacts });

  const allowedValues = [...verifiedLabResults, ...verifiedIntakeCitations, ...guidelineEvidence, ...patientFactCitations];
  // F1 review fix 2026-09-24: label every fact/chunk once so the prompt and
  // the model's own `refs` never carry a full citation object (see the
  // module doc). `factLabels`/`guidelineLabels` ride along on `args` so
  // `attempt` can materialize a model's refs back into citations, and so any
  // fake provider (tests, the gate, trust-probes) can build a realistic
  // `refs` array via `labelForCitation` instead of guessing label numbers.
  const { facts: factLabels, guidelines: guidelineLabels } = buildFactLabels({ verifiedLabResults, verifiedIntakeCitations, patientFactCitations, guidelineEvidence });
  const args = { question, verifiedLabResults, verifiedIntakeCitations, guidelineEvidence, patientFactCitations, factLabels, guidelineLabels, prompt: buildPrompt({ question, facts: factLabels, guidelines: guidelineLabels }), correlationId, signal, maxTokens: ANSWER_MODEL_MAX_TOKENS };

  const fallback = new DeterministicAnswerComposer();
  const runFallback = () => attempt(fallback, args, allowedValues, { trace, correlationId, signal });

  let outcome;
  let composerLabel;
  let modelRejectedReason = null;
  let modelDroppedCount = 0;
  // Raw counts from the REAL model's own single attempt only -- never the
  // deterministic composer/fallback, and never an F1 top-up claim. Both stay
  // 0 unless the branch below (the real primary succeeded and produced
  // claims of its own) sets them; see schemas.js#GroundedAnswerResult for
  // the exact rule per case.
  let modelClaimsProposed = 0;
  let modelClaimsVerified = 0;

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
        // `result.text` here is `ResilientProvider`'s own internal
        // deterministic fallback's JSON, not the model's -- model_claims_*
        // stay 0, never counted from someone else's claims.
        modelRejectedReason = outcome.result.provider_error_code === 'MODEL_OUTPUT_REJECTED' ? 'invalid_json' : 'provider_error';
      } else {
        // The real model's own attempt succeeded (schema-valid JSON) and
        // `outcome` holds exactly its claims and verdicts right now --
        // capture the raw counts before the "all claims unverified" fallback
        // or the F1 top-up below can replace or extend `outcome` with claims
        // the model never proposed.
        modelClaimsProposed = outcome.claims.length;
        modelClaimsVerified = outcome.verified.length;
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
    const topup = deterministicTopUpClaims({ verifiedLabResults, verifiedIntakeCitations, patientFactCitations, guidelineEvidence }, outcome.verified);
    if (topup.length) {
      outcome = { ...outcome, verified: [...outcome.verified, ...topup] };
      composerLabel = 'model+deterministic-topup';
    }
  }

  // F4: record exactly one model-usage entry for the answer stage, whichever
  // provider ultimately produced the shipped claims. `model_claims_proposed`/
  // `model_claims_verified` ride along here too (counts only, no PHI) so a
  // live trace can compute the model grounding rate without re-deriving it.
  trace?.recordModelUsage?.({
    stage: 'answer',
    provider: outcome.result.provider_name || fallback.name,
    model: outcome.result.model_name || fallback.model,
    inputTokens: outcome.result.inputTokens || 0,
    outputTokens: outcome.result.outputTokens || 0,
    // `?? null`, not `|| 0`: a provider that can't report or price its cost
    // returns `estimatedCostUsd: null` (modelProvider.js's `resolveCostUsd`);
    // `|| 0` would silently turn that unknown into a free call.
    estimatedCostUsd: outcome.result.estimatedCostUsd ?? null,
    status: composerLabel,
    model_claims_proposed: modelClaimsProposed,
    model_claims_verified: modelClaimsVerified,
  });

  return {
    composer: composerLabel,
    ...(modelRejectedReason ? { model_rejected_reason: modelRejectedReason } : {}),
    patient_facts: outcome.verified.filter((claim) => claim.kind === 'patient_fact'),
    guideline_evidence: outcome.verified.filter((claim) => claim.kind === 'guideline'),
    needs_review: needsReview,
    unverified_dropped: unverifiedDropped,
    model_claims_proposed: modelClaimsProposed,
    model_claims_verified: modelClaimsVerified,
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
