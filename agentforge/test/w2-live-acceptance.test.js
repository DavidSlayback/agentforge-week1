import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  citationHasExactKeys,
  collectCitations,
  decisionsIncludeOrder,
  findDemographicsLeak,
  everyStageHasDuration,
  retrievalHasHitCount,
  buildLedgerMarkdown,
  evaluateSourcePreview,
  evaluateCritic,
  evaluateMedicationList,
  evaluateMislabeledMedicationList,
  evaluateLabTrends,
  evaluateChartFactLabels,
  evaluateOutOfScopeRefusal,
  evaluateChartSourceBadge,
  evaluateP95Alert,
  evaluateDashboardSha,
  missingPlannedRows,
  PLANNED_IDS,
} from '../scripts/w2-live-acceptance.mjs';
import { renderAgentForgePage, renderScanSourcePreview } from '../src/ui.js';
import { buildLabTrends } from '../src/labTrend.js';
import observability from '../../observability/index.js';

const { evaluateAlerts } = observability;

// The pure helpers are exercised against hand-built fixtures shaped like the
// real contracts documented in src/schemas.js (Citation, AnswerClaim),
// src/supervisor.js (decisions) and observability/index.js
// (TraceRecorder#complete), or produced by the real renderers. `main()` is
// run only as a child process against a fake deployment on 127.0.0.1 (end of
// this file). Nothing here ever runs against the public AGENTFORGE_LIVE_URL.

const validCitation = () => ({ source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: '13.2' });

test('citationHasExactKeys accepts the 5 required keys and the 2 optional bounding-box keys', () => {
  assert.equal(citationHasExactKeys(validCitation()), true);
  assert.equal(citationHasExactKeys({ ...validCitation(), bounding_box: [1, 2, 3, 4], coordinate_space: 'page-pixels' }), true);
});

test('citationHasExactKeys rejects a missing required key, an empty value, and an unknown extra key', () => {
  const { source_id, ...missingSourceId } = validCitation();
  assert.equal(citationHasExactKeys(missingSourceId), false);
  assert.equal(citationHasExactKeys({ ...validCitation(), quote_or_value: '' }), false);
  assert.equal(citationHasExactKeys({ ...validCitation(), source_document_id: 'legacy-key' }), false);
  assert.equal(citationHasExactKeys({ ...validCitation(), location: 'legacy-key' }), false);
  assert.equal(citationHasExactKeys(null), false);
  assert.equal(citationHasExactKeys('not-an-object'), false);
});

test('collectCitations finds every citation reachable through a `citation` or `citations` key in a nested answer/extraction tree', () => {
  const tree = {
    typed_outputs: {
      extraction: {
        facts: [{ field_id: 'f1', citation: { ...validCitation(), field_or_chunk_id: 'f1' } }],
        lab_results: [{ test_name: 'Hemoglobin', citation: { ...validCitation(), field_or_chunk_id: 'lab_results[0]' } }],
        intake_form: { demographics: { name: { status: 'observed', citation: { ...validCitation(), source_type: 'document', field_or_chunk_id: 'demographics.name' } } } },
      },
    },
    answer: {
      patient_facts: [{ kind: 'patient_fact', text: 'redacted', citations: [{ ...validCitation(), field_or_chunk_id: 'pf1' }, { ...validCitation(), field_or_chunk_id: 'pf2' }] }],
      guideline_evidence: [{ kind: 'guideline', text: 'redacted', citations: [{ ...validCitation(), source_type: 'guideline', field_or_chunk_id: 'chunk-1' }] }],
    },
  };
  const found = collectCitations(tree);
  const ids = found.map((citation) => citation.field_or_chunk_id).sort();
  assert.deepEqual(ids, ['chunk-1', 'demographics.name', 'f1', 'lab_results[0]', 'pf1', 'pf2']);
});

test('collectCitations returns an empty list for a value with no citation-bearing keys, and never throws on cycles', () => {
  assert.deepEqual(collectCitations({ status: 'ok', count: 3 }), []);
  assert.deepEqual(collectCitations(null), []);
  const cyclic = { name: 'self-referencing' };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => collectCitations(cyclic));
});

test('decisionsIncludeOrder is true when EXTRACT, RETRIEVE and ANSWER appear in that order, even with extra decisions interleaved', () => {
  assert.equal(decisionsIncludeOrder([
    { next: 'EXTRACT', reason: 'extraction_needed' },
    { next: 'EXTRACT', reason: 'low_confidence_retry' },
    { next: 'RETRIEVE', reason: 'evidence_needed' },
    { next: 'ANSWER', reason: 'facts_and_evidence_ready' },
  ]), true);
});

test('decisionsIncludeOrder is false when the order is wrong, a step is missing, or decisions is not an array', () => {
  assert.equal(decisionsIncludeOrder([
    { next: 'RETRIEVE', reason: 'evidence_needed' },
    { next: 'EXTRACT', reason: 'extraction_needed' },
    { next: 'ANSWER', reason: 'facts_and_evidence_ready' },
  ]), false, 'RETRIEVE before EXTRACT must fail');
  assert.equal(decisionsIncludeOrder([
    { next: 'EXTRACT', reason: 'extraction_needed' },
    { next: 'RETRIEVE', reason: 'evidence_needed' },
  ]), false, 'missing ANSWER must fail');
  assert.equal(decisionsIncludeOrder(null), false);
  assert.equal(decisionsIncludeOrder(undefined), false);
});

test('findDemographicsLeak reports which demographic fields leaked into patient_fact claim text, never the values', () => {
  const demographics = { name: 'Test Patient One', dob: '1980-04-12', phone: '555-0100' };
  const leaking = [
    { kind: 'patient_fact', text: 'The chart lists test patient one as the record holder.' },
    { kind: 'guideline', text: 'A1C target under 5.7% per ADA Standards.' },
  ];
  const leaked = findDemographicsLeak(leaking, demographics);
  assert.deepEqual(leaked, ['name']);
  // The returned array never contains the raw value itself.
  assert.ok(!leaked.some((field) => field.includes('Test Patient One')));
});

test('findDemographicsLeak returns an empty list when no patient_fact claim mentions a demographic value', () => {
  const demographics = { name: 'Test Patient One', dob: '1980-04-12', phone: '555-0100' };
  const safe = [
    { kind: 'patient_fact', text: 'A1C rose from 6.1% to 7.2% between visits.' },
    { kind: 'guideline', text: 'Recommend re-check in three months.' },
  ];
  assert.deepEqual(findDemographicsLeak(safe, demographics), []);
});

test('findDemographicsLeak skips demographic values shorter than 3 characters and missing/undefined fields', () => {
  assert.deepEqual(findDemographicsLeak([{ kind: 'patient_fact', text: 'anything' }], { sex: 'M', phone: undefined, name: null }), []);
});

test('everyStageHasDuration requires a non-empty stages array where every entry has a numeric durationMs', () => {
  assert.equal(everyStageHasDuration([{ name: 'extraction', durationMs: 120 }, { name: 'retrieval', durationMs: 40 }]), true);
  assert.equal(everyStageHasDuration([{ name: 'extraction', durationMs: 120 }, { name: 'retrieval' }]), false);
  assert.equal(everyStageHasDuration([]), false);
  assert.equal(everyStageHasDuration(null), false);
});

test('retrievalHasHitCount requires at least one evidence-retriever attempt, and every one with a numeric hit_count', () => {
  assert.equal(retrievalHasHitCount({ attempts: [{ tool: 'evidence-retriever', provider: 'hybrid:gemini-embedding-2+alibaba-qwen:qwen3.8-flash', hit_count: 3 }] }), true);
  // Chart-read attempts (service.js: adapter/group, no hit_count) are not retrieval-tool attempts.
  assert.equal(retrievalHasHitCount({ attempts: [{ adapter: 'fixture', group: 'labs', status: 'read', attempts: 1 }, { tool: 'evidence-retriever', hit_count: 2 }] }), true);
  assert.equal(retrievalHasHitCount({ attempts: [{ tool: 'evidence-retriever', hit_count: 2 }, { tool: 'evidence-retriever', status: 'failed' }] }), false, 'every retriever attempt, not some');
  assert.equal(retrievalHasHitCount({ attempts: [{ tool: 'evidence-retriever', status: 'failed' }] }), false);
  assert.equal(retrievalHasHitCount({ attempts: [{ adapter: 'fixture', group: 'labs', status: 'read' }] }), false, 'no retriever attempt at all');
  assert.equal(retrievalHasHitCount({ attempts: [] }), false);
  assert.equal(retrievalHasHitCount(null), false);
});

test('buildLedgerMarkdown renders one table row per result, with evidence JSON escaped for markdown table cells', () => {
  const markdown = buildLedgerMarkdown([
    { id: 'W2-C1', check: 'upload lab pdf', pass: true, evidence: { document_id: 42 } },
    { id: 'W2-C7', check: 'citation | shape', pass: false, evidence: { invalid_citations: 1 } },
  ], { sha: 'abc1234', timestamp: '2026-09-24T00:00:00.000Z' });
  const lines = markdown.trim().split('\n');
  assert.equal(lines.length, 4, 'header + separator + 2 rows');
  assert.match(lines[0], /requirement id \| check \| PASS\/FAIL \| evidence \| SHA \| timestamp/);
  assert.match(lines[2], /W2-C1/);
  assert.match(lines[2], /PASS/);
  assert.match(lines[2], /abc1234/);
  assert.match(lines[3], /W2-C7/);
  assert.match(lines[3], /FAIL/);
  assert.match(lines[3], /citation \\\| shape/, 'a pipe inside a cell must be escaped so it does not break the table');
});

// ---------------------------------------------------------------------------
// E7 extension-item evaluators. Where a real renderer or builder exists
// (source preview, public page, lab trends, alerts), the fixture is produced
// by it, so a shape drift in the deployed code breaks these tests too.
// ---------------------------------------------------------------------------

const boxedFact = (fieldId, box) => ({ field_id: fieldId, value: 'redacted', confidence: 0.95, citation: { source_type: 'document', source_id: 'openemr-doc-21', page_or_section: 'page 1', field_or_chunk_id: `${fieldId}.value`, quote_or_value: 'redacted', bounding_box: box, coordinate_space: 'raster_pixels_200dpi' } });
const previewHtml = () => renderScanSourcePreview({
  sourceDocument: { id: 'openemr-doc-21', filename: 'filled-lab-a.pdf' },
  extraction: { status: 'complete', page_sizes: [{ page: 1, width: 1700, height: 2200 }], facts: [boxedFact('lab.a1c', [100, 200, 400, 240]), boxedFact('lab.hgb', [100, 300, 400, 340])] },
  basePath: '/agentforge-w2', patient_uuid: 'fixture-patient-001', demo_token: 'tok',
});

test('X-1 passes on a real rendered source preview: every link lands on a box, the page image is present', () => {
  const result = evaluateSourcePreview({ status: 200, html: previewHtml() });
  assert.equal(result.pass, true, JSON.stringify(result.evidence));
  assert.equal(result.evidence.source_links, 2);
  assert.equal(result.evidence.source_boxes, 2);
  assert.equal(result.evidence.links_without_box, 0);
  assert.equal(result.imageSrcs.length, 1);
  assert.match(result.imageSrcs[0], /^\/agentforge-w2\/v1\/source-documents\/openemr-doc-21\/pages\/1\.png\?patient_uuid=fixture-patient-001&demo_token=tok$/, 'the img src is HTML-decoded so it can be fetched');
  assert.ok(!JSON.stringify(result.evidence).includes('tok'), 'the demo token never reaches the ledger evidence');
});

test('X-1 fails when a link targets a missing box, when the page image is missing, or on a non-200', () => {
  const html = previewHtml();
  const brokenBox = html.replace('id="box-lab-a1c-value"', 'id="box-renamed"');
  assert.equal(evaluateSourcePreview({ status: 200, html: brokenBox }).pass, false);
  assert.equal(evaluateSourcePreview({ status: 200, html: brokenBox }).evidence.links_without_box, 1);
  const noImage = renderScanSourcePreview({ sourceDocument: { id: 'd', filename: 'x.pdf' }, extraction: { status: 'complete', page_sizes: [], facts: [boxedFact('lab.a1c', [1, 2, 3, 4])] } });
  assert.equal(evaluateSourcePreview({ status: 200, html: noImage }).pass, false, 'no page image, no links');
  assert.equal(evaluateSourcePreview({ status: 403, html }).pass, false);
  assert.equal(evaluateSourcePreview({ status: 200, html: '' }).pass, false);
});

const reviewedWorkflow = () => ({
  answer: { critic_status: 'reviewed', patient_facts: [], guideline_evidence: [] },
  decisions: [{ next: 'EXTRACT' }, { next: 'RETRIEVE' }, { next: 'ANSWER' }, { next: 'CRITIQUE', reason: 'answer_needs_review' }, { next: 'DONE', reason: 'critique_reviewed' }],
  handoffs: [{ worker: 'scan-form-extraction-worker' }, { worker: 'evidence-retrieval-worker' }, { worker: 'critic-worker' }],
});
const reviewedTrace = () => ({ ...reviewedWorkflow(), critic: { status: 'reviewed', duration_ms: 1182 }, stages: [{ name: 'critic', durationMs: 1190 }] });

test('X-2 passes when the answer, the workflow and the trace all show a reviewed critic step, and records its duration', () => {
  const result = evaluateCritic({ scanStatus: 200, workflow: reviewedWorkflow(), trace: reviewedTrace() });
  assert.equal(result.pass, true, JSON.stringify(result.evidence));
  assert.equal(result.evidence.critic_duration_ms, 1182);
});

test('X-2 fails (never skips) on a disabled, failed or skipped critic, and on a missing CRITIQUE, handoff, duration or trace', () => {
  for (const status of ['disabled', 'failed', 'skipped_budget', 'skipped_no_claims', 'skipped_not_approved', undefined]) {
    const workflow = reviewedWorkflow();
    workflow.answer.critic_status = status;
    assert.equal(evaluateCritic({ scanStatus: 200, workflow, trace: reviewedTrace() }).pass, false, `critic_status ${status}`);
  }
  const trace = reviewedTrace();
  trace.critic.status = 'disabled';
  assert.equal(evaluateCritic({ scanStatus: 200, workflow: reviewedWorkflow(), trace }).pass, false, 'trace critic disabled');
  const noCritique = reviewedTrace();
  noCritique.decisions = noCritique.decisions.filter((decision) => decision.next !== 'CRITIQUE');
  assert.deepEqual(evaluateCritic({ scanStatus: 200, workflow: reviewedWorkflow(), trace: noCritique }).evidence.failed_checks, ['trace_critique_decision']);
  const noHandoff = reviewedWorkflow();
  noHandoff.handoffs = noHandoff.handoffs.filter((handoff) => handoff.worker !== 'critic-worker');
  assert.equal(evaluateCritic({ scanStatus: 200, workflow: noHandoff, trace: reviewedTrace() }).pass, false);
  assert.equal(evaluateCritic({ scanStatus: 200, workflow: reviewedWorkflow(), trace: null }).pass, false, 'no matched trace');
  const noDuration = reviewedTrace();
  delete noDuration.critic.duration_ms;
  noDuration.stages = [];
  assert.equal(evaluateCritic({ scanStatus: 200, workflow: reviewedWorkflow(), trace: noDuration }).pass, false, 'no critic duration');
});

const medCitation = (field, sourceId = 'openemr-doc-40') => ({ source_type: 'document', source_id: sourceId, page_or_section: 'page 1', field_or_chunk_id: field, quote_or_value: 'redacted' });
const medlistUpload = () => ({ status: 200, data: { source_document: { id: 'openemr-doc-40', document_type: 'medication_list' }, openemr: { document_id: 40 } } });
const medlistScan = (finalState = 'READY') => ({ status: 200, data: { workflow: {
  final_state: finalState,
  answer: { patient_facts: [{ kind: 'patient_fact', text: 'redacted', citations: [medCitation('medication.3.name')] }], guideline_evidence: [] },
  typed_outputs: { extraction: { medication_list: { medications: [{ citation: medCitation('medication.3.name') }] }, facts: [{ field_id: 'medication.3.name', citation: medCitation('medication.3.name') }] } },
} } });

test('X-3 passes on a READY or QUALIFIED medication list with a cited medication claim, read back, and 5-key citations', () => {
  assert.equal(evaluateMedicationList({ upload: medlistUpload(), readbackSha256Matches: true, scan: medlistScan('READY') }).pass, true);
  assert.equal(evaluateMedicationList({ upload: medlistUpload(), readbackSha256Matches: true, scan: medlistScan('QUALIFIED') }).pass, true);
});

test('X-3 fails with no cited medication claim, a bad citation key, a failed readback, no document_id, or a BLOCKED scan', () => {
  const noClaim = medlistScan();
  noClaim.data.workflow.answer.patient_facts[0].citations = [medCitation('lab.a1c.value')];
  assert.equal(evaluateMedicationList({ upload: medlistUpload(), readbackSha256Matches: true, scan: noClaim }).evidence.cited_medication_claims, 0);
  assert.equal(evaluateMedicationList({ upload: medlistUpload(), readbackSha256Matches: true, scan: noClaim }).pass, false);
  const otherDocument = medlistScan();
  otherDocument.data.workflow.answer.patient_facts[0].citations = [medCitation('medication.3.name', 'openemr-doc-99')];
  assert.equal(evaluateMedicationList({ upload: medlistUpload(), readbackSha256Matches: true, scan: otherDocument }).pass, false, 'a claim citing another document is not this upload');
  const badKey = medlistScan();
  badKey.data.workflow.typed_outputs.extraction.facts[0].citation = { ...medCitation('medication.3.name'), location: 'legacy' };
  assert.equal(evaluateMedicationList({ upload: medlistUpload(), readbackSha256Matches: true, scan: badKey }).evidence.invalid_citations, 1);
  assert.equal(evaluateMedicationList({ upload: medlistUpload(), readbackSha256Matches: true, scan: badKey }).pass, false);
  assert.equal(evaluateMedicationList({ upload: medlistUpload(), readbackSha256Matches: false, scan: medlistScan() }).pass, false);
  const noDocumentId = medlistUpload();
  noDocumentId.data.openemr.document_id = null;
  assert.equal(evaluateMedicationList({ upload: noDocumentId, readbackSha256Matches: true, scan: medlistScan() }).pass, false);
  assert.equal(evaluateMedicationList({ upload: medlistUpload(), readbackSha256Matches: true, scan: medlistScan('BLOCKED') }).pass, false);
});

test('X-3-MISLABEL passes only when the mislabeled intake is refused: BLOCKED, QUALIFIED doc_type_mismatch, or a 400 type mismatch', () => {
  const scan = (finalState, reasons = []) => ({ status: 200, data: { workflow: { final_state: finalState, qualification: { reasons } } } });
  const upload = { status: 200, data: { source_document: { id: 'openemr-doc-41', document_type: 'medication_list' } } };
  assert.equal(evaluateMislabeledMedicationList({ upload, scan: scan('QUALIFIED', ['doc_type_mismatch']) }).pass, true);
  assert.equal(evaluateMislabeledMedicationList({ upload, scan: scan('BLOCKED') }).pass, true);
  assert.equal(evaluateMislabeledMedicationList({ upload: { status: 400, data: { error: 'SOURCE_DOCUMENT_TYPE_MISMATCH' } }, scan: null }).pass, true);
  assert.equal(evaluateMislabeledMedicationList({ upload, scan: scan('READY') }).pass, false, 'READY is never acceptable');
  assert.equal(evaluateMislabeledMedicationList({ upload, scan: scan('READY', ['doc_type_mismatch']) }).pass, false);
  assert.equal(evaluateMislabeledMedicationList({ upload, scan: scan('QUALIFIED', ['low_confidence']) }).pass, false, 'qualified for another reason hides the mismatch');
  assert.equal(evaluateMislabeledMedicationList({ upload: { status: 500, data: { error: 'boom' } }, scan: null }).pass, false);
});

const observation = (code, display, value, id) => ({ resourceType: 'Observation', id, subject: { reference: 'Patient/p1' }, code: { coding: [{ system: 'http://loinc.org', code, display }] }, valueQuantity: { value, unit: code === '4548-4' ? '%' : 'g/dL' }, interpretation: [{ coding: [{ code: 'no' }] }] });
const trendHistory = () => ({
  read_path: 'openemr-fhir-service-in-process', persistence_boundary: 'openemr-module', missing_observation_ids: [], skipped_lab_rows: 0,
  entries: [
    { resource: observation('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', 7.2, 'o1'), source_document_id: 'openemr-doc-21', field_id: 'lab.a1c', page: 1, collection_date: '2026-09-21' },
    { resource: observation('718-7', 'Hemoglobin [Mass/volume] in Blood', 11.9, 'o2'), source_document_id: 'openemr-doc-21', field_id: 'lab.hgb', page: 1, collection_date: '2026-09-21' },
    { resource: observation('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', 6.8, 'o3'), source_document_id: 'openemr-doc-30', field_id: 'lab.a1c', page: 1, collection_date: '2026-06-18' },
    { resource: observation('718-7', 'Hemoglobin [Mass/volume] in Blood', 12.4, 'o4'), source_document_id: 'openemr-doc-30', field_id: 'lab.hgb', page: 1, collection_date: '2026-06-18' },
  ],
});
const readTrends = (history) => ({ status: 'read', synthetic_only: true, patient_uuid: 'fixture-patient-001', ...buildLabTrends(history) });
const BOTH_LABS = ['openemr-doc-21', 'openemr-doc-30'];

test('X-4 passes on a real buildLabTrends read-back from the OpenEMR module: 2 points per test, date order, each cited to its own document', () => {
  const result = evaluateLabTrends({ status: 200, trends: readTrends(trendHistory()), uploadedSourceIds: BOTH_LABS });
  assert.equal(result.pass, true, JSON.stringify(result.evidence));
  assert.equal(result.evidence.tests.A1C.max_points, 2);
  assert.equal(result.evidence.tests.Hemoglobin.max_points, 2);
  assert.ok(!JSON.stringify(result.evidence).includes('7.2') && !JSON.stringify(result.evidence).includes('2026-06-18'), 'no values or dates in evidence');
});

test('X-4 fails on a 1-point trend, a synthetic boundary, a point citing another document, an out-of-order series, or a missing upload', () => {
  const onePoint = trendHistory();
  onePoint.entries = onePoint.entries.filter((entry) => !(entry.resource.code.coding[0].code === '718-7' && entry.source_document_id === 'openemr-doc-30'));
  const one = evaluateLabTrends({ status: 200, trends: readTrends(onePoint), uploadedSourceIds: ['openemr-doc-21'] });
  assert.equal(one.pass, false);
  assert.ok(one.evidence.failures.includes('Hemoglobin:fewer_than_2_points'));

  const synthetic = { ...trendHistory(), read_path: 'in-memory-synthetic-lab-store', persistence_boundary: 'in-memory-synthetic' };
  const syntheticResult = evaluateLabTrends({ status: 200, trends: readTrends(synthetic), uploadedSourceIds: BOTH_LABS });
  assert.equal(syntheticResult.pass, false, 'the in-memory store is not an OpenEMR read-back');
  assert.ok(syntheticResult.evidence.failures.includes('not_openemr_module_boundary'));

  const miscited = readTrends(trendHistory());
  miscited.tests[0].points[1] = { ...miscited.tests[0].points[1], citation: { ...miscited.tests[0].points[1].citation, source_id: 'openemr-doc-99' } };
  assert.equal(evaluateLabTrends({ status: 200, trends: miscited, uploadedSourceIds: BOTH_LABS }).pass, false);

  const reordered = readTrends(trendHistory());
  reordered.tests[0].points.reverse();
  assert.equal(evaluateLabTrends({ status: 200, trends: reordered, uploadedSourceIds: BOTH_LABS }).pass, false);

  assert.equal(evaluateLabTrends({ status: 200, trends: readTrends(trendHistory()), uploadedSourceIds: ['openemr-doc-21', 'openemr-doc-77'] }).pass, false, 'lab-c must be among the points');
  assert.equal(evaluateLabTrends({ status: 200, trends: readTrends(trendHistory()), uploadedSourceIds: [] }).pass, false);
  assert.equal(evaluateLabTrends({ status: 403, trends: { error: 'invalid_demo_context' }, uploadedSourceIds: ['openemr-doc-21'] }).pass, false);
});

const chartCitation = (sourceType) => ({ source_type: sourceType, source_id: 'fixture-patient-001', page_or_section: 'Synthetic chart fixture', field_or_chunk_id: 'medication.lisinopril.dose', quote_or_value: 'redacted' });
const labAnswerScan = (types) => ({ chart_source: { chart_source: 'synthetic_fixture', status: 'read' }, workflow: { answer: {
  patient_facts: [{ kind: 'patient_fact', text: 'redacted', citations: [medCitation('lab.a1c.value', 'openemr-doc-21'), ...types.map(chartCitation)] }],
  guideline_evidence: [{ kind: 'guideline', text: 'redacted', citations: [{ source_type: 'guideline', source_id: 'ada', page_or_section: 's6', field_or_chunk_id: 'c1', quote_or_value: 'redacted' }] }],
} } });

test('E8-CHART-LABEL passes when every chart-fact citation is synthetic_chart_fixture and chart_source is synthetic_fixture', () => {
  const result = evaluateChartFactLabels({ scanStatus: 200, scanData: labAnswerScan(['synthetic_chart_fixture', 'synthetic_chart_fixture']) });
  assert.equal(result.pass, true);
  assert.equal(result.evidence.chart_fact_citations, 2);
});

test('E8-CHART-LABEL fails on any openemr_record label, on no chart facts at all, or on a non-fixture chart_source', () => {
  const mixed = evaluateChartFactLabels({ scanStatus: 200, scanData: labAnswerScan(['synthetic_chart_fixture', 'openemr_record']) });
  assert.equal(mixed.pass, false, 'one openemr_record among fixtures must fail (every, not some)');
  assert.equal(mixed.evidence.openemr_record_labeled, 1);
  assert.equal(evaluateChartFactLabels({ scanStatus: 200, scanData: labAnswerScan([]) }).pass, false, 'vacuous: no chart facts');
  const live = labAnswerScan(['synthetic_chart_fixture']);
  live.chart_source.chart_source = 'openemr_live';
  assert.equal(evaluateChartFactLabels({ scanStatus: 200, scanData: live }).pass, false);
});

test('E8-SCOPE passes on the 403 out_of_scope_patient refusal and fails on an answer, a different refusal, or an echoed patient ref', () => {
  assert.equal(evaluateOutOfScopeRefusal({ status: 403, data: { error: 'out_of_scope_patient' } }).pass, true);
  assert.equal(evaluateOutOfScopeRefusal({ status: 200, data: { disposition: 'blocked', reason: 'out_of_scope_patient', claims: [] } }).pass, true);
  assert.equal(evaluateOutOfScopeRefusal({ status: 200, data: { disposition: 'ready', claims: [{ text: 'redacted' }] } }).pass, false);
  assert.equal(evaluateOutOfScopeRefusal({ status: 403, data: { error: 'invalid_demo_context' } }).pass, false);
  assert.equal(evaluateOutOfScopeRefusal({ status: 403, data: { error: 'out_of_scope_patient', patient: 'fixture-patient-002' } }).pass, false);
  assert.equal(evaluateOutOfScopeRefusal({ status: 403, data: { error: 'out_of_scope_patient', note: 'fixture-patient-002' } }).evidence.names_a_patient_ref, true);
  const disclosing = evaluateOutOfScopeRefusal({ status: 200, data: { disposition: 'blocked', reason: 'out_of_scope_patient', claims: [{ text: 'redacted' }] } });
  assert.equal(disclosing.pass, false);
  assert.deepEqual(disclosing.evidence.disclosing_keys, ['claims']);
});

test('E8-BADGE passes on the real public demo page and fails on the live-OpenEMR page', () => {
  assert.equal(evaluateChartSourceBadge({ status: 200, html: renderAgentForgePage({ publicBasePath: '/agentforge-w2' }) }).pass, true);
  const live = evaluateChartSourceBadge({ status: 200, html: renderAgentForgePage({ publicBasePath: '/agentforge-w2', liveOpenEMR: true }) });
  assert.equal(live.pass, false);
  assert.deepEqual(live.evidence.chart_source_values, ['openemr_live']);
  assert.equal(evaluateChartSourceBadge({ status: 200, html: '<p>no badge</p>' }).pass, false);
});

test('W2-ALERT-P95 passes on a real evaluateAlerts result with a 30000 ms threshold and fails on the old 2000 ms default', () => {
  const snapshot = { latencyMs: { p95: 21228 }, errorRate: 0, toolFailureRate: 0 };
  assert.equal(evaluateP95Alert({ status: 200, data: evaluateAlerts(snapshot, { p95LatencyMs: 30000 }) }).pass, true);
  const old = evaluateP95Alert({ status: 200, data: evaluateAlerts(snapshot) });
  assert.equal(old.pass, false);
  assert.equal(old.evidence.threshold_ms, 2000);
  assert.equal(evaluateP95Alert({ status: 200, data: { rules: [] } }).pass, false);
});

test('W2-DASHBOARD-SHA passes only when /dashboard/health reports the expected SHA', () => {
  assert.equal(evaluateDashboardSha({ status: 200, data: { status: 'ok', service: 'dashboard', git_sha: 'abc123' }, expectedSha: 'abc123' }).pass, true);
  assert.equal(evaluateDashboardSha({ status: 200, data: { git_sha: 'abf81afe' }, expectedSha: 'abc123' }).pass, false);
  assert.equal(evaluateDashboardSha({ status: 200, data: { git_sha: 'unversioned' }, expectedSha: 'abc123' }).pass, false);
  assert.equal(evaluateDashboardSha({ status: 502, data: null, expectedSha: 'abc123' }).pass, false);
});

test('every E7 row id is planned, and a planned id with no row is reported missing', () => {
  for (const id of ['W2-SHA', 'W2-DASHBOARD-SHA', 'X-1', 'X-2', 'X-3', 'X-3-MISLABEL', 'X-4', 'E8-CHART-LABEL', 'E8-SCOPE', 'E8-BADGE', 'W2-ALERT-P95']) assert.ok(PLANNED_IDS.includes(id), id);
  assert.equal(new Set(PLANNED_IDS).size, PLANNED_IDS.length, 'no duplicate ids');
  const results = PLANNED_IDS.filter((id) => id !== 'X-4').map((id) => ({ id, pass: true }));
  assert.deepEqual(missingPlannedRows(results, PLANNED_IDS), ['X-4']);
  assert.deepEqual(missingPlannedRows(PLANNED_IDS.map((id) => ({ id })), PLANNED_IDS), []);
});

// ---------------------------------------------------------------------------
// The whole run (`main()`), as a child process, against a local fake W2 +
// dashboard on 127.0.0.1 -- never the public URL. The fake answers every
// route the script calls with the deployed shapes (real renderers for the
// preview, the page and the trends), so this proves the wiring: each check's
// URL, token and order, one ledger row per planned id, the exit code, and
// that no token reaches stdout or the ledger. Knobs break one item at a time.
// ---------------------------------------------------------------------------

const SCRIPT = fileURLToPath(new URL('../scripts/w2-live-acceptance.mjs', import.meta.url));
const FAKE_SHA = 'e7fakesha000000000000000000000000000000';

function startFakeDeployment({ criticStatus = 'reviewed', trendsRoute = true, chartSourceType = 'synthetic_chart_fixture', dashboardSha = FAKE_SHA } = {}) {
  const docs = new Map();
  const traces = [];
  const scannedLabs = [];
  const ids = { 'filled-lab-a.pdf|lab_pdf': 21, 'filled-intake-a.pdf|intake_form': 22, 'filled-intake-a.pdf|lab_pdf': 23, 'filled-lab-c.pdf|lab_pdf': 30, 'filled-medlist-a.pdf|medication_list': 40, 'filled-intake-a.pdf|medication_list': 41 };
  const cite = (sourceId, field, sourceType = 'document') => ({ source_type: sourceType, source_id: sourceId, page_or_section: 'page 1', field_or_chunk_id: field, quote_or_value: 'redacted' });
  const guideline = { kind: 'guideline', text: 'redacted', citations: [cite('ada-2026', 'chunk-1', 'guideline')] };
  const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
  const workflowFor = (doc) => {
    const id = doc.id;
    const base = { decisions: [{ next: 'EXTRACT' }, { next: 'RETRIEVE' }, { next: 'ANSWER' }], handoffs: [{ worker: 'scan-form-extraction-worker' }, { worker: 'evidence-retrieval-worker' }], typed_outputs: { evidence: { provider: 'hybrid:fake', degraded: null } } };
    if (doc.mislabeled) return { ...base, final_state: 'QUALIFIED', qualification: { reasons: ['doc_type_mismatch'] }, typed_outputs: { ...base.typed_outputs, extraction: { facts: [] } } };
    const critic = criticStatus === 'reviewed' ? { decisions: [...base.decisions, { next: 'CRITIQUE', reason: 'answer_needs_review' }, { next: 'DONE', reason: 'critique_reviewed' }], handoffs: [...base.handoffs, { worker: 'critic-worker' }] } : { decisions: [...base.decisions, { next: 'DONE', reason: `critic_${criticStatus}` }], handoffs: base.handoffs };
    const field = doc.type === 'medication_list' ? 'medication.3.name' : doc.type === 'intake_form' ? 'intake.chief_concern' : 'lab.a1c.value';
    const facts = [{ kind: 'patient_fact', text: 'redacted', citations: [cite(id, field)] }, { kind: 'patient_fact', text: 'redacted', citations: [cite('fixture-patient-001', 'medication.lisinopril.dose', chartSourceType)] }];
    const extraction = { facts: [{ field_id: field, citation: cite(id, field) }], ...(doc.type === 'medication_list' ? { medication_list: { medications: [{ citation: cite(id, field) }] } } : {}) };
    return { ...base, ...critic, final_state: 'READY', answer: { critic_status: criticStatus, patient_facts: facts, guideline_evidence: [guideline] }, typed_outputs: { ...base.typed_outputs, extraction } };
  };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const url = new URL(req.url, 'http://fake');
    const q = url.searchParams;
    if (url.pathname === '/dashboard/health') return send(res, 200, { status: 'ok', service: 'dashboard', git_sha: dashboardSha });
    if (!url.pathname.startsWith('/agentforge-w2')) return send(res, 404, { error: 'not_found' });
    const path = url.pathname.slice('/agentforge-w2'.length) || '/';
    // Tokens: the write token is 'w:<patient>', the read token 'r:<patient>'.
    const tokenOk = (token, patient, kind) => token === `${kind}:${patient}`;
    if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok', git_sha: FAKE_SHA });
    if (req.method === 'GET' && path === '/v1/source-document-context') return send(res, 200, { demo_token: `w:${q.get('patient_uuid')}` });
    if (req.method === 'GET' && path === '/v1/demo-context') return send(res, 200, { demo_token: `r:${q.get('patient_uuid')}` });
    if (req.method === 'GET' && path === '/v1/traces') return send(res, 200, traces);
    if (req.method === 'GET' && path === '/v1/alerts') return send(res, 200, evaluateAlerts({ latencyMs: { p95: 21000 }, errorRate: 0, toolFailureRate: 0 }, { p95LatencyMs: 30000 }));
    if (req.method === 'GET' && path === '/') return send(res, 200, renderAgentForgePage({ publicBasePath: '/agentforge-w2' }), 'text/html');
    if (req.method === 'POST' && path === '/v1/supervisor') return send(res, 404, { error: 'not_found' });
    if (req.method === 'POST' && path === '/v1/follow-up-evidence') return tokenOk(body.demo_token, body.patient_uuid, 'r') && /fixture-patient-002/.test(body.message) ? send(res, 403, { error: 'out_of_scope_patient' }) : send(res, 400, { error: 'unexpected' });
    if (req.method === 'POST' && path === '/v1/source-documents') {
      if (!tokenOk(body.demo_token, body.patient_uuid, 'w')) return send(res, 403, { error: 'invalid_demo_context' });
      const bytes = Buffer.from(body.content_base64, 'base64');
      if (bytes.subarray(0, 5).toString() !== '%PDF-') return send(res, 400, { error: 'invalid_source_document_request', issues: ['unsupported_upload_format'] });
      const number = ids[`${body.filename}|${body.document_type}`];
      const id = `openemr-doc-${number}`;
      const duplicate = docs.has(id);
      docs.set(id, { id, type: body.document_type, bytes, mislabeled: [23, 41].includes(number) });
      return send(res, 200, { status: 'persisted', duplicate, source_document: { id, document_type: body.document_type }, openemr: { document_id: number } });
    }
    const docMatch = path.match(/^\/v1\/source-documents\/([^/]+)(\/source-preview|\/pages\/1\.png)?$/);
    if (req.method === 'GET' && docMatch) {
      const doc = docs.get(decodeURIComponent(docMatch[1]));
      const token = q.get('demo_token');
      if (!doc || !(tokenOk(token, q.get('patient_uuid'), 'w') || tokenOk(token, q.get('patient_uuid'), 'r'))) return send(res, 403, { error: 'invalid_demo_context' });
      if (docMatch[2] === '/pages/1.png') return send(res, 200, Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png');
      if (docMatch[2] === '/source-preview') {
        const fact = (fieldId, box) => ({ field_id: fieldId, value: 'redacted', confidence: 0.95, citation: { ...cite(doc.id, `${fieldId}.value`), bounding_box: box, coordinate_space: 'raster_pixels_200dpi' } });
        return send(res, 200, renderScanSourcePreview({ sourceDocument: { id: doc.id, filename: 'filled-lab-a.pdf' }, extraction: { status: 'complete', page_sizes: [{ page: 1, width: 1700, height: 2200 }], facts: [fact('lab.a1c', [100, 200, 400, 240]), fact('lab.hgb', [100, 300, 400, 340])] }, basePath: '/agentforge-w2', patient_uuid: q.get('patient_uuid'), demo_token: token }), 'text/html');
      }
      return send(res, 200, { source_document: { id: doc.id }, content_base64: doc.bytes.toString('base64') });
    }
    if (req.method === 'POST' && path === '/v1/scan-supervisor') {
      const doc = docs.get(body.source_document_id);
      if (!tokenOk(body.demo_token, body.patient_uuid, 'w')) return send(res, 403, { error: 'invalid_demo_context' });
      if (body.patient_uuid !== 'fixture-patient-001') return send(res, 403, { error: 'document_scope_mismatch' });
      const workflow = workflowFor(doc);
      if (doc.type === 'lab_pdf' && !doc.mislabeled) scannedLabs.push(doc.id);
      traces.push({ correlationId: `c-${traces.length}`, operation: 'w2-scan-supervisor', startedAt: new Date(Date.now() + traces.length).toISOString(), handoffs: workflow.handoffs, decisions: workflow.decisions, stages: [{ name: 'extraction', durationMs: 10 }, ...(criticStatus === 'reviewed' ? [{ name: 'critic', durationMs: 900 }] : [])], modelTotals: { input_tokens: 10, output_tokens: 5, cost_usd: 0.001 }, retrieval: { attempts: [{ adapter: 'fixture', group: 'labs', status: 'read' }, { tool: 'evidence-retriever', hit_count: 3 }] }, extraction: { confidence: { mean: 0.95 } }, critic: { status: criticStatus, ...(criticStatus === 'reviewed' ? { duration_ms: 880 } : {}) }, evaluation: { status: 'passed' } });
      return send(res, 200, { status: 'completed', chart_source: { chart_source: 'synthetic_fixture', status: 'read' }, workflow, openemr: { read_back: { verified: !doc.mislabeled } } });
    }
    const trendMatch = path.match(/^\/v1\/patients\/([^/]+)\/lab-trends$/);
    if (trendsRoute && req.method === 'GET' && trendMatch) {
      if (!tokenOk(q.get('demo_token'), decodeURIComponent(trendMatch[1]), 'r')) return send(res, 403, { error: 'invalid_demo_context' });
      const dates = { 'openemr-doc-21': '2026-09-21', 'openemr-doc-30': '2026-06-18' };
      const entries = scannedLabs.flatMap((id) => [['4548-4', 'lab.a1c', 7], ['718-7', 'lab.hgb', 12]].map(([code, fieldId, value]) => ({ resource: { id: `${id}-${code}`, code: { coding: [{ system: 'http://loinc.org', code, display: code }] }, valueQuantity: { value, unit: 'u' } }, source_document_id: id, field_id: fieldId, page: 1, collection_date: dates[id] })));
      return send(res, 200, { status: 'read', synthetic_only: true, patient_uuid: 'fixture-patient-001', ...buildLabTrends({ read_path: 'openemr-fhir-service-in-process', persistence_boundary: 'openemr-module', missing_observation_ids: [], skipped_lab_rows: 0, entries }) });
    }
    return send(res, 404, { error: 'not_found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function runAcceptance(fakeOptions) {
  const server = await startFakeDeployment(fakeOptions);
  const { port } = server.address();
  const ledger = join(mkdtempSync(join(tmpdir(), 'w2-acceptance-')), 'LEDGER.md');
  try {
    const { code, stdout } = await new Promise((resolve) => {
      execFile(process.execPath, [SCRIPT, '--ledger', ledger], { env: { ...process.env, AGENTFORGE_LIVE_URL: `http://127.0.0.1:${port}/agentforge-w2`, AGENTFORGE_EXPECT_SHA: FAKE_SHA, AGENTFORGE_DASHBOARD_URL: '' }, timeout: 60000 }, (error, out) => resolve({ code: error ? error.code : 0, stdout: out }));
    });
    const report = JSON.parse(stdout.slice(stdout.indexOf('{\n  "schema_version"'), stdout.lastIndexOf('}') + 1));
    return { code, stdout, report, ledger: readFileSync(ledger, 'utf8'), rows: Object.fromEntries(report.checks.map((check) => [check.id, check])) };
  } finally {
    server.close();
  }
}

test('the full run against a fake deployment passes every planned row, one row each, and never prints a token', async () => {
  const run = await runAcceptance();
  const failed = run.report.checks.filter((check) => !check.pass).map((check) => `${check.id} ${JSON.stringify(check.evidence)}`);
  assert.deepEqual(failed, []);
  assert.equal(run.code, 0);
  assert.deepEqual(run.report.checks.map((check) => check.id).sort(), [...PLANNED_IDS].sort(), 'exactly one row per planned id');
  assert.equal(run.rows['X-2'].evidence.critic_duration_ms, 880);
  assert.equal(run.rows['X-4'].evidence.tests.A1C.max_points, 2);
  for (const text of [run.stdout, run.ledger]) assert.ok(!/[wr]:fixture-patient/.test(text), 'no demo token in stdout or the ledger');
  assert.equal(run.ledger.trim().split('\n').length, PLANNED_IDS.length + 2);
});

test('the full run fails X-2 (and only X-2) when the deployed critic is disabled', async () => {
  const run = await runAcceptance({ criticStatus: 'disabled' });
  assert.equal(run.code, 1);
  assert.deepEqual(run.report.checks.filter((check) => !check.pass).map((check) => check.id), ['X-2']);
  assert.equal(run.rows['X-2'].evidence.critic_status, 'disabled');
});

test('the full run fails X-4 when the lab-trends route is gone, E8-CHART-LABEL on an openemr_record label, and the dashboard row on a stale SHA', async () => {
  const noTrends = await runAcceptance({ trendsRoute: false });
  assert.deepEqual(noTrends.report.checks.filter((check) => !check.pass).map((check) => check.id), ['X-4']);
  const mislabeled = await runAcceptance({ chartSourceType: 'openemr_record' });
  assert.deepEqual(mislabeled.report.checks.filter((check) => !check.pass).map((check) => check.id), ['E8-CHART-LABEL']);
  const staleDashboard = await runAcceptance({ dashboardSha: 'abf81afe' });
  assert.deepEqual(staleDashboard.report.checks.filter((check) => !check.pass).map((check) => check.id), ['W2-DASHBOARD-SHA']);
  assert.equal(staleDashboard.code, 1);
});
