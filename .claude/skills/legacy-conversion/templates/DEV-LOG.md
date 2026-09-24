# Development Log

Append-only chronological journal of the rewrite. One entry per slice,
**newest first**. Any future session — human or LLM — resumes work by
reading the most recent 5–10 entries plus the active arc file.

**Conventions:**
- Newest entry at the top, directly under the marker line below.
- Entries are immutable once written. Corrections go in a new entry that references the corrected one.
- Status values: `ready-for-commit` | `in-progress` | `blocked` | `merged`.
- An arc-completion entry is added at the end of each arc, before the first entry of the next arc.

**Slice entry template:**

```markdown
## YYYY-MM-DD — Arc NN / Story NN-SS / Slice NN-SS-LL — <short title>

**Status:** ready-for-commit · **Branch:** `slice/NN-SS-LL-<name>`

### Worked on
### Decisions
### Tests
- Unit: <n> passing · Integration: <n> · Smoke: <n>
### BUGS-MITIGATIONS.md updates
- <IDs struck through>
### Open questions / follow-ups
```

**Arc completion template:**

```markdown
## YYYY-MM-DD — Arc NN complete: <name>

### Delivered
### Catalog entries resolved
### Retrospective
- Went well / didn't / change for next arc
```

---

<!-- New entries go below this line, newest first. -->

_No entries yet. Work begins with Arc 01, planned in `arcs/ARC-01-FOUNDATION.md`._
