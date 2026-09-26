import { clickToSourceCases } from './clickToSource.js';
import { retrievalCases } from './retrieval.js';
import { criticCases } from './critic.js';

/**
 * The W2 extension suite (D12): cases for the PRD's p.5-6 extension items,
 * gated by `w2ExtensionGate.js` in the same pre-commit hook as the 50-case
 * golden set, which stays at exactly 50. Each slice owns one file here and
 * adds one line below (E2 critic.js, E3 retrieval.js, E4 medicationList.js,
 * E5 labTrend.js).
 */
export function buildExtensionCases(helpers) {
  return [
    ...clickToSourceCases(helpers),
    ...retrievalCases(helpers),
    ...criticCases(helpers),
  ];
}
