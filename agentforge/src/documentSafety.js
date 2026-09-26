/**
 * Fail-loud checks applied after extraction and before a scan workflow may be
 * READY (W2-SF1). They read only the document's own text and the typed
 * extraction; they never read eval expectations.
 */

// Distinct vocabulary per document type. DOB/name are deliberately absent
// from the intake list because real lab reports carry a patient header too.
const LAB_TERMS = [/\bh(?:a)?emoglobin\b/, /\bhgb\b/, /\b(?:hb)?a1c\b/, /\breference range\b/, /\bcollection date\b/, /\bg\/dl\b/, /\bmg\/dl\b/, /\bmmol\/l\b/, /\blaboratory\b/, /\blab (?:report|results?)\b/, /\bspecimen\b/];
const INTAKE_TERMS = [/\bdate of birth\b/, /\breason for visit\b/, /\bchief concern\b/, /\bcurrent medications?\b/, /\ballerg(?:y|ies)\b/, /\bfamily history\b/, /\bintake\b/, /\b(?:tele)?phone\b/, /\bpatient information\b/, /\bnew patient\b/];
// Medication-list vocabulary. Plain "mg", "daily" and "medications" are left
// out on purpose: intake forms list current medications with doses too.
const MEDICATION_LIST_TERMS = [/\bmedication list\b/, /\bmedication reconciliation\b/, /\bprescriber\b/, /\bpharmacy\b/, /\b(?:medication|rx)\s*#?\s*\d{1,2}\s*:/, /\b(?:by mouth|orally|oral)\b/, /\b(?:once|twice|three times|four times) daily\b|\bat bedtime\b|\bevery \d+ hours\b/, /\blist date\b|\breviewed on\b/, /\bdose\b/, /\bfrequency\b/, /\broute\b/];
const MIN_HITS = 2;
const MIN_MARGIN = 2;
const TYPE_TERMS = Object.freeze({ lab_pdf: LAB_TERMS, intake_form: INTAKE_TERMS, medication_list: MEDICATION_LIST_TERMS });

/**
 * Infer the document type from its text (OCR lines or a text envelope).
 *
 * Returns:
 *   `{detected: 'lab_pdf'|'intake_form'|'medication_list'|'undetermined',
 *   lab_hits, intake_hits, medication_list_hits}`. A type is only claimed
 *   with at least two distinct keyword hits and a two-hit margin over every
 *   other type, so a lone "Allergies" line on a lab report does not flip it.
 */
export function detectDocumentType(text) {
  const normalized = String(text || '').toLowerCase();
  const types = Object.keys(TYPE_TERMS);
  const hits = Object.fromEntries(types.map((type) => [type, TYPE_TERMS[type].filter((term) => term.test(normalized)).length]));
  const detected = types.find((type) => hits[type] >= MIN_HITS && types.every((other) => other === type || hits[type] - hits[other] >= MIN_MARGIN)) || 'undetermined';
  return { detected, lab_hits: hits.lab_pdf, intake_hits: hits.intake_form, medication_list_hits: hits.medication_list };
}

const nameTokens = (value) => String(value || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter((token) => /[a-z]/.test(token)).sort().join(' ');

/** Normalize `YYYY-MM-DD`, `YYYY/MM/DD` or `MM/DD/YYYY` to ISO `YYYY-MM-DD`; `null` when unparseable. */
export function normalizeDob(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return null;
}

// The label must not follow a word on the same line: "Hemoglobin test name:
// Hemoglobin" is a lab field, not a patient header. Without this, a lab with
// no printed header read its first test name as the patient's name and was
// BLOCKED patient_mismatch on the right chart.
const HEADER_NAME = /(?<![A-Za-z0-9][ \t]*)\b(?:patient(?:\s+name)?|name)\s*:\s*([^:]+?)\s*(?:[-–·•~|,]\s*)*(?=\bdob\b|\bdate of birth\b|$)/i;
const HEADER_DOB = /\b(?:dob|date of birth)\s*:\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/i;

/**
 * Read the patient name and DOB printed in a lab report's header lines (for
 * example `Patient: Test Patient One - DOB: 1980-04-12`, or separate `Name:`
 * and `DOB:` lines). The first readable value of each wins; absent values are
 * `null`.
 */
export function readHeaderIdentity(text) {
  let name = null;
  let dob = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    name ??= HEADER_NAME.exec(line)?.[1]?.trim() || null;
    dob ??= HEADER_DOB.exec(line)?.[1] || null;
  }
  return { name, dob };
}

/**
 * Compare observed `{name, dob}` (either may be `null`) with the target
 * patient's known demographics.
 *
 * Args:
 *   observed: Name/DOB read from the document.
 *   targetPatient: `{name, dob}` from a `PatientDemographicsSource`, or `null`
 *     when the chart cannot supply them.
 *
 * Returns:
 *   `{status: 'match'|'mismatch'|'unverified', mismatched_fields}`. Any observed
 *   field that contradicts the chart is a mismatch. Nothing observed, an
 *   unreadable DOB, a missing name or DOB, or a missing chart record is
 *   `unverified`, never a match.
 */
export function compareIdentity({ name: observedName = null, dob: observedDob = null } = {}, targetPatient) {
  if (!observedName && !observedDob) return { status: 'unverified', mismatched_fields: [] };
  if (!targetPatient) return { status: 'unverified', mismatched_fields: [] };
  const mismatched = [];
  let unverified = false;
  if (observedName && nameTokens(observedName) !== nameTokens(targetPatient.name)) mismatched.push('name');
  if (observedDob) {
    const formDob = normalizeDob(observedDob);
    const chartDob = normalizeDob(targetPatient.dob);
    if (!formDob || !chartDob) unverified = true;
    else if (formDob !== chartDob) mismatched.push('dob');
  }
  if (mismatched.length) return { status: 'mismatch', mismatched_fields: mismatched };
  return { status: unverified || !observedName || !observedDob ? 'unverified' : 'match', mismatched_fields: [] };
}

/** Compare a typed `IntakeForm`'s observed demographics with the target patient (see `compareIdentity`). */
export function checkPatientIdentity(intakeForm, targetPatient) {
  const observed = (field) => (field?.status === 'observed' ? field.value : null);
  return compareIdentity({ name: observed(intakeForm?.demographics?.name), dob: observed(intakeForm?.demographics?.dob) }, targetPatient);
}

/** Compare the identity printed on a typed `MedicationList` with the target patient (see `compareIdentity`). */
export function checkMedicationListIdentity(medicationList, targetPatient) {
  const observed = (field) => (field?.status === 'observed' ? field.value : null);
  return compareIdentity({ name: observed(medicationList?.patient?.name), dob: observed(medicationList?.patient?.dob) }, targetPatient);
}

/**
 * Decide which fail-loud conditions hold for one extracted document.
 *
 * Returns:
 *   `{checks, blocking, qualifying}`: `blocking` reasons stop the workflow
 *   (BLOCKED), `qualifying` reasons cap it at QUALIFIED. Reason codes:
 *   `patient_mismatch`, `no_fields_extracted` (blocking) and
 *   `doc_type_mismatch`, `patient_identity_unverified`, `extraction_incomplete`
 *   (qualifying; the last covers missing, conflicting, unreadable or untyped
 *   fields, i.e. any extraction status other than `complete`).
 */
export function assessDocumentSafety({ documentType, documentText, extraction, targetPatient = null }) {
  const factCount = extraction?.facts?.length || 0;
  const typeDetection = detectDocumentType(documentText);
  const typeStatus = typeDetection.detected === 'undetermined' ? 'undetermined' : typeDetection.detected === documentType ? 'consistent' : 'mismatch';
  // Intake forms and medication lists are checked on their typed identity
  // fields, lab reports on the patient header printed on the page.
  const identity = documentType === 'intake_form'
    ? { ...checkPatientIdentity(extraction?.intake_form, targetPatient), source: 'intake_form_demographics' }
    : documentType === 'medication_list'
      ? { ...checkMedicationListIdentity(extraction?.medication_list, targetPatient), source: 'medication_list_patient' }
      : { ...compareIdentity(readHeaderIdentity(documentText), targetPatient), source: 'lab_report_header' };
  const blocking = [];
  const qualifying = [];
  if (identity.status === 'mismatch') blocking.push('patient_mismatch');
  if (!factCount) blocking.push('no_fields_extracted');
  if (typeStatus === 'mismatch') qualifying.push('doc_type_mismatch');
  if (identity.status === 'unverified') qualifying.push('patient_identity_unverified');
  if (factCount && extraction?.status !== 'complete') qualifying.push('extraction_incomplete');
  return {
    checks: {
      fields_extracted: factCount,
      extraction_status: extraction?.status,
      document_type: { declared: documentType, detected: typeDetection.detected, status: typeStatus },
      patient_identity: identity,
    },
    blocking,
    qualifying,
  };
}
