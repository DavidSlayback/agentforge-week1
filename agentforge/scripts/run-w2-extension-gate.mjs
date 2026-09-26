import { writeFileSync } from 'node:fs';
import { W2_EXTENSION_BASELINE_PATH, runW2ExtensionGate } from '../src/w2ExtensionGate.js';

const injectedDefect = process.argv.includes('--inject-defect');
const updateBaseline = process.argv.includes('--update-baseline');

const result = await runW2ExtensionGate({ injectDefect: injectedDefect });
const report = {
  schema_version: result.schema_version,
  synthetic_only: result.synthetic_only,
  passed: result.passed,
  thresholds_passed: result.thresholds_passed,
  injected_defect: result.injected_defect,
  total_cases: result.total_cases,
  missing_baseline: result.missing_baseline,
  corpus_sha256: result.corpus_sha256,
  baseline_corpus_sha256: result.baseline_corpus_sha256,
  baseline_mismatch: result.baseline_mismatch,
  judge_config: result.judge_config,
  by_label: result.by_label,
  regressions: result.regressions,
  critical_failures: result.critical_failures,
  failed_cases: result.failed_cases,
};

if (updateBaseline) {
  // Same rule as the golden gate: rebaseline only from a run that meets every
  // absolute threshold, so a regression can never become the new normal.
  if (injectedDefect || !result.thresholds_passed) {
    console.log(JSON.stringify(report, null, 2));
    console.error('Refusing to update the extension baseline: the run does not meet the per-category thresholds.');
    process.exit(1);
  }
  const baseline = {
    ...report,
    passed: true,
    missing_baseline: false,
    baseline_mismatch: false,
    baseline_corpus_sha256: result.corpus_sha256,
    regressions: Object.fromEntries(Object.keys(result.regressions).map((label) => [label, 0])),
    cases: result.results.map(({ id, label, guards_against, passed }) => ({ id, label, guards_against, passed })),
    evidence_command: 'npm run eval:extensions --prefix agentforge',
    mutation_command: 'npm run eval:extensions --prefix agentforge -- --inject-defect',
    rebaseline_command: 'npm run eval:extensions --prefix agentforge -- --update-baseline',
  };
  writeFileSync(W2_EXTENSION_BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Extension baseline rewritten: ${W2_EXTENSION_BASELINE_PATH} (corpus ${result.corpus_sha256})`);
  process.exit(0);
}

console.log(JSON.stringify(report, null, 2));
if (!result.passed) process.exitCode = 1;
