import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { chartReadOrigin, chartRecordCitationSource } from '../src/chartSource.js';
import { verifyClaims } from '../src/claimBinding.js';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { OpenEMRRestAdapter } from '../src/openemrAdapter.js';
import { Citation, parseOrIssues } from '../src/schemas.js';
import { AgentForgeService } from '../src/service.js';
import { SyntheticWriteback } from '../src/syntheticWriteback.js';

// AGENTS.md: "Fixture data is not openemr-live." A chart fact read through the
// synthetic FixtureAdapter must never be cited as an OpenEMR record.
const fixturePath = fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url));
const SECRET = 'chart-citation-source-secret';
const context = (patient, scope = 'read-briefing') => verifySignedContext(issueSignedContext({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', scope, acl: scope === 'read-briefing' ? 'read' : 'write', secret: SECRET }), SECRET);

test('the chart source is decided by the adapter that read the record', () => {
  assert.equal(chartReadOrigin(new FixtureAdapter(fixturePath)), 'fixture');
  assert.equal(chartReadOrigin(new OpenEMRRestAdapter({ baseUrl: 'http://openemr.invalid' })), 'openemr');
  assert.equal(chartReadOrigin({ name: 'openemr-rest' }), 'fixture', 'a look-alike adapter is not OpenEMR');
  assert.deepEqual(chartRecordCitationSource(new OpenEMRRestAdapter({ baseUrl: 'http://openemr.invalid' })), { source_type: 'openemr_record', page_or_section: 'OpenEMR chart record' });
  assert.deepEqual(chartRecordCitationSource(new FixtureAdapter(fixturePath)), { source_type: 'synthetic_chart_fixture', page_or_section: 'Synthetic chart fixture' });
});

test('fixture chart facts are cited as synthetic fixture records, never openemr_record', async () => {
  const service = new AgentForgeService({ chartAdapter: new FixtureAdapter(fixturePath), writeback: new SyntheticWriteback(), provider: new DeterministicProvider() });
  const chart = await service.retrievePatientChartFacts('fixture-patient-001');
  assert.equal(chart.status, 'ready');
  assert.ok(chart.patient_facts.length > 0);
  for (const fact of chart.patient_facts) {
    assert.equal(fact.citation.source_type, 'synthetic_chart_fixture');
    assert.equal(fact.citation.page_or_section, 'Synthetic chart fixture');
    assert.equal(parseOrIssues(Citation, fact.citation).ok, true, 'the Citation schema accepts the fixture label');
  }
  assert.doesNotMatch(JSON.stringify(chart), /openemr_record|OpenEMR chart record/);
});

test('fixture chart facts stay patient-record facts, separate from guideline evidence', () => {
  const citation = { source_type: 'synthetic_chart_fixture', source_id: 'med-001', page_or_section: 'Synthetic chart fixture', field_or_chunk_id: 'medication.lisinopril.dose', quote_or_value: '10 mg daily' };
  const patientFact = verifyClaims({ claims: [{ kind: 'patient_fact', text: 'The chart records lisinopril dose as 10 mg daily.', citations: [citation] }], allowedValues: [citation] });
  assert.equal(patientFact.status, 'passed', JSON.stringify(patientFact.issues));
  const asGuideline = verifyClaims({ claims: [{ kind: 'guideline', text: 'The chart records lisinopril dose as 10 mg daily.', citations: [citation] }], allowedValues: [citation] });
  assert.equal(asGuideline.status, 'failed', 'a chart fixture record can never be cited as guideline evidence');
});

test('the grounded answer on the fixture chart never labels a chart fact openemr_record', async () => {
  const writeback = new SyntheticWriteback();
  const service = new AgentForgeService({ chartAdapter: new FixtureAdapter(fixturePath), writeback, provider: new DeterministicProvider() });
  const content = fs.readFileSync(fileURLToPath(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url)));
  const upload = await service.ingestSourceDocument({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', document_type: 'lab_pdf', filename: 'lab-a.pdf', content }, { verifiedContext: context('fixture-patient-001', 'write-source-document') });
  const result = await service.runActiveSupervisorForDocument(upload.source_document.id, { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context('fixture-patient-001'), query: 'documented medication and blood pressure' });
  const answer = result.workflow.answer;
  assert.ok(answer, 'the workflow produced an answer');
  const citations = [...(answer.patient_facts || []), ...(answer.guideline_evidence || [])].flatMap((claim) => claim.citations || []);
  assert.ok(citations.some((citation) => citation.source_type === 'synthetic_chart_fixture'), 'the answer cites at least one chart fact');
  assert.equal(citations.some((citation) => citation.source_type === 'openemr_record'), false);
  assert.ok((answer.guideline_evidence || []).every((claim) => claim.citations.every((citation) => citation.source_type === 'guideline')));
});

test('a chart record with no declared source type cannot back a patient fact', () => {
  const untyped = { field: 'medication.metformin.status', value: 'started', source_ref: 'med-900', recorded_at: '2026-09-01T10:00:00Z' };
  const citation = { source_type: 'openemr_record', source_id: 'med-900', page_or_section: 'medication list', field_or_chunk_id: 'medication.metformin.status', quote_or_value: 'started' };
  const result = verifyClaims({ claims: [{ kind: 'patient_fact', text: 'Metformin was started.', citations: [citation] }], allowedValues: [untyped] });
  assert.equal(result.status, 'failed', 'unknown origin is not silently treated as an OpenEMR record');
});
