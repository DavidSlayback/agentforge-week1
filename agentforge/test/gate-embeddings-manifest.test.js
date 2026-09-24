import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRetrievalFixtureManifest } from '../src/geminiClient.js';
import { corpusEmbeddingsFingerprint } from '../src/guidelineEvidence.js';

test('fixture manifest is absent unless the recorder completed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixtures-'));
  assert.equal(readRetrievalFixtureManifest(dir), null);
  fs.writeFileSync(path.join(dir, 'COMPLETE.json'), JSON.stringify({ embeddings_fingerprint: 'abc' }));
  assert.equal(readRetrievalFixtureManifest(dir).embeddings_fingerprint, 'abc');
});

test('embeddings fingerprint depends on the vectors, not on file formatting', () => {
  const a = { model: 'm', vectors: { c1: [0.1, 0.2] } };
  assert.equal(corpusEmbeddingsFingerprint(a), corpusEmbeddingsFingerprint(JSON.parse(JSON.stringify(a, null, 2).replace(/\n/g, '\r\n'))));
  assert.notEqual(corpusEmbeddingsFingerprint(a), corpusEmbeddingsFingerprint({ vectors: { c1: [0.1, 0.3] } }));
});
