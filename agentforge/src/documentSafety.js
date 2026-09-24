/**
 * Fail-loud checks applied after extraction and before a scan workflow may be
 * READY (W2-SF1). They read only the document's own text and the typed
 * extraction; they never read eval expectations.
 */

// Distinct vocabulary per document type. DOB/name are deliberately absent
// from the intake list because real lab reports carry a patient header too.
const LAB_TERMS = [/\bh(?:a)?emoglobin\b/, /\bhgb\b/, /\b(?:hb)?a1c\b/, /\breference range\b/, /\bcollection date\b/, /\bg\/dl\b/, /\bmg\/dl\b/, /\bmmol\/l\b/, /\blaboratory\b/, /\blab (?:report|results?)\b/, /\bspecimen\b/];
const INTAKE_TERMS = [/\bdate of birth\b/, /\breason for visit\b/, /\bchief concern\b/, /\bcurrent medications?\b/, /\ballerg(?:y|ies)\b/, /\bfamily history\b/, /\bintake\b/, /\b(?:tele)?phone\b/, /\bpatient information\b/, /\bnew patient\b/];
const MIN_HITS = 2;
const MIN_MARGIN = 2;

/**
 * Infer the document type from its text (OCR lines or a text envelope).
 *
 * Returns:
 *   `{detected: 'lab_pdf'|'intake_form'|'undetermined', lab_hits, intake_hits}`.
 *   A type is only claimed with at least two distinct keyword hits and a
 *   two-hit margin over the other type, so a lone "Allergies" line on a lab
 *   report does not flip it.
 */
export function detectDocumentType(text) {
  const normalized = String(text || '').toLowerCase();
  const labHits = LAB_TERMS.filter((term) => term.test(normalized)).length;
  const intakeHits = INTAKE_TERMS.filter((term) => term.test(normalized)).length;
  const detected = labHits >= MIN_HITS && labHits - intakeHits >= MIN_MARGIN ? 'lab_pdf'
    : intakeHits >= MIN_HITS && intakeHits - labHits >= MIN_MARGIN ? 'intake_form'
      : 'undetermined';
  return { detected, lab_hits: labHits, intake_hits: intakeHits };
}

const nameTokens = (value) => String(value || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

/** Normalize `YYYY-MM-DD`, `YYYY/MM/DD` or `MM/DD/YYYY` to ISO `YYYY-MM-DD`; `null` when unparseable. */
export function normalizeDob(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return null;
}

/**
 * Compare an intake form's observed demographics with the target patient's
 * known demographics.
 *
 * Args:
 *   intakeForm: Typed `IntakeForm` or `null`.
 *   targetPatient: `{name, dob}` from a `PatientDemographicsSource`, or `null`
 *     when the chart cannot supply them.
 *
 * Returns:
 *   `{status: 'match'|'mismatch'|'unverified', mismatched_fields}`. Any observed
 *   field that contradicts the chart is a mismatch; an unreadable DOB or a
 *   missing chart record is `unverified`, never a match.
 */
export function checkPatientIdentity(intakeForm, targetPatient) {
  const name = intakeForm?.demographics?.name;
  const dob = intakeForm?.demographics?.dob;
  const observedName = name?.status === 'observed' ? name.value : null;
  const observedDob = dob?.status === 'observed' ? dob.value : null;
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
  const identity = documentType === 'intake_form' ? checkPatientIdentity(extraction?.intake_form, targetPatient) : { status: 'not_applicable', mismatched_fields: [] };
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
