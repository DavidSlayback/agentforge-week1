# Week 2 requirements by submission stage

> **Historical (2026-09-23 working index for the early W2 checkpoint).** Kept as a record; several statements below are no
> longer true. For example, W2 now stores documents, derived facts and lab
> rows in OpenEMR, and the critic, the `medication_list` type and the lab
> trend chart are built. Current state: the root
> [`W2_ARCHITECTURE.md`](../../W2_ARCHITECTURE.md) §2 and the completion
> record in [`PLAN.md`](PLAN.md).

Source: `Week 2 PRD - AgentForge Clinical Co-Pilot.pdf` (local copy at `C:\Users\david\OneDrive\Desktop\Week 2 PRD - AgentForge Clinical Co-Pilot.pdf`); concise working index, not a replacement for the assignment.

| Requirement | Early submission | Final submission | Current evidence / remaining |
|---|---|---|---|
| Deployed working demo | Required | Required, final candidate | Current W2 deployment passes public health/readiness and one Lab B browser workflow in local mode (12 cited fields); recording remains. Four-sample/38-field benchmark is from prior candidate `41682f5`. |
| Two filled document types | Thin usable slice | Robust lab PDF + intake form | Four synthetic PDFs, two layouts/type; prior candidate scored 38/38 exact, cited fields. Current public UI exposes both types; clean computer-generated inputs only. |
| Scan robustness | Show honest current limit | Harder scan-artifact evaluation; handle unclear inputs by abstaining | Local Tesseract and VLM sources measured on blank documents; no harder filled clinical scan benchmark yet. ClinOCR-Bench is the recommended synthetic corpus. |
| Supervisor and two workers | Working handoffs | Reliable routing, failure/partial paths, traces | Implemented and tested; verify a full public UI run in recording. |
| Grounded citations and preview | Show source and cited values | Machine-readable quote/page/field plus click-to-source box overlay | API returns page-region boxes. Confirm overlay behavior in browser; assignment calls overlay a hard gate. |
| Hybrid RAG + rerank | A credible grounded retrieval path | Sparse+dense retrieval, rerank, source metadata, quality evidence | Local retrieval path exists; verify rubric-level hybrid/rerank behavior and document exact scope in final evidence. |
| Golden evaluation | Eval framework and visible result | 50-case set, per-rubric threshold, regression blocking | The 50-case W2 gate and injected-defect proof passed on a previous candidate. No hosted CI is needed; expose the evaluator and state which candidate produced the result. |
| Observability | Show a redacted trace or alert view | Per-step latency, tokens/cost, extraction confidence, retrieval hits, eval outcome; no raw content | Dashboard and alert view are public; the trace window was empty after restart. If no new trace is available, state that accurately. Cost/latency report needs current W2 provider measurements. |
| OpenEMR source/fact round trip | State limitation if incomplete | Synthetic docs and derived facts stored with provenance and dedupe | W2 route uses isolated in-memory synthetic storage; no OpenEMR round trip. This is a material final rubric gap; preserve W1 read-only behavior. |
| Provider | Experimental comparison is sufficient | Select and measure extraction/VLM provider on hard cases | Gemini 3.8 Flash adapter and server-only key are configured; two public calls returned Google HTTP 503. Active W2 mode is local Tesseract so the demo works. User's Google AI Studio outputs here were 26/26 exact fields over 3 generated PDFs; lab-A was reported done but output is not in this record. Never commit the key. |
| Final evidence package | 3–5 minute deployed demo | Architecture, schemas/tests, dataset/results, cost/latency, deployed app, demo, social post | Early work remaining: recording plus a fresh redacted trace to show in it. Provider choice is not required early; final cost/latency, hard-scan results, and package remain open. |
| Third doc type / lab trend | Not needed | Stretch only unless assignment owner clarifies otherwise | Deferred. Keep focus on two document types and core gates. |

## Immediate order

1. Add a small ClinOCR-Bench synthetic scan-artifact sample and score OCR separately from structured-field/citation quality.
2. When Google is available, exercise the bounded retry path and compare Gemini with Tesseract on the same hard synthetic cases; fail closed on invalid schema, unsupported values, or unverifiable citations.
3. Confirm the deployed citation overlay, hybrid retrieval/rerank claim, browser flow, and redacted observability.
4. Close synthetic OpenEMR round-trip and local regression-hook gaps for final if the assignment's full brief remains controlling.
5. Record the 3–5 minute deployed demo; finish current-candidate architecture and cost/latency evidence.
