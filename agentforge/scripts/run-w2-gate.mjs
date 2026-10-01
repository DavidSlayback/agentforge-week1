import { writeFileSync } from 'node:fs';
import { describeBaselineSha, gitProvenance } from './gitProvenance.mjs';
import { fileURLToPath } from 'node:url';
import { runW2RegressionGate } from '../src/w2RegressionGate.js';

const injectedDefect = process.argv.includes('--inject-defect');
const updateBaseline = process.argv.includes('--update-baseline');
const baselinePath = fileURLToPath(new URL('../../docs/agentforge/evidence/W2_BASELINE_REPORT.json', import.meta.url));

const result = await runW2RegressionGate({ injectDefect: injectedDefect });
const provenance = gitProvenance();
const report = {
  schema_version: result.schema_version,
  synthetic_only: result.synthetic_only,
  passed: result.passed,
  thresholds_passed: result.thresholds_passed,
  injected_defect: result.injected_defect,
  total_cases: result.total_cases,
  corpus_sha256: result.corpus_sha256,
  baseline_corpus_sha256: result.baseline_corpus_sha256,
  baseline_mismatch: result.baseline_mismatch,
  git_sha: provenance.git_sha,
  baseline_generated_at: result.baseline_generated_at,
  judge_config: result.judge_config,
  by_label: result.by_label,
  rubric_mapping: result.rubric_mapping,
  regressions: result.regressions,
  critical_failures: result.critical_failures,
  failed_cases: result.failed_cases,
};

if (updateBaseline) {
  // Rebaselining is explicit and only allowed from a run that meets every
  // absolute threshold, so a regression can never be written in as the new normal.
  if (injectedDefect || !result.thresholds_passed) {
    console.log(JSON.stringify(report, null, 2));
    console.error('Refusing to update the baseline: the run does not meet the per-category thresholds.');
    process.exit(1);
  }
  const baseline = {
    ...report,
    passed: true,
    baseline_mismatch: false,
    baseline_corpus_sha256: result.corpus_sha256,
    generated_at: provenance,
    baseline_generated_at: provenance,
    regressions: Object.fromEntries(Object.keys(result.regressions).map((label) => [label, 0])),
    cases: result.results.map(({ id, label, guards_against, passed }) => ({ id, label, guards_against, passed })),
    evidence_command: 'npm run eval:gate --prefix agentforge',
    mutation_command: 'npm run eval:gate --prefix agentforge -- --inject-defect',
    rebaseline_command: 'npm run eval:gate --prefix agentforge -- --update-baseline',
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Baseline rewritten: ${baselinePath} (corpus ${result.corpus_sha256})`);
  process.exit(0);
}

console.log(JSON.stringify(report, null, 2));
console.error(describeBaselineSha('W2 50-case gate', { generated_at: result.baseline_generated_at }, provenance));
if (!result.passed) process.exitCode = 1;
