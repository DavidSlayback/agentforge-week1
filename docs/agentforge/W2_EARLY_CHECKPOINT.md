# Week 2 early checkpoint status

Status as of 2026-09-23: **synthetic PDF workflow is deployed and externally
verified; provider choice and demo recording remain open.**

Use [`W2_REQUIREMENTS_BY_STAGE.md`](W2_REQUIREMENTS_BY_STAGE.md) for the compact
early-versus-final assignment checklist and current gaps.

## Implemented and verified

- The assignment's two document types are supported: lab-result PDFs and
  patient intake forms. The minimum mapped schemas include 12 lab facts across
  two tests and 7 intake facts.
- Four fixed generated synthetic PDFs cover two layouts per type. Local
  container benchmarking recovered all 38/38 expected values with valid
  contracts and source boxes. The examples include vector and rasterized PDF
  pages; they do not represent physical scans or handwriting.
- The deployed synthetic route is
  <https://dtstest.64.177.10.182.nip.io/agentforge-w2/> at candidate
  `41682f5`. Health/readiness and page returned 200. Public API workflows for
  all four samples returned `READY`, matched all expected fields, and included
  page-region citation boxes measured in 200 DPI raster pixels.
- The current candidate passed the AgentForge serial test suite (130/130) and
  the 50-case W2 regression gate. The matching deployment record is
  [`W2_PDF_SAMPLE_DEPLOYMENT_PROOF_41682F5.json`](evidence/W2_PDF_SAMPLE_DEPLOYMENT_PROOF_41682F5.json).
- Week 1 `/agentforge` remained healthy with the same container identity and
  retains its read-only boundary.
- The page offers four downloadable sample PDFs and “Run this sample” controls.
  The deployed page was inspected in a narrow browser viewport. Public API
  workflows passed; manual button-driven runs and phone recording remain open.

## Assignment source options

FDA Form 3500 and CDC Form 50.34 are available as public blank-form links for
layout reference. They are not the filled PDFs used for the synthetic
benchmark. The downloadable filled samples are generated synthetic forms.
The local OCR/VLM benchmark on sourced blank forms did not establish promoted
typed extraction: PaddleOCR-VL scored 0/8 typed matches and Tesseract label
localization varied by form. See
[`W2_SCAN_FORM_EXTRACTION_REPORT.md`](W2_SCAN_FORM_EXTRACTION_REPORT.md).

## Still open

1. Select the extraction/VLM provider and data-processing path for final
   submission. Decide whether the early submission can present provider
   selection as an open item with the current local evidence.
2. Record and review the requested 3–5 minute browser demo using the deployed
   synthetic candidate.
3. Resolve whether the rubric requires physical scans, arbitrary form layouts,
   or an OpenEMR round trip beyond the synthetic workflow.
4. Do not claim PHI readiness, real OpenEMR parity, provider suitability, or
   clinical safety from the current evidence.

## Week 1 preservation

Keep W2 synthetic storage separate from OpenEMR persistence. Do not change the
Week 1 live chart path to write. The current public W2 release is isolated at
`/agentforge-w2`; it does not replace `/agentforge`.
