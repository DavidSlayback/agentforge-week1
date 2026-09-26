# Dashboard probe — claude-laptop — 2026-09-25

Probe patient **pid 13** (richest: 2 allergies, 38 problems, 5 medications,
5 prescriptions). Empty-state patient **pid 3** (nothing recorded in any
card). Both chosen from a read-only `SELECT COUNT(*)` over `lists`,
`prescriptions`, `pnotes` (see "How I know" notes). Stack: local
`docker/development-easy-light`, `http://localhost:8300`.

**Independence caveat.** I read Codex's `NOTES.md` before writing this
(David asked me to secure the Codex feedback before any worktree pruning).
Where I disagree with Codex I say so explicitly and give the evidence.

**Method caveat.** Unlike the brief's "user's-eye view only" rule, I also ran
read-only SQL to explain what the UI shows (why counts differ). Those
findings are marked *[DB]*. No data or settings were changed.

## Summary (5 bullets max, most important first)
- **The dashboard filters silently, and inconsistently.** Medical Problems
  shows 12 of pid 13's 38 problems and Medications 1 of 5 — only rows with no
  end date *[DB]*. Prescriptions shows all 5, including ones whose
  `end_date` has passed. A port must reproduce each card's filter, not just
  its fields.
- **Care Team and Patient Notes cannot be parity-checked with current data.**
  Every patient has 0 `care_teams`, 0 `care_team_member`, 0 `pnotes`
  *[DB]*. There is no card titled "Patient Notes"; the nearest is
  "Messages" (collapsed, "There are no messages on file…").
- **Prescriptions columns are easy to misread.** "1.00" sits under
  *Details* and is `dosage`; *Qty* is blank because `quantity` is NULL;
  *Filled* is `date_added` *[DB]*. (Codex read 1.00 as quantity.)
- **No patient identity bar on the direct dashboard URL.** Only the page
  title "Medical Record Dashboard - Zack583 Metz686". DOB, sex and
  External ID appear only inside the collapsed Demographics card.
- **Every load throws JS errors.** `top.restoreSession is not a function`
  (×12 over 6 loads) and `Cannot read properties of undefined (reading
  'setPatient')` (×6) — i.e. 2 + 1 per load when opened outside the tabbed
  shell. 0 failed network requests.

## Header
Direct URL `demographics.php?set_pid=13`: page heading "Medical Record
Dashboard - Zack583 Metz686", then a nav row: Dashboard, History,
Assessments ▾, Report, Documents, Transactions, Issues, Ledger, External
Data. Top-right: a collapse-all icon and a help (?) icon. No DOB, age, sex,
MRN/pubpid or status in the header. The Demographics card (collapsed by
default) holds Name, External ID 13, DOB 1974-02-10, Birth Sex Male,
address. Synthea names carry numeric suffixes (Zack583), so the name alone is
a weak identifier. _Tabbed-shell header: see "Tabbed shell" below._

## Allergies
Expanded by default. Plain list, no columns, pencil (edit) icon top-right
(not clicked). pid 13 rows: "Allergic disposition (finding) (1)",
"Aspirin (1)". The "(1)" suffix: both rows have `reaction=1` and
`severity_al=1` *[DB]*; which one is rendered is a **guess** until the code
is read — possibly a raw code shown instead of a label. Empty (pid 3):
"Nothing Recorded".

## Problem List
UI title is **"Medical Problems"**, not "Problem List". Expanded by default,
plain list, one title per row, no dates/codes/status shown, pencil icon.
pid 13 shows 12 rows; DB has 38, of which exactly 12 have no `enddate`
*[DB]* → the card shows open problems only. Order is not alphabetical and not
obviously by date (**guess**: insertion or begdate order; to confirm in
Phase 2). Empty: "Nothing Recorded".

## Medications
Expanded, plain list, pencil icon. pid 13 shows "Astemizole 10 MG Oral
Tablet" only; DB has 5 medication rows, 1 without `enddate` *[DB]*. No dose,
route or dates shown. Empty: "Nothing Recorded".

## Prescriptions
Expanded, full-width table: **Drug | Details | Qty | Refills | Filled**.
pid 13: 5 rows, sorted by Filled descending (2023-02-12 … 1979-08-09).
Details = `dosage` ("1.00"), Qty blank (`quantity` NULL), Refills "0"
(`refills` NULL rendered as 0), Filled = `date_added` with time *[DB]*.
Four of the five have an `end_date` in the past yet still show — no active
filter, unlike Medications. Empty (pid 3): the single word "None"
(different wording from the "Nothing Recorded" used by the other cards).

## Care Team
Collapsed by default, pencil icon. No data exists for any patient *[DB]*, so
populated behavior is unobserved. The card's DOM contains inline jQuery
(`datetimepicker`, `toggleEditMode`) and a table template with member types
"Provider"/"Related Person" — our probe script captured that script text as
the card text (a probe-script limitation, not a UI observation).

## Patient Notes
No card titled "Patient Notes". "Messages" is collapsed by default and says
"There are no messages on file for this patient. To add messages, please
click here." (link not clicked). `pnotes` is empty for all 13 patients
*[DB]*, so populated behavior is unobserved. Whether DB-08 "Patient Notes"
means this Messages card (backed by `pnotes`) is an open question.

## Empty state
pid 3: Allergies, Medical Problems, Medications → "Nothing Recorded";
Prescriptions → "None"; Care Team and Messages collapsed. Same 22 cards,
same order as pid 13.

## Other cards on the page
22 cards total. Not ported: Treatment Intervention Preferences, Care
Experience Preferences, Demographics, Billing, Insurance, Patient Reminders,
Disclosures, Amendments, Labs, Vitals, Patient Portal / API Access, Clinical
Reminders (spinner still spinning at capture), Recall, Appointments ("No
Appointments" / "No Recurring Appointments"), Health Concerns, Immunizations
(13 rows, small link text). Vitals shows "Most recent vitals from:
2018-02-25" but "Last Updated: 2026-09-25 15:12:11" and Height "170.3 in
(432.60 cm)" — implausible synthetic values; not in scope.

## Performance (from summary.json, plus what it felt like)
Three loads each, direct URL, headless Chromium, stack on the same laptop:
- pid 13: network-idle 3,761 / 3,294 / 4,204 ms; DOMContentLoaded 2,072–2,601 ms; 160 KB, 18 resources.
- pid 3: network-idle 3,946 / 3,566 / 3,679 ms; DOMContentLoaded 2,396–2,687 ms; 152 KB, 18 resources.
Login round-trip 6.3 s. Codex measured 3.9–5.2 s for pid 7 — same ballpark.
An empty patient is not faster, so load time is dominated by page/asset cost,
not data volume (**inference**).

## Errors and oddities
- Console errors per load outside the tabbed shell: `top.restoreSession is
  not a function` ×2, `…reading 'setPatient'` ×1. Codex saw the same pair.
- Login shows an "OpenEMR Product Registration" prompt every time.
- Inconsistent empty wording: "Nothing Recorded" vs "None".
- Problem list card title ("Medical Problems") differs from the brief's
  "Problem List".
- FHIR `/metadata` → 200, FHIR 4.0.1, and lists AllergyIntolerance,
  Condition, MedicationRequest, Medication, CareTeam, Patient,
  DocumentReference — **no resource that obviously maps to `pnotes`**.

## Things to be careful about when porting
- Reproduce per-card filters: open-only for Problems/Medications, all rows
  for Prescriptions. With FHIR, check what `Condition` / `MedicationRequest`
  return by default and whether `clinical-status` filtering matches
  `enddate IS NULL`.
- Map Prescriptions columns from fields, not positions (Details = dosage,
  Filled = date_added).
- Distinguish empty ("Nothing Recorded"/"None") from loading (Clinical
  Reminders spinner) from "not available via API" (A2).
- Keep a persistent identity bar (name + DOB + sex + ID): Synthea names are
  near-duplicates.
- Patient Notes may have no REST/FHIR source; confirm before building DB-08.

## Open questions for David
1. Can you add synthetic Care Team members and a few Patient Notes/Messages
   to pid 13 (and leave pid 3 empty)? Without them DB-07/DB-08 can't be
   parity-checked.
2. Does "Patient Notes" (DB-08) mean the Messages card (`pnotes`)?
3. Is showing ended prescriptions intended parity, or a legacy bug we should
   note and reproduce anyway (A1 says parity within ported cards)?
