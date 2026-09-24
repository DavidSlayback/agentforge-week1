#!/usr/bin/env node
// Precompute corpus embeddings for the S5 hybrid retriever.
//
// Run this where GEMINI_API_KEY is set (a real Google AI key). It calls the
// live Gemini embedding endpoint once per corpus chunk (taskType
// RETRIEVAL_DOCUMENT) and writes agentforge/corpus/embeddings.json. The
// deployed server never calls this script or embeds the corpus itself; it
// only loads this file and embeds the *query* at request time
// (guidelineEvidence.js). If this file is absent, the hybrid retriever
// degrades to BM25-only (`degraded: 'sparse_only'`) rather than failing.
//
//   GEMINI_API_KEY=... node agentforge/scripts/build-corpus-embeddings.mjs
//
// Mutating: overwrites agentforge/corpus/embeddings.json. Review the diff
// (chunk count, dimensions) before committing.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLiveGeminiClient, GEMINI_EMBED_DIMENSIONS, GEMINI_EMBED_MODEL } from '../src/geminiClient.js';
import { loadGuidelineCorpus } from '../src/guidelineEvidence.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is required to build corpus embeddings.');
  process.exit(1);
}

const outputPath = fileURLToPath(new URL('../corpus/embeddings.json', import.meta.url));
const corpus = loadGuidelineCorpus();
const client = createLiveGeminiClient({ apiKey });

console.log(`Embedding ${corpus.length} corpus chunks with ${GEMINI_EMBED_MODEL} (dimensions=${GEMINI_EMBED_DIMENSIONS})...`);

const vectors = {};
let totalInputTokens = 0;
let totalCostUsd = 0;
for (const [index, chunk] of corpus.entries()) {
  const text = `${chunk.title}\n${chunk.section}\n${chunk.text}`;
  const { values, usage } = await client.embed(text, 'RETRIEVAL_DOCUMENT');
  vectors[chunk.source_id] = values;
  totalInputTokens += usage.inputTokens || 0;
  totalCostUsd += usage.estimatedCostUsd || 0;
  console.log(`  [${index + 1}/${corpus.length}] ${chunk.source_id}`);
}

const output = {
  schema_version: 'agentforge-corpus-embeddings-v1',
  model: GEMINI_EMBED_MODEL,
  dimensions: GEMINI_EMBED_DIMENSIONS,
  generated_at: new Date().toISOString(),
  corpus_chunk_count: corpus.length,
  estimated_build_cost_usd: Number(totalCostUsd.toFixed(6)),
  vectors,
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${outputPath} (${corpus.length} vectors, ~${totalInputTokens} input tokens, ~$${output.estimated_build_cost_usd} estimated).`);
