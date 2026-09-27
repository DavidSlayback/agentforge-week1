import test from 'node:test';
import assert from 'node:assert/strict';
import { factLine, factRows, reviewItemLabel, scanSummary, scanSteps } from '../src/uiFormat.js';
import { niceAxis, referenceText, buildLabTrends, renderTrendSvg, renderLabTrendSection } from '../src/labTrend.js';
import { renderAgentForgePage } from '../src/ui.js';

const chart = (field, value, text = `problem ${field} status: ${value}`) => ({ kind: 'patient_fact', text, citations: [{ source_type: 'synthetic_chart_fixture', source_id: 'fixture-record-1', page_or_section: 'Synthetic chart fixture', field_or_chunk_id: field, quote_or_value: value }] });

test('factLine renders chart facts as readable clinical lines from their own fields', () => {
  assert.equal(factLine(chart('problem.hypertension.status', 'active')), 'Hypertension — active');
  assert.equal(factLine(chart('medication.lisinopril.dose', '10 mg daily')), 'Lisinopril 10 mg daily');
  assert.equal(factLine(chart('medication.lisinopril.comment', 'take with food')), 'Lisinopril — instructions: take with food');
  assert.equal(factLine(chart('medication.lisinopril.dose', 'dose not available from this OpenEMR route')), 'Lisinopril — dose not available from this OpenEMR route');
  assert.equal(factLine(chart('encounter.reason', 'blood-pressure follow-up')), 'Encounter: blood-pressure follow-up');
  assert.equal(factLine(chart('note.plan_follow_through', 'home blood-pressure log reviewed')), 'Plan follow-through: home blood-pressure log reviewed');
  assert.equal(factLine({ ...chart('problem.type_2_diabetes.status', 'active'), recorded_at: '2026-06-18T10:00:00Z' }), 'Type 2 diabetes — active (2026-06-18)');
});

test('factLine keeps the claim text for document citations and unrecognized fields', () => {
  const lab = { kind: 'patient_fact', text: 'A1C is 6.1 % on 2026-09-20 with reference under 5.7 and flagged abnormal.', citations: [{ source_type: 'document', source_id: 'src-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.a1c.value', quote_or_value: '6.1' }] };
  assert.equal(factLine(lab), lab.text);
  assert.equal(factLine(chart('vital.bp', '120/80', 'The chart records vital bp as 120/80.')), 'The chart records vital bp as 120/80.');
  assert.equal(factLine({ text: 'No citation here.' }), 'No citation here.');
  assert.equal(factLine(chart('problem.hypertension.status', '', 'Original claim text.')), 'Original claim text.');
});

test('factRows collapses exact duplicate lines and keeps each distinct citation', () => {
  const first = chart('problem.hypertension.status', 'active');
  const second = { ...chart('problem.hypertension.status', 'active'), citations: [{ ...first.citations[0], source_id: 'fixture-record-2' }] };
  const rows = factRows([first, second, first, chart('medication.lisinopril.dose', '5 mg daily'), chart('medication.lisinopril.dose', '10 mg daily')]);
  assert.deepEqual(rows.map((row) => [row.text, row.count, row.citations.length]), [['Hypertension — active', 3, 1], ['Lisinopril 5 mg daily', 1, 1], ['Lisinopril 10 mg daily', 1, 1]]);
  const doc = (source) => ({ kind: 'patient_fact', text: 'Hemoglobin 13.2 g/dL.', citations: [{ source_type: 'document', source_id: source, page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: '13.2' }] });
  assert.equal(factRows([doc('src-a'), doc('src-b'), doc('src-a')])[0].citations.length, 2, 'each distinct source document keeps its link');
});

test('reviewItemLabel maps raw field ids and reasons to readable phrases', () => {
  assert.equal(reviewItemLabel({ field: 'lab.hgb.value', reason: 'low_confidence' }), 'Hemoglobin value: low OCR confidence, check the source');
  assert.equal(reviewItemLabel({ field: 'lab.a1c.reference_range', reason: 'flag_contradicts_range' }), 'A1C reference range: the printed flag contradicts the reference range, check the source');
  assert.equal(reviewItemLabel({ field: 'lab.k.value', reason: 'rule_unit_unrecognized' }), 'Potassium value: unit not recognized, so the safety rule was not applied');
  assert.equal(reviewItemLabel({ field: 'lab.xyz.unit', reason: 'some_new_reason' }), 'XYZ unit: some new reason');
  assert.equal(reviewItemLabel({ field: 'intake.medications[0].dose', reason: 'low_confidence' }), 'Medications 1 dose: low OCR confidence, check the source');
  assert.equal(reviewItemLabel({ field: 'medications', reason: 'openemr_unconfirmed_empty' }), 'Medications: could not be confirmed from OpenEMR (an empty list is not a confirmed absence)');
});

test('scanSummary and scanSteps state the result, the fields and the critic status plainly', () => {
  assert.deepEqual(scanSummary({ documentType: 'lab_pdf', finalState: 'READY', factCount: 12, criticStatus: 'reviewed' }), { document: 'Lab report read', state: 'Ready', fields: '12 cited fields', critic: 'answer reviewed by the critic' });
  const qualified = scanSummary({ documentType: 'medication_list', finalState: 'QUALIFIED', factCount: 1, criticStatus: 'skipped_budget', criticRejected: 2, criticUnreviewed: 1 });
  assert.equal(qualified.state, 'Needs review');
  assert.equal(qualified.fields, '1 cited field');
  assert.equal(qualified.critic, 'critic skipped (budget); answer not reviewed, 2 claim(s) removed, 1 claim(s) not reviewed');
  assert.equal(scanSummary({ documentType: 'intake_form', finalState: 'BLOCKED', factCount: 0 }).critic, 'no answer composed');
  assert.deepEqual(scanSteps([{ worker: 'scan-form-extraction-worker' }, { worker: 'scan-form-extraction-worker' }, { worker: 'evidence-retrieval-worker' }, { worker: 'critic-worker' }, { worker: 'new-thing-worker' }]), ['Extract', 'Retrieve guidelines', 'Critic review', 'New thing']);
});

test('the main page serializes the format helpers into a client script that parses', () => {
  const page = renderAgentForgePage({ publicBasePath: '/agentforge-w2' });
  for (const name of ['factLine', 'factRows', 'reviewItemLabel', 'scanSummary', 'scanSteps']) assert.match(page, new RegExp(`const ${name} = function ${name}\\(`));
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.doesNotThrow(() => new Function(scripts[0][1]));
  assert.match(page, /Technical notes for reviewers/);
  assert.match(page, /id="scan-result"[^>]*tabindex="-1"/);
  assert.doesNotMatch(page, /Synthetic scan workflow completed/);
  assert.doesNotMatch(page, /Evaluator notes/);
});

test('niceAxis rounds the y range out to readable ticks that contain every value', () => {
  assert.deepEqual(niceAxis([6.1, 6.8, 7.2]), { low: 6, high: 7.5, step: 0.5, ticks: [6, 6.5, 7, 7.5] });
  const hgb = niceAxis([11.9, 12.4, 13.2, 12, 16]);
  assert.deepEqual([hgb.low, hgb.high, hgb.step], [10, 16, 2]);
  const flat = niceAxis([5, 5]);
  assert.ok(flat.low < 5 && flat.high > 5);
});

const observation = (value, range) => ({ resourceType: 'Observation', code: { coding: [{ system: 'http://loinc.org', code: '4548-4', display: 'A1C' }] }, valueQuantity: { value, unit: '%' }, ...(range ? { referenceRange: [range] } : {}) });

test('referenceText shows a parsed range, else the read-back range text, else points at the source', () => {
  const trends = buildLabTrends({ entries: [
    { resource: observation(6.1, { text: 'under 5.7' }), source_document_id: 'src-a', field_id: 'lab.a1c', page: 1, collection_date: '2026-09-20' },
    { resource: observation(6.8, null), source_document_id: 'src-c', field_id: 'lab.a1c', page: 1, collection_date: '2026-06-18' },
    { resource: observation(7.2, { low: { value: 4 }, high: { value: 5.6 } }), source_document_id: 'src-b', field_id: 'lab.a1c', page: 1, collection_date: '2026-09-21' },
  ] });
  const points = trends.tests[0].points;
  assert.deepEqual(points.map((point) => point.reference_range), [null, null, '4-5.6'], 'the JSON field is unchanged');
  assert.ok(points.every((point) => !('reference_text' in point)), 'no new key on the API point');
  assert.deepEqual(points.map(referenceText), ['see source document', 'under 5.7', '4-5.6']);
  const html = renderLabTrendSection(trends);
  assert.match(html, /<td>under 5\.7<\/td>/);
  assert.doesNotMatch(html, /not parseable/);
});

test('trend chart spaces results evenly with a date under each point and says it is not to time scale', () => {
  const trends = buildLabTrends({ entries: ['2026-06-18', '2026-09-20', '2026-09-21'].map((date, index) => ({ resource: observation([6.8, 6.1, 7.2][index], null), source_document_id: `src-${index}`, field_id: 'lab.a1c', page: 1, collection_date: date })) });
  const svg = renderTrendSvg(trends.tests[0]);
  const xs = [...svg.matchAll(/<circle cx="([\d.]+)"/g)].map((match) => Number(match[1]));
  assert.equal(xs.length, 3);
  assert.equal(xs[1] - xs[0], xs[2] - xs[1], 'consecutive-day results are not stacked into a spike');
  assert.deepEqual([...svg.matchAll(/class="point-date"[^>]*>([^<]+)</g)].map((match) => match[1]), ['2026-06-18', '2026-09-20', '2026-09-21']);
  assert.match(svg, /not to time scale/);
  assert.match(svg, />6\.5</, 'a rounded tick label');
});

test('latencyByOperation reports scan and briefing percentiles apart from zero-work cache reads', async () => {
  const { latencyByOperation, computeDashboardMetrics, renderObservabilityPage } = await import('../src/observabilityPage.js');
  const traces = [
    ...[10000, 12000, 14000].map((durationMs) => ({ interactionType: 'scan_form', durationMs })),
    ...[6000, 7000].map((durationMs) => ({ interactionType: 'background_preparation', durationMs })),
    ...Array.from({ length: 20 }, () => ({ interactionType: 'prepared_open', durationMs: 0 })),
    { interactionType: 'scan_form', durationMs: null },
  ];
  const ops = latencyByOperation(traces);
  assert.deepEqual(ops.map((op) => [op.label, op.count, op.p50, op.p95, op.cache_read]), [
    ['Document scan', 3, 12000, 14000, false],
    ['Briefing preparation', 2, 6000, 7000, false],
    ['Open prepared briefing (cache read)', 20, 0, 0, true],
  ]);
  const metrics = computeDashboardMetrics(traces);
  assert.equal(metrics.p50, 0, 'the all-requests median is still reported as measured');
  assert.deepEqual(metrics.byOperation, ops);
  const page = renderObservabilityPage();
  assert.match(page, /const latencyByOperation=function latencyByOperation\(/);
  assert.match(page, /<select id="op-filter"><option value="work">Real work/);
  assert.match(page, /are cache reads \(about 0 ms, no model work\)/);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.doesNotThrow(() => new Function(scripts[0][1]));
});

test('evaluator panel shows the W2 gate and extension suite before the Week 1 results', async () => {
  const { renderEvaluatorPage } = await import('../src/ui.js');
  const report = (total, labels) => ({ passed: true, total_cases: total, by_label: labels });
  const page = renderEvaluatorPage({ golden: { gate_passed: true, total_cases: 7 }, errorAnalysis: { gate_passed: true }, w2Gate: report(50, { schema_valid: { cases: 50, passed: 50 } }), w2Extensions: report(53, { safe_refusal: { cases: 53, passed: 52 } }) });
  const order = ['W2 regression gate (50 cases)', 'W2 extension suite', 'Operational surfaces', 'Week 1 baseline evidence', 'Limitations'].map((text) => page.indexOf(text));
  assert.ok(order.every((index) => index >= 0), 'every section renders');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'W2 first, Week 1 below');
  assert.match(page, /href="\/evals\/w2-extension-baseline\.json"/);
  assert.match(page, /<strong>52\/53<\/strong>/);
  assert.match(page, /<span class="value">1<\/span><span class="muted">failed<\/span>/);
  assert.match(page, /a\{color:var\(--teal\)/);
});

test('latencyByOperation treats cached follow-ups as cache reads too', async () => {
  const { latencyByOperation } = await import('../src/observabilityPage.js');
  const ops = latencyByOperation([{ interactionType: 'fresh_followup', durationMs: 4000 }, { interactionType: 'cache_followup', durationMs: 0 }]);
  assert.deepEqual(ops.map((op) => [op.label, op.cache_read]), [['Follow-up question', false], ['Follow-up answered from cache', true]]);
});
