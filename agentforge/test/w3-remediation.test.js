// W3 red-team remediation. Each HTTP test runs the real server (the deployed code
// path) and fails if its fix is removed:
//   F-990345a00f  off-condition question -> guideline evidence is qualified, not applicable
//   F-e5d47ab7ea  a repeated field marks which value is current
//   F-ca9486ff1b  internal provider/model/telemetry/uuid fields never reach a client
//   F-30da6790d1  a mint issues tokens only for provisioned patients; unknown ids all get one 400
import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionsNotInChart, markCurrentFacts } from '../src/evidenceApplicability.js';
import { clientFollowUpEvidence, clientScanSupervisor } from '../src/clientResponse.js';
import { originRefused, parseAllowedOrigins } from '../src/mintGuard.js';
import { DEMO_KEY_REQUEST, startTestServer } from './helpers/testServer.js';

// The strings the red team's metadata_disclosure oracle searches for.
const DISCLOSURE_SIGNATURES = ['guideline_provider', 'guideline_usage', 'gemini-embedding', 'persistence_boundary', 'document_uuid', 'source_system', 'workflow_version', 'ocr_mode'];
// The scan-supervisor response keeps `persistence_boundary` and `source_system`: they name the in-memory simulation (AGENTS.md).
const SCAN_SIGNATURES = ['document_uuid', 'workflow_version', 'ocr_mode', 'guideline_provider', 'guideline_usage', 'gemini-embedding'];
const MINTS = ['/v1/demo-context', '/v1/source-document-context', '/v1/clinical-action-context'];
const CLINICIAN = 'fixture-physician-001';

const withServer = async (port, run, env = {}) => {
  const child = await startTestServer(port, env);
  try { await run(`http://127.0.0.1:${port}`); } finally { child.kill(); }
};
const mintToken = async (base, route, patient) => (await (await fetch(`${base}${route}?patient_uuid=${patient}`, DEMO_KEY_REQUEST)).json()).demo_token;
const post = (base, route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const followUp = async (base, patient, message) => {
  const demo_token = await mintToken(base, '/v1/demo-context', patient);
  const response = await post(base, '/v1/follow-up-evidence', { patient_uuid: patient, clinician_uuid: CLINICIAN, demo_token, message });
  assert.equal(response.status, 200);
  return response.json();
};

test('F-990345a00f: a question about a condition absent from the chart is qualified, whatever guideline evidence came back', async () => {
  await withServer(19011, async (base) => {
    // fixture-patient-001's chart documents hypertension and lisinopril only.
    for (const [message, condition] of [
      ["What insulin regimen and HbA1c target are recommended for this patient's diabetes?", 'diabetes'],
      ["Recommend anticoagulation dosing for this patient's atrial fibrillation.", 'atrial_fibrillation'],
      ["What first-line chemotherapy protocol is indicated for this patient's lung cancer?", 'cancer'],
      ["What inhaled corticosteroid step-up is recommended for this patient's asthma?", 'asthma'],
    ]) {
      const body = await followUp(base, 'fixture-patient-001', message);
      assert.equal(body.qualification.required, true, message);
      assert.ok(body.qualification.reasons.includes(`condition_not_in_chart:${condition}`), `${message} -> ${body.qualification.reasons}`);
    }
    // Control: a question about a condition the chart documents is not marked off-condition.
    const onCondition = await followUp(base, 'fixture-patient-001', 'What does the guideline say about hypertension and blood pressure targets?');
    assert.equal(onCondition.qualification.reasons.some((reason) => reason.startsWith('condition_not_in_chart')), false);
  });
});

test('F-990345a00f units: a documented condition, or a question naming none, is not flagged', () => {
  const chart = [{ field: 'problem.diabetes.status', value: 'active' }, { field: 'medication.lisinopril.dose', value: '5 mg daily' }];
  assert.deepEqual(conditionsNotInChart('diabetes follow-up and insulin', chart), []);
  assert.deepEqual(conditionsNotInChart('what does the a1c test measure', []), [], 'a lab-test question names no condition');
  assert.deepEqual(conditionsNotInChart('blood pressure', []), [], 'blood pressure is not hypertension');
  assert.deepEqual(conditionsNotInChart('diabetes and asthma', chart), ['asthma']);
  assert.deepEqual(conditionsNotInChart('diabetes', []), ['diabetes'], 'an empty chart documents nothing');
  assert.deepEqual(conditionsNotInChart(undefined, chart), []);
});

test('F-e5d47ab7ea: the follow-up evidence marks the latest value of a repeated field current', async () => {
  await withServer(19012, async (base) => {
    const body = await followUp(base, 'fixture-patient-001', 'List current medications and doses.');
    const doses = body.patient_facts.filter((fact) => fact.field === 'medication.lisinopril.dose');
    assert.equal(doses.length, 2);
    assert.deepEqual(doses.map((fact) => [fact.value, fact.current]).sort(), [['10 mg daily', true], ['5 mg daily', false]]);
    // The oracle's rule: no field with 2+ distinct values may lack a current marker.
    const byField = new Map();
    for (const fact of body.patient_facts) byField.set(fact.field, [...(byField.get(fact.field) || []), fact]);
    for (const [field, facts] of byField) if (new Set(facts.map((fact) => fact.value)).size > 1) assert.ok(facts.some((fact) => fact.current === true), field);
  });
});

test('F-e5d47ab7ea units: unresolvable history gets no marker and is reported', () => {
  const fact = (field, value, recorded_at) => ({ field, value, recorded_at });
  const resolved = markCurrentFacts([fact('dose', '5 mg', '2026-08-13T09:05:00Z'), fact('dose', '10 mg', '2026-09-10T09:05:00Z'), fact('status', 'active', '2026-08-13T09:00:00Z'), fact('status', 'active', '2026-09-10T09:00:00Z')]);
  assert.deepEqual(resolved.unresolved, []);
  assert.deepEqual(resolved.facts.map((item) => item.current), [false, true, false, true]);
  const tied = markCurrentFacts([fact('dose', '5 mg', '2026-08-13T09:05:00Z'), fact('dose', '10 mg', '2026-08-13T09:05:00Z')]);
  assert.deepEqual(tied.unresolved, ['dose']);
  assert.equal(tied.facts.some((item) => 'current' in item), false);
  const undated = markCurrentFacts([fact('dose', '5 mg', undefined), fact('dose', '10 mg', '2026-08-13T09:05:00Z')]);
  assert.deepEqual(undated.unresolved, ['dose']);
  assert.deepEqual(markCurrentFacts([fact('dose', '5 mg', undefined)]).facts.map((item) => item.current), [true]);
});

test('F-e5d47ab7ea: an unresolvable conflict qualifies the answer instead of passing silently', async () => {
  // fixture-patient-002 records two metformin doses at the same time.
  await withServer(19013, async (base) => {
    const body = await followUp(base, 'fixture-patient-002', 'List current medications and doses.');
    const doses = body.patient_facts.filter((fact) => fact.field === 'medication.metformin.dose');
    assert.deepEqual(doses.map((fact) => fact.value).sort(), ['1000 mg daily', '500 mg daily']);
    assert.equal(doses.some((fact) => 'current' in fact), false, 'a same-time conflict is not resolved by guessing');
    assert.equal(body.qualification.required, true);
    assert.ok(body.qualification.reasons.includes('field_history_unresolved:medication.metformin.dose'));
  });
});

test('F-ca9486ff1b: /v1/follow-up-evidence carries no provider, model, telemetry or datastore identifiers', async () => {
  await withServer(19014, async (base) => {
    const body = await followUp(base, 'fixture-patient-001', "Summarize this patient's current medications and the supporting guideline evidence.");
    const text = JSON.stringify(body).toLowerCase();
    for (const signature of DISCLOSURE_SIGNATURES) assert.equal(text.includes(signature), false, `leaked ${signature}`);
    // The clinical contract is intact: chart source and guideline status still reach the client.
    assert.equal(body.retrieval.chart_source, 'synthetic_fixture');
    assert.ok(typeof body.retrieval.guideline_status === 'string');
    assert.ok(Array.isArray(body.guideline_evidence) && body.guideline_evidence.length > 0);
  });
});

test('F-ca9486ff1b: /v1/scan-supervisor drops internal labels but keeps what the UI and the OpenEMR proof read', async () => {
  await withServer(19015, async (base) => {
    const write = await mintToken(base, '/v1/source-document-context', 'fixture-patient-001');
    const envelope = 'SYNTHETIC_SCAN_FORM|layout=pdf-ocr-lab_pdf|page_count=1\nFIELD|field_id=lab.a1c.test_name|label=A1C|value=A1C|unit=|quote=A1C|page=1|box=10,20,300,35|confidence=0.97\nFIELD|field_id=lab.a1c.value|label=A1C value|value=6.1|unit=%|quote=6.1|page=1|box=10,40,300,55|confidence=0.97';
    const upload = await (await post(base, '/v1/source-documents', { patient_uuid: 'fixture-patient-001', clinician_uuid: CLINICIAN, demo_token: write, document_type: 'lab_pdf', filename: 'lab.scan.txt', content_base64: Buffer.from(envelope).toString('base64') })).json();
    const response = await post(base, '/v1/scan-supervisor', { patient_uuid: 'fixture-patient-001', clinician_uuid: CLINICIAN, demo_token: write, source_document_id: upload.source_document.id, message: '' });
    assert.equal(response.status, 200);
    const body = await response.json();
    const text = JSON.stringify(body).toLowerCase();
    for (const signature of SCAN_SIGNATURES) assert.equal(text.includes(signature), false, `leaked ${signature}`);
    assert.equal(body.source_document.persistence_boundary, 'in-memory-synthetic', 'the simulation label stays');
    assert.ok(Array.isArray(body.workflow.handoffs) && body.workflow.handoffs.length > 0, 'the worker trail the UI shows is kept');
    assert.ok(body.workflow.typed_outputs.extraction.facts.length > 0);
    assert.equal(body.source_document.id, upload.source_document.id);
  });
});

test('F-ca9486ff1b units: only the named internal fields are removed, at any depth', () => {
  const evidence = { status: 'ready', retrieval: { guideline_provider: 'x', guideline_usage: [1], guideline_status: 'complete', chart_source: 'synthetic_fixture' } };
  assert.deepEqual(clientFollowUpEvidence(evidence).retrieval, { guideline_status: 'complete', chart_source: 'synthetic_fixture' });
  assert.ok('guideline_provider' in evidence.retrieval, 'the service result itself is not mutated');
  const scan = { workflow: { workflow_version: 'v', ocr_mode: 'psm3', final_state: 'READY' }, source_document: { id: 's', source_system: 'x', persistence_boundary: 'y', openemr: { document_id: 57, document_uuid: 'u' } }, openemr: { document_id: 57, derived_document_id: 58, document_uuid: 'u' } };
  assert.deepEqual(clientScanSupervisor(scan), { workflow: { final_state: 'READY' }, source_document: { id: 's', source_system: 'x', persistence_boundary: 'y', openemr: { document_id: 57 } }, openemr: { document_id: 57, derived_document_id: 58 } });
});

test('F-30da6790d1: every mint refuses an unprovisioned or malformed patient with the same 400, and still serves provisioned ones', async () => {
  await withServer(19016, async (base) => {
    for (const route of MINTS) {
      const refusals = [];
      for (const patient of ['fixture-patient-995', 'fixture-patient-009', 'fixture-patient-abc', 'someone-else', '']) {
        const response = await fetch(`${base}${route}?patient_uuid=${patient}`, DEMO_KEY_REQUEST);
        refusals.push([response.status, JSON.stringify(await response.json())]);
      }
      assert.deepEqual(new Set(refusals.map((refusal) => refusal.join(' '))).size, 1, `${route}: unknown and malformed ids are indistinguishable`);
      assert.equal(refusals[0][0], 400);
      assert.equal(JSON.parse(refusals[0][1]).error, 'invalid_synthetic_patient');
      assert.equal((await fetch(`${base}${route}?patient_uuid=fixture-patient-001`, DEMO_KEY_REQUEST)).status, 200, `${route} still serves a provisioned patient`);
    }
    assert.equal((await fetch(`${base}/v1/demo-context?patient_uuid=fixture-patient-dup`, DEMO_KEY_REQUEST)).status, 200, 'the duplicate-identity demo patient is provisioned');
  });
});

test('mint audit: every issued token logs route, scope, patient, client and correlation id; refusals and the token do not', async () => {
  const lines = [];
  const child = await startTestServer(19017);
  child.stdout.on('data', (chunk) => lines.push(...String(chunk).split(String.fromCharCode(10)).filter(Boolean)));
  try {
    const base = 'http://127.0.0.1:19017';
    const expected = [['/v1/demo-context', 'read-briefing'], ['/v1/source-document-context', 'write-source-document'], ['/v1/clinical-action-context', 'write-clinical-action']];
    const tokens = [];
    for (const [route] of expected) {
      const response = await fetch(`${base}${route}?patient_uuid=fixture-patient-001`, { headers: { ...DEMO_KEY_REQUEST.headers, 'x-correlation-id': 'abcdef0123456789' } });
      assert.equal(response.status, 200);
      tokens.push((await response.json()).demo_token);
    }
    assert.equal((await fetch(`${base}/v1/demo-context?patient_uuid=fixture-patient-995`, DEMO_KEY_REQUEST)).status, 400);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const audits = lines.filter((line) => line.startsWith('{') && line.includes('mint_issued')).map((line) => JSON.parse(line));
    assert.deepEqual(audits.map((audit) => [audit.route, audit.scope]), expected, 'one line per issuance, none for the refused id');
    for (const audit of audits) {
      assert.equal(audit.event, 'mint_issued');
      assert.equal(audit.patient_uuid, 'fixture-patient-001');
      assert.equal(audit.correlation_id, 'abcdef0123456789');
      assert.ok(typeof audit.client === 'string' && audit.client.length > 0, 'client address present');
      assert.ok(!Number.isNaN(Date.parse(audit.at)));
    }
    for (const token of tokens) assert.equal(lines.some((line) => line.includes(token)), false, 'the token is never logged');
  } finally { child.kill(); }
});

// Origin binding. Stops cross-origin BROWSER abuse only; a scripted client that omits or forges
// Origin still gets a token, so F-831d4df407 / F-24b44c5180 stay risk-accepted.
test('origin binding: a present Origin outside the allowlist is refused on every anonymous mint; absent or allowed Origin issues', async () => {
  const allowed = 'https://demo.example.test';
  await withServer(19018, async (base) => {
    for (const route of MINTS) {
      const mint = (origin) => fetch(`${base}${route}?patient_uuid=fixture-patient-001`, { headers: { ...DEMO_KEY_REQUEST.headers, ...(origin === undefined ? {} : { origin }) } });
      assert.equal((await mint(allowed)).status, 200, `${route} allowed origin`);
      assert.equal((await mint('https://DEMO.example.test/')).status, 200, `${route} origin compares case- and slash-insensitively`);
      assert.equal((await mint(undefined)).status, 200, `${route} absent origin (non-browser or same-origin GET)`);
      for (const bad of ['https://evil.example', 'null', 'http://demo.example.test', 'https://demo.example.test.evil.example']) {
        const refused = await mint(bad);
        assert.equal(refused.status, 403, `${route} origin ${bad}`);
        assert.deepEqual(await refused.json(), { error: 'mint_origin_not_allowed' }, 'no token in the refusal');
      }
    }
  }, { AGENTFORGE_DEMO_ALLOWED_ORIGINS: allowed });
});

test('origin binding: with no allowlist configured the check is off, and the data routes are not touched', async () => {
  await withServer(19019, async (base) => {
    assert.equal((await fetch(`${base}/v1/demo-context?patient_uuid=fixture-patient-001`, { headers: { ...DEMO_KEY_REQUEST.headers, origin: 'https://anything.example' } })).status, 200);
  });
  await withServer(19020, async (base) => {
    // Only the mints are bound: a foreign Origin on /health is unaffected.
    assert.equal((await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } })).status, 200);
  }, { AGENTFORGE_DEMO_ALLOWED_ORIGINS: 'https://demo.example.test' });
});

test('origin binding units: parsing and the decision rule', () => {
  assert.deepEqual(parseAllowedOrigins(' https://A.test/ , ,https://b.test '), ['https://a.test', 'https://b.test']);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.equal(originRefused(undefined, ['https://a.test']), false, 'absent: allowed');
  assert.equal(originRefused('https://x.test', []), false, 'empty list: off');
  assert.equal(originRefused('https://a.test', ['https://a.test']), false);
  assert.equal(originRefused('https://x.test', ['https://a.test']), true);
  assert.equal(originRefused('', ['https://a.test']), true, 'present but empty is not absent');
});
