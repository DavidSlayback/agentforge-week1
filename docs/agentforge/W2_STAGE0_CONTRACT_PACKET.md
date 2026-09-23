# Week 2 Stage 0 contract packe

Date: 2026-09-22
Status: `FROZEN`
Scope: synthetic scan-form evidence and local workflow proof only.

## Authority and safety boundary

- The Week 2 PRD and `ASSIGNMENT_DELTAS_REVIEW_2026-09-22.md` require two
  document types, scan-form/VLM-style extraction, source-linked evidence,
  missing-data behavior, two active workers, retrieval, evaluation, and
  observability.
- All fixtures and outputs in this packet are synthetic. No PHI, production
  OpenEMR, external provider activation, deployment, publication, or live
  clinical writeback is authorized.
- Synthetic clinician-confirmed diagnosis/order actions remain a separate lane;
  this packet never grants action-write authority.

## Versioned contracts

`w2-scan-v1` is the contract version for the new local slice.

### Additive PDF implementation note — 2026-09-23

The frozen Stage 0 output contract remains unchanged. The assignment PDF path
adds `PDF_SCAN_FIELDS` to map the full required fields for lab-result PDFs and
intake forms. It accepts synthetic PDF bytes, uses local Poppler/Tesseract, and
returns the same field/citation contract with page boxes. This is a later
implementation extension; it does not revise Stage 0's original text fixtures.

### Scan inpu

```tex
{ source_document_id, document_type, layout_id, page_count, content,
  synthetic_only: true }
```

`document_type` is `lab_pdf` or `intake_form`; `content` is a synthetic form
fixture buffer. The adapter may inspect fixture text, but callers receive no
unvalidated model output.

### Extracted field

```tex
{ field_id, value, confidence, disposition,
  citation: { source_type, source_document_id, page, field_id, quote,
              bounding_box, layout_id },
  uncertainty: string|null }
```

`disposition` is `observed`, `missing`, `unreadable`, or `conflicting`.
`observed` requires a citation and confidence in `[0, 1]`. Missing and
unreadable fields never become facts. Conflicts remain qualified and never
silently select a winning value.

### Extraction resul

```tex
{ contract_version: "w2-scan-v1", provider, status,
  facts, missing_fields, uncertain_fields, conflicts, issues,
  metrics: { pages, candidate_fields, accepted_fields, duration_ms } }
```

`status` is `complete`, `partial`, `qualified`, or `blocked`. Raw fixture
content and raw provider output are not part of traces or evaluation reports.

### Worker handoff

```tex
{ contract_version: "w2-scan-v1", worker, input_type, output_status,
  steps: [{ name, decision }], retry_count, citations, redacted_metrics }
```

Each worker must show at least inspect -> act -> validate/qualify. A failed or
uncited result cannot be promoted to `ready`.

### Retrieval evidence

```tex
{ source_type: "guideline", source_id, title, version, section,
  location, quote, score, matched_terms }
```

Patient facts and guideline evidence remain separate arrays. Empty, irrelevant,
or insufficient retrieval is qualified rather than converted into an answer.

## Fixture manifest contrac

The checked-in manifest at `docs/agentforge/fixtures/w2-scan-form-manifest.json`
must list each fixture's document type, layout, variant, expected status, field
labels, page/box citations, and synthetic-only provenance. Required variants are
complete, partial, missing, unreadable, and conflicting across both documen
types.

This frozen packet remains synthetic-only. Separately, the source-material gap
is now covered by four public blank forms in
`docs/agentforge/fixtures/w2-external-form-manifest.json`; those forms are no
provider evidence and do not change the contract's no-PHI/external-provider
boundary.

## Requirements ledger at freeze

| ID | Requirement / acceptance claim | Current proof | Status | Next proof |
|---|---|---|---|---|
| W2-01 | Two varied lab/intake scan-form fixtures with labels | Existing line fixtures only | INCONCLUSIVE | Manifest plus rendered synthetic form fixtures |
| W2-02 | Provider-neutral extraction with citation/confidence/uncertainty | Existing parsers are line-oriented | INCONCLUSIVE | `scanFormAdapter.js` matrix report |
| W2-03 | Complete/partial/missing/unreadable/conflict handling | Partial parser coverage | INCONCLUSIVE | Contract tests and fixture matrix |
| W2-04 | Defensible retrieval choice | Lexical/dense-proxy path only | INCONCLUSIVE | Fixed replay benchmark and recommendation |
| W2-05 | Two independently active workers | Deterministic supervisor only | INCONCLUSIVE | Multi-step worker traces and supervisor tests |
| W2-06 | Rubric-aligned 50-case gate and no-PHI proof | 50-case local gate uses legacy labels | INCONCLUSIVE | Explicit rubric mapping plus mutation/privacy proof |
| W2-07 | Source preview/click-to-source | Citation metadata only | INCONCLUSIVE | Preview endpoint/UI readback |
| W2-08 | Intended-runtime synthetic persistence/readback | Existing synthetic seam | PASS (synthetic only) | Preserve live OpenEMR row as INCONCLUSIVE |
| W2-09 | Current deployment/submission/demo evidence | Old/current identity unresolved | NEEDS_HUMAN | Authorized deployment and owner-recorded artifacts |

## Release of Stage 1

Stage 1 is released only for synthetic local implementation. The coordinator
must run the fixture matrix, contract tests, full AgentForge tests, and the W2
gate after integration. Any missing runtime/browser/deployment evidence remains
`INCONCLUSIVE` or `NEEDS_HUMAN`.
