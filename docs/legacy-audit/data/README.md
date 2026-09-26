# Data layer — tables, ids and config behind the port (Phase 4 catalog)

| Analysis | Covers | Tier | C / H / M / L |
|---|---|---|---|
| [SCHEMA](SCHEMA.md) | 11 tables the port reads, soft-delete/status flags, data quality | 2 | 0 / 1* / 4 / 4 |
| [UUID-MAPPING](UUID-MAPPING.md) | integer ids ↔ uuids; how the BFF gets `pid`/`eid` | 2 | 0 / 0† / 1 / 2 |
| [CONFIG](CONFIG.md) | `globals` that change what the dashboard/API shows or allows; dev users | 2 | 1‡ / 1‡ / 1 / 0 |

\* D-5 (no per-set soft-delete for vitals) restates the verified M-5 / U-1; it's counted once in Phase 7.
‡ Both CONFIG items are **local-only, provisional**. Critical: the dev default `admin` account. High: the OAuth password grant is enabled (`oauth_password_grant=3`). Whether either applies to production is David's check (see below).
† The `ListService` uuid null-guard item was downgraded High → Medium on tier-3 review. It's latent: locally 0 `lists` rows lack a uuid.

## What the build needs from this phase

- **Ids.** The BFF resolves ids once per patient/encounter from responses it already fetches:
  `GET /api/patient/:puuid` → `pid` (`PatientService.php:427`); `GET /api/patient/:puuid/encounter`
  → `eid` + `pid` per row. No separate mapping table.
- **Uuid backfill is lazy.** Most services back-fill missing uuids in their constructors; `ListService`
  doesn't. Fetching Allergies or Problems before Medications keeps the `lists` table back-filled.
- **Display config with no API:** `date_display_format`, `age_display_format` / `age_display_limit`,
  `units_of_measurement` (US; the height values are cm in an inch column: D-6). The BFF/SPA must set
  these itself (local values are in `CONFIG.md`).
- **Data quality the port will show as-is** (documented, not "fixed"):
  - `lists.severity_al='1'`: no severity label, so the card shows "(1)".
  - `lists.outcome=6`: blank-titled code, counts as active.
  - `form_vitals.height`: cm stored in an inches column.
  - Synthea name suffixes.

## Security items for David (production; not checked from here)

- The admin account must not use the dev default password.
- `oauth_password_grant` is `3` locally (password grant enabled). Check it on production
  (Admin → Config → Connectors → "Enable OAuth2 Password Grant"); it should be off.
