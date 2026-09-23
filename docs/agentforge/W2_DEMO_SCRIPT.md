# W2 browser demo recording script

Target: 3–4 minutes, recorded from the deployed browser page. Use only the
completed synthetic PDF samples. Provider selection and recording are still
open; this demonstrates local OCR, not a selected VLM.

> Record only after checking that the public page exposes all four completed
> PDF samples and the matching candidate has passed the deployed upload path.
> The rasterized samples are clean generated pages, not physical scans.

## Before recording

- Open <https://dtstest.64.177.10.182.nip.io/agentforge-w2/> in the browser.
- Confirm the patient picker shows a synthetic fixture and the page badge says
  “Synthetic demonstration only.”
- Choose “Run this sample” under a completed synthetic PDF. For a 3–4 minute
  run, use one lab and one intake sample. Do not upload personal forms.
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

[Tap “Run this sample” under Lab result · Layout A. Pause on the worker names
and final state. Open the source preview.]

“This completed lab PDF is generated with fictional values. Local Tesseract
reads the test name, value, unit, reference range, collection date, and
abnormal status. Each accepted field links to its page region; the evidence
worker then checks for relevant support.

The page shows the worker handoffs and the final workflow state. In the preview,
each accepted value points back to its source and region. This demo uses local
OCR. We have not selected a hosted VLM, and the clean generated sample does not
establish real scanned-form accuracy.”

## 1:35–2:15 — Intake form

[Return to the page and tap “Run this sample” under Patient intake · Layout A.
Open its source preview.]

“The second assignment type is a patient intake form. This example includes
demographics, the reason for visit, medications, allergies, and family history.
The workflow keeps the same source and review trail.”

## 2:15–2:35 — Public source references

[Return to the main page. Open the FDA Form 3500 link and show the PDF title. If
time permits, return and show the CDC Form 50.34 source link and its legacy note.]

“These FDA and CDC links are reference examples only. The downloadable samples
above are the completed PDFs used by the synthetic extraction demo.”

## 2:35–3:05 — Evaluation and operations

[Open the evaluator panel, then the operations dashboard.]

“The synthetic regression gate covers schema validity, citations, consistency,
safe qualification, and log redaction. The operations page shows service health
and redacted operational measures. These checks describe this synthetic
candidate; they do not establish readiness for real patient data.”

## 3:05–3:25 — Close

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
