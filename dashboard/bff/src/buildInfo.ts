import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export const DEFAULT_BUILD_SHA_PATH = fileURLToPath(new URL('../../BUILD_SHA', import.meta.url));

/**
 * Resolve the git commit this process was built from (mirrors
 * `agentforge/src/buildInfo.js`).
 *
 * `dashboard/BUILD_SHA` is marked `export-subst`, so `git archive` (the deploy
 * path) replaces its placeholder with the commit hash. A plain checkout keeps
 * the placeholder, so the result falls back to `DASHBOARD_GIT_SHA` and then to
 * `unversioned`, never to a guessed value.
 */
export function readBuildSha(
  filePath: string = DEFAULT_BUILD_SHA_PATH,
  env: Readonly<Record<string, string | undefined>> = {},
): string {
  let stamped = '';
  try {
    stamped = readFileSync(filePath, 'utf8').trim();
  } catch {
    // A missing file means unstamped.
  }
  if (SHA_PATTERN.test(stamped)) return stamped;
  const fromEnv = (env['DASHBOARD_GIT_SHA'] ?? '').trim();
  return SHA_PATTERN.test(fromEnv) ? fromEnv : 'unversioned';
}
