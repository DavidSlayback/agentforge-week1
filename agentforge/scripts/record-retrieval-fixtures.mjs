#!/usr/bin/env node
// Record real Gemini embed/rerank responses as deterministic test fixtures.
//
// Run this where GEMINI_API_KEY is set, after agentforge/corpus/embeddings.json
// already exists (run build-corpus-embeddings.mjs first). It runs the real
// hybrid retrieval pipeline against the live Gemini client for every
// distinct query the W2 gate's 50 cases actually formulate —
// `goldenScenarioQueries()` (src/w2RegressionGate.js) derives these straight
// from each case's target document's truth file and its own clinician
// question, the same way `runEvidenceWorker` (activeWorkers.js) formulates a
// query for real — so this list can never drift out of sync with what the
// gate sends the way a hand-maintained duplicate list could.
//
// Each embed/rerank request+response pair is written to
// agentforge/test/fixtures/retrieval/<hash>.json. Once a fixture exists,
// `createRecordedOrStubGeminiClient` (used by tests and the gate) finds it
// automatically and uses the real recorded output instead of the
// deterministic stand-in — no test code changes needed.
//
//   GEMINI_API_KEY=... node agentforge/scripts/record-retrieval-fixtures.mjs
//
// Exits non-zero (without treating the run as successful) if any query's
// live retrieval degraded to sparse-only — that means a real embed/rerank
// call failed, which would otherwise silently write an incomplete or
// missing set of fixtures.
//
// Mutating: writes new files under agentforge/test/fixtures/retrieval/.
// Review the diff before committing.
import { createLiveGeminiClient, createRecordingGeminiClient } from '../src/geminiClient.js';
import { createGeminiHybridGuidelineRetriever, loadCorpusEmbeddings, loadGuidelineCorpus } from '../src/guidelineEvidence.js';
import { goldenScenarioQueries } from '../src/w2RegressionGate.js';

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

const queries = goldenScenarioQueries();
if (!queries.length) {
  console.error('goldenScenarioQueries() returned no queries — the gate case set or its golden fixtures may have moved.');
  process.exit(1);
}

const liveClient = createLiveGeminiClient({ apiKey });
const recordingClient = createRecordingGeminiClient({ liveClient });
const retriever = createGeminiHybridGuidelineRetriever({ geminiClient: recordingClient, corpus: loadGuidelineCorpus(), embeddings });

// Free-tier Gemini keys allow ~5 rerank requests/minute; set e.g.
// AGENTFORGE_RECORD_DELAY_MS=13000 to stay under it.
const delayMs = Number(process.env.AGENTFORGE_RECORD_DELAY_MS || 0);
const degraded = [];
for (const [index, query] of queries.entries()) {
  if (index && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  console.log(`Recording: ${query}`);
  const result = await retriever.retrieve(query, { topK: 3 });
  console.log(`  status=${result.status} degraded=${result.degraded} top=${result.evidence[0]?.citation.source_id || '(none)'}`);
  if (result.degraded) degraded.push({ query, reason: result.degraded_reason || result.degraded });
}

if (degraded.length) {
  console.error(`\n${degraded.length}/${queries.length} quer${degraded.length === 1 ? 'y' : 'ies'} degraded to sparse-only instead of recording a real Gemini response:`);
  for (const item of degraded) console.error(`  - ${item.reason}: ${item.query}`);
  console.error('\nFixtures for the queries above were NOT written. Check GEMINI_API_KEY, network access, and rate limits, then rerun.');
  process.exit(1);
}

console.log(`\nDone. Recorded ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}. Fixtures written under agentforge/test/fixtures/retrieval/.`);
