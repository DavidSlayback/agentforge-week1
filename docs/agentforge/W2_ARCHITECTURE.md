# Week 2 architecture and evidence boundary

Status: local implementation architecture, updated 2026-09-22. This describes
what the current working tree implements and calls out assignment gaps; it is
not a claim of deployed behavior.

## Week 1 boundary

The Week 1 OpenEMR adapter remains patient-scoped and read-only. W2's synthetic
source-document and derived-observation stores are separate in-memory
collaborators and do not write to OpenEMR. W2 does not broaden the chart adapter
or change the Week 1 authorization boundary.

## Current W2 local flow

1. The synthetic UI accepts UTF-8 text fixtures, not binary PDFs. The two schema
   names are `lab_pdf` and `intake_form`; the supported fixture records begin
   with `LAB|` and `INTAKE|` respectively.
2. A scoped synthetic source-document context authorizes local source storage.
   Stored content is associated with the selected synthetic patient and
   deduplicated. This is not an OpenEMR round trip.
3. When source IDs are provided, the deterministic supervisor invokes the
   extraction worker. That worker reads each source and calls the matching
   strict parser. Citations carry the source ID, page/section, field ID, quote,
   and for lab records a bounding box.
4. The supervisor also invokes the evidence-retrieval worker and then its
   deterministic verifier. Worker outputs, transitions, handoffs, and stage
   metadata are returned in a typed result and redacted trace.
5. Retrieval defaults to local lexical matching. Optional Cohere Embed plus
   Rerank requires explicit configuration and a server-only key. User text is
   matched locally to fixed synthetic queries; unsupported free text is not
   sent. No real Cohere call is verified yet.

```text
synthetic text fixture
        |
        v
scoped in-memory source store --> extraction worker --+
                                                     |
synthetic patient context --> evidence worker ------+--> supervisor verifier
                                  |                  |        |
                                  +--> lexical or    |        +--> typed facts,
                                       Cohere RAG ---+             citations,
                                                                     qualified state

Week 1 live chart request --> read-only OpenEMR adapter --> Week 1 verifier
                    (separate path; no W2 document writeback)
```

## Assignment gaps for Sunday

- Real synthetic PDF/scan fixtures and OCR/VLM extraction with source regions,
  uncertainty, partial/missing/conflicting outcomes, and labeled ground truth.
- A decision and proof for assignment-required OpenEMR source/derived-fact
  round trip that preserves the Week 1 live chart read-only boundary.
- Direct source-preview/click-to-region UI evidence.
- Real Cohere request/cost/latency evidence if the provider is configured; until
  then the retriever status is adapter-implemented, live-not-run.
- CI required-check evidence and same-revision deployment/browser proof.
- Measured W2 metrics and a cost/latency report, final dataset/results, and
  3–5 minute final demo.

The local 50-case gate covers implemented parser, lexical retrieval, citation,
refusal, and redaction behavior. It does not close the scan/OCR, external
provider, OpenEMR runtime, browser, CI, or deployment gaps. Scope remains two
document types; no third type is planned.
