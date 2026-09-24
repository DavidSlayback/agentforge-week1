# Phase 3 — Module Audit (business & data logic)

**Goal:** one long-form analysis per non-UI module — the shared code the UI
layer calls into: data access, query builders, domain rules, utilities,
crypto, file I/O, global declarations.

**Artifacts:** `modules/<MODULE-NAME>.md` per module (from
`templates/FILE-ANALYSIS.md`), `modules/README.md` (catalog), and
`modules/DATA-FLOW.md` — the "layer cake": how a user action becomes a query
becomes a row, top to bottom.

## Procedure

Same three steps as Phase 2 (read cover-to-cover → find the smells →
catalog the findings). Module-specific things to capture:

- **Public surface** — every exported function/sub/class with signature,
  callers (grep for them and cite), and side effects.
- **Global state** — every global/static/singleton declared or mutated here.
  In the StarHotel case the defining architectural choice was a family of
  SQL-builder subs mutating one global `gstrSQL` string; look for the
  equivalent (shared request objects, static registries, `$GLOBALS`,
  session-as-service-locator).
- **Transaction boundaries** — per statement? per business operation?
  nowhere? Multi-step writes without a transaction are a Data Integrity
  finding.
- **Error-handling paths** — where errors go (DB log table, text file,
  swallowed, message box) and what happens before the DB is available.
- **Security primitives** — hashing, encryption, randomness, credential
  storage. Hand-rolled crypto is always at least High.
- **Architectural role** — which layer this module really belongs to, and
  what the rewrite should split it into.

Order the queue: the module the center of gravity leans on hardest first
(usually data access / query building), then session/globals, security,
domain helpers, then leaf utilities.

Fan out with `legacy-file-auditor` exactly as in Phase 2, with layer
`modules`.

After the queue: write `modules/DATA-FLOW.md` — layers in order (user input
→ presentation → business helpers → query building → connection → storage),
side channels (error logging, reporting engines with their own
connections), and the non-obvious properties (single-threaded? synchronous?
where are permissions checked — at load time or per operation?).

## Exit criteria

- [ ] Every module in the Phase 3 queue has an analysis file
- [ ] Every global/shared-state variable is listed with its writers and readers
- [ ] Transaction boundaries and error paths documented
- [ ] `modules/README.md` catalog and `modules/DATA-FLOW.md` written
