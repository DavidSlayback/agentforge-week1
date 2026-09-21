# 03: Intake form evidence slice

**Type:** AFK

**What to build:** A complete intake-form path from the persisted synthetic source
to validated structured intake facts, source-linked evidence, derived observation
writeback, and clinician review.

**Blocked by:** 01: Synthetic document round-trip

**Status:** accepted-with-residual

- [x] A synthetic intake-form representation produces strict records for demographics, chief concern, medications, allergies, and family history fields.
- [x] Missing, unreadable, or contradictory fields remain explicitly qualified rather than silently normalized into facts.
- [x] Synthetic intake facts carry source document ID, page/section, field ID, quote/value, and bounding-box metadata.
- [ ] Derived observations persist in real OpenEMR, link back to the source document, and read back without duplicates. The synthetic observation seam is proven; real OpenEMR remains open.
- [ ] The browser review path can open the source and navigate to the cited field or section.
- [x] Tests cover valid extraction, missing fields, contradictory entries, citation contract failure, and synthetic source/API writeback failure.

## Verification

- Full AgentForge suite: `78/78`.
- Synthetic intake evidence endpoint: upload -> extract -> source-linked observation.
- Residuals: real form/PDF ingestion, real OpenEMR observation persistence, browser source navigation, and observation-specific API fault injection.
