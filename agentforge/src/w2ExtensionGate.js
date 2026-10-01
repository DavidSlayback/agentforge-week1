import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildExtensionCases } from './extensionCases/index.js';
import { P1, P2, kase, runW2RegressionGate, scan } from './w2RegressionGate.js';

export const W2_EXTENSION_BASELINE_PATH = fileURLToPath(new URL('../../docs/agentforge/evidence/W2_EXTENSION_BASELINE_REPORT.json', import.meta.url));

/** The extension cases (`expect.custom` checks read `run.patient` and `run.clinician`, set by `runScenario`). */
export function buildW2ExtensionSet() {
  return buildExtensionCases({ kase, scan, P1, P2 });
}

export function loadExtensionBaseline(path = W2_EXTENSION_BASELINE_PATH) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/**
 * Run the extension suite with the golden gate's judge: same five boolean
 * labels, the same per-label threshold (95%) and the same 5-point regression
 * rule against a committed baseline. Differences from the golden gate: the
 * case count is whatever the suite holds (but never zero), and a label with
 * no extension cases is skipped rather than failed. A missing baseline fails.
 */
export async function runW2ExtensionGate({ cases = buildW2ExtensionSet(), baseline = undefined, injectDefect = false } = {}) {
  const baselineArtifact = baseline === undefined ? loadExtensionBaseline() : baseline;
  const missingBaseline = !baselineArtifact;
  const result = await runW2RegressionGate({
    cases,
    baseline: baselineArtifact || { corpus_sha256: null, by_label: {} },
    injectDefect,
    expectedCount: cases.length,
    requireEveryLabel: false,
    extension: true,
    schemaVersion: 'w2-extension-gate-v1',
  });
  return { ...result, missing_baseline: missingBaseline, passed: result.passed && !missingBaseline };
}
