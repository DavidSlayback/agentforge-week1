// Re-runs the 16 review-G2 regressions against a scratch copy of the repo and
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

/** Each regression is one exact, unique text replacement. */
export const REGRESSIONS = [
  { id: 'R1', title: 'Empty quote_or_value on a text-path lab citation', file: 'agentforge/src/labEvidence.js', find: 'quote_or_value: values.quote, bounding_box: boundingBox }', replace: "quote_or_value: '', bounding_box: boundingBox }" },
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
  { id: 'L0', title: 'Control: pre-fix trace behaviour (raw handoffs recorded in the scan trace)', file: 'agentforge/src/service.js', find: 'trace?.recordHandoff(traceSafeHandoff(handoff));', replace: 'trace?.recordHandoff(handoff);' },
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
  const result = spawnSync(command, { cwd, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
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
