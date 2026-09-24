# Phase 4 — Data Audit (schema, stored logic & reports)

**Goal:** document everything the system persists or emits, independent of
the code that touches it — because every migration route has to move the
data and rebuild the reports, whatever language it targets.

**Artifacts:** `data/SCHEMA.md` (from `templates/SCHEMA.md`),
`data/REPORTS.md`, and `data/<ASSET>.md` for any other significant data
asset (config files, import/export formats, seed data, stored procedures,
message formats).

## Procedure

1. **Find the source of truth for the schema.** DDL scripts, migrations, ORM
   mappings, or — as in StarHotel — schema created in code
   (`CreateDB` in a module). If only a live database exists, dump its
   schema read-only. Cite where it came from.
2. **Per table/entity:** columns with types and constraints, keys, indexes,
   defaults, which units read/write it (cross-reference the Phase 2/3
   data-touch matrices), soft-delete flags, audit columns, denormalized
   snapshots and *why* they exist (StarHotel's `Booking` snapshots room data
   so old receipts stay accurate — a behavior the rewrite must keep).
3. **Stored logic:** triggers, stored procedures, views, computed columns,
   jobs. Each is code — give it the same three-step audit.
4. **Seed data and defaults:** sample rows, default users/credentials,
   magic values. Default credentials are a Critical finding.
5. **Reports and exports:** one row per report — name, engine and version,
   query source (inline, table-driven, runtime-assembled), parameters,
   variable substitution, output format, who can run it. Note metadata-driven
   report catalogs (StarHotel stores report SQL in a `Report` table).
6. **Config and file formats:** config files, INI/registry keys, env vars,
   import/export file layouts, paths the app writes to (and whether those
   paths survive a modern install location).
7. **Data-quality notes:** type mismatches between UI caps and schema
   (`MaxLength = 10` vs `TEXT(50)`), encodings, locale/currency hardcoding,
   date formats.
8. Add findings to each doc's Findings table, same scheme as Phase 2.

## Exit criteria

- [ ] `data/SCHEMA.md` covers every table/entity with source citation
- [ ] Every table cross-referenced to the units that read/write it
- [ ] Stored logic, seed data, and default credentials documented
- [ ] `data/REPORTS.md` lists every report with engine, query source, parameters
- [ ] Config/paths/file formats documented
