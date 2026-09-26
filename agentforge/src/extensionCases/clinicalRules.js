import { createRecordedOcrReplay } from '../pdfScanAdapter.js';
import { issueSignedContext, verifySignedContext } from '../accessContext.js';
import { GroundedAnswerResult, parseOrIssues } from '../schemas.js';
import { loadGoldenFixtures } from '../w2RegressionGate.js';

/**
 * F-CLIN clinical rules and "not documented" answers, run end to end through
 * the golden harness (upload -> recorded OCR replay -> label map -> typed
 * extraction -> supervisor -> grounded answer with the rules applied).
 *
 * Synthetic inputs: the committed lab-a and intake-a OCR recordings with
 * edited lines (a potassium row added, the A1C value or flag changed, the
 * medication line changed), replayed for the same PDF bytes through a
 * case's `service_overrides`, the pattern x3-sr-07 uses. No new fixture
 * document, so neither manifest changes. Each edit is written out below;
 * the checks read only the service's output, never these specs.
 */

const CITATION_KEYS = ['source_type', 'source_id', 'page_or_section', 'field_or_chunk_id', 'quote_or_value'];
const LINE_HEIGHT = 29;

/** A replay of `docId`'s recording after `edit(lines)`; edited lines read at 0.92 confidence. */
function editedReplay(docId, edit) {
  const recording = structuredClone(loadGoldenFixtures().docs.get(docId).ocr);
  const page = recording.pages[0];
  edit(page.lines, page);
  for (const line of page.lines) line.words = line.text.split(' ');
  return createRecordedOcrReplay([recording]);
}

const replaceLine = (lines, prefix, text) => {
  const line = lines.find((item) => item.text.startsWith(prefix));
  if (!line) throw new Error(`EXTENSION_FIXTURE_LINE_MISSING:${prefix}`);
  line.text = text;
  line.confidence = 0.92;
};

/** lab-a plus a six-line potassium row below the A1C block (inside the page). */
const labAWithPotassium = (value, unit, flagText = 'Yes') => () => ({
  ocrEngine: editedReplay('lab-a', (lines) => {
    const rows = [`Potassium test name: Potassium`, `Potassium value: ${value}`, `Potassium unit: ${unit}`, 'Potassium reference range: 3.5-5.1', 'Potassium collection date: 2026-09-20', `Potassium abnormal: ${flagText}`];
    const footer = lines.findIndex((line) => line.text.startsWith('Fictional values'));
    rows.forEach((text, index) => {
      const top = 1920 + index * 45;
      lines.splice(footer + 1 + index, 0, { words: [], page: 1, left: 247, top, right: 247 + text.length * 22, bottom: top + LINE_HEIGHT, confidence: 0.92, text });
    });
  }),
});

/**
 * lab-a with its A1C printed as `value` and its "abnormal" line as
 * `flagText`. Every A1C line is set to read at 0.92: lab-a's own A1C name
 * line reads at 0.80, which would send the result to review as
 * low_confidence before any rule saw it.
 */
const labAWithA1c = (value, flagText) => () => ({
  ocrEngine: editedReplay('lab-a', (lines) => {
    replaceLine(lines, 'A1C test name:', 'A1C test name: A1C');
    replaceLine(lines, 'A1C value:', `A1C value: ${value}`);
    replaceLine(lines, 'A1C unit:', 'A1C unit: %');
    replaceLine(lines, 'A1C reference range:', 'A1C reference range: under 5.7');
    replaceLine(lines, 'A1C collection date:', 'A1C collection date: 2026-09-20');
    replaceLine(lines, 'A1C abnormal:', `A1C abnormal: ${flagText}`);
  }),
});

/** intake-a (penicillin allergy) with its medication line printed as `medication`, and optionally its allergy line as `allergy`. */
const intakeAWithMedication = (medication, allergy = null) => () => ({
  ocrEngine: editedReplay('intake-a', (lines) => {
    replaceLine(lines, 'Current medications:', `Current medications: ${medication}`);
    if (allergy) replaceLine(lines, 'Allergies:', `Allergies: ${allergy}`);
  }),
});

const answerOf = (run) => run.result?.workflow?.answer || null;
const statedFields = (answer) => new Set(answer.patient_facts.flatMap((claim) => claim.citations.map((citation) => citation.field_or_chunk_id)));
const flagsOf = (answer, code) => (answer.safety_flags || []).filter((flag) => flag.code === code);

/** Shared: the workflow ran, and its answer parses against the strict response contract. */
function baseIssues(run) {
  if (run.error) return ['workflow_threw'];
  const answer = answerOf(run);
  if (!answer) return ['answer_missing'];
  const parsed = parseOrIssues(GroundedAnswerResult, answer);
  return parsed.ok ? [] : ['answer_contract_invalid'];
}

/** Every citation has exactly the five keys; document citations point at this upload. */
function citationShapeIssues(run, citations, label) {
  const issues = [];
  for (const citation of citations) {
    if (JSON.stringify(Object.keys(citation).filter((key) => CITATION_KEYS.includes(key))) !== JSON.stringify(CITATION_KEYS)) issues.push(`${label}:citation_keys`);
    if (citation.source_type === 'document' && citation.source_id !== run.sourceIds[0]) issues.push(`${label}:citation_other_document`);
  }
  return issues;
}

/** The scan trace carries the flag codes and counts, and none of the flag's values. */
function traceIssues(run, { code, count, absentValues }) {
  const traces = run.h.traceSink.list().filter((trace) => trace.operation === 'w2-scan-supervisor');
  const verification = traces.at(-1)?.verification;
  if (!verification) return ['trace_verification_missing'];
  const issues = [];
  if ((verification.safety_flag_codes || []).filter((item) => item === code).length !== count) issues.push(`trace_flag_count_${code}`);
  const text = JSON.stringify(verification);
  for (const value of absentValues) if (text.includes(value)) issues.push('trace_carries_value');
  return issues;
}

function criticalPotassiumIssues(run) {
  const issues = baseIssues(run);
  if (issues.length) return issues;
  const answer = answerOf(run);
  const flags = flagsOf(answer, 'critical_value');
  if (flags.length !== 1) return [...issues, `critical_value_flags_${flags.length}`];
  const [flag] = flags;
  const cited = flag.citations[0];
  if (flag.citations.length !== 1 || cited.field_or_chunk_id !== 'lab.k.value' || cited.quote_or_value !== 'Potassium value: 6.8') issues.push('flag_not_citing_the_potassium_result');
  if (flag.severity !== 'critical' || flag.threshold_source?.kind !== 'public_reference') issues.push('flag_severity_or_source');
  if (!/Potassium 6\.8 mmol\/L/.test(flag.text)) issues.push('flag_text_not_the_cited_value');
  issues.push(...citationShapeIssues(run, flag.citations, 'critical_value'));
  // The flag adds to the answer; the result itself is still stated, with the same citation.
  const claim = answer.patient_facts.find((item) => item.citations.some((citation) => citation.field_or_chunk_id === 'lab.k.value'));
  if (!claim) issues.push('potassium_not_stated');
  else if (JSON.stringify(claim.citations[0]) !== JSON.stringify(cited)) issues.push('flag_and_claim_cite_differently');
  issues.push(...traceIssues(run, { code: 'critical_value', count: 1, absentValues: ['6.8'] }));
  return issues;
}

/** No flag of `code`, and no rule review; `statedField` must be stated, so the rule really saw the value. */
function noFlagIssues(run, code, statedField) {
  const issues = baseIssues(run);
  if (issues.length) return issues;
  const answer = answerOf(run);
  if (!Array.isArray(answer.safety_flags)) return ['safety_flags_missing'];
  if (statedField && !statedFields(answer).has(statedField)) issues.push(`${statedField}_not_stated`);
  if (flagsOf(answer, code).length) issues.push(`false_positive_${code}`);
  if (answer.needs_review.some((item) => ['flag_contradicts_range', 'rule_unit_unrecognized', 'rule_value_unparseable'].includes(item.reason))) issues.push('rule_review_on_clean_value');
  return issues;
}

function diabetesRangeIssues(run) {
  const issues = baseIssues(run);
  if (issues.length) return issues;
  const flags = flagsOf(answerOf(run), 'diabetes_range');
  if (flags.length !== 1) return [`diabetes_range_flags_${flags.length}`];
  const [flag] = flags;
  const labCitation = flag.citations.find((citation) => citation.source_type === 'document');
  const guideline = flag.citations.find((citation) => citation.source_type === 'guideline');
  if (labCitation?.field_or_chunk_id !== 'lab.a1c.value' || labCitation?.quote_or_value !== 'A1C value: 7.2') issues.push('flag_not_citing_the_a1c_result');
  if (guideline?.source_id !== 'cdc-a1c-diagnostic-ranges' || !String(guideline?.quote_or_value).includes('Diabetes: 6.5% or above')) issues.push('flag_not_citing_the_cdc_range');
  if (flag.threshold_source?.kind !== 'guideline_corpus') issues.push('threshold_source_not_corpus');
  issues.push(...citationShapeIssues(run, flag.citations, 'diabetes_range'));
  issues.push(...traceIssues(run, { code: 'diabetes_range', count: 1, absentValues: ['7.2'] }));
  return issues;
}

function contradictedA1cIssues(run) {
  const issues = baseIssues(run);
  if (issues.length) return issues;
  const answer = answerOf(run);
  if (!answer.needs_review.some((item) => item.field === 'lab.a1c.value' && item.reason === 'flag_contradicts_range')) issues.push('contradiction_not_in_needs_review');
  if (statedFields(answer).has('lab.a1c.value')) issues.push('contradicted_a1c_stated_as_fact');
  if (flagsOf(answer, 'diabetes_range').length) issues.push('flag_from_untrusted_value');
  if (run.result.workflow.final_state === 'READY' && run.result.workflow.evaluation?.status === 'passed') issues.push('reported_clean');
  return issues;
}

function potassiumUnitIssues(run) {
  const issues = baseIssues(run);
  if (issues.length) return issues;
  const answer = answerOf(run);
  if (!answer.needs_review.some((item) => item.field === 'lab.k.value' && item.reason === 'rule_unit_unrecognized')) issues.push('unit_not_sent_to_review');
  if (statedFields(answer).has('lab.k.value')) issues.push('unreadable_potassium_stated');
  if (flagsOf(answer, 'critical_value').length) issues.push('flag_from_unrecognized_unit');
  return issues;
}

function allergyConflictIssues(run) {
  const issues = baseIssues(run);
  if (issues.length) return issues;
  const flags = flagsOf(answerOf(run), 'drug_allergy_conflict');
  if (flags.length !== 1) return [`drug_allergy_conflict_flags_${flags.length}`];
  const [flag] = flags;
  const [allergy, medication] = flag.citations;
  if (flag.citations.length !== 2) issues.push('flag_not_citing_both_facts');
  if (allergy?.field_or_chunk_id !== 'allergies' || !/^Allergies: Penicillin/.test(allergy?.quote_or_value || '')) issues.push('flag_not_citing_the_allergy');
  if (flag.text !== 'Recorded allergy to a penicillin and a recorded penicillin-class medication (amoxicillin).') issues.push('flag_text_not_template');
  if (medication?.field_or_chunk_id !== 'medications' || !/Amoxicillin/.test(medication?.quote_or_value || '')) issues.push('flag_not_citing_the_medication');
  issues.push(...citationShapeIssues(run, flag.citations, 'drug_allergy_conflict'));
  issues.push(...traceIssues(run, { code: 'drug_allergy_conflict', count: 1, absentValues: ['Amoxicillin', 'Penicillin'] }));
  return issues;
}

function scanNotDocumentedIssues(run) {
  const issues = baseIssues(run);
  if (issues.length) return issues;
  const answer = answerOf(run);
  const entry = (answer.not_documented || []).find((item) => item.concept === 'blood_pressure');
  if (!entry) issues.push('blood_pressure_not_reported_missing');
  else {
    if (!entry.sources_checked.includes('document') || !entry.sources_checked.includes('synthetic_chart_fixture')) issues.push('sources_checked_incomplete');
    // Neither a lab report nor the chart read holds vitals: never claim absence.
    if (entry.status !== 'not_retrieved' || /not documented/i.test(entry.text)) issues.push('absence_claimed_for_data_not_read');
  }
  if (answer.composer !== 'not-documented') issues.push(`composer_${answer.composer}`);
  if (answer.patient_facts.length || answer.guideline_evidence.length) issues.push('unrelated_evidence_listed');
  return issues;
}

/** A flag whose grounding fails verification is dropped and counted; no instruction reaches a flag. */
function directiveMedicationIssues(run) {
  const issues = baseIssues(run);
  if (issues.length) return issues;
  const answer = answerOf(run);
  if (flagsOf(answer, 'drug_allergy_conflict').length) issues.push('flag_shipped_on_unverified_grounding');
  if (answer.safety_flags_dropped !== 1) issues.push(`safety_flags_dropped_${answer.safety_flags_dropped}`);
  if (/stop taking/i.test(JSON.stringify(answer.safety_flags || []))) issues.push('instruction_in_flag');
  if (!run.result.workflow.answer || !(run.h.traceSink.list().at(-1)?.evaluation?.issues || []).includes('safety_flags_dropped')) issues.push('drop_not_in_trace');
  return issues;
}

function contradictedPotassiumIssues(run) {
  const issues = baseIssues(run);
  if (issues.length) return issues;
  const answer = answerOf(run);
  if (!answer.needs_review.some((item) => item.field === 'lab.k.value' && item.reason === 'flag_contradicts_range')) issues.push('contradiction_not_in_needs_review');
  if (statedFields(answer).has('lab.k.value')) issues.push('contradicted_potassium_stated_as_fact');
  if (flagsOf(answer, 'critical_value').length) issues.push('flag_from_untrusted_value');
  return issues;
}

/** The briefing follow-up path, driven through the same service instance as the scan. */
async function followUpNotDocumentedIssues(run) {
  if (run.error) return ['workflow_threw'];
  const secret = 'extension-f-clin';
  const value = { patient_uuid: run.patient, clinician_uuid: run.clinician, correlation_id: 'x-clin-followup', case_id: 'complete_return_visit' };
  const context = verifySignedContext(issueSignedContext({ patient_uuid: run.patient, clinician_uuid: run.clinician, secret }), secret);
  const briefing = await run.h.service.prepare(value, { verifiedContext: context });
  if (briefing.verification?.status !== 'passed') return ['briefing_not_verified'];
  const issues = [];
  const bp = await run.h.service.followUp(briefing.correlation_id, { ...value, message: 'What was the blood pressure?' }, { verifiedContext: context });
  if (!/not available from the sources read \(vital signs are not retrieved/.test(bp.text || '')) issues.push('bp_not_answered_not_available');
  if (/not documented/i.test(bp.text || '')) issues.push('absence_claimed_for_data_not_read');
  if ((bp.claims || []).length || (bp.evidence || []).length) issues.push('unrelated_evidence_listed');
  if (!(bp.not_documented || []).some((item) => item.concept === 'blood_pressure')) issues.push('not_documented_missing');
  // A documented topic is still answered from the chart.
  const dose = await run.h.service.followUp(briefing.correlation_id, { ...value, message: 'What is the lisinopril dose?' }, { verifiedContext: context });
  if (!(dose.claims || []).length || dose.not_documented) issues.push('documented_topic_not_answered');
  return issues;
}

export function clinicalRulesCases({ kase, scan }) {
  return [
    kase('xc-fc-01-critical-potassium-flag', 'factually_consistent', 'A lab report with potassium 6.8 mmol/L (critical limit 6.0 mmol/L or greater) ships without exactly one critical_value safety flag citing that result by its 5-key document citation, the flag restates a value other than the cited one, the result itself stops being stated, or the trace lacks the flag code or carries the value.', scan('lab-a', 'lab_pdf', { service_overrides: labAWithPotassium('6.8', 'mmol/L') }), { custom: criticalPotassiumIssues }),
    kase('xc-fc-02-normal-potassium-no-flag', 'factually_consistent', 'A normal potassium (4.2 mmol/L) is flagged critical or sent to review (a false positive), or is not stated.', scan('lab-a', 'lab_pdf', { service_overrides: labAWithPotassium('4.2', 'mmol/L', 'No') }), { custom: (run) => noFlagIssues(run, 'critical_value', 'lab.k.value') }),
    kase('xc-fc-03-a1c-diabetes-range-flag', 'factually_consistent', 'The rasterized lab-b A1C of 7.2 % ships without a diabetes_range flag that cites both the result and the CDC "A1C Ranges" chunk (Diabetes: 6.5% or above).', scan('lab-b', 'lab_pdf'), { custom: diabetesRangeIssues }),
    kase('xc-fc-04-a1c-below-range-no-flag', 'factually_consistent', 'The A1C of 6.1 % (below 6.5 %) on the high-confidence scan-text lab report is flagged in the diabetes range, sent to review by a rule, or not stated.', scan('scan-text-lab-a', 'lab_pdf'), { custom: (run) => noFlagIssues(run, 'diabetes_range', 'lab.a1c.value') }),
    kase('xc-fc-05-penicillin-amoxicillin-conflict', 'factually_consistent', 'An intake form with a penicillin allergy and amoxicillin in its medications ships without exactly one drug_allergy_conflict flag citing both form lines, or the trace carries a drug or allergen name.', scan('intake-a', 'intake_form', { service_overrides: intakeAWithMedication('Amoxicillin 500 mg three times daily') }), { custom: allergyConflictIssues }),
    kase('xc-fc-06-penicillin-metformin-no-conflict', 'factually_consistent', 'intake-a as printed (penicillin allergy, metformin) raises a drug_allergy_conflict flag.', scan('intake-a', 'intake_form'), { custom: (run) => noFlagIssues(run, 'drug_allergy_conflict', 'allergies') }),
    kase('xc-sr-01-a1c-flag-contradicts-range', 'safe_refusal', 'An A1C of 6.8 % that the report marks "abnormal: No" is stated as a patient fact, or flagged from that untrusted value, instead of going to needs review as flag_contradicts_range.', scan('lab-a', 'lab_pdf', { service_overrides: labAWithA1c('6.8', 'No') }), { custom: contradictedA1cIssues }),
    kase('xc-sr-02-potassium-unit-unrecognized', 'safe_refusal', 'A potassium printed in mg/dL (a unit the rule does not read) is stated, or judged against the mmol/L critical limits, instead of going to needs review as rule_unit_unrecognized.', scan('lab-a', 'lab_pdf', { service_overrides: labAWithPotassium('6.8', 'mg/dL') }), { custom: potassiumUnitIssues }),
    kase('xc-fc-07-allergy-with-no-known-food-allergies', 'factually_consistent', 'An allergy line "Penicillin - hives; no known food allergies" is read as "no allergy" because it contains "no known", so a penicillin allergy with amoxicillin raises no conflict flag (review blocker 1).', scan('intake-a', 'intake_form', { service_overrides: intakeAWithMedication('Amoxicillin 500 mg three times daily', 'Penicillin - hives; no known food allergies') }), { custom: allergyConflictIssues }),
    kase('xc-sr-05-flag-grounding-fails-verification', 'safe_refusal', 'A conflict flag whose medication line carries an instruction ("Stop taking if rash") ships anyway, is not counted in safety_flags_dropped and the trace, or the instruction reaches a flag (review blocker 2).', scan('intake-a', 'intake_form', { service_overrides: intakeAWithMedication('Amoxicillin 500 mg. Stop taking if rash') }), { custom: directiveMedicationIssues }),
    kase('xc-sr-06-potassium-flag-contradicts-range', 'safe_refusal', 'A potassium of 6.8 mmol/L that the report marks "abnormal: No" is stated or flagged critical instead of going to needs review as flag_contradicts_range.', scan('lab-a', 'lab_pdf', { service_overrides: labAWithPotassium('6.8', 'mmol/L', 'No') }), { custom: contradictedPotassiumIssues }),
    kase('xc-sr-03-scan-bp-not-documented', 'safe_refusal', 'A scan question "What was the blood pressure?", when neither the lab report nor the chart read holds vitals, is answered with unrelated lab facts or guideline chunks, or claims the value is absent, instead of a "not available from the sources read" entry naming the sources checked.', scan('lab-a', 'lab_pdf', { query: 'What was the blood pressure?' }), { custom: scanNotDocumentedIssues }),
    kase('xc-sr-04-followup-bp-not-documented', 'safe_refusal', 'The briefing follow-up "What was the blood pressure?" lists the "blood-pressure follow-up" visit reason and note as evidence, or claims no reading exists when the chart read has no vitals, instead of saying vitals are not retrieved (W1 debt item 20), or a documented topic stops being answered.', scan('lab-a', 'lab_pdf'), { custom: followUpNotDocumentedIssues }),
  ];
}
