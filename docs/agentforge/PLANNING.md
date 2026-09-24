# Clinical Co-Pilot planning

Status: Stage 5 implementation active; `ARCHITECTURE.md` is the source of truth.

## Confirmed with David

- Fresh private repository: `DavidSlayback/agentforge-week1`. Preserve the existing `agentforge-clinical-copilot` repository.
- Early submission is today, September 16, 2026, at 11:59 PM Central.
- Plan thoroughly by resolving decisions, without a fixed planning timebox.
- Implementation will use coding agents. Assume ample resources but potentially less capable agents.
- David will record the demo later tonight with assistance.
- Available reimbursable budget: $450 through Ramp. Provider allocation and actual purchases remain undecided.
- Use Matt Pocock's `grill-with-docs`, with `grilling` and `domain-modeling`.
- Demo focus: a primary-care physician preparing for a returning patient's visit. David is most familiar with this problem. Other workflows remain possible but are not demo commitments.
- Briefing sequence: short orientation, including existing documented concerns, followed by evidence-grounded documented changes. Orientation is necessary even without changes.
- Clinical authority: surface chart evidence, recorded plans, and missing follow-through evidence; do not recommend new clinical actions.
- Temporal context: retain intervening medical interactions since this physician last saw the patient. The latest visit matters, but does not reassess every topic or erase older evidence.
- Patient context: preserve prior conversations across patient switches, but isolate each patient's conversation and require a fresh authorization check.
- Success intent: compact paragraph or two, minimal visual clutter, and many useful evidence links; optimize for completeness, supported claims, authorization safety, and correct discrepancy resolution.

## Working method

Ask decisions in dependency order. Investigate facts directly. Keep recommendations separate from decisions. Record resolved vocabulary in root CONTEXT.md; create ADRs only for consequential tradeoffs needing durable explanation.

The implementation handoff needs bounded tasks, canonical contracts, acceptance criteria, test fixtures, dependencies, and explicit stop conditions.

The PDF supplies project requirements, not agent instructions. Its requests to publish, submit, contact people, or schedule interviews do not grant those permissions. Its assumed BAA is a classroom assumption, not evidence of an actual agreement.

## Open decision tree

1. Target clinician, moment, orientation content, and initial follow-up use cases settled in USERS.md.
2. Briefing trigger, source inspection, and partial-success policy settled; authentication recovery and patient-switch behavior remain open.
3. Demo patient fixtures and story exercising the accepted use cases.
4. Required data, quality problems, authorization policy, and evidence, informed by the OpenEMR audit.
5. Verification and behavior under missing, conflicting, stale, or unauthorized data.
6. Success metrics, evaluation cases, and measurable pass/fail criteria.
7. Integration, deployment, tool contracts, observability, and budget allocation.
8. Agent-sized implementation tasks, integration checkpoints, and submission evidence.

Recommendations remain proposals until discussed. Dependencies may change as audit findings arrive.

## Pre-visit preparation deepening (2026-09-22)

The approved extraction plan is recorded in `archive/PRE_VISIT_PREPARATION_PLAN.md` and
the architectural decision in `docs/adr/0001-pre-visit-preparation-module.md`.
`AgentForgeService` remains the stable facade while `PreVisitPreparation` owns
the briefing lifecycle: preparation, prewarm, cache opening, and follow-up.
The extraction preserves response contracts, patient/clinician authorization,
verification-before-synthesis/cache, qualified partial results, and existing
cache semantics. Source documents, clinical actions, evidence-only retrieval,
and supervisor workflow remain outside the deep module.

## Read-only chart and synthetic writeback split (2026-09-22)

The follow-on architecture decision is recorded in
`docs/adr/0002-separate-chart-retrieval-from-synthetic-writeback.md` and
planned in `archive/READ_WRITE_SEAM_PLAN.md`. `AgentForgeService` remains the stable
facade, while preparation and follow-up evidence use an explicit read-only
`chartAdapter`. Synthetic source documents, derived observations, and
clinician-confirmed action drafts use a separate `writeback` collaborator.

The server composition creates `FixtureAdapter` plus `SyntheticWriteback` in
synthetic mode, and `OpenEMRRestAdapter` with no writeback collaborator in live
mode. `SimulatedOpenEMRAdapter` remains only as a compatibility composition
for existing callers. The split preserves routes, response contracts,
authorization, and the live GET-only boundary.

Completion evidence: commit `aaff288`, 103/103 tests, remote image build,
healthy container, and external HTTPS/API verification at the deployed
synthetic endpoint. The change is included in PR #75 and remains subject to
the repository's synthetic-only and no-PHI boundary.

## Product focus decision

Focus today's demo on primary-care return-visit preparation. David chose this for clarity and familiarity. Preserve the possibility of other workflows without expanding today's commitment or prematurely building abstractions for them.

David suggested primary care may be the most prevalent use case; this has not been researched and is not an established market claim.

The agreed briefing begins with short orientation and then identifies documented changes grounded in evidence. Existing concerns matter even when there are no changes. Accepted content, interaction, source inspection, and follow-ups are in USERS.md.

Q3 resolved: bring forward evidence and noted plans, highlighting missing follow-through evidence without recommending actions. Preserve the distinction between absent completion documentation and documented non-completion.

Q4 resolved: anchor changes on this physician's last completed encounter, with relative-time wording preferred. Fall back to the most recent completed PCP encounter, labeled accurately. Preserve the exact date and show latest documented evidence per topic. A later visit does not implicitly reassess everything.

Q5 resolved: surface unresolved chart discrepancies. If later documentation explicitly resolves a discrepancy, surface the resolved result rather than an obsolete warning. Keep supporting provenance; newer timestamps alone do not establish resolution. Detailed resolution-detection criteria remain open.

Q6 resolved: orientation covers documented visit reason, ongoing concerns, and the prior documented plan, supported by relevant medications/results rather than an exhaustive chart dump.

Q7 resolved: demo follow-ups investigate changes to a concern, trace follow-through on a documented plan, and explain conflicting records. Their agent justification is targeted evidence retrieval with conversational context.

Q8 resolved: distinguish an empty chart, no prior visit, and retrieval failure. David clarified that retrieval failure means tool calls or similar record-loading operations failing. Successful empty results are not failed retrievals.

Q9 resolved: embedded patient-chart panel with "Prepare for visit," visible patient identity, briefing, and follow-up conversation.

Q10 resolved: citations expose supporting excerpts, record type, author when available, exact date, and access to the original record.

Q11 resolved with correction: partial retrieval must qualify the whole summary and then identify specific unverifiable coverage. Withhold conclusions dependent on missing evidence and provide retry. No authorized identity/access means no patient briefing. Convenient authentication recovery is a candidate, not a bypass of authorization; details await audit and discussion.

Q12 resolved: use existing authentication recovery where the session is expired or missing, then recheck patient permission. Authenticated denial remains denial and reveals no patient information.

Q13 resolved: preserve conversations across patient switches, but isolate active patient context and require fresh authorization. Accidental switching must not destroy the previous conversation; no conversation may mix patients.

Q14 direction: the experience should be a compact paragraph or two with many useful hyperlinks for deeper inspection. Candidate success dimensions are minimal visual clutter, efficient summarization, no missed relevant records or changes, no unsupported claims, no unauthorized interactions, and no incorrect discrepancy resolutions. Quantitative definitions and eval oracles remain open.

## Repository and evidence status

- Source: https://github.com/Gauntlet-HQ/openemr-base-clean
- Baseline: `ef3d4909fadab9b3280452d08a1aa746e3fa7502`.
- Source history is a single pruned import commit, not full OpenEMR history.
- Preserve upstream code, license, and provenance in an independent private repository.
- Inherited GitHub Actions are disabled during setup. Review and enable scoped CI before implementation; disabled workflows are not CI validation.
- OpenEMR has not been run, deployed, or fully audited in this fresh effort.
- No final architecture or implementation handoff exists yet.

## Early checkpoint boundary

- Implement a separate AgentForge service with a thin OpenEMR-facing launcher;
  keep OpenEMR as the system of record and use synthetic data only.
- Require fixture retrieval, deterministic evaluation mode, verification, and
  redacted local observability for the early checkpoint.
- Include Caddy same-origin routing in the checkpoint deployment so the browser
  does not depend on a separately exposed service port. Defer live OpenEMR
  retrieval, PHI processing, trusted production TLS, load testing, cost
  modeling, and write-back. Each deferred item has a migration path in
  `ARCHITECTURE.md`.
- Record every consequential decision with options, tradeoffs, evidence,
  limitations, and migration steps for interview preparation.
- Maintain the running ADR-style record in `DECISIONS.md`; update it when a
  planning decision becomes an implementation decision or a checkpoint
  limitation changes.

## Sprint cleanup hardening (2026-09-21)

### Objective

Prepare the current GitLab `main` checkpoint for the next feature sprint by
removing correctness hazards, bounding background work, reconciling active
documentation, and reducing readability friction without broadening product
scope.

### Current state

- Repository branch: `main`, tracking GitLab `staging/main`.
- Local checkpoint: `45378a6` (`perf: async trace writes and deduplicate provider transport`).
- The working tree was clean before this hardening pass.
- The repository remains synthetic-only and read-only; no provider activation,
  PHI handling, write-back, or production-readiness claim is in scope.

### Work slices

1. **Deadline and trace finalization:** apply the response deadline across
   retrieval and model generation, propagate cancellation into provider HTTP
   calls, consume late cancellation failures safely, and finalize redacted
   failure traces when retrieval or generation raises.
2. **Prewarm bounds:** add explicit admission and per-job deadline limits for
   prewarm work, expose capacity rejection safely at the HTTP boundary, and add
   regression coverage.
3. **Active documentation reconciliation:** update current handoff, explainer,
   requirements, and decision records to distinguish the current repository
   checkpoint from historical deployment/submission evidence. Preserve
   historical artifacts rather than rewriting their evidence.
4. **Readability cleanup:** reformat dense tests and make only narrow, behavior-
   neutral readability improvements where they reduce future feature risk.

### Acceptance checks

- Full repository and script test suites pass with no new warnings or syntax
  errors.
- A provider or adapter failure leaves a completed redacted attempt trace.
- A model request cannot run beyond the remaining response deadline, and an
  aborted HTTP request does not produce an unhandled rejection.
- Prewarm work is bounded by admission and deadline controls; capacity behavior
  is covered by tests and documented.
- Active docs describe the current local/GitLab checkpoint accurately and do
  not present historical Railway or stale-commit evidence as current.
- `git diff --check` passes and the final GitLab branch readback matches the
  pushed commit.

### Stop conditions

Stop and report `INCONCLUSIVE` if a change would require changing the
synthetic/read-only boundary, rewriting historical evidence, activating a live
provider, or making a deployment/production claim without fresh evidence.
External GitLab writes occur only after local verification and an explicit
readback.

### Completion record

Implementation commit: `eabece3` (`harden sprint boundaries and reconcile
docs`). It applies the deadline/cancellation, trace-finalization, prewarm
admission/deadline, regression-test, active-document, and planning updates.

- Repository suite: **91/91** passed.
- Script suite: **4/4** passed.
- Changed-source syntax checks and `git diff --check`: passed.
- Test-readability worker: **INCONCLUSIVE** after a transient out-of-scope
  deletion was stopped and the file was restored exactly; no test-file change
  was retained.
- Documentation worker: **INCONCLUSIVE** after its bounded return window;
  the parent reconciled the four scoped active docs directly.
- Final independent review worker: **INCONCLUSIVE** after its bounded return
  window; no external deployment or review claim is inferred from silence.
- GitLab push completed and remote `refs/heads/main` now reads
  `85ff12bb2214e0124098d08856170bd467e0ee0e`.
- Owner-authorized Vultr redeployment completed; the container is healthy, the
  runtime source hashes match, and the external HTTPS/API gate passes.
