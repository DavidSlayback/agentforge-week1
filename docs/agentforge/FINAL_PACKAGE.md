# Week 2 reviewer package

Updated 2026-09-23. The synthetic W2 candidate at `cded30d` is deployed.
Provider selection and demo recording remain open.

## Candidate identity

- Staging branch: `davidslayback/w2-synthetic-scan-release`
- Deployed code commit: `cded30d` (`feat(agentforge): add local filled PDF OCR slice`)
- Public URL: <https://dtstest.64.177.10.182.nip.io/agentforge-w2/>
- Release directory: `/opt/agentforge-week1/.releases/agentforge-w2-cded30d`
- Existing deployment checks: [W2 deployment proof](evidence/W2_EXTERNAL_DEPLOYMENT_PROOF_6AB0EDC.json)
- Filled-PDF route check: [PDF OCR smoke proof](evidence/W2_PDF_OCR_SMOKE_PROOF_CDED30D.json)

The deployed surface remains synthetic-only. Week 1 `/agentforge` is healthy
and its container identity was unchanged during this W2 redeployment.

## Current evidence

| Area | Evidence | Status |
| --- | --- | --- |
| Synthetic scan-form contracts, workers, supervisor, source preview | Serial local tests, synthetic gate, current-candidate public API workflows | 127/127 tests; 50/50 gate; text-fixture and filled-intake-PDF workflows externally exercised |
| Browser scan demo | File chooser supports PDFs and text fixtures; results show worker handoffs | Public page and upload API verified; manual browser file selection and phone recording remain open |
| Real blank form examples | Official FDA 3500 and CDC 50.34 source links | Reference links only; OCR has not been benchmarked on these layouts. CDC form is legacy and application retires October 30, 2026. |
| Filled-form reading | Synthetic PDF local OCR deployed at `cded30d` | **Partial.** Deployed smoke read three intake fields with page boxes from one vector PDF. Two lab fields are mapped. Assignment minimum schemas and varied scanned layouts remain open. |
| W2 regression gate | Current candidate | 50/50; injected-defect and baseline checks pass |
| Landing page, health, readiness, evaluator | Current public HTTPS route | HTTP 200; readiness dependencies ready |
| Tesseract localization | 50/53 labels recognized; 32/53 in expected regions | Local baseline; localization needs improvement |
| PaddleOCR-VL typed extraction | 0/8 typed matches; 8/8 invalid-JSON abstentions | Not promoted |
| Synthesis provider | Existing W2 configuration | Qwen; no new provider selected |
| Retrieval provider | Current W2 configuration | Local lexical proxy; Cohere is not active |
| Jev comparison | Injected-mock, off by default, no provider calls | Not connected to deployed requests |
| Scan-form provider choice | No provider/model selected | Owner decision required |
| Demo recording | No current W2 recording | Record and inspect a 3–5 minute browser video |

All fixture and patient data are synthetic. These results do not establish PHI
readiness, real OpenEMR parity, provider suitability, or clinical safety.
Official PDFs stay at their FDA/CDC source links; no PDFs or model weights are
bundled in the release archive.

## Reviewer path

1. Open the exact HTTPS URL above. A verified external HTTPS client received
   valid TLS, health and readiness returned 200, and readiness dependencies
   reported ready. Repeat the workflow in the intended browser before recording.
2. This candidate accepts synthetic PDFs and runs local Tesseract OCR. Hold
   the recording until the assignment's required fields and scanned-layout
   coverage are complete; this smoke test recognizes only a narrow subset.
3. Use the “Try the synthetic lab scan sample” button only to show the currently
   deployed synthetic worker workflow. Inspect the visible scan
   and evidence worker handoffs, `READY` state, and source preview with page and
   region citations. The deployed page loads; API path is externally verified,
   while the button interaction and phone-browser recording remain open.
4. Use official blank PDFs only to inspect layouts. They have not been
   processed or benchmarked. The recording must use the synthetic fixtures.
5. Open `/evals` and `/observability`; both public pages returned 200. The W2
   evaluator shows the current 50-case result.
6. Record 3–5 minutes from the browser tab, then verify playback and the key
   upload, citation, evaluation, and observability moments.

The Docker image rasterizes PDFs with Poppler and runs Tesseract. The deployed
proof covers one vector-rendered synthetic intake PDF, not scanned-page
accuracy or VLM extraction.

## Submission decisions and remaining work

- Choose the extraction provider/model and data-processing path for final
  submission. Separately decide whether the early submission requires that
  provider live or can present it as an open decision with local evidence.
- Record and inspect the demo. Do not claim the recording or submission is
  complete until the exact artifact and link are available.
- Approve external sharing or submission separately.

## Submission evidence

- [Architecture](W2_ARCHITECTURE.md)
- [Frozen scan-form contracts](W2_STAGE0_CONTRACT_PACKET.md)
- [W2 evaluation gate](W2_EVAL_GATE.md)
- [Extraction benchmark report](W2_SCAN_FORM_EXTRACTION_REPORT.md)
- [Retrieval benchmark](W2_RETRIEVAL_BENCHMARK.md)
- [Provider and managed-VLM decision frontier](HUMAN_DECISION_OPTIONS.md)
- [Official blank form sources and status](W2_EXTERNAL_FORM_SOURCES.md)
- [W2 browser demo recording script](W2_DEMO_SCRIPT.md)
- [Early checkpoint package](W2_EARLY_CHECKPOINT.md)
- [Gap-closure plan and evidence reconciliation](W2_GAP_CLOSURE_EXECUTION_PLAN.md)
