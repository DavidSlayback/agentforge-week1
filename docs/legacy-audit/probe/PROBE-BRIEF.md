# Probe Brief — OpenEMR Patient Dashboard (Phase 0)

You are one of several independent probers (David, Claude, Codex). The goal
is to see what the current OpenEMR patient dashboard shows for the areas we
will port, so the new version can match it. Independent views catch
different things, so **don't read other probers' notes until you've
written yours.**

Background: `docs/legacy-audit/REQUIREMENTS-TRACE.md`. The areas we're
porting are the patient header, Allergies, Problem List, Medications,
Prescriptions, Care Team, and Patient Notes.

## Rules

- **Read-only.** Don't add, edit, or delete any data, and don't change
  settings. Only log in, navigate, read, and screenshot. (David adds any
  missing test data himself.)
- **Local dev stack, synthetic data only**, at `http://localhost:8300`
  (login `admin` / `pass`). Never point this at anything else.
- **Don't commit or push anything.** Write only inside
  `docs/legacy-audit/probe/results/<your-label>/`.
- **Stick to observations.** Say what you saw, where, and how you know.
  Mark guesses as guesses. Don't read OpenEMR's source code for this; the
  point is the user's-eye view.

## Step 1 — Run the automated probe

From the repo root (needs Node 18+):

```bash
cd docs/legacy-audit/probe
npm run setup                     # installs Playwright + Chromium, one time
node probe-dashboard.mjs --pid <PROBE_PID> --empty-pid <EMPTY_PID> --label <your-label>
```

Take `PROBE_PID` and `EMPTY_PID` from the output of
`docs/legacy-audit/phase0-setup.ps1` (David has already run it), or ask
David. Labels: `claude-laptop`, `codex`, `david`.

This writes `results/<label>/summary.json`, per-patient `cards-<pid>.json`,
and screenshots. It logs in, times three dashboard loads, captures every
card's title, text, columns, and links, records console errors and failed
requests, and checks the FHIR metadata endpoint.

## Step 2 — Explore by hand (browser or computer use)

Log in and open the probe patient's dashboard:
`http://localhost:8300/interface/patient_file/summary/demographics.php?set_pid=<PROBE_PID>`.
Also look at it inside the normal UI (Patient → Finder → the patient),
because it may behave differently inside the tabbed shell.

For each area, note: what it shows, the columns/fields, the order, whether
it expands or collapses, which links or actions it has (don't click
anything that saves), and how it looks when empty (the empty-state
patient).

Also note:

- anything slow, broken, confusing, or inconsistent;
- anything on the dashboard that exposes more than it should, or that you
  can't tell whether you should be able to see;
- how you'd tell which patient you're looking at, and whether that ever
  becomes ambiguous;
- every other card on the page (these will be marked "not ported").

## Step 3 — Write your notes

Create `results/<your-label>/NOTES.md`:

```markdown
# Dashboard probe — <label> — <date>

## Summary (5 bullets max, most important first)

## Header
## Allergies
## Problem List
## Medications
## Prescriptions
## Care Team
## Patient Notes
## Empty state
## Other cards on the page
## Performance (from summary.json, plus what it felt like)
## Errors and oddities
## Things to be careful about when porting
## Open questions for David
```

When you're done, tell David the path to your `NOTES.md` and
`summary.json`. Claude will merge all the probes into `RECON.md` and show
where they disagree.
