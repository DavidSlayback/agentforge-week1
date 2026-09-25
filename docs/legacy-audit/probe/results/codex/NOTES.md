# Dashboard probe — codex — 2026-09-25

## Summary (5 bullets max, most important first)
- The page title identifies the selected patient by name only; no persistent header fields for DOB, sex, MRN, or active status were visible above the cards.
- PID 7 is a data-rich synthetic patient. The Allergies card says “Nothing Recorded”; Medical Problems lists 9 items; Prescriptions is a 7-row table.
- The dashboard shows 22 cards. Cards are arranged in a responsive grid with expand/collapse and pencil controls; several cards are empty or remain on “Loading...”.
- “Messages” is the visible note-like section, but it says there are no messages on file. Automated card classification reports `notes` missing.
- The designated empty-state PID was not provided. PID 12 returned HTTP 400 after a session transition and was not treated as an empty-state patient.

## Header
Direct dashboard URL: `http://localhost:8300/interface/patient_file/summary/demographics.php?set_pid=7`. The title reads “Medical Record Dashboard - Kiley170 Braun514.” The page nav shows Dashboard, History, Assessments, Report, Documents, Transactions, Issues, Ledger, and External Data. No DOB, sex, MRN, or active-status field appears in the page header. A separate Demographics card exists lower on the page, but it is not a persistent identity bar.

## Allergies
The card is expanded and displays “Nothing Recorded.” A pencil edit control is visible; it was not clicked.

## Problem List
The UI title is “Medical Problems.” It shows 9 plain rows, with no columns: Educated to high school level (finding); Transport problem (finding); Victim of intimate partner abuse (finding); Lack of access to transportation (finding); Prediabetes (finding); Anemia (disorder); Limited social contact (finding); Past pregnancy history of miscarriage (situation); Full-time employment (finding). A pencil edit control is visible and was not clicked.

## Medications
The card shows one long medication string, beginning with a multi-strength dienogest/estradiol valerate pack. The string is visibly truncated in the card. No columns are shown. A pencil edit control is visible and was not clicked.

## Prescriptions
The expanded table has columns `Drug`, `Details`, `Qty`, `Refills`, and `Filled`. It displays 7 rows. Every visible quantity is `1.00`, every refill count is `0`, and the fill dates range from 2016-02-22 to 2026-06-25. Drug names can be long and are clipped/wrapped within the table. A pencil edit control is visible and was not clicked.

## Care Team
The card is present. No care-team member rows or member names are visible in the user-facing card. Automated capture found the card and an 8-column table header (`Type`, `Member`, `Role`, `Facility`, `Since`, `Status`, `Note`, `Remove`), but no existing members. No edit control was clicked.

## Patient Notes
No card titled “Patient Notes” was visible. The “Messages” card states “There are no messages on file for this patient. To add messages, please click here.” Automated capture classified notes as missing. The add link was not clicked.

## Empty state
Not observed: the empty-state PID was not supplied. A direct navigation to PID 12 returned `HTTP ERROR 400` after the browser session changed, so it is not evidence of an empty-state patient.

## Other cards on the page
Automated capture found these 22 cards: Allergies, Medical Problems, Medications, Prescriptions, Care Team, Treatment Intervention Preferences, Care Experience Preferences, Demographics, Billing, Insurance, Messages, Patient Reminders, Disclosures, Amendments, Labs, Vitals, Patient Portal / API Access, Clinical Reminders, Recall, Appointments, Health Concerns, and Immunizations.

Visible details beyond the required cards: Appointments says “No Appointments” and “No Recurring Appointments”; Health Concerns says “Nothing Recorded”; Immunizations lists three “Influenza, seasonal, inj” rows and one Td row. The Vitals card shows height `158.5 in (402.60 cm)`, temperature `41.42791 F (5.24 C)`, pulse `136 per min`, respiration `32 per min`, and BMI `27 kg/m^2`; the displayed height and temperature units/values look anomalous, but this is synthetic data. Several cards are collapsed by default. Patient Reminders and Clinical Reminders still showed “Loading...” in capture.

## Performance (from summary.json, plus what it felt like)
Automated probe made 3 dashboard loads: network-idle times were 5,229 ms, 4,440 ms, and 3,869 ms; DOM content loaded in 3,505 ms, 2,708 ms, and 2,724 ms. Each load transferred 167 KB across 18 resources. The page felt quick after navigation, but some card content remained asynchronous/loading. FHIR metadata returned HTTP 200 with FHIR version 4.0.1.

## Errors and oddities
Automated probe recorded 9 browser console errors and 0 failed requests. The repeated errors were `TypeError: top.restoreSession is not a function` (6) and `TypeError: Cannot read properties of undefined (reading 'setPatient')` (3). The login also displayed an OpenEMR Product Registration / anonymous telemetry prompt. The normal Finder tab showed a blank content area in the manual session; a later login prompt obstructed further Finder navigation, and no settings or patient data were changed. During direct PID 7 display, the PHP log's latest entries were three repeated `safe_href(): blocked disallowed URL scheme` warnings for `javascript`.

## Things to be careful about when porting
Keep patient identity visible while scrolling; the current page title contains only the patient's name. Preserve the distinction between an empty allergy list (“Nothing Recorded”), an empty Messages card, a card still loading, and a missing card. Long medication names and prescription rows need a deliberate overflow/wrapping behavior. Confirm whether Patient Notes means the current Messages card or another UI/API resource; the automated probe did not identify a notes card. Treat the displayed vitals as synthetic fixture values, not a clinical baseline.

## Open questions for David
- What empty-state PID did `phase0-setup.ps1` report? The automated probe currently contains only PID 7.
- Should Patient Notes map to the Messages card, or is another visible dashboard section intended?
- Can the normal Finder route be rechecked after the Product Registration prompt is handled by the owner?
