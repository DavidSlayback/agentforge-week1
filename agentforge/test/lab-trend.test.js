import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeOpenEMRModule } from './fake-openemr-module.js';
import { buildLabTrends, renderLabTrendSection, renderTrendSvg } from '../src/labTrend.js';
import { OpenEMRModuleClient } from '../src/openemrModuleClient.js';
import { SyntheticLabObservationStore } from '../src/syntheticLabObservations.js';
import { labResultsForModule } from '../src/openemrModuleWriteback.js';
import { AgentForgeService } from '../src/service.js';
import { renderAgentForgePage } from '../src/ui.js';
import { DEMO_KEY_REQUEST, TEST_MINT_ENV } from './helpers/testServer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const secret = 'synthetic-test-secret';
const moduleHmacSecret = 'synthetic-module-hmac-secret';
const openemrPatient = 'a2c37f7f-1076-4172-b17a-bee8bb8d2da6';
const CITATION_KEYS = ['source_type', 'source_id', 'page_or_section', 'field_or_chunk_id', 'quote_or_value'];

// Synthetic lab rows as labResultsForModule emits them.
const row = (fieldId, value, date, { unit = fieldId === 'lab.hgb' ? 'g/dL' : '%', range = fieldId === 'lab.hgb' ? '12.0-16.0' : 'under 5.7', abnormal = 'no' } = {}) => ({ field_id: fieldId, loinc_code: fieldId === 'lab.hgb' ? '718-7' : '4548-4', test_name: fieldId === 'lab.hgb' ? 'Hemoglobin' : 'A1C', value, unit, reference_range: range, abnormal, collection_date: date, page: 1 });

function syntheticHistory(docs, patientRef = 'fixture-patient-001') {
  const store = new SyntheticLabObservationStore();
  for (const [sourceDocumentId, rows, patient = patientRef] of docs) store.persist({ patientRef: patient, sourceDocumentId, rows });
  return store.history({ patientRef });
}

test('lab trends: points come sorted by collection date, one series per test, each with its own 5-key citation', () => {
  // Stored later-first on purpose: the chart must sort, not keep upload order.
  const trends = buildLabTrends(syntheticHistory([
    ['src-lab-a', [row('lab.hgb', '13.2', '2026-09-20'), row('lab.a1c', '6.1', '2026-09-20', { abnormal: 'yes' })]],
    ['src-lab-c', [row('lab.hgb', '12.4', '2026-06-18'), row('lab.a1c', '6.8', '2026-06-18', { abnormal: 'yes' })]],
  ]));
  assert.equal(trends.persistence_boundary, 'in-memory-synthetic');
  assert.deepEqual(trends.tests.map((item) => [item.test_name, item.unit, item.chart]), [['A1C', '%', 'line'], ['Hemoglobin', 'g/dL', 'line']]);
  const hgb = trends.tests.find((item) => item.loinc_code === '718-7');
  assert.deepEqual(hgb.points.map((point) => [point.collection_date, point.value, point.source_document_id]), [['2026-06-18', 12.4, 'src-lab-c'], ['2026-09-20', 13.2, 'src-lab-a']]);
  assert.deepEqual(hgb.reference_band, { low: 12, high: 16 });
  assert.equal(trends.tests.find((item) => item.loinc_code === '4548-4').reference_band, null, '"under 5.7" is not a parseable band');
  for (const item of trends.tests) for (const point of item.points) {
    assert.deepEqual(Object.keys(point.citation), CITATION_KEYS);
    assert.equal(point.citation.source_id, point.source_document_id);
    assert.equal(point.citation.field_or_chunk_id, `${item.loinc_code === '718-7' ? 'lab.hgb' : 'lab.a1c'}.value`);
  }
});

test('lab trends: different units are never on one line; non-numeric values are excluded with a reason', () => {
  const trends = buildLabTrends(syntheticHistory([
    ['src-1', [row('lab.hgb', '13.2', '2026-09-20')]],
    ['src-2', [row('lab.hgb', '124', '2026-06-18', { unit: 'g/L', range: '120-160' })]],
    ['src-3', [row('lab.a1c', 'pending', '2026-05-01')]],
  ]));
  const hgb = trends.tests.filter((item) => item.loinc_code === '718-7');
  assert.equal(hgb.length, 2);
  for (const series of hgb) {
    assert.equal(new Set(series.points.map((point) => point.unit)).size, 1);
    assert.equal(series.chart, 'single_point');
    assert.equal(series.other_units.length, 1);
  }
  assert.deepEqual(trends.excluded.map((item) => item.reason), ['value_not_numeric']);
  const html = renderLabTrendSection(trends);
  assert.match(html, /data-reason="mixed_units"/);
  assert.match(html, /never on one line/);
  assert.match(html, /cannot be charted: value not numeric/);
});

test('lab trend chart: SVG per series with title, band, a linked marker per point and a table; one point and zero points are explicit states', () => {
  const two = buildLabTrends(syntheticHistory([
    ['src-lab-a', [row('lab.hgb', '13.2', '2026-09-20')]],
    ['src-lab-c', [row('lab.hgb', '12.4', '2026-06-18')]],
  ]));
  const svg = renderTrendSvg(two.tests[0], { basePath: '/agentforge-w2', patient_uuid: 'fixture-patient-001', demo_token: 'tok' });
  assert.match(svg, /<svg class="lab-trend-svg" role="img"[^>]*aria-labelledby=/);
  assert.match(svg, /<title id="[^"]+-title">Hemoglobin \(g\/dL\) over time<\/title>/);
  assert.match(svg, /class="reference-band"/);
  assert.match(svg, /<polyline class="trend-line"/);
  const links = [...svg.matchAll(/<a class="trend-point" href="([^"]+)"/g)].map((match) => match[1].replaceAll('&amp;', '&'));
  assert.deepEqual(links, [
    '/agentforge-w2/v1/source-documents/src-lab-c/source-preview?patient_uuid=fixture-patient-001&demo_token=tok#box-lab-hgb-value',
    '/agentforge-w2/v1/source-documents/src-lab-a/source-preview?patient_uuid=fixture-patient-001&demo_token=tok#box-lab-hgb-value',
  ]);
  const section = renderLabTrendSection(two, { patient_uuid: 'fixture-patient-001', demo_token: 'tok' });
  assert.match(section, /<table class="lab-trend-table"><caption>Hemoglobin results/);
  assert.match(section, /in-memory synthetic lab store \(fixture mode, not OpenEMR\)/);

  const one = renderLabTrendSection(buildLabTrends(syntheticHistory([['src-lab-a', [row('lab.hgb', '13.2', '2026-09-20')]]])));
  assert.match(one, /data-chart="single_point"/);
  assert.match(one, /One result so far/);
  assert.doesNotMatch(one, /<polyline/);

  const none = renderLabTrendSection(buildLabTrends({ read_path: 'openemr-fhir-service-in-process', persistence_boundary: 'openemr-module', missing_observation_ids: [], entries: [] }));
  assert.match(none, /data-chart="empty"/);
  assert.doesNotMatch(none, /<svg/);
});

test('synthetic lab store never returns another patient\'s results', () => {
  const history = syntheticHistory([
    ['src-p1', [row('lab.hgb', '13.2', '2026-09-20')]],
    ['src-p2', [row('lab.hgb', '9.9', '2026-08-01')], 'fixture-patient-002'],
  ]);
  assert.deepEqual(history.entries.map((entry) => entry.source_document_id), ['src-p1']);
  assert.equal(history.read_path, 'in-memory-synthetic-lab-store');
});

test('module client: lab history omits source_document_id and rejects a malformed bundle', async () => {
  const seen = [];
  const bundle = { resourceType: 'Bundle', read_path: 'openemr-fhir-service-in-process', scope: 'patient_lab_history', missing_observation_ids: [], skipped_lab_rows: 0, entry: [{ resource: { resourceType: 'Observation', id: 'o1' }, source_document_id: 57 }] };
  const client = (body) => new OpenEMRModuleClient({ baseUrl: 'http://module.test/api.php', secret: moduleHmacSecret, fetchImpl: async (url) => { seen.push(new URL(url)); return new Response(JSON.stringify(body), { status: 200 }); } });
  const result = await client(bundle).getLabObservationHistory({ patientUuid: openemrPatient, contextToken: 'token' });
  assert.equal(result.entry.length, 1);
  assert.equal(seen[0].searchParams.get('route'), 'lab-observations');
  assert.equal(seen[0].searchParams.has('source_document_id'), false);
  for (const bad of [{ ...bundle, scope: undefined }, { ...bundle, skipped_lab_rows: undefined }, { ...bundle, entry: [{ resource: {}, source_document_id: 'x' }] }, { ...bundle, read_path: 'something-else' }]) {
    await assert.rejects(client(bad).getLabObservationHistory({ patientUuid: openemrPatient, contextToken: 'token' }), { code: 'OPENEMR_MODULE_RESPONSE_INVALID' });
  }
});

// --- HTTP path (server.js) -------------------------------------------------

const envelope = (values) => [
  'SYNTHETIC_SCAN_FORM|layout=pdf-ocr-lab_pdf|page_count=1',
  ...[
    ['lab.hgb.test_name', 'Hemoglobin'], ['lab.hgb.value', values.hgb], ['lab.hgb.unit', 'g/dL'], ['lab.hgb.reference_range', '12.0-16.0'], ['lab.hgb.collection_date', values.date], ['lab.hgb.abnormal', 'No'],
    ['lab.a1c.test_name', 'A1C'], ['lab.a1c.value', values.a1c], ['lab.a1c.unit', '%'], ['lab.a1c.reference_range', 'under 5.7'], ['lab.a1c.collection_date', values.date], ['lab.a1c.abnormal', 'Yes'],
  ].map(([fieldId, value], index) => `FIELD|field_id=${fieldId}|label=${fieldId}|value=${value}|unit=|quote=${fieldId}: ${value}|page=1|box=10,${20 + index * 20},300,${35 + index * 20}|confidence=0.97`),
].join('\n');

async function startServer(port, extraEnv = {}) {
  const child = spawn(process.execPath, ['agentforge/src/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: secret, ...TEST_MINT_ENV, AGENTFORGE_SYNTHETIC_CONTEXT: 'true', AGENTFORGE_PROVIDER_MODE: 'deterministic', ...extraEnv }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  child.kill();
  throw new Error(`server did not start: ${stderr.slice(0, 500)}`);
}

async function contexts(base, patient) {
  const write = await fetch(`${base}/v1/source-document-context?patient_uuid=${patient}`, DEMO_KEY_REQUEST).then((response) => response.json());
  const read = await fetch(`${base}/v1/demo-context?patient_uuid=${patient}`, DEMO_KEY_REQUEST).then((response) => response.json());
  return { write: write.demo_token, read: read.demo_token, clinician: read.clinician_uuid };
}

const post = (base, route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function uploadAndScan(base, ctx, values, name) {
  const uploaded = await post(base, '/v1/source-documents', { patient_uuid: 'fixture-patient-001', clinician_uuid: ctx.clinician, demo_token: ctx.write, document_type: 'lab_pdf', filename: `${name}.scan.txt`, content_base64: Buffer.from(envelope(values)).toString('base64') }).then((response) => response.json());
  const scan = await post(base, '/v1/scan-supervisor', { patient_uuid: 'fixture-patient-001', clinician_uuid: ctx.clinician, demo_token: ctx.write, source_document_id: uploaded.source_document.id, message: '' });
  assert.equal(scan.status, 200);
  return { uploaded, scanned: await scan.json() };
}

async function exerciseTrendRoute(base) {
  const ctx = await contexts(base, 'fixture-patient-001');
  const later = await uploadAndScan(base, ctx, { hgb: '13.2', a1c: '6.1', date: '2026-09-20' }, 'lab-a');
  const earlier = await uploadAndScan(base, ctx, { hgb: '12.4', a1c: '6.8', date: '2026-06-18' }, 'lab-c');
  const trends = await fetch(`${base}/v1/patients/fixture-patient-001/lab-trends?demo_token=${encodeURIComponent(ctx.read)}`).then(async (response) => ({ status: response.status, body: await response.json() }));
  const chart = await fetch(`${base}/v1/patients/fixture-patient-001/lab-trends/chart?demo_token=${encodeURIComponent(ctx.read)}`);
  const other = await contexts(base, 'fixture-patient-002');
  const crossPatient = await fetch(`${base}/v1/patients/fixture-patient-001/lab-trends?demo_token=${encodeURIComponent(other.read)}`);
  return { later, earlier, trends, chart: { status: chart.status, type: chart.headers.get('content-type'), html: await chart.text() }, crossPatient: { status: crossPatient.status, body: await crossPatient.json() } };
}

test('HTTP lab trends (openemr-module mode, fake module): points are the module read-back, sorted, cited; another patient\'s token is refused', async () => {
  const fake = await startFakeOpenEMRModule({ hmacSecret: moduleHmacSecret, contextSecret: secret, allowlist: [openemrPatient] });
  // The read-back differs from what was uploaded, so a chart built from the
  // upload response would show the wrong values.
  fake.settings.corruptObservationValues = false;
  const port = 18871;
  const child = await startServer(port, { AGENTFORGE_PERSISTENCE_MODE: 'openemr-module', AGENTFORGE_MODULE_HMAC_SECRET: moduleHmacSecret, AGENTFORGE_OPENEMR_MODULE_URL: fake.url, AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS: openemrPatient, AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP: `fixture-patient-001=${openemrPatient}` });
  try {
    const run = await exerciseTrendRoute(`http://127.0.0.1:${port}`);
    assert.equal(run.later.scanned.openemr.read_back.verified, true);
    assert.equal(run.later.scanned.synthetic_lab_history, undefined, 'module mode never uses the synthetic store');
    assert.equal(run.trends.status, 200);
    assert.equal(run.trends.body.persistence_boundary, 'openemr-module');
    assert.equal(run.trends.body.read_path, 'openemr-fhir-service-in-process');
    const byCode = Object.fromEntries(run.trends.body.tests.map((item) => [item.loinc_code, item.points.map((point) => [point.collection_date, point.value, point.source_document_id])]));
    assert.deepEqual(byCode, {
      '718-7': [['2026-06-18', 12.4, run.earlier.uploaded.source_document.id], ['2026-09-20', 13.2, run.later.uploaded.source_document.id]],
      '4548-4': [['2026-06-18', 6.8, run.earlier.uploaded.source_document.id], ['2026-09-20', 6.1, run.later.uploaded.source_document.id]],
    });
    assert.equal(run.chart.status, 200);
    assert.match(run.chart.type, /text\/html/);
    assert.equal((run.chart.html.match(/<polyline class="trend-line"/g) || []).length, 2);
    assert.match(run.chart.html, /OpenEMR&#39;s FHIR Observation service/);
    assert.equal(run.crossPatient.status, 403);
    assert.equal(run.crossPatient.body.error, 'invalid_demo_context');

    // Read-back, not upload: corrupt what the module returns and the chart follows it.
    fake.settings.corruptObservationValues = true;
    const ctx = await contexts(`http://127.0.0.1:${port}`, 'fixture-patient-001');
    const corrupted = await fetch(`http://127.0.0.1:${port}/v1/patients/fixture-patient-001/lab-trends?demo_token=${encodeURIComponent(ctx.read)}`).then((response) => response.json());
    assert.deepEqual(corrupted.tests.find((item) => item.loinc_code === '718-7').points.map((point) => point.value), [13.4, 14.2]);

    // A resource naming another patient fails loudly instead of being charted.
    fake.settings.historySubjectOverride = '11111111-2222-4333-8444-555555555555';
    const mismatch = await fetch(`http://127.0.0.1:${port}/v1/patients/fixture-patient-001/lab-trends?demo_token=${encodeURIComponent(ctx.read)}`);
    assert.equal(mismatch.status, 502);
    assert.equal((await mismatch.json()).error, 'openemr_lab_history_patient_mismatch');
    // An Observation with no subject is refused too, never charted.
    fake.settings.historySubjectOverride = 'omit';
    const noSubject = await fetch(`http://127.0.0.1:${port}/v1/patients/fixture-patient-001/lab-trends?demo_token=${encodeURIComponent(ctx.read)}`);
    assert.equal(noSubject.status, 502);
    assert.equal((await noSubject.json()).error, 'openemr_lab_history_patient_mismatch');
  } finally {
    child.kill();
    await fake.close();
  }
});

test('HTTP lab trends (fixture mode): read back from the labeled in-memory synthetic store', async () => {
  const port = 18872;
  const child = await startServer(port);
  try {
    const run = await exerciseTrendRoute(`http://127.0.0.1:${port}`);
    assert.equal(run.later.scanned.synthetic_lab_history.persistence_boundary, 'in-memory-synthetic');
    assert.equal(run.trends.status, 200);
    assert.equal(run.trends.body.persistence_boundary, 'in-memory-synthetic');
    assert.equal(run.trends.body.read_path, 'in-memory-synthetic-lab-store');
    const hgb = run.trends.body.tests.find((item) => item.loinc_code === '718-7');
    assert.deepEqual(hgb.points.map((point) => [point.collection_date, point.value]), [['2026-06-18', 12.4], ['2026-09-20', 13.2]]);
    assert.match(run.chart.html, /fixture mode, not OpenEMR/);
    assert.equal(run.crossPatient.status, 403);
    const sample = await fetch(`http://127.0.0.1:${port}/v1/demo-scan-pdf?sample=lab-c`);
    assert.equal(sample.status, 200);
    assert.ok(Buffer.from(await sample.arrayBuffer()).subarray(0, 5).equals(Buffer.from('%PDF-')));
  } finally {
    child.kill();
  }
});

test('labResultsForModule rows round-trip through the synthetic store unchanged', () => {
  const extraction = { lab_results: [{ test_name: 'Hemoglobin', value: '13.2', unit: 'g/dL', reference_range: '12.0-16.0', collection_date: '2026-09-20', abnormal_flag: 'normal', citation: { field_or_chunk_id: 'lab.hgb.value', page_or_section: 'page 1' } }] };
  const { results } = labResultsForModule(extraction);
  const trends = buildLabTrends(syntheticHistory([['src-x', results]]));
  assert.deepEqual(trends.tests[0].points.map((point) => [point.value, point.unit, point.reference_range, point.abnormal_flag]), [[13.2, 'g/dL', '12-16', 'normal']]);
});

test('UI offers the lab-c sample and loads the server-rendered trend after a lab scan', () => {
  const page = renderAgentForgePage({ publicBasePath: '/agentforge-w2' });
  assert.match(page, /data-run-pdf-sample="lab-c" data-document-type="lab_pdf"/);
  assert.match(page, /\/v1\/demo-scan-pdf\?sample=lab-c/);
  assert.match(page, /'\/v1\/patients\/' \+ encodeURIComponent\(patient\) \+ '\/lab-trends\/chart\?demo_token=' \+ encodeURIComponent\(state\.demoToken\)/);
});

test('a BLOCKED workflow persists nothing: no OpenEMR write and no synthetic lab row', async () => {
  let writes = 0;
  const writeback = { persistenceBoundary: 'openemr-module', authorize: () => ({ status: 'authorized', patient_uuid: 'fixture-patient-002', clinician_uuid: 'c' }), persistDerivedEvidence: async () => { writes += 1; return { status: 'persisted' }; } };
  const service = new AgentForgeService({ chartAdapter: { authorize: () => ({ status: 'blocked' }) }, writeback, provider: null });
  const result = await service.persistDerivedEvidence({ id: 'openemr-doc-57', document_type: 'lab_pdf' }, { facts: [{}], lab_results: [] }, { patient_uuid: 'fixture-patient-002', clinician_uuid: 'c' }, { finalState: 'BLOCKED' });
  assert.deepEqual([result.status, result.reason, writes], ['not_persisted', 'workflow_blocked', 0]);
  const synthetic = new AgentForgeService({ chartAdapter: { authorize: () => ({ status: 'blocked' }) }, writeback: { authorize: () => ({ status: 'authorized', patient_uuid: 'p' }), persistSyntheticLabObservations: () => { writes += 1; } }, provider: null });
  const recorded = await synthetic.recordSyntheticLabHistory({ id: 'src-1', document_type: 'lab_pdf' }, { lab_results: [] }, {}, { finalState: 'BLOCKED' });
  assert.deepEqual([recorded.status, recorded.reason, writes], ['not_persisted', 'workflow_blocked', 0]);
  // Fail closed: no state (a dropped argument) or an unknown one throws; nothing is written.
  for (const finalState of [undefined, null, '', 'START']) {
    await assert.rejects(service.persistDerivedEvidence({ id: 'openemr-doc-57', document_type: 'lab_pdf' }, { facts: [{}] }, { patient_uuid: 'fixture-patient-002', clinician_uuid: 'c' }, { finalState }), { code: 'WORKFLOW_FINAL_STATE_REQUIRED' });
    await assert.rejects(synthetic.recordSyntheticLabHistory({ id: 'src-1', document_type: 'lab_pdf' }, { lab_results: [] }, {}, { finalState }), { code: 'WORKFLOW_FINAL_STATE_REQUIRED' });
  }
  assert.equal(writes, 0);
});

test('HTTP (openemr-module mode, fake module): a patient-1 lab uploaded to patient 2 is BLOCKED and writes no lab rows or trend points', async () => {
  const otherUuid = '11111111-2222-4333-8444-555555555555';
  const fake = await startFakeOpenEMRModule({ hmacSecret: moduleHmacSecret, contextSecret: secret, allowlist: [openemrPatient, otherUuid] });
  const port = 18873;
  const child = await startServer(port, { AGENTFORGE_PERSISTENCE_MODE: 'openemr-module', AGENTFORGE_MODULE_HMAC_SECRET: moduleHmacSecret, AGENTFORGE_OPENEMR_MODULE_URL: fake.url, AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS: `${openemrPatient},${otherUuid}`, AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP: `fixture-patient-001=${openemrPatient},fixture-patient-002=${otherUuid}` });
  const base = `http://127.0.0.1:${port}`;
  // The lab report header names patient 1 (Test Patient One, 1980-04-12).
  const labA = `${envelope({ hgb: '13.2', a1c: '6.1', date: '2026-09-20' })}
Patient: Test Patient One - DOB: 1980-04-12`;
  const scanFor = async (patient) => {
    const ctx = await contexts(base, patient);
    const uploaded = await post(base, '/v1/source-documents', { patient_uuid: patient, clinician_uuid: ctx.clinician, demo_token: ctx.write, document_type: 'lab_pdf', filename: 'lab-a.scan.txt', content_base64: Buffer.from(labA).toString('base64') }).then((response) => response.json());
    const scan = await post(base, '/v1/scan-supervisor', { patient_uuid: patient, clinician_uuid: ctx.clinician, demo_token: ctx.write, source_document_id: uploaded.source_document.id, message: '' });
    const trends = await fetch(`${base}/v1/patients/${patient}/lab-trends?demo_token=${encodeURIComponent(ctx.read)}`).then((response) => response.json());
    return { uploaded, status: scan.status, scanned: await scan.json(), trends };
  };
  try {
    const blocked = await scanFor('fixture-patient-002');
    assert.equal(blocked.status, 200);
    assert.equal(blocked.scanned.workflow.final_state, 'BLOCKED');
    assert.equal(blocked.scanned.workflow.stop_reason, 'patient_mismatch');
    assert.deepEqual([blocked.scanned.openemr.status, blocked.scanned.openemr.reason], ['not_persisted', 'workflow_blocked']);
    assert.deepEqual(fake.labRowsFor(blocked.uploaded.openemr.document_id), []);
    assert.deepEqual([fake.counts().procedure_orders, fake.counts().procedure_results], [0, 0]);
    assert.deepEqual(blocked.trends.tests, []);
    // Control: the same document on the right chart is READY and is written.
    const allowed = await scanFor('fixture-patient-001');
    assert.equal(allowed.scanned.workflow.final_state, 'READY');
    assert.equal(fake.labRowsFor(allowed.uploaded.openemr.document_id).length, 2);
    assert.equal(allowed.trends.tests.length, 2);
  } finally {
    child.kill();
    await fake.close();
  }
});

test('lab trends: same-date ties sort by document number, not string order; skipped module rows are reported', () => {
  const history = syntheticHistory([
    ['openemr-doc-10', [row('lab.hgb', '13.0', '2026-09-20')]],
    ['openemr-doc-9', [row('lab.hgb', '12.9', '2026-09-20')]],
  ]);
  const trends = buildLabTrends({ ...history, skipped_lab_rows: 2 });
  assert.deepEqual(trends.tests[0].points.map((point) => point.source_document_id), ['openemr-doc-9', 'openemr-doc-10']);
  assert.equal(trends.skipped_lab_row_count, 2);
  assert.match(renderLabTrendSection(trends), /data-reason="lab_rows_unlinked">2 stored lab record/);
});
