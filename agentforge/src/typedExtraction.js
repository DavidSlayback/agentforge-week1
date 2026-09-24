import { IntakeForm, LabResult, parseOrIssues } from './schemas.js';

const LAB_TEST_FIELD = /^(lab\.[a-z0-9_]+)\.(test_name|value|unit|reference_range|collection_date|abnormal)$/;
const LAB_SUFFIXES = ['test_name', 'value', 'unit', 'reference_range', 'collection_date', 'abnormal'];
// Single-letter shorthand (H/L/Y/N) is common on lab report forms alongside
// the spelled-out word; both are recognized, case-insensitively.
const HIGH_TOKENS = new Set(['high', 'elevated', 'h']);
const LOW_TOKENS = new Set(['low', 'decreased', 'l']);
const NORMAL_TOKENS = new Set(['no', 'false', 'normal', 'within range', 'n']);
const ABNORMAL_TOKENS = new Set(['yes', 'true', 'abnormal', 'y']);

/** Map a raw OCR/parsed abnormal-flag string onto the strict `AbnormalFlag` enum, never guessing when the source text is unrecognized. */
export function abnormalFlagFrom(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (HIGH_TOKENS.has(normalized)) return 'high';
  if (LOW_TOKENS.has(normalized)) return 'low';
  if (NORMAL_TOKENS.has(normalized)) return 'normal';
  if (ABNORMAL_TOKENS.has(normalized)) return 'abnormal';
  return 'unknown';
}

function isValidConfidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Group the flat per-field OCR facts the PDF-OCR layout emits (for example
 * `lab.hgb.value`, `lab.hgb.unit`, `lab.hgb.abnormal`, ...) into strict
 * `LabResult` objects, one per test.
 *
 * Every fact that is not folded into a `LabResult` — because it belongs to
 * an incomplete group, carries no usable confidence, or simply does not
 * match the known `lab.<test>.<field>` vocabulary (for example a flat
 * `lab.hgb` fact from the legacy fixture layout) — produces a `typed_issues`
 * entry. A fact is never silently dropped from the typed view.
 *
 * Args:
 *   facts: The `extraction.facts` array from `extractScanForm`, each with
 *     `{field_id, value, confidence, citation}`.
 *
 * Returns:
 *   `{results, issues}` — validated `LabResult` objects, plus one issue per
 *   test or fact that could not be typed. A test is never fabricated from
 *   partial or low-confidence data.
 */
export function buildTypedLabResults(facts) {
  const groups = new Map();
  const consumed = new Set();
  for (const fact of facts) {
    const match = LAB_TEST_FIELD.exec(fact.field_id);
    if (!match) continue;
    const [, testId, suffix] = match;
    const group = groups.get(testId) || {};
    group[suffix] = fact;
    groups.set(testId, group);
    consumed.add(fact.field_id);
  }
  const results = [];
  const issues = [];
  for (const [testId, fields] of groups) {
    const missing = LAB_SUFFIXES.filter((suffix) => !fields[suffix]);
    if (missing.length) {
      issues.push(`typed_lab_result_incomplete:${testId}:${missing.join(',')}`);
      continue;
    }
    const missingConfidence = LAB_SUFFIXES.filter((suffix) => !isValidConfidence(fields[suffix].confidence));
    if (missingConfidence.length) {
      issues.push(`typed_lab_result_missing_confidence:${testId}:${missingConfidence.join(',')}`);
      continue;
    }
    const candidate = {
      test_name: fields.test_name.value,
      value: fields.value.value,
      unit: fields.unit.value,
      reference_range: fields.reference_range.value,
      collection_date: fields.collection_date.value,
      abnormal_flag: abnormalFlagFrom(fields.abnormal.value),
      confidence: Math.min(...LAB_SUFFIXES.map((suffix) => fields[suffix].confidence)),
      citation: fields.value.citation,
    };
    const parsed = parseOrIssues(LabResult, candidate);
    if (parsed.ok) results.push(parsed.data);
    else issues.push(...parsed.issues.map((issue) => `typed_lab_result_invalid:${testId}:${issue}`));
  }
  // General safety net: a fact that never joined any group above (it does
  // not match the known `lab.<test>.<field>` naming, e.g. a flat `lab.hgb`
  // fact from a non-PDF-OCR layout) must still be accounted for rather than
  // silently omitted from the typed view.
  for (const fact of facts) {
    if (!consumed.has(fact.field_id)) issues.push(`fact_not_mapped_to_typed_output:${fact.field_id}`);
  }
  return { results, issues };
}

const INTAKE_LEAF_PATHS = Object.freeze({
  'patient.name': ['demographics', 'name'],
  'patient.date_of_birth': ['demographics', 'dob'],
  'patient.phone': ['demographics', 'phone'],
  chief_concern: ['chief_concern'],
  medications: ['current_medications'],
  allergies: ['allergies'],
  family_history: ['family_history'],
});
const INTAKE_LIST_KEYS = new Set(['current_medications', 'allergies', 'family_history']);
const INTAKE_LIST_PREFIXES = Object.freeze({ 'medication.': 'current_medications', 'allergy.': 'allergies' });

const notFound = () => ({ status: 'not_found_on_form', value: null, confidence: 0, citation: null });

/**
 * Build an `observed` intake-field entry from a fact, or `null` when the
 * fact has no usable confidence — in which case a typed_issue is recorded
 * instead of defaulting to a made-up confidence value.
 */
function observedOrIssue(fact, issues) {
  if (!isValidConfidence(fact.confidence)) {
    issues.push(`missing_confidence:${fact.field_id}`);
    return null;
  }
  return { status: 'observed', value: fact.value, confidence: fact.confidence, citation: fact.citation };
}

/**
 * Assemble the strict `IntakeForm` object from the flat per-field OCR facts
 * the PDF-OCR layout emits (`patient.name`, `chief_concern`, `medications`,
 * ...), plus the per-item `medication.<name>` / `allergy.<name>` fixture ids
 * used by the non-PDF-OCR layout — each one names a single medication or
 * allergy and is appended to the matching list. `name`/`dob`/`chief_concern`
 * are marked `not_found_on_form` rather than omitted when the form did not
 * yield a value; `phone` is left out of the object entirely when absent,
 * since not every intake form asks for it.
 *
 * Any fact that does not match a known leaf field or list prefix — or that
 * matched but lacked a usable confidence — produces a `fact_not_mapped_to_typed_output`
 * / `missing_confidence` issue rather than being silently dropped, so an
 * IntakeForm can never claim "no medications" next to an unmapped medication
 * fact.
 *
 * Args:
 *   facts: The `extraction.facts` array from `extractScanForm`.
 *
 * Returns:
 *   `{ok, data, issues}` — `issues` includes both `IntakeForm` schema
 *   validation issues (present only when `ok` is false) and the
 *   unmapped-fact/missing-confidence issues above (present regardless).
 */
export function buildTypedIntakeForm(facts) {
  const byFieldId = new Map(facts.map((fact) => [fact.field_id, fact]));
  const consumed = new Set();
  const issues = [];
  const candidate = { demographics: { name: notFound(), dob: notFound() }, chief_concern: notFound(), current_medications: [], allergies: [], family_history: [] };
  for (const [fieldId, path] of Object.entries(INTAKE_LEAF_PATHS)) {
    const fact = byFieldId.get(fieldId);
    if (!fact) continue;
    const entry = observedOrIssue(fact, issues);
    consumed.add(fieldId);
    if (!entry) continue;
    if (path[0] === 'demographics') candidate.demographics[path[1]] = entry;
    else if (INTAKE_LIST_KEYS.has(path[0])) candidate[path[0]] = [entry];
    else candidate[path[0]] = entry;
  }
  for (const fact of facts) {
    if (consumed.has(fact.field_id)) continue;
    const prefix = Object.keys(INTAKE_LIST_PREFIXES).find((candidatePrefix) => fact.field_id.startsWith(candidatePrefix));
    if (!prefix) continue;
    consumed.add(fact.field_id);
    const entry = observedOrIssue(fact, issues);
    if (entry) candidate[INTAKE_LIST_PREFIXES[prefix]].push(entry);
  }
  for (const fact of facts) {
    if (!consumed.has(fact.field_id)) issues.push(`fact_not_mapped_to_typed_output:${fact.field_id}`);
  }
  const parsed = parseOrIssues(IntakeForm, candidate);
  return { ok: parsed.ok, data: parsed.data, issues: [...parsed.issues.map((issue) => (parsed.ok ? issue : `typed_intake_form_invalid:${issue}`)), ...issues] };
}
