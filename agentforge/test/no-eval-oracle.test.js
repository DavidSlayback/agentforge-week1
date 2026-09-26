import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// AGENTS.md: "Production code (src/) must never read eval expectations
// (expected, golden answers). Detect conditions from the data itself."
// (PLAN W1-SF3.) The eval harness modules in src/ (the W2 gates, their case
// definitions, the retrieval benchmark) may read golden truth, but the
// deployed service must never import them, and no module the service loads
// may read an answer key.

const agentforgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVAL_HARNESS = new Set(['src/w2RegressionGate.js', 'src/w2ExtensionGate.js', 'src/retrievalBenchmark.js', 'src/extensionCases/index.js', 'src/extensionCases/critic.js', 'src/extensionCases/retrieval.js', 'src/extensionCases/clickToSource.js']);

// Reads of an answer key: `x.expected`, `x['expected']`, an `expected:` key or
// rename, `{ expected } =` destructuring, golden `.truth`, and the fixture
// answer-key field names from clinical-cases.json.
const ORACLE_READS = [
  /\.expected\b/,
  /\[\s*['"`]expected['"`]\s*\]/,
  /\bexpected\s*:/,
  /\{[^{}]*\bexpected\b[^{}]*\}\s*=/,
  /\.truth\b/,
  /\[\s*['"`]truth['"`]\s*\]/,
  /\b(?:withhold_fields|qualification_required|brief_disposition|identity_disposition|stale_fields|treat_note_as|show_heavily_qualified_panel|reassessment_claims|missing_groups|missing_provenance)\b/,
];

/** Relative-import closure of an entry module, as repo-relative posix paths under agentforge/. */
function importClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(path.join(agentforgeRoot, file), 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
    }
  }
  return [...seen];
}

const runtimeModules = importClosure('src/server.js');

test('the deployed service never imports an eval harness module', () => {
  assert.ok(runtimeModules.includes('src/preVisitPreparation.js'), 'the closure reaches the briefing code');
  assert.ok(runtimeModules.length > 20, 'the import scan found the runtime graph');
  const leaked = runtimeModules.filter((file) => EVAL_HARNESS.has(file));
  assert.deepEqual(leaked, []);
});

test('no module the deployed service loads reads an eval answer key', () => {
  const violations = [];
  for (const file of runtimeModules) {
    const lines = fs.readFileSync(path.join(agentforgeRoot, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const pattern of ORACLE_READS) if (pattern.test(line)) violations.push(`${file}:${index + 1} ${pattern}`);
    });
  }
  assert.deepEqual(violations, []);
});

test('the oracle-read scan catches the reads it exists to forbid', () => {
  const caught = (line) => ORACLE_READS.some((pattern) => pattern.test(line));
  for (const line of ['const key = item.expected || {};', "item['expected']", 'const { expected, records } = item;', "{ ...item, expected: {} }", 'doc.truth.lab_results', 'expected.withhold_fields', 'if (fixture.qualification_required) {']) {
    assert.ok(caught(line), line);
  }
  for (const line of ['const expectedSignature = hmac(value);', 'return requiredFields;', 'provenance_missing:problem.asthma.status']) assert.equal(caught(line), false, line);
});
