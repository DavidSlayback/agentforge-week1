import { issueSignedContext, verifySignedContext } from '../accessContext.js';
import { ChartSourceRouter } from '../chartSourceRouter.js';
import { FixtureAdapter } from '../fixtureAdapter.js';
import { OpenEMRRestAdapter } from '../openemrAdapter.js';
import { defaultFixturePath } from '../service.js';

/**
 * E9 live chart reads: extension-suite cases for choosing the chart source
 * per request from the verified context (`chartSourceRouter.js`).
 *
 * The OpenEMR side is an honestly named fake: `scriptedFakeOpenEMRRest`
 * answers the REST routes `OpenEMRRestAdapter` reads with rows shaped like
 * those OpenEMR returned for the E9 seed on the local dev stack, plus one row
 * of another patient per overbroad route (value `LEAKED ...`). It is not
 * OpenEMR; these cases prove the routing, labeling and scoping wiring on the
 * deployed scan and briefing paths. The real REST read is observed on the
 * public URL (deploy/vultr/README.md, E9 runbook).
 */
const LIVE_PATIENT = '7b3f0c52-1d4e-4c8a-9f21-5a6b7c8d9e01';
const LIVE_PID = 42;
const OTHER_PATIENT = '0d9e8f7a-6b5c-4d3e-8f21-0a1b2c3d4e5f';
const LIVE_CLINICIAN = '6f1e2d3c-4b5a-4968-8776-655443322110';
const CASE_SECRET = 'extension-case-live-chart-secret';
const REST = '/apis/default/api/patient/';

const REST_ROWS = {
  [`${REST}${LIVE_PATIENT}`]: { data: { uuid: LIVE_PATIENT, pid: LIVE_PID, fname: 'Test', mname: '', lname: 'Patient One', DOB: '1980-04-12' } },
  [`${REST}${LIVE_PATIENT}/encounter`]: { data: [
    { euuid: 'enc-live-2', puuid: LIVE_PATIENT, pid: LIVE_PID, reason: 'blood-pressure follow-up', date: '2026-09-10 09:10:00' },
    { euuid: 'enc-leak', puuid: OTHER_PATIENT, pid: 99, reason: 'LEAKED other-patient encounter', date: '2026-09-11 09:00:00' },
  ] },
  [`${REST}${LIVE_PATIENT}/medical_problem`]: { data: [
    { uuid: 'prob-live-1', puuid: LIVE_PATIENT, pid: LIVE_PID, title: 'Hypertension', begdate: '2026-08-13', enddate: null, date: '2026-08-13 09:00:00' },
    { uuid: 'prob-leak', puuid: OTHER_PATIENT, pid: 99, title: 'LEAKED condition', begdate: '2026-01-01', enddate: null, date: '2026-01-01 09:00:00' },
  ] },
  [`${REST}${LIVE_PID}/medication`]: { data: [
    { uuid: 'med-live-2', pid: LIVE_PID, title: 'Lisinopril', begdate: '2026-09-10', enddate: null, date: '2026-09-10 09:05:00' },
    { uuid: 'med-leak', pid: 99, title: 'LEAKED medication', begdate: '2026-01-01', enddate: null, date: '2026-01-01 09:00:00' },
  ] },
  [`${REST}${LIVE_PATIENT}/allergy`]: { data: [
    { uuid: 'allergy-live-1', puuid: LIVE_PATIENT, pid: LIVE_PID, title: 'Penicillin', reaction_title: 'Hives', date: '2026-08-13 09:02:00' },
  ] },
};

/** Fake OpenEMR REST (see the module comment); `calls` counts every request. */
function scriptedFakeOpenEMRRest() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options?.method });
    const body = REST_ROWS[new URL(url).pathname];
    return body ? { ok: true, status: 200, async json() { return body; } } : { ok: false, status: 404, async json() { return {}; } };
  };
  return { calls, fetchImpl };
}

/** Per scenario: a fresh router and fake, reachable from the custom check through `run.h.service`. */
function routerOverrides(liveReads) {
  return () => {
    const rest = scriptedFakeOpenEMRRest();
    const liveAdapter = new OpenEMRRestAdapter({ baseUrl: 'http://openemr.gate', accessToken: 'gate-token', fetchImpl: rest.fetchImpl });
    const chartAdapter = new ChartSourceRouter({ fixtureAdapter: new FixtureAdapter(defaultFixturePath()), liveAdapter, liveReads });
    chartAdapter.gateFakeRest = rest;
    return { chartAdapter };
  };
}

const moduleContext = (scope) => verifySignedContext(issueSignedContext({ patient_uuid: LIVE_PATIENT, clinician_uuid: LIVE_CLINICIAN, scope, acl: scope === 'read-briefing' ? 'read' : 'write', issuer: 'openemr-module', authn: 'openemr-session', secret: CASE_SECRET }), CASE_SECRET);
const chartCitations = (answer) => (answer?.patient_facts || []).flatMap((claim) => claim.citations || []).filter((citation) => citation.source_type !== 'document');

/** Upload the case's golden document for the live patient from a module session and run the scan on it. */
async function moduleSessionScan(run) {
  const write = moduleContext('write-source-document');
  const stored = await run.h.service.ingestSourceDocument({ patient_uuid: LIVE_PATIENT, clinician_uuid: LIVE_CLINICIAN, document_type: 'lab_pdf', filename: `${run.docs[0].id}.pdf`, content: run.docs[0].content }, { verifiedContext: write });
  if (stored.status !== 'persisted') return { stored };
  return { stored, result: await run.h.service.runActiveSupervisorForDocument(stored.source_document.id, { patient_uuid: LIVE_PATIENT, clinician_uuid: LIVE_CLINICIAN }, { verifiedContext: write }) };
}

export const liveChartCaseChecks = {
  /** Synthetic demo context: fixture chart, labeled as such, and OpenEMR is never called. */
  async syntheticStaysFixture(run) {
    const issues = [];
    const rest = run.h.service.chartAdapter.gateFakeRest;
    if (run.result?.chart_source?.chart_source !== 'synthetic_fixture') issues.push(`synthetic_scan_chart_source:${run.result?.chart_source?.chart_source}`);
    const citations = chartCitations(run.result?.workflow?.answer);
    if (!citations.length) issues.push('synthetic_scan_no_chart_facts');
    if (citations.some((citation) => citation.source_type !== 'synthetic_chart_fixture')) issues.push('fixture_fact_not_labeled_synthetic');
    if (rest.calls.length) issues.push(`synthetic_context_reached_openemr:${rest.calls.length}`);
    return issues;
  },
  /** Module session with live reads on: REST chart, openemr_record citations, other-patient rows dropped. */
  async moduleSessionReadsOpenEMR(run) {
    const issues = [];
    const rest = run.h.service.chartAdapter.gateFakeRest;
    const { stored, result } = await moduleSessionScan(run);
    if (!result) return [`module_upload_failed:${stored.reason || stored.status}`];
    if (result.status !== 'completed') return [`module_scan_not_completed:${result.reason || result.status}`];
    if (result.chart_source?.chart_source !== 'openemr_live' || result.chart_source?.status !== 'read') issues.push(`module_scan_chart_source:${result.chart_source?.chart_source}:${result.chart_source?.status}`);
    const citations = chartCitations(result.workflow?.answer);
    if (citations.length < 4) issues.push(`module_scan_chart_facts:${citations.length}`);
    if (citations.some((citation) => citation.source_type !== 'openemr_record')) issues.push('openemr_fact_not_labeled_openemr_record');
    if (JSON.stringify(result).includes('LEAKED')) issues.push('other_patient_row_in_answer');
    if (!rest.calls.length || rest.calls.some((call) => call.method !== 'GET')) issues.push('openemr_not_read_with_get');
    const briefing = await run.h.service.prepare({ patient_uuid: LIVE_PATIENT, clinician_uuid: LIVE_CLINICIAN }, { verifiedContext: moduleContext('read-briefing') });
    if (briefing.operations?.[0]?.operation !== 'retrieve_openemr_read') issues.push(`module_briefing_operation:${briefing.operations?.[0]?.operation}`);
    return issues;
  },
  /** Module session with live reads off: refused with the reason, never served from fixtures. */
  async liveReadsOffRefuses(run) {
    const issues = [];
    const rest = run.h.service.chartAdapter.gateFakeRest;
    const { stored, result } = await moduleSessionScan(run);
    if (!result) return [`module_upload_failed:${stored.reason || stored.status}`];
    if (result.status !== 'blocked' || result.reason !== 'openemr_live_reads_disabled') issues.push(`live_off_scan_not_refused:${result.status}:${result.reason || result.chart_source?.chart_source}`);
    const briefing = await run.h.service.prepare({ patient_uuid: 'fixture-patient-001', clinician_uuid: LIVE_CLINICIAN }, { verifiedContext: verifySignedContext(issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: LIVE_CLINICIAN, issuer: 'openemr-module', authn: 'openemr-session', secret: CASE_SECRET }), CASE_SECRET) });
    if (briefing.disposition !== 'blocked' || briefing.qualification?.reasons?.[0] !== 'openemr_live_reads_disabled') issues.push(`live_off_briefing_not_refused:${briefing.disposition}`);
    if (briefing.claims?.length) issues.push('live_off_briefing_served_fixture_claims');
    if (rest.calls.length) issues.push('live_off_reached_openemr');
    return issues;
  },
  /**
   * Only verified provenance selects the source: copied claims naming the
   * module issuer select nothing, and a synthetic-demo token naming an OpenEMR
   * patient uuid still reads fixtures (the id's shape decides nothing).
   */
  async provenanceNotData(run) {
    const issues = [];
    const syntheticForUuid = verifySignedContext(issueSignedContext({ patient_uuid: LIVE_PATIENT, clinician_uuid: LIVE_CLINICIAN, issuer: 'synthetic-demo', authn: 'synthetic', secret: CASE_SECRET }), CASE_SECRET);
    const fixtureRead = await run.h.service.prepare({ patient_uuid: LIVE_PATIENT, clinician_uuid: LIVE_CLINICIAN }, { verifiedContext: syntheticForUuid }).then((result) => result.operations?.[0]?.operation || result.disposition, (error) => error.message);
    if (fixtureRead !== 'PATIENT_NOT_FOUND') issues.push(`synthetic_token_for_uuid_patient:${fixtureRead}`);
    const copied = { ...moduleContext('read-briefing') };
    const briefing = await run.h.service.prepare({ patient_uuid: LIVE_PATIENT, clinician_uuid: LIVE_CLINICIAN }, { verifiedContext: copied });
    if (briefing.disposition !== 'blocked') issues.push(`copied_claims_briefing:${briefing.disposition}`);
    const scan = await run.h.service.runActiveSupervisorForDocument(run.sourceIds[0], { patient_uuid: run.patient, clinician_uuid: run.clinician }, { verifiedContext: { ...run.h.context(run.patient), issuer: 'openemr-module', authn: 'openemr-session' } });
    if (scan.status !== 'blocked') issues.push(`copied_claims_scan:${scan.status}:${scan.chart_source?.chart_source}`);
    if (run.h.service.chartAdapter.gateFakeRest.calls.length) issues.push('unverified_or_synthetic_claims_reached_openemr');
    return issues;
  },
};

export function liveChartCases({ kase, scan }) {
  return [
    kase('x9-live-chart-synthetic-context-fixture', 'citation_present', 'A synthetic-demo scan with live reads on reaches OpenEMR, or its chart facts are cited as openemr_record / labeled anything but synthetic_fixture.', scan('lab-a', 'lab_pdf', { service_overrides: routerOverrides(true) }), { custom: (run) => liveChartCaseChecks.syntheticStaysFixture(run) }),
    kase('x9-live-chart-module-session-openemr', 'citation_present', 'A module-session scan does not read the chart through OpenEMR REST, its chart citations are not openemr_record, its chart_source is not openemr_live, or another patient\'s row reaches the answer.', scan('lab-a', 'lab_pdf', { service_overrides: routerOverrides(true) }), { custom: (run) => liveChartCaseChecks.moduleSessionReadsOpenEMR(run) }),
    kase('x9-live-chart-live-off-no-fallback', 'safe_refusal', 'With AGENTFORGE_OPENEMR_LIVE_READS off, a module-session scan or briefing is served from the fixture chart (a silent fallback) instead of being refused with openemr_live_reads_disabled.', scan('lab-a', 'lab_pdf', { service_overrides: routerOverrides(false) }), { custom: (run) => liveChartCaseChecks.liveReadsOffRefuses(run) }),
    kase('x9-live-chart-provenance-not-data', 'safe_refusal', 'Something other than the verified issuer picks the chart: claims copied into a plain object (as a request body could carry them) select a source, or a synthetic-demo token that names an OpenEMR patient uuid reads OpenEMR.', scan('lab-a', 'lab_pdf', { service_overrides: routerOverrides(true) }), { custom: (run) => liveChartCaseChecks.provenanceNotData(run) }),
  ];
}
