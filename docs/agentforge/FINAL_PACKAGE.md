# Week 2 reviewer package

> **Historical (W2 reviewer package, 2026-09-23).** Kept as a record; several statements below are no
> longer true. For example, W2 now stores documents, derived facts and lab
> rows in OpenEMR, and the critic, the `medication_list` type and the lab
> trend chart are built. Current state: the root
> [`W2_ARCHITECTURE.md`](../../W2_ARCHITECTURE.md) §2 and the completion
> record in [`PLAN.md`](PLAN.md).

Updated 2026-09-23. The retry-resilience release is deployed in local Tesseract
mode. Public Lab Layout B reached READY with 12 cited fields; the source
preview shows the field quotes and page regions. Gemini is configured
server-side but disabled after two Google HTTP 503 responses; its new bounded
retry path has not been exercised. The observability page loaded but had no
recent traces after the container restart.

For the stage-by-stage requirement table, see
[`W2_REQUIREMENTS_BY_STAGE.md`](W2_REQUIREMENTS_BY_STAGE.md).

## Candidate identity

- Staging branch: `davidslayback/w2-synthetic-scan-release`
- Deployed code commit: `6e5d691` (`fix(agentforge): retry transient Gemini scan errors`)
- Public URL: <https://dtstest.64.177.10.182.nip.io/agentforge-w2/>
- Release directory: `/opt/agentforge-week1/.releases/agentforge-w2-6e5d691`
- Candidate proof: [W2 retry resilience deployment proof](evidence/W2_RETRY_RESILIENCE_DEPLOYMENT_PROOF_6E5D691.json)
- Week 1 `/agentforge` stayed healthy with its existing container identity.

The W2 route is synthetic-only. It has no OpenEMR dependency or persistence.
The existing Week 1 read-only workflow remains separate.

## Evidence status

| Area | Evidence (2026-09-23) | Status |
| --- | --- | --- |
| Assignment schemas | Lab: two tests with name, value, unit, reference range, collection date, abnormal flag. Intake: name, DOB, phone, chief concern, medications, allergies, family history. | Implemented |
| PDF fixture matrix | Four generated synthetic PDFs; two layouts per type, with vector and rasterized pages. | 38/38 expected values exact, valid, and cited locally |
| Public PDF workflow | Lab Layout B through local Tesseract mode. | READY; 12 cited fields. Two earlier Gemini attempts returned HTTP 503. |
| Public page | HTTPS landing page, health, readiness, and sample controls. | HTTP 200; latest page and health/readiness inspected |
| Regression | Previous candidate passed the AgentForge serial suite and 50-case W2 gate. `6e5d691` received syntax and diff checks; full suite not rerun. | Previous candidate: 130/130 and 50/50; `6e5d691` provider path: unverified |
| VLM/provider | Gemini 3.8 Flash adapter and server key are configured; `.env` permissions are 600. The active scan mode is local after two Google requests returned 503. The adapter has bounded retries for retryable HTTP statuses. | Integrated but inactive; retry path and quality remain unverified |
| Observability | Public dashboard loads and shows redacted operational panels and alert thresholds. | No traces or observations were present after container restart; show the alert view and label the trace window as empty unless a new trace is generated. |
| Real scan accuracy | Fixtures are clean computer-generated pages. Physical scans, handwriting, and arbitrary layouts are not benchmarked. | Open |
| Recording | No W2 recording artifact is available. | Open |

FDA Form 3500 and CDC Form 50.34 are linked as layout references. They are
blank source documents and were not used in the 38-field filled-form benchmark.
The downloadable PDF samples are generated synthetic fixtures, not sourced
patient forms.

## Reviewer path

1. Open the HTTPS URL above and confirm the synthetic-only badge.
2. Run one lab and one intake PDF. Show worker handoffs, READY status, and the
   source preview with citations.
3. Show the evaluator's 50-case gate and the redacted alert view. The evaluator
   page reported 50/50 on 2026-09-23; the trace window is empty after restart, so
   describe it accurately if no new trace is available.
4. Keep the recording synthetic. The generated pages do not demonstrate
   physical scan or handwriting accuracy.

## Remaining decisions and work

- Retry Gemini after Google’s 503 issue clears, then measure exact fields and
  grounded citations on hard synthetic scans before selecting a final
  provider. Early submission can describe the integrated experiment and its
  availability limit at the time.
- Record and review the requested 3–5 minute demo against this deployed
  candidate. Verify playback, citations, evaluation, and observability.
- Reconcile whether the assignment requires physical scanned forms or an
  OpenEMR round trip beyond the synthetic implementation of 2026-09-23.
- Approve external sharing or final submission separately.

All fixture and patient data are synthetic. These results do not establish
PHI readiness, real OpenEMR parity, provider suitability, or clinical safety.
