# Week 2 reviewer package

Updated 2026-09-23. This is a local working package, not a release approval.

## Candidate identity

- Working tree is detached at `dcc8a48` with uncommitted source, evidence, and
  documentation changes. It is not yet an immutable submission revision.
- The previous public W2 deployment was built from `67f376c` at
  `/agentforge-w2`. Its health/readiness and synthetic workflow checks do not
  prove the current working tree or the new scan-form preview path. Refresh
  the public URL, TLS, candidate identity, and intended-browser workflow before
  recording.
- The older `/agentforge` package and provider claims are historical and do
  not describe this W2 candidate.

## Current evidence

| Area | Evidence | Status |
| --- | --- | --- |
| Synthetic scan-form contracts, workers, supervisor, and source preview | Local implementation and prior integration evidence in `W2_GAP_CLOSURE_EXECUTION_PLAN.md` | Local; not deployed on the previous W2 candidate |
| Local AgentForge tests | Current working tree: 118/118, serial run | Rerun on the immutable candidate |
| W2 regression gate | Current working tree: 50/50; gate includes injected-defect coverage | Rerun on the immutable candidate |
| Tesseract localization | 50/53 labels recognized; 32/53 in expected regions | Local baseline; localization needs improvement |
| PaddleOCR-VL typed extraction | 0/8 typed matches; 8/8 invalid-JSON abstentions | Not promoted |
| Retrieval provider | Local lexical proxy on the previously verified W2 route | Cohere is not active |
| Jev comparison | Injected-mock, off by default, no provider calls | Not connected to deployed requests |
| Scan-form provider choice | No provider/model selected | Owner decision required |
| Demo recording | No current W2 recording | Owner-recorded 3–5 minute video remains open |
| Current-candidate deployment/browser proof | Not performed for this working tree | Required before recording or submission |

All scan-form and patient data in this package are synthetic. No local result
establishes PHI readiness, real OpenEMR parity, provider suitability, or clinical
safety.

## Reviewer path after deployment

1. Open the immutable candidate's exact HTTPS URL in a clean browser and verify
   candidate identity plus health and readiness.
2. Use only synthetic fixtures. Prepare the visit, upload a supported synthetic
   source, open its evidence preview, and inspect extraction status, field
   values, and page/region citations. Missing, uncertain, or conflicting fields
   must remain visibly qualified.
3. The active worker and retrieval workflow currently exists behind the
   `/v1/scan-supervisor` API, but the upload UI does not yet invoke or display
   its handoffs. Do not present multi-agent handoffs as a visible browser
   feature until that path is wired and exercised. The local fixture parser is
   not a promoted general PDF OCR/VLM system.
4. Open `/evals` and `/observability`; show the candidate's current evaluation
   and redacted operational evidence.
5. Record 3–5 minutes from the browser tab, then verify playback and the key
   upload, citation, evaluation, and observability moments.

## Submission evidence

- [Architecture](W2_ARCHITECTURE.md)
- [Frozen scan-form contracts](W2_STAGE0_CONTRACT_PACKET.md)
- [W2 evaluation gate](W2_EVAL_GATE.md)
- [Extraction benchmark report](W2_SCAN_FORM_EXTRACTION_REPORT.md)
- [Retrieval benchmark](W2_RETRIEVAL_BENCHMARK.md)
- [Provider and managed-VLM decision frontier](HUMAN_DECISION_OPTIONS.md)
- [Early checkpoint package](W2_EARLY_CHECKPOINT.md)
- [Gap-closure plan and evidence reconciliation](W2_GAP_CLOSURE_EXECUTION_PLAN.md)

## Remaining owner decisions and release gates

- Select the provider/model and data-processing path for final extraction;
  separately decide whether an early submission needs that provider live or can
  accurately present it as an open decision with local evidence.
- Choose and authorize the exact deployment revision; verify public HTTPS and
  the intended browser workflow after deployment.
- Record and inspect the demo. Do not claim the recording or submission is
  complete until their exact artifacts and links are available.
- Approve any external sharing or submission separately.
