import { runW2RegressionGate } from '../src/w2RegressionGate.js';

const injectedDefect = process.argv.includes('--inject-defect');
const result = runW2RegressionGate({ injectDefect: injectedDefect });
const report = {
  schema_version: result.schema_version,
  synthetic_only: result.synthetic_only,
  passed: result.passed,
  injected_defect: result.injected_defect,
  total_cases: result.total_cases,
  corpus_sha256: result.corpus_sha256,
  judge_config: result.judge_config,
  by_label: result.by_label,
  by_rubric: result.by_rubric,
  rubric_mapping: result.rubric_mapping,
  regressions: result.regressions,
  critical_failures: result.critical_failures,
  failed_cases: result.failed_cases
};
console.log(JSON.stringify(report, null, 2));
if (!result.passed) process.exitCode = 1;
