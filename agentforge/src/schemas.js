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
 * came from the full sparse+dense+rerank pipeline, or `'sparse_only'` when
 * it came from a BM25-only fallback (no corpus embeddings, no Gemini key, or
 * a failed Gemini call) — required, not optional, so a sparse-only result
 * can never be silently presented as hybrid (AGENTS.md).
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
  degraded: z.enum(['sparse_only']).nullable(),
  citation: Citation,
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
