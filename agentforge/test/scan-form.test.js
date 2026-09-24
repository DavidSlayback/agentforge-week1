import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractScanForm } from '../src/scanFormAdapter.js';
import { REQUIRED_SCAN_FIELDS, SCAN_FORM_CONTRACT_VERSION, validateActiveSupervisorRequest, validateScanExtraction } from '../src/scanFormContracts.js';
import { formulateEvidenceQuery, runEvidenceWorker, runExtractionWorker } from '../src/activeWorkers.js';
import { runActiveSupervisor } from '../src/supervisor.js';

const fixture = (name) => fs.readFileSync(fileURLToPath(new URL(`../../docs/agentforge/fixtures/scan-forms/${name}`, import.meta.url)));

test('scan-form adapter extracts cited complete lab fields under the frozen contract', () => {
  const result = extractScanForm({ sourceDocumentId: 'src-lab-a', documentType: 'lab_pdf', layoutId: 'lab-a', content: fixture('lab-layout-a-complete.scan.txt') });
  assert.equal(result.contract_version, SCAN_FORM_CONTRACT_VERSION);
  // This legacy fixture layout's flat `lab.hgb`/`lab.a1c` ids carry no
  // collection_date/abnormal_flag data, so they cannot be typed into a
  // LabResult; the untyped facts are all still present and cited, but the
  // status is `qualified` (not `complete`) because the typed contract came
  // out empty rather than clean.
  assert.equal(result.status, 'qualified');
  assert.equal(result.lab_results.length, 0);
  // A fact that cannot be typed is never silently dropped: it shows up as
  // its own typed_issue instead of leaving an empty lab_results[] unexplained.
  assert.ok(result.typed_issues.includes('fact_not_mapped_to_typed_output:lab.hgb'));
  assert.ok(result.typed_issues.includes('fact_not_mapped_to_typed_output:lab.a1c'));
  assert.deepEqual(result.facts.map((fact) => fact.field_id), REQUIRED_SCAN_FIELDS.lab_pdf);
  assert.ok(result.facts.every((fact) => fact.citation.source_id === 'src-lab-a' && fact.citation.bounding_box.length === 4));
  assert.equal(validateScanExtraction(result, { sourceDocumentId: 'src-lab-a', documentType: 'lab_pdf' }).valid, true);
});

test('intake fixture per-item medication/allergy ids are mapped into the typed IntakeForm, not silently dropped', () => {
  const result = extractScanForm({ sourceDocumentId: 'src-intake-a', documentType: 'intake_form', layoutId: 'intake-a', content: fixture('intake-layout-a-complete.scan.txt') });
  // `medication.metformin` and `allergy.penicillin` (the non-PDF-OCR fixture
  // vocabulary) are per-item facts, not the combined `medications`/
  // `allergies` field the PDF-OCR layout emits; they must still populate the
  // typed IntakeForm rather than leaving it looking like "no medications".
  assert.equal(result.status, 'complete');
  assert.equal(result.typed_issues.length, 0);
  assert.equal(result.intake_form.current_medications.length, 1);
  assert.equal(result.intake_form.current_medications[0].value, 'Metformin 500 mg daily');
  assert.equal(result.intake_form.allergies.length, 1);
  assert.equal(result.intake_form.allergies[0].value, 'Penicillin');
  assert.equal(result.intake_form.chief_concern.value, 'Fatigue for two weeks');
});

test('scan-form adapter qualifies missing, unreadable, and conflicting values', () => {
  const partial = extractScanForm({ sourceDocumentId: 'src-lab-b', documentType: 'lab_pdf', layoutId: 'lab-b', content: fixture('lab-layout-b-partial.scan.txt') });
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.missing_fields.map((item) => item.field_id), ['lab.a1c']);
  const unreadable = extractScanForm({ sourceDocumentId: 'src-lab-u', documentType: 'lab_pdf', layoutId: 'lab-b', content: fixture('lab-layout-b-unreadable.scan.txt') });
  assert.equal(unreadable.status, 'qualified');
  assert.ok(unreadable.uncertain_fields.length >= 2);
  const conflict = extractScanForm({ sourceDocumentId: 'src-intake-c', documentType: 'intake_form', layoutId: 'intake-b', content: fixture('intake-layout-b-conflict.scan.txt') });
  assert.equal(conflict.status, 'qualified');
  assert.ok(conflict.conflicts.some((item) => item.field_id === 'medication.metformin'));
  assert.equal(conflict.facts.some((fact) => fact.field_id === 'medication.metformin'), false);
});

test('active workers expose inspect-act-qualify handoffs and never promote empty evidence', async () => {
  const extraction = runExtractionWorker({ sourceDocumentId: 'src-lab-a', documentType: 'lab_pdf', layoutId: 'lab-a', content: fixture('lab-layout-a-complete.scan.txt') });
  // See the equivalent assertion above: this fixture's flat lab ids cannot
  // build a typed LabResult, so the worker's output is qualified.
  assert.equal(extraction.output_status, 'qualified');
  assert.deepEqual(extraction.steps.map((step) => step.name), ['inspect', 'extract', 'validate_or_qualify']);
  assert.equal(JSON.stringify(extraction.redacted_metrics).includes('13.2'), false);
  const evidence = await runEvidenceWorker({ clinicianQuestion: '' });
  assert.equal(evidence.output_status, 'qualified');
  assert.equal(evidence.guideline_evidence.length, 0);
});

test('evidence worker awaits an async retriever instead of silently qualifying its Promise', async () => {
  const citation = { source_type: 'guideline', source_id: 'guideline-async-1', page_or_section: 'Async review', quote_or_value: 'Asynchronous retrieval evidence.' };
  const asyncRetriever = async (query, { topK } = {}) => {
    assert.equal(query, 'async guideline lookup');
    assert.equal(topK, 3);
    return { status: 'complete', provider: 'async-fake-retriever', evidence: [{ citation }], issues: [] };
  };
  const evidence = await runEvidenceWorker({ clinicianQuestion: 'async guideline lookup', retrieve: asyncRetriever });
  assert.equal(evidence.output_status, 'ready');
  assert.equal(evidence.guideline_evidence.length, 1);
  assert.deepEqual(evidence.guideline_evidence[0].citation, citation);
  assert.equal(evidence.qualification.required, false);
  assert.equal(evidence.provider, 'async-fake-retriever');
});

test('evidence worker turns a rejecting retriever into a qualified result with an error code, not raw error text', async () => {
  const rejecting = async () => { throw new Error('boom: leaking a connection string or stack trace here would be a PHI/secret risk'); };
  const evidence = await runEvidenceWorker({ clinicianQuestion: 'async guideline lookup', retrieve: rejecting });
  assert.equal(evidence.output_status, 'qualified');
  assert.equal(evidence.guideline_evidence.length, 0);
  assert.deepEqual(evidence.qualification.reasons, ['guideline_retrieval_failed']);
  assert.equal(JSON.stringify(evidence).includes('boom'), false);
});

test('active supervisor keeps worker handoffs inspectable and qualifies incomplete evidence', async () => {
  const ready = await runActiveSupervisor({ sourceDocumentId: 'src-lab-a', documentType: 'lab_pdf', layoutId: 'lab-a', content: fixture('lab-layout-a-complete.scan.txt'), query: 'documented glycemic values medication adherence' });
  // The flat lab.hgb/lab.a1c fixture ids cannot be typed into LabResult, and the
  // text envelope prints no patient header, so the workflow may not claim READY.
  assert.equal(ready.final_state, 'QUALIFIED');
  assert.deepEqual(ready.qualification.reasons, ['patient_identity_unverified', 'extraction_incomplete']);
  assert.equal(ready.typed_outputs.evidence.output_status, 'ready');
  assert.equal(ready.handoffs.length, 2);
  assert.equal(ready.handoffs[0].worker, 'scan-form-extraction-worker');
  const qualified = await runActiveSupervisor({ sourceDocumentId: 'src-lab-b', documentType: 'lab_pdf', layoutId: 'lab-b', content: fixture('lab-layout-b-partial.scan.txt'), query: '' });
  assert.equal(qualified.readiness, 'qualified');
  assert.equal(qualified.final_state, 'QUALIFIED');
});

test('active supervisor retrieves through an injected retrievalAdapter instead of the hard-wired default', async () => {
  const citation = { source_type: 'guideline', source_id: 'guideline-injected-1', page_or_section: 'Injected review', quote_or_value: 'Evidence from the injected retriever.' };
  const injected = { name: 'injected-fake-retriever', retrieve: async () => ({ status: 'complete', evidence: [{ citation }], issues: [] }) };
  const result = await runActiveSupervisor({ sourceDocumentId: 'src-lab-a', documentType: 'lab_pdf', layoutId: 'lab-a', content: fixture('lab-layout-a-complete.scan.txt'), query: 'documented glycemic values medication adherence', retrievalAdapter: injected });
  assert.deepEqual(result.typed_outputs.evidence.guideline_evidence.map((item) => item.citation), [citation]);
  assert.equal(result.typed_outputs.evidence.output_status, 'ready');
});

test('active supervisor takes the retrieval provider label from the injected retriever, not a constant', async () => {
  const namedRetriever = { name: 'test-named-retriever', retrieve: async () => ({ status: 'complete', evidence: [], issues: [] }) };
  const events = [];
  const observer = {
    startStage() {}, finishStage() {}, setExtraction() {},
    recordRetrievalAttempt(attempt) { events.push(attempt); },
  };
  await runActiveSupervisor({ sourceDocumentId: 'src-lab-a', documentType: 'lab_pdf', layoutId: 'lab-a', content: fixture('lab-layout-a-complete.scan.txt'), query: 'documented glycemic values medication adherence', retrievalAdapter: namedRetriever, observer });
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, 'test-named-retriever');
  const defaulted = [];
  await runActiveSupervisor({ sourceDocumentId: 'src-lab-a', documentType: 'lab_pdf', layoutId: 'lab-a', content: fixture('lab-layout-a-complete.scan.txt'), query: 'documented glycemic values medication adherence', observer: { startStage() {}, finishStage() {}, setExtraction() {}, recordRetrievalAttempt: (attempt) => defaulted.push(attempt) } });
  assert.equal(defaulted[0].provider, 'bm25-sparse-only');
});


test('active-supervisor request validation makes message optional but still type-checked', () => {
  const base = { patient_uuid: 'p', clinician_uuid: 'c', demo_token: 't', source_document_id: 'd' };
  assert.equal(validateActiveSupervisorRequest({ ...base, message: 'a real question' }).valid, true);
  assert.equal(validateActiveSupervisorRequest({ ...base, message: '' }).valid, true);
  assert.equal(validateActiveSupervisorRequest(base).valid, true);
  const wrongType = validateActiveSupervisorRequest({ ...base, message: 42 });
  assert.equal(wrongType.valid, false);
  assert.ok(wrongType.issues.includes('message_must_be_string'));
  const missingRequired = validateActiveSupervisorRequest({ clinician_uuid: 'c', demo_token: 't', source_document_id: 'd' });
  assert.equal(missingRequired.valid, false);
  assert.ok(missingRequired.issues.includes('patient_uuid_required'));
});

test('formulateEvidenceQuery builds the query from typed abnormal labs and chief concern, appending the clinician question last', () => {
  const abnormalLab = [{ test_name: 'A1C', abnormal_flag: 'high' }, { test_name: 'Hemoglobin', abnormal_flag: 'normal' }];
  const intake = { chief_concern: { status: 'observed', value: 'Fatigue for two weeks' } };
  const withBoth = formulateEvidenceQuery({ labResults: abnormalLab, intakeForm: intake, clinicianQuestion: 'what should I watch for' });
  assert.match(withBoth, /Abnormal findings: A1C test result high\./);
  assert.doesNotMatch(withBoth, /Hemoglobin/, 'a normal flag must not be treated as an abnormal finding');
  assert.match(withBoth, /Chief concern: Fatigue for two weeks\./);
  assert.ok(withBoth.trim().endsWith('what should I watch for'), 'the clinician question is appended last');

  // No typed evidence at all: the formulated query is exactly the clinician
  // question, unchanged (this is the exact contract runEvidenceWorker's
  // fallback tests below depend on).
  assert.equal(formulateEvidenceQuery({ clinicianQuestion: 'async guideline lookup' }), 'async guideline lookup');
  assert.equal(formulateEvidenceQuery({ labResults: [], intakeForm: null, clinicianQuestion: '' }), '');

  // Mutation-gap regression: dropping the abnormal-labs phrase (leaving only
  // the chief concern and/or clinician question) must change the query.
  const withoutAbnormalPhrase = formulateEvidenceQuery({ labResults: [], intakeForm: intake, clinicianQuestion: 'what should I watch for' });
  assert.notEqual(withBoth, withoutAbnormalPhrase);
  assert.doesNotMatch(withoutAbnormalPhrase, /Abnormal findings/);

  // A not_found_on_form chief concern contributes nothing.
  const notFound = formulateEvidenceQuery({ intakeForm: { chief_concern: { status: 'not_found_on_form', value: null } }, clinicianQuestion: 'q' });
  assert.equal(notFound, 'q');
});
