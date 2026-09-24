# Retrieval fixtures

Recorded real Gemini embed/rerank responses, one JSON file per request, named
`<hash>.json` where `<hash>` is `geminiRequestHash` (`src/geminiClient.js`) of
that exact request's defining fields.

None are committed yet — no `GEMINI_API_KEY` is available in this
environment. Until they exist, `createRecordedOrStubGeminiClient` (used by
every test and by the W2 eval gate) falls back to a deterministic,
honestly-labeled stand-in (`recorded-or-stub`; see `src/geminiClient.js`) so
the hybrid pipeline's *shape* — sparse ∪ dense candidates, union, rerank,
threshold — is still exercised without a key.

To record real fixtures:

```bash
GEMINI_API_KEY=... node agentforge/scripts/build-corpus-embeddings.mjs
GEMINI_API_KEY=... node agentforge/scripts/record-retrieval-fixtures.mjs
```

Once a file for a given request exists here, `createRecordedOrStubGeminiClient`
picks it up automatically — no test code changes required. Commit the
resulting files; they contain only Gemini's output for the fixed, synthetic
queries in `record-retrieval-fixtures.mjs` (real guideline text, no PHI).
