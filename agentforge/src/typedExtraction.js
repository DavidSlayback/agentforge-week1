import { IntakeForm, LabResult, MedicationList, parseOrIssues } from './schemas.js';

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

const MEDICATION_LIST_LEAVES = Object.freeze({
  'medlist.list_date': ['list_date'],
  'medlist.prescriber_or_source': ['prescriber_or_source'],
  'patient.name': ['patient', 'name'],
  'patient.date_of_birth': ['patient', 'dob'],
});
const MEDICATION_PARTS = ['dose', 'unit', 'frequency', 'route'];
const MEDICATION_ROW = /^medication\.([1-9][0-9]?)\.(name|dose|unit|frequency|route)$/;

/**
 * Assemble the strict `MedicationList` from the flat per-field facts the
 * medication-list PDF-OCR layout emits (`medlist.list_date`,
 * `medlist.prescriber_or_source`, `patient.name`, `patient.date_of_birth`,
 * and `medication.<n>.<part>` for each printed row).
 *
 * A header field the list does not show is `not_found_on_form`. A row part
 * the row does not show is `not_found_on_form` and also a
 * `typed_medication_incomplete` issue, so the extraction cannot be
 * `complete` with a half-read row. A row whose drug name was not read is not
 * typed as a medication at all (`typed_medication_row_without_name`). Every
 * other fact that does not map is reported, never dropped.
 *
 * Returns:
 *   `{ok, data, issues}` like `buildTypedIntakeForm`.
 */
export function buildTypedMedicationList(facts) {
  const issues = [];
  const consumed = new Set();
  const candidate = { list_date: notFound(), prescriber_or_source: notFound(), patient: { name: notFound(), dob: notFound() }, medications: [] };
  const byFieldId = new Map(facts.map((fact) => [fact.field_id, fact]));
  for (const [fieldId, path] of Object.entries(MEDICATION_LIST_LEAVES)) {
    const fact = byFieldId.get(fieldId);
    if (!fact) continue;
    consumed.add(fieldId);
    const entry = observedOrIssue(fact, issues);
    if (!entry) continue;
    if (path.length === 2) candidate[path[0]][path[1]] = entry;
    else candidate[path[0]] = entry;
  }
  const rows = new Map();
  for (const fact of facts) {
    const match = MEDICATION_ROW.exec(fact.field_id);
    if (!match) continue;
    consumed.add(fact.field_id);
    const row = rows.get(Number(match[1])) || {};
    row[match[2]] = fact;
    rows.set(Number(match[1]), row);
  }
  for (const [index, row] of [...rows.entries()].sort(([a], [b]) => a - b)) {
    const rowId = `medication.${index}`;
    if (!row.name) { issues.push(`typed_medication_row_without_name:${rowId}`); continue; }
    const withoutConfidence = ['name', ...MEDICATION_PARTS].filter((part) => row[part] && !isValidConfidence(row[part].confidence));
    if (withoutConfidence.length) { issues.push(`missing_confidence:${rowId}:${withoutConfidence.join(',')}`); continue; }
    const missing = MEDICATION_PARTS.filter((part) => !row[part]);
    if (missing.length) issues.push(`typed_medication_incomplete:${rowId}:${missing.join(',')}`);
    const part = (key) => (row[key] ? { status: 'observed', value: row[key].value, confidence: row[key].confidence } : { status: 'not_found_on_form', value: null, confidence: 0 });
    candidate.medications.push({ name: part('name'), dose: part('dose'), unit: part('unit'), frequency: part('frequency'), route: part('route'), citation: row.name.citation });
  }
  for (const fact of facts) {
    if (!consumed.has(fact.field_id)) issues.push(`fact_not_mapped_to_typed_output:${fact.field_id}`);
  }
  const parsed = parseOrIssues(MedicationList, candidate);
  return { ok: parsed.ok, data: parsed.data, issues: [...parsed.issues.map((issue) => `typed_medication_list_invalid:${issue}`), ...issues] };
}

/**
 * Summarize extraction confidence from lab results and observed intake fields.
 *
 * Collects numeric confidence values from `extraction.lab_results[].confidence`
 * and from intake fields with `status: 'observed'`. Returns mean and minimum
 * (both rounded to 2 decimals) and count of observed fields, or nulls if no
 * confidence values are found.
 *
 * Uses "count" (not "fields") as the key for the number of observations to avoid
 * redaction by the trace's key-based redactor, which redacts keys matching
 * certain patterns including "field".
 */
export function summarizeExtractionConfidence(extraction) {
  if (!extraction) {
    return { mean: null, min: null, count: 0 };
  }

  const confidences = [];

  // Collect confidence from lab results
  if (Array.isArray(extraction.lab_results)) {
    for (const result of extraction.lab_results) {
      if (isValidConfidence(result.confidence)) {
        confidences.push(result.confidence);
      }
    }
  }

  // Collect confidence from observed intake fields
  if (extraction.intake_form) {
    const form = extraction.intake_form;
    const collectIntakeConfidence = (field) => {
      if (field && field.status === 'observed' && isValidConfidence(field.confidence)) {
        confidences.push(field.confidence);
      }
    };

    if (form.demographics) {
      collectIntakeConfidence(form.demographics.name);
      collectIntakeConfidence(form.demographics.dob);
      if (form.demographics.phone) {
        collectIntakeConfidence(form.demographics.phone);
      }
      if (form.demographics.sex) {
        collectIntakeConfidence(form.demographics.sex);
      }
    }

    collectIntakeConfidence(form.chief_concern);

    if (Array.isArray(form.current_medications)) {
      for (const med of form.current_medications) {
        collectIntakeConfidence(med);
      }
    }

    if (Array.isArray(form.allergies)) {
      for (const allergy of form.allergies) {
        collectIntakeConfidence(allergy);
      }
    }

    if (Array.isArray(form.family_history)) {
      for (const history of form.family_history) {
        collectIntakeConfidence(history);
      }
    }
  }

  // Collect confidence from observed medication-list fields and row parts
  const medicationList = extraction.medication_list;
  if (medicationList) {
    const collect = (field) => { if (field?.status === 'observed' && isValidConfidence(field.confidence)) confidences.push(field.confidence); };
    [medicationList.list_date, medicationList.prescriber_or_source, medicationList.patient?.name, medicationList.patient?.dob].forEach(collect);
    for (const item of medicationList.medications || []) ['name', 'dose', 'unit', 'frequency', 'route'].forEach((key) => collect(item[key]));
  }

  if (confidences.length === 0) {
    return { mean: null, min: null, count: 0 };
  }

  const sum = confidences.reduce((a, b) => a + b, 0);
  const mean = Math.round((sum / confidences.length) * 100) / 100;
  const min = Math.round(Math.min(...confidences) * 100) / 100;

  return { mean, min, count: confidences.length };
}
