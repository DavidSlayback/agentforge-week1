# Side Quests — Patient Dashboard Port (Phase 9)

Off-critical-path work surfaced during the legacy audit. 33 candidates, no per-quest files.

**Status counts:** promote-after-deadline 8 · park 22 · drop 3

**Top 3 recommended:** SQ-01 sort severe allergies to top (David named this a Phase 9
side quest directly) · SQ-02 vitals trend graphs (answers B-08's "wall of text, worse
than reading source documents") · SQ-30 add PHPStan/PHPCS/ESLint to the pre-commit
gate (closes "no CI runner enforces any OpenEMR check" — AUDIT-STATE 9.01).

Everything below is a candidate, not a commitment. Main-quest parity work stays in
`docs/agentforge/PLAN.md`; legacy defects with no port relevance stay catalogued (not
duplicated in full) in `../BUGS-MITIGATIONS.md`.

---

## (a) UX improvements David asked for

Source: `RECON.md` David's dashboard pass (B-06…B-16) and `BASELINE-ERRORS.md`. The
brief says *reimplement, not redesign* (`AGENT-BRIEF.md`), so none of these belong in
a parity slice — parity ships first, these are additive, SPA-side only, and touch no
OpenEMR backend code.

| ID | Title | Source | Value | Effort | Risk | Status | Reason |
|---|---|---|---|---|---|---|---|
| SQ-01 | Sort severe allergies to the top | Phase 2 parity decision (`AUDIT-STATE.md` Decisions, 2026-09-25); catalog 4.03 | High — a promised behavior (severity highlight) that's currently unordered | S | Low — client-side re-sort of `severity_al`, already in the REST response (5.03/573 "design out in port") | promote-after-deadline | Named explicitly by David as a Phase 9 side quest when parity decisions were made |
| SQ-02 | Vitals trend graphs | B-08 / catalog 7.10 ("no graphs, search or filters") | High — directly answers "worse than just reading source documents" | M — needs a charting lib and the REST per-encounter vitals series | Low, read-only | promote-after-deadline | Highest-value fix for David's core complaint about the dashboard |
| SQ-03 | Search / filter controls across cards | B-08 / catalog 7.10 | Medium-High | M — needs a bounded design pass so it doesn't become its own redesign | Low | promote-after-deadline | Same source as SQ-02; scope it separately so it doesn't block the graphs |
| SQ-04 | Card reordering (move Vitals out of the basement) | B-09 / catalog 7.24 | Medium | S — layout/config only, no new data | Low | promote-after-deadline | Cheap, visible, no parity risk |
| SQ-05 | Clarify Medications vs Prescriptions | B-16 / catalog 7.25 | Medium — reduces confusion between two legacy tables users don't know are separate | S — copy/labels or an inline explainer | Low-Medium — must not merge the two data sources, that would break parity (`lists` type `medication` vs `prescriptions`) | promote-after-deadline | Labeling fix, not a data-model change |
| SQ-06 | Accessibility audit + automated checks (axe) for the new SPA | catalog 7.12 (no a11y tests/audit exists today, legacy or AgentForge) | Medium — no legacy baseline to beat, but no regression either | M | Low | park | Competes with Sunday build time; add once the port ships and there's a UI to audit |
| SQ-07 | Back-button-driven, full-page-reload navigation | B-06, B-07 | — | — | — | drop | Solved automatically by the SPA's client-side routing; not separate work |
| SQ-08 | Pop-ups with no clear trigger | B-10 / catalog 7.23 (out of port scope) | — | — | — | drop | The legacy tabbed shell that produces these pop-ups doesn't exist in the port |
| SQ-09 | Add/edit interface is unpleasant | B-15 / catalog 7.22 (out of port scope) | — | — | — | drop | Port is read-only; there is no add/edit UI to improve |

## (b) Legacy fixes (change OpenEMR's backend — parked by default)

Source: `BUGS-MITIGATIONS.md` entries with disposition `fix in legacy`. These would
change OpenEMR's PHP, Twig, or API surface, which `AGENT-BRIEF.md` (DB-10 / W2D-8)
forbids for this port. Each is a real defect, but ships as a separate upstream-style
patch — not inside this repo's port branch — if and when the team decides to touch
legacy code again. Parked by default per `AGENTS.md`'s "one branch, one deployed SHA"
rule: none of these are on the deployed SHA the port ships from.

| ID | Title | Source | Value | Effort | Status | Reason |
|---|---|---|---|---|---|---|
| SQ-10 | Vitals card can show a **deleted** set as current (U-1) — `forms` joined on `form_id` alone, no `formdir`/`pid` | catalog 5.01, Critical | Critical — silently defeats the only retraction mechanism on the clinician's summary view | S — add the missing join predicates | park | Backend change (DB-10); the port avoids it entirely via the REST per-encounter route (SQ not needed there) |
| SQ-11 | FHIR vital-signs Observations include deleted sets marked `final` (M-5) | catalog 5.02, Critical | Critical — same integrity compromise, on the interoperability surface | S — add a default `deleted=0` search field | park | Same as SQ-10; upstream report only |
| SQ-12 | Confidential OAuth client not authenticated at `/token` without a secret | catalog 1.01, High | High | M | park | Upstream OAuth-server fix |
| SQ-13 | SQL injection via query-parameter names on `GET /api/prescription` (M-1) — **revisit M-1 upstream report** | catalog 2.01, High | High | M | park | Explicitly deferred by David, 2026-09-25 ("we'll think about it later" — `AUDIT-STATE.md` Open questions); not reachable in production today (no enabled client has a `prescription` scope). The BFF also designs around it (allow-lists `patient_id` only) |
| SQ-14 | Stored XSS in the Care Team card | catalog 2.02, High | High | S | park | Upstream template fix |
| SQ-15 | `set_pid` switches patient, audits and runs CDR before authorization | catalog 3.01, High | High | M | park | Upstream auth-ordering fix |
| SQ-16 | Patient identity emitted before the page ACL gate | catalog 3.02, High | High | S | park | Upstream fix |
| SQ-17 | Dashboard fragment endpoints run no ACL check | catalog 3.03, High | High | M | park | Upstream fix |
| SQ-18 | Squad restriction hides only the header | catalog 3.04, High | High | M | park | Upstream fix; API has no squad concept so the port can't enforce it either |
| SQ-19 | Care Team save has no write ACL | catalog 3.05, High | High | S | park | Upstream fix |
| SQ-20 | `controller.php` router: 7 of 10 controllers have no ACL | catalog 3.06, High | High | M | park | Upstream fix |
| SQ-21 | CORS preflight branch never runs (reflects any `Origin`) | catalog 4.01, High | High | S | park | Upstream fix; the port sidesteps it by being same-origin behind the BFF |
| SQ-22 | Rx `active` filter never fires; saving an edit re-activates a stopped prescription | catalog 5.03, High | High | S | park | Upstream fix; port follows the decided parity rule (show all rows) meanwhile |
| SQ-23 | Async fragments carry no patient id (mid-load patient switch risk) | catalog 5.04, High | High | M | park | Upstream fix; port sends an explicit patient id on every call by design |
| SQ-24 | Care-team member status not propagated; FHIR `CareTeam` shows inactive members as active | catalog 5.05, High | High | S | park | Upstream fix |
| SQ-25 | `refills` never selected; FHIR reports 0 | catalog 5.06, High | High | S | park | Upstream fix |
| SQ-26 | FHIR `Condition` drops the coded diagnosis; `clinical-status` targets a missing column | catalog 5.07, High | High | M | park | Upstream fix |
| SQ-27 | Allergy–medication conflict alert fails with 2+ conflicts (JS syntax error) | catalog 7.01, High | High | S | park | Upstream fix; not on the port path (CDR alert isn't ported) |
| SQ-28 | Add-prescription link builds `controller.php??prescription` (B-14) | catalog 7.02, High | High — a core legacy workflow (adding a prescription) is broken | S — one-character template fix (`{{ CONTROLLER }}?prescription…` drops the leading `?`) | park | Trivial fix, but still a Twig-template (backend) change; the single cheapest item here to promote first if backend changes are ever authorized |
| SQ-29 | Adding/removing entries needs no confirmation (B-13) | catalog 7.11, Medium | Medium — data-safety gap | S | park | Real legacy gap; irrelevant to a read-only port, which has no add/remove UI |

## (c) Tooling / process

Source: `BASELINE-ERRORS.md` and `BUGS-MITIGATIONS.md` §9 (Build/Deployment Risks).
These are about the repo's own gate and AgentForge's own module — allowed to touch,
just not required to ship the read-only dashboard port by Sunday.

| ID | Title | Source | Value | Effort | Status | Reason |
|---|---|---|---|---|---|---|
| SQ-30 | Add OpenEMR-wide PHPStan/PHPCS/ESLint to `.githooks/pre-commit` (keep `.gitlab-ci.yml` in sync) | catalog 9.01 | Medium — closes "no CI runner enforces any OpenEMR check" | M | promote-after-deadline | Distinct from the main-quest requirement to add the *port's own* tests to the gate (`AGENT-BRIEF.md`), which is not a side quest |
| SQ-31 | Fix the 272 real PHPStan level-10 errors in `oe-module-agentforge` | catalog 9.01 / E-11 | Medium — AgentForge's own code fails the repo's own static-analysis bar | L — 272 errors | promote-after-deadline | Blocks ever turning PHPStan on in the gate (SQ-30) without a baseline exception for AgentForge's own module |
| SQ-32 | `.gitattributes eol=lf` for fixtures/scripts (Windows checkouts break byte-exact tests and PHPStan baselines) | catalog 9.04 / E-01, E-02, E-12 | Medium — dev-experience, cross-platform | S | promote-after-deadline | Low effort, unblocks every future Windows contributor from re-discovering `MSYS_NO_PATHCONV=1` and LF-copy workarounds |
| SQ-33 | Production ops readiness: scheduled DB/volume backups + restore drill, uptime/error-rate alerting | catalog 9.02, 9.03 | High — no safety net exists today | M | park | Infra work, not blocking Sunday's read-only SPA ship; revisit once the port is deployed |
