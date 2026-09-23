# Key metrics for AgentForge Week 2

These measures describe whether the evidence-triage workflow helps a clinician
review source documents efficiently while keeping each displayed fact
traceable. They are metric definitions and acceptance targets, not claims of
clinical benefit. Values must be tied to a release revision and labeled by
their evidence source.

| Metric | Definition | Why it matters | Target / interpretation | Evidence source |
|---|---|---|---|---|
| Field extraction correctness | Correct typed fields / expected fields on a labeled document set; report by document type and layout. | Incorrectly read values can mislead review. | At least 95% per labeled rubric before broader use; abstentions reported separately. | Versioned labeled fixtures and the W2 evaluation gate. |
| Citation coverage | Displayed extracted fields with source quote, page/section, and location / all displayed extracted fields. | A reviewer needs to verify each value at its source. | 100%; a field without a usable citation stays withheld or qualified. | Scan extraction response, source preview, and citation rubric. |
| Grounded retrieval rate | Queries returning at least one relevant, versioned guideline source with quote and location / eligible queries. | Retrieved support must be inspectable and distinct from patient facts. | Report coverage and clinician relevance separately; do not treat a hit as proof of relevance. | Redacted retrieval hit counts plus a reviewed query/source set. |
| Qualification correctness | Unsupported, missing, or conflicting cases correctly marked for review / such cases in the labeled set. | The workflow should stop short when the evidence is insufficient. | At least 95%; zero tolerance for a critical unsafe pass. | W2 gate and labeled incomplete/conflict cases. |
| Trace coverage | Successful document workflows with extraction and retrieval stages, handoffs, outcome, and duration / successful document workflows. | Operators need to see what ran and where it took time or failed. | 100% of successful W2 document workflows; traces contain redacted metadata only. | `/v1/traces`, `/v1/metrics`, and the operations dashboard. |
| Workflow reliability and latency | Completed/failed document workflows and p50/p95/p99 end-to-end duration, by document type. | A useful review path must complete predictably. | Establish baseline on a labeled workload before setting an SLO; publish sample size and environment. | Redacted W2 traces and a repeatable workload. |
| Sensitive-content leakage | Raw prompt, response, source text, extracted value, or patient identifier present in operational traces. | Telemetry must not expose document or patient content. | Zero; any observed leak blocks release. | Redaction checks and inspection of current candidate traces. |

## Current early-submission evidence boundary

The W2 regression gate has a saved 50-case result, but that is not an
encounter-level quality score. Fixed synthetic PDF fixtures have a prior
candidate benchmark; keep those results attached to the candidate that produced
them. Runtime requests, extraction/retrieval durations, and hit counts must be
read from the deployed candidate after the demo uploads. Local OCR and local
guideline retrieval make no model call, so model-token and model-cost values are
zero for those interactions. Clinical utility requires clinician review and
has not been measured. The isolated W2 route does not establish OpenEMR
round-trip behavior or clinical readiness.
