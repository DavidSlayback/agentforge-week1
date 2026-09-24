#!/usr/bin/env node
// Record real embed responses (always Gemini) and real rerank responses
// (whichever reranker AGENTFORGE_RERANK_PROVIDER selects — Qwen by default
// for W2) as deterministic test fixtures.
//
// Run this where GEMINI_API_KEY is set (embeddings), after
// agentforge/corpus/embeddings.json already exists (run
// build-corpus-embeddings.mjs first), and where the configured reranker's
// own credentials are set — for the default Qwen lane, AGENTFORGE_MODEL_ENDPOINT
// and AGENTFORGE_MODEL_API_KEY (the same env the deployed Qwen synthesis lane
// already reads); for AGENTFORGE_RERANK_PROVIDER=gemini, GEMINI_API_KEY alone
// covers both. It runs the real hybrid retrieval pipeline for every distinct
// query the W2 gate's 50 cases actually formulate — `goldenScenarioQueries()`
// (src/w2RegressionGate.js) derives these straight from each case's target
// document's truth file and its own clinician question, the same way
// `runEvidenceWorker` (activeWorkers.js) formulates a query for real — so
// this list can never drift out of sync with what the gate sends the way a
// hand-maintained duplicate list could.
//
// Each embed request+response is written to
// agentforge/test/fixtures/retrieval/<hash>.json, keyed by model; each
// rerank request+response is written the same way, keyed by *provider and
// model* (reranker.js's `rerankFixtureHash`) so switching
// AGENTFORGE_RERANK_PROVIDER never finds and silently reuses a fixture
// recorded for a different reranker. Once fixtures exist,
// `createRecordedOrStubGeminiClient` (embed) and the matching
// recorded-or-stub reranker (used by tests and the gate) find them
// automatically and use the real recorded output instead of the
// deterministic stand-in — no test code changes needed.
//
//   GEMINI_API_KEY=... AGENTFORGE_MODEL_ENDPOINT=... AGENTFORGE_MODEL_API_KEY=... \
//     node agentforge/scripts/record-retrieval-fixtures.mjs
//
// Exits non-zero (without treating the run as successful) if any query's
// live retrieval degraded (sparse-only or no_rerank) — that means a real
// embed or rerank call failed, which would otherwise silently write an
// incomplete or missing set of fixtures.
//
// Mutating: writes new files under agentforge/test/fixtures/retrieval/.
// Review the diff before committing.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createLiveGeminiClient, createRecordingGeminiClient, defaultRetrievalFixturesDir, GEMINI_EMBED_MODEL } from '../src/geminiClient.js';
import { corpusEmbeddingsFingerprint, createGeminiHybridGuidelineRetriever, loadCorpusEmbeddings, loadGuidelineCorpus } from '../src/guidelineEvidence.js';
import { configuredRerankProviderAndModel, createCohereReranker, createGeminiReranker, createQwenReranker, createRecordingReranker } from '../src/reranker.js';
import { goldenScenarioQueries } from '../src/w2RegressionGate.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is required to record retrieval fixtures (dense retrieval always uses Gemini embeddings).');
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

const { providerKey, providerLabel, model: rerankModel } = configuredRerankProviderAndModel();

function buildLiveReranker() {
  if (providerKey === 'qwen') {
    const endpoint = process.env.AGENTFORGE_MODEL_ENDPOINT;
    const modelApiKey = process.env.AGENTFORGE_MODEL_API_KEY;
    if (!endpoint || !modelApiKey) {
      console.error('AGENTFORGE_RERANK_PROVIDER=qwen requires AGENTFORGE_MODEL_ENDPOINT and AGENTFORGE_MODEL_API_KEY (the same env the deployed Qwen synthesis lane reads).');
      process.exit(1);
    }
    return createQwenReranker({ endpoint, apiKey: modelApiKey, model: rerankModel, timeoutMs: Number(process.env.AGENTFORGE_RERANK_TIMEOUT_MS || 6000) });
  }
  if (providerKey === 'gemini') {
    return createGeminiReranker(createLiveGeminiClient({ apiKey, rerankModel }));
  }
  if (providerKey === 'cohere') {
    const cohereKey = process.env.AGENTFORGE_COHERE_API_KEY;
    if (!cohereKey) {
      console.error('AGENTFORGE_RERANK_PROVIDER=cohere requires AGENTFORGE_COHERE_API_KEY.');
      process.exit(1);
    }
    return createCohereReranker({ apiKey: cohereKey, model: rerankModel });
  }
  console.error(`Unsupported AGENTFORGE_RERANK_PROVIDER: ${providerKey}`);
  process.exit(1);
}

const liveEmbedClient = createLiveGeminiClient({ apiKey });
const recordingEmbedClient = createRecordingGeminiClient({ liveClient: liveEmbedClient });
const recordingReranker = createRecordingReranker({ liveReranker: buildLiveReranker(), provider: providerLabel, model: rerankModel });
const retriever = createGeminiHybridGuidelineRetriever({ embedClient: recordingEmbedClient, reranker: recordingReranker, corpus: loadGuidelineCorpus(), embeddings });

console.log(`Recording against reranker: ${providerLabel}:${rerankModel} (AGENTFORGE_RERANK_PROVIDER=${providerKey})`);

// Free-tier Gemini keys allow ~5 rerank requests/minute; set e.g.
// AGENTFORGE_RECORD_DELAY_MS=13000 to stay under it. Not needed for the
// default Qwen lane (no documented per-minute limit as tight as Gemini's
// free tier), but the knob applies to whichever reranker is configured.
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
  console.error(`\n${degraded.length}/${queries.length} quer${degraded.length === 1 ? 'y' : 'ies'} degraded instead of recording a real response:`);
  for (const item of degraded) console.error(`  - ${item.reason}: ${item.query}`);
  console.error('\nFixtures for the queries above were NOT written. Check GEMINI_API_KEY / the reranker credentials, network access, and rate limits, then rerun.');
  process.exit(1);
}

// Written only after a fully successful run: the gate uses the real corpus
// vectors (and real rerank fixtures) only when this fingerprint AND the
// rerank provider/model match its own configuration (w2RegressionGate.js).
writeFileSync(path.join(defaultRetrievalFixturesDir(), 'COMPLETE.json'), `${JSON.stringify({ embeddings_fingerprint: corpusEmbeddingsFingerprint(embeddings), embed_model: GEMINI_EMBED_MODEL, rerank_provider: providerLabel, rerank_model: rerankModel, queries: queries.length, recorded_at: new Date().toISOString() }, null, 2)}\n`);

console.log(`\nDone. Recorded ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'} against ${providerLabel}:${rerankModel}. Fixtures written under agentforge/test/fixtures/retrieval/.`);
