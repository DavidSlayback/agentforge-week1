import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DEMO_KEY_REQUEST, TEST_MINT_ENV, waitForServer } from './helpers/testServer.js';

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
  // W3 hardening (H2): agentforge/test is not in the image. Its fixtures are
  // read only by the offline gate and benchmark helpers (recorded Gemini
  // client, retrieval benchmark, W2 regression gate), never by the running
  // server; the next test runs the server with such reads forbidden.
  const uncovered = references.filter(({ resolved }) => !resolved.startsWith('agentforge/test/')).filter(({ resolved }) => !copied.some((source) => resolved === source || resolved.startsWith(`${source.replace(/\/$/, '')}/`)));
  assert.deepEqual(uncovered, [], `Dockerfile is missing a COPY for: ${uncovered.map((item) => `${item.resolved} (referenced by src/${item.file})`).join(', ')}`);
});

test('the Dockerfile explicitly copies the guideline corpus directory', () => {
  // Named regression case for the specific finding, kept alongside the
  // generic scan above so this exact defect has its own guard even if the
  // generic scan's pattern ever stops matching guidelineEvidence.js.
  assert.match(dockerfileText, /^\s*COPY\s+agentforge\/corpus\s+agentforge\/corpus\s*$/m);
});

test('the Docker image does not copy agentforge/test', () => {
  assert.doesNotMatch(dockerfileText, /^\s*COPY\s+agentforge\/test/m);
  assert.match(dockerfileText, /^USER node\s*$/m, 'the image runs as the unprivileged node user');
});

test('the running server reads nothing under agentforge/test (scan, follow-up, evals and readiness routes)', async () => {
  const port = 18997;
  const base = `http://127.0.0.1:${port}`;
  const dir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'agentforge-notest-'));
  const child = spawn(process.execPath, ['--import', './agentforge/test/helpers/forbidTestReads.mjs', 'agentforge/src/server.js'], { cwd: repoRoot, env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: 'synthetic-test-secret', AGENTFORGE_SYNTHETIC_CONTEXT: 'true', AGENTFORGE_PROVIDER_MODE: 'deterministic', AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json'), ...TEST_MINT_ENV }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    await waitForServer(child, { port, path: '/ready' });
    const post = (route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    for (const route of ['/health', '/ready', '/evals', '/evals/w2-baseline.json', '/evals/w2-extension-baseline.json', '/evals/deployed-service-results.json', '/v1/metrics', '/observability']) assert.equal((await fetch(`${base}${route}`)).status, 200, route);
    const write = await (await fetch(`${base}/v1/source-document-context?patient_uuid=fixture-patient-001`, DEMO_KEY_REQUEST)).json();
    const read = await (await fetch(`${base}/v1/demo-context?patient_uuid=fixture-patient-001`, DEMO_KEY_REQUEST)).json();
    const content = fs.readFileSync(path.join(repoRoot, 'docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt')).toString('base64');
    const upload = await (await post('/v1/source-documents', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: write.demo_token, document_type: 'lab_pdf', filename: 'lab.scan.txt', content_base64: content })).json();
    assert.equal((await post('/v1/scan-supervisor', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: write.demo_token, source_document_id: upload.source_document.id, message: 'What was the A1C value?' })).status, 200);
    assert.equal((await post('/v1/follow-up-evidence', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: read.demo_token, message: 'What changed since the last visit?' })).status, 200);
    assert.equal((await post('/v1/briefings', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: read.demo_token })).status, 200);
    assert.doesNotMatch(stderr, /FORBIDDEN_TEST_READ/);
  } finally {
    await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
