# AF-16 — Close requirement, workflow, and claim-contract gaps

**Type:** HITL
**Blocked by:** AF-13 — final package must consume the reconciled language.
**Wave:** 12
**Lane:** contract-closure / documentation
**Critical path:** Yes.

## What it delivers

One source of truth for the user requirement pointer, active workflow timing,
source provenance, deployment status, and final non-claims.

## Acceptance criteria

- [ ] `docs/agentforge/USER.md` points to canonical `USERS.md` without creating a second requirement source.
- [ ] User-facing workflow language consistently describes the focused 90–180-second orientation while preserving the 30-minute visit cadence.
- [ ] Source-PDF and deployment statements distinguish “brief inventory stored in repository” from “externally verified final candidate.”
- [ ] Final package, interview prep, queue, and evidence index contain no stale checkpoint-only claim.

## Verification

```text
rg -n "USER\.md|USERS\.md|90.?180|30 minutes|source PDF|prior verified|final candidate" docs .scratch
git diff --check
```

Owner review must confirm that every claim is implementation, runtime, external,
or explicitly pending evidence.
