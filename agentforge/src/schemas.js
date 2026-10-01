import { z } from 'zod';

/**
 * W2 document and citation contracts (Zod, `.strict()`).
 *
 * These schemas are the source of truth for the lab, intake, and guideline
 * evidence contracts required by the Week 2 assignment. Every citation
 * produced anywhere in the service — whether it points at an uploaded PDF,
 * an OCR'd scan field, or a retrieved guideline chunk — must validate
 * against `Citation` with exactly these five required keys plus the two
 * optional bounding-box keys. `.strict()` means an old key name (for
 * example `source_document_id` or `location`) fails validation instead of
 * silently passing through.
 */

/**
 * Machine-readable pointer from a clinical claim back to its source.
 *
 * `page_or_section` is a human-readable location string: `"page 1"` for a
 * page-numbered document (optionally combined with a form section, e.g.
 * `"page 2 · Medications"`), or a guideline section title such as
 * `"Follow-up review"`. `bounding_box` and `coordinate_space` are present
 * only for document citations that carry a visual region (S4 renders these
 * as an overlay); guideline citations omit them.
 */
export const Citation = z.object({
  source_type: z.enum(['document', 'guideline', 'openemr_record', 'synthetic_chart_fixture']),
  source_id: z.string().min(1),
  page_or_section: z.string().min(1),
  field_or_chunk_id: z.string().min(1),
  quote_or_value: z.string().min(1),
  bounding_box: z.tuple([
    z.number().nonnegative(),
    z.number().nonnegative(),
    z.number().nonnegative(),
    z.number().nonnegative(),
  ]).optional(),
  coordinate_space: z.string().min(1).optional(),
}).strict();

/** Rendered page dimensions for raster-pixel citation boxes. */
export const PageSize = z.object({
  page: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

/** Optional scan metadata keeps older `.scan.txt` envelopes valid. */
export const ScanExtractionMetadata = z.object({
  page_sizes: z.array(PageSize).optional(),
}).strict();

/**
 * Abnormal-flag values a lab result can carry.
 *
 * A closed enum (rather than a boolean) is used because source documents
 * sometimes distinguish "high"/"low" from a generic "abnormal", and OCR can
 * fail to read the flag at all (`unknown`) — collapsing that to a boolean
 * would silently invent a normal/abnormal call the source never made.
 */
export const AbnormalFlag = z.enum(['high', 'low', 'normal', 'abnormal', 'unknown']);

/**
 * A single extracted lab test result.
 *
 * `value` is kept as a string rather than a number to preserve the exact
 * source text (including units embedded in odd formats, ranges, or OCR
 * artifacts); `unit` and `reference_range` carry the parsed-out unit and
 * range separately when available. `confidence` is the extractor's
 * confidence in `[0, 1]` for the value backing this result.
 */
export const LabResult = z.object({
  test_name: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().min(1),
  reference_range: z.string().min(1),
  collection_date: z.string().min(1),
  abnormal_flag: AbnormalFlag,
  confidence: z.number().min(0).max(1),
  citation: Citation,
}).strict();

/**
 * Status of a single intake-form leaf field.
 *
 * `not_found_on_form` is the explicit representation of "this field was
 * looked for and is not present" — distinct from simply omitting the key,
 * which would be indistinguishable from "extraction never tried."
 */
export const IntakeFieldStatus = z.enum(['observed', 'not_found_on_form']);

/**
 * Build the wrapper schema for one cited intake-form leaf value.
 *
 * An `observed` field carries its value, extractor confidence, and
 * citation; a `not_found_on_form` field carries none of those (they are
 * `null`) but the key itself is still present, so a caller can never
 * mistake "not found" for a silently dropped field.
 */
function intakeField(valueSchema) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('observed'), value: valueSchema, confidence: z.number().min(0).max(1), citation: Citation }).strict(),
    z.object({ status: z.literal('not_found_on_form'), value: z.null(), confidence: z.literal(0), citation: z.null() }).strict(),
  ]);
}

const IntakeStringField = intakeField(z.string().min(1));

/** Patient demographics captured on an intake form. `sex`/`phone` are omitted entirely on forms that never ask for them. */
export const IntakeDemographics = z.object({
  name: IntakeStringField,
  dob: IntakeStringField,
  sex: IntakeStringField.optional(),
  phone: IntakeStringField.optional(),
}).strict();

/**
 * A structured, cited patient intake form.
 *
 * `current_medications`, `allergies`, and `family_history` are always
 * present, even when the form lists none (an empty array), so "no data
 * extracted" is distinguishable from "section omitted."
 */
export const IntakeForm = z.object({
  demographics: IntakeDemographics,
  chief_concern: IntakeStringField,
  current_medications: z.array(IntakeStringField),
  allergies: z.array(IntakeStringField),
  family_history: z.array(IntakeStringField),
}).strict();

/**
 * One read part of a medication-list row (dose, unit, frequency or route).
 *
 * Every part of a row is read from the same printed line, so the row carries
 * one `citation` (see `MedicationItem`) and each part carries only its own
 * value and extractor confidence. A part the row does not show is
 * `not_found_on_form` with a `null` value, never a guessed default.
 */
export const MedicationPart = z.discriminatedUnion('status', [
  z.object({ status: z.literal('observed'), value: z.string().min(1), confidence: z.number().min(0).max(1) }).strict(),
  z.object({ status: z.literal('not_found_on_form'), value: z.null(), confidence: z.literal(0) }).strict(),
]);

/**
 * One medication row of a medication list.
 *
 * `name` is always observed: a row whose drug name could not be read is not
 * typed as a medication at all (it is reported as a typed issue instead).
 * `citation` is the five-key document citation of the printed row. Its
 * `bounding_box` is required here (optional on `Citation` in general, since
 * guideline citations have none): every row is read from a located line.
 */
export const MedicationItem = z.object({
  name: z.object({ status: z.literal('observed'), value: z.string().min(1), confidence: z.number().min(0).max(1) }).strict(),
  dose: MedicationPart,
  unit: MedicationPart,
  frequency: MedicationPart,
  route: MedicationPart,
  citation: Citation.required({ bounding_box: true }),
}).strict();

/**
 * A structured, cited medication list (the third W2 document type).
 *
 * `list_date` is the date printed on the list. `prescriber_or_source` is the
 * prescriber or record source the list names; many lists name neither, so it
 * is often `not_found_on_form`, but the key is always present. `patient`
 * carries the identity printed on the list, used only for the patient-identity
 * check (`documentSafety.js`). `medications` is always present, even when no
 * row could be read (an empty array).
 */
export const MedicationList = z.object({
  list_date: IntakeStringField,
  prescriber_or_source: IntakeStringField,
  patient: z.object({ name: IntakeStringField, dob: IntakeStringField }).strict(),
  medications: z.array(MedicationItem),
}).strict();

/**
 * A single retrieved and cited guideline evidence chunk.
 *
 * `snippet` is the chunk text surfaced to the answer model; `sparse_score`,
 * `dense_score`, and `rerank_score` record the hybrid-retrieval signals
 * that ranked it, for the routing trace. `citation.field_or_chunk_id`
 * identifies the specific chunk within `citation.source_id`'s document.
 *
 * `url`/`publisher` are the chunk's source-page metadata (from the corpus
 * file, not invented at retrieval time). `degraded` is `null` when this item
 * came from the full sparse+dense+rerank pipeline using a real embedding
 * client and a real reranker (Qwen, Gemini, or Cohere — `reranker.js`);
 * `'sparse_only'` when it came from a BM25-only fallback (no corpus
 * embeddings, no embed client/reranker configured, or the embed step
 * failed); `'no_rerank'` when the embed step succeeded but the reranker
 * itself failed, so the item is a sparse+dense reciprocal-rank fusion, not a
 * real rerank judgment; or `'stub'` when the hybrid pipeline ran its full
 * shape but one or more steps were answered by the deterministic test/gate
 * stand-in (`recorded-or-stub` with no matching recorded fixture) rather
 * than a real or recorded response — never optional, so none of these cases
 * can be silently presented as a genuine hybrid result (AGENTS.md).
 */
export const GuidelineEvidence = z.object({
  title: z.string().min(1),
  section: z.string().min(1),
  version: z.string().min(1),
  url: z.string().min(1),
  publisher: z.string().min(1),
  snippet: z.string().min(1),
  sparse_score: z.number(),
  dense_score: z.number(),
  rerank_score: z.number(),
  matched_terms: z.array(z.string()),
  degraded: z.enum(['sparse_only', 'stub', 'no_rerank']).nullable(),
  citation: Citation,
}).strict();

/**
 * One claim in a W2 grounded answer (S6).
 *
 * `kind` separates patient-record facts (this document's typed extraction or
 * a chart record, OpenEMR or synthetic fixture) from guideline evidence and pure framing prose, so
 * the UI and the eval gate can render/check "patient record" and "guideline
 * evidence" as distinct sections per the W2 scenario ("separate patient-record
 * facts from guideline evidence"). `citations` is validated against the same
 * five-key `Citation` used everywhere else; `claimBinding.js#verifyClaims`
 * additionally enforces that `patient_fact` claims cite only `document`/
 * `openemr_record`/`synthetic_chart_fixture` sources and `guideline` claims cite only `guideline`
 * sources, and that the claim text is actually derivable from what is cited.
 */
export const AnswerClaim = z.object({
  kind: z.enum(['patient_fact', 'guideline', 'framing']),
  text: z.string().min(1),
  citations: z.array(Citation),
}).strict();

/**
 * One claim in the answer-composer MODEL's own raw output (2026-09-24
 * refs-based rewrite). The model never emits full citation objects: a
 * guideline chunk's `quote_or_value` can be an entire ~100-word snippet, and
 * asking the model to echo one per claim made every real-model call blow the
 * per-request scan deadline (a single call ran >14s of output alone). Instead
 * every fact/chunk available to this answer is given a short label -- `F1`,
 * `F2`, ... for patient-record facts, `G1`, `G2`, ... for guideline chunks
 * (`answerComposer.js#buildFactLabels`) -- and the model cites by label only
 * in `refs`, the same "reference by short number, not a full id" fix already
 * used for the listwise reranker (`reranker.js#parseListwiseRerankResponse`).
 * `answerComposer.js#materializeClaims` maps each ref back to the exact
 * citation object it names; an unknown or malformed ref is dropped, never
 * trusted, exactly like an out-of-range candidate number there.
 */
export const ModelAnswerClaim = z.object({
  kind: z.enum(['patient_fact', 'guideline']),
  text: z.string().min(1),
  refs: z.array(z.string().min(1)),
}).strict();

/**
 * The exact JSON contract the answer-composer model (or its deterministic
 * fallback) must return. A claim is either the real model's own ref-based
 * shape (`ModelAnswerClaim`) or the deterministic fallback's shape
 * (`AnswerClaim`, already fully cited) -- `DeterministicAnswerComposer`
 * builds claims directly from typed facts/citations without ever using
 * labels, so its own JSON is validated by this same schema without having to
 * fabricate refs for facts it already holds in full. This is intentionally
 * narrow — just claims — so the model/fallback boundary is a single
 * well-defined shape; `answerComposer.js` materializes any ref-based claims,
 * then separates and annotates all of them into the richer
 * `GroundedAnswerResult` below after verification. `GroundedAnswerResult`
 * itself is unaffected: every claim it carries is always the full,
 * fully-cited `AnswerClaim` shape -- this narrower, ref-based option is the
 * model's OUTPUT contract only, never the RESPONSE contract.
 */
export const GroundedAnswer = z.object({
  claims: z.array(z.union([ModelAnswerClaim, AnswerClaim])),
}).strict();

/**
 * One fact excluded from the answer because it was flagged low-confidence or
 * needs-review before composition ever ran (never because it failed
 * verification — those are counted separately in `unverified_dropped`).
 */
export const NeedsReviewItem = z.object({
  kind: z.enum(['lab_result', 'intake_field', 'medication_list_item', 'patient_record']),
  field: z.string().min(1),
  reason: z.string().min(1),
}).strict();

/**
 * The full W2 grounded-answer response (`workflow.answer` on
 * `/v1/scan-supervisor`). `patient_facts` and `guideline_evidence` are the
 * verified claims that survived `verifyClaims`, already split by `kind` so a
 * caller never has to re-derive the W2-required separation. `composer`
 * records whether the claims came from the configured model, the
 * deterministic fallback, or a model answer topped up with deterministic
 * claims for facts/evidence the model itself missed (never silently
 * relabeled). `model_rejected_reason` is present only when a real model was
 * attempted and its own output could not be used as-is: `invalid_json` (the
 * model's JSON never passed the `GroundedAnswer` schema after retries),
 * `provider_error` (a network/timeout/other failure), `all_claims_unverified`
 * (schema-valid JSON, but every claim failed content verification), or
 * `deadline` (the per-request scan deadline had already passed). It is absent
 * when no model was configured at all, or one part of the answer came
 * through cleanly. `unverified_dropped` counts claims that failed
 * verification and were removed — carried forward from the model's own
 * attempt when it fell back (F2), not reset to 0. The server validates this
 * exact shape before ever sending it (S6 item 4: invalid answer -> 500,
 * never unvalidated).
 *
 * `model_claims_proposed`/`model_claims_verified` (KEY_METRICS "model
 * grounding rate", 2026-09-24) count the REAL model's own raw claims only —
 * never the deterministic composer's claims, and never an F1 top-up claim,
 * even when `composer` ends up `model+deterministic-topup`. Both are
 * captured once, from the model's own single successful attempt, before any
 * later fallback or top-up can replace or extend that attempt's claims — so
 * `model_claims_verified` can be lower than the final `patient_facts.length`
 * + `guideline_evidence.length` (topped-up claims aren't the model's), and
 * both are frozen even if that attempt is later judged unusable (e.g.
 * `all_claims_unverified`) and answered deterministically instead. Both are
 * `0` whenever the real model was never actually called, or was called but
 * never returned anything attributable to it:
 *   - no provider configured, or one that is effectively deterministic (F7);
 *   - the per-request deadline had already passed before the call
 *     (`model_rejected_reason: 'deadline'`, deadline-before-call case);
 *   - the provider threw (timeout/network/other error) or was aborted
 *     mid-call (`model_rejected_reason: 'provider_error'` or `'deadline'`) —
 *     no parseable output ever reached us to count;
 *   - the model's JSON never passed the `GroundedAnswer` schema after
 *     retries, so `ResilientProvider` ran its own internal deterministic
 *     fallback and `result.text` is that fallback's JSON, not the model's
 *     (`model_rejected_reason: 'invalid_json'` or `'provider_error'`).
 * `model_claims_verified` is `0` (with `model_claims_proposed` > 0 whenever
 * the model proposed anything) when the model's JSON parsed and validated
 * but every one of its own claims failed content verification
 * (`model_rejected_reason: 'all_claims_unverified'`).
 */
/**
 * Closed set of `critic_status` labels (`critic.js`, E2). `reviewed` only
 * when the critic model returned a valid verdict for every claim it was
 * sent; `failed` for a provider error, timeout or invalid JSON; `disabled`
 * when no critic model is configured; `skipped_budget` when the scan
 * deadline left less time than the critic's timeout; `skipped_no_claims`
 * when the answer had no claims to review; `skipped_identity_only` when every
 * claim cited a patient-identity field, so none could be sent;
 * `skipped_not_approved` when the answer used a live OpenEMR read and
 * AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED is not set (E9), so no claim
 * may leave the process.
 */
export const CRITIC_STATUS_VALUES = Object.freeze(['reviewed', 'failed', 'disabled', 'skipped_budget', 'skipped_no_claims', 'skipped_identity_only', 'skipped_not_approved']);

/** Closed set of critic reject reasons (`critic.js`, E2). */
export const CRITIC_REASON_CODES = Object.freeze(['UNCITED', 'UNSUPPORTED_BY_SOURCE', 'UNSAFE_ACTION']);

/**
 * Where a clinical rule's threshold comes from (`clinicalRules.js`): a chunk
 * of the guideline corpus (with its 5-key citation) or a named public
 * reference outside the corpus.
 */
export const ThresholdSource = z.object({
  kind: z.enum(['guideline_corpus', 'public_reference']),
  publisher: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  citation: Citation.optional(),
}).strict();

/**
 * One deterministic clinical-rule flag (`clinicalRules.js`, F-CLIN). A flag
 * never carries a value of its own: `citations` are the unchanged 5-key
 * citations of the facts that triggered it (plus the guideline chunk when
 * the threshold is in the corpus), and `text` restates only their values.
 * A flag that passed `verifyClaims` but that the critic vetoed still ships,
 * marked `critic_status: 'questioned'` with the critic's `critic_reason`
 * code: a veto of a verified safety warning must not hide it (critic.js).
 * A flag a rule raised on a reading the answer could not state as verified
 * (a low-confidence read, or a value whose unit was not read) also ships,
 * marked `verification_status: 'needs_verification'` with its
 * `verification_reason`; the workflow is then QUALIFIED, never READY.
 */
export const SafetyFlag = z.object({
  code: z.enum(['critical_value', 'diabetes_range', 'drug_allergy_conflict']),
  rule_id: z.enum(['potassium_critical_range', 'a1c_diabetes_range', 'allergy_medication_class']),
  severity: z.enum(['critical', 'warning']),
  text: z.string().min(1),
  citations: z.array(Citation).min(1),
  threshold_source: ThresholdSource,
  critic_status: z.enum(['questioned']).optional(),
  critic_reason: z.enum(CRITIC_REASON_CODES).optional(),
  verification_status: z.enum(['needs_verification']).optional(),
  verification_reason: z.enum(['low_confidence', 'unit_not_read']).optional(),
}).strict();

/**
 * A measured value the question asked for that no available fact records
 * (`notDocumented.js`, F-CLIN). `sources_checked` names the kinds of source
 * the answer had (e.g. `document`, `synthetic_chart_fixture`).
 */
export const NotDocumentedItem = z.object({
  concept: z.string().min(1),
  // `not_documented`: a source that holds this kind of data was read and has
  // no value. `not_retrieved`: no source read holds this kind of data (e.g.
  // the chart read does not include vitals), so absence is not claimed.
  status: z.enum(['not_documented', 'not_retrieved']),
  label: z.string().min(1),
  text: z.string().min(1),
  sources_checked: z.array(z.string().min(1)),
}).strict();

export const GroundedAnswerResult = z.object({
  // `not-documented`: the question asked only for values no source records,
  // so no claim was composed and `not_documented` says so (F-CLIN).
  composer: z.enum(['model', 'deterministic-fallback', 'model+deterministic-topup', 'not-documented']),
  model_rejected_reason: z.enum(['all_claims_unverified', 'invalid_json', 'provider_error', 'deadline']).optional(),
  // E2 critic outcome; optional so an answer composed outside the scan
  // supervisor (unit tests, the composer alone) stays valid. The scan path
  // always sets it. `critic_rejected` counts claims removed from what ships;
  // `critic_claims_not_sent` claims kept unreviewed by the identity guard;
  // `critic_topup_unreviewed` claims added after the critic ran (unreviewed).
  critic_status: z.enum(CRITIC_STATUS_VALUES).optional(),
  critic_rejected: z.number().int().nonnegative().optional(),
  critic_claims_not_sent: z.number().int().nonnegative().optional(),
  critic_topup_unreviewed: z.number().int().nonnegative().optional(),
  patient_facts: z.array(AnswerClaim),
  guideline_evidence: z.array(AnswerClaim),
  needs_review: z.array(NeedsReviewItem),
  // F-CLIN: optional so answers built outside the composer (tests, older
  // stored answers) stay valid; `composeGroundedAnswer` always sets both.
  safety_flags: z.array(SafetyFlag).optional(),
  // Flags a rule raised that failed `verifyClaims` (dropped, never shipped),
  // and verified flags the critic vetoed (still in `safety_flags`, each
  // marked `critic_status: 'questioned'`; never hidden).
  safety_flags_dropped: z.number().int().nonnegative().optional(),
  critic_flags_questioned: z.number().int().nonnegative().optional(),
  not_documented: z.array(NotDocumentedItem).optional(),
  unverified_dropped: z.number().int().nonnegative(),
  model_claims_proposed: z.number().int().nonnegative(),
  model_claims_verified: z.number().int().nonnegative(),
}).strict();

/**
 * Parse `value` against `schema`, returning a result object instead of
 * throwing.
 *
 * Args:
 *   schema: A Zod schema (typically one exported from this module).
 *   value: The candidate value to validate.
 *
 * Returns:
 *   `{ ok: true, data, issues: [] }` on success, or
 *   `{ ok: false, data: null, issues }` on failure, where each issue is a
 *   readable `path: message` string suitable for logging or a gate report.
 */
export function parseOrIssues(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data, issues: [] };
  const issues = result.error.issues.map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`);
  return { ok: false, data: null, issues };
}
