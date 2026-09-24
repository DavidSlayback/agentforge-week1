import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression test for the S5 review finding: agentforge/corpus/guidelines/
// corpus.json was never copied into the deployed image, so the W2 container
// threw GUIDELINE_CORPUS_MISSING at first request (or at boot, before the S5
// fix that resolves it lazily). This scans every `new URL('../...',
// import.meta.url)` reference in agentforge/src/*.js (the pattern every
// module in this codebase uses to locate a file relative to itself) and
// checks the Dockerfile has a `COPY` line covering the directory it
// resolves to — so a future module that reads a new on-disk directory and
// forgets to update the Dockerfile fails this test instead of failing only
// in a deployed container.

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const agentforgeSrcDir = path.join(repoRoot, 'agentforge', 'src');
// Normalized to LF: a CRLF checkout (core.autocrlf) would otherwise leave a
// trailing \r that JS regex `.` does not match (\r is a line terminator),
// silently breaking the per-line COPY parsing below.
const dockerfileText = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8').replace(/\r\n/g, '\n');

// `COPY <src...> <dest>` — every non-flag argument except the last is a
// source path (a plain COPY may list one src and one dest; this codebase's
// Dockerfile never uses multi-source COPY, but handle it anyway).
function copiedSourcePaths(text) {
  const sources = [];
  for (const line of text.split('\n')) {
    const match = /^\s*COPY\s+(?!--from)(.+)$/.exec(line);
    if (!match) continue;
    const parts = match[1].trim().split(/\s+/);
    sources.push(...parts.slice(0, -1));
  }
  return sources;
}

function findUrlRelativeReferences() {
  const references = [];
  for (const filename of fs.readdirSync(agentforgeSrcDir)) {
    if (!filename.endsWith('.js')) continue;
    const filePath = path.join(agentforgeSrcDir, filename);
    const text = fs.readFileSync(filePath, 'utf8');
    const pattern = /new URL\('((?:\.\.\/)+)([^']*)',\s*import\.meta\.url\)/g;
    let match;
    while ((match = pattern.exec(text))) {
      const [, dots, rest] = match;
      if (!rest) continue; // a bare `'../../'`-style repo-root reference is too broad to check meaningfully
      const upCount = dots.length / 3;
      // `new URL` resolves relative to the *file's own directory*.
      const resolved = path.resolve(agentforgeSrcDir, ...Array(upCount).fill('..'), rest);
      references.push({ file: filename, resolved: path.relative(repoRoot, resolved).replace(/\\/g, '/') });
    }
  }
  return references;
}

test('every on-disk directory a src module locates via new URL(..., import.meta.url) is copied into the Docker image', () => {
  const copied = copiedSourcePaths(dockerfileText).map((p) => p.replace(/\\/g, '/'));
  assert.ok(copied.length > 0, 'could not find any COPY lines in the Dockerfile — the parser or the file moved');
  const references = findUrlRelativeReferences();
  assert.ok(references.length > 0, 'could not find any new URL(...) references — the scan pattern or agentforge/src moved');
  const uncovered = references.filter(({ resolved }) => !copied.some((source) => resolved === source || resolved.startsWith(`${source.replace(/\/$/, '')}/`)));
  assert.deepEqual(uncovered, [], `Dockerfile is missing a COPY for: ${uncovered.map((item) => `${item.resolved} (referenced by src/${item.file})`).join(', ')}`);
});

test('the Dockerfile explicitly copies the guideline corpus directory', () => {
  // Named regression case for the specific finding, kept alongside the
  // generic scan above so this exact defect has its own guard even if the
  // generic scan's pattern ever stops matching guidelineEvidence.js.
  assert.match(dockerfileText, /^\s*COPY\s+agentforge\/corpus\s+agentforge\/corpus\s*$/m);
});
