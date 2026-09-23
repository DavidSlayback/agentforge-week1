# Week 2 assignment gap-closure execution plan

Date: 2026-09-22
Status: `NEEDS_HUMAN FOR EXTERNAL PROOF`
Source basis: Week 2 PRD, `Intro to Project` recording/transcript, current repository state, and [assignment delta review](../../.scratch/agentforge-week2/ASSIGNMENT_DELTAS_REVIEW_2026-09-22.md).

## Goal

Turn the current brownfield AgentForge implementation into an assignment-credible Week 2 submission by closing the confirmed gaps around scanned-form/VLM extraction, missing-data handling, active worker workflows, defensible retrieval, rubric-aligned evaluation, source navigation, runtime round-trip proof, and release evidence.

The target remains synthetic-only and evidence-bounded. The system may demonstrate clinician-confirmed synthetic action seams, but it must not claim PHI handling, production clinical use, autonomous diagnosis/order generation, or live clinical writeback.

## Filled-PDF acceptance correction — 2026-09-23

The owner clarified that the demo must read **filled forms**. A source link to a
blank PDF and a tagged `.txt` fixture do not satisfy this requirement. The
first acceptable browser path must upload a PDF containing synthetic filled
values, read its actual page content, return extracted values with page/region
citations and uncertainty, and show the worker handoffs. Keep completed
personal/clinical records out of the public synthetic demo. Begin with local
OCR/VLM and synthetic overlays; no hosted provider is selected or implied.

The exact form set is being confirmed. Until then, keep the current FDA 3500
and CDC 50.34 source links as references and investigate a provider-neutral
PDF ingestion path. Promotion requires a typed-field benchmark on filled PDFs,
including missing/unreadable/conflicting cases; raw OCR text alone is not a
successful extraction result.

## Current state

The repository already contains substantial local slices:

- `agentforge/src/labEvidence.js` and `intakeEvidence.js` parse synthetic line-oriented representations, validate fields, and emit citation metadata.
- `agentforge/src/guidelineEvidence.js` provides a deterministic corpus with sparse scoring and a dense-score proxy; it is not a real vector index or reranker.
- `agentforge/src/supervisor.js` provides the original deterministic state graph
  and the new active scan-form supervisor with named worker handoffs; the
  local worker proof is synthetic and provider-neutral.
- `agentforge/src/sourceDocuments.js` and related adapters provide a synthetic persistence seam, not proven real OpenEMR round-trip evidence.
- `agentforge/src/w2RegressionGate.js` passes 50/50 synthetic cases, correctly
  fails an injected defect, and now emits an explicit assignment-rubric mapping;
  the gate corpus remains content-free rather than real scan-form data.
- Jev comparison harness, observability fields, UI, architecture notes, early-checkpoint notes, and final-package notes exist.
- The Vultr Compose file passes server-only Jev endpoint/model/key settings. On 2026-09-22, the owner-authorized key was staged in the host `.env` (0600), AgentForge alone was recreated, and in-container readback confirmed key presence with mode `off`. Public health/readiness returned 200; no provider request was made. The app still does not invoke Jev.
- Local verification at initial continuation entry passed 113/113 tests serially and 50/50 W2 gate cases; see the dated continuation outcome below for the updated run.
- Stage 0 is frozen in `W2_STAGE0_CONTRACT_PACKET.md` with a six-fixture
  synthetic scan-form manifest. A separate external corpus now adds four
  actual public blank forms with source URLs, hashes, blank checks, and label
  boxes under `docs/agentforge/external-forms/` and
  `docs/agentforge/fixtures/w2-external-form-manifest.json`.
- The new local slice adds `w2-scan-v1` contracts, cited complete/partial/
  unreadable/conflicting extraction, two active worker handoffs, an active
  supervisor route, a source-preview route, rubric mapping, and a retrieval
  benchmark report. These are local synthetic proofs, not external/provider
  evidence.

## Conductor continuation — 2026-09-22

**Objective:** Advance tickets 13-17 as far as possible locally: bridge the
larger local VLM output into `w2-scan-v1`, strengthen the deterministic form
baseline/evaluation, integrate a Jev shadow seam against mocks only, refresh
the managed-VLM decision research, and reconcile release evidence.

**Workflow state:** `PLANNED -> IMPLEMENTING -> VERIFYING -> REVIEWING ->
RECONCILING -> NEEDS_HUMAN`. Local slices and their evidence are reconciled;
provider choice/use, spend, or release actions remain human gates.

**Scope and authority:** Local source, tests, benchmark scripts/reports, and
planning/evidence documents. Do not read or alter the staged server key; do
not enable Jev, call Jev, call a hosted VLM, add spend, deploy, publish, or
modify the protected issue-11 artifact. Continue using public blank forms and
synthetic overlays only.

**Execution slices and proof:**

1. **Local VLM contract bridge (ticket 13):** inspect raw output grammar;
   add deterministic parsing/validation with abstention for malformed or
   ambiguous output; prove label/value/source/page-region invariants. Run the
   bounded local benchmark over all four sourced forms, including both pages
   of each multipage intake form. Report label, value, localization, and
   abstention separately by layout; keep the Tesseract baseline authoritative
   unless typed evidence passes.
2. **Deterministic baseline (tickets 13/17):** strengthen manifest/label and
   region checks with reproducible tests and a report that distinguishes
   OCR-observed metrics from manifest crop/oracle metrics.
3. **Jev router (ticket 14):** inject an optional router after typed evidence;
   default is off, fallback is deterministic, hard safety guards dominate,
   and mock-only tests prove no raw document/key forwarding. Never use the
   staged credential in this slice.
4. **Managed VLM frontier (ticket 16):** refresh official provider pricing,
   model capabilities, and data terms. Present local, free synthetic-only,
   capped paid API, enterprise-managed, self-hosted, and hybrid choices with
   trade-offs; make no provider selection or purchase.
5. **Release evidence (ticket 17):** reconcile implementation, test, local
   runtime, provider, and release claims separately; unresolved gates remain
   `INCONCLUSIVE` or `NEEDS_HUMAN`.

**Resource plan:** One implementation lane; no delegated workers. Prefligh
reported 20 CPUs and 257 GB free disk; memory is unavailable. Avoid parallel
model jobs. One <=8-case local VLM run, with a 90-second per-request timeout;
stop if the local runtime is unavailable, memory pressure appears, or the
benchmark requires external network access. Test concurrency <=4; no provider
calls or deployments.

**Open decisions:** No VLM vendor/model/path is selected. Hosted-provider use
and Jev API calls remain deferred. Continue local work; leave both decisions
open until the evidence and exact options are ready for review.

The recording confirms that the target must additionally include a VLM reading scan forms, varied scenario-specific forms, labeled complete/partial/missing cases, source-linked double-checkability, active workers, defensible RAG storage/retrieval, and deployment/observability evidence. The assignment requires continued work in the Week 1 repository but permits revising Week 1 decisions.

**Continuation outcome, 2026-09-22:** The local bridge now parses only stric
label/value/confidence/abstention JSON, validates source/page/region evidence,
and withholds malformed, unlabeled, or conflicting fields. The rerun used the
larger PaddleOCR-VL GGUF against eight synthetic-overlay crops spanning all
four sourced forms and both pages of both intakes: typed matches 0/8,
abstentions 8/8, raw-text matches 5/8 (not extraction success), 2.05–20.96s
per crop. Tesseract separately scored label recall 50/53 (94.3%) and expected
region localization 32/53 (60.4%); its localization quality needs follow-up.
Jev has an injected-mock, off-by-default shadow comparison seam; it is no
connected to the deployed request path and made zero provider requests. The
managed-provider frontier was refreshed, but no provider/model/budget was
selected. Local tests pass 118/118 serially and the rubric gate passes 50/50.
Ticket 17 remains `NEEDS_HUMAN` for managed-provider authorization and curren
deployment / intended-client readback; no hidden external dependency is
promoted.

## Workflow state

Current transition: `PLANNED -> IMPLEMENTING -> VERIFYING -> NEEDS_HUMAN`.
Checkpoint artifact: this file, the Stage 0 contract packet, fixture manifest,
and the assignment delta review.
Next transition: `VERIFYING -> NEEDS_HUMAN` for deployment/provider/demo proof,
or `VERIFYING -> IMPLEMENTING` for repairs found by the full gate.
Stop condition: stop and mark `NEEDS_HUMAN` if a step requires PHI, production access, external publication, an unapproved provider/data-processing path, or a material product decision not covered below.

## Scope

### Included

1. Source-appropriate synthetic scan-form fixtures for lab and intake documents, with ground-truth labels and source regions.
2. Provider-neutral OCR/VLM extraction seam with confidence, uncertainty, source coordinates, and human-review/refusal behavior.
3. Complete, partial, unreadable, conflicting, and missing-data paths.
4. Two independently testable active workers: document/extraction worker and evidence/retrieval worker, coordinated by the existing inspectable supervisor.
5. A measured retrieval choice: existing database/index or bounded vector retrieval, selected by quality, cost, latency, and reproducibility evidence.
6. Synthetic OpenEMR persistence/readback and deduplication proof through the intended runtime seam.
7. Rubric-aligned 50-case gate with explicit mappings for `schema_valid`, `citation_present`, `factually_consistent`, `safe_refusal`, and `no_phi_in_logs`, plus assignment-specific behavioral cases.
8. Click-to-source UI or an equally direct source-preview interaction with page/region evidence.
9. Redacted observability, deployment identity/readback, early checkpoint evidence, and final submission packaging.
10. A post-baseline Jev-versus-standard-supervisor spike on the same corpus, measuring quality and cost rather than assuming Jev is better.

### Explicit non-goals

- PHI, production OpenEMR, live clinical action writeback, or compliance claims.
- Autonomous diagnosis, prescribing, ordering, or agent-originated clinical recommendations.
- A third document type, trend chart, or generalized platform refactor before the two required types are reliable.
- Rebuilding the whole agent factory. The recording says the factory is encouraged but not itself graded.
- Treating local tests, an old deployment, or a prior demo as current-candidate release proof.

## Settled decisions

- Continue in the Week 1 repository.
- Use the early checkpoint as a real intermediate package, then continue toward final; do not collapse the two.
- Keep the standard supervisor as the safety/production baseline.
- After separate explicit owner authorization, run Jev as a parallel spike and promote it only if it is at least as safe and reliable, traceable, reproducible, and cheaper; a quality gain at higher cost remains an alternative, not an automatic promotion.
- Keep the clinician-confirmed action lane separate from the live read-only clinical boundary and out of the early critical path.
- Use synthetic fixtures and content-free logs for all implementation and evaluation work.
- Retain the deterministic/Tesseract extraction path as the initial safety baseline, add the selected larger local-only PaddleOCR-VL second pass over bounded ambiguous crops behind the same typed contract, and keep the bounded multi-agent worker/supervisor flow as the target execution model.
- The local VLM path must be explicitly configured and measured before it can affect readiness; an absent or unmeasured model runner produces `qualified`/`blocked`, never implicit VLM evidence.
- The user owns the demo recording and any external submission, social post, interview, or publication action.

## VLM end-state decision frontier

The assignment requirement is not satisfied by merely downloading a model. The
VLM must be an active, measured extraction lane that returns validated fields,
source citations, uncertainty, and safe abstentions. The current larger local
PaddleOCR-VL runtime reads the synthetic values as raw text but does not ye
meet the typed response contract.

| End state | What remains | Trade-off | Safe default |
|---|---|---|---|
| Local VLM service | Add a bounded raw-text-to-contract parser or grammar-constrained runner; re-run the 8-case gate; expose health/model identity and resource limits | No document egress or API spend; more laptop CPU/RAM and parser engineering | Recommended next step |
| Managed/API VLM | Select provider/model, data class, region/retention terms, budget cap, retry/fallback, and redacted/public-blank pilot; re-run the same gate | Faster path to stronger quality and scaling; documents leave the laptop and introduce cost, drift, credentials, and approval work | Deferred until local gate or quality need justifies it |
| Hybrid | Local Tesseract/layout first; send only explicitly approved redacted/ambiguous crops to the API; preserve local citations and fail closed | Best quality/egress compromise; highest integration and leakage-risk surface | Later production option |

Human approval is required before the API/hybrid path: “Approve provider X,
model Y, data class Z, region/retention terms, maximum spend, and stop after N
cases or $M.” No such approval is currently implied. Local-only implementation
and benchmarking may continue without that approval.

### Jev integration boundary

Jev is useful as a typed review/router after the extraction worker has produced
validated facts and after the evidence worker has checked guideline support. I
can choose among `READY`, `QUALIFIED`, `CLARIFY`, and `BLOCKED`, or recommend a
bounded retry/clarification path. The application-owned contracts, citations,
missing-data policy, safety guard, and clinician-confirmed action boundary stay
authoritative.

Jev should not be the component that reads the scan image, invents field
values, repairs missing citations, generates diagnoses/orders, or writes to
OpenEMR. The current Jev adapter is already shaped for this typed evidence
review role; its existing spike is the correct starting seam. Once the local
PaddleOCR-VL parser passes the extraction gate and the owner separately
authorizes the provider call, run Jev in shadow mode on the same synthetic
corpus and compare routing quality, abstention/clarification,
traceability, latency, and cost. Promote it only if it does not regress safety
or traceability and the owner accepts the measured cost/quality trade-off.

## Assumptions

- “VLM” is a required implementation lane, but the deterministic local extractor remains the starting baseline. The local VLM adapter must identify its model/runtime and limitations; no hosted provider is implied by this decision.
- The first forms will be synthetic or public/de-identified and legally usable; no personal medical document may enter the workflow.
- If a real OpenEMR runtime cannot be exercised locally, the relevant row remains `INCONCLUSIVE`; the local adapter must not be relabeled as a real round trip.
- The retrieval decision may retain a deterministic existing-index baseline if the benchmark shows it is sufficient for the bounded task and the tradeoff is documented. “Dense proxy” must not be described as true dense retrieval.
- The existing UI can be extended rather than replaced.

## Subagent operating model

The coordinator owns contracts, dependency order, integration, the evidence ledger, and final reconciliation. Subagents receive bounded context packets and may edit only their assigned surfaces. They return a compact report containing changed files, commands, results, evidence paths, residuals, and an explicit `PASS`, `FAIL`, or `INCONCLUSIVE` status.

No subagent may deploy, publish, send messages, change cloud permissions, use PHI, or promote Jev without explicit owner authority. A subagent timeout is `INCONCLUSIVE`, never approval. Parallel work begins only after Stage 0 freezes shared contracts.

## Step-by-step execution plan

### Stage 0 — Contract and evidence freeze

**Subagent A: requirements/evidence auditor**

- Inputs: PRD extraction, recording transcript, current delta review, `W2_PLAN.md`, `REQUIREMENTS_MATRIX.md`, current tests.
- Output: update a requirements ledger with exact source wording, rubric mapping, current status, and proof needed for each gap; identify any remaining source ambiguity.
- Verification: every requirement has one of `PASS`, `FAIL`, `INCONCLUSIVE`, or `NEEDS_HUMAN`; no synthetic proxy is labeled as real evidence.
- Stop: stop if the assignment source and recording materially contradict each other in a way that changes scope.

**Subagent B: contract/fixture designer**

- Inputs: auditor ledger and existing schemas/citation shapes.
- Output: versioned contracts for scanned-document input, extracted field, confidence/uncertainty, page/region citation, missing-data disposition, worker handoff, and retrieval evidence; fixture manifest schema.
- Verification: positive/negative contract tests cover complete, partial, unreadable, conflicting, and cross-patient cases.
- Stop: stop before implementation if the citation or missing-data contract cannot distinguish source fact, model guess, and unresolved field.

Coordinator checkpoint: accepted. Stage 0 outputs are frozen in
`W2_STAGE0_CONTRACT_PACKET.md`; implementation fan-out is released only for
synthetic local surfaces.

### Stage 1 — Realistic synthetic forms and extraction spike

**Subagent C: form corpus builder**

- Inputs: scenario, Stage 0 manifest, existing synthetic patient vocabulary.
- Output: at least two lab-form layouts and two intake-form layouts, rendered as PDFs/images, with ground-truth JSON, expected page/field/box citations, and complete/partial/missing/conflict variants.
- Verification: every fixture is synthetic or legally usable, reproducibly generated/located, and manually spot-checked against labels.
- Stop: do not import real patient data or proceed with untraceable external forms.

**Subagent D: OCR/VLM adapter spike**

- Inputs: Stage 0 contracts and Stage 1 fixtures.
- Output: provider-neutral extraction interface plus the deterministic baseline and a local-only VLM runner seam; raw model output remains quarantined until schema/citation validation; confidence and review/refusal reasons are explicit.
- Verification: run the labeled fixture matrix; report field accuracy, citation accuracy, missing-data recall, latency, token/cost estimate, and failure examples.
- Stop: if the adapter cannot reliably provide source regions or if provider use would transmit restricted data.

Coordinator checkpoint: choose the smallest defensible extraction path. Do not call the spike production-ready solely because it produces text.

### Stage 2 — Evidence persistence and retrieval decision

**Subagent E: OpenEMR round-trip verifier**

- Inputs: validated extraction records and existing document/observation seams.
- Output: runtime integration test or a documented blocker; prove source upload/readback, derived observation persistence/readback, deduplication, patient scope, and provenance.
- Verification: exercise the intended HTTP/runtime client, not only an in-memory adapter. Record candidate identity and readback payloads without raw content in logs.
- Stop: mark `INCONCLUSIVE` if the intended OpenEMR runtime is unavailable; do not broaden writes or use live clinical data.

**Subagent F: retrieval benchmarker**

- Inputs: labeled extracted facts, guideline corpus, Stage 0 evidence contract.
- Output: benchmark comparing the existing-index/lexical path against the smallest viable vector or embedding path; recommendation based on relevance, citation preservation, latency, cost, and deterministic replay.
- Verification: fixed query set, top-k relevance, unsupported-claim withholding, source metadata preservation, p50/p95 latency, and cost estimate.
- Stop: keep the current deterministic path only if its limitations and measured suitability are explicit; never call a proxy dense score a real embedding.

### Stage 3 — Active worker workflows and supervisor integration

**Subagent G: extraction worker**

- Inputs: Stage 1 adapter and Stage 2 persistence contract.
- Output: active worker that can inspect input, invoke extraction, validate/repair or qualify results, request clarification, and return a typed handoff with trace fields.
- Verification: multi-step traces show decision points, retries/abstention, source citations, and no raw document content in logs.

**Subagent H: evidence worker**

- Inputs: Stage 2 retrieval choice and persisted extracted facts.
- Output: active worker that formulates retrieval queries, evaluates evidence sufficiency, preserves patient/guideline separation, and returns grounded or qualified evidence.
- Verification: cases cover relevant, irrelevant, conflicting, and insufficient evidence; unsupported answers are withheld.

**Subagent I: supervisor integrator**

- Inputs: workers G/H, current `supervisor.js`, existing contracts and UI API.
- Output: explicit state graph with typed handoffs, bounded retry/clarify loops, failure states, and a final verifier boundary; retain a deterministic safety policy around all provider/model decisions.
- Verification: state-transition tests plus end-to-end traces prove each worker is independently active and that the supervisor does not silently treat a failed stage as complete.
- Stop: do not accept a worker that is only a direct tool call or a supervisor that hides model decisions behind an opaque response.

### Stage 4 — Rubric-aligned evaluation and observability

**Subagent J: evaluation owner**

- Inputs: Stage 1 fixture labels, Stage 3 traces, PDF rubric.
- Output: versioned 50-case corpus with explicit rubric fields, including real scan-form cases, complete/partial/missing data, citation correctness, factual consistency, refusal, privacy/no-PHI, worker handoffs, and follow-up grounding.
- Verification: baseline report, exact rubric mapping, mutation/injected-defect proof, per-category threshold, zero critical safety/privacy tolerance, and reproducible command.

**Subagent K: observability/UI owner**

- Inputs: Stage 3 output and Stage 4 rubric.
- Output: source-preview/click-to-source interaction, page/region highlighting where feasible, redacted trace fields, stage latency, retrieval hits, confidence, cost, and evaluation outcome.
- Verification: clean-browser readback shows the same citation metadata users see in traces; no raw document/PHI content is logged.

Coordinator checkpoint: run full local tests, W2 gate, defect injection, and representative fixture matrix. Reconcile all ledger rows before release work.

### Stage 5 — Jev comparison and promotion decision

**Subagent L: Jev comparator**

- Inputs: final standard-supervisor baseline, same labeled corpus, approved Jev key/provider boundary.
- Output: paired standard-vs-Jev report covering routing quality, clarification/abstention, unsafe handoffs, traceability, reproducibility, latency, and cost.
- Verification: identical cases and inputs; no raw restricted data; standard path remains runnable without Jev; all Jev outputs pass the deterministic safety/type guard.
- Decision: promote only if safety/traceability/reproducibility do not regress, quality is at least baseline, and cost is lower or the owner explicitly accepts the cost tradeoff.
- Stop: no provider key, external call, or promotion if the data-processing boundary is not authorized.

### Stage 6 — Early checkpoint, then final package

**Subagent M: release-evidence assembler**

- Inputs: all accepted implementation reports, current branch/revision, deployment target, evidence ledger.
- Output: early checkpoint package first: current candidate deployment, evaluation framework, observability, setup/runbook, and a demo script. After checkpoint feedback, assemble final package with architecture, metrics, CI evidence, 50-case results, cost/latency report, video custody, social post, and interview checklist.
- Verification: intended-client black-box readback ties repository revision, deployed revision, URL, setup docs, traces, eval results, and artifacts to the same candidate. Old deployment evidence is rejected.
- Human-owned actions: the user records the demo, approves deployment/publication, sends the social post, and completes interviews.

## Dependency graph

```tex
A + B (contracts)
        |
        +--> C (forms) --> D (VLM/OCR) --+
        |                                  |
        +--> E (OpenEMR roundtrip) --------+--> G + H (active workers)
        +--> F (retrieval benchmark) ------+          |
                                                     v
                                               I (supervisor)
                                                     |
                                             J + K (eval/UI/trace)
                                                     |
                                                     +--> L (Jev comparison)
                                                     |
                                                     v
                                             M (early -> final release)
```

Parallelism is permitted only for C/E/F after contracts are frozen, and for J/K after the supervisor contract is stable. L waits for the standard baseline and rubric-aligned gate. M waits for J/K and the relevant runtime evidence.

## Acceptance evidence ledger

| Outcome | Primary proof | Status at plan start | Owner |
|---|---|---:|---|
| Two varied scan-form types with labels | Fixture manifest, rendered fixtures, ground truth, spot-check record | `PASS` (synthetic local) | C |
| VLM/OCR extraction with citations and uncertainty | Tesseract baseline, local-VLM contract/adapter tests, and PaddleOCR-VL runtime reports | `INCONCLUSIVE` for promoted VLM extraction; deterministic OCR baseline `PASS` | D |
| Complete/partial/missing/conflicting handling | Contract tests, traces, gate cases | `PASS` (synthetic local) | B/J |
| Source and derived-fact runtime round trip | Intended-client readback and deduplication evidence | `PASS` (synthetic runtime); live OpenEMR `INCONCLUSIVE` | E |
| Active independent workers | Multi-step traces and worker contract tests | `PASS` (synthetic local); hosted path `INCONCLUSIVE` | G/H/I |
| Defensible retrieval choice | Fixed benchmark with quality/cost/latency/replay report | `PASS` (local baseline); true vector `INCONCLUSIVE` | F |
| Rubric-aligned 50-case gate | Versioned cases, mapping, baseline, mutation failure | `PASS` (local); hosted CI `INCONCLUSIVE` | J |
| Click-to-source proof | Clean-browser source preview/readback | `PASS` (local HTTP/HTML); clean external browser `INCONCLUSIVE` | K |
| No-PHI observability | Redaction tests plus runtime trace inspection | `PASS` (local synthetic traces); deployed readback `INCONCLUSIVE` | K/J |
| Jev comparison | Paired report on identical corpus and deterministic guard | `PASS` (synthetic standard baseline; live Jev/cost promotion `INCONCLUSIVE`) | L |
| Early submission package | Current deployment, eval, observability, demo custody | `INCONCLUSIVE` / `NEEDS_HUMAN` for user-owned demo | M |
| Final package | Matching revision/deployment, docs, metrics, video, social/interview checklist | `INCONCLUSIVE` / `NEEDS_HUMAN` for external actions | M |

## Quality gates

- Every subagent report names exact files, commands, outputs, and residuals.
- No `PASS` is awarded from unit tests when runtime, browser, deployment, or external evidence is required.
- The current synthetic path remains labeled synthetic; the current lexical retrieval remains labeled lexical/proxy unless the benchmark proves otherwise.
- Public claims use observed metrics, not targets or models presented as measurements.
- Public/demo artifacts contain no PHI and no secrets.
- Full AgentForge tests and the W2 gate run after every integration checkpoint.
- Injected defects must fail the gate before the gate is considered credible.

## Resource plan and circuit breakers

- One coordinator/integrator; maximum three concurrent subagents during independent fixture, runtime, and retrieval spikes; maximum two during integration.
- Each subagent gets one bounded context packet and a time/token budget set before dispatch. A timeout yields `INCONCLUSIVE`.
- Avoid provider calls until the provider/data-processing boundary is explicit. Jev is optional and cannot block the standard path.
- Do not spend effort on third-document, trend, or platform-factory work until the two-document scan-form path passes its evidence gate.
- Stop and reconcile rather than fan out further after two consecutive contract mismatches or two failed attempts to obtain the same runtime proof.

## Implementation handoff

The next agent should start with the verification checkpoint, not with a new
provider integration:

1. Read this plan and the assignment delta review.
2. Inspect `contracts.js`, `labEvidence.js`, `intakeEvidence.js`, `guidelineEvidence.js`, `supervisor.js`, `w2RegressionGate.js`, `sourceDocuments.js`, and the current UI/evidence docs.
3. Run `npm.cmd test --prefix agentforge` and
   `npm.cmd run eval:gate --prefix agentforge` plus the injected-defect gate.
4. Preserve the local synthetic PASS rows and keep provider, deployment,
   browser-clean-user, demo, interview, and live OpenEMR rows unresolved.
5. Do not modify the existing user-owned issue-11 scratch file.

The exact next artifact is the verification report and restartable checkpoint.

## Completion record

Result: `NEEDS_HUMAN` for provider/runtime/external proof; local source-material
gap closure is verified.

Changed surfaces include the frozen contract packet and fixture manifest,
six synthetic scan-form fixtures and four SVG previews, four sourced public
blank forms, scan contracts and deterministic/local-VLM adapters, active
workers/supervisor integration, retrieval benchmark, rubric mapping,
source-preview UI and HTTP routes, architecture/evidence reports, checkpoin
docs, and regression tests. The protected issue-11 file was not edited by
this run; its dirty state is pre-existing user work.

Checks at the gap-closure checkpoint: `npm.cmd test --prefix agentforge` = 112/112; baseline
`npm.cmd run eval:gate --prefix agentforge` = 50/50 with all five mapped
rubrics at 100%; injected-defect gate exits 1 with extraction 7/8 and rubric
regression 0.9375; scan-form manifest/preview integrity passes; changed
JavaScript syntax checks and `git diff --check` pass; the HTTP integration
test reads back page/region citations, the source-preview HTML, and both
active worker handoffs.

Remaining risks and proof gaps: structured extraction promotion for the
selected larger local VLM, authorized hosted provider/data-processing if later
desired, true vector retrieval, live OpenEMR source/derived fact persistence,
deployed/current-candidate identity, clean-user browser readback, dedicated
deployed traces, owner-recorded 3–5 minute demo, technical and final
interviews, social/publication, and submission authority. These are
`INCONCLUSIVE` or `NEEDS_HUMAN`; no local test relabels them.

Exact next action: keep the deterministic/Tesseract baseline active and design
a bounded parser/grammar layer for the selected local PaddleOCR-VL runtime,
then re-run the same 8-case gate. The larger model is installed locally but is
not promoted because its structured contract score is 0/8 despite 8/8 raw-tex
matches. A managed API remains a later option for production-shaped quality.
Hosted provider authority, deployment target, public URL, demo custody, and
external submission path remain separate decisions; do not silently combine
them. Until then, resume from
`AUTONOMY_CHECKPOINT.md` and preserve live OpenEMR GET-only plus the synthetic
clinician-confirmed action boundary.

## Continuation — 2026-09-23 visual pass

The local demo workspace now uses a quieter teal palette, clearer spacing, and
44px controls at phone widths. The source preview presents extraction status,
verified-field/page counts, citation regions, and grouped missing, uncertain,
or conflicting fields. A local workspace screenshot was inspected at a narrow
viewport. Browser policy blocked opening the generated temporary source-preview
file, so that page's visual appearance remains uninspected. After preserving
the existing preview wording, the serial AgentForge suite passed 118/118 and
the W2 gate passed 50/50. `.gitlab-ci.yml` now defines those sequential checks;
GitLab has not run it and protected-branch enforcement has not been changed.
No provider calls, deployment, or external writes were performed.

Next local action remains the bounded VLM grammar/parser continuation; provider
selection/use, deployment, clean-user browser proof, and the recorded demo stay
open owner decisions or proof gates.
