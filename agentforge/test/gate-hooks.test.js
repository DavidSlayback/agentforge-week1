import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LIVE_OCR_TEST_FILES, liveOcrSkip } from './helpers/ocrTools.js';

// H5: the pre-commit hook, the pre-push hook and .gitlab-ci.yml must stay in
// sync, and live-OCR tests must never skip silently.
const repoRoot = new URL('../../', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, repoRoot), 'utf8').replace(/\r\n/g, '\n');
const preCommit = read('.githooks/pre-commit');
const prePush = read('.githooks/pre-push');
const ci = read('.gitlab-ci.yml');
const dockerfile = read('Dockerfile');

test('both hooks refuse a working tree that differs from what is committed or pushed', () => {
  for (const hook of [preCommit, prePush]) assert.match(hook, /\. "\$repo_root\/\.githooks\/lib\/gated-tree\.sh"/);
  assert.match(preCommit, /^require_gated_tree_matches index$/m);
  assert.match(prePush, /^require_gated_tree_matches head$/m);
  assert.match(prePush, /local_sha" != "\$head_sha"/);
});

test('the pre-commit hook runs the live-OCR tests and CI requires them', () => {
  assert.match(preCommit, /sh agentforge\/scripts\/run-ocr-tests\.sh/);
  assert.match(ci, /\.agentforge-node:\n {2}image: node:24-alpine\n {2}variables:\n {4}AGENTFORGE_REQUIRE_OCR: "1"/);
  for (const job of ['agentforge-tests', 'w2-regression-gate']) assert.match(ci, new RegExp(`${job}:\\n  extends: \\.agentforge-node`));
});

test('CI and the hook OCR image use the deployed Dockerfile base and OCR packages', () => {
  const base = /^FROM (\S+)/m.exec(dockerfile)?.[1];
  const packages = /^RUN apk add --no-cache (.*tesseract.*)$/m.exec(dockerfile)?.[1]?.split(/\s+/);
  assert.ok(base && packages?.length, 'Dockerfile must keep a FROM line and a RUN apk add ... tesseract line (scripts/run-ocr-tests.sh reads them)');
  assert.match(ci, new RegExp(`\\.agentforge-node:\\n  image: ${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  const ciPackages = /^\s+- apk add --no-cache (.*tesseract.*)$/m.exec(ci)?.[1]?.split(/\s+/) || [];
  for (const name of packages) assert.ok(ciPackages.includes(name), `.gitlab-ci.yml must install ${name} like the Dockerfile`);
});

test('every test that needs OCR tools uses liveOcrSkip and is listed for the OCR step', () => {
  const testDir = new URL('./', import.meta.url);
  const users = fs.readdirSync(testDir).filter((name) => name.endsWith('.test.js') && name !== 'gate-hooks.test.js').filter((name) => fs.readFileSync(new URL(name, testDir), 'utf8').includes('liveOcrSkip('));
  assert.deepEqual(users.map((name) => `test/${name}`).sort(), [...LIVE_OCR_TEST_FILES].sort());
  for (const name of fs.readdirSync(testDir).filter((item) => item.endsWith('.test.js'))) {
    const source = fs.readFileSync(new URL(name, testDir), 'utf8');
    assert.doesNotMatch(source, /spawnSync\(\s*tool\s*,\s*\[\s*'-v'/, `${name} probes OCR tools itself; use liveOcrSkip so the skip is visible and AGENTFORGE_REQUIRE_OCR applies`);
  }
});

test('liveOcrSkip fails instead of skipping when AGENTFORGE_REQUIRE_OCR=1', () => {
  assert.throws(() => liveOcrSkip('probe', ['agentforge-no-such-tool'], { AGENTFORGE_REQUIRE_OCR: '1' }), /AGENTFORGE_REQUIRE_OCR=1: live OCR test "probe" needs agentforge-no-such-tool/);
  const written = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
  try {
    assert.match(liveOcrSkip('probe', ['agentforge-no-such-tool'], {}), /needs agentforge-no-such-tool/);
  } finally {
    process.stderr.write = original;
  }
  assert.match(written.join(''), /SKIP live OCR test "probe"/);
});

// Behaviour of .githooks/lib/gated-tree.sh in a scratch repository. Git sets
// GIT_DIR/GIT_INDEX_FILE while a hook runs; they are removed so the scratch
// commands can never touch the real repository.
const scrubbedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const hasGit = !spawnSync('git', ['--version'], { stdio: 'ignore' }).error;

test('gated-tree.sh refuses unstaged and untracked gated files and accepts a matching tree', { skip: hasGit ? false : 'git is not on PATH' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-gated-tree-'));
  const run = (command, args) => spawnSync(command, args, { cwd: dir, env: scrubbedEnv, encoding: 'utf8' });
  const check = (mode) => run('sh', ['-c', `. ./gated-tree.sh; require_gated_tree_matches ${mode}`]);
  try {
    fs.copyFileSync(new URL('.githooks/lib/gated-tree.sh', repoRoot), path.join(dir, 'gated-tree.sh'));
    for (const args of [['init', '-q'], ['config', 'user.email', 'gate@example.invalid'], ['config', 'user.name', 'gate'], ['config', 'core.autocrlf', 'false']]) assert.equal(run('git', args).status, 0);
    fs.mkdirSync(path.join(dir, 'agentforge'));
    fs.writeFileSync(path.join(dir, 'agentforge', 'a.js'), 'one\n');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'outside gated paths\n');
    assert.equal(run('git', ['add', 'agentforge/a.js', 'gated-tree.sh']).status, 0);
    assert.equal(run('git', ['commit', '-q', '-m', 'init']).status, 0);
    assert.equal(check('index').status, 0, 'an untracked file outside gated paths is allowed');

    fs.writeFileSync(path.join(dir, 'agentforge', 'a.js'), 'two\n');
    const unstaged = check('index');
    assert.equal(unstaged.status, 1);
    assert.match(unstaged.stderr, /modified: agentforge\/a\.js/);

    assert.equal(run('git', ['add', 'agentforge/a.js']).status, 0);
    assert.equal(check('index').status, 0, 'staged changes are what gets committed');
    assert.equal(check('head').status, 1, 'pre-push: a staged but uncommitted change is not what is pushed');

    fs.writeFileSync(path.join(dir, 'agentforge', 'b.js'), 'new\n');
    const untracked = check('index');
    assert.equal(untracked.status, 1);
    assert.match(untracked.stderr, /untracked: agentforge\/b\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
