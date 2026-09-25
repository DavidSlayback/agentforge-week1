# AgentForge Week 2: cost and latency report

**Scope:** the W2 scan path (upload → OCR → extraction → hybrid retrieval →
grounded answer) on the public deployment, synthetic data only. Every
measured number names its commit and source. Projections are Fermi
estimates with their assumptions written out; they are not provider quotes.

## 1. Measured per-scan usage (live)

Source: 14 `w2-scan-supervisor` traces from `GET /agentforge-w2/v1/traces`
on `00e43da`, plus the 12-run `measure-live-metrics.mjs` batch on `131d5a3`
(`KEY_METRICS.md`). One "scan" is one uploaded document answered once.

| Stage | Model | Avg input tokens | Avg output tokens | Calls per scan |
|---|---|---|---|---|
| Query embedding | `gemini-embedding-2` | 15 | 0 | 1 |
| Listwise rerank (top 12) | `qwen3.8-flash` | 1,003 | 183 | 1 |
| Grounded answer | `qwen3.8-flash`, thinking off | 1,043 | 395 | 1 (up to 3 on invalid JSON) |
| **Total** | | **~2,060** | **~580** | |

OCR (`pdftoppm` + Tesseract) runs locally on the VM and has no per-call fee.

## 2. Unit cost

Prices from official pricing pages, retrieved 2026-09-24:

| Model | Input / 1M | Output / 1M | Source |
|---|---|---|---|
| `qwen3.8-flash`, Beijing (our endpoint's region) | $0.113 | $0.382 | [Model Studio pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing) |
| `qwen3.8-flash`, Singapore (international) | $0.15 | $0.47 | same page; 1M free tokens for 90 days |
| `gemini-embedding-2` | $0.20 | — | [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) |

| Unit | Beijing rate | Singapore rate |
|---|---|---|
| One scan | **$0.00046** | **$0.00058** |
| One encounter (a lab PDF + an intake form = 2 scans) | **~$0.0009** | **~$0.0012** |
| Worst case per scan (3 answer attempts) | ~$0.0010 | ~$0.0013 |

Since `dcaa180`, every trace records these costs per stage (`modelTotals.cost_usd`). Two live scans on that commit: $0.00038 (lab PDF) and $0.00055 (intake form). A follow-up encounter costs about a tenth of a cent in model calls. The
account may be on a prepaid Alibaba "token plan" (the endpoint host is
`token-plan.cn-beijing.maas.aliyuncs.com`); if so, marginal cost inside the
plan is lower than list price. This report uses list price.

## 3. Latency (live)

| Measure | p50 | p95 | n | Commit |
|---|---|---|---|---|
| Upload-to-answer wall time, mixed cold/warm | 11.1 s | 22.1 s | 12 | `131d5a3` |
| Upload-to-answer wall time, mostly warm OCR cache | 11.2 s | 16.5 s | 12 | `00e43da` |
| Cold scan (first upload of a document), total | 14.4–16.1 s (range) | | 4 | `00e43da` |

Per stage, from the 14 traces on `00e43da`:

| Stage | p50 | p95 | Notes |
|---|---|---|---|
| Source preparation (render + OCR) | 0 s warm; **5.4–7.8 s cold** | 7.8 s | Cached by content hash; cold n = 4 |
| Extraction (label map → Zod) | 3 ms | 15 ms | Pure CPU, negligible |
| Retrieval (embed + BM25 + fusion + Qwen rerank) | 4.0 s | 5.6 s | Two network round trips; the rerank is an LLM call |
| Answer (Qwen compose + verify) | 4.9 s | 9.2 s | Output generation dominates; verification is milliseconds |

Target (`KEY_METRICS.md`): p95 ≤ 30 s. Met on both runs. The per-request
deadline is 25 s (`AGENTFORGE_SCAN_DEADLINE_MS`); past it the answer falls
back to the deterministic composer rather than hang.

## 4. Bottleneck analysis

1. **Cold OCR, 5.4–7.8 s (37–48% of a cold scan).** CPU-bound on a 2-vCPU
   VM. It already runs once per unique document (content-hash cache), so a
   re-open is instant. Next steps if it matters: render at a lower DPI for
   clean vector PDFs, OCR pages in parallel, or skip OCR for PDFs with a text
   layer.
2. **Answer generation, 4.9 s p50 / 9.2 s p95.** Output tokens are
   sequential. The label-reference contract already cut expected output by
   ~70%; the remaining lever is fewer, shorter claims or streaming.
3. **Retrieval, 4.0 s p50.** The listwise rerank is a full LLM call. A
   dedicated reranker behind the existing `Reranker` interface (Cohere
   adapter already written, not deployed) should take this under a second.
   Embedding and rerank could also overlap with OCR for intake forms, whose
   query does not depend on extracted values.

The model stages are network-bound and scale with provider quota. OCR is the
only stage that scales with our own CPU.

## 5. Actual development spend

| Item | Spend | Source |
|---|---|---|
| Gemini API | **$0** | Free-tier key (20 requests/day cap hit during W2; that is why reranking moved to Qwen) |
| Qwen (Alibaba Model Studio) | **~$1–2 at most (Fermi)**; exact figure pending the owner's console | Development used on the order of hundreds to low thousands of calls at ~2.6k tokens each: under ~5M tokens, about $1 at Singapore list price even if all of it were billed; the 1M-token free quota and a token plan may cover part of it |
| Vultr VM (OpenEMR + MariaDB + Caddy + W1 + W2 on one host) | Pending the owner's billing readback | 2 vCPU / 4 GB / 80 GB instance; W1 recorded $1.36 charged and $28.64 credit remaining (`docs/agentforge/COST_MODEL.md`) |
| AI coding assistants | Owner's subscriptions; not attributed per project | — |

## 6. Projected production cost

**Assumptions (explicit, not observed):**

- A user is one clinician seeing 20 follow-up visits a day for 21 working
  days (420 encounters/month), each with a lab PDF and an intake form
  (**840 scans/month**). This is a heavy-use upper bound; W1's model assumed
  4 prep sessions a month.
- Model cost at Singapore list price ($0.00058/scan), the higher of the two.
- One 2-vCPU OCR worker handles ~600 cold scans/hour at 50% utilization
  (2 concurrent OCR jobs × 6 s each). Demand is ~4.4 scans/hour per clinician
  on average, ~9 at peak, so **one worker serves ~65 clinicians**. Worker
  cost is assumed ~$20/month (2 vCPU / 4 GB class VM; confirm against the
  actual plan).
- Excluded: the EMR itself (OpenEMR/MySQL hosting is the clinic's existing
  cost), document storage (~84 MB/clinician/month at ~100 KB per PDF),
  egress, monitoring, support, and compliance work.

| Users (clinicians) | Scans / month | Model tokens / month | Model cost / month | OCR workers | Compute / month | **Total / month** | Per clinician |
|---|---|---|---|---|---|---|---|
| 100 | 84K | ~0.22B | ~$49 | 2 | ~$40 | **~$90** | ~$0.90 |
| 1,000 | 840K | ~2.2B | ~$490 | ~16 | ~$320 | **~$0.8K** | ~$0.80 |
| 10,000 | 8.4M | ~22B | ~$4.9K | ~155 | ~$3.1K | **~$8K** | ~$0.80 |
| 100,000 | 84M | ~220B | ~$49K | ~1,550 | ~$31K | **~$80K** | ~$0.80 |

What changes along the way:

- **100 → 1K:** the single-host compose stack stops being enough. OCR moves
  to a queue with autoscaled workers; the app tier becomes stateless behind
  a load balancer; traces move from the in-process file sink to a real store.
- **10K:** provider throughput becomes the constraint, not price. Average load
  is ~1.9M tokens/minute across both Qwen calls, several times that at
  peak. It needs confirmed quota, a second provider behind the existing
  `ResilientProvider`, and per-tenant rate limits.
- **100K:** OCR compute rivals model spend. Skipping OCR for text-layer PDFs
  and using bigger, reserved instances would cut it substantially.
- **At any scale with real patients**, the Beijing endpoint and a free-tier
  Gemini key are not acceptable for PHI. Production needs a provider under a
  business associate agreement, in-region. That changes unit prices, and this
  projection should be re-run with those rates. The architecture does not
  change: the provider sits behind one interface.

## 7. Reproduce

```bash
# Live latency, grounding and fallback (synthetic fixtures, public URL)
AGENTFORGE_LIVE_URL=https://dtstest.64.177.10.182.nip.io/agentforge-w2 \
  AGENTFORGE_LIVE_RUNS=3 node agentforge/scripts/measure-live-metrics.mjs

# Per-stage timings and token usage for recent scans
curl -s https://dtstest.64.177.10.182.nip.io/agentforge-w2/v1/traces
```
