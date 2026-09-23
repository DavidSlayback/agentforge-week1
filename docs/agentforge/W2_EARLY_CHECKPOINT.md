# Week 2 early checkpoint status

Status: **the W2 candidate is published and externally verified; recording and
submission remain open.** This document records current proof and gaps as of
2026-09-23.
Everything in the W2 workflow is synthetic. The owner has authorized publishing
this candidate and a separate synthetic `/agentforge-w2` route. That scope does
not authorize PHI, live clinical records, changes to `/agentforge`, or final
assignment submission.

## Implemented locally

- Week 1 patient/chart retrieval remains read-only.
- W2 has two synthetic document schemas: `lab_pdf` and `intake_form`.
- The current extractors parse UTF-8 text fixtures containing `LAB|` or
  `INTAKE|` records. `lab_pdf` is currently a schema/type label; binary PDF
  parsing, OCR/VLM, and scan reading are not implemented.
- The supervisor invokes the extraction worker for provided document IDs and
  the evidence-retrieval worker, then performs deterministic final verification.
- The assignment-named `intake-extractor` handles both supported schemas. Its
  redacted handoff records `input_type=source_documents` and actual
  `document_types`; a local browser run verified `lab_pdf` is labeled correctly.
- The default retriever is a local lexical proxy. A Cohere Embed/Rerank adapter
  is available behind `AGENTFORGE_RAG_PROVIDER=cohere` and the server-only
  `AGENTFORGE_COHERE_API_KEY`. Cohere credentials are not configured here, so
  live Cohere execution is **NOT RUN**.
- The W2 gate runs 50 generated synthetic cases against current parsers,
  retrieval, and trace-redaction code using the five named rubric categories.
  Its corpus is generated in code; it is not a labeled scanned-form dataset.
- W2 source and derived-fact storage is an in-memory synthetic seam, not an
  OpenEMR round trip. The isolated public W2 service was built from GitLab
  `staging/main` SHA `67f376ca4bca97f7a5e8fe58d4d33cca53d60d2e`; external
  health/readiness, page, evaluation, alert, trace, and synthetic upload checks
  passed. It is separate from the existing Week 1 `/agentforge` route.
- Reviewer pages now label the saved 7-case results as the Week 1 baseline;
  model traces say `primary` rather than implying every non-fallback model is
  live, and chart-cache metadata no longer says `openemr-live` for the fixture
  path.

## Local verification

Verified 2026-09-23 on release candidate `67f376c`: AgentForge suite
**109/109 passed**; normal W2 gate **50/50 passed**
(10/10 in each rubric); injected schema defect was blocked and the gate exited
nonzero. These code checks do not prove deployment, PDF/OCR, live Cohere
execution, OpenEMR round-trip, or recording. The separate local browser proof
below is not deployment or public-release proof.

Local browser proof on 2026-09-22 used a generated synthetic UTF-8 `LAB|`
fixture. The app confirmed one source document stored, one extracted fact, and
three guideline sources; the supervisor reported completion of the document
and evidence workers. A fresh trace store showed successful extraction and
retrieval stages, redacted handoffs for `intake-extractor` with
`document_types=["lab_pdf"]`, `evidence-retriever`, and
`deterministic-verifier`, and all three alert states clear. This is local
synthetic text-fixture evidence: it does not prove binary PDF/OCR, clickable
source citations, public deployment, or OpenEMR persistence. The dashboard also
contained one synthetic Week 1 fixture-preparation trace caused by opening the
app; the W2 follow-up trace is separately labeled.
The redacted evidence record is
[`W2_LOCAL_BROWSER_PROOF.json`](evidence/W2_LOCAL_BROWSER_PROOF.json).

## Public release verification

The public page was loaded in CUA over HTTPS at
`https://dtstest.64.177.10.182.nip.io/agentforge-w2/`. Health and readiness
returned 200; the UI showed the line-text fixture label and used the W2 API
prefix. A generated synthetic `LAB|` record was uploaded through the public API
and the supervisor returned one extraction result, one fact, three guideline
sources, and handoffs for `intake-extractor`, `evidence-retriever`, and
`deterministic-verifier`. The public 50-case report passed, observability and
evaluator pages returned 200, and alerts were clear. This upload used an API
client; a manual browser file-selection session and video recording remain
open. The Week 1 `/agentforge` health/readiness stayed healthy and its service
container ID did not change. Full evidence is in
[`W2_EXTERNAL_DEPLOYMENT_PROOF.json`](evidence/W2_EXTERNAL_DEPLOYMENT_PROOF.json).

Run these from the repository root:

```powershell
npm.cmd test --prefix agentforge -- --test-concurrency=1
npm.cmd run eval:gate --prefix agentforge
npm.cmd run eval:gate --prefix agentforge -- --inject-defect
```

Verified: the serialized test suite passed 109/109, the ordinary 50-case gate
passed, and the injected defect made the gate exit nonzero. Rerun against the
exact release revision before submission.

## Early checkpoint blockers

1. Local suite, gate, and mutation proof are recorded above; rerun against the
   exact release revision before submission.
2. Public API upload and worker-handoff proof is recorded above. Manual browser
   file selection and a citation-visible walkthrough remain open.
3. The isolated current-candidate deployment and public checks are complete.
4. Record the requested 3–5 minute W2 demo against the same revision.
5. Reconcile any rubric requirement that specifically requires actual scans,
   binary PDFs, or OpenEMR persistence; these are not implemented by the local
   text-fixture seam.

## Week 1 preservation

Do not describe the W2 synthetic local store as OpenEMR persistence or change
the Week 1 live chart path to write. Keep the W1 baseline clearly identified in
the README and preserve its read-only runtime boundary.

## User-owned release actions

The W2 candidate is deployed at `/agentforge-w2`. Recording and external
submission remain open. The existing `/agentforge` service is not being
represented as this W2 candidate. See the deployment decision frontier in
[`W2_GAP_CLOSURE_EXECUTION_PLAN.md`](W2_GAP_CLOSURE_EXECUTION_PLAN.md) for the
record of the completed side-by-side rollout.
