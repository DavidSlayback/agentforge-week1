# 02: Lab PDF evidence slice

**Type:** AFK

**What to build:** A complete lab-PDF path from the persisted synthetic source to
validated structured lab facts, source-linked evidence, derived observation
writeback, and clinician review.

**Blocked by:** 01: Synthetic document round-trip

**Status:** accepted-with-residual

- [x] A synthetic lab-PDF representation produces strict records for test, value, unit, reference range, collection date, and abnormal flag.
- [x] Missing fields, unreadable regions, and conflicting values produce qualified results rather than invented values.
- [x] Synthetic lab facts carry source document ID, page, field ID, quote/value, and PDF bounding-box metadata.
- [ ] Derived observations persist in real OpenEMR, link back to the source document, and read back without duplicates. The synthetic observation seam and API deduplication are proven; real OpenEMR remains open.
- [ ] The browser review path can open the PDF and highlight the cited source region.
- [x] Tests cover valid extraction, missing data, conflicting values, citation contract failure, and synthetic source/API writeback failure.

## Verification

- Full AgentForge suite: `75/75`.
- Synthetic lab evidence endpoint: upload -> extract -> source-linked observation -> repeat-read deduplication.
- Residuals: real PDF/OCR, real OpenEMR observation persistence, browser PDF preview/overlay, and an observation-specific API fault path.
