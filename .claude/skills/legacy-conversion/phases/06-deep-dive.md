# Phase 6 — Deep-Dive (Claude Code + skills + prompts over the split repo)

**Goal:** turn a stack of per-file analyses into a verified, cross-linked
knowledge base. Phases 2–4 were breadth passes; this is the depth pass,
driven locally with Claude Code in the split repo (this skill, the
`legacy-file-auditor` subagent, and the `CLAUDE.md` from Phase 5 as the
standing brief).

**Artifacts:** corrected/extended analyses, `VERIFICATION.md` (from
`templates/VERIFICATION.md`), and cross-cutting docs as needed (sequence
walkthroughs of key transactions, additional diagrams).

## Procedure

1. **Verification pass on load-bearing claims.** For every finding marked
   provisional Critical or High, and every architecture fact in `CLAUDE.md`:
   re-open the cited source, confirm or correct, and mark the claim
   `(verified)` with the line reference. Log each check in
   `VERIFICATION.md` (claim, source, verdict, corrected text). Wrong claims
   are fixed at the analysis, not papered over in the catalog.
2. **Cross-link pass.** Every "opens X", "calls Y", "writes table Z" in one
   analysis should have its reciprocal in the other. Grep for unit names
   across `docs/` and fill gaps. Units added late (StarHotel's
   `frmDialog`) must be folded into the layer `README.md` and flow docs.
3. **Consistency pass.** Same concept, same name, everywhere. Same severity
   for the same defect class across files. Inconsistencies in the *legacy*
   behavior (two forms handling bad login differently) are findings; in the
   *docs* they are defects to fix.
4. **Transaction walkthroughs.** Pick the 2–4 most important business
   operations (e.g. "clerk checks in a guest") and trace them end-to-end
   through UI → modules → data, as a numbered sequence with citations.
   These become acceptance tests for the rewrite.
5. **Gap sweep.** Anything in `PROJECT-MAP.md` that has no analysis; any
   global with no documented writer; any table no unit touches; any report
   no UI can reach. Each gap is either documented or explained.
6. **Update `CLAUDE.md`** with anything the deep-dive changed.

## Prompting in this phase

Use the prompt patterns in `reference/prompts.md` §Phase 6. Keep each
request to one claim, one unit, or one walkthrough, and name the file it
must update.

## Exit criteria

- [ ] Every provisional Critical/High finding verified or corrected (logged in `VERIFICATION.md`)
- [ ] Cross-links reciprocal across `ui/`, `modules/`, `data/`
- [ ] 2–4 end-to-end transaction walkthroughs written
- [ ] Gap sweep complete; `CLAUDE.md` refreshed
