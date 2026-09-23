# Week 2 gap-closure and release plan

Date: 2026-09-22
Status: `LOCAL CHECKPOINT READY; ROUTE AUTHORIZED, DEPLOYMENT PENDING HOST ACCESS`
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
- Deployment/publication need exact owner authority. After authority is given,
  deploy the frozen candidate and then require current-candidate external proof
  before claiming readiness or submitting. The user owns recording and external
  submission.

## Current evidence ledger

| Requirement | Current status | Evidence / next proof |
|---|---|---|
| Two document schemas | `IMPLEMENTED, NARROW` | `labEvidence.js`, `intakeEvidence.js`; parses synthetic text lines only. Binary PDFs, scans, and OCR/VLM remain open. |
| Supervisor + workers | `IMPLEMENTED, LOCALLY VERIFIED` | `supervisor.js` invokes extraction and evidence workers; tests confirm callbacks and typed outputs. Local browser upload showed the `intake-extractor` handoff with `input_type=source_documents` and `document_types=["lab_pdf"]`, followed by retrieval and deterministic verification. |
| Cohere RAG | `ADAPTER IMPLEMENTED, LIVE NOT RUN` | `guidelineEvidence.js`; mocked request tests plus optional real synthetic query after secret is configured. Default remains lexical. |
| 50-case rubric gate | `IMPLEMENTED, LOCALLY VERIFIED` | Checked-in synthetic baseline: 50/50 passed, 10/10 for each of five rubric labels; injected schema defect fails the gate. CI protection remains open. |
| Week 1 preservation | `LOCALLY VERIFIED` | The Week 1 read-only chart adapter remains separate from W2 synthetic storage; the complete 108-test AgentForge suite passed, including live-mode write-disable and separation tests. |
| Observability | `LOCAL PROOF; RELEASE OPEN` | Fresh localhost trace store showed W2 extraction/retrieval stages and all handoffs; UI alerts were clear and trace content redacted. One synthetic Week 1 fixture-preparation request also appears when opening the app. Public-candidate observability remains open. |
| Claim clarity | `CLEANED UP; REGRESSION TESTED` | Dashboard no longer calls a deterministic primary model “live”; saved 7-case results are labeled Week 1; fixture chart-cache trace metadata uses a neutral current-source label. |
| Local browser proof | `VERIFIED, RECORDED` | [`W2_LOCAL_BROWSER_PROOF.json`](evidence/W2_LOCAL_BROWSER_PROOF.json) records the synthetic upload, worker handoffs, redacted trace, alert state, and explicit non-claims. |
| Existing public surface | `INCONCLUSIVE FOR CURRENT CANDIDATE` | Read-only GETs on 2026-09-22 returned `/health` 200/`ok`, `/ready` 200/`ready`, and `/evals/w2-baseline.json` 50/50. The home page does not contain the current `Source text fixture` label. Public runtime identity was not matched to this worktree. |
| Early deployed candidate | `AUTHORIZED; DEPLOYMENT PENDING HOST ACCESS` | Owner authorized publishing to GitLab `staging/main` and an isolated `/agentforge-w2` service on 2026-09-22. The local candidate is being frozen; the VM SSH connection currently times out before the remote banner, so capacity and live route state cannot yet be checked. Preserve `/agentforge`. |
| 3–5 minute demo | `OPEN, USER-OWNED` | Record only after browser walkthrough on the candidate; do not reuse Week 1 video as W2 proof. |
| Final architecture and metrics | `PARTIAL` | Current architecture notes exist; create W2 architecture and measured W2 latency/cost report Sunday. |
| Final CI, 50-case dataset/results, public app | `PARTIAL / OPEN` | Gate is local; obtain CI required-check evidence, freeze dataset/results, deploy/verify current candidate. |

## Fast path to Wednesday early submission

1. Finish local tests, normal gate, and injected-defect proof. Fix failures and
   capture command result plus revision; never copy an old test count.
2. Read back the actual implementation and submission docs. Keep `README.md`,
   `W2_EARLY_CHECKPOINT.md`, and `W2_EVAL_GATE.md` explicit about line-text-only
   extraction, lexical default, Cohere status, in-memory synthetic storage, and
   the Week 1 read-only boundary.
3. Local browser proof now verifies a generated `LAB|` fixture upload, one
   extracted fact, three guideline sources, worker completion, schema-specific
   redacted handoffs, and clear alert state. This is text-fixture/local proof;
   it does not satisfy deployment, click-to-source, or recording requirements.
4. If the early bar needs a public app, deploy the exact candidate and verify
   route, TLS, browser operation, and running revision. Otherwise report the
   deployed-app requirement as not met; older Week 1 deployment is not proof.
5. Record the 3–5 minute demo on that same candidate and prepare an evidence
   summary for user review. Do not submit or publish on the user's behalf.

## External deployment decision frontier — `AUTHORIZED; DEPLOYMENT PENDING HOST ACCESS`

The owner explicitly authorized publishing the frozen W2 candidate to GitLab
`staging/main` and adding the isolated `/agentforge-w2` route on 2026-09-22.
This does not authorize replacing the existing `/agentforge` behavior. Host
access is currently unavailable: SSH connects but times out before the remote
banner, so capacity and live compose/Caddy state remain unverified.

### Verified facts

- The existing public origin is
  `https://dtstest.64.177.10.182.nip.io/agentforge/`. External PowerShell GETs
  on 2026-09-22 returned `/health` **200 / `ok`**, `/ready` **200 / `ready`**,
  and `/evals/w2-baseline.json` **200 / 50 cases passed**.
- The public landing page returned 200 but did not contain the current local
  `Source text fixture` label. No runtime source hash or commit endpoint was
  read back, so these checks prove existing service availability, not current
  candidate identity or W2 upload behavior.
- GitLab `staging/main` currently resolves to `cb728cb23e274b73e748ee5fd030ab63baf45fda`.
  Local `HEAD` is `dcc8a4879b74891ec3e06220b1eff0de83b32e3e`, 14 commits ahead;
  the worktree also has uncommitted changes. Release proof cannot cite the
  current public service as this candidate.
- The current deployment routes `/agentforge*` to the Week 1 service. A
  side-by-side path must be matched before that broader Caddy handler, or it
  will be routed to the existing service.
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
   host.** Recommended if a public W2 path is required tomorrow. Run with
   synthetic context, deterministic model, local lexical RAG, and in-memory W2
   document storage; leave the current service, OpenEMR mode, `.env`, volumes,
   and `/agentforge` route untouched. Register the specific Caddy path before
   `/agentforge*`; freeze and publish only the candidate files, excluding
   scratch artifacts and secrets. Check host capacity before starting a second
   service; do not resize or incur spend under this plan.
3. **Keep tomorrow's package local and disclose the deployment gap.** It does
   not meet a deployed-app requirement.

### Approval record for option 2

Approval received 2026-09-22: publish the frozen W2 candidate to GitLab
`staging/main` and add a separate public W2 service at
`https://dtstest.64.177.10.182.nip.io/agentforge-w2`, while keeping the existing
`/agentforge` service and all server-only configuration/volumes unchanged.
Scope remains the two synthetic document schemas, UTF-8 text fixtures only,
local lexical RAG, no PHI, no OpenEMR writes, no live Cohere call, and no paid
infrastructure changes. Stop if the route would alter Week 1 behavior, resource
headroom is inadequate, the candidate cannot be frozen without scratch/secrets,
or any required release check fails. After host access and capacity confirmation:
freeze the tracked candidate, rerun tests/gate/mutation proof, publish and read
back the exact GitLab SHA, add the isolated service and specific Caddy route,
then run the external browser upload, worker trace, eval, observability,
health/readiness, and existing Week 1 regression checks.

Publication is authorized. Do not apply the remote deployment until SSH access
returns and resource headroom plus current `/agentforge` state are verified.

## Release evidence ledger

| ID | Acceptance criterion | Surface | Check | Evidence | Status | Gap / next action |
|---|---|---|---|---|---|---|
| E1 | Supervisor invokes extraction, retrieval, and verifier with schema-accurate handoffs | `supervisor.js`, UI, trace | Unit/API suite and local browser upload | 108/108 suite; local W2 trace has `lab_pdf`, extraction/retrieval stages, and three handoffs | `PASS` | Keep trace artifact attached to current candidate |
| E2 | W2 regression gate is reproducible and blocks a defect | `w2RegressionGate.js` | Normal and injected-defect gate runs | 50/50 pass; injected defect exits nonzero | `PASS` | Repeat after release freeze |
| E3 | Local synthetic upload returns extracted facts and retrieved sources | upload UI/service | Local browser interaction | `W2_LOCAL_BROWSER_PROOF.json` | `PASS` | Does not prove citations visible or PDFs/OCR |
| E4 | Week 1 route remains read-only and unchanged | existing service and W2 separation | Full suite and local code inspection | Live-mode write-disable and separation tests passed | `PASS` | Verify existing deployed route after any authorized rollout |
| E5 | Existing public service is available | existing Vultr `/agentforge` | HTTPS GET health/readiness and W2 baseline | 200/ok, 200/ready, 50/50 report on 2026-09-22 | `PASS` | Availability only; not current-candidate identity |
| E6 | Current W2 candidate is deployed and upload works publicly | GitLab revision, W2 route | Exact SHA readback and clean external browser upload | No matching deployed revision; public page lacks the current fixture label | `INCONCLUSIVE` | Publication/route authorized; pending SSH access, host-capacity check, deploy, and external proof |
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
- Existing public service health is `PASS`, but current-candidate deployment
  identity and public W2 upload are `INCONCLUSIVE`. Live Cohere, CI protection,
  and recording remain `NOT RUN`; local browser proof is not a substitute for
  those release checks.
- Stop before PHI, live clinical-record use, or any material change to the
  authorized synthetic route and candidate-publication scope. Remote deployment
  remains gated on restored SSH access and adequate host headroom.

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
PDF/OCR proof, or recording exists yet. A current-state
[`W2_ARCHITECTURE.md`](W2_ARCHITECTURE.md) now captures implemented flow and
Sunday gaps. The isolated browser trace store contained one synthetic Week 1
fixture-preparation trace alongside the W2 follow-up. The owner has authorized
publishing the candidate and adding the isolated W2 route. The candidate
deployment descriptor isolates browser requests under `/agentforge-w2` and has
a focused regression check. The latest local suite passed 109/109; the
synthetic gate passed 50/50 and the injected-defect run failed as expected.
Compose configuration parsed using dummy required values. Publishing is next;
remote deployment waits for SSH access and capacity verification, then requires
external verification.
The user owns the recording/submission. Do not mark the plan complete while
required early-submission evidence remains open.
