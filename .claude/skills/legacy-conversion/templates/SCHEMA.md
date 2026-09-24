# Data Schema — <Project name>

**Source of truth:** `<path / function / live-DB dump>` — cite exactly where
the schema is defined (DDL, migrations, ORM, or code like `CreateDB`).
**Engine:** <e.g. Access 2000 / Jet 4.0, password-protected> · **Tables:** <N>

## Entity overview

| Table | Purpose | Rows (typical) | Soft delete? | Audit columns? | Read by | Written by |
|---|---|---|---|---|---|---|

## Tables

### `<TableName>`

<Purpose in prose. Why denormalized fields exist, if any.>

| Column | Type | Null | Default | Key/Index | Notes |
|---|---|---|---|---|---|

**Readers:** `<unit>.<Function>` · **Writers:** `<unit>.<Function>`

## Stored logic

| Object | Kind (trigger/proc/view/job) | Purpose | Analysis |
|---|---|---|---|

## Seed data & defaults

- <default users/credentials, sample rows, magic values — with citations>

## Config, paths & file formats

| Item | Location | Format | Written by | Survives modern install? |
|---|---|---|---|---|

## Data-quality notes

- <UI caps vs schema widths, encodings, hardcoded locale/currency, date formats>

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
