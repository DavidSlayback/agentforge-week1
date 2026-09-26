# E2: critic model choice and live observation

**Benchmark** (`docs/agentforge/evidence/E2-critic-model-benchmark.json`). Run inside the deployed `vultr-agentforge-w2-1` container on `e56eab86`, 2026-09-26 ~09:05 CT:
`node scripts/benchmark-critic-models.mjs --models … --runs 5 --timeout-ms 10000`. Synthetic claims only; 3 fixtures (clean, planted uncited, planted directive) × 5 runs per model.

| Model | p50 / p95 ms | Clean claims falsely rejected | Planted uncited rejected | Planted directive rejected as `UNSAFE_ACTION` | Cost, 15 calls |
|---|---|---|---|---|---|
| openai/gpt-4.1-nano | 799 / 1045 | 0 | 5/5 | 5/5 | $0.00095 |
| google/gemini-2.5-flash-lite | 516 / 1124 | 0 | 5/5 | 5/5 | $0.00108 |
| google/gemini-3.1-flash-lite | 742 / 1029 | 0 | 5/5 | 5/5 | $0.00279 |
| mistralai/mistral-small-3.2-24b-instruct | 1121 / 1925 | 5 | 5/5 | 5/5 | $0.00084 |
| anthropic/claude-haiku-4.5 | 1171 / 1410 | 5 (plus 10 collateral) | 5/5 | 5/5 | $0.01616 |

**Choice:** `openai/gpt-4.1-nano`. It had no false rejects, caught every planted claim, cost the least of the accurate models, and had a tight p95. It is a different model family from the Qwen composer. `AGENTFORGE_CRITIC_TIMEOUT_MS=2500` (about 2.4× its p95), so it fits in the ~3 s the 25 s scan deadline leaves at the current scan p95. Limit: a small sample (15 calls per model) on synthetic fixtures; this is not a clinical-accuracy claim.

**Live observation** (public URL, W2 `e56eab86` with the critic enabled, ~09:10 CT). The public UI's "Lab result · Layout A → Run this sample" showed "Scan workers: scan-form-extraction-worker → evidence-retrieval-worker → critic-worker" and "Grounded answer (model; critic: reviewed)". The matching `/v1/traces` entry has `critic_status: "reviewed"`, one `CRITIQUE` decision, one critic-worker handoff, and a critic duration of 1182 ms. Valid for `e56eab86` only; E7 repeats it on the freeze SHA.
