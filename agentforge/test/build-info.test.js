import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBuildSha } from '../src/buildInfo.js';

const SHA = 'a'.repeat(40);

function writeTemp(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'build-sha-')), 'BUILD_SHA');
  fs.writeFileSync(file, contents);
  return file;
}

test('stamped BUILD_SHA from git archive wins', () => {
  assert.equal(readBuildSha(writeTemp(`${SHA}\n`), { AGENTFORGE_GIT_SHA: 'b'.repeat(40) }), SHA);
});

test('unstamped placeholder falls back to a valid env SHA', () => {
  assert.equal(readBuildSha(writeTemp('$Format:%H$\n'), { AGENTFORGE_GIT_SHA: SHA }), SHA);
});

test('never reports a guessed or malformed SHA', () => {
  assert.equal(readBuildSha(writeTemp('$Format:%H$\n'), { AGENTFORGE_GIT_SHA: 'main' }), 'unversioned');
  assert.equal(readBuildSha(path.join(os.tmpdir(), 'does-not-exist', 'BUILD_SHA'), {}), 'unversioned');
});

test('the committed BUILD_SHA is an export-subst placeholder', () => {
  const committed = fs.readFileSync(new URL('../BUILD_SHA', import.meta.url), 'utf8').trim();
  assert.equal(committed, '$Format:%H$');
});
