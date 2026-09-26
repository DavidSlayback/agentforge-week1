# Week 2 early checkpoint status

> **Historical (early W2 checkpoint status, 2026-09-23).** Kept as a record; several statements below are no
> longer true. For example, W2 now stores documents, derived facts and lab
> rows in OpenEMR, and the critic, the `medication_list` type and the lab
> trend chart are built. Current state: the root
> [`W2_ARCHITECTURE.md`](../../W2_ARCHITECTURE.md) §2 and the completion
> record in [`PLAN.md`](PLAN.md).

Status as of 2026-09-23: the W2 demo path is deployed on its isolated route and
the current release has been exercised with browser uploads of both filled PDF
types. The user still needs to record the 3–5 minute submission video.

## What the Week 2 addition does

Week 1 prepares a visit from patient-scoped chart evidence. Week 2 adds a
document-review path alongside that workflow: local PDF OCR, typed lab and
intake extraction, source-linked field citations, guideline retrieval, an
inspectable supervisor handoff, and a qualified/ready outcome. The page now
shows retrieved guideline title, section, quote, and source identifier after
each scan upload.

The scan workflow records source preparation, extraction, and retrieval stage
durations, redacted worker handoffs, guideline hit counts, outcome, and total
duration. The dashboard reads W2 metrics from the W2 route and shows both scan
traces with their stage timings and guideline-hit counts. A fresh W2 container
starts with empty in-memory traces; run both uploads before opening the
dashboard. The captured run showed two successful scan traces, six guideline
hits total, and no retrieval failures. Its p95 latency alert fired because local
PDF OCR took about seven seconds against the dashboard's generic two-second
threshold; this is not an OCR service-level target.

The root-level [`KEY_METRICS.md`](../../KEY_METRICS.md) defines extraction,
citation, retrieval, qualification, trace coverage, latency, and no-leakage
measures and separates targets from measurements.

## Current release evidence

- Public W2 page, health, readiness, evaluator, and operations dashboard are
  available at the isolated [W2 demo page](https://dtstest.64.177.10.182.nip.io/agentforge-w2/).
- Browser upload of Lab B returned `READY`, 12 cited fields, both worker
  handoffs, and three visible guideline sources.
- Browser upload of Intake B returned `READY`, 7 cited fields, both worker
  handoffs, and three visible guideline sources.
- The W2 dashboard readback showed three requests total (initial visit
  preparation plus the two scans), seven retrieval attempts, zero errors, and
  two successful scan traces. The initial visit preparation accounts for the
  displayed 120 tokens; the scan traces each show “No model call.”
- The saved W2 regression panel reports 50/50 passing cases. Treat this as a
  fixture-gate result, not a general accuracy or clinical outcome measure.
- Deployment recreated only `agentforge-w2` with `--no-deps`; Week 1 remains on
  `/agentforge` and retains its read-only chart behavior.

## Remaining limits

- The demo uses fixed generated PDF layouts. It does not establish accuracy on
  physical scans, handwriting, or arbitrary form layouts.
- The active extraction and guideline retrieval paths are local. Hosted model
  quality, scan-provider selection, and OCR-specific latency targets remain
  open.
- W2 source documents and extracted facts do not round-trip through OpenEMR.
  The current isolated demo does not prove OpenEMR persistence, PHI readiness,
  or clinical safety.
- The user still needs to record and review the requested 3–5 minute video.

See [`W2_REQUIREMENTS_BY_STAGE.md`](W2_REQUIREMENTS_BY_STAGE.md) for the
early-versus-final requirement checklist.
