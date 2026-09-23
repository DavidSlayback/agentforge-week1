# W2 browser demo recording script

Target: 3–4 minutes, recorded from the deployed browser page. Use only the
synthetic sample. Provider selection and recording are still open; this script
describes the deployed candidate and does not claim VLM extraction.

> **Hold the recording if filled-form reading is a required demo claim.** The
> current button exercises a tagged synthetic text fixture. It does not upload
> or read a filled PDF. This script is for the existing worker workflow only
> until the PDF OCR/VLM path is implemented and measured.

## Before recording

- Open <https://dtstest.64.177.10.182.nip.io/agentforge-w2/> in the browser.
- Confirm the patient picker shows a synthetic fixture and the page badge says
  “Synthetic demonstration only.”
- Use the “Try the synthetic lab scan sample” button. Do not enter real or
  completed form data.
- If showing a real layout, open an official blank FDA or CDC PDF from the page
  in a separate tab. Return to the demo without uploading that PDF.
- Close unrelated tabs and hide notifications before capture.

## 0:00–0:30 — Scope

[Show the landing page and the synthetic patient context.]

“AgentForge is a synthetic clinical workflow demonstration. The page uses
fictional patient fixtures and requires clinician review. Today I’ll show a
small form extraction path, how its workers hand off typed evidence, and where
to inspect the source regions. No real patient information is used.”

## 0:30–1:35 — Run the sample

[Tap “Try the synthetic lab scan sample.” Pause on the worker names and final
state. Open the source preview.]

“I’m loading the sample included with the app. It contains two synthetic lab
fields. The extraction worker identifies those fields and their page regions;
the evidence worker then checks whether supporting evidence is available.

The page shows the worker handoffs and the final workflow state. In the preview,
each accepted value points back to its source and region. This is a controlled
text fixture that represents a scan layout. The deployed demo does not perform
general PDF OCR or VLM extraction.”

## 1:35–2:05 — Official source examples

[Return to the main page. Open the FDA Form 3500 link and show the PDF title. If
time permits, return and show the CDC Form 50.34 source link and its legacy note.]

“The links open actual forms at their agency sources, so a reviewer can inspect
real layouts. They are reference examples only: this app does not upload or
process them. The CDC page marks its 50.34 application for retirement in
October 2026.”

## 2:05–2:40 — Evaluation and operations

[Open the evaluator panel, then the operations dashboard.]

“The synthetic regression gate covers schema validity, citations, consistency,
safe qualification, and log redaction. The operations page shows service health
and redacted operational measures. These checks describe this synthetic
candidate; they do not establish readiness for real patient data.”

## 2:40–3:00 — Close

[Return to the landing page and hold on the sample and source links.]

“The demo’s scan path uses deterministic extraction and local evidence
retrieval. I have not selected a scan-form provider or VLM for the final
submission. That choice, along with any provider terms or data path, remains an
open decision.”

## After capture

- Play the entire recording and confirm the button, two worker handoffs, `READY`
  state, source preview citations, official PDF links, evaluation page, and
  operations page are legible.
- Confirm the recording contains only the demo browser and has usable audio.
- Record the file location, duration, and review result in the submission
  package. Do not describe the current script as a completed recording.
