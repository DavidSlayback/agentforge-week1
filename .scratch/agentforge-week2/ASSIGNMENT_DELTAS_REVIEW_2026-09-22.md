# Week 2 assignment deltas — current-state review

Date: 2026-09-22  
Repository: `agentforge-week1`  
Branch: `davidslayback/pre-visit-preparation`  
HEAD at review: `dcc8a4879b74891ec3e06220b1eff0de83b32e3`

## Source and checkpoint interpretation

Primary source: `Week 2 PRD - AgentForge Clinical Co-Pilot.pdf` (6 pages; native selectable-text extraction; rendered-page QA completed previously).

The assignment contains two deliverables/checkpoints:

- Early checkpoint: deployed agent, evaluation framework, observability, and a 3–5 minute demo video; technical interview follows within 24 hours.
- Final checkpoint: production-ready agent, demo video, and social post; final AI interview follows within 24 hours.

Current classification: **final-submission work-in-progress with an incomplete early-checkpoint package**. Local implementation and evaluation evidence are substantial, but current deployment/submission-path evidence and the required videos/interviews are not proven for the current candidate.

## Delta ledger

| Assignment expectation | Current evidence | Delta / consequence |
|---|---|---|
| Two document types with structured extraction | Synthetic upload/API and line-oriented `LAB|...` / `INTAKE|...` parsers exist | Not equivalent to scanned-PDF/form extraction, OCR, or VLM-based extraction. |
| Robust schema validation and source grounding | Strict-ish validators, citations, and bounding boxes exist | Intake parsing does not enforce all required categories at the document level; broader document/OCR failure cases remain unproven. |
| Retrieval over relevant clinical evidence | Deterministic corpus, sparse token overlap, and a “dense proxy” token-overlap path exist | This is not actual vector/dense retrieval or a true reranker; evidence quality is bounded by the synthetic corpus and lexical scoring. |
| Multi-agent workflow / supervisor | Deterministic supervisor with named workers, handoffs, and verifier exists locally | Architecture is demonstrable, but hosted/current-candidate behavior is not yet re-proven. |
| Critic / grounded response behavior | Verifier, citations, and refusal paths exist | Need explicit evidence that the user-visible answer is factually consistent, safely refuses unsupported claims, and exposes the relevant evidence. |
| Click-to-source evidence UI | Citation metadata and bounding boxes exist; UI expands source-record text | No verified click-to-source navigation, PDF preview, or bounding-box overlay. |
| Regression/evaluation gate | `eval:gate` exists; 50/50 synthetic/content-free cases pass; defect injection fails as intended | Gate labels (`extraction`, `retrieval`, `citation`, `refusal`, `missing-data`, `follow-up`, `safety`) do not exactly match the PDF rubric labels (`schema_valid`, `citation_present`, `factually_consistent`, `safe_refusal`, `no_phi_in_logs`). Need an explicit mapping or rubric-aligned report. |
| Observability and no-PHI logging | W2 gate and documentation exist; logs/evaluation are synthetic | Current hosted/PR/GitLab submission-path readback and a direct `no_phi_in_logs` proof are not established. |
| Key metrics | `docs/agentforge/KEY_METRICS.md` exists | Actual current-candidate p50/p95 latency by stage and end-to-end, plus extraction/retrieval quality and cost evidence, are incomplete. |
| Architecture document | `docs/agentforge/ARCHITECTURE.md` exists | No `W2_ARCHITECTURE.md` matching the assignment naming/packaging expectation. |
| Cost and load evidence | `COST_MODEL.md` and `LOAD_TEST.md` exist | They are plans/models; actual development spend and current-candidate load/latency measurements are not complete. |
| Deployment/submission evidence | Local checks pass: 103/103 tests; 50/50 eval gate; injected-defect gate fails correctly | Deployment docs cite old candidate `d8b4ba8` (also other docs cite `88420c1`); `d8b4ba8` is 15 commits behind HEAD. Public URL, current runtime identity, and submission-path proof are unresolved. |
| Early demo | Demo script exists | No verified current 3–5 minute recording/custody. |
| Final social/interview | Local final-social draft exists | Technical and final AI interview completion are not evidenced. |
| Scope wording | PDF says “two document types, two workers, one regression gate,” but also lists critic, click-to-source UI, third document type, trend chart, and contextual retrieval under core deliverables | Source ambiguity remains. Treat third document type/trend/contextual retrieval as unresolved scope decisions, not silently satisfied or discarded. |
| Clinical action boundary | Current code includes a separately scoped clinician-confirmed synthetic action lane | Some documentation still describes the product as read-only/no writeback; docs must distinguish live OpenEMR read-only behavior from synthetic clinician-confirmed action tests. |

## Verification snapshot

- `npm.cmd test --prefix agentforge`: 103/103 passing.
- `npm.cmd run eval:gate --prefix agentforge`: 50/50 passing.
- `npm.cmd run eval:gate --prefix agentforge -- --inject-defect`: correctly exits 1; extraction 7/8 and regression 0.125.
- Existing user-owned modification: `.scratch/agentforge-week2/issues/11-final-submission-release-evidence.md`; left untouched.

## Additional project-context source

Calendar event: `Intro to Project`.

Shared recording inspected: `Intro to Project - 2026/09/21 11:59 EDT - Recording.mp4` (30:12; 208 MB). The Drive viewer exposed the video and allowed download, but its native Transcript control was disabled in the shared unauthenticated view. A local English speech-to-text pass was run over the downloaded recording (`base.en`, CPU, 16 kHz mono audio); the resulting transcript is in the temporary local artifact `C:\Users\david\AppData\Local\Temp\intro-project-transcript.txt`. The transcript is approximate ASR evidence, not a human-verified verbatim transcript.

### Transcript findings

The recording confirms and sharpens the assignment in ways that should change the implementation/release ledger:

1. **Scan-form VLM extraction is explicit.** The instructor says the solution should read scan forms with a VLM, while guarding against hallucination, linking extracted values to sources, and allowing a human to double-check suspicious output. This upgrades “real scanned-PDF/form extraction” from a cautious interpretation to a directly confirmed requirement.
2. **The input corpus is the student’s responsibility.** No forms are supplied because scenarios differ. We are expected to find scenario-relevant lab PDFs/intake forms, try different form styles, and define what happens when information is missing.
3. **The golden set needs image/form labels and behavioral variants.** The 50-case golden set should include expected extraction labels for images/forms, a complete-data path, partial-data cases, and missing-data flags; additional labels/scenarios should cover the newer extraction and workflow behaviors.
4. **The RAG storage choice is open, but must be defended.** The instructor explicitly allows a vector database or extraction into the existing database. The current lexical/deterministic retrieval may be a useful baseline, but it must be framed as an intentional defended choice or replaced with a stronger retrieval path.
5. **Workers are active independent workflows.** The minimum is one supervisor plus two workers, where each worker can process/reflect/decide through multiple tool calls and return completed work. They are not intended to be thin tool wrappers. This makes the current deterministic worker implementation a likely architecture/evidence gap even though the supervisor shape exists.
6. **Brownfield continuity is required.** The work must build on the Week 1 repository. Week 1 architectural decisions may be revised when they begin to hurt Week 2 progress. Current repository continuity is correct; the ADRs and release package should make any revisions explicit.
7. **The agent factory is not itself a grading gate.** The instructor says the coding workflow/factory is not directly evaluated, while still encouraging progressive construction and verification of trusted agents. This argues against adding orchestration infrastructure merely for its own sake; implementation evidence should remain the priority.
8. **Schedule and submission sequence are confirmed.** Early submission is Wednesday at midnight; technical interviews are Thursday/Friday; final submission is Sunday at noon. Final-only extras include the social post and AI interview, alongside CI evidence and evaluation datasets.

### Timestamped transcript anchors

- `00:01:22–00:01:41`: scan forms, VLM, hallucination control, links, and human double-check.
- `00:02:49–00:03:07`: early deadline and recommended start with lab PDFs/intake forms; find varied forms and handle missing information.
- `00:03:11–00:03:29`: build the RAG pipeline; vector database or existing database are both acceptable if defensible.
- `00:03:32–00:03:46`: small graph; intake extractor plus evidence retriever; minimum supervisor and two workers.
- `00:03:49–00:03:57`: deploy, add observability traces, and defend design choices.
- `00:04:52–00:05:06`: label image/form golden-set outputs, including complete and incomplete data paths.
- `00:06:39–00:07:08`: workers are independent workflows/agents that actively work through problems, not just tool calls.
- `00:07:15–00:07:37`: Week 1 decisions may be revised.
- `00:08:08–00:09:15`: the agent-building factory is encouraged but not itself an evaluation criterion; verify each agent progressively.
- `00:09:48–00:10:36`: build on the existing Week 1 codebase; the brownfield constraint is intentional.

### Updated implications

The most important rebaseline is that the current synthetic line-oriented document path is not enough for the assignment’s demonstrated target. The next implementation/evidence slice should use real or realistically scanned, scenario-appropriate synthetic forms; run a VLM/OCR extraction path with source links and review/refusal behavior; label complete/partial/missing cases; and prove that two workers are active workflows. Keep the early package narrow and demonstrable, then carry the stronger extraction/retrieval/evaluation/deployment evidence into the final package. Do not turn the agent factory into an independent deliverable. Preserve the synthetic-only/read-only live clinical boundary and keep the synthetic clinician-confirmed action seam separately labeled.
