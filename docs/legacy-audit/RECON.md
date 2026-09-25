# Recon — AgentForge (OpenEMR, for the patient dashboard port)

Everything here came from *looking*: running the app, reading the README,
looking over the file tree, plus read-only SQL counts to explain what the
UI shows. No OpenEMR source code has been read yet. Each fact says who
observed it: **[David]**, **[codex]** (Codex probe, pid 7), **[claude]**
(claude-laptop probe, pids 13 and 3), or **[DB]** (read-only SQL).
Probe notes: `probe/results/{codex,claude-laptop}/NOTES.md`.

_Status: dashboard probed by Codex, Claude and David. Open: Care Team /
Patient Notes have no data and David could not create any._

## What it is

OpenEMR is an open-source electronic health record system, built in PHP
since 2001. This repo is the Gauntlet `openemr-base-clean` fork plus the
AgentForge Co-Pilot work. The W2 surprise challenge ports **the patient
dashboard** (a PHP, server-rendered page) to a modern framework that uses
only the existing REST/FHIR API. **[agent, from the README and brief]**

## Provenance

| Field | Value |
|---|---|
| Upstream | `Gauntlet-HQ/openemr-base-clean` @ `ef3d4909` **[agent]** |
| License | GPL-3 (OpenEMR) **[agent]** |
| Maintainer | OpenEMR community upstream; this fork is David's |

## Vital signs **[agent, from INVENTORY.md with exclusions]**

| Metric | Value |
|---|---|
| Lines (excluding docs, data dumps, generated code) | ~1.0M |
| Largest areas | `interface` 300K, `src` 179K, `tests` 134K, `library` 117K |
| Dashboard page | `interface/patient_file/summary/demographics.php` + ~30 fragment files |
| FHIR controllers for the required cards | Patient, AllergyIntolerance, Condition, Medication/MedicationRequest, CareTeam all exist |
| Existing tests | AgentForge 103/103, evals 10/10, W2 eval gate pass; isolated PHPUnit 3,474 tests with 24 failures, all CRLF-checkout artifacts (see `BASELINE-ERRORS.md`) |

## Run-through

- **How it was run:** David, locally on Docker Desktop (`docker/development-easy-light`). **[David]**
- **Login and session:** a pop-up asks for an email address. It's unclear
  what it's for or whether the session is remembered. Probably OpenEMR's
  product-registration prompt; to confirm. **[David]**
- **Performance:** loading is slow in general. **[David]**
- **Navigation:** the endless tab pop-ups are unpleasant. It's also not
  clear how the different parts authenticate (OpenEMR login vs API vs
  AgentForge service). **[David]**
- **Data entry:** the highlighting of form fields is painful during data
  entry. Many fields have no validation, for example SSN. **[David]**
- **Center of gravity:** the patient dashboard
  (`demographics.php?set_pid=N`): 22 cards on one page. **[codex] [claude]**
- **Patient dashboard:** see the next section.

## Patient dashboard (merged probes)

Test data: 13 Synthea patients. pid 13 is the richest (2 allergies, 38
problems, 5 medications, 5 prescriptions); pid 3 has nothing; pid 7 (Codex)
has 0 allergies. **No patient has any Care Team or Patient Notes rows.** **[DB]**

| Card (DB id) | What it shows | Filter / mapping | Empty text | Default |
|---|---|---|---|---|
| Header (DB-02) | Page title "Medical Record Dashboard - <name>" + nav row. **No DOB, sex, MRN or status** on the direct URL. DOB/sex/External ID only in the collapsed Demographics card. **[codex] [claude]** | Tabbed-shell header not yet observed (needs David's login) | n/a | n/a |
| Allergies (DB-03) | Plain list; rows end in "(1)" **[claude]** | **Same `filterActiveIssues()` as Problems/Meds.** The "(1)" is `severity_al` shown as its raw code because no `severity_ccda` label matched (`LayoutsUtils.php:17-24`) **[Phase 1, verified]** | "Nothing Recorded" | expanded |
| Medical Problems (DB-04) | Plain list of titles; UI title is "Medical Problems", not "Problem List" | **`filterActiveIssues()`**: `outcome != 1` and no `enddate` or a future one (`demographics.php:1110-1113`). 12 of 38 for pid 13 **[DB]** (13 of 39 after David's edit); Codex saw 9 for pid 7 | "Nothing Recorded" | expanded |
| Medications (DB-05) | Plain list of titles | **Only rows with no `enddate`**: 1 of 5 for pid 13 **[DB]** | "Nothing Recorded" | expanded |
| Prescriptions (DB-06) | Table: Drug, Details, Qty, Refills, Filled; sorted by Filled desc | **Rows with `active > 0`** (`general_fragment.html:28`), so ended prescriptions still show if `active=1` (4 of 5). The edit list shows all rows **[Phase 1, verified]**. Details = `dosage`, Qty = `quantity` (NULL → blank), Filled = `date_added` **[DB]** | "None" | expanded |
| Care Team (DB-07) | Collapsed; empty 8-column table header (Type, Member, Role, Facility, Since, Status, Note, Remove) **[codex]** | No data anywhere **[DB]** | unobserved | collapsed |
| Patient Notes (DB-08) | No card titled "Patient Notes". Nearest: **Messages** ("There are no messages on file…") **[codex] [claude]** | `pnotes` empty for all patients **[DB]**. FHIR metadata lists no obvious notes resource **[claude]** | "There are no messages on file for this patient." | collapsed |

Other 16 cards (not ported, per A1): Treatment Intervention Preferences, Care
Experience Preferences, Demographics, Billing, Insurance, Patient Reminders,
Disclosures, Amendments, Labs, Vitals, Patient Portal / API Access, Clinical
Reminders, Recall, Appointments, Health Concerns, Immunizations. **[codex] [claude]**

**Performance (the "before" number).** Direct URL, headless Chromium on the
laptop, 3 loads each: network idle 3.3–4.2 s (pid 13), 3.6–3.9 s (pid 3),
3.9–5.2 s (pid 7, Codex); about 150–167 KB over 18 requests. An empty
patient is no faster. **[codex] [claude]**

**Console errors on every load (outside the tabbed shell):**
`top.restoreSession is not a function` ×2 and `Cannot read properties of
undefined (reading 'setPatient')` ×1; 0 failed requests. FHIR
`/metadata` → 200, FHIR 4.0.1. **[codex] [claude]**

### David's dashboard pass (pid 13, tabbed shell, 2026-09-25)

- **Navigation is slow and seems to reload everything each time.** Moving
  around depends on the browser Back button, so it's easy to back out of
  the patient view by accident. **[David]** (B-06, B-07)
- **"Less a dashboard, more a pile of uncollapsible noise."** No graphs, no
  search, no filtering; a wall of text that is "worse than just reading
  source documents". **[David]** (B-08) The probes did find collapse toggles
  on every card **[codex] [claude]**, so "uncollapsible" is about how it
  feels in use, not a missing control.
- **Card order feels wrong:** Vitals is near the bottom. **[David]** (B-09)
- **Pop-ups are annoying and it isn't clear what triggers them.** **[David]** (B-10, extends B-01)
- **Patient names are garbled with numbers.** Confirmed as synthetic-data
  noise: Synthea appends digits (Zack583 Metz686). **[David] [DB]** (B-11)
- **It never seems to ask for auth again.** **[David]** (B-12)
- **Adding and removing entries is too easy** (no confirmation). David
  added one medical problem to pid 13 at 16:36 UTC, so pid 13 now has 39
  problems, 13 open; the probes' "12 open" predates that. **[David] [DB]** (B-13)
- **Adding a prescription fails** with "Missing or invalid 'controller'
  parameter". The message comes from `library/classes/Controller.class.php:202`
  (the `controller.php` router whitelist). The dashboard's pencil link uses the
  legacy positional form, which has a fallback, so the break is probably
  deeper in the add flow; to trace in Phase 6. **[David]** (B-14)
- **The add/edit interface is unpleasant in general.** **[David]** (B-15)
- **Medications vs Prescriptions as two cards is confusing.** **[David]**
  (B-16). This matches the data: they are separate tables (`lists` type
  `medication` vs `prescriptions`) with different filters. **[DB]**
- **Care Team: couldn't add a member. Patient Notes: no section visible.**
  **[David]** This confirms the probes: DB-07 and DB-08 have no data and no
  obvious way to create it from the dashboard.

### Where the probes disagree

| Topic | Codex | Claude | Resolution |
|---|---|---|---|
| Prescriptions "1.00" | "Every visible quantity is 1.00" | It sits under *Details*; *Qty* is blank | **Claude**: `dosage`=1.00, `quantity` NULL **[DB]** |
| 6 spawner PHPUnit failures | "Medium: status parsing / child process" bugs | CRLF checkout artifact | **Claude**: the LF copy passes 19/19 in the same container |
| Problem count | 9 rows (pid 7) | 12 rows (pid 13) | Not a conflict: both equal the open-problem count; different patients |
| Empty state | Not observed (pid 12 gave HTTP 400 after a session change) | pid 3: "Nothing Recorded" ×3, "None" for Prescriptions | Claude observed it; Codex's pid 12 is data-rich, so its 400 was most likely a session problem (inference), not an empty state |
| Finder / tabbed shell | Finder showed a blank content area; a login prompt blocked it | Not observed (agents can't log in) | **Partly resolved** by David's pass: it works but is slow and Back-button driven. Header contents in the shell still unrecorded |
| Collapsing | Every card has an expand/collapse toggle | same | David: "uncollapsible noise". Not a contradiction; the toggles exist but don't help |

David's general run-through (B-01…B-05) agrees with both probes on the
registration pop-up (B-01) and slow loads (B-02). Neither probe tested
data entry (B-03, B-04).

## Observed red flags

- **Silent, inconsistent list filters.** Problems and Medications hide
  ended rows; Prescriptions shows them. A user can't tell a list is
  filtered. A port that just calls FHIR will almost certainly differ.
  **[DB] [claude]**
- **No persistent patient identity on the dashboard page.** Synthea names
  are near-duplicates (Zack583, Kiley170). This matters for DB-02. **[codex] [claude]**
- **JS errors on every load** (`restoreSession`, `setPatient`): the page
  assumes it runs inside the tabbed shell. **[codex] [claude]**
- **Two DB-in-scope cards have no test data.** Parity for DB-07 and DB-08
  can't be shown until David adds some. **[DB]**

- **No input validation on sensitive identifiers (SSN).** A data-quality
  and security concern for the catalog. The dashboard port is read-only,
  so it doesn't change this. **[David]**
- **Auth model is unclear to a user.** Several login and session
  mechanisms with no explanation. This matters directly for DB-01
  (OAuth2/OIDC) and for parity of who can see what. **[David]**
- **Slow page loads.** A baseline for the port to beat; worth measuring
  before and after on the dashboard. **[David]**

## Relevance to the port

| Observation | In scope for the dashboard port? |
|---|---|
| Slow loading | **Yes, as a measure.** Record dashboard load time now as the "before" number for `PATIENT_DASHBOARD_MIGRATION.md`. |
| Unclear auth | **Yes.** DB-01 must make the login flow explicit, and the audit must map the dashboard's ACL checks. |
| Email pop-up | Only if it appears in the OAuth2 login flow. |
| No graphs / search / filter; card order (B-08, B-09) | **Tension with parity (A1).** The brief says reimplement, not redesign. Decide at the checkpoint: strict parity, or parity plus a small, explicit improvement list. |
| Medications vs Prescriptions confusion (B-16) | **Yes, as a labeling question.** Keep both cards (parity) but the port can say what each one is. |
| Back-button navigation, full reloads (B-06, B-07) | **Yes.** A single-page app fixes these as a by-product; measure it. |
| Too-easy add/remove, broken Rx add (B-13, B-14, B-15) | **No** for the read-only port; record for the catalog. |
| Tab pop-ups, form highlighting, SSN validation | **No.** The brief says reimplement, not redesign, and these are outside the dashboard. They go to the catalog and side quests. |

## Constraints

- Live-app observations need David's laptop stack; the cloud container has
  no Docker. **[agent]**
- Agents may not type credentials into the browser, so hand exploration of
  the tabbed shell needs David to log in first. **[claude]**
- The laptop checkout is CRLF (`core.autocrlf=true`), which breaks
  byte-exact PHP tests in the container. **[claude]**

## Project manifest

`composer.json` (PHP) and `package.json` (JS build). The AgentForge
service has its own `agentforge/package.json`. The dashboard entry point
is `interface/patient_file/summary/demographics.php`. **[agent]**
