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
- Defer same-origin proxying, live OpenEMR retrieval, PHI processing, trusted
  TLS, load testing, cost modeling, and write-back. Each deferred item has a
  migration path in `ARCHITECTURE.md`.
- Record every consequential decision with options, tradeoffs, evidence,
  limitations, and migration steps for interview preparation.
