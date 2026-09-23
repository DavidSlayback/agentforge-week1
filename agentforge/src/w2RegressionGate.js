import { createHash } from 'node:crypto';
import baselineReport from '../../docs/agentforge/evidence/W2_BASELINE_REPORT.json' with { type: 'json' };
import { InMemoryTraceSink } from '../../observability/index.js';
import { validateIntakeEvidenceResponse, validateLabEvidenceResponse } from './contracts.js';
import { retrieveGuidelineEvidence } from './guidelineEvidence.js';
import { extractIntakeEvidence } from './intakeEvidence.js';
import { extractLabEvidence } from './labEvidence.js';

export const W2_GATE_LABELS = Object.freeze(['schema_valid', 'citation_present', 'factually_consistent', 'safe_refusal', 'no_phi_in_logs']);
export const W2_GATE_CASE_COUNT = 50;
const CASES_PER_LABEL = 10;

function labText(index) {
  const value = (13.2 + index / 10).toFixed(1);
  return `LAB|test=Hemoglobin|value=${value}|unit=g/dL|reference_range=12-16|collection_date=2026-09-${String(index + 1).padStart(2, '0')}|abnormal=false|page=1|field_id=lab.hgb.${index}|quote=Hemoglobin ${value} g/dL|bounding_box=10,20,100,40`;
}

function intakeText(index) {
  return `INTAKE|field=medication.metformin|value=${500 + index} mg daily|section=Medications|page=1|field_id=intake.medications.${index}|quote=Metformin ${500 + index} mg daily|bounding_box=10,20,100,40`;
}

function validDocumentCase(id, label, index, documentType) {
  return { id, label, synthetic_only: true, operation: 'valid-document', document_type: documentType, source_id: `synthetic-source-${id}`, content: documentType === 'lab_pdf' ? labText(index) : intakeText(index) };
}

export function buildW2GoldenSet() {
  const cases = [];
  for (let index = 0; index < CASES_PER_LABEL; index += 1) {
    const id = `w2-schema-${String(index + 1).padStart(2, '0')}`;
    cases.push(validDocumentCase(id, 'schema_valid', index, index % 2 ? 'intake_form' : 'lab_pdf'));
  }
  for (let index = 0; index < CASES_PER_LABEL; index += 1) {
    const id = `w2-citation-${String(index + 1).padStart(2, '0')}`;
    cases.push(validDocumentCase(id, 'citation_present', index, index % 2 ? 'intake_form' : 'lab_pdf'));
  }
  for (let index = 0; index < CASES_PER_LABEL; index += 1) {
    const id = `w2-factual-${String(index + 1).padStart(2, '0')}`;
    cases.push({ id, label: 'factually_consistent', synthetic_only: true, operation: 'fact-and-retrieval', content: labText(index), expected_value: (13.2 + index / 10).toFixed(1), query: 'medication reconciliation documented list prior records', expected_guideline_id: 'guideline-medication-reconciliation-1' });
  }
  for (let index = 0; index < CASES_PER_LABEL; index += 1) {
    const id = `w2-refusal-${String(index + 1).padStart(2, '0')}`;
    cases.push({ id, label: 'safe_refusal', synthetic_only: true, operation: index % 2 ? 'unsupported-query' : 'malformed-document', content: 'LAB|test=Hemoglobin|value=unknown', query: 'quasar galaxies nebula astronomy' });
  }
  for (let index = 0; index < CASES_PER_LABEL; index += 1) {
    cases.push({ id: `w2-redaction-${String(index + 1).padStart(2, '0')}`, label: 'no_phi_in_logs', synthetic_only: true, operation: 'redaction', sentinel: `SYNTHETIC_PRIVATE_SENTINEL_${index + 1}` });
  }
  return cases;
}

function parseDocument(testCase) {
  const args = { sourceDocumentId: testCase.source_id, content: Buffer.from(testCase.content, 'utf8') };
  const extraction = testCase.document_type === 'lab_pdf' ? extractLabEvidence(args) : extractIntakeEvidence(args);
  const response = {
    synthetic_only: true,
    source_document: { id: testCase.source_id },
    extraction,
    observations: [],
  };
  const validation = testCase.document_type === 'lab_pdf'
    ? validateLabEvidenceResponse(response)
    : validateIntakeEvidenceResponse(response);
  return { extraction, validation };
}

function evaluateCase(testCase) {
  const issues = [];
  if (testCase.synthetic_only !== true || !W2_GATE_LABELS.includes(testCase.label)) issues.push('case_contract_invalid');

  if (testCase.operation === 'valid-document') {
    const { extraction, validation } = parseDocument(testCase);
    if (testCase.label === 'schema_valid' && (!validation.valid || extraction.status !== 'complete' || !extraction.facts.length)) issues.push('strict_schema_rejected_valid_document');
    if (testCase.label === 'citation_present') {
      const citation = extraction.facts[0]?.citation;
      if (!validation.valid || !citation?.source_document_id || !citation?.page || !citation?.field_id || !citation?.quote || !Array.isArray(citation?.bounding_box)) issues.push('source_citation_missing');
    }
  } else if (testCase.operation === 'fact-and-retrieval') {
    const { extraction } = parseDocument({ ...testCase, document_type: 'lab_pdf', source_id: testCase.id });
    const evidence = retrieveGuidelineEvidence(testCase.query);
    if (extraction.facts[0]?.value !== testCase.expected_value) issues.push('extracted_value_mismatch');
    if (!evidence.evidence.some((item) => item.source_id === testCase.expected_guideline_id)) issues.push('relevant_guideline_not_retrieved');
    if (evidence.evidence.some((item) => !item.source_id || !item.location || !item.quote)) issues.push('guideline_provenance_missing');
  } else if (testCase.operation === 'malformed-document') {
    const extraction = extractLabEvidence({ sourceDocumentId: testCase.id, content: Buffer.from(testCase.content, 'utf8') });
    if (extraction.status !== 'qualified' || extraction.facts.length !== 0) issues.push('unreadable_document_not_qualified');
  } else if (testCase.operation === 'unsupported-query') {
    const evidence = retrieveGuidelineEvidence(testCase.query);
    if (evidence.status !== 'qualified' || evidence.evidence.length !== 0) issues.push('unsupported_query_not_withheld');
  } else if (testCase.operation === 'redaction') {
    const sink = new InMemoryTraceSink();
    const trace = sink.start({ correlationId: testCase.id, operation: 'w2-eval', scope: { patientRef: 'synthetic-patient' } });
    trace.setExtraction({ status: 'complete', quote: testCase.sentinel });
    trace.setEvaluation({ status: 'recorded', prompt: testCase.sentinel, outcome: 'pass' });
    trace.complete({ status: 'success' });
    const serialized = JSON.stringify(sink.list());
    if (serialized.includes(testCase.sentinel)) issues.push('raw_content_survived_log_redaction');
  } else issues.push('operation_unknown');

  return { id: testCase.id, label: testCase.label, critical: testCase.label === 'no_phi_in_logs', passed: issues.length === 0, issues };
}

function summarizeByLabel(results) {
  return Object.fromEntries(W2_GATE_LABELS.map((label) => {
    const subset = results.filter((result) => result.label === label);
    const passed = subset.filter((result) => result.passed).length;
    return [label, { cases: subset.length, passed, rate: subset.length ? passed / subset.length : 0 }];
  }));
}

function corpusHash(cases) {
  return createHash('sha256').update(JSON.stringify(cases)).digest('hex');
}

/** Run the W2 rubric gate against real local extraction, retrieval, and redaction code. */
export function runW2RegressionGate({ cases = buildW2GoldenSet(), baseline = null, injectDefect = false } = {}) {
  const expectedCorpusHash = corpusHash(cases);
  const baselineArtifact = baseline || baselineReport;
  const results = cases.map((testCase, index) => {
    const result = evaluateCase(testCase);
    if (injectDefect && index === 0) return { ...result, passed: false, issues: [...result.issues, 'injected_schema_regression'] };
    return result;
  });
  const byLabel = summarizeByLabel(results);
  const baselineByLabel = baselineArtifact.by_label;
  const baselineMismatch = baselineArtifact.corpus_sha256 !== expectedCorpusHash;
  const regressions = Object.fromEntries(W2_GATE_LABELS.map((label) => [label, Number(((baselineByLabel[label]?.rate ?? 0) - byLabel[label].rate).toFixed(4))]));
  const criticalFailures = results.filter((result) => result.critical && !result.passed).map((result) => result.id);
  const judgeConfig = Object.freeze({ version: 'w2-assignment-rubrics-v2', per_label_min_rate: 0.95, max_regression: 0.05, critical_failure_tolerance: 0, no_phi_in_logs_required: true });
  const passed = results.length === W2_GATE_CASE_COUNT
    && W2_GATE_LABELS.every((label) => byLabel[label].rate >= judgeConfig.per_label_min_rate)
    && Object.values(regressions).every((regression) => regression <= judgeConfig.max_regression)
    && criticalFailures.length === 0
    && !baselineMismatch;
  return {
    schema_version: 'w2-regression-gate-v2',
    synthetic_only: true,
    passed,
    injected_defect: injectDefect,
    total_cases: results.length,
    corpus_sha256: expectedCorpusHash,
    baseline_corpus_sha256: baselineArtifact.corpus_sha256,
    baseline_mismatch: baselineMismatch,
    judge_config: judgeConfig,
    rubric_mapping: { schema_valid: 'strict schema validators', citation_present: 'source/page/field/quote/bounding-box contract', factually_consistent: 'known extraction values plus expected guideline provenance', safe_refusal: 'unreadable document and unsupported query are qualified/withheld', no_phi_in_logs: 'sentinel content is absent after trace redaction' },
    by_label: byLabel,
    baseline_by_label: baselineByLabel,
    regressions,
    critical_failures: criticalFailures,
    failed_cases: results.filter((result) => !result.passed).map(({ id, label, critical, issues }) => ({ id, label, critical, issues })),
    results,
  };
}
