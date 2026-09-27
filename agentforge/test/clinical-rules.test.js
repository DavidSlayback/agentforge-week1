import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { applyClinicalRules, labKind, POTASSIUM_CRITICAL_HIGH_MMOL_L, POTASSIUM_CRITICAL_LOW_MMOL_L, summarizeSafetyFlags } from '../src/clinicalRules.js';
import { composeGroundedAnswer } from '../src/answerComposer.js';
import { computeRuntimeEvaluation } from '../src/runtimeEvaluation.js';
import { GroundedAnswerResult, parseOrIssues, SafetyFlag } from '../src/schemas.js';
import { validateFollowUpResponse } from '../src/contracts.js';
import { applyCriticVerdicts, buildCriticPrompt, buildCriticRequest } from '../src/critic.js';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { PreVisitPreparation } from '../src/preVisitPreparation.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';

const CITATION_KEYS = ['source_type', 'source_id', 'page_or_section', 'field_or_chunk_id', 'quote_or_value'];

const docCitation = (field, quote) => ({ source_type: 'document', source_id: 'src-rules', page_or_section: 'page 1', field_or_chunk_id: field, quote_or_value: quote });
const chartCitation = (field, value) => ({ source_type: 'synthetic_chart_fixture', source_id: `rec-${field}`, page_or_section: 'Synthetic chart fixture', field_or_chunk_id: field, quote_or_value: value });

function lab({ test_name, value, unit, abnormal_flag = 'unknown', field }) {
  const id = field || (/a1c/i.test(test_name) ? 'lab.a1c' : /potassium/i.test(test_name) ? 'lab.k' : 'lab.hgb');
  return { test_name, value, unit, reference_range: 'see report', collection_date: '2026-09-20', abnormal_flag, confidence: 0.95, citation: docCitation(`${id}.value`, value) };
}
const potassium = (value, unit = 'mmol/L') => lab({ test_name: 'Potassium', value, unit });
const a1c = (value, abnormal_flag = 'abnormal', unit = '%', test_name = 'A1C') => lab({ test_name, value, unit, abnormal_flag });

const run = (labs = [], factCitations = []) => applyClinicalRules({ verifiedLabResults: labs, factCitations });

// ---- Critical potassium -------------------------------------------------------

test('potassium: the documented critical limits flag, the values just inside them do not', () => {
  assert.equal(POTASSIUM_CRITICAL_LOW_MMOL_L, 3.0);
  assert.equal(POTASSIUM_CRITICAL_HIGH_MMOL_L, 6.0);
  for (const value of ['2.4', '3.0', '6.0', '6.8']) {
    const { safetyFlags, labResults, needsReview } = run([potassium(value)]);
    assert.equal(safetyFlags.length, 1, `${value} must flag`);
    assert.equal(safetyFlags[0].code, 'critical_value');
    assert.equal(safetyFlags[0].rule_id, 'potassium_critical_range');
    assert.equal(labResults.length, 1, 'a flagged result is still stated');
    assert.equal(needsReview.length, 0);
    assert.ok(parseOrIssues(SafetyFlag, safetyFlags[0]).ok);
    assert.match(safetyFlags[0].text, new RegExp(`Potassium ${value.replace('.', '\\.')} mmol/L`));
  }
  for (const value of ['3.1', '4.2', '5.1', '5.9']) {
    const { safetyFlags, labResults, needsReview } = run([potassium(value)]);
    assert.deepEqual([safetyFlags.length, labResults.length, needsReview.length], [0, 1, 0], `${value} is not critical`);
  }
});

test('potassium: mEq/L is read as mmol/L; an unrecognized or missing unit, or an unparseable value, goes to review loudly', () => {
  assert.equal(run([potassium('6.2', 'mEq/L')]).safetyFlags.length, 1);
  assert.equal(run([potassium('6.2', ' mmol / L ')]).safetyFlags.length, 1);
  for (const [value, unit, reason] of [['6.2', 'mg/dL', 'rule_unit_unrecognized'], ['6.2', '', 'rule_unit_unrecognized'], ['<2.0', 'mmol/L', 'rule_value_unparseable'], ['6.2 H', 'mmol/L', 'rule_value_unparseable']]) {
    const { safetyFlags, labResults, needsReview } = run([potassium(value, unit)]);
    assert.equal(safetyFlags.length, 0, `${value} ${unit}: no flag from a value the rule cannot read`);
    assert.equal(labResults.length, 0, `${value} ${unit}: not stated as a fact either`);
    assert.deepEqual(needsReview, [{ kind: 'lab_result', field: 'lab.k.value', reason }]);
  }
});

test('potassium flag cites exactly the triggering result with the 5-key citation and names a public source', () => {
  const [flag] = run([potassium('6.4')]).safetyFlags;
  assert.equal(flag.citations.length, 1);
  assert.deepEqual(Object.keys(flag.citations[0]), CITATION_KEYS);
  assert.equal(flag.citations[0].field_or_chunk_id, 'lab.k.value');
  assert.equal(flag.threshold_source.kind, 'public_reference');
  assert.match(flag.threshold_source.url, /^https:\/\//);
});

// ---- A1C diabetes range ---------------------------------------------------------

test('A1C: 6.5% and above flags the diabetes range and cites the CDC corpus chunk; below does not', () => {
  for (const value of ['6.5', '7.2', '8.3']) {
    const { safetyFlags, labResults } = run([a1c(value)]);
    assert.equal(safetyFlags.length, 1, `${value}`);
    const [flag] = safetyFlags;
    assert.equal(flag.code, 'diabetes_range');
    assert.equal(labResults.length, 1);
    assert.equal(flag.threshold_source.kind, 'guideline_corpus');
    const guideline = flag.citations.find((citation) => citation.source_type === 'guideline');
    assert.equal(guideline.source_id, 'cdc-a1c-diagnostic-ranges');
    assert.match(guideline.quote_or_value, /Diabetes: 6\.5% or above/);
    assert.ok(flag.citations.some((citation) => citation.field_or_chunk_id === 'lab.a1c.value'), 'cites the triggering result');
    for (const citation of flag.citations) assert.deepEqual(Object.keys(citation), CITATION_KEYS);
  }
  for (const value of ['5.4', '6.1', '6.4']) assert.equal(run([a1c(value)]).safetyFlags.length, 0, `${value}`);
});

test('A1C: a diabetes-range value the document flags normal (or low) goes to needs review as flag_contradicts_range, never trusted', () => {
  for (const flagWord of ['normal', 'low']) {
    const { safetyFlags, labResults, needsReview } = run([a1c('6.8', flagWord)]);
    assert.equal(safetyFlags.length, 0);
    assert.equal(labResults.length, 0, 'the contradicted result is not stated as a fact');
    assert.deepEqual(needsReview, [{ kind: 'lab_result', field: 'lab.a1c.value', reason: 'flag_contradicts_range' }]);
  }
  // A normal flag on a value below 6.5 is no contradiction of this rule.
  assert.deepEqual(run([a1c('5.4', 'normal')]).needsReview, []);
  // "high" or "abnormal" agree with the range.
  assert.equal(run([a1c('6.8', 'high')]).safetyFlags.length, 1);
});

test('A1C: other units and names are handled explicitly; hemoglobin is not A1C', () => {
  assert.deepEqual(run([a1c('48', 'abnormal', 'mmol/mol')]).needsReview.map((item) => item.reason), ['rule_unit_unrecognized']);
  assert.equal(run([a1c('6.9', 'high', '%', 'Hemoglobin A1C')]).safetyFlags.length, 1);
  assert.equal(labKind(lab({ test_name: 'Hemoglobin', value: '13.2', unit: 'g/dL' })), null);
  assert.equal(labKind(lab({ test_name: 'Hemoglobin A1C', value: '6.4', unit: '%' })), 'a1c');
  const { safetyFlags, needsReview, labResults } = run([lab({ test_name: 'Hemoglobin', value: '6.8', unit: 'g/dL', abnormal_flag: 'normal' })]);
  assert.deepEqual([safetyFlags.length, needsReview.length, labResults.length], [0, 0, 1]);
});

// ---- Allergy vs medication class -------------------------------------------------

test('allergy vs medication class: a penicillin allergy with amoxicillin or ampicillin flags, citing both facts', () => {
  const allergy = docCitation('allergies', 'Allergies: Penicillin');
  for (const medication of [docCitation('medications', 'Current medications: Amoxicillin 500 mg three times daily'), docCitation('medication.1.name', 'Medication 1: Ampicillin 250 mg four times daily oral'), chartCitation('medication.amoxicillin.dose', '500 mg three times daily')]) {
    const { safetyFlags } = run([], [allergy, medication]);
    assert.equal(safetyFlags.length, 1, medication.quote_or_value);
    const [flag] = safetyFlags;
    assert.equal(flag.code, 'drug_allergy_conflict');
    assert.deepEqual(flag.citations, [allergy, medication]);
    assert.ok(parseOrIssues(SafetyFlag, flag).ok);
  }
  // A chart allergy (the allergen is in the field id) against an intake medication.
  assert.equal(run([], [chartCitation('allergy.penicillin', 'hives'), docCitation('medications', 'Current medications: Augmentin 875 mg twice daily')]).safetyFlags.length, 1);
  // Sulfonamide antibiotics.
  assert.equal(run([], [docCitation('allergies', 'Allergy: Sulfa antibiotics'), docCitation('medications', 'Medications: Bactrim DS twice daily')]).safetyFlags.length, 1);
});

test('allergy vs medication class: no flag without a conflict, for a recorded non-allergy, or from a fixed document field id', () => {
  const amoxicillin = docCitation('medications', 'Current medications: Amoxicillin 500 mg');
  // intake-a as printed: penicillin allergy, metformin.
  assert.equal(run([], [docCitation('allergies', 'Allergies: Penicillin'), docCitation('medications', 'Current medications: Metformin 500 mg daily')]).safetyFlags.length, 0);
  // intake-b as printed: sulfa allergy, lisinopril.
  assert.equal(run([], [docCitation('allergies', 'Allergy: Sulfa antibiotics'), docCitation('medications', 'Medications: Lisinopril 10 mg daily')]).safetyFlags.length, 0);
  // Only a whole-entry NKDA/NKA statement records no allergy.
  for (const none of ['Allergies: NKDA', 'Allergies: None', 'Allergies: No known drug allergies', 'Allergy: NKA']) assert.equal(run([], [docCitation('allergies', none), amoxicillin]).safetyFlags.length, 0, none);
  assert.equal(run([], [chartCitation('allergy.nkda', 'documented'), amoxicillin]).safetyFlags.length, 0);
  // The legacy intake layout labels every allergy line allergy.penicillin; only the printed line counts.
  assert.equal(run([], [docCitation('allergy.penicillin', 'Allergies: Latex'), amoxicillin]).safetyFlags.length, 0);
  // Penicillin allergy with a sulfonamide, or sulfa allergy with amoxicillin: different classes.
  assert.equal(run([], [docCitation('allergies', 'Allergies: Penicillin'), docCitation('medications', 'Medications: Bactrim DS')]).safetyFlags.length, 0);
  assert.equal(run([], [docCitation('allergies', 'Allergy: Sulfa'), amoxicillin]).safetyFlags.length, 0);
});

test('review blocker 1: a named allergy with an unknown reaction, or next to "no known food allergies", is still an allergy', () => {
  const amoxicillin = docCitation('medications', 'Current medications: Amoxicillin 500 mg');
  // A chart allergy's value is its reaction: "unknown" is an unknown reaction to penicillin.
  assert.equal(run([], [chartCitation('allergy.penicillin', 'unknown'), amoxicillin]).safetyFlags.length, 1);
  assert.equal(run([], [docCitation('allergies', 'Allergies: Penicillin - hives; no known food allergies'), amoxicillin]).safetyFlags.length, 1);
  assert.equal(run([], [docCitation('allergies', 'Allergies: Penicillin (reaction unknown)'), amoxicillin]).safetyFlags.length, 1);
});

test('review blocker 2: flag text is a template; a medication line with instructions never reaches it', () => {
  const directive = docCitation('medications', 'Current medications: Amoxicillin - stop taking, increase dose');
  const [flag] = run([], [docCitation('allergies', 'Allergies: Penicillin'), directive]).safetyFlags;
  assert.equal(flag.text, 'Recorded allergy to a penicillin and a recorded penicillin-class medication (amoxicillin).');
  assert.doesNotMatch(flag.text, /stop|increase|dose|Current medications/i);
  // Lab flags name the test with a fixed label, never the document's printed test name.
  const [kFlag] = run([{ ...potassium('6.8'), test_name: 'Potassium, serum', collection_date: 'call the patient now' }]).safetyFlags;
  assert.equal(kFlag.text, 'Potassium 6.8 mmol/L is in the critical range used by this rule (6.0 mmol/L or greater).');
});

test('review blocker 2: a flag whose grounding fails verifyClaims is dropped and counted, never shipped', async () => {
  const intakeForm = (medication) => ({
    demographics: { name: { status: 'not_found_on_form', value: null, confidence: 0, citation: null }, dob: { status: 'not_found_on_form', value: null, confidence: 0, citation: null } },
    chief_concern: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
    current_medications: [{ status: 'observed', value: medication, confidence: 0.93, citation: docCitation('medications', `Current medications: ${medication}`) }],
    allergies: [{ status: 'observed', value: 'Penicillin', confidence: 0.93, citation: docCitation('allergies', 'Allergies: Penicillin') }],
    family_history: [],
  });
  const clean = await composeGroundedAnswer({ intakeForm: intakeForm('Amoxicillin 500 mg') });
  assert.equal(clean.safety_flags.length, 1);
  assert.equal(clean.safety_flags_dropped, 0);
  // The medication line carries an instruction ("Stop taking if rash."), so the
  // claim grounding the flag fails verifyClaims (DIRECTIVE_LANGUAGE): the flag is
  // dropped and counted, and the line itself is not stated either.
  const directive = await composeGroundedAnswer({ intakeForm: intakeForm('Amoxicillin 500 mg. Stop taking if rash, increase dose') });
  assert.deepEqual(directive.safety_flags, []);
  assert.equal(directive.safety_flags_dropped, 1);
  assert.ok(parseOrIssues(GroundedAnswerResult, directive).ok);
  assert.doesNotMatch(JSON.stringify(directive), /"text":"[^"]*Stop taking/);
  const { evaluation } = computeRuntimeEvaluation({ workflow: { readiness: 'ready', final_state: 'READY', answer: directive } });
  assert.ok(evaluation.issues.includes('safety_flags_dropped'));
  assert.equal(evaluation.status, 'needs_review');
});

/** Reject exactly the safety-flag items of a critic request with `reason`; keep every claim. */
const vetoFlags = (request, reason) => ({
  output_status: 'reviewed',
  verdicts: request.items.map((item) => ({ index: item.index, verdict: item.kind === 'safety_flag' ? 'reject' : 'keep', reason: item.kind === 'safety_flag' ? reason : null })),
  redacted_metrics: { claims_not_sent: 0 },
});

test('F-CLIN: a critic veto of a verified flag keeps it visible and questioned, never hidden', async () => {
  // Production d5a0df7e: the verified diabetes_range flag (A1C 7.2 %, CDC
  // "A1C Ranges" chunk) was vetoed UNSUPPORTED_BY_SOURCE and disappeared.
  const answer = await composeGroundedAnswer({ labResults: [a1c('7.2')] });
  assert.equal(answer.safety_flags.length, 1);
  assert.equal(answer.safety_flags_dropped, 0);
  const request = buildCriticRequest(answer);
  assert.match(buildCriticPrompt(request.items), /\[safety flag\]/);
  const applied = applyCriticVerdicts(answer, vetoFlags(request, 'UNSUPPORTED_BY_SOURCE'));
  assert.equal(applied.safety_flags.length, 1, 'the vetoed flag still ships');
  const [flag] = applied.safety_flags;
  assert.equal(flag.code, 'diabetes_range');
  assert.equal(flag.text, answer.safety_flags[0].text);
  assert.deepEqual(flag.citations, answer.safety_flags[0].citations);
  assert.equal(flag.critic_status, 'questioned');
  assert.equal(flag.critic_reason, 'UNSUPPORTED_BY_SOURCE');
  assert.equal(applied.critic_flags_questioned, 1);
  assert.equal(applied.safety_flags_dropped, 0, 'a veto is not a verification drop');
  assert.equal(applied.critic_rejected, 0, 'no claim was removed');
  assert.equal(applied.patient_facts.length, answer.patient_facts.length);
  assert.equal('critic_flags_rejected' in applied, false);
  assert.ok(parseOrIssues(GroundedAnswerResult, applied).ok);
  const { evaluation, verification } = computeRuntimeEvaluation({ workflow: { readiness: 'ready', final_state: 'READY', answer: applied } });
  assert.ok(evaluation.issues.includes('critic_questioned_flags'));
  assert.equal(evaluation.status, 'needs_review');
  assert.equal(verification.critic_flags_questioned, 1);
  assert.equal(verification.safety_flags_dropped, 0);
  // A kept flag carries no critic mark.
  const kept = applyCriticVerdicts(answer, { ...vetoFlags(request, null), verdicts: request.items.map((item) => ({ index: item.index, verdict: 'keep', reason: null })) });
  assert.equal(kept.critic_flags_questioned, 0);
  assert.equal('critic_status' in kept.safety_flags[0], false);
});

test('F-CLIN: a flag that fails verification is still dropped and counted, and is never sent to the critic', async () => {
  const intakeForm = {
    demographics: { name: { status: 'not_found_on_form', value: null, confidence: 0, citation: null }, dob: { status: 'not_found_on_form', value: null, confidence: 0, citation: null } },
    chief_concern: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
    current_medications: [{ status: 'observed', value: 'Amoxicillin 500 mg. Stop taking if rash, increase dose', confidence: 0.93, citation: docCitation('medications', 'Current medications: Amoxicillin 500 mg. Stop taking if rash, increase dose') }],
    allergies: [{ status: 'observed', value: 'Penicillin', confidence: 0.93, citation: docCitation('allergies', 'Allergies: Penicillin') }],
    family_history: [],
  };
  const answer = await composeGroundedAnswer({ intakeForm });
  assert.deepEqual(answer.safety_flags, []);
  assert.equal(answer.safety_flags_dropped, 1);
  const request = buildCriticRequest(answer);
  assert.equal(request.items.filter((item) => item.kind === 'safety_flag').length, 0);
  const applied = applyCriticVerdicts(answer, vetoFlags(request, 'UNSUPPORTED_BY_SOURCE'));
  assert.deepEqual(applied.safety_flags, []);
  assert.equal(applied.safety_flags_dropped, 1);
  assert.equal(applied.critic_flags_questioned, 0);
});

test('F-CLIN: the critic request for a diabetes_range flag carries the CDC threshold quote in full', async () => {
  const answer = await composeGroundedAnswer({ labResults: [a1c('7.2')] });
  const [flag] = answer.safety_flags;
  const guideline = flag.citations.find((citation) => citation.source_type === 'guideline');
  assert.equal(guideline.source_id, 'cdc-a1c-diagnostic-ranges');
  const flagItem = buildCriticRequest(answer).items.find((item) => item.kind === 'safety_flag');
  assert.ok(flagItem, 'the flag is sent to the critic');
  assert.ok(flagItem.quotes.includes('A1C value: 7.2') || flagItem.quotes.some((quote) => quote.includes('7.2')), 'the lab quote is sent');
  assert.ok(flagItem.quotes.includes(guideline.quote_or_value.trim()), 'the whole chunk quote is sent, not truncated');
  assert.ok(flagItem.quotes.some((quote) => quote.includes('Diabetes: 6.5% or above')));
  const prompt = buildCriticPrompt([flagItem]);
  assert.ok(prompt.includes(JSON.stringify(guideline.quote_or_value.trim())), 'the prompt carries the chunk quote verbatim');
});

test('potassium: a document flag that contradicts the critical range goes to review, like A1C', () => {
  for (const [value, flagWord] of [['6.8', 'normal'], ['6.8', 'low'], ['2.4', 'normal'], ['2.4', 'high']]) {
    const { safetyFlags, labResults, needsReview } = run([{ ...potassium(value), abnormal_flag: flagWord }]);
    assert.deepEqual([safetyFlags.length, labResults.length], [0, 0], `${value} ${flagWord}`);
    assert.deepEqual(needsReview.map((item) => item.reason), ['flag_contradicts_range']);
  }
  assert.equal(run([{ ...potassium('6.8'), abnormal_flag: 'high' }]).safetyFlags.length, 1);
  assert.equal(run([{ ...potassium('2.4'), abnormal_flag: 'low' }]).safetyFlags.length, 1);
});

test('labKind: potassium spellings are normalized; Vitamin K is not potassium', () => {
  for (const name of ['Potassium', 'Potassium (K)', 'K, serum', 'Potassium, plasma', 'Serum K', 'K+', 'Serum potassium', 'POTASSIUM, SERUM']) {
    assert.equal(labKind({ test_name: name, citation: docCitation('lab.x.value', '1') }), 'potassium', name);
  }
  for (const name of ['Vitamin K', 'Hemoglobin', 'Sodium']) assert.equal(labKind({ test_name: name, citation: docCitation('lab.x.value', '1') }), null, name);
  assert.equal(labKind({ test_name: 'Glycated hemoglobin', citation: docCitation('lab.x.value', '1') }), 'a1c');
});

test('A1C of 20% or more is implausible: needs review, never a flag', () => {
  for (const value of ['20', '48']) assert.deepEqual(run([a1c(value)]).needsReview.map((item) => item.reason), ['implausible_value'], value);
  assert.equal(run([a1c('19.9')]).safetyFlags.length, 1);
});

test('drug classes: combination and brand names are recognized; ended medications do not flag', () => {
  const penicillin = docCitation('allergies', 'Allergies: Penicillin');
  const sulfa = docCitation('allergies', 'Allergy: Sulfa');
  for (const line of ['Medications: Zosyn 4.5 g every 6 hours', 'Medications: Piperacillin-tazobactam 3.375 g', 'Medications: Unasyn 3 g', 'Medications: Ampicillin-sulbactam 3 g']) assert.equal(run([], [penicillin, docCitation('medications', line)]).safetyFlags.length, 1, line);
  for (const line of ['Medications: TMP-SMX DS twice daily', 'Medications: SMX/TMP 800/160 mg', 'Medications: Trimethoprim-sulfamethoxazole 800/160 mg']) assert.equal(run([], [sulfa, docCitation('medications', line)]).safetyFlags.length, 1, line);
  // Ended: the line says so, or the chart records a stop status or an end date for that drug.
  assert.equal(run([], [penicillin, docCitation('medications', 'Medications: Amoxicillin 500 mg (discontinued)')]).safetyFlags.length, 0);
  assert.equal(run([], [penicillin, docCitation('medications', 'Medications: Amoxicillin 500 mg, end date 2026-08-01')]).safetyFlags.length, 0);
  assert.equal(run([], [penicillin, chartCitation('medication.amoxicillin.dose', '500 mg'), chartCitation('medication.amoxicillin.status', 'stopped')]).safetyFlags.length, 0);
  assert.equal(run([], [penicillin, chartCitation('medication.amoxicillin.dose', '500 mg'), chartCitation('medication.amoxicillin.end_date', '2026-08-01')]).safetyFlags.length, 0);
  assert.equal(run([], [penicillin, chartCitation('medication.amoxicillin.dose', '500 mg'), chartCitation('medication.amoxicillin.status', 'active')]).safetyFlags.length, 1);
});

test('summarizeSafetyFlags returns codes and counts only', () => {
  const flags = [...run([potassium('6.8'), a1c('7.2')]).safetyFlags, ...run([], [docCitation('allergies', 'Allergies: Penicillin'), docCitation('medications', 'Medications: Amoxicillin 500 mg')]).safetyFlags];
  const summary = summarizeSafetyFlags(flags);
  assert.deepEqual(summary, { count: 3, codes: ['critical_value', 'diabetes_range', 'drug_allergy_conflict'] });
  assert.doesNotMatch(JSON.stringify(summary), /6\.8|7\.2|Amoxicillin|Penicillin/);
});

// ---- Wired into the grounded answer --------------------------------------------------

test('composeGroundedAnswer ships the flags, moves the contradicted A1C to needs review, and never states it', async () => {
  const labs = [potassium('6.8'), a1c('6.9', 'normal'), lab({ test_name: 'Hemoglobin', value: '13.2', unit: 'g/dL', abnormal_flag: 'normal' })];
  const intakeForm = {
    demographics: { name: { status: 'not_found_on_form', value: null, confidence: 0, citation: null }, dob: { status: 'not_found_on_form', value: null, confidence: 0, citation: null } },
    chief_concern: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
    current_medications: [{ status: 'observed', value: 'Amoxicillin 500 mg', confidence: 0.93, citation: docCitation('medications', 'Current medications: Amoxicillin 500 mg') }],
    allergies: [{ status: 'observed', value: 'Penicillin', confidence: 0.93, citation: docCitation('allergies', 'Allergies: Penicillin') }],
    family_history: [],
  };
  const answer = await composeGroundedAnswer({ labResults: labs, intakeForm, question: '' });
  assert.ok(parseOrIssues(GroundedAnswerResult, answer).ok, parseOrIssues(GroundedAnswerResult, answer).issues.join('; '));
  assert.deepEqual(answer.safety_flags.map((flag) => flag.code).sort(), ['critical_value', 'drug_allergy_conflict']);
  assert.ok(answer.needs_review.some((item) => item.field === 'lab.a1c.value' && item.reason === 'flag_contradicts_range'));
  const stated = answer.patient_facts.flatMap((claim) => claim.citations.map((citation) => citation.field_or_chunk_id));
  assert.ok(!stated.includes('lab.a1c.value'), 'the contradicted A1C is not stated');
  assert.ok(stated.includes('lab.k.value') && stated.includes('lab.hgb.value'));
  // The trace summary carries codes and counts, never values.
  const { verification } = computeRuntimeEvaluation({ workflow: { readiness: 'ready', final_state: 'READY', answer } });
  assert.equal(verification.safety_flag_count, 2);
  assert.deepEqual(verification.safety_flag_codes, ['critical_value', 'drug_allergy_conflict']);
  assert.ok(verification.reason_codes.includes('flag_contradicts_range'));
  assert.doesNotMatch(JSON.stringify(verification), /6\.8|6\.9|Amoxicillin|Penicillin/);
});

test('a low-confidence critical potassium is not flagged: it is already in needs review, and no rule speaks for it', async () => {
  const answer = await composeGroundedAnswer({ labResults: [{ ...potassium('6.8'), confidence: 0.6 }] });
  assert.deepEqual(answer.safety_flags, []);
  assert.deepEqual(answer.needs_review, [{ kind: 'lab_result', field: 'lab.k.value', reason: 'low_confidence' }]);
});

// ---- "Not documented" follow-up on the briefing path ----------------------------------

test('briefing follow-up: a blood-pressure question is answered "not available from the sources read", with no unrelated evidence', async () => {
  const adapter = new FixtureAdapter(fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url)));
  const preparation = new PreVisitPreparation({ adapter, provider: new DeterministicProvider() });
  const value = { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', correlation_id: 'rules-not-documented', case_id: 'complete_return_visit' };
  const context = verifySignedContext(issueSignedContext({ patient_uuid: value.patient_uuid, clinician_uuid: value.clinician_uuid, secret: 'test-secret' }), 'test-secret');
  const briefing = await preparation.prepare(value, { verifiedContext: context });
  const ask = (message) => preparation.followUp(briefing.correlation_id, { ...value, message }, { verifiedContext: context });

  const bp = await ask('What was the blood pressure?');
  assert.equal(validateFollowUpResponse(bp).valid, true, validateFollowUpResponse(bp).issues.join('; '));
  // The chart read has no vitals group, so absence is not claimed (review should-fix 3).
  assert.equal(bp.text, 'Blood pressure is not available from the sources read (vital signs are not retrieved for this briefing).');
  assert.doesNotMatch(bp.text, /not documented/);
  assert.deepEqual(bp.not_documented.map((item) => item.status), ['not_retrieved']);
  assert.deepEqual(bp.claims, []);
  assert.deepEqual(bp.evidence, []);
  assert.deepEqual(bp.not_documented.map((item) => item.concept), ['blood_pressure']);
  assert.doesNotMatch(bp.text, /follow-up|log reviewed/, 'the visit reason and note that mention blood pressure are not a reading');

  // A documented topic still answers from the chart as before.
  const lisinopril = await ask('What is the lisinopril dose?');
  assert.ok(lisinopril.claims.length > 0);
  assert.equal(lisinopril.not_documented, undefined);
});
