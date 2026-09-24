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
  source_type: z.enum(['document', 'guideline', 'openemr_record']),
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
 * A single retrieved and cited guideline evidence chunk.
 *
 * `snippet` is the chunk text surfaced to the answer model; `sparse_score`,
 * `dense_score`, and `rerank_score` record the hybrid-retrieval signals
 * that ranked it, for the routing trace. `citation.field_or_chunk_id`
 * identifies the specific chunk within `citation.source_id`'s document.
 *
 * `url`/`publisher` are the chunk's source-page metadata (from the corpus
 * file, not invented at retrieval time). `degraded` is `null` when this item
 * came from the full sparse+dense+rerank pipeline using a real Gemini
 * client; `'sparse_only'` when it came from a BM25-only fallback (no corpus
 * embeddings, no Gemini key, or a failed Gemini call); or `'stub'` when the
 * hybrid pipeline ran its full shape but one or more steps were answered by
 * the deterministic test/gate stand-in (`recorded-or-stub` with no matching
 * recorded fixture) rather than a real or recorded Gemini response — never
 * optional, so neither case can be silently presented as a genuine hybrid
 * result (AGENTS.md).
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
  degraded: z.enum(['sparse_only', 'stub']).nullable(),
  citation: Citation,
}).strict();

/**
 * One claim in a W2 grounded answer (S6).
 *
 * `kind` separates patient-record facts (this document's typed extraction or
 * an OpenEMR chart record) from guideline evidence and pure framing prose, so
 * the UI and the eval gate can render/check "patient record" and "guideline
 * evidence" as distinct sections per the W2 scenario ("separate patient-record
 * facts from guideline evidence"). `citations` is validated against the same
 * five-key `Citation` used everywhere else; `claimBinding.js#verifyClaims`
 * additionally enforces that `patient_fact` claims cite only `document`/
 * `openemr_record` sources and `guideline` claims cite only `guideline`
 * sources, and that the claim text is actually derivable from what is cited.
 */
export const AnswerClaim = z.object({
  kind: z.enum(['patient_fact', 'guideline', 'framing']),
  text: z.string().min(1),
  citations: z.array(Citation),
}).strict();

/**
 * The exact JSON contract the answer-composer model (or its deterministic
 * fallback) must return. This is intentionally narrow — just claims — so the
 * model/fallback boundary is a single well-defined shape; `answerComposer.js`
 * separates and annotates these claims into the richer `GroundedAnswerResult`
 * below after verification.
 */
export const GroundedAnswer = z.object({
  claims: z.array(AnswerClaim),
}).strict();

/**
 * One fact excluded from the answer because it was flagged low-confidence or
 * needs-review before composition ever ran (never because it failed
 * verification — those are counted separately in `unverified_dropped`).
 */
export const NeedsReviewItem = z.object({
  kind: z.enum(['lab_result', 'intake_field', 'patient_record']),
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
 */
export const GroundedAnswerResult = z.object({
  composer: z.enum(['model', 'deterministic-fallback', 'model+deterministic-topup']),
  model_rejected_reason: z.enum(['all_claims_unverified', 'invalid_json', 'provider_error', 'deadline']).optional(),
  patient_facts: z.array(AnswerClaim),
  guideline_evidence: z.array(AnswerClaim),
  needs_review: z.array(NeedsReviewItem),
  unverified_dropped: z.number().int().nonnegative(),
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
