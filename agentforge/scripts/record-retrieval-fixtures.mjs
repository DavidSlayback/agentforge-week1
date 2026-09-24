#!/usr/bin/env node
// Record real Gemini embed/rerank responses as deterministic test fixtures.
//
// Run this where GEMINI_API_KEY is set, after agentforge/corpus/embeddings.json
// already exists (run build-corpus-embeddings.mjs first). It runs the real
// hybrid retrieval pipeline for a representative set of queries — the same
// ones the W2 gate's retrieval cases (fc-08/fc-09/fc-10 in
// src/w2RegressionGate.js) and guideline-evidence.test.js exercise — against
// the live Gemini client, and writes each embed/rerank request+response pair
// to agentforge/test/fixtures/retrieval/<hash>.json.
//
// Once these fixtures exist, `createRecordedOrStubGeminiClient` (used by
// tests and the gate) finds them automatically and uses the real recorded
// output instead of the deterministic stand-in — no test code changes
// needed. Keep this list in sync with the queries those tests actually send;
// an unrecorded query silently falls back to the stand-in rather than
// failing, so drift here just means lower fidelity, not a broken build.
//
//   GEMINI_API_KEY=... node agentforge/scripts/record-retrieval-fixtures.mjs
//
// Mutating: writes new files under agentforge/test/fixtures/retrieval/.
// Review the diff before committing.
import { createLiveGeminiClient, createRecordingGeminiClient } from '../src/geminiClient.js';
import { createGeminiHybridGuidelineRetriever, loadCorpusEmbeddings, loadGuidelineCorpus } from '../src/guidelineEvidence.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is required to record retrieval fixtures.');
  process.exit(1);
}

const embeddings = loadCorpusEmbeddings();
if (!embeddings) {
  console.error('agentforge/corpus/embeddings.json is missing or empty. Run build-corpus-embeddings.mjs first.');
  process.exit(1);
}

// Kept in sync with src/w2RegressionGate.js's Q.* constants and
// test/guideline-evidence.test.js's queries.
const REPRESENTATIVE_QUERIES = [
  'Abnormal findings: A1C abnormal. A1C blood sugar diabetes diagnosis threshold',
  'Chief concern: Fatigue for two weeks. evaluate feeling tired and weak for possible anemia',
  'Chief concern: Dizziness after standing. reconcile current medicine list against prior records pharmacy',
  'quasar galaxies nebula astronomy',
  'orthopedic knee replacement rehabilitation protocol',
];

const liveClient = createLiveGeminiClient({ apiKey });
const recordingClient = createRecordingGeminiClient({ liveClient });
const retriever = createGeminiHybridGuidelineRetriever({ geminiClient: recordingClient, corpus: loadGuidelineCorpus(), embeddings });

for (const query of REPRESENTATIVE_QUERIES) {
  console.log(`Recording: ${query}`);
  const result = await retriever.retrieve(query, { topK: 3 });
  console.log(`  status=${result.status} degraded=${result.degraded} top=${result.evidence[0]?.citation.source_id || '(none)'}`);
}

console.log('Done. Fixtures written under agentforge/test/fixtures/retrieval/.');
