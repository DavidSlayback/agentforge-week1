# Phase 0 Walkthrough — Probing the Patient Dashboard

About 30 minutes. The goal is to see exactly what the current dashboard
shows for the seven things we're porting, so the new one can match it.
Synthetic data only.

## Step 1 — Set up (5–15 min, mostly waiting)

1. Start **Docker Desktop** and wait for "Engine running".
2. Open **PowerShell** in your `agentforge-week1` folder, pull this branch,
   and run the setup script:
   ```powershell
   git fetch origin claude/legacy-codebase-conversion-oc0jjg
   git checkout origin/claude/legacy-codebase-conversion-oc0jjg -- docs/legacy-audit
   powershell -ExecutionPolicy Bypass -File docs\legacy-audit\phase0-setup.ps1
   ```
   The `git checkout ... -- docs/legacy-audit` line only copies the audit
   folder into your working tree. It doesn't switch your branch, so your
   `agentforge/w2-final` work is untouched.
3. The script ends with a list of links, including a **Probe patient** and
   an **Empty-state patient**. Keep that window open.

If anything fails, copy the red error text to Claude.

## Step 2 — Log in and time the dashboard (5 min)

1. Open <http://localhost:8300/> and log in as `admin` / `pass`.
   If the email pop-up appears, note what it says and dismiss it.
2. Press **F12** to open the browser dev tools and go to the **Network**
   tab.
3. Open the **Probe patient → Dashboard** link from the script.
4. Once the page settles, read the number at the bottom of the Network tab:
   **"Finish: X s"**. Reload twice and note all three numbers. These are
   the "before" numbers for the defense doc.
5. Take a **full-page screenshot**. In Chrome or Edge: Ctrl+Shift+P, type
   "full size screenshot", press Enter.

## Step 3 — Check each of the seven areas (15 min)

For each area, write one or two lines and take a screenshot of the card:

| # | Area | Note down |
|---|---|---|
| 1 | **Header bar** | Every field shown (name, DOB, sex, MRN, active status, anything else). What's clickable? |
| 2 | **Allergies** | Columns shown; order; can you expand/collapse; edit/add links |
| 3 | **Problem List** (Medical Problems) | Same |
| 4 | **Medications** | Same |
| 5 | **Prescriptions** | Same. If the script showed 0 prescriptions, add one: in the card's edit/add link, fill the minimum and save |
| 6 | **Care Team** | Same. If empty, add one member if the card allows it |
| 7 | **Patient Notes** | Same. Add one note if empty (the Notes card has an add link) |

Then scroll the whole page and **list every other card** (vitals, labs,
immunizations, appointments, insurance, reminders, …). They'll be marked
"not ported".

## Step 4 — Empty state (2 min)

Open the **Empty-state patient** link. Take one full-page screenshot. We
need to match how empty cards look.

## Step 5 — Confirm the API is on (2 min)

1. Open <https://localhost:9300/apis/default/fhir/metadata> and accept the
   certificate warning. You should see a long JSON document. That means the
   FHIR API is up.
2. Optional: <http://localhost:8300/interface/super/edit_globals.php> →
   **Connectors** tab. Just look; the dev stack already enables the REST
   API, the FHIR API, and OAuth2.

## Step 6 — Send it back

Paste into chat:

- the script's output (the patient table and links);
- your three load times;
- your notes for the seven areas and the list of other cards;
- the screenshots.

Claude then finishes `RECON.md` and presents the Phase 0 checkpoint for your
approval. Phase 1 doesn't start until you say so.
