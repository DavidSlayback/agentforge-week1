# Phase 7 — Bug Catalog (severity + category + mitigation)

**Goal:** condense every finding from every analysis into one triaged list —
the input the rewrite resolves. This document, not the per-file prose, is
what the migration spec is designed against.

**Artifact:** `BUGS-MITIGATIONS.md` (from `templates/BUGS-MITIGATIONS.md`).

## Procedure

1. **Harvest.** Collect every row from every Findings table in `ui/`,
   `modules/`, `data/`, `project/`. Keep the back-reference to the analysis
   file.
2. **De-duplicate and merge.** The same defect seen from several files
   becomes one entry with multiple locations (e.g. "`MaxLength = 10` on
   password inputs" across four forms). Systemic issues ("no parameterized
   queries anywhere") get one entry, with the worst instances as locations.
3. **Categorize.** Default categories (tailor in `AUDIT-STATE.md` if the
   system needs different ones, but keep them stable once chosen):
   1. Security: Authentication & Credentials
   2. Security: Injection & Input Sanitization
   3. Security: Authorization & Permissions
   4. Disabled or Half-Implemented Features
   5. Data Integrity & Concurrency
   6. Error Handling & Logging
   7. UI/UX Bugs
   8. Architectural Smells
   9. Build / Deployment Risks
   10. Dead Code & Inconsistencies
4. **Assign final severity** using the guide in the template
   (Critical / High / Medium / Low). Critical and High must already be
   `(verified)` from Phase 6 — if not, verify now.
5. **Write a concrete mitigation per entry.** Not "fix it": name the
   replacement (e.g. "Replace with argon2id, re-hash on next login"), and
   say whether it is *fix in legacy*, *design out in rewrite*, or *delete*.
6. **Assign IDs** (`<CAT#>.<NN>`, e.g. `1.03`) so arcs, slices, and commits
   can reference entries. IDs are never reused.
7. **Summary table** — counts per category and per severity, and a total.
   Keep it accurate; Phase 8 reads it.

## Exit criteria

- [ ] Every analysis Findings row is represented (merged or standalone) in the catalog
- [ ] Every entry has ID, location(s), severity, description, mitigation
- [ ] All Critical/High entries are `(verified)`
- [ ] Summary counts by category and severity are correct
