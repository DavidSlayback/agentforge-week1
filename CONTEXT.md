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
