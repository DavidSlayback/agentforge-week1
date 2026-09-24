# Migration & Port Options

<N> plausible routes for taking `<Project>` to a maintainable modern system,
with pros/cons, phased roadmaps, tooling, and effort for each. The aim of
this doc is **route selection** — the chosen route gets its own playbook
(`MIGRATION-<ROUTE>.md`).

**Size of the problem:** ~<N>K behavioral lines across <n> UI units and <n>
modules, <n> tables, <n> reports (from `INVENTORY.md`). **Catalog:** <total>
findings — <c> Critical, <h> High (from `BUGS-MITIGATIONS.md`).

## Decision dimensions

Answers agreed with <stakeholder> on <date>. Weights sum to 100.

| Dimension | Question | Answer | Weight |
|---|---|---|---|
| UX paradigm | Stay desktop, or web/mobile/cross-platform? | | |
| Team language | What does the team write / hire for? | | |
| Deployment target | Single machine, server + thin clients, SaaS? | | |
| Reporting fidelity | Pixel-perfect replicas or redesign? | | |
| Risk tolerance | Big-bang, parallel run, or strangler fig? | | |
| Budget | Commercial migration tooling on the table? | | |
| Timeline pressure | Hard deadlines (runtime EOL dates)? | | |

## What every route must replace

- **Database:** <current engine and why it must go; realistic targets>
- **Report engine:** <current engine; options>
- **Auth/security model:** <catalog IDs; re-hash-on-login strategy, etc.>
- **Disabled features:** <fix and forward-port, or design out>
- **Config & storage paths:** <what breaks under modern install locations>
- **Integrations:** <external systems>

---

## Route A — <Incremental / automated translation>

<Summary paragraph.>

### Pros
### Cons
### Roadmap
1. ...
### Tooling
### Effort
<range, assumptions>
### Catalog impact
- **Inherits:** <IDs / "all N; fixed after translation">
- **Designs out:** <IDs>

## Route B — <Greenfield in the closest ecosystem>

_(same subsections)_

## Route C — <Alternative>

_(same subsections)_

---

## Side-by-side comparison

| | Route A | Route B | Route C | Route D | Route E |
|---|---|---|---|---|---|
| Stack | | | | | |
| Effort | | | | | |
| Catalog designed out | | | | | |
| Report path | | | | | |
| Main risk | | | | | |

## Weighted scoring

Scores 1–5 per dimension; weighted total = Σ(score × weight) / 100.

| Dimension (weight) | A | B | C | D | E |
|---|---|---|---|---|---|
| UX paradigm (<w>) | | | | | |
| ... | | | | | |
| **Weighted total** | | | | | |

## Hybrid options

<e.g. strangler fig: new core + legacy UI for a period; keep legacy reports
behind an adapter while rebuilding. When they make sense here, and when not.>

## Recommendation

**Route <X>.** <Rationale tied to the numbers above — the weaknesses we
accept and why they're livable.> Confirmed by <who> on <date>.

## First steps regardless of route

1. <no-regret moves: data export tooling, schema freeze, characterization tests, Critical legacy patches (side quest)>
