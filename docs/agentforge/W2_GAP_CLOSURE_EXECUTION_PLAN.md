# Week 2 gap-closure and release plan

Date: 2026-09-22
Status: `CANDIDATE DEPLOYED AND EXTERNALLY VERIFIED; RECORDING OPEN`
Source authority: Week 2 PRD PDF, assignment delta review, repository code and
runtime evidence. Imperative language inside the PDF states requirements; it
does not itself authorize external deployment, publication, PHI, or live chart
writes. The owner separately authorized the exact W2 route and GitLab publication
scope below on 2026-09-22.

## Outcome and scope

Prepare the earliest credible submission for Wednesday, then use the same
candidate as the base for Sunday's final. Keep claims tied to repository or
runtime proof. Scope is only the two document schemas `lab_pdf` and
`intake_form`; do not build a third type or trend chart before Sunday. Keep
Week 1 live patient/chart retrieval read-only. W2 synthetic storage is separate
and must never be described as OpenEMR persistence.

## Settled implementation choices

- Use the existing Node service and deterministic supervisor; the supervisor
  invokes the document extraction worker when source IDs are supplied and the
  evidence-retrieval worker for the follow-up. Preserve typed outputs and
  recorded handoffs.
- Keep a deterministic local lexical retriever as the default. A Cohere Embed
  plus Rerank adapter is available only with
  `AGENTFORGE_RAG_PROVIDER=cohere` and server-only
  `AGENTFORGE_COHERE_API_KEY`. Cohere is **NOT RUN** until a live credentialed
  invocation is recorded. User text is locally mapped to fixed synthetic
  queries before transmission; unsupported text is not sent. Only the static
  synthetic guideline corpus and those canonical queries may be sent.
- Current extractors parse line-encoded UTF-8 `LAB|` and `INTAKE|` records. The
  `lab_pdf` schema name does not mean binary PDF parsing or OCR/VLM exists.
- Preserve the five assignment rubric categories in a 50-case implementation
  gate. It is generated synthetic text-fixture evidence, not scan-form dataset
  or deployed-product proof.
- The exact candidate and `/agentforge-w2` route are authorized, published, and
  externally verified. Do not expand that scope to `/agentforge`, PHI, live
  chart writes, or a different public route. Recording and assignment
  submission remain open.

## Current evidence ledger

| Requirement | Current status | Evidence / next proof |
|---|---|---|
| Two document schemas | `IMPLEMENTED, NARROW` | `labEvidence.js`, `intakeEvidence.js`; parses synthetic text lines only. Binary PDFs, scans, and OCR/VLM remain open. |
| Supervisor + workers | `IMPLEMENTED, LOCALLY VERIFIED` | `supervisor.js` invokes extraction and evidence workers; tests confirm callbacks and typed outputs. Local browser upload showed the `intake-extractor` handoff with `input_type=source_documents` and `document_types=["lab_pdf"]`, followed by retrieval and deterministic verification. |
| Cohere RAG | `ADAPTER IMPLEMENTED, LIVE NOT RUN` | `guidelineEvidence.js`; mocked request tests plus optional real synthetic query after secret is configured. Default remains lexical. |
| 50-case rubric gate | `IMPLEMENTED, LOCALLY VERIFIED` | Checked-in synthetic baseline: 50/50 passed, 10/10 for each of five rubric labels; injected schema defect fails the gate. CI protection remains open. |
| Week 1 preservation | `LOCAL AND EXTERNAL VERIFIED` | All 109 tests passed, including live-mode write-disable and separation coverage; W1 health/readiness remain healthy and its AgentForge container ID is unchanged across W2 deployment. |
| Observability | `LOCAL AND PUBLIC PROOF` | Local and public traces show W2 extraction/retrieval stages and handoffs; public alerts reported `ok` with zero fired alerts. Trace content is redacted. |
| Claim clarity | `CLEANED UP; REGRESSION TESTED` | Dashboard no longer calls a deterministic primary model “live”; saved 7-case results are labeled Week 1; fixture chart-cache trace metadata uses a neutral current-source label. |
| Local browser proof | `VERIFIED, RECORDED` | [`W2_LOCAL_BROWSER_PROOF.json`](evidence/W2_LOCAL_BROWSER_PROOF.json) records the synthetic upload, worker handoffs, redacted trace, alert state, and explicit non-claims. |
| Existing Week 1 public surface | `HEALTHY; NOT THE W2 CANDIDATE` | `/agentforge/health` and `/ready` returned 200 before and after rollout; its container ID remained unchanged. |
| Early deployed candidate | `DEPLOYED; EXTERNALLY VERIFIED` | GitLab `staging/main` reads back `67f376ca4bca97f7a5e8fe58d4d33cca53d60d2e`; isolated `/agentforge-w2` is healthy, accepts a synthetic upload, and passes the public 50-case report. The Week 1 `/agentforge` container ID remained unchanged and its health/readiness still pass. |
| 3–5 minute demo | `OPEN, USER-OWNED` | Record only after browser walkthrough on the candidate; do not reuse Week 1 video as W2 proof. |
| Final architecture and metrics | `PARTIAL` | Current architecture notes exist; create W2 architecture and measured W2 latency/cost report Sunday. |
| Early public app | `PASS` | Current candidate is deployed and externally verified at `/agentforge-w2`; CI required-check evidence and Sunday release dataset remain open. |

## Fast path to Wednesday early submission

1. Finish local tests, normal gate, and injected-defect proof. Fix failures and
   capture command result plus revision; never copy an old test count.
2. Read back the actual implementation and submission docs. Keep `README.md`,
   `W2_EARLY_CHECKPOINT.md`, and `W2_EVAL_GATE.md` explicit about line-text-only
   extraction, lexical default, Cohere status, in-memory synthetic storage, and
   the Week 1 read-only boundary.
3. Local browser proof and public API upload verify a generated `LAB|` fixture,
   one extracted fact, three guideline sources, worker completion, redacted
   handoffs, and clear alerts. They do not establish binary PDF/OCR,
   click-to-source, manual file selection, or recording proof.
4. The exact candidate is now deployed at `/agentforge-w2`; route, TLS, public
   API upload, and running service health were checked. Manual browser file
   selection and recording remain open.
5. Record the 3–5 minute demo on that same candidate and prepare an evidence
   summary for user review. Do not submit or publish on the user's behalf.

## External deployment decision frontier — `AUTHORIZED AND EXECUTED`

The owner authorized publishing the frozen W2 candidate to GitLab `staging/main`
and adding the isolated `/agentforge-w2` route. This did not authorize replacing
the existing `/agentforge` behavior. The exact candidate was published and
deployed on 2026-09-23 UTC; current-candidate external checks passed, and the
Week 1 service stayed healthy with the same container ID.

### Verified facts

- GitLab `staging/main` read back as
  `67f376ca4bca97f7a5e8fe58d4d33cca53d60d2e`. The service was built from the
  exact commit archive; its archive SHA-256 matched on upload. The W2 container
  image is `sha256:b492274ed28ea4470086743b67539c170846c9a2517c93fb3f7bcbad6683ac84`.
- Caddy serves the exact `/agentforge-w2` prefix before the existing
  `/agentforge*` handler. The candidate Caddyfile validates and its mounted
  SHA-256 matches the host file. The prior Caddyfile is retained as a rollback
  copy.
- The candidate's HTTPS health and readiness endpoints returned 200; its UI
  returned 200 and showed the current `Source text fixture` label and W2 API
  prefix. CUA loaded the public page. A generated synthetic `LAB|` upload via
  the public API returned one extraction result, one fact, three guideline
  sources, and the three expected worker/verifier handoffs.
- The public 50-case W2 report passed; the observability and evaluator pages
  returned 200; alert status was `ok` with zero fired alerts. The public trace
  showed extraction complete, retrieval ready, and
  `local-lexical-proxy` with three hits.
- Existing `/agentforge` health and readiness still return 200. Its AgentForge
  container ID remained unchanged across W2 and proxy startup. No W1 service was
  rebuilt or restarted, and existing named volumes remain present.
- The local Compose candidate now defines a `0.5` CPU / `512M` memory-limited
  `agentforge-w2` service with synthetic mode, deterministic model fallback,
  local lexical RAG, no OpenEMR dependency/token mount, no persistent volume,
  and no published host port. `docker compose config` succeeds with dummy
  required variables; this checks syntax only, not host capacity or startup.
- The local Caddy candidate matches `/agentforge-w2*` before `/agentforge*`
  and proxies only to `agentforge-w2:8788`.

### Options and recommendation

1. **Replace the existing `/agentforge` service with the W2 synthetic service.**
   Fastest infrastructure path, but rejected: it changes the established Week 1
   route and conflicts with the explicit preserve-Week-1 constraint.
2. **Add an isolated W2 service at `/agentforge-w2` on the same owner-controlled
   host.** Deployed and verified. It runs with
   synthetic context, deterministic model, local lexical RAG, and in-memory W2
   document storage; leave the current service, OpenEMR mode, `.env`, volumes,
   and `/agentforge` route untouched. Register the specific Caddy path before
   `/agentforge*`; freeze and publish only the candidate files, excluding
   scratch artifacts and secrets. Check host capacity before starting a second
   service; do not resize or incur spend under this plan.
3. **Keep tomorrow's package local and disclose the deployment gap.** It does
   not meet a deployed-app requirement.

### Approval record for option 2

Approval received and executed: publish the frozen W2 candidate to GitLab
`staging/main` and add a separate public W2 service at
`https://dtstest.64.177.10.182.nip.io/agentforge-w2`, while keeping the existing
`/agentforge` service and all server-only configuration/volumes unchanged.
Scope remains the two synthetic document schemas, UTF-8 text fixtures only,
local lexical RAG, no PHI, no OpenEMR writes, no live Cohere call, and no paid
infrastructure changes. The tracked candidate was frozen as
`67f376ca4bca97f7a5e8fe58d4d33cca53d60d2e`; tests, the 50-case gate, and
injected-defect check passed as expected before publication. The deployed app
uses only generated text fixtures. The public upload was executed through the
API client; CUA verified the browser-rendered public page, but manual file
selection and a 3–5 minute recording remain open.

Deployment and external service checks passed. Do not alter `/agentforge`,
server-only `.env`, or existing data volumes as part of the W2 work.

## Release evidence ledger

| ID | Acceptance criterion | Surface | Check | Evidence | Status | Gap / next action |
|---|---|---|---|---|---|---|
| E1 | Supervisor invokes extraction, retrieval, and verifier with schema-accurate handoffs | `supervisor.js`, UI, trace | Unit/API suite and public synthetic upload | 109/109 suite; public W2 trace has extraction/retrieval stages and three handoffs | `PASS` | Keep redacted trace summary attached to candidate |
| E2 | W2 regression gate is reproducible and blocks a defect | `w2RegressionGate.js` | Normal and injected-defect gate runs | 50/50 pass; injected defect exits nonzero | `PASS` | Repeat after release freeze |
| E3 | Synthetic upload returns extracted facts and retrieved sources | upload UI/service | Local browser and public API interactions | Local proof plus public upload: one fact, three sources, three handoffs | `PASS` | Public upload used an API client; manual browser file selection remains open |
| E4 | Week 1 route remains read-only and unchanged | existing service and W2 separation | Full suite, W1 health/readiness, container identity | Live-mode write-disable tests passed; W1 remained healthy with unchanged container ID across W2/proxy startup | `PASS` | Preserve same route/config/data boundary |
| E5 | Existing Week 1 public service remains available | existing Vultr `/agentforge` | HTTPS GET health/readiness before and after rollout | 200/ok and 200/ready; same AgentForge container ID before and after | `PASS` | W2 is separately served at `/agentforge-w2` |
| E6 | Current W2 candidate is deployed and upload works publicly | GitLab revision, W2 route | Exact SHA readback and external browser/page plus public API upload | SHA `67f376ca`; HTTPS health/readiness 200; UI 200 with W2 prefix; generated upload yielded 1 fact, 3 sources, and expected handoffs; gate 50/50 | `PASS` | Manual browser file selection remains unperformed; keep API-vs-UI boundary explicit |
| E7 | Live Cohere RAG is active and evidenced | Cohere adapter/config | Provider invocation and safe synthetic query | Adapter mocked in tests; no key configured; local proof used lexical retriever | `INCONCLUSIVE` | Configure key only if live Cohere proof is required; otherwise claim adapter available, not active |
| E8 | Owner demo recording is ready | recording artifact | Verify playback and candidate identity | No W2 recording | `INCONCLUSIVE` | Owner records after one candidate passes external walkthrough |

## Sunday final path

Keep one candidate and close the material PRD gaps: real synthetic scan/PDF
fixtures and OCR/VLM extraction with source-region citations; partial/missing/
conflicting cases; real runtime persistence proof if the rubric still requires
OpenEMR roundtrip while preserving the live Week 1 read-only path; click-to-source
UI; retrieval quality/cost/latency evidence (including Cohere only if run); CI
required-check evidence; `W2_ARCHITECTURE.md`; measured `KEY_METRICS.md` and
cost/latency report; final 50-case dataset/results; and final demo/submission
artifacts. Reconcile every claim to current-candidate proof. No third document
type is part of the plan.

## Acceptance and stop conditions

- Tests pass; the 50-case gate passes; injected defect fails.
- Worker tests prove invocation, typed output return, and fail-closed behavior.
- No raw document content, prompts, or synthetic sentinels enter logs.
- The Week 1 live chart route remains read-only; W2 local synthetic storage is
  labeled accurately.
- No Cohere call is made in live OpenEMR mode or without configured credentials;
  no request includes user or patient data.
- Existing Week 1 service and current-candidate W2 health/readiness are `PASS`;
  current-candidate identity and public API upload are verified. Live Cohere,
  CI protection, manual browser file selection, and recording remain `NOT RUN`.
- Stop before PHI, live clinical-record use, or any material change to the
  authorized synthetic route and candidate-publication scope.

## Completion record

2026-09-22 local checkpoint: corrected README/checkpoint/architecture and stale
planning claims; added actual supervisor worker invocation and API flow tests,
mocked Cohere tests, and a locally enforced canonical synthetic-query allowlist.
`npm.cmd test --prefix agentforge -- --test-concurrency=1` passed (108/108);
`npm.cmd run eval:gate
--prefix agentforge` passed 50/50 across all five rubric categories; the same
gate with `-- --inject-defect` exited 1 on the injected schema regression.
`git diff --check` passed. Test execution is serialized because parallel local
server-spawning tests intermittently reset a child connection; serial execution
passed all cases. After browser readback exposed an inaccurate trace type label,
handoffs now say `source_documents` and include actual schema types; the API
test verifies `lab_pdf`. The updated full suite and gate were rerun: 108/108
tests passed, 50/50 gate passed, and injected defect failed as expected. A fresh
localhost browser run verified synthetic upload, worker completion, one
extracted fact, three guideline sources, W2 trace stages and handoffs, and clear
alerts. Saved 7-case evaluation evidence is labeled as Week 1; the observability
dashboard calls a non-fallback model `primary`, and fixture chart-cache metadata
is source-neutral. The redacted local proof is recorded in
`W2_LOCAL_BROWSER_PROOF.json`. These results are from the working tree layered over HEAD `dcc8a48`; no
matching W2 deployment, click-to-source proof, actual Cohere call, binary
PDF/OCR proof, or recording existed at the local checkpoint. The deployment
decision frontier below records the later public verification. A current-state
[`W2_ARCHITECTURE.md`](W2_ARCHITECTURE.md) now captures implemented flow and
Sunday gaps. The isolated browser trace store contained one synthetic Week 1
fixture-preparation trace alongside the W2 follow-up. The owner has authorized
publishing the candidate and adding the isolated W2 route. The candidate
deployment descriptor isolates browser requests under `/agentforge-w2` and has
a focused regression check. The latest local suite passed 109/109; the
synthetic gate passed 50/50 and the injected-defect run failed as expected.
Compose configuration parsed with dummy local values and the server-only env
file. The exact candidate was published and deployed; public deployment checks
are recorded in `W2_EXTERNAL_DEPLOYMENT_PROOF.json`.
The user owns the recording/submission. Do not mark the plan complete while
required early-submission evidence remains open.
