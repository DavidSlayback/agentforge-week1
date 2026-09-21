# 02: Lab PDF evidence slice

**Type:** AFK

**What to build:** A complete lab-PDF path from the persisted synthetic source to
validated structured lab facts, source-linked evidence, derived observation
writeback, and clinician review.

**Blocked by:** 01: Synthetic document round-trip

**Status:** ready-for-agent

- [ ] A lab PDF produces strict records for test, value, unit, reference range, collection date, and abnormal flag.
- [ ] Imperfect scans, missing fields, and unreadable regions produce qualified results rather than invented values.
- [ ] Every displayed lab fact carries source document ID, page, field/chunk ID, quote/value, and PDF bounding-box metadata.
- [ ] Derived observations persist in OpenEMR, link back to the source document, and read back without duplicates.
- [ ] The browser review path can open the PDF and highlight the cited source region.
- [ ] Tests cover valid extraction, missing data, conflicting values, citation mismatch, and writeback failure.
