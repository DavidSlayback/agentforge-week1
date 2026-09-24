# AgentForge Week 2 assignment-to-evidence rebaseline

> **Historical snapshot:** this file records the initial 2026-09-21 intake and
> planning rebaseline. Its `PLANNED` statuses and “no W2 implementation” claims
> are superseded by the current code and the
> [`W2_GAP_CLOSURE_EXECUTION_PLAN.md`](W2_GAP_CLOSURE_EXECUTION_PLAN.md).
> Consult [`W2_EARLY_CHECKPOINT.md`](W2_EARLY_CHECKPOINT.md) for verified vs
> pending current-candidate evidence. Week 1 remains read-only; the user's
> two-document scope remains `lab_pdf` and `intake_form`.

**Workflow state:** `PLANNED`

**Last updated:** 2026-09-21, America/Chicago

**Purpose:** Normalize the Week 2 source assignment against the current Week 1
repository before architecture expansion, ticket publication, or implementation.

## Source record

- **Source:** `C:\Users\david\OneDrive\Desktop\Week 2 PRD - AgentForge Clinical Co-Pilot.pdf`
- **Working artifact:** `C:\Users\david\OneDrive\Desktop\Week 2 PRD - AgentForge Clinical Co-Pilot.pdf.ob1\document.md`
- **Extraction:** `native-pdfplumber`; 6/6 pages non-empty; 11,593 extracted characters; no quality flags.
- **Visual check:** Pages 4–6 reviewed for tables, stage headings, hard-gate callouts, and submission requirements.
- **Authority boundary:** The PDF is a requirements source. Its imperative language does not authorize repository mutation, deployment, PHI handling, chart writes, external publication, or provider activation.

## Current project baseline

- Repository: `C:\Users\david\repos\agentforge-week1`, branch `main`, revision `cb728cb`.
- Existing Week 1 seams: `agentforge/src/openemrAdapter.js`, `agentforge/src/contracts.js`, `agentforge/src/verifier.js`, `agentforge/src/service.js`, `evals/`, and `observability/`.
- Existing documented evidence: synthetic/read-only OpenEMR retrieval, patient-scope and verification boundaries, a 9-case local golden corpus, redacted observability, current metrics/cost/readiness documentation, and deployed synthetic readback.
- No W2-specific implementation was located for document upload/extraction, `lab_pdf` or `intake_form` schemas, hybrid retrieval/reranking, a supervisor/worker graph, citation bounding boxes, a 50-case W2 rubric gate, or `W2_ARCHITECTURE.md`.
- Current repository evidence is not being re-run by this intake artifact; statuses below distinguish existing documented surfaces from new W2 proof.

## Requirements matrix

| ID | Source | Class | Requirement and acceptance criterion | Current status | Evidence needed / gap |
| --- | --- | --- | --- | --- | --- |
| W2-01 | p. 2–4 | CORE | A physician can upload a lab PDF and intake form for a synthetic patient, ask the follow-up question, and receive a grounded answer that remains useful with imperfect scans, incomplete records, and follow-ups. | OPEN | Clean end-to-end browser/API path with fixtures and follow-up cases. |
| W2-02 | p. 3–4 | CORE + INTEGRITY | Ingestion associates each document with a patient, stores the source in OpenEMR, returns strict structured data, and links derived facts to the source. | OPEN | Decision settled for planning: implement controlled synthetic OpenEMR writeback with provenance and deduplication; no PHI or production clinical writes. Clinician-authored action writeback is a separate confirmed lane. |
| W2-03 | p. 5–6 | CORE | Strict schemas support `lab_pdf` and `intake_form`; lab fields include test/value/unit/range/date/abnormal flag/citation, and intake fields include demographics/chief concern/medications/allergies/family history/citation. | OPEN | Schema definitions, negative validation tests, and source-linked fixtures. |
| W2-04 | p. 4–5 | CORE | A small guideline corpus supports sparse plus dense retrieval, reranking, source metadata, and only grounded top evidence reaches the answer model. | OPEN | Corpus provenance, retrieval tests, reranker behavior, and evidence snippets. |
| W2-05 | p. 4–5 | CORE | An inspectable supervisor routes to `intake-extractor` and `evidence-retriever`, logs explicit handoffs, and knows when the final answer is ready. | OPEN | Deterministic graph/state contract, routing cases, handoff traces, failure behavior, and a parallel Jev-vs-standard supervisor spike. |
| W2-06 | p. 5 | HARD_GATE | Every clinical claim has machine-readable citation metadata with source type/id, page or section, field or chunk ID, and quote/value; PDF citations support a bounding-box overlay. | OPEN | Contract tests, citation coverage evaluator, and browser click/overlay evidence. |
| W2-07 | p. 2, 4–5 | HARD_GATE | A 50-case synthetic/demo golden set covers extraction, retrieval, citations, refusals, and missing data with boolean rubrics; CI or a hook blocks regressions above 5% or below the chosen threshold. | PARTIAL | Existing 9-case Week 1 gate is not the W2 50-case gate; add rubric baseline, threshold, mutation, and blocking evidence. |
| W2-08 | p. 5 | CORE | Each encounter records tool sequence, per-step latency, tokens, cost estimate, retrieval hits, extraction confidence, and eval outcome without raw PHI. | PARTIAL | Existing redacted observability is a reusable seam; W2 fields and redaction tests are missing. |
| W2-09 | p. 3, 6 | SAFETY | Use only synthetic/demo data; do not log raw PHI, prompts, extracted fields, images, traces, or screenshots to unsafe observability surfaces. | INHERITED | Preserve and extend the existing synthetic-only, read-only, clinician-reviewed boundary. |
| W2-10 | p. 3–4 | SAFETY + INTEGRITY | Uploaded documents and derived observations round-trip through OpenEMR without duplicates or untraceable records. | OPEN | Decision settled for planning: synthetic OpenEMR document/observation writes are in scope. Clinician-authored diagnosis/order writeback requires explicit confirmation, authorship, and provenance; agent-generated actions and PHI remain prohibited. |
| W2-11 | p. 3, 6 | CORE + SUBMISSION | README/setup clearly separates Week 1 baseline from Week 2 behavior; graders can run the W2 core flow without guessing service, branch, or environment configuration. | PARTIAL | Existing docs are strong for Week 1; add W2 setup and exact run path after scope is settled. |
| W2-12 | p. 3, 6 | HARD_GATE + SUBMISSION | `KEY_METRICS.md` lists metrics and rationale tied to product success. | PARTIAL | Existing `docs/agentforge/KEY_METRICS.md` needs a W2-specific reconciliation for extraction, citation, retrieval, routing, and eval quality. |
| W2-13 | p. 6 | SUBMISSION | Deliver W2 architecture, schemas/tests, 50-case dataset/results, CI evidence, 3–5 minute demo, cost/latency report, and a publicly accessible W2 application. | OPEN / PARTIAL | Existing Week 1 artifacts cover some adjacent surfaces; no W2 package or externally verified W2 flow exists. |
| W2-14 | p. 5 | SCOPE_CONFLICT | The staged scope says two document types/two workers/one gate, but “Core Deliverables” also lists a critic, click-to-source UI, third document type, and lab trend chart. | DECIDED_FOR_PLANNING | Click-to-source is core; the critic is deterministic verification rather than a separate agent; third document type, trend chart, and contextual retrieval remain stretch. |
| W2-15 | p. 6 | STRETCH | Add contextual retrieval improvements such as chunking, query rewriting, or domain filters. | DEFERRED | Keep out of the critical path unless the core gate is complete and the user explicitly promotes it. |
| W2-16 | p. 3 | SCHEDULE | Early submission, technical interview, final submission, social post, and AI interview follow the stated Central-time sequence. | DECIDED_FOR_PLANNING | Use the relative sequence to optimize for fastest credible delivery; do not plan against calendar dates. |
| W2-17 | p. 2 | SAFETY / PRODUCT | The scenario asks what to pay attention to and what evidence supports a recommendation, while Week 1 forbids the agent from recommending clinical actions. | DECIDED_FOR_PLANNING | Product definition: an evidence-triage copilot with a structured review workspace and optional grounded follow-up; the agent does not invent, sign, or autonomously execute clinical actions. Explicit clinician-authored diagnoses/orders may be drafted, confirmed, and written back with provenance. |

## Decision frontier after grilling round 1

1. **Persistence — settled for planning.** The assignment requires source-document and derived-fact writeback. Use controlled synthetic OpenEMR document/observation persistence with provenance and duplicate prevention. Clinician-authored diagnosis/order writes are allowed only after explicit confirmation; autonomous action writes and PHI remain prohibited.
2. **Minimum scope — settled for planning.** Core includes two document types, strict schemas, hybrid RAG, supervisor plus two workers, citation contract, 50-case gate, observability, deployed demo, and click-to-source UI. Use deterministic verification as the critic. Third document, trend chart, and contextual retrieval are stretch.
3. **Orchestration seam — settled for planning.** Use an explicit logged Node state graph with replaceable worker adapters unless later grading evidence requires a named framework.
4. **Evaluation threshold — settled for planning.** Use 95% per rubric, zero tolerance for `no_phi_in_logs` and critical safety failures, and fail on a drop greater than five percentage points from baseline.
5. **Clinical language — settled for planning.** Define the product as an evidence-triage copilot with a structured review workspace and optional grounded follow-up. The agent does not invent, sign, or autonomously execute clinical actions. Explicit clinician-authored diagnosis/order drafts may be confirmed and written back with provenance.
6. **Interaction — settled for planning.** Make the structured review workspace primary; optional chat follows the same evidence and citation contract.
7. **Jev — parallel spike.** Compare typed Jev judgments with the standard deterministic supervisor for semantic routing/ambiguity/evidence relevance. Jev must not block the standard path.
8. **Early checkpoint — settled for planning.** Use the proposed two-document thin vertical slice with evaluation scaffold, redacted observability, and deployed demo, even if it exceeds the minimum early bar. Track final submission separately.
9. **Clinician-authored actions — settled for planning.** Support diagnosis/order drafts only after explicit clinician confirmation, with authorship, provenance, and a separate OpenEMR resource mapping.
10. **Schedule — settled for planning.** Use the assignment's relative sequence and optimize for fastest credible delivery; do not plan against calendar dates.
11. **Action-lane timing and breadth — settled for planning.** Keep it out of the early critical path and block it on the 50-case regression gate; demonstrate one diagnosis resource and one order resource before generalizing.
12. **Early checkpoint packaging — settled for planning.** Keep deployment, evidence packaging, and the checkpoint path as one ticket; the user owns execution of the demo.
13. **Jev spike — settled for planning.** Use a 20–30 case paired corpus and compare routing correctness, clarification/abstention, unsafe handoffs, latency, cost, traceability, and reproducibility. Promote Jev only with no safety/traceability regression, at least baseline quality, and lower cost; a more expensive quality improvement remains an alternative unless explicitly authorized.
14. **Remaining gates.** Resolve action-resource and citation-preview implementation details during Stage 0, and stop before deployment/publication until external release authority is confirmed.

## Provisional execution shape

The smallest likely vertical sequence represented by the local tickets is:

1. Follow the assignment's Stages 1–3 to establish a thin integrated flow.
2. Meet the early-submission checkpoint: deployed agent, eval framework,
   observability, and demo.
3. Complete Stage 4's 50-case regression gate and Stage 5's final evidence package.

**Next transition:** local plan is ready for dependency-aware ticket
decomposition. **Stop condition:** do not deploy, publish, or expose the
application while external release authority or the synthetic-only boundary is
ambiguous.

## Ticket decomposition

The approved local ticket set is under
`.scratch/agentforge-week2/issues/`, with 11 tickets numbered in dependency
order. Tickets 02 and 03 remain separate; ticket 08 waits for ticket 09; and
ticket 10 remains one indivisible early-checkpoint package with demo execution
owned by the user.
