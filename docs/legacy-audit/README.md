# Legacy audit — OpenEMR patient dashboard port

A reverse-engineering audit of OpenEMR's PHP patient dashboard, done before
porting it to a modern framework on the existing REST/FHIR API (W2 surprise
challenge). The live state is in [`AUDIT-STATE.md`](AUDIT-STATE.md); agents
start from [`AGENT-BRIEF.md`](AGENT-BRIEF.md). Legacy code is pinned at tag
`legacy-baseline` (`3ccfe1d`).

## Phase status

| # | Phase | Status | Start here |
|---|---|---|---|
| 0 | Manual recon | approved | [RECON](RECON.md), [BASELINE-ERRORS](BASELINE-ERRORS.md) |
| 1 | AI scrape (map) | approved | [PROJECT-MAP](PROJECT-MAP.md), [REQUIREMENTS-TRACE](REQUIREMENTS-TRACE.md) |
| 2 | UI-layer audit | approved | [ui/README](ui/README.md), [ui/UI-FLOW](ui/UI-FLOW.md) |
| 3 | Module audit | approved (client model B) | [modules/README](modules/README.md), [modules/DATA-FLOW](modules/DATA-FLOW.md) |
| 4 | Data audit | approved | [data/README](data/README.md) |
| 5 | Repo split (in place) | checkpoint | tag `legacy-baseline`, [AGENT-BRIEF](AGENT-BRIEF.md) |
| 6 | Deep-dive / verification | next | live API checks with a local OAuth client; restricted-user security checks |
| 7 | Bug catalog | — | |
| 8 | Migration route | — | framework scoring feeds `PATIENT_DASHBOARD_MIGRATION.md` |
| 9 | Side quests | — | |
| 10 | Vertical slices | — | walking skeleton first |

## Headline results so far

- **Architecture:** SPA + thin BFF (confidential OAuth client). A public SPA
  can't reach the standard REST API, and CORS preflight 404s cross-origin.
- **Patient safety (legacy):**
  - Deleted vitals can show as current (legacy join bug, and FHIR has no
    deleted filter).
  - The allergy–medication conflict alert fails silently with 2 or more conflicts.
- **Authorization gaps (legacy):**
  - pre-authorization patient switch;
  - fragment endpoints without ACL;
  - Care Team save without a write check;
  - 7 `controller.php` controllers without ACL.

  All are verified in code; live checks come in Phase 6.
- **API:** authenticated SQL injection via parameter names on `/api/prescription`.
  It was unreachable in production until the dashboard's client was granted
  `user/prescription.rs`. That exposure was accepted together with the BFF's
  two-layer allow-list (`PATIENT_DASHBOARD_MIGRATION.md` §4, `evidence/slice-03-01-regression.txt`).
- **Parity gaps "not available via API":** Rx refills, Care Team member status and
  note, `lists_touch`, squad restriction, `hide_dashboard_cards`. Patient Notes
  has no read API, so the extra section is **Vitals**.
