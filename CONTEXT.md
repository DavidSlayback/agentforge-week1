# Primary-care visit preparation

Vocabulary for the Clinical Co-Pilot's initial demo workflow.

## Language

**Return visit**:
A visit by a patient who has previously been seen in the primary-care setting.

**Pre-visit preparation**:
The physician's review of available patient information before a return visit begins.
_Avoid_: Diagnosis, treatment planning

**Orientation**:
A short account of the patient's chart context and existing documented concerns before considering changes. It remains relevant when nothing has changed.

**Documented change**:
A change supported by identifiable evidence in the patient's record, relative to the comparison baseline.

**Documented plan**:
A clinical intention or follow-up recorded by a clinician in the chart, attributed to its authoring record. It is not a new recommendation from the assistant.

**Follow-through evidence**:
Chart evidence bearing on whether a documented plan was carried out. Absence of such evidence in the reviewed records is not proof of non-completion.

**Intervening interaction**:
A documented medical interaction occurring after the physician last saw the patient and before the current visit.

**Comparison baseline**:
The physician's last completed encounter with the patient, falling back to the most recent completed primary-care encounter when necessary. Relative-time presentation does not replace the underlying encounter date.

**Unresolved discrepancy**:
A disagreement between chart records for which no subsequent explicit resolution has been established.

**Documented resolution**:
Later chart evidence explicitly settling an earlier discrepancy. A newer record alone does not establish resolution.

**Active patient context**:
The patient identity and authorized record scope attached to the currently visible conversation. Conversations for different patients remain separate even when the physician switches between them.

**Evidence link**:
A navigable reference from an assistant claim to the supporting chart record or excerpt, retaining record type, author when available, and exact date.

**Evidence completeness**:
The proportion of expected relevant topics, records, changes, plans, discrepancies, and supporting links surfaced from an annotated fixture. Completeness is measured separately from unsupported-claim rate and retrieval success.

**Adaptive briefing**:
A compact initial briefing whose length grows when the patient's documented context requires it. The one-or-two-paragraph target is a presentation preference, not a hard word limit.

**Read-only assistant**:
An assistant limited to authorized chart retrieval, evidence linking, summarization, and explanation. It does not write notes, diagnoses, medications, orders, appointments, messages, or other patient data.

**Write-capable assistant**:
A future product category, not part of the current demo. Any write capability would require separate clinical governance, authorization, validation, auditability, and approval decisions.

**Explicit resolution**:
Later chart evidence that clearly states or documents the outcome of an earlier disagreement. The assistant must classify and explain this requirement to the physician; recency, omission, or contradiction alone does not qualify.

**BLUF briefing**:
A briefing that gives a concise takeaway at the start of each expandable concern, plan, or discrepancy section, while retaining the agreed order of orientation followed by documented changes and expandable supporting context. A concise overall orientation may also precede those sections.

**Field-level latest evidence**:
For each relevant chart field or topic, use the most recent documented evidence after the comparison baseline, while retaining its author and exact date. A newer value does not establish that the topic was reassessed; the assistant may claim reassessment only when the record explicitly documents it.

**Scoped chart session**:
An authenticated physician session that may reuse authorization and cached chart evidence within its permitted patient scope. Switching patients requires a fresh authorization check; cached evidence exposes its retrieval time and can be explicitly refreshed.

**Retry budget**:
At most two automatic retries per failed operation, constrained by an overall response deadline. Exhaustion produces a qualified result naming missing coverage, with every attempt and outcome recorded for inspection.

**Golden evaluation suite**:
A curated set of fixtures whose expected relevant topics, evidence, attribution, resolution status, and safety outcomes are known. Critical gates require complete expected coverage and zero critical safety failures.

**Audit-dependent concern**:
A behavior or threshold that remains intentionally undecided until inspection of the actual OpenEMR integration and instrumented runtime establishes whether it is material. Cache staleness and exact latency targets are currently audit-dependent.

**Untrusted chart content**:
Retrieved chart text is evidence data, not agent instruction. The assistant must isolate it from control instructions and may use representative prompt-injection fixtures without making broad adversarial testing part of the early demo.

**Attempt trace**:
An observability record of what the assistant attempted, including authorization, retrieval, model, verification, retry, and display stages, their outcomes, timing, and coverage. Raw patient content is not required by the trace contract and should remain local or redacted unless separately approved.

**Qualified briefing**:
A patient briefing that remains available when some claims cannot be grounded or some chart coverage is unavailable, but is prominently marked incomplete. Unsupported claims are withheld, dependent conclusions are omitted, and the physician is told in plain language what could not be established and why. Failure to establish patient identity or authorization blocks the briefing entirely.

**Evidence-grounding and response validation**:
Validation that displayed claims faithfully represent the retrieved OpenEMR records and their coverage, dates, attribution, patient scope, and discrepancy status. It does not establish that the underlying medical record is clinically true.
