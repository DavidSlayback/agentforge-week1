# Week 2 reviewer package

Updated 2026-09-23. The current synthetic PDF candidate is deployed and
externally checked. Provider selection, demo recording, and final submission
remain open.

## Candidate identity

- Staging branch: `davidslayback/w2-synthetic-scan-release`
- Deployed code commit: `41682f5` (`feat(agentforge): complete synthetic PDF form samples`)
- Public URL: <https://dtstest.64.177.10.182.nip.io/agentforge-w2/>
- Release directory: `/opt/agentforge-week1/.releases/agentforge-w2-41682f5`
- Candidate proof: [W2 PDF sample deployment proof](evidence/W2_PDF_SAMPLE_DEPLOYMENT_PROOF_41682F5.json)
- Week 1 `/agentforge` stayed healthy with its existing container identity.

The W2 route is synthetic-only. It has no OpenEMR dependency or persistence.
The existing Week 1 read-only workflow remains separate.

## Evidence status

| Area | Current evidence | Status |
| --- | --- | --- |
| Assignment schemas | Lab: two tests with name, value, unit, reference range, collection date, abnormal flag. Intake: name, DOB, phone, chief concern, medications, allergies, family history. | Implemented |
| PDF fixture matrix | Four generated synthetic PDFs; two layouts per type, with vector and rasterized pages. | 38/38 expected values exact, valid, and cited locally |
| Public PDF workflow | Each of four fixed samples uploaded and processed through the public synthetic API. | READY; expected fields and 200 DPI raster citation boxes returned |
| Public page | HTTPS landing page, health, readiness, and four downloadable sample controls. | HTTP 200; current page inspected |
| Regression | AgentForge serial suite and 50-case W2 gate on this candidate. | 130/130 and 50/50 |
| VLM/provider | PaddleOCR-VL structured extraction did not meet the typed contract; no provider/model chosen for submission. | Open owner decision |
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

- Select the VLM/extraction provider and data-processing path for final
  submission; decide separately whether the early submission can document
  this as an open decision.
- Record and review the requested 3–5 minute demo against this deployed
  candidate. Verify playback, citations, evaluation, and observability.
- Reconcile whether the assignment requires physical scanned forms or an
  OpenEMR round trip beyond the current synthetic implementation.
- Approve external sharing or final submission separately.

All fixture and patient data are synthetic. These results do not establish
PHI readiness, real OpenEMR parity, provider suitability, or clinical safety.
