# 03: Intake form evidence slice

**Type:** AFK

**What to build:** A complete intake-form path from the persisted synthetic source
to validated structured intake facts, source-linked evidence, derived observation
writeback, and clinician review.

**Blocked by:** 01: Synthetic document round-trip

**Status:** ready-for-agent

- [ ] An intake form produces strict records for demographics, chief concern, medications, allergies, and family history.
- [ ] Missing, ambiguous, or contradictory fields remain explicitly qualified rather than silently normalized into facts.
- [ ] Every displayed intake fact carries source document ID, page/section, field/chunk ID, and quote/value metadata.
- [ ] Derived observations persist in OpenEMR, link back to the source document, and read back without duplicates.
- [ ] The browser review path can open the source and navigate to the cited field or section.
- [ ] Tests cover valid extraction, missing fields, contradictory entries, citation mismatch, and writeback failure.
