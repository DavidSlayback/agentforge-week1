import test from 'node:test';
import assert from 'node:assert/strict';
import { ChartSourceRouter, describeLaunchChartSource, parseLiveReads, resolveChartAdapter, selectChartSource } from '../src/chartSourceRouter.js';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { OpenEMRRestAdapter } from '../src/openemrAdapter.js';
import { AgentForgeService, defaultFixturePath } from '../src/service.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { renderAgentForgePage } from '../src/ui.js';
import { fakeOpenEMRRestFetch, LIVE_PATIENT, OTHER_PATIENT } from './helpers/fakeOpenemrRest.js';

const secret = 'synthetic-router-secret';
const CLINICIAN_UUID = '6f1e2d3c-4b5a-4968-8776-655443322110';

const moduleContext = (patient = LIVE_PATIENT, scope = 'read-briefing') => verifySignedContext(issueSignedContext({ patient_uuid: patient, clinician_uuid: CLINICIAN_UUID, scope, acl: scope === 'read-briefing' ? 'read' : 'write', issuer: 'openemr-module', authn: 'openemr-session', secret }), secret);
const syntheticContext = (patient = 'fixture-patient-001') => verifySignedContext(issueSignedContext({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', issuer: 'synthetic-demo', authn: 'synthetic', secret }), secret);

function makeRouter({ liveReads = true, requests = [], variant = {} } = {}) {
  const fixtureAdapter = new FixtureAdapter(defaultFixturePath());
  const liveAdapter = new OpenEMRRestAdapter({ baseUrl: 'http://openemr.test', accessToken: 'synthetic-token', fetchImpl: fakeOpenEMRRestFetch(requests, variant) });
  return { router: new ChartSourceRouter({ fixtureAdapter, liveAdapter, liveReads }), fixtureAdapter, liveAdapter, requests };
}

function makeService(router) {
  return new AgentForgeService({ chartAdapter: router, provider: new DeterministicProvider() });
}

test('parseLiveReads: default off, on/off accepted, anything else refuses to start', () => {
  assert.equal(parseLiveReads(undefined), false);
  assert.equal(parseLiveReads(''), false);
  assert.equal(parseLiveReads('off'), false);
  assert.equal(parseLiveReads('ON'), true);
  assert.throws(() => parseLiveReads('true'), /AGENTFORGE_OPENEMR_LIVE_READS_INVALID/);
  assert.throws(() => parseLiveReads('yes'), /AGENTFORGE_OPENEMR_LIVE_READS_INVALID/);
});

test('router: an openemr-session context reads through the REST adapter; a synthetic-demo context reads fixtures', () => {
  const { router, fixtureAdapter, liveAdapter } = makeRouter();
  assert.equal(resolveChartAdapter(router, moduleContext()), liveAdapter);
  assert.equal(resolveChartAdapter(router, syntheticContext()), fixtureAdapter);
  const live = router.authorize({ patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID }, moduleContext());
  assert.equal(live.status, 'authorized');
  assert.equal(live.chart_source, 'openemr_live');
  const synthetic = router.authorize({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, syntheticContext());
  assert.equal(synthetic.status, 'authorized');
  assert.equal(synthetic.chart_source, 'synthetic_fixture');
});

test('router: live reads off refuses an openemr-session context loudly and never falls back to fixtures', () => {
  const { router } = makeRouter({ liveReads: false });
  const context = moduleContext('fixture-patient-001');
  const result = router.authorize({ patient_uuid: 'fixture-patient-001', clinician_uuid: CLINICIAN_UUID }, context);
  assert.deepEqual(result, { status: 'blocked', reason: 'openemr_live_reads_disabled' });
  assert.throws(() => resolveChartAdapter(router, context), /OPENEMR_LIVE_READS_DISABLED/);
  assert.equal(selectChartSource(router, context).status, 'blocked');
  assert.throws(() => new ChartSourceRouter({ fixtureAdapter: new FixtureAdapter(defaultFixturePath()), liveAdapter: null, liveReads: true }), /CHART_SOURCE_LIVE_ADAPTER_REQUIRED/);
});

test('router: spoofed and tampered claims are refused; only the HMAC-verified context decides', () => {
  const { router } = makeRouter();
  const request = { patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID };
  // A copy of verified claims (for example parsed from a request body) is not a verified context.
  assert.equal(router.authorize(request, { ...moduleContext() }).reason, 'server_context_missing_or_invalid');
  assert.equal(router.authorize(request, { patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID, scope: 'read-briefing', issuer: 'openemr-module', authn: 'openemr-session', role: 'clinician', acl: 'read', expires_at: Math.floor(Date.now() / 1000) + 60 }).reason, 'server_context_missing_or_invalid');
  // Re-signing a synthetic token's payload as openemr-module without the secret breaks the HMAC.
  const synthetic = issueSignedContext({ patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID, issuer: 'synthetic-demo', authn: 'synthetic', secret });
  const [encoded, signature] = synthetic.split('.');
  const forged = Buffer.from(Buffer.from(encoded, 'base64url').toString('utf8').replace('synthetic-demo', 'openemr-module').replace('"synthetic"', '"openemr-session"')).toString('base64url');
  assert.equal(verifySignedContext(`${forged}.${signature}`, secret), null);
  assert.equal(router.authorize(request, verifySignedContext(`${forged}.${signature}`, secret)).reason, 'server_context_missing_or_invalid');
  // Request fields never select the source: a synthetic context stays on fixtures.
  const spoofed = router.authorize({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', chart_source: 'openemr_live', issuer: 'openemr-module', authn: 'openemr-session' }, syntheticContext());
  assert.equal(spoofed.chart_source, 'synthetic_fixture');
  // Mixed or unknown claims select nothing.
  const mixed = verifySignedContext(issueSignedContext({ patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID, issuer: 'openemr-module', authn: 'synthetic', secret }), secret);
  assert.equal(router.authorize(request, mixed).reason, 'chart_source_issuer_unsupported');
});

test('router: the patient id decides nothing; a synthetic-demo token naming an OpenEMR uuid still reads fixtures', async () => {
  const requests = [];
  const { router, fixtureAdapter } = makeRouter({ requests });
  const context = syntheticContext(LIVE_PATIENT);
  assert.equal(resolveChartAdapter(router, context), fixtureAdapter);
  await assert.rejects(makeService(router).prepare({ patient_uuid: LIVE_PATIENT, clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context }), /PATIENT_NOT_FOUND/);
  assert.equal(requests.length, 0, 'a synthetic token never reaches OpenEMR');
});

test('scan: a token without a chart-read scope never picks or reads the live chart', async () => {
  const requests = [];
  const { router } = makeRouter({ requests });
  const service = makeService(router);
  const actionContext = verifySignedContext(issueSignedContext({ patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID, scope: 'write-clinical-action', acl: 'write', issuer: 'openemr-module', authn: 'openemr-session', secret }), secret);
  const result = await service.runActiveSupervisorForDocument('openemr-doc-1', { patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID }, { verifiedContext: actionContext });
  assert.deepEqual(result, { status: 'blocked', reason: 'chart_read_scope_invalid' });
  const otherPatient = await service.runActiveSupervisorForDocument('openemr-doc-1', { patient_uuid: OTHER_PATIENT, clinician_uuid: CLINICIAN_UUID }, { verifiedContext: moduleContext() });
  assert.equal(otherPatient.status, 'blocked');
  assert.equal(requests.length, 0);
});

test('egress: approval alone is not enough; the verified patient must be designated', async () => {
  const { liveEgressAllowed } = await import('../src/chartSourceRouter.js');
  const allow = new Set([LIVE_PATIENT]);
  assert.equal(liveEgressAllowed({ approved: true, livePatientAllowlist: allow }, LIVE_PATIENT), true);
  assert.equal(liveEgressAllowed({ approved: true, livePatientAllowlist: allow }, LIVE_PATIENT.toUpperCase()), true);
  assert.equal(liveEgressAllowed({ approved: true, livePatientAllowlist: allow }, OTHER_PATIENT), false);
  assert.equal(liveEgressAllowed({ approved: false, livePatientAllowlist: allow }, LIVE_PATIENT), false);
  assert.equal(liveEgressAllowed({ approved: true, livePatientAllowlist: new Set() }, LIVE_PATIENT), false);
  assert.equal(liveEgressAllowed({ approved: true }, LIVE_PATIENT), false);
});

test('router: reading without resolving the request adapter fails loudly', () => {
  const { router } = makeRouter();
  assert.throws(() => router.getCase(LIVE_PATIENT), /CHART_SOURCE_CONTEXT_REQUIRED/);
  assert.throws(() => router.retrieve({}), /CHART_SOURCE_CONTEXT_REQUIRED/);
});

test('briefing: operations and trace name the source; a live briefing reads REST with GET only', async () => {
  const requests = [];
  const { router } = makeRouter({ requests });
  const service = makeService(router);
  const live = await service.prepare({ patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID }, { verifiedContext: moduleContext() });
  assert.deepEqual(live.operations, [{ type: 'read', operation: 'retrieve_openemr_read' }]);
  assert.ok(live.claims.some((claim) => claim.field === 'encounter.reason' && claim.value === 'blood-pressure follow-up'));
  assert.equal(JSON.stringify(live).includes('LEAKED'), false, 'rows of another patient are dropped');
  assert.ok(requests.length > 0 && requests.every(({ options }) => options.method === 'GET'));
  const synthetic = await service.prepare({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, { verifiedContext: syntheticContext() });
  assert.deepEqual(synthetic.operations, [{ type: 'read', operation: 'retrieve_synthetic_fixture_read' }]);
});

test('briefing: live reads off gives a blocked briefing with the reason, never fixture content', async () => {
  const { router } = makeRouter({ liveReads: false });
  const result = await makeService(router).prepare({ patient_uuid: 'fixture-patient-001', clinician_uuid: CLINICIAN_UUID }, { verifiedContext: moduleContext('fixture-patient-001') });
  assert.equal(result.disposition, 'blocked');
  assert.deepEqual(result.qualification.reasons, ['openemr_live_reads_disabled']);
  assert.equal(result.patient, null);
  assert.deepEqual(result.claims, []);
});

test('chart facts: live reads cite openemr_record and drop other-patient rows; fixtures cite synthetic_chart_fixture', async () => {
  const { router } = makeRouter();
  const service = makeService(router);
  const live = await service.retrieveFollowUpEvidence({ patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID, message: 'blood pressure' }, { verifiedContext: moduleContext() });
  assert.equal(live.status, 'ready');
  assert.equal(live.retrieval.chart_source, 'openemr_live');
  assert.ok(live.patient_facts.length >= 4);
  assert.ok(live.patient_facts.every((fact) => fact.citation?.source_type === 'openemr_record'));
  assert.equal(live.patient_facts.some((fact) => [OTHER_PATIENT, 'prob-leak', 'med-leak', 'enc-leak'].includes(fact.source_id) || String(fact.value).includes('LEAKED')), false);
  assert.ok(live.patient_facts.some((fact) => fact.field === 'allergy.penicillin' && fact.value === 'Hives'), 'a coded reaction maps to its readable title');
  assert.ok(live.patient_facts.some((fact) => fact.field === 'problem.hypertension.status' && fact.value === 'active'));
  const synthetic = await service.retrieveFollowUpEvidence({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message: 'blood pressure' }, { verifiedContext: syntheticContext() });
  assert.equal(synthetic.retrieval.chart_source, 'synthetic_fixture');
  assert.ok(synthetic.patient_facts.length > 0 && synthetic.patient_facts.every((fact) => fact.citation?.source_type === 'synthetic_chart_fixture'));
});

test('launch label: the page says which chart source the verified launch selects', () => {
  const { router } = makeRouter();
  const { router: offRouter } = makeRouter({ liveReads: false });
  assert.equal(describeLaunchChartSource(router, moduleContext()).label, 'OpenEMR (live)');
  assert.equal(describeLaunchChartSource(offRouter, moduleContext()).label, 'unavailable (OpenEMR live reads are off)');
  assert.equal(describeLaunchChartSource(router, syntheticContext()).label, 'synthetic fixture');
  const livePage = renderAgentForgePage({ token: 't', payload: moduleContext(), writeToken: 'w', chartSource: describeLaunchChartSource(router, moduleContext()) });
  assert.match(livePage, /id="chart-source" data-chart-source="openemr_live">Chart source: OpenEMR \(live\)</);
  // A module launch never asks the synthetic demo endpoints for its tokens.
  assert.match(livePage, /if \(!true\) \{\s+token = \(await mintContext\('\/v1\/demo-context'/);
  // ...and so shows no evaluator access-code field (W3); the demo page does.
  assert.doesNotMatch(livePage, /<form id="access-form">/);
  assert.match(renderAgentForgePage({}), /<form id="access-form">/);
  assert.match(livePage, /writeToken: "w"/);
  const demoPage = renderAgentForgePage({});
  assert.match(demoPage, /Chart source: synthetic fixture</);
  assert.match(demoPage, /writeToken: ""/);
});

test('launch vector: a token minted by the PHP launcher verifies in Node with openemr-session claims', () => {
  // Same vector as oe-module-agentforge/tests/run.php (LaunchTokenMinter).
  const token = 'eyJwYXRpZW50X3V1aWQiOiJhMmMzN2Y3Zi0xMDc2LTQxNzItYjE3YS1iZWU4YmI4ZDJkYTYiLCJjbGluaWNpYW5fdXVpZCI6IjZmMWUyZDNjLTRiNWEtNDk2OC04Nzc2LTY1NTQ0MzMyMjExMCIsInNjb3BlIjoid3JpdGUtc291cmNlLWRvY3VtZW50IiwiaXNzdWVyIjoib3BlbmVtci1tb2R1bGUiLCJhdXRobiI6Im9wZW5lbXItc2Vzc2lvbiIsInJvbGUiOiJjbGluaWNpYW4iLCJhY2wiOiJ3cml0ZSIsImV4cGlyZXNfYXQiOjE3OTAwMDAyODB9.yr7Os9mQ3I_ACdI8E3N6LV0l44pTFn4yZvKamK4d6bc';
  const context = verifySignedContext(token, 'launch-vector-secret', () => 1790000000);
  assert.ok(context);
  assert.deepEqual([context.issuer, context.authn, context.scope, context.acl, context.patient_uuid], ['openemr-module', 'openemr-session', 'write-source-document', 'write', 'a2c37f7f-1076-4172-b17a-bee8bb8d2da6']);
  assert.equal(verifySignedContext(token, 'another-secret', () => 1790000000), null);
});


test('E9b: an empty patient-scoped problem or allergy list from OpenEMR is unconfirmed, never "no documented problems"', async () => {
  const { router } = makeRouter({ variant: { emptyScopedLists: true } });
  const service = makeService(router);
  const briefing = await service.prepare({ patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID }, { verifiedContext: moduleContext() });
  const status = Object.fromEntries(briefing.coverage.map((group) => [group.group, [group.status, group.error_class]]));
  assert.deepEqual(status.problems, ['unverified_empty', 'openemr_scoped_list_empty']);
  assert.deepEqual(status.allergies, ['unverified_empty', 'openemr_scoped_list_empty']);
  // `partial`, not `qualified`, here only because the fake's notes route fails (as on production).
  assert.ok(['qualified', 'partial'].includes(briefing.disposition), briefing.disposition);
  assert.equal(briefing.qualification.required, true);
  assert.ok(briefing.qualification.reasons.includes('problems:unverified_empty') && briefing.qualification.reasons.includes('allergies:unverified_empty'));
  assert.ok(briefing.withheld_fields.includes('problems') && briefing.withheld_fields.includes('allergies'));
  assert.equal(briefing.claims.some((claim) => claim.field.startsWith('problem.') || claim.field.startsWith('allergy.')), false);
  assert.ok(briefing.claims.some((claim) => claim.field.startsWith('medication.')), 'medications still read');
  assert.doesNotMatch(JSON.stringify(briefing), /no (documented |known )?(problems|allergies)/i);
  const evidence = await service.retrieveFollowUpEvidence({ patient_uuid: LIVE_PATIENT, clinician_uuid: CLINICIAN_UUID, message: 'blood pressure' }, { verifiedContext: moduleContext() });
  assert.equal(evidence.qualification.required, true);
  assert.ok(evidence.qualification.reasons.includes('patient_problems_unavailable') && evidence.qualification.reasons.includes('patient_allergies_unavailable'));
});

test('E9b: a list route that returns only other patients\' rows is unconfirmed too, on the live path', async () => {
  const { router } = makeRouter({ variant: { otherPatientsOnly: true } });
  const chart = await makeService(router).retrievePatientChartFacts(LIVE_PATIENT, null, { verifiedContext: moduleContext() });
  assert.deepEqual(chart.unconfirmed_patient_groups, ['problems', 'allergies']);
  assert.equal(chart.coverage.find((group) => group.group === 'problems').error_class, 'openemr_rows_for_other_patients_only');
});

test('E9b: the fixture path is unchanged (an empty fixture group stays empty)', async () => {
  const { router } = makeRouter();
  const briefing = await makeService(router).prepare({ patient_uuid: 'fixture-patient-007', clinician_uuid: 'fixture-physician-001' }, { verifiedContext: syntheticContext('fixture-patient-007') });
  assert.equal(briefing.coverage.some((group) => group.status === 'unverified_empty'), false);
});
