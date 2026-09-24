# Reports & Exports — <Project name>

**Engine:** <e.g. Crystal Reports 8.5 ActiveX runtime> · **Support status:** <EOL date>
**How reports are registered:** <hardcoded / metadata table / file drop>

## Catalog

| Report | Template file | Query source | Parameters / substitutions | Reached from | Permission | Output |
|---|---|---|---|---|---|---|
| | `<file.rpt>` | inline / `Report` table row / runtime-assembled | `$UserID$`, date range | `<unit>` | `<MOD_X>` | screen/print/PDF/CSV |

## How a report runs

<Narrate the runtime path: who assembles the query, what connection it uses
(shared or its own), how parameters are substituted, where output goes.>

## Fidelity notes for the rewrite

- <which reports are legally/operationally required pixel-for-pixel (receipts, invoices) vs redesignable>

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
