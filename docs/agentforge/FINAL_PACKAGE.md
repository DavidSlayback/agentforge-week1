# Week 2 reviewer package

Updated 2026-09-23. The Gemini-enabled synthetic PDF candidate is deployed.
Public health, readiness, and page checks pass; its first two Gemini PDF
extractions returned HTTP 503, so provider quality and the full PDF workflow
remain unverified. Demo recording and final submission remain open.

For the stage-by-stage requirement table, see
[`W2_REQUIREMENTS_BY_STAGE.md`](W2_REQUIREMENTS_BY_STAGE.md).

## Candidate identity

- Staging branch: `davidslayback/w2-synthetic-scan-release`
- Deployed code commit: `902ea99` (`feat(agentforge): add opt-in Gemini scan extraction`)
- Public URL: <https://dtstest.64.177.10.182.nip.io/agentforge-w2/>
- Release directory: `/opt/agentforge-week1/.releases/agentforge-w2-902ea99`
- Candidate proof: [W2 Gemini scan deployment proof](evidence/W2_GEMINI_SCAN_DEPLOYMENT_PROOF_902EA99.json)
- Week 1 `/agentforge` stayed healthy with its existing container identity.

The W2 route is synthetic-only. It has no OpenEMR dependency or persistence.
The existing Week 1 read-only workflow remains separate.

## Evidence status

| Area | Current evidence | Status |
| --- | --- | --- |
| Assignment schemas | Lab: two tests with name, value, unit, reference range, collection date, abnormal flag. Intake: name, DOB, phone, chief concern, medications, allergies, family history. | Implemented |
| PDF fixture matrix | Four generated synthetic PDFs; two layouts per type, with vector and rasterized pages. | 38/38 expected values exact, valid, and cited locally |
| Public PDF workflow | Two attempts on Lab Layout B reached Google, both returned HTTP 503. | Failed; no extraction fields returned |
| Public page | HTTPS landing page, health, readiness, and sample controls. | HTTP 200; latest page and health/readiness inspected |
| Regression | Previous candidate passed the AgentForge serial suite and 50-case W2 gate. Current code received syntax and diff checks; full suite not rerun. | Previous candidate: 130/130 and 50/50; current provider path: unverified |
| VLM/provider | Gemini 3.8 Flash is configured for synthetic W2 scans; server key is present and `.env` permissions are 600. Two provider requests returned 503. | Integrated and deployed; quality and provider selection remain open |
| Real scan accuracy | Fixtures are clean computer-generated pages. Physical scans, handwriting, and arbitrary layouts are not benchmarked. | Open |
| Recording | No W2 recording artifact is available. | Open |

FDA Form 3500 and CDC Form 50.34 are linked as layout references. They are
blank source documents and were not used in the 38-field filled-form benchmark.
The downloadable PDF samples are generated synthetic fixtures, not sourced
patient forms.

## Reviewer path

1. Open the HTTPS URL above and confirm the synthetic-only badge.
2. Choose “Run this sample” for one lab and one intake PDF. Review the worker
   handoffs, final state, and source preview citations. Public API workflows
   for all four samples passed; the UI exposes each sample and run control.
3. Open the evaluator and observability pages to inspect the current synthetic
   gate and redacted operations view.
4. Keep any recording synthetic. The clean generated pages demonstrate the
   implemented workflow, not real scan or handwriting accuracy.

## Remaining decisions and work

- Retry the Gemini scan after Google’s 503 service issue clears, then measure
  exact fields and grounded citations on hard synthetic scans before selecting
  a final provider. Early submission can present this as an integrated but
  currently unavailable experiment.
- Record and review the requested 3–5 minute demo against this deployed
  candidate. Verify playback, citations, evaluation, and observability.
- Reconcile whether the assignment requires physical scanned forms or an
  OpenEMR round trip beyond the current synthetic implementation.
- Approve external sharing or final submission separately.

All fixture and patient data are synthetic. These results do not establish
PHI readiness, real OpenEMR parity, provider suitability, or clinical safety.
