// The committed evals/*.json reports must match what the code produces today
// (H5: they held 7 cases while the runner ran 9). Locally generated files are
// compared with a fresh run; the deployed-service file can only be refreshed
// against the deployed service, so it must match or say it is stale and name
// the commit it came from.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runGoldenSuite } = require('../lib/runner');
const { analyze } = require('../lib/error-analysis');
const { referenceResponses } = require('../lib/reference');

const fixturePath = path.resolve(__dirname, '../../docs/agentforge/fixtures/clinical-cases.json');
const fixtures = require(fixturePath).cases;
const committed = (name) => require(path.resolve(__dirname, '..', name));
const ids = (report) => report.cases.map((item) => item.case_id);

test('results.json is exactly what the reference run produces today', () => {
  assert.deepEqual(committed('results.json'), runGoldenSuite({ fixturePath, responses: referenceResponses(fixtures) }), 'regenerate: node evals/lib/runner.js > evals/results.json');
});

test('error-analysis.json is exactly what the error analysis produces today', () => {
  assert.deepEqual(committed('error-analysis.json'), analyze(fixturePath), 'regenerate: node evals/lib/error-analysis.js > evals/error-analysis.json');
});

test('service-results.json covers every golden case and the adversarial suite', () => {
  const report = committed('service-results.json');
  assert.equal(report.total_cases, fixtures.length);
  assert.deepEqual(ids(report), fixtures.map((fixture) => fixture.id));
  assert.equal(report.gate_passed, true);
  assert.equal(report.adversarial?.gate_passed, true, 'regenerate with runner.js --service against a local server');
});

test('deployed-service-results.json matches the runner case count or is marked stale with its commit', () => {
  const report = committed('deployed-service-results.json');
  const current = report.total_cases === fixtures.length && ids(report).join() === fixtures.map((fixture) => fixture.id).join();
  if (current) return;
  assert.equal(report.provenance?.stale, true, `deployed results hold ${report.total_cases} cases, the runner ${fixtures.length}; mark provenance.stale or regenerate against the deployed service`);
  assert.match(String(report.provenance?.committed_in), /^[0-9a-f]{40}$/);
});
