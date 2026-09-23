# Week 2 reviewer package

Updated 2026-09-23. The synthetic W2 candidate is deployed and externally
verified. Provider selection and demo recording remain open.

## Candidate identity

- Staging branch: `davidslayback/w2-synthetic-scan-release`
- Deployed code commit: `6ab0edc60956825554fb6501c1ad7bd4897f5a7c`
- Public URL: <https://dtstest.64.177.10.182.nip.io/agentforge-w2/>
- Release directory: `/opt/agentforge-week1/.releases/agentforge-w2-6ab0edc`
- External checks and runtime identity: [W2 deployment proof](evidence/W2_EXTERNAL_DEPLOYMENT_PROOF_6AB0EDC.json)

The deployed surface remains synthetic-only. Week 1 `/agentforge` is healthy
and its container identity was unchanged during this W2 redeployment.

## Current evidence

| Area | Evidence | Status |
| --- | --- | --- |
| Synthetic scan-form contracts, extraction worker, evidence worker, supervisor, source preview | Local tests plus current-candidate public API workflow | 125/125 tests; complete 2-field fixture externally exercised |
| Browser scan demo | One-tap included synthetic fixture; visible scan/evidence handoffs; source preview | Page/controls inspected; public API workflow passes; browser button and phone recording remain to verify |
| Real blank form examples | Official FDA 3500 and CDC 50.34 source links | Links only; no PDF upload/OCR. CDC form is legacy and application retires October 30, 2026. |
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
2. Use the “Try the synthetic lab scan sample” button. Inspect the visible scan
   and evidence worker handoffs, `READY` state, and source preview with page and
   region citations. The deployed page loads; API path is externally verified,
   while the button interaction and phone-browser recording remain open.
3. Use the official blank PDF links only to inspect real layouts. The app accepts
   the included synthetic text fixture; it does not parse these PDFs.
4. Open `/evals` and `/observability`; both public pages returned 200. The W2
   evaluator shows the current 50-case result.
5. Record 3–5 minutes from the browser tab, then verify playback and the key
   upload, citation, evaluation, and observability moments.

The local fixture parser handles controlled synthetic text fixtures. It is not
a general binary-PDF, OCR, or VLM extraction system.

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
- [Early checkpoint package](W2_EARLY_CHECKPOINT.md)
- [Gap-closure plan and evidence reconciliation](W2_GAP_CLOSURE_EXECUTION_PLAN.md)
