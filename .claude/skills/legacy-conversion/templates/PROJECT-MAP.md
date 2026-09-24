# Project Map — <Project name>

A tree, not a critique. Produced from `<manifest path>` and the source tree.

## Entry point and boot sequence

1. `<entry point>` (declared in `<manifest>` as `<directive>`)
2. ...

## Source tree by layer

```
<source-root>/
├── <ui dir>/            UI units (Phase 2)
│   ├── <unit>           <one-line purpose>
├── <module dir>/        Modules (Phase 3)
│   ├── <module>         <one-line purpose>
├── <data dir>/          Data assets (Phase 4)
└── <publish dir>/       Shipped artifacts
```

## UI units

| Unit | Path | Lines | Purpose (one line) | Opened from |
|---|---|---|---|---|

## Modules

| Module | Path | Lines | Purpose (one line) |
|---|---|---|---|

## Data assets

| Asset | Path | Kind (schema/report/config/seed) |
|---|---|---|

## External dependencies

| Dependency | Version | Used for | Status (supported / deprecated / EOL date) | Replacement candidates |
|---|---|---|---|---|

## Not in the manifest

Files present in the tree but not built/referenced (dead, orphaned, or
tooling):

- `<path>` — <guess at what it is; confirm in Phase 2–4>

## Build / packaging artifacts

| Artifact | Analysis |
|---|---|
| `<manifest>` | `project/<NAME>.md` |
