# AgentForge target user and use cases

## Target user

The initial user is a primary-care physician seeing returning patients in an
outpatient clinic. The physician has a roughly 20-patient day with visits of
about 30 minutes each. The AgentForge interaction is designed for a focused
90–180-second orientation immediately before the encounter. They are
responsible for deciding what matters in the
current encounter, but the record is distributed across encounters, problems,
medications, results, forms, documents, and narrative notes.

This is a workflow choice, not a claim that primary care is the largest or most
valuable market. The first demonstration serves one physician preparing for a
return visit involving one authorized patient. Other clinicians, new-patient
intake, emergency care, inpatient rounding, population management, and staff
workflows are explicitly out of scope for the first agent.

## The moment the agent enters the workflow

Between appointments, the physician opens the next returning patient's chart.
In the 90–180 seconds before the next patient arrives, they have just finished
the previous encounter and are trying to orient themselves. They need a compact
answer to three questions:

1. Why is this patient here, based on the documented visit reason?
2. What ongoing concerns and prior plans should remain in view?
3. What has changed since this physician last completed an encounter with the
   patient, and which changes require the physician's attention?

The physician opens an embedded **Prepare for visit** panel while the patient
context is visible. AgentForge retrieves the authorized chart data and presents
a short orientation followed by documented changes. Each expandable section
starts with its own bottom line up front (BLUF). Inline citations expose the
record type, author when available, exact date, and the supporting excerpt or
original record. The physician uses the brief to decide what to ask, examine,
or review during the visit; the agent does not recommend a new clinical action
or write anything into the chart.

Preparation may run asynchronously because visits are about 30 minutes apart.
The physician still needs a bounded result within the 90–180-second orientation
window, a clear deadline,
and a useful partial result when some record groups cannot be retrieved. A
failed identity or authorization check blocks the briefing entirely.

## Use cases

### UC-1 — Prepare for a returning patient's visit

**Trigger:** The physician selects an authorized returning patient and chooses
**Prepare for visit** before the encounter begins.

**Output:** A compact orientation covering the documented visit reason, ongoing
concerns, and prior documented plan, followed by evidence-grounded documented
changes since this physician's last completed encounter. Relevant medications
and results support the orientation without turning it into an exhaustive chart
dump.

**Why an agent is the right solution:** The physician is not asking for one
known field or a sortable list. They need several related record types gathered,
temporally compared, attributed, and explained in the context of the current
patient. A dashboard can display those sources, but it cannot preserve the
physician's conversational context, explain why a change matters to the prior
plan, or expose a qualified partial result in a single interaction. The agent's
value is evidence-grounded synthesis with immediate source inspection.

### UC-2 — Investigate a change to an existing concern

**Trigger:** After reading the brief, the physician asks a follow-up such as,
“What changed about the diabetes concern since I last saw them?”

**Output:** The agent retrieves the relevant field-level latest evidence since
the comparison baseline, retains exact dates, authors, and source references,
and explains whether the record documents a change, no change, or insufficient
evidence. A newer value is not described as reassessed unless the record
explicitly documents reassessment.

**Why an agent is the right solution:** The starting concern and the physician's
follow-up question are not known in advance, so a fixed dashboard view would
either show too much or require the physician to navigate many unrelated
records. A multi-turn agent can carry the active patient's context and narrow
retrieval to the concern the physician names, while retaining evidence links
for verification.

### UC-3 — Trace follow-through on a documented plan

**Trigger:** The physician asks whether a prior documented plan appears to have
been carried out.

**Output:** The agent gathers later chart evidence bearing on the plan, names
the author and dates of the relevant records, and distinguishes documented
completion, documented non-completion, and absence of follow-through evidence.
Absence of evidence is not presented as proof that the plan was not completed.
The agent surfaces the plan and evidence; it does not recommend a replacement
plan.

**Why an agent is the right solution:** This is a cross-record, longitudinal
question whose relevant evidence depends on the wording and date of the prior
plan. A report or checklist could list events, but the conversational agent can
resolve the physician's specific follow-up question, explain the evidence
boundary in human language, and let the physician immediately ask for a
supporting record.

### UC-4 — Explain conflicting records

**Trigger:** The brief or a follow-up reveals conflicting values, statuses, or
descriptions for the same clinical topic.

**Output:** The agent presents the competing evidence with provenance and dates.
If later documentation explicitly settles the discrepancy, it presents the
resolved result while retaining the supporting history. Recency alone does not
resolve a conflict. If the discrepancy cannot be verified, the normal claim is
withheld and a heavily qualified panel explains what could not be established
and why.

**Why an agent is the right solution:** The physician needs an explanation of a
specific discrepancy, not another list of values. The agent can maintain the
question's context, retrieve the records needed to investigate it, and explain
the difference between resolution, recency, omission, and uncertainty. The
source records remain one click away for the physician's judgment.

### UC-5 — Continue safely when the record is incomplete

**Trigger:** A requested record group is empty, stale, missing provenance,
unauthorized, timed out, or fails to load.

**Output:** The agent distinguishes a successful empty result from no prior
visit and from retrieval failure. It qualifies the whole brief when coverage is
partial, identifies the specific unverifiable coverage in plain language,
withholds dependent conclusions, and offers a bounded retry. The agreed retry
policy is two retries plus the overall deadline. If identity or authorization
cannot be established, no patient briefing is shown.

**Why an agent is the right solution:** The important behavior is not merely
displaying an error; it is adapting the conversation to the exact missing
coverage and answering the physician's next question without inventing a
clinical conclusion. A static dashboard can show missing data, but it cannot
explain the impact on this particular answer or guide a safe, patient-scoped
retry.

## Product boundaries derived from the user

The first agent is a read-only, physician-reviewed chart assistant. It will not
write notes, diagnoses, medications, orders, appointments, messages, or other
patient data. It will not issue clinical recommendations, silently reconcile
conflicts, mix conversations across patients, or treat chart text as an agent
instruction. The active patient, authenticated physician, authorization scope,
retrieval coverage, evidence provenance, and verification outcome must remain
visible to the system and traceable in observability.

Future `ARCHITECTURE.md` capabilities must map to UC-1 through UC-5. A
capability without a use-case mapping is not part of the first implementation.
