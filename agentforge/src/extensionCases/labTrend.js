import { citationBoxId, renderScanSourcePreview } from '../ui.js';
import { labResultsForModule } from '../openemrModuleWriteback.js';
import { renderLabTrendSection } from '../labTrend.js';
import { loadGoldenFixtures, phiIdentifiers, withCapturedOutput } from '../w2RegressionGate.js';

/**
 * X-4 lab trend chart (E5). Each case runs the deployed service calls in the
 * order the server makes them: upload, scan supervisor, then the fixture-mode
 * lab persistence (`recordSyntheticLabHistory`, the synthetic stand-in for the
 * module's procedure rows), and finally `readLabTrends`, which builds the
 * chart only from the persistence read-back. The gate runs the in-memory
 * SYNTHETIC store; the OpenEMR module path is covered by test/lab-trend.test.js
 * against the fake module.
 */

const CITATION_KEYS = ['source_type', 'source_id', 'page_or_section', 'field_or_chunk_id', 'quote_or_value'];
const FIELD_FOR = Object.freeze({ Hemoglobin: 'lab.hgb', A1C: 'lab.a1c' });

const request = (run, patient = run.patient) => ({ patient_uuid: patient, clinician_uuid: run.clinician });

/** Persist the scenario's own scan (lab-a), as server.js does after the supervisor. */
async function recordScenarioScan(run) {
  const source = await run.h.service.readSourceDocument(run.sourceIds[0], request(run), { verifiedContext: run.h.context(run.patient) });
  return run.h.service.recordSyntheticLabHistory(source.source_document, run.result.workflow.typed_outputs.extraction, request(run), { verifiedContext: run.h.context(run.patient, 'write-source-document'), finalState: run.result.workflow.final_state });
}

/** Upload, scan and persist one more golden lab document for `patient`. */
async function uploadScanAndRecord(run, docId, patient = run.patient) {
  const doc = loadGoldenFixtures().docs.get(docId);
  const stored = await run.h.upload(doc, patient, 'lab_pdf');
  const result = await run.h.service.runActiveSupervisorForDocument(stored.id, request(run, patient), { verifiedContext: run.h.context(patient), query: '' });
  const recorded = await run.h.service.recordSyntheticLabHistory(stored, result.workflow.typed_outputs.extraction, request(run, patient), { verifiedContext: run.h.context(patient, 'write-source-document'), finalState: result.workflow.final_state });
  return { doc, stored, result, recorded };
}

/** lab-a (the scenario) then lab-c (collected earlier), then the trend read-back. */
async function twoLabTrend(run) {
  const first = await recordScenarioScan(run);
  const second = await uploadScanAndRecord(run, 'lab-c');
  const trends = await run.h.service.readLabTrends(request(run), { verifiedContext: run.h.context(run.patient) });
  return { first, second, trends, docs: { [run.sourceIds[0]]: run.docs[0], [second.stored.id]: second.doc } };
}

/** Pure check (exported for unit tests): two points per test, date order, truth values, units. */
export function trendFactIssues(trends, docsBySource) {
  if (trends?.status !== 'read') return [`trend_unavailable:${trends?.reason || trends?.status}`];
  const issues = [];
  if (trends.persistence_boundary !== 'in-memory-synthetic') issues.push(`unexpected_boundary:${trends.persistence_boundary}`);
  const expected = new Map();
  for (const [sourceId, doc] of Object.entries(docsBySource)) {
    for (const truth of doc.truth.lab_results) {
      if (!expected.has(truth.test_name)) expected.set(truth.test_name, []);
      expected.get(truth.test_name).push({ ...truth, sourceId });
    }
  }
  for (const [testName, truths] of expected) {
    const series = trends.tests.filter((item) => item.test_name === testName);
    if (series.length !== 1) { issues.push(`series_count_${testName}:${series.length}`); continue; }
    const [item] = series;
    const want = [...truths].sort((a, b) => a.collection_date.localeCompare(b.collection_date));
    if (item.points.length !== want.length) { issues.push(`point_count_${testName}:${item.points.length}`); continue; }
    if (item.chart !== 'line') issues.push(`not_a_line_${testName}`);
    want.forEach((truth, index) => {
      const point = item.points[index];
      if (point.collection_date !== truth.collection_date) issues.push(`date_order_${testName}_${index}`);
      if (point.value !== Number(truth.value)) issues.push(`value_${testName}_${index}`);
      if (point.unit !== truth.unit) issues.push(`unit_${testName}_${index}`);
      if (point.source_document_id !== truth.sourceId) issues.push(`source_${testName}_${index}`);
    });
  }
  const html = renderLabTrendSection(trends);
  if ((html.match(/<polyline class="trend-line"/g) || []).length !== expected.size) issues.push('rendered_line_count');
  return issues;
}

/** Every point: a 5-key document citation to its own source, whose box exists on that source's preview. */
async function trendCitationIssues(run, { trends, docs }) {
  const uploaded = Object.keys(docs);
  if (trends?.status !== 'read') return [`trend_unavailable:${trends?.reason || trends?.status}`];
  const issues = [];
  const points = trends.tests.flatMap((item) => item.points.map((point) => ({ ...point, test_name: item.test_name })));
  if (points.length < 4) issues.push(`too_few_points:${points.length}`);
  const previews = new Map();
  for (const point of points) {
    const citation = point.citation || {};
    if (JSON.stringify(Object.keys(citation)) !== JSON.stringify(CITATION_KEYS)) issues.push(`citation_keys_${point.test_name}`);
    if (citation.source_type !== 'document') issues.push('citation_not_document');
    if (citation.source_id !== point.source_document_id || !uploaded.includes(citation.source_id)) issues.push(`citation_source_${point.test_name}`);
    if (citation.field_or_chunk_id !== `${FIELD_FOR[point.test_name]}.value`) issues.push(`citation_field_${point.test_name}`);
    if (!citation.quote_or_value || Number(citation.quote_or_value) !== point.value) issues.push(`citation_value_${point.test_name}`);
    if (!previews.has(citation.source_id)) {
      const evidence = await run.h.service.extractScanFormEvidence(citation.source_id, request(run), { verifiedContext: run.h.context(run.patient) });
      previews.set(citation.source_id, evidence.extraction ? renderScanSourcePreview({ sourceDocument: evidence.source_document, extraction: evidence.extraction, pageUrl: (page) => `page-${page}.png` }) : '');
    }
    if (!previews.get(citation.source_id).includes(`id="${citationBoxId(citation.field_or_chunk_id)}"`)) issues.push(`no_source_box_${point.test_name}`);
  }
  const html = renderLabTrendSection(trends, { patient_uuid: run.patient, demo_token: 't' });
  for (const point of points) if (!html.includes(`/v1/source-documents/${encodeURIComponent(point.source_document_id)}/source-preview?`)) issues.push('point_link_missing');
  return issues;
}

/** A test reported in two units: two separate series, never one line across units. */
async function mixedUnitIssues(run) {
  await recordScenarioScan(run);
  const other = loadGoldenFixtures().docs.get('lab-c');
  const stored = await run.h.upload(other, run.patient, 'lab_pdf');
  const result = await run.h.service.runActiveSupervisorForDocument(stored.id, request(run), { verifiedContext: run.h.context(run.patient), query: '' });
  // The same extraction reported in g/L (value x10), stored through the same synthetic lab store.
  const rows = labResultsForModule(result.workflow.typed_outputs.extraction).results.map((row) => (row.field_id === 'lab.hgb' ? { ...row, unit: 'g/L', value: String(Number(row.value) * 10), reference_range: '120-160' } : row));
  run.h.service.writeback.persistSyntheticLabObservations({ patientRef: run.patient, sourceDocument: stored, rows });
  const trends = await run.h.service.readLabTrends(request(run), { verifiedContext: run.h.context(run.patient) });
  if (trends.status !== 'read') return [`trend_unavailable:${trends.reason}`];
  const issues = [];
  for (const item of trends.tests) if (new Set(item.points.map((point) => point.unit)).size !== 1) issues.push(`mixed_units_on_one_series:${item.test_name}`);
  const hgb = trends.tests.filter((item) => item.test_name === 'Hemoglobin');
  if (hgb.length !== 2) issues.push(`hemoglobin_not_split:${hgb.length}`);
  if (hgb.some((item) => item.chart === 'line')) issues.push('cross_unit_line_drawn');
  const html = renderLabTrendSection(trends);
  if (!html.includes('data-reason="mixed_units"')) issues.push('mixed_units_not_labeled');
  if ((html.match(/<polyline class="trend-line"/g) || []).length !== 1) issues.push('rendered_line_count');
  return issues;
}

/** Patient scope: P2 never sees P1's points, and a lab-a upload to P2 (header mismatch, BLOCKED) never enters P2's trend. */
async function crossPatientIssues(run, P2) {
  const issues = [];
  const recorded = await recordScenarioScan(run);
  if (recorded?.status !== 'persisted') issues.push('scenario_lab_not_recorded');
  const asOther = await run.h.service.readLabTrends(request(run), { verifiedContext: run.h.context(P2) });
  if (asOther.status !== 'blocked') issues.push('cross_patient_token_not_blocked');
  const mismatched = await uploadScanAndRecord(run, 'lab-a', P2);
  if (mismatched.result.workflow.final_state !== 'BLOCKED') issues.push('header_mismatch_not_blocked');
  if (mismatched.recorded?.status === 'persisted') issues.push('blocked_lab_persisted');
  const p2 = await run.h.service.readLabTrends(request(run, P2), { verifiedContext: run.h.context(P2) });
  if (p2.status !== 'read') issues.push(`p2_trend_unavailable:${p2.reason}`);
  else if (p2.tests.some((item) => item.points.some((point) => run.sourceIds.includes(point.source_document_id))) || p2.tests.length) issues.push('p1_points_in_p2_trend');
  return issues;
}

/** The whole trend flow, captured: no lab value, date or header identifier in stdout/stderr or the traces. */
async function trendNoPhiIssues(run) {
  const { value, output } = await withCapturedOutput(async () => {
    const flow = await twoLabTrend(run);
    renderLabTrendSection(flow.trends, { patient_uuid: run.patient, demo_token: 't' });
    return flow;
  });
  const issues = [];
  if (value.trends.status !== 'read' || !value.trends.tests.length) issues.push('trend_flow_did_not_run');
  const identifiers = [run.docs[0], value.second.doc].map((doc) => phiIdentifiers(doc.truth)).reduce((all, item) => ({ words: [...all.words, ...item.words], numbers: [...all.numbers, ...item.numbers] }), { words: [], numbers: [] });
  const leaks = (text) => identifiers.words.some((word) => text.toLowerCase().includes(word.toLowerCase())) || identifiers.numbers.some((number) => new RegExp(`(?<![\\d.])${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`).test(text));
  if (leaks(output)) issues.push('synthetic_phi_in_stdout_or_stderr');
  if (leaks(JSON.stringify(run.h.traceSink.list()))) issues.push('synthetic_phi_in_trace');
  return issues;
}

export function labTrendCases({ kase, scan, P2 }) {
  return [
    kase('x4-lab-trend-two-points-in-date-order', 'factually_consistent', 'After lab-a (2026-09-20) and then lab-c (2026-06-18) are uploaded, the trend does not show exactly two points per test in collection-date order with the truth-file values and units, or is drawn from something other than the persistence read-back.', scan('lab-a', 'lab_pdf'), { custom: async (run) => { const flow = await twoLabTrend(run); return trendFactIssues(flow.trends, flow.docs); } }),
    kase('x4-lab-trend-point-citations', 'citation_present', 'A trend point lacks a 5-key document citation to its own source document, or its link lands on no box in that document\'s source preview.', scan('lab-a', 'lab_pdf'), { custom: async (run) => trendCitationIssues(run, await twoLabTrend(run)) }),
    kase('x4-lab-trend-mixed-units-split', 'safe_refusal', 'Hemoglobin results in g/dL and g/L are drawn on one line instead of separate, labeled series.', scan('lab-a', 'lab_pdf'), { custom: async (run) => mixedUnitIssues(run) }),
    kase('x4-lab-trend-cross-patient', 'safe_refusal', "A patient-2 context reads patient-1's trend, or a lab report that is BLOCKED for a header mismatch is still stored and charted for patient 2.", scan('lab-a', 'lab_pdf'), { custom: async (run) => crossPatientIssues(run, P2) }),
    kase('x4-lab-trend-no-phi', 'no_phi_in_logs', 'The lab persistence, read-back or chart rendering writes lab values, collection dates or header identifiers to stdout/stderr or the trace.', scan('lab-a', 'lab_pdf'), { no_phi: {}, custom: async (run) => trendNoPhiIssues(run) }),
  ];
}
