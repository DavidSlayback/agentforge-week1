# Target user and use cases

Status: planning. Target workflow, briefing content, follow-up use cases, and missing-data distinctions are agreed. Acceptance metrics and detailed evidence rules remain open.

## Target user

A primary-care physician preparing to see a returning patient. The demo focuses on the period before entering the patient encounter, when the physician needs to recover relevant chart context.

David chose this workflow because it is clear and familiar to him. Prevalence relative to other workflows has not been verified and is not a selection claim.

## Scope

Primary-care return-visit preparation is the demo focus. Other workflows remain possible future directions, not current commitments.

## Agreed briefing sequence

First give a short orientation to the patient and existing documented concerns. Then identify documented changes grounded in source evidence. The orientation remains useful even when there are no changes: existing concerns can still matter to the visit.

Orientation covers the documented reason for today's visit, ongoing concerns, and where the previous documented plan left off. Medications and results support these points as relevant, with detail available on demand. It is not an exhaustive chart dump.

## Interaction and evidence inspection

An embedded panel in the selected patient's chart provides a "Prepare for visit" button. It generates the orientation and documented changes, then supports follow-up conversation. Keep the selected patient's identity visible within the authorized session.

Selecting a citation shows the supporting excerpt, record type, author when available, and exact date, with a route to the original record. The physician should not have to search the chart again to inspect the evidence.

When the physician switches patients, preserve the previous conversation for return, but isolate it from the new patient's conversation and context. Make the active patient explicit and require a fresh authorization check. No conversation may mix records across patients.

## Clinical authority

Surface chart evidence and plans already documented by clinicians. Highlight missing evidence of follow-through. Do not recommend new clinical actions. Attribute a recorded plan to its source rather than restating it as the assistant's recommendation.

Evidence boundary: a missing completion record supports "no completion found in the records reviewed," not proof that the patient failed to follow through. An explicit record of non-completion can be reported with attribution.

## Longitudinal context

David wants intervening medical interactions since this particular physician last saw the patient to remain visible, with the latest visit especially relevant. A recent encounter does not reassess every concern or test; it must not implicitly replace older evidence on topics it did not address.

Use this physician's last completed encounter as the comparison anchor. Prefer relative-time wording such as "Since your last visit three months ago." Preserve the exact date in the underlying evidence. Show the latest documented evidence for each topic; a later encounter's silence does not supersede earlier evidence.

When this physician has no prior encounter, fall back to the most recent completed primary-care encounter and label it as a primary-care visit rather than falsely calling it "your" visit. Without a PCP baseline, provide dated history without an invented comparison.

## Conflicting evidence

Surface unresolved disagreements with their sources. If later documentation explicitly resolves a disagreement, show the resolved result without presenting the old discrepancy as still open. Retain the resolution evidence and earlier provenance for inspection. Mere recency or omission is not an explicit resolution.

## Demo follow-up use cases

1. Investigate a concern: "What changed about [concern], and where is that documented?" The physician selects a topic from the briefing; the agent retrieves and explains its evidence while preserving patient and comparison context.
2. Trace a documented plan: "What happened with the plan to [documented follow-up]?" The agent follows the selected plan through subsequent evidence, distinguishing documented completion, documented non-completion, and no completion evidence found.
3. Explain a discrepancy: "Explain the conflicting records about [topic]." The agent brings together the selected records and any explicit later resolution, citing the evidence without independently choosing a clinical action.

Conversation earns its place by letting the physician choose which finding to investigate and ask context-preserving follow-ups. A fixed initial briefing alone would not justify an agent; each accepted follow-up requires targeted evidence retrieval and explanation beyond that overview.

## Missing data and retrieval failures

- Empty chart after successful retrieval: state that no clinical records are available in the accessible chart. Do not imply the patient has no concerns.
- No prior encounter: summarize available information without an invented visit comparison.
- Retrieval failure: a tool call, API request, or record-loading operation failed or timed out. Identify the missing coverage rather than treating the failure as an empty result or no change.

A successful lookup returning zero records is not a retrieval failure.

When only some retrieval tools succeed, qualify the summary as a whole as incomplete and identify exactly what could not be retrieved or verified. A section-level warning alone is insufficient. Supported evidence may be shown, but conclusions dependent on missing records must be withheld or explicitly marked unverifiable. Provide a retry path.

If patient identity or authorization cannot be established, show no patient briefing or chart evidence. David raised a convenient authentication flow as a possibility. Proposed distinction, pending integration audit: expired/missing authentication can route through existing login and then recheck patient access; authenticated denial must not be treated as something login automatically fixes.

## Decisions still needed

- Detailed evidence rules for recognizing an explicit resolution, including later contradictory evidence.
- Exact hyperlink and visual-density presentation.
- Quantitative success metrics, eval oracles, and measurement method.
