# Week 2 requirements by submission stage

Source: `Week 2 PRD - AgentForge Clinical Co-Pilot.pdf` (local copy at `C:\Users\david\OneDrive\Desktop\Week 2 PRD - AgentForge Clinical Co-Pilot.pdf`); concise working index, not a replacement for the assignment.

| Requirement | Early submission | Final submission | Current evidence / remaining |
|---|---|---|---|
| Deployed working demo | Required | Required, final candidate | W2 `/agentforge-w2` deployed and health/page/API verified at `41682f5`; manual browser walkthrough and recording remain. |
| Two filled document types | Thin usable slice | Robust lab PDF + intake form | Four synthetic PDFs, two layouts/type; 38/38 exact, cited fields; clean computer-generated inputs only. |
| Scan robustness | Show honest current limit | Harder scan-artifact evaluation; handle unclear inputs by abstaining | Local Tesseract and VLM sources measured on blank documents; no harder filled clinical scan benchmark yet. ClinOCR-Bench is the recommended synthetic corpus. |
| Supervisor and two workers | Working handoffs | Reliable routing, failure/partial paths, traces | Implemented and tested; verify a full public UI run in recording. |
| Grounded citations and preview | Show source and cited values | Machine-readable quote/page/field plus click-to-source box overlay | API returns page-region boxes. Confirm overlay behavior in browser; assignment calls overlay a hard gate. |
| Hybrid RAG + rerank | A credible grounded retrieval path | Sparse+dense retrieval, rerank, source metadata, quality evidence | Local retrieval path exists; verify rubric-level hybrid/rerank behavior and document exact scope in final evidence. |
| Golden evaluation | Eval framework and visible result | 50-case set, per-rubric threshold, regression blocking (assignment allows CI or hook) | Current W2 gate passes 50/50; injected-defect proof exists. User does not want hosted CI; ensure a local hook/blocking command and record it if required by rubric. |
| Observability | Show redacted traces/alerts | Per-step latency, tokens/cost, extraction confidence, retrieval hits, eval outcome; no raw content | Deployed observability and trace evidence exist. Cost/latency report needs current W2 provider measurements. |
| OpenEMR source/fact round trip | State limitation if incomplete | Synthetic docs and derived facts stored with provenance and dedupe | W2 route uses isolated in-memory synthetic storage; no OpenEMR round trip. This is a material final rubric gap; preserve W1 read-only behavior. |
| Provider | Experimental comparison is sufficient | Select and measure extraction/VLM provider on hard cases | Optional Gemini scan adapter is integrated behind server-only `GEMINI_API_KEY`; deployed result on the hard synthetic scans is pending. User's Google AI Studio outputs here were 26/26 exact fields over 3 generated PDFs; lab-A was reported done but output is not in this record. Never commit the key. |
| Final evidence package | 3–5 minute deployed demo | Architecture, schemas/tests, dataset/results, cost/latency, deployed app, demo, social post | Current evidence/docs are partial and have stale/contradictory older package notes to reconcile. Video and final cost/latency/package remain. |
| Third doc type / lab trend | Not needed | Stretch only unless assignment owner clarifies otherwise | Deferred. Keep focus on two document types and core gates. |

## Immediate order

1. Add a small ClinOCR-Bench synthetic scan-artifact sample and score OCR separately from structured-field/citation quality.
2. Deploy the opt-in Gemini adapter with a server-side key; compare it with Tesseract on the same hard synthetic cases and fail closed on invalid schema, unsupported values, or unverifiable citations.
3. Confirm the deployed citation overlay, hybrid retrieval/rerank claim, browser flow, and redacted observability.
4. Close synthetic OpenEMR round-trip and local regression-hook gaps for final if the assignment's full brief remains controlling.
5. Record the 3–5 minute deployed demo; finish current-candidate architecture and cost/latency evidence.
