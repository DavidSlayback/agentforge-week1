// Re-runs the 16 review-G2 regressions, the reviewer's N1–N10 and later rows against a scratch copy of the repo and
// reports which of the pre-commit hook's checks fail for each. The working tree
// is never modified: every edit is applied to a copy under the OS temp dir and
// reverted (and hash-checked) before the next one.
//   node agentforge/scripts/run-regression-matrix.mjs [--only R3,R10]
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Each regression is one exact, unique text replacement.
 *
 * R1 (empty `quote_or_value` on a text-path lab citation) is retired: it
 * targeted `agentforge/src/labEvidence.js`, deleted along with the legacy
 * LAB|/INTAKE| text path and its old supervisor (R2, issue #4). The scan
 * path's equivalent citation-completeness guard is exercised by N1, N7 and
 * N9 below, and by the gate's `cp-11-scan-text-lab-citations`/
 * `cp-12-scan-text-intake-citations` cases added in that same refactor.
 */
export const REGRESSIONS = [
  { id: 'R2', title: 'Remove the citation from scan-path facts', file: 'agentforge/src/scanFormAdapter.js', find: "disposition: 'observed', citation, uncertainty", replace: "disposition: 'observed', uncertainty" },
  { id: 'R3', title: "Abnormal flag always 'normal' in typedExtraction", file: 'agentforge/src/typedExtraction.js', find: 'abnormal_flag: abnormalFlagFrom(fields.abnormal.value),', replace: "abnormal_flag: 'normal'," },
  { id: 'R4', title: 'Force unit to mg/dL in the typed PDF path', file: 'agentforge/src/typedExtraction.js', find: 'unit: fields.unit.value,', replace: "unit: 'mg/dL'," },
  { id: 'R5', title: 'Reverse retriever ranking', file: 'agentforge/src/guidelineEvidence.js', find: '.sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id))', replace: '.sort((left, right) => left.score - right.score || left.document.id.localeCompare(right.document.id))' },
  { id: 'R6', title: 'Retriever returns only the worst chunk', file: 'agentforge/src/guidelineEvidence.js', find: '.slice(0, Math.max(0, topK));', replace: '.slice(-1);' },
  { id: 'R7', title: 'Retriever returns []', file: 'agentforge/src/guidelineEvidence.js', find: "evidence: ranked.map(({ document, sparseScore, denseScore, score, overlap }) => guidelineEvidenceItem(document, { sparseScore, denseScore, rerankScore: score, matchedTerms: overlap })), issues: [] };", replace: 'evidence: [], issues: [] };' },
  { id: 'R8', title: "Remove the retriever's score > 0 filter", file: 'agentforge/src/guidelineEvidence.js', find: '    .filter((candidate) => candidate.score > 0)\n', replace: '' },
  { id: 'R9', title: 'Evidence worker never qualifies/refuses', file: 'agentforge/src/activeWorkers.js', find: "const qualified = !normalizedQuery || !usable.length || guideline.status !== 'complete';", replace: 'const qualified = false;' },
  { id: 'R10', title: 'Log raw patient name and full OCR text to trace and console.log (service.js scan path)', file: 'agentforge/src/service.js', find: '      if (pdf) workflow.typed_outputs.extraction.provider = prepared.provider;\n', replace: "      if (pdf) workflow.typed_outputs.extraction.provider = prepared.provider;\n      console.log('scan workflow debug', { patient: targetPatient?.name, ocr: prepared.ocrText || contentText });\n      trace?.recordHandoff({ worker: 'debug', name: targetPatient?.name, ocr_dump: prepared.ocrText || contentText });\n" },
  { id: 'R11', title: 'Break the trace redaction regex for quote/value keys', file: 'observability/index.js', find: '|raw|value|field|quote|image|', replace: '|raw|field|image|' },
  { id: 'R12', title: 'LabResult schema stops requiring reference_range', file: 'agentforge/src/schemas.js', find: '  reference_range: z.string().min(1),\n', replace: '  reference_range: z.string().min(1).optional(),\n' },
  { id: 'R13', title: 'Lab extractor drops reference_range', file: 'agentforge/src/typedExtraction.js', find: '      reference_range: fields.reference_range.value,\n', replace: '' },
  { id: 'R14', title: 'Citation schema stops validating bounding_box', file: 'agentforge/src/schemas.js', find: '  bounding_box: z.tuple([\n    z.number().nonnegative(),\n    z.number().nonnegative(),\n    z.number().nonnegative(),\n    z.number().nonnegative(),\n  ]).optional(),\n', replace: '  bounding_box: z.any().optional(),\n' },
  { id: 'R15', title: 'Intake extractor drops allergies', file: 'agentforge/src/typedExtraction.js', find: "  allergies: ['allergies'],\n", replace: '' },
  { id: 'R16', title: 'OCR label map routes "hemoglobin value" into the unit field', file: 'agentforge/src/pdfScanAdapter.js', find: "['hemoglobin value', ['lab.hgb.value', 'Hemoglobin value']]", replace: "['hemoglobin value', ['lab.hgb.unit', 'Hemoglobin value']]" },
  // N1–N10: the independent reviewer's regressions for 1c10893, verbatim.
  { id: 'N1', title: 'bbox off-by-one (top+1) in PDF fixture writer', file: 'agentforge/src/pdfScanAdapter.js', find: 'const box = field.box || [line?.left, line?.top, line?.right, line?.bottom];', replace: 'const box = field.box || [line?.left, line?.top + 1, line?.right, line?.bottom];' },
  { id: 'N2', title: 'collection_date day/month swapped', file: 'agentforge/src/typedExtraction.js', find: 'collection_date: fields.collection_date.value,', replace: "collection_date: fields.collection_date.value.split('-').map((p, i, a) => i === 1 ? a[2] : i === 2 ? a[1] : p).join('-')," },
  { id: 'N3', title: 'patient identity ignores DOB', file: 'agentforge/src/documentSafety.js', find: "else if (formDob !== chartDob) mismatched.push('dob');", replace: "else if (false) mismatched.push('dob');" },
  { id: 'N4', title: 'doc-type detector always consistent', file: 'agentforge/src/documentSafety.js', find: "const typeStatus = typeDetection.detected === 'undetermined' ? 'undetermined' : typeDetection.detected === documentType ? 'consistent' : 'mismatch';", replace: "const typeStatus = 'consistent';" },
  { id: 'N5', title: 'evidence worker query replaced with constant', file: 'agentforge/src/supervisor.js', find: 'evidenceWorker = runEvidenceWorker({ query, patientFacts,', replace: "evidenceWorker = runEvidenceWorker({ query: 'glycemic follow-up for an elevated A1C', patientFacts," },
  { id: 'N6', title: 'LabResult confidence uses max instead of min', file: 'agentforge/src/typedExtraction.js', find: 'confidence: Math.min(...LAB_SUFFIXES', replace: 'confidence: Math.max(...LAB_SUFFIXES' },
  { id: 'N7', title: 'typed lab citation points at the test-name line, not the value line', file: 'agentforge/src/typedExtraction.js', find: 'citation: fields.value.citation,', replace: 'citation: fields.test_name.citation,' },
  { id: 'N8', title: 'missing chart demographics treated as identity match', file: 'agentforge/src/documentSafety.js', find: "if (!targetPatient) return { status: 'unverified', mismatched_fields: [] };", replace: "if (!targetPatient) return { status: 'match', mismatched_fields: [] };" },
  { id: 'N9', title: 'low-confidence threshold 0.85 -> 0.3 (uncertain facts shown as verified)', file: 'agentforge/src/scanFormAdapter.js', find: 'field.confidence < 0.85 ?', replace: 'field.confidence < 0.3 ?' },
  { id: 'N10', title: 'extraction_incomplete rule removed', file: 'agentforge/src/documentSafety.js', find: "if (factCount && extraction?.status !== 'complete') qualifying.push('extraction_incomplete');", replace: '' },
  // Rows for behaviour added in response to that review.
  { id: 'I1', title: 'Lab reports skip the patient-header identity check', file: 'agentforge/src/documentSafety.js', find: ": { ...compareIdentity(readHeaderIdentity(documentText), targetPatient), source: 'lab_report_header' };", replace: ": { status: 'not_applicable', mismatched_fields: [], source: 'lab_report_header' };" },
  { id: 'U1', title: 'Unreadable PDFs are no longer refused (errors propagate as HTTP 500)', file: 'agentforge/src/service.js', find: "  return ['SOURCE_DOCUMENT_PDF_INVALID', 'PDF_PAGE_LIMIT_EXCEEDED', 'PDF_OCR_COMMAND_FAILED', 'PDF_OCR_COMMAND_TIMEOUT', 'PDF_OCR_OUTPUT_LIMIT_EXCEEDED'].includes(code);", replace: '  return false;' },
  { id: 'L0', title: 'Control: pre-fix trace behaviour (raw handoffs recorded in the scan trace)', file: 'agentforge/src/service.js', find: 'trace?.recordHandoff(traceSafeHandoff(handoff));', replace: 'trace?.recordHandoff(handoff);' },
  // X1: added in review of R2 (issue #4), alongside the sr-16 gate case that
  // replaces sr-10 ("a declared-wrong-type document reports READY instead of
  // being refused"). Removing this BLOCKED stop lets a contract-invalid
  // extraction (wrong declared type on a real envelope) fall through to
  // safety/retrieval instead of refusing loudly.
  { id: 'X1', title: 'Remove the extraction_contract_invalid BLOCKED stop', file: 'agentforge/src/supervisor.js', find: "  if (extractionWorker.output_status === 'blocked') return activeStop(STATES.BLOCKED, 'extraction_contract_invalid', transitions, extractionWorker, null);\n", replace: '' },
];

// The hook's four checks, plus the agentforge unit tests without the gate's own
// test file and the /evals page test (which also runs the gate), to show which
// regressions unit tests catch independently.
const CHECKS = [
  ['agentforge_tests', 'npm test --silent --prefix agentforge'],
  ['unit_tests_excluding_gate', 'node --test --test-concurrency=1 --test-skip-pattern="^(W2 gate |evaluator panel exposes)" agentforge/test/*.test.js'],
  ['evals_tests', 'npm test --silent --prefix evals'],
  ['observability_tests', 'node --test observability/test/*.test.js'],
  ['gate', 'node agentforge/scripts/run-w2-gate.mjs'],
];

const sha = (text) => createHash('sha256').update(text).digest('hex');

function runCheck(cwd, command) {
  const result = spawnSync(command, { cwd, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  return { exit: result.status, stdout: result.stdout || '' };
}

function gateSummary(stdout) {
  try {
    const report = JSON.parse(stdout.slice(stdout.indexOf('{')));
    const categories = [...new Set(report.failed_cases.map((item) => item.label))];
    return { categories, failed_cases: report.failed_cases.map((item) => item.id) };
  } catch { return { categories: ['unparseable'], failed_cases: [] }; }
}

const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const scratch = mkdtempSync(join(tmpdir(), 'agentforge-matrix-'));
try {
  for (const path of ['agentforge', 'observability', 'evals', 'docs/agentforge']) cpSync(join(repoRoot, path), join(scratch, path), { recursive: true });
  const rows = [];
  for (const regression of [{ id: 'R0', title: 'Control: no edit' }, ...REGRESSIONS].filter((item) => !only || item.id === 'R0' || only.includes(item.id))) {
    const target = regression.file ? join(scratch, regression.file) : null;
    const original = target ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
    if (target) {
      const count = original.split(regression.find).length - 1;
      if (count !== 1) throw new Error(`${regression.id}: expected exactly one match in ${regression.file}, found ${count}`);
      writeFileSync(target, original.replace(regression.find, () => regression.replace));
    }
    const results = Object.fromEntries(CHECKS.map(([name, check]) => [name, runCheck(scratch, check)]));
    if (target) {
      writeFileSync(target, original);
      if (sha(readFileSync(target, 'utf8')) !== sha(original)) throw new Error(`${regression.id}: revert failed`);
    }
    const gate = gateSummary(results.gate.stdout);
    const row = { id: regression.id, title: regression.title, file: regression.file || null, ...Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.exit === 0 ? 'pass' : 'FAIL'])), gate_failed_categories: gate.categories, gate_failed_cases: gate.failed_cases };
    rows.push(row);
    console.error(`${row.id}: tests=${row.agentforge_tests} unit_excl_gate=${row.unit_tests_excluding_gate} evals=${row.evals_tests} observability=${row.observability_tests} gate=${row.gate} [${gate.categories.join(', ')}]`);
  }
  console.log(JSON.stringify(rows, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
