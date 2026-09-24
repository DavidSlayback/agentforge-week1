import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Resolve the git commit this process was built from.
 *
 * `agentforge/BUILD_SHA` is marked `export-subst`, so `git archive` (the deploy
 * path) replaces its placeholder with the commit hash. A plain checkout keeps
 * the placeholder, so the result falls back to `AGENTFORGE_GIT_SHA` and then to
 * `unversioned`, never to a guessed value.
 *
 * Args:
 *   filePath: Path to the BUILD_SHA file.
 *   env: Environment to read the fallback from.
 *
 * Returns:
 *   A 40-character commit hash or the literal `unversioned`.
 */
export function readBuildSha(filePath = fileURLToPath(new URL('../BUILD_SHA', import.meta.url)), env = process.env) {
  let stamped = '';
  try { stamped = fs.readFileSync(filePath, 'utf8').trim(); } catch { /* missing file means unstamped */ }
  if (SHA_PATTERN.test(stamped)) return stamped;
  const fromEnv = String(env.AGENTFORGE_GIT_SHA || '').trim();
  return SHA_PATTERN.test(fromEnv) ? fromEnv : 'unversioned';
}
