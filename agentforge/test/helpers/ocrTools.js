import { spawnSync } from 'node:child_process';

/** Every live-OCR test file names itself here; scripts/run-ocr-tests.sh runs exactly these. */
export const LIVE_OCR_TEST_FILES = Object.freeze(['test/ocr-golden-parity.test.js', 'test/s4-bounding-box.test.js', 'test/schemas.test.js']);

export const toolOnPath = (tool) => {
  const probe = spawnSync(tool, ['-v'], { stdio: 'ignore' });
  return !probe.error && probe.status !== null;
};

/**
 * `skip` option for a test that needs the OCR binaries (pdftoppm, pdfinfo,
 * tesseract).
 *
 * With every tool on PATH it returns false and the test runs. Otherwise:
 * - with `AGENTFORGE_REQUIRE_OCR=1` (CI and the hook's Docker OCR step) it
 *   throws, failing the test file, so a missing tool is never a silent pass;
 * - without it, the test is skipped and a SKIP line naming the test and the
 *   missing tools goes to stderr, so the skip is visible in the hook output,
 *   not only as a skip count.
 */
export function liveOcrSkip(what, tools, env = process.env) {
  const missing = tools.filter((tool) => !toolOnPath(tool));
  if (!missing.length) return false;
  const reason = `live OCR test "${what}" needs ${missing.join(', ')}, not on PATH`;
  if (env.AGENTFORGE_REQUIRE_OCR === '1') throw new Error(`AGENTFORGE_REQUIRE_OCR=1: ${reason}. Install poppler-utils and tesseract-ocr, or run scripts/run-ocr-tests.sh (Docker).`);
  process.stderr.write(`[agentforge] SKIP ${reason}. The pre-commit hook runs it in Docker (scripts/run-ocr-tests.sh).\n`);
  return `${reason}; runs in Docker via scripts/run-ocr-tests.sh, and in CI with AGENTFORGE_REQUIRE_OCR=1`;
}
