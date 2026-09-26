import { formulateEvidenceQuery } from '../activeWorkers.js';
import { validateScanExtractionTypedOutput } from '../contracts.js';
import { MedicationList, parseOrIssues } from '../schemas.js';
import { citationIssues, extractionOf } from '../w2RegressionGate.js';

/**
 * X-3 third document type (E4): `medication_list`, run end to end through the
 * same harness as the golden set (upload -> recorded Tesseract OCR replay ->
 * medication-list label map -> typed MedicationList -> fail-loud checks ->
 * evidence query -> grounded answer). Expected values come from the
 * hand-written truth files `test/fixtures/golden/truth/medlist-{a,b}.json`,
 * never from these specs or from OCR output.
 */

const PARTS = ['name', 'dose', 'unit', 'frequency', 'route'];
const LOW_CONFIDENCE = 0.85;
const observed = (field) => (field?.status === 'observed' ? field.value : null);
const ocrLineFor = (doc, citation) => doc.ocr?.pages?.flatMap((page) => page.lines).find((line) => line.text === citation?.quote_or_value) || null;

/** schema_valid: the typed MedicationList parses, passes the HTTP-boundary validator, and has the expected rows. */
export function checkMedicationListTyped(run, { medications }) {
  if (run.error) return ['workflow_threw'];
  const extraction = extractionOf(run);
  if (!extraction) return ['extraction_missing'];
  const issues = [];
  if (!extraction.medication_list) return ['medication_list_missing'];
  if (!parseOrIssues(MedicationList, extraction.medication_list).ok) issues.push('medication_list_zod_invalid');
  if (!validateScanExtractionTypedOutput(extraction).valid) issues.push('typed_output_validator_rejects');
  if (extraction.medication_list.medications.length !== medications) issues.push(`medication_count_${extraction.medication_list.medications.length}_expected_${medications}`);
  if (extraction.status !== 'complete') issues.push(`extraction_status_${extraction.status}`);
  if ((extraction.typed_issues || []).length) issues.push('typed_issues_present');
  if ((extraction.lab_results || []).length || extraction.intake_form) issues.push('other_document_type_output_present');
  return issues;
}

/** citation_present: every row and every fact cites the stored document, quotes a verbatim OCR line inside the page, and the row quote shows every part it claims. */
export function checkMedicationListCitations(run) {
  if (run.error) return ['workflow_threw'];
  const extraction = extractionOf(run);
  const list = extraction?.medication_list;
  if (!list?.medications?.length) return ['no_medication_rows_to_check'];
  const doc = run.docs[0];
  const sourceId = run.sourceIds[0];
  const issues = [];
  list.medications.forEach((item, index) => {
    const label = `medication[${index}]`;
    issues.push(...citationIssues(label, item.citation, { sourceId, doc }));
    for (const part of PARTS) {
      const value = observed(item[part]);
      if (value && !String(item.citation?.quote_or_value || '').includes(value)) issues.push(`${label}.${part}:value_not_in_quote`);
    }
  });
  for (const [key, field] of [['list_date', list.list_date], ['prescriber_or_source', list.prescriber_or_source], ['patient.name', list.patient?.name], ['patient.dob', list.patient?.dob]]) {
    if (field?.status === 'observed') issues.push(...citationIssues(`medication_list.${key}`, field.citation, { sourceId, doc }));
  }
  for (const fact of extraction.facts || []) {
    issues.push(...citationIssues(`fact:${fact.field_id}`, fact.citation, { sourceId, doc }));
    // Facts from OCR lines below 0.85 (and only those) carry the review flag.
    if ((fact.confidence < LOW_CONFIDENCE) !== (fact.uncertainty === 'low_confidence_requires_human_review')) issues.push(`fact:${fact.field_id}:review_flag_wrong`);
  }
  return issues;
}

/**
 * factually_consistent: values equal the truth file, each part's confidence
 * is its OCR line's, the evidence query names every listed drug, and the
 * answer states every confident row (and sends the rest to review).
 */
export function checkMedicationListFacts(run) {
  if (run.error) return ['workflow_threw'];
  const list = extractionOf(run)?.medication_list;
  if (!list) return ['medication_list_missing'];
  const truth = run.docs[0].truth.medication_list;
  const doc = run.docs[0];
  const issues = [];
  const expectEqual = (label, actual, expected) => { if (actual !== expected) issues.push(`${label}_mismatch`); };
  expectEqual('list_date', observed(list.list_date), truth.list_date);
  expectEqual('prescriber_or_source', observed(list.prescriber_or_source), truth.prescriber_or_source ?? null);
  expectEqual('patient.name', observed(list.patient.name), truth.patient_name);
  expectEqual('patient.dob', observed(list.patient.dob), truth.dob);
  if (list.medications.length !== truth.medications.length) issues.push('medication_count_mismatch');
  truth.medications.forEach((expected, index) => {
    const item = list.medications[index];
    if (!item) return;
    for (const part of PARTS) expectEqual(`medication[${index}].${part}`, observed(item[part]), expected[part] ?? null);
    const line = ocrLineFor(doc, item.citation);
    if (!line) issues.push(`medication[${index}]:ocr_line_missing`);
    else for (const part of PARTS) if (item[part].status === 'observed' && item[part].confidence !== Number(line.confidence.toFixed(2))) issues.push(`medication[${index}].${part}:confidence_not_ocr_line`);
  });
  const query = formulateEvidenceQuery({ medicationList: list });
  if (!query.startsWith('Medication reconciliation:')) issues.push('evidence_query_not_reconciliation');
  for (const expected of truth.medications) if (!query.includes(expected.name)) issues.push('evidence_query_missing_drug');
  const answer = run.result?.workflow?.answer;
  if (!answer) return [...issues, 'answer_missing'];
  const stated = new Set(answer.patient_facts.flatMap((claim) => claim.citations.map((citation) => citation.field_or_chunk_id)));
  const reviewed = new Set(answer.needs_review.filter((item) => item.kind === 'medication_list_item').map((item) => item.field));
  list.medications.forEach((item, index) => {
    const confident = PARTS.every((part) => item[part].status !== 'observed' || item[part].confidence >= LOW_CONFIDENCE);
    const id = item.citation.field_or_chunk_id;
    if (confident && !stated.has(id)) issues.push(`medication[${index}]:confident_row_not_in_answer`);
    if (!confident && (!reviewed.has(id) || stated.has(id))) issues.push(`medication[${index}]:low_confidence_row_not_sent_to_review`);
  });
  return issues;
}

export function medicationListCases({ kase, scan, P2 }) {
  return [
    kase('x3-sv-01-medlist-a-typed', 'schema_valid', 'A clean vector medication list no longer parses into a strict MedicationList with three rows (a row or header is dropped, a part is typed wrongly, or lab/intake output leaks into it).', scan('medlist-a', 'medication_list'), { custom: (run) => checkMedicationListTyped(run, { medications: 3 }) }),
    kase('x3-sv-02-medlist-b-typed', 'schema_valid', 'The alternate labels of a rasterized medication list ("Name:", "Reviewed on:", "Source:", "Rx 1:") stop mapping into a valid MedicationList.', scan('medlist-b', 'medication_list'), { custom: (run) => checkMedicationListTyped(run, { medications: 3 }) }),
    kase('x3-cp-01-medlist-a-citations', 'citation_present', 'A medication row or fact is cited without the five keys, cites another document, quotes text that is not a verbatim OCR line, has a box that is not that line, or claims a dose/route its quoted row does not show.', scan('medlist-a', 'medication_list'), { custom: checkMedicationListCitations }),
    kase('x3-cp-02-medlist-b-citations', 'citation_present', 'Rows read from a rasterized medication list lose their page region or verbatim quote.', scan('medlist-b', 'medication_list'), { custom: checkMedicationListCitations }),
    kase('x3-fc-01-medlist-a-values', 'factually_consistent', 'A drug name, dose, unit, frequency, route, the list date, prescriber or printed identity no longer equals the document; a part carries a confidence other than its OCR line; the evidence query drops a drug; or a confident row is missing from the answer (a low-confidence row stated instead of sent to review).', scan('medlist-a', 'medication_list'), { custom: checkMedicationListFacts }),
    kase('x3-fc-02-medlist-b-values', 'factually_consistent', 'Values read from a rasterized medication list drift from the document (e.g. mcg read as mg, "by mouth" cut, or "every 6 hours as needed" split).', scan('medlist-b', 'medication_list'), { custom: checkMedicationListFacts }),
    kase('x3-sr-01-medlist-declared-lab', 'safe_refusal', 'A medication list uploaded as a lab report is reported READY, or its type contradiction is not surfaced.', scan('medlist-a', 'lab_pdf'), { refusal: { final_state: 'BLOCKED', stop_reason: 'no_fields_extracted', reasons_include: ['doc_type_mismatch'], detected_type: 'medication_list', retrieval_ran: false } }),
    kase('x3-sr-02-lab-declared-medlist', 'safe_refusal', 'A lab report uploaded as a medication list is reported READY instead of QUALIFIED doc_type_mismatch.', scan('lab-a', 'medication_list'), { refusal: { final_state: 'QUALIFIED', reasons_include: ['doc_type_mismatch'], detected_type: 'lab_pdf' } }),
    kase('x3-sr-03-intake-declared-medlist', 'safe_refusal', "An intake form (whose medication line has a dose) uploaded as a medication list is reported READY instead of QUALIFIED doc_type_mismatch.", scan('intake-a', 'medication_list'), { refusal: { final_state: 'QUALIFIED', reasons_include: ['doc_type_mismatch'], detected_type: 'intake_form' } }),
    kase('x3-sr-04-medlist-declared-intake', 'safe_refusal', 'A medication list uploaded as an intake form is reported READY instead of QUALIFIED doc_type_mismatch.', scan('medlist-b', 'intake_form'), { refusal: { final_state: 'QUALIFIED', reasons_include: ['doc_type_mismatch'], detected_type: 'medication_list' } }),
    kase('x3-sr-05-blank-medlist', 'safe_refusal', 'A blank page declared as a medication list proceeds to retrieval instead of BLOCKED no_fields_extracted.', scan('gen-blank-page', 'medication_list'), { refusal: { final_state: 'BLOCKED', stop_reason: 'no_fields_extracted', retrieval_ran: false } }),
    kase('x3-sr-06-medlist-other-patient', 'safe_refusal', "A medication list printed for this patient is attached to another patient's chart instead of BLOCKED patient_mismatch.", scan('medlist-a', 'medication_list', { upload_patient: P2 }), { refusal: { final_state: 'BLOCKED', stop_reason: 'patient_mismatch', identity: 'mismatch', retrieval_ran: false } }),
    kase('x3-np-01-medlist-a', 'no_phi_in_logs', 'Drug names, the list date, the prescriber or the printed name/DOB of a medication list reach the stored trace or stdout/stderr.', scan('medlist-a', 'medication_list'), { no_phi: {} }),
    kase('x3-np-02-medlist-b', 'no_phi_in_logs', 'Rasterized medication-list OCR text or raw handoffs reach the trace or console.', scan('medlist-b', 'medication_list'), { no_phi: { raw_handoffs: true } }),
  ];
}
