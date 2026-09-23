# Week 2 reviewer package

Updated 2026-09-23. The synthetic W2 candidate is deployed and externally
verified. Provider selection and demo recording remain open.

## Candidate identity

- Staging branch: `davidslayback/w2-synthetic-scan-release`
- Git commit: `0cecbd11879fd3f69cbaedea5e0e2e170ee629fa`
- Public URL: <https://dtstest.64.177.10.182.nip.io/agentforge-w2/>
- Release directory: `/opt/agentforge-week1/.releases/agentforge-w2-0cecbd1`
- External checks and runtime identity: [W2 deployment proof](evidence/W2_EXTERNAL_DEPLOYMENT_PROOF_0CECBD1.json)

The deployed surface remains synthetic-only. Week 1 `/agentforge` is healthy
and its container identity was unchanged during this W2 redeployment.

## Current evidence

| Area | Evidence | Status |
| --- | --- | --- |
| Synthetic scan-form contracts, extraction worker, evidence worker, supervisor, source preview | Local tests plus current-candidate public API workflow | 124/124 tests; complete 2-field fixture externally exercised |
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
Third-party blank form PDFs and model weights are not in the release archive.

## Reviewer path

1. Open the exact HTTPS URL above. A verified external HTTPS client received
   valid TLS, health and readiness returned 200, and readiness dependencies
   reported ready. Repeat the workflow in the intended browser before recording.
2. Use only synthetic inputs. Upload a supported synthetic fixture, open its
   source preview, and inspect status, field values, and page/region citations.
   The public API workflow passed; manual browser file selection remains open.
3. `/v1/scan-supervisor` returns extraction and evidence worker handoffs and
   reached `READY` on the two-field synthetic fixture. This is API evidence;
   the upload UI does not yet display those scan-worker handoffs. The separate
   established supervisor UI reports its document and evidence worker counts.
   Do not present the new scan-worker path as a visible UI feature yet.
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
- [Early checkpoint package](W2_EARLY_CHECKPOINT.md)
- [Gap-closure plan and evidence reconciliation](W2_GAP_CLOSURE_EXECUTION_PLAN.md)
