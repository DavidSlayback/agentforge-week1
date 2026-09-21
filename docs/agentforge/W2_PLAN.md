# AgentForge Week 2 execution plan

**Goal:** Extend the Week 1 synthetic clinical co-pilot with a narrow,
source-grounded document-evidence flow for a lab PDF and intake form, bounded
synthetic OpenEMR writeback for source documents and derived observations, an
inspectable supervisor plus two workers, and a regression-blocking evaluation
gate.

**Current state:** The source-linked intake and gap analysis are recorded in
[`W2_ASSIGNMENT_REBASELINE.md`](W2_ASSIGNMENT_REBASELINE.md). Week 1 has a Node
service, read-only OpenEMR adapter, strict evidence/verifier seams, synthetic
fixtures, a 9-case golden corpus, and redacted observability. No W2 document
ingestion, W2 schemas, hybrid retriever, supervisor graph, citation overlay, or
50-case W2 gate is evidenced in the current tree. The Week 2 source explicitly
requires source-document and derived-fact round-trip through OpenEMR, so the W2
plan supersedes Week 1's read-only boundary only for controlled synthetic
document/observation persistence; autonomous or unconfirmed clinical action
writes remain prohibited.

**Workflow state:** `QUEUED`. Completed `RESEARCHING -> DESIGNING ->
PLANNED -> QUEUED -> IMPLEMENTING -> VERIFYING -> REVIEWING -> RECONCILING`
for ticket 01, grilling rounds
1–3, and the product/scope decisions needed for a fast build. The current
bounded run is executing the approved ticket DAG with one implementation lane
and a durable checkpoint after each milestone.
Technical planning uses bounded assumptions for the writeback seam,
idempotency, citation interaction, and early checkpoint. The remaining items
are implementation proof, spike acceptance, and external release authority.
Checkpoint:
`docs/agentforge/W2_ASSIGNMENT_REBASELINE.md`. Stop before implementation or
ticket publication while any material acceptance or authority boundary remains
ambiguous.

## Brainstorm

### User outcome

A primary-care physician can inspect recent synthetic document evidence during
return-visit preparation, distinguish patient-record facts from guideline
evidence, follow citations to source regions, and ask a grounded follow-up. The
system remains useful when extraction is incomplete and must make uncertainty,
missing data, and unsupported claims visible.

### Product definition

This is an **evidence-triage copilot**, not an autonomous clinical decision-maker.
It helps the clinician see what changed, what is abnormal, incomplete, or worth
reviewing, and which patient-record and guideline evidence supports that focus.
The primary interface is a structured review workspace; a chat-like follow-up is
optional and must use the same evidence contract. “Copilot” describes workflow
assistance, source navigation, and grounded follow-up. It may prepare a
clinician-authored diagnosis or order for explicit review and writeback, but it
must not invent, sign, or autonomously execute a clinical action.

### Actors and responsibilities

- **Clinician:** uploads or selects synthetic documents, reviews extracted facts,
  evidence, citations, and qualified answers; remains the decision-maker. The
  clinician may also provide an explicit diagnosis or order for structured
  confirmation and synthetic writeback.
- **Document boundary:** associates a file with a synthetic patient and produces
  validated facts with source coordinates.
- **Supervisor:** routes work and declares when enough verified evidence exists;
  it does not invent facts or clinical actions. The default implementation is a
  deterministic Node graph. A Jev-backed typed judgment is evaluated in a
  parallel spike for semantic routing/ambiguity decisions; code retains
  ownership of policy, verification, confirmation, and side effects.
- **Intake extractor:** extracts intake-form fields and confidence/citation data.
- **Evidence retriever:** retrieves and reranks guideline chunks with metadata.
- **Verifier/eval gate:** rejects unsupported, uncited, unsafe, cross-patient, or
  PHI-bearing results and blocks regressions.
- **Action confirmer:** turns an explicit clinician instruction into a reviewable
  diagnosis/order draft, requires confirmation, and writes only the confirmed
  synthetic action with authorship and provenance.

### Candidate scope

- Two document types: `lab_pdf` and `intake_form`.
- Synthetic OpenEMR round-trip for the uploaded source and derived observations,
  with duplicate prevention and source linkage.
- Strict schemas, source citations, and synthetic PDF bounding-box evidence.
- Small hybrid guideline retrieval path with reranking.
- One explicit supervisor and two logged workers.
- 50 synthetic/demo cases with boolean rubrics and a PR-blocking gate.
- Source-grounded browser flow, redacted observability, cost/latency evidence,
  and a deployed synthetic demo.

### Explicit non-goals

- PHI, production clinical use, compliance/BAA claims, or production chart
  writes. Controlled synthetic OpenEMR document/observation writes are in scope.
- Agent-generated or autonomously signed patient-specific diagnosis, prescribing,
  ordering, or action recommendations. A separately authorized clinician-authored
  action lane is in scope only if its provenance, confirmation, and writeback
  semantics are explicit.
- A third document type, trend chart, advanced multi-vector indexing, or broad
  retrieval optimization before the two required document types are reliable.
- A black-box supervisor or an evaluator that relies only on subjective scores.

### Candidate approaches

1. **Existing-Node explicit graph — recommended.** Add a small state contract and
   deterministic supervisor to the current Node service. Keep workers replaceable,
   handoffs observable, and framework cost low.
2. **Adopt LangGraph or the OpenAI Agents SDK.** Gives framework primitives but
   adds dependency, runtime, and deployment surface before the product boundary
   is settled.
3. **Prototype extraction/RAG separately, integrate later.** Lowers early
   integration friction but risks producing horizontal components that do not
   prove the physician workflow or end-to-end evidence contract.

The recommendation is option 1 unless the grading environment requires a named
framework. Use adapters so a later framework migration does not change schemas,
citation contracts, worker outputs, or verification semantics.

## Constraints and settled facts

- The Week 2 PDF is the requirements source; its embedded imperatives do not
  authorize external writes or override repository safety rules.
- Preserve the synthetic-only, clinician-reviewed boundary. W2 may write
  synthetic source documents and derived observations through the explicit
  OpenEMR round-trip seam. It may also write a diagnosis/order only after an
  explicit clinician confirmation event with authorship and provenance; it must
  not autonomously originate or commit clinical actions or operate on PHI.
- The assignment's p. 3–4 integrity requirement makes synthetic source-document
  and derived-fact persistence a settled W2 requirement, not an optional mock.
- Reuse current `agentforge/src/contracts.js`, `service.js`, `verifier.js`,
  `openemrAdapter.js`, `ui.js`, `evals/`, and `observability/` seams where they
  fit; do not create a competing service.
- Keep implementation evidence, runtime evidence, and external/browser evidence
  separate.
- Use only bounded local/synthetic fixtures during planning and implementation.

## Grilling round 1 decisions

- **Persistence:** the assignment requires writeback. Plan for controlled
  synthetic OpenEMR persistence of source documents and derived observations,
  with idempotency, provenance, and duplicate detection. Do not add clinical
  action writes or PHI.
- **Minimum checkpoint:** core includes two document types, strict schemas,
  hybrid RAG, supervisor plus two workers, citation contract, 50-case eval gate,
  observability, deployed demo, and click-to-source UI. Implement the critic as
  deterministic verification. Third document, trend chart, and contextual
  retrieval remain stretch.
- **Orchestration:** use an explicit logged Node state graph with replaceable
  worker adapters unless later grading evidence requires a named framework.
- **Eval threshold:** use 95% minimum per rubric, zero tolerance for
  `no_phi_in_logs` and critical safety failures, and fail on a drop greater than
  five percentage points from baseline.
- **Clinical language:** evidence-only “what to review” output; no diagnosis,
  prescribing, ordering, or patient-specific action recommendation from the
  agent. Clinician-authored actions are handled by a separate confirmed action
  lane.

## Grilling rounds 2–3 decisions so far

- **Interaction:** make the structured review workspace primary; allow optional
  natural-language follow-up only through the same source/citation contract.
- **Jev candidate:** compare Jev's typed semantic routing/ambiguity judgments
  with the standard supervisor in a parallel spike. Keep the production path's
  state graph, schemas, safety rules, verification, and writeback deterministic
  and inspectable. Do not make Jev or provider details a prerequisite for the
  fast path.
- **Early checkpoint:** adopt the proposed two-document thin vertical slice,
  including the evaluation scaffold, redacted observability, and deployed demo,
  even if it is stronger than the minimum early-submission bar. Treat the final
  submission as a separate target rather than assuming the early package is the
  final package.
- **Clinician action writeback:** support explicit clinician-authored diagnosis
  and order drafts with review, confirmation, authorship, and provenance. The
  copilot may transcribe/structure the instruction but may not originate or
  autonomously commit the action.
- **Action-lane timing:** keep the action lane out of the early critical path and
  wait until the 50-case regression gate is credible. Then add it as a focused
  second vertical slice, demonstrating one diagnosis resource and one order
  resource before generalizing.
- **Early checkpoint ownership:** keep deployment, evidence packaging, and the
  checkpoint path as one ticket. The user owns execution of the demo itself;
  the ticket supplies the working synthetic path and reviewer evidence.
- **Jev spike:** compare Jev and the deterministic supervisor on the same small
  labeled corpus, initially 20–30 paired cases. Measure routing correctness,
  clarification/abstention, unsafe handoffs, latency, cost, traceability, and
  reproducibility. Promote Jev only if it has no safety or traceability
  regression, at least matches baseline quality, and is cheaper and preferably
  faster. A quality improvement that costs more remains a validated alternative
  unless explicitly authorized.

## Planning assumptions and remaining decisions

1. **Writeback target:** use the existing OpenEMR document-upload route for the
   source file and a narrow, authenticated, synthetic-only module seam backed by
   `ObservationService` for derived observations. Do not broaden the general
   FHIR API unless implementation evidence requires it.
2. **Idempotency:** use `patient_uuid + sha256(file_bytes) + doc_type` for the
   source document and `source_document_id + normalized_field + collection_date`
   for derived facts. Store the source-document ID and extraction revision on
   every derived record.
3. **Citation interaction:** use a browser PDF preview with page, field/chunk
   ID, quoted value, and bounding-box highlight. This is the acceptance shape
   unless reviewer feedback establishes a different contract.
4. **Early checkpoint:** demonstrate both document types through a thin deployed
   end-to-end path with the eval framework and redacted observability wired in;
   continue to the full 50-case gate and final package afterward.
5. **NEEDS_HUMAN before external release:** confirm deployment target, public
   access authority, demo-video custody, provider/data-processing limits, and
   whether external publication is authorized. Calendar dates are intentionally
   not part of the execution plan; follow the relative sequence in the
   assignment.
6. **Clinician-authored action lane:** support diagnosis/order drafts only after
   explicit clinician confirmation, with authorship, provenance, and a separate
   OpenEMR resource mapping.

### Writeback research finding

The current OpenEMR fork exposes `POST /apis/default/api/patient/:pid/document`
in `apis/routes/_rest_routes_standard.inc.php:496-512` and a FHIR
`DocumentReference/$docref` upload route in
`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:247-289`. The FHIR
Observation surface currently exposes GET routes only
(`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:493-499`), while
`src/Services/ObservationService.php:465-615` contains server-side persistence
logic. The recommended design is therefore source upload through an existing
OpenEMR document route plus a narrow, authenticated, synthetic-only write seam
for derived observations backed by the existing service. Adapter-only storage
would not satisfy the literal round-trip requirement.

## Approach

Keep the existing Node service as the product boundary and add explicit seams
for ingestion, writeback, extraction, retrieval, routing, verification, and
observability. Use deterministic fixtures and a small inspectable state graph;
keep model/VLM/reranker calls behind adapters. The core user-visible vertical
slice is:

`synthetic patient + lab PDF/intake form -> OpenEMR source/derived round-trip ->
validated extraction -> guideline evidence -> supervisor routing -> verified
answer with click-to-source citations -> redacted trace/eval result`.

The early submission is a checkpoint on this path. It is not permission to
claim production readiness or to skip final hard gates.

## Seams and surfaces

- **Existing AgentForge:** `agentforge/src/contracts.js`, `service.js`,
  `verifier.js`, `openemrAdapter.js`, `ui.js`, `evals/`, and `observability/`.
- **Proposed AgentForge modules:** document ingestion/writeback adapter,
  strict W2 schemas, extraction worker, guideline retriever, supervisor graph,
  citation normalizer, and W2 trace fields. Keep each replaceable and tested at
  its contract boundary.
- **OpenEMR source write:** existing standard document route in
  `apis/routes/_rest_routes_standard.inc.php:496-512` or its FHIR
  `DocumentReference/$docref` equivalent.
- **OpenEMR derived write:** a narrow synthetic-only authenticated seam backed by
  `src/Services/ObservationService.php:465-615`; do not expose arbitrary writes.
- **Fixtures/evidence:** add synthetic lab PDFs, intake forms, guideline chunks,
  expected schemas, citation boxes, writeback IDs, and negative cases under the
  existing `docs/agentforge/fixtures/` and `evals/` conventions.
- **User-visible:** extend the current browser UI rather than create a second
  application; show extraction confidence, evidence type, source preview, and
  qualified follow-up behavior.

## Execution slices

These are plan slices, not published tickets. They follow the assignment's
Stages 1–5 and can become tickets after scope review.

1. **Stage 0 — freeze contracts and fixtures.**
   - Depends on: none.
   - Surfaces: W2 schemas, citation shape, writeback idempotency contract,
     state graph states, synthetic document fixtures.
   - Verification: schema negatives, contract tests, duplicate-key cases.
   - Evidence: reviewed contract document and passing local tests.
2. **Stage 1 — ingest and round-trip.**
   - Depends on: Stage 0.
   - Surfaces: upload route/client, extraction worker, writeback adapter,
     `ObservationService` seam, fixture corpus, UI upload/status path.
   - Verification: both document types upload, persist, re-read, deduplicate,
     and return strict facts with source/page/box metadata.
   - Evidence: local API tests, synthetic OpenEMR readback, redaction tests,
     browser path.
3. **Stage 2 — hybrid RAG.**
   - Depends on: Stage 0 and extracted/cited facts from Stage 1.
   - Surfaces: guideline corpus/index, sparse+dense retriever, reranker adapter,
     evidence contract.
   - Verification: relevant chunks are retrieved/reranked, metadata survives,
     unsupported guideline claims are withheld.
   - Evidence: retrieval fixtures, ranking tests, citation/evidence evaluator.
4. **Stage 3 — supervisor and two workers.**
   - Depends on: Stages 1–2.
   - Surfaces: explicit Node graph, supervisor, intake extractor,
     evidence retriever, handoff trace schema, answer verifier.
   - Verification: routing decisions and handoffs are inspectable; missing or
     failed extraction/retrieval produces qualified output.
   - Evidence: state-transition tests, redacted traces, browser follow-up.
5. **Early-submission checkpoint.**
   - Depends on: Stage 3 plus an initial eval/observability scaffold.
   - Surfaces: deployment configuration, evaluator page, dashboard, demo guide.
   - Verification: deployed synthetic flow, eval framework present, observability
     visible, 3–5 minute demo path works.
   - Evidence: clean-browser readback, API collection, trace/eval artifacts, demo
     custody record. External publication remains owner-gated.
6. **Stage 4 — 50-case eval gate.**
   - Depends on: Stage 3 and early checkpoint feedback.
   - Surfaces: 50-case dataset, boolean rubrics, baseline report, local hook or
     equivalent CI gate, mutation/regression fixture.
   - Verification: all required categories are measured; injected regression
     fails the gate; no PHI appears in logs.
   - Evidence: reproducible command, baseline/results JSON, failed-regression
     output, CI or hook readback.
7. **Stage 5 — integrate and defend.**
   - Depends on: Stage 4.
   - Surfaces: source-grounded UI, W2 architecture/metrics docs, cost/latency
     report, deployment artifacts, demo/interview package.
   - Verification: current candidate identity, clean browser, health/readiness,
     full core flow, citations, evals, observability, and limitations all read
     back through intended clients.
   - Evidence: implementation, runtime, and external evidence kept separate.

## Submission package contract

Completing the implementation stages is necessary but not sufficient; the
following named artifacts and readbacks are part of the W2 acceptance surface.
Do not treat a runbook, an inferred file, or a prior Week 1 artifact as a
substitute for the named deliverable.

| Deliverable | Required artifact or proof |
| --- | --- |
| Architecture | `W2_ARCHITECTURE.md` at the documented submission path, covering ingestion flow, worker graph, RAG, eval gate, risks, and tradeoffs. |
| Metrics | `KEY_METRICS.md` at the documented submission path, with W2 definitions, rationale, success interpretation, and observed-versus-target boundaries. |
| Schemas | Versioned `lab_pdf` and `intake_form` Pydantic/Zod schemas with citation and bounding-box fields, fixtures, and negative validation tests. |
| Evaluation | A versioned 50-case dataset with expected behavior, boolean rubrics, explicit judge configuration, baseline/results artifacts, and error analysis. |
| Regression gate | A checked-in gate command invoked by versioned GitLab CI (or an equivalent versioned CI system) that runs the W2 suite, blocks below threshold or >5 percentage-point regressions, and has an injected-failure proof. |
| Setup and environment | README/setup instructions that identify the exact branch/service/fixtures and document every W2 environment variable, server-only secret, default, and synthetic-only constraint. |
| Demo | A reproducible 3–5 minute recording, with verified custody/link, showing upload, extraction, evidence retrieval, citations/source navigation, eval results, and observability. |
| Cost and latency | A report separating actual development spend, observed W2 p50/p95 latency by stage and end-to-end path, projected production cost, assumptions, and bottleneck analysis. |
| Deployment/repository | Readback tying the submitted GitLab revision, deployed revision, public URL, setup docs, and evidence artifacts to the same W2 candidate. |
| External gates | Owner checklist for early technical interview; final social post; and final AI interview/email follow-up. These are human-owned and must not be implied by local tests. |

The clinician-confirmed action lane remains optional for this submission list
unless the source assignment separately promotes it to a hard gate; it must not
block the required package by default.

## Acceptance evidence ledger

| Requirement group | Acceptance proof | Status | Next action |
| --- | --- | --- | --- |
| W2-02/W2-10 writeback | Source document and derived observation persist, re-read, deduplicate, and retain provenance in synthetic OpenEMR | INCONCLUSIVE | Freeze writeback contract; implement Stage 0–1 tests |
| W2-03/W2-06 schemas and citations | Both schemas reject invalid data; every displayed claim has citation and PDF box | INCONCLUSIVE | Define contracts and fixture set |
| W2-04 RAG | Hybrid retrieval/rerank returns source metadata and withholds unsupported evidence | INCONCLUSIVE | Select bounded local/provider adapters and corpus |
| W2-05 graph | Supervisor routes explicit worker handoffs and produces qualified final state | INCONCLUSIVE | Implement Stage 3 state contract |
| W2-07 eval gate | 50 cases, expected behavior, boolean rubrics, explicit judge config, 95% thresholds, >5-point regression failure, injected defect blocked | INCONCLUSIVE | Define baseline, judge config, mutation cases, and versioned CI invocation |
| W2-08/W2-09 observability | Step latency/tokens/cost/hits/confidence/eval are logged without raw PHI | INCONCLUSIVE | Extend current redacted trace contract |
| W2-11–W2-13 release package | Named submission artifacts, W2 demo video, cost/latency report, matching GitLab/deployment revisions, external gates, and reviewer-visible proof | INCONCLUSIVE | Defer until early checkpoint and release authority |

## Quality gates and stop conditions

- No implementation ticket starts until Stage 0 contracts and the synthetic
  writeback boundary are reviewed.
- No worker may write clinical actions, accept unverified extraction as fact, or
  emit raw document content into traces.
- No acceptance row becomes `PASS` from unit tests alone when runtime or external
  evidence is required.
- Stop at `NEEDS_HUMAN` for deployment/publication authority, provider/data
  processing, active deadlines, or any scope expansion.
- Stop at `INCONCLUSIVE` when a required writeback, citation, privacy, gate, or
  reviewer-path check cannot be directly exercised.

## Resource plan

- Keep the first implementation pass local and synthetic; no external provider
  activation is needed to prove the contracts.
- Use one implementation lane until the shared schemas/writeback seam are stable;
  parallelize only independent fixture/eval or documentation work afterward.
- Cap the early checkpoint to the thin end-to-end path; do not spend the budget on
  third document types or advanced retrieval before the core gate is credible.
- Reuse existing Node tests and observability harnesses; add targeted tests rather
  than broad framework adoption.

## Next action

The local plan has been decomposed into 11 dependency-aware local tickets under
`.scratch/agentforge-week2/issues/`, numbered in blocker order. The remaining
gate is external release authority: deployment target, public access, demo
custody, provider/data-processing limits, and publication permission. When
authorized, promote the local tickets to the configured tracker and then work
the frontier in order:

`01 -> (02, 03) -> 04 -> 05 -> 06 -> (07, 09, 10)`

with `08` blocked by `09`, and `11` blocked by `07`, `08`, `09`, and `10`.

Do not deploy, publish, or expose the application without the relevant
authority. The local ticket set is ready for implementation handoff.

### Ticket 01 milestone

Ticket 01 is accepted with a residual. The synthetic adapter, service seam, UI,
and HTTP path support both source-document types, deterministic persistence and
readback, deduplication, patient-scope checks, a distinct write-scoped context,
synthetic-roundtrip provenance, and live-mode refusal. Verification: targeted
and full AgentForge tests pass 72/72, and changed JavaScript syntax checks pass.
The literal real-OpenEMR persistence/readback row remains `INCONCLUSIVE`; this
local seam does not claim that external integration proof. W2-02 and W2-10 also
remain `INCONCLUSIVE` because derived observations, both document extractors,
and the broader round-trip requirements are not yet implemented.

The standards review identified a Week 1 read-only ADR conflict. The current
W2 plan is the explicit task-scoped override: only synthetic source/document
and derived-observation persistence is allowed in this run; live OpenEMR stays
GET-only, and clinician-authored diagnosis/order writes remain a later,
separately confirmed lane. The implementation enforces this with a distinct
`write-source-document` context and `synthetic-roundtrip` provenance label.

### Ticket 02 milestone

Ticket 02 has a synthetic evidence slice accepted with residuals. The local
parser validates required lab fields, qualifies missing/unreadable/conflicting
input, emits source-linked citation metadata with page/field/quote/bounding-box
coordinates, and persists derived observations through a deterministic
synthetic adapter with API-level deduplication. The full suite passes 75/75.
Real PDF/OCR, real OpenEMR observation roundtrip, browser PDF highlighting, and
an observation-specific API fault injection remain `INCONCLUSIVE`.

### Ticket 03 milestone

Ticket 03 has a synthetic evidence slice accepted with residuals. The local
parser validates the required intake categories, keeps missing/unreadable or
contradictory fields qualified, emits source-linked section citations, and
persists linked synthetic observations through the shared adapter. The full
suite passes 78/78. Real form/PDF ingestion, real OpenEMR observation
roundtrip, browser source navigation, and observation-specific API fault
injection remain `INCONCLUSIVE`.

### Ticket 04 milestone

Ticket 04 has a synthetic retrieval slice accepted with residuals. A bounded
versioned corpus now produces deterministic sparse and dense-proxy scores,
reranked guideline evidence with source metadata and synthetic locations, and a
patient-scoped API that keeps chart facts separate from guideline evidence.
Empty or irrelevant queries are qualified. The full suite passes 81/81. A
production retrieval index, true dense embeddings, model answer integration,
and browser evidence display remain `INCONCLUSIVE`.

### Ticket 05 milestone

Ticket 05 has a deterministic supervisor slice accepted with a browser residual.
The explicit state graph routes typed intake/evidence inputs through named
workers, logs handoffs, qualifies incomplete evidence, clarifies missing
evidence, and blocks unsafe or uncited evidence before READY. The synthetic API
and contract/integration tests pass 84/84. Full document-to-supervisor browser
journey evidence remains `INCONCLUSIVE`.

### Ticket 06 milestone

Ticket 06 has a local observability/evaluation scaffold accepted with an
integration residual. The existing redacted trace schema now carries handoffs,
extraction status/confidence, evaluation outcome, stage latency, retrieval
attempts, token usage, and estimated cost; the reproducible W2 evaluator covers
the six agreed labels. The full suite passes 86/86. Dedicated traces for the
new evidence/supervisor endpoints and deployment/runtime readback remain
`INCONCLUSIVE`.

### Ticket 07 milestone

Ticket 07 has a synthetic Jev comparison harness accepted with a live-provider
residual. The harness uses the same reproducible 20-case corpus for the
deterministic and Jev lanes, records routing quality, clarification or
abstention, unsafe handoffs, latency, cost, traceability, and failure classes,
and applies a local safety guard to typed Jev output. The Jev lane remains
optional and the deterministic lane remains runnable when the provider is not
configured. The full suite passes 89/89. A live Jev run and a fair costed
standard-supervisor comparator remain `INCONCLUSIVE`; no promotion is made.
