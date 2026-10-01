import { execFileSync } from 'node:child_process';

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

// The baseline reports themselves are outputs, so rewriting one (the two
// rebaselines run back to back) does not make the tree count as dirty.
const BASELINE_OUTPUTS = ['docs/agentforge/evidence/W2_BASELINE_REPORT.json', 'docs/agentforge/evidence/W2_EXTENSION_BASELINE_REPORT.json'];

/**
 * The commit a gate run or baseline came from. `dirty` says whether tracked
 * files other than the baseline reports differ from that commit, so a
 * baseline written from uncommitted work says so instead of naming a SHA that
 * does not hold it.
 */
export function gitProvenance() {
  const sha = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain', '--untracked-files=no', '--', '.', ...BASELINE_OUTPUTS.map((path) => `:(exclude)${path}`)]);
  return { git_sha: sha || 'unknown', dirty: status === null ? null : status.length > 0 };
}

/**
 * Report the baseline's SHA next to the current one. A mismatch is expected
 * (code changes legitimately) and never fails the gate; it tells the reader
 * which commit the pinned rates and hash were measured on.
 */
export function describeBaselineSha(label, baseline, current) {
  const recorded = baseline?.generated_at?.git_sha;
  const note = !recorded ? 'baseline names no SHA (written before H5)' : recorded === current.git_sha ? 'same commit' : 'different commit; expected after code changes, not a failure';
  return `${label}: baseline generated at ${recorded || 'unknown'}${baseline?.generated_at?.dirty ? ' (dirty tree)' : ''}; this run at ${current.git_sha}${current.dirty ? ' (dirty tree)' : ''} -- ${note}.`;
}
