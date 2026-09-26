# UI layer — patient dashboard (Phase 2 catalog)

The dashboard is one PHP page with synchronous card blocks and asynchronous
fragment endpoints, embedded in the tabbed shell. Navigation and lifecycle are
in [`UI-FLOW.md`](UI-FLOW.md). The Phase 1 structural map is
[`DASHBOARD-MAP.md`](DASHBOARD-MAP.md); where Phase 2 disagrees with it, Phase 2
wins (see "Corrections to Phase 1" below).

Finding counts are provisional and per analysis. Duplicates across analyses (for
example the Vitals join bug appears in two) are merged in Phase 7.

## Catalog

| Unit | Analysis | Purpose | Entry point | Permission gate | Tier | C / H / M / L |
|---|---|---|---|---|---|---|
| `demographics.php` 1–1055 | [DEMOGRAPHICS-PART1-BOOT](DEMOGRAPHICS-PART1-BOOT.md) | boot, `set_pid`, CDR, head JS, async loader | `demographics.php?set_pid=N` | none before line 1056 | 3 | 0 / 5 / 7 / 11 |
| `demographics.php` 1056–2080 | [DEMOGRAPHICS-PART2-CARDS](DEMOGRAPHICS-PART2-CARDS.md) | page gate + all 22 cards | same | `patients/demo` (1056); per-card ACLs | 3 | 0 / 5 / 5 / 10 |
| Patient identity bar | [DASHBOARD-HEADER](DASHBOARD-HEADER.md) | persistent name / MRN / DOB bar in the shell | `left_nav.setPatient` | inherits page | 2 | 0 / 0 / 1 / 4 |
| Allergies / Problems / Medications templates | [CARD-TEMPLATES](CARD-TEMPLATES.md) | Twig card bodies | rendered by `demographics.php:1090-1182` | inherits page | 2 | 0 / 0 / 3 / 3 |
| Prescriptions fragment + list | [PRESCRIPTION-TEMPLATES](PRESCRIPTION-TEMPLATES.md) | Rx card body and edit list | `controller.php?prescription&fragment|list` | `patients/rx` (view only) | 2 | 0 / 1 / 2 / 4 |
| Care Team card | [CARE-TEAM-CARD](CARE-TEAM-CARD.md) | view + in-card edit form | constructed at `demographics.php:1253` | `patients/demo` read; **save has no write check** | 2 | 0 / 1 / 2 / 3 |
| Vitals fragment + report | [VITALS-FRAGMENT](VITALS-FRAGMENT.md) | latest vitals set (DB-08) | `vitals_fragment.php` (async) | **none server-side** | 2 | 1* / 1 / 1 / 3 |
| `stats.php` | [STATS](STATS.md) | out-of-scope issue cards, immunizations | async | per-type `aclCheckIssue`; **none for immunizations** | 2 | 0 / 0 / 2 / 4 |
| `LayoutsUtils` | [LAYOUTS-UTILS](LAYOUTS-UTILS.md) | list-option label lookup | helper | n/a | 1 | 0 / 0 / 0 / 4 |

\* The Vitals join bug is filed as Critical by the tier-2 agent and High by the
tier-3 agent. The orchestrator reproduced it with SQL. Its final severity is set
in Phase 7 (Critical candidate: deleted vitals shown as current).

**Totals (before dedup):** 1 Critical (candidate), 13 High, 23 Medium, 46 Low.

## Verified High / Critical-candidate findings (tier 3)

| # | Finding | Evidence | For the port |
|---|---|---|---|
| U-1 | Vitals card can show a **deleted** vitals set as current (join on `forms.form_id` without `formdir`/`pid`) | `vitals_fragment.php:27`; reproduced: pid 13 returns set 28 (deleted) instead of 27 | **Must not survive**; intentional parity deviation |
| U-2 | Allergy–medication conflict `alert()` is a JS syntax error with 2 or more conflicts, and they are logged as seen anyway | `demographics.php:111-118` | Out of port scope (CDR); catalog |
| U-3 | Rx `active` filter is dead (`populate_array` skips `0`); saving an edit re-activates a stopped Rx | `ORDataObject.php:137`, `Prescription.class.php:149` | Parity question (see checkpoint) |
| U-4 | Care Team save has CSRF but **no write ACL** | `CareTeamViewCard.php:47,124-147` | Port is read-only; catalog |
| U-5 | Care Team stored XSS (`note`, `provider_since` into `innerHTML`) | `manage_care_team.html.twig:64-65,72-73` | Port must escape (the framework default) |
| U-6 | `set_pid` switches patient, writes the audit row and runs CDR before any authorization check | `demographics.php:84-94` vs `1056` | Port relies on API scopes/ACL per request |
| U-7 | Identity JS (name, DOB, pubpid, encounter list) is emitted before the page ACL gate | `demographics.php:916-967` vs `1056` | Port: no data before authorization |
| U-8 | Fragment endpoints (vitals, labdata, reminders, immunizations in `stats.php`) run no ACL check and read the session patient | `vitals_fragment.php:15-21`, `stats.php:273-314` | Port: n/a (API); catalog |
| U-9 | Squad restriction hides only the header; cards still render | `demographics.php:1068-1077` | No API equivalent; checkpoint question |
| U-10 | B-14: Add-prescription link builds `controller.php??prescription` | `general_list.html.twig:449`, `Controller.class.php:78` | Out of port scope; catalog |
| U-11 | Async fragment fetches carry no pid, so a patient switch mid-load can mix two patients' cards | `demographics.php:494-513` | **Must not survive**: every API call carries an explicit patient id |

Provisional Medium security items for Phase 6: the Rx edit list is reachable
under view-only ACL (PRESCRIPTION-TEMPLATES #5); `pnotes_fragment.php` runs
`disappearPnote` before its ACL check; eRx SOAP POSTs have no CSRF.

## Corrections to Phase 1 (applied in this commit)

| Phase 1 said | Phase 2 found | Source |
|---|---|---|
| Rx card filters `active > 0` | The filter exists but never fires: all rows show | PART2 #3, verified |
| Rx "Details" = `dosage` | `size + unit + dosage` display values | PRESCRIPTION-TEMPLATES |
| Missing user setting → card expanded | Missing setting → **collapsed**; expanded cards come from a global-default row set by the first user who toggled them | CARD-TEMPLATES, PART2 |
| Care Team members didn't render | They do render (built client-side from JSON); the probe captured only `<th>` text | CARE-TEAM-CARD, PART2 |
| Messages hid one active note (unexplained) | `getPnotesByDate` excludes `message_status='Done'` | PART1, PART2 |
| `demographics.php` is 1,890 lines | 2,080 lines | PART1 |
| E-08 is cosmetic | Outside the shell, reminder cards spin forever and collapse state isn't saved | PART1 |
