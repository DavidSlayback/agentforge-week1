# AgentForge Week 2 architecture checkpoint

Status: local synthetic evidence checkpoint with an agreed local-VLM lane, 2026-09-22.

## Flow

```text
source form (synthetic fixture or approved public blank form)
  -> source-document synthetic roundtrip
  -> scan-form extraction worker
     (Tesseract/deterministic baseline, then optional larger local VLM crop resolver)
     (inspect -> extract -> validate/qualify)
  -> evidence retrieval worker
     (inspect -> formulate -> retrieve/check -> qualify)
  -> inspectable active supervisor
  -> cited READY or qualified/blocked result
```

The existing standard supervisor and deterministic extraction/tool path remain
the safety baseline for the clinical co-pilot. The active path is a bounded
multi-worker document/evidence seam and does not write clinical actions. The
local VLM adapter is opt-in, typed, crop-bounded, and fail-closed when no local
model runner is configured or measured. The eventual API/managed provider can
replace this runner without changing the worker contract. The separate
`write-clinical-action` lane still
requires explicit clinician confirmation and remains synthetic-only.

## Evidence and retrieval

Observed fields carry a `w2-scan-v1` citation with source document, page, field,
quote, layout, and bounding box. Missing, unreadable, and conflicting values are
represented as qualification metadata and are not promoted to facts;
low-confidence values stay facts but carry an `uncertainty` marker and are
listed for review. Guideline evidence is returned separately from patient
facts. The local retrieval choice is the existing deterministic sparse plus
dense-proxy index because the fixed synthetic benchmark is replayable, cited,
and zero-cost; `dense_score` is not a true embedding score.

## Evaluation and observability

The 50-case gate runs the deployed scan path on 10 golden PDFs, replaying OCR
recorded from the real Tesseract image, and asserts `schema_valid`,
`citation_present`, `factually_consistent`, `safe_refusal`, and
`no_phi_in_logs` (10 cases each) against hand-written truth files; see the root
`EVAL_GATE.md`. Zero extracted fields or an intake form whose demographics
contradict the chart is BLOCKED. A declared type contradicted by the document's
text, an unverified intake identity, or an incomplete extraction is QUALIFIED
(`documentSafety.js`). Traces record allowlisted handoff summaries
(`traceSafeHandoff`), not extraction payloads. Source preview lists
low-confidence values in a separate "not verified" section.

## Boundaries and residuals

The sourced forms are public blank layouts held for local/internal evaluation.
The free small local VLM was installed and smoke-tested, then rejected for
field extraction after a redacted 8-case crop benchmark scored 0/8. Tesseract
5.4.0 is now the measured deterministic OCR baseline at 50/53 manifest labels
with coordinates on every page. The larger official PaddleOCR-VL GGUF was
loaded locally through llama.cpp and recovered 8/8 synthetic values as raw
text, but failed the typed JSON contract at 0/8; it remains an experimental
reader. A managed model remains an explicit future decision. Vector retrieval,
live OpenEMR read/writeback, current deployment identity, external reviewer
access, owner-recorded video, social post, and interviews remain
`INCONCLUSIVE` or `NEEDS_HUMAN` until separately evidenced.
