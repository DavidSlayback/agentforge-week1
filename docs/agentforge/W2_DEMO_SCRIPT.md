# W2 early submission demo script

Target: 3–5 minutes. Record the deployed W2 page in Chrome. Use the page's
generated sample PDFs for the walkthrough.

## Before recording

- In Chrome's address bar, open the [W2 demo page](https://dtstest.64.177.10.182.nip.io/agentforge-w2/).
  Confirm the page title is “Prepare for visit.”
- Scroll to “Completed synthetic PDF samples.” Click the linked title
  **Lab result · Layout B** (not its **Run this sample** button). Confirm Chrome
  downloads `agentforge-lab-b-synthetic.pdf`.
- Click the linked title **Patient intake · Layout B** (not its button). Confirm
  Chrome downloads `agentforge-intake-b-synthetic.pdf`.
- Return to the top of the page. During the recording, select these downloaded
  files in the browser's upload control to show the actual upload path.
- Close unrelated tabs and hide desktop notifications. Record the Chrome window.

## 0:00–0:35 — Establish the Week 1 baseline and Week 2 delta

**Action:** Show the “Prepare for visit” heading and the patient-context and
read-only labels. Scroll down past “Visit orientation” and “Scan form workflow”
until the “Completed synthetic PDF samples” heading and sample cards are visible.

**Say:**

> “Week 1 established the return-visit workflow: prepare a briefing from
> patient-scoped chart evidence, keep chart access read-only, and leave clinical
> judgment with the clinician. Week 2 extends that workflow to source documents.
> The new problem is turning a lab PDF or intake form into reviewable facts that
> can be used alongside the existing visit context.”

## 0:35–1:55 — Upload a lab PDF and follow the new pipeline

**Action:** Scroll to **Scan form workflow**. Leave **Document schema** set to
**Lab scan PDF**. Click the **Filled synthetic PDF or text fixture** file
control. In Downloads, select `agentforge-lab-b-synthetic.pdf` and confirm the
file selection. Click **Read filled form** once. Wait for the status line below
that button to say the workflow completed. Keep the line visible.

**Expected screen:** `READY`; 12 cited fields; summary names
`scan-form-extraction-worker` and `evidence-retrieval-worker`; extractor
`tesseract-local-pdf`.

**Say:**

> “Week 2 adds a document path beside the Week 1 visit workflow. The extraction
> worker converts the page into typed lab fields and retains the quote, page,
> and region for review. The retrieval worker separately finds a relevant
> guideline passage. The supervisor combines their typed outputs and only marks
> the workflow ready when both contracts pass. Keeping extraction and retrieval
> separate makes a bad OCR field distinguishable from missing guideline
> support, and lets us replace either adapter without changing the supervisor.”

**Action:** In the **Guideline evidence** row just below the upload status, click
the row to expand it. Point to the guideline title, section, quoted passage, and
source identifier.

**Action:** In the same status line below **Read filled form**, click the
**Open source preview** link. It opens in a new tab. Point to one field's value,
source quote, page number, and region coordinates.

**Say:**

> “The guideline passage is a separate source from the uploaded document. The
> evidence panel shows exactly what retrieval returned; the source preview lets
> us inspect the extracted field against the page itself. Unsupported or
> uncertain values remain qualified for review. This run uses local Tesseract
> OCR, so there is no hosted model call in this document path.”

**Action:** In the same status line below **Read filled form**, click **Open
source preview**. It opens in a new tab. Point to one field's value, source
quote, page number, and region coordinates.

## 2:05–2:45 — Upload the second document type

**Action:** In the source-preview tab, click **← Return to visit workspace** at
the top of the page. In **Scan form workflow**, open **Document schema** and
select **Patient intake form**. Click **Filled synthetic PDF or text fixture**.
In Downloads, select `agentforge-intake-b-synthetic.pdf` and confirm the file
selection. Click **Read filled form** once. Wait for the completion status line
below that button.

**Expected screen:** `READY` with cited intake fields.

**Say:**

> “The intake PDF goes through the same supervisor and citation path. Its schema
> captures the visit reason and documented history. The query selects the
> medication-reconciliation guideline, and the evidence panel makes that
> retrieved support inspectable next to the extracted source.”

## 2:45–3:25 — Show how the eval gate protects the addition

**Action:** Scroll to the bottom of the main page. Click the collapsed
**Evaluator notes** row to expand it. Click the **Open evaluator panel** link
inside the expanded notes. Pause on the W2 regression gate.

**Expected screen:** 50/50 cases passed across schema validity, citation
presence, factual consistency, safe refusal, and `no_phi_in_logs`.

**Say:**

> “We extended the Week 1 evaluation seam with a Week 2 gate for the new
> document and evidence contracts. It checks that outputs match the schema,
> cite their sources, stay consistent with the fixture, qualify unsupported
> cases, and keep sensitive content out of traces. The saved result is fifty
> synthetic regression cases; it is evidence about this gate, not a general
> accuracy score for every form.”

## 3:25–4:35 — Show operations and close

**Action:** Use the browser Back button to return to the main page. Scroll to the
bottom and click **Evaluator notes** to expand it. Click **Open operations
dashboard** inside the expanded notes. Point to **Requests**, **Retrieval
attempts**, **p95 latency**, and both **Scanned documents** rows under **Recent
redacted traces**. Point to each row's stages and guideline-hit count.

**Say:**

> “Each upload records OCR preparation, extraction, retrieval, worker handoffs,
> guideline hits, and duration in a redacted trace. This dashboard snapshot
> includes the initial visit preparation and both scans; the scan rows show the
> document stages and each retrieved three guideline sources. The scan rows
> show no model call because OCR and guideline retrieval run locally. In this
> capture the p95 alert is triggered: local OCR took about seven seconds, above
> the dashboard's generic two-second threshold. We have not set an OCR-specific
> latency target yet. The 50-case result is a saved regression score, not an
> encounter score. W2 stays on its own route, and this early slice does not
> round-trip documents or extracted facts through OpenEMR.”

## After recording

- Play the full video. Confirm it shows the actual file selection and **Read
  filled form** action for each PDF, each run shows guideline evidence, the Lab
  B run shows both workers, `READY`, and 12 cited fields, the source preview
  shows quotes and region coordinates, the evaluator shows its saved 50/50
  result, and the operations page shows the two fresh redacted scan traces.
- Check that the Chrome window is legible, the audio is usable, and the runtime
  is between 3 and 5 minutes.
- Record the video's location and duration in the submission package.

## Evidence boundary

Before recording, confirm the deployed commit and perform both browser uploads.
The trace sink is in-memory on the isolated W2 container and resets on restart;
record the uploads first, then open the dashboard during the same run. If the
fresh traces are missing, stop and repair the release rather than narrating
metrics that are not on screen. The 50/50 result is from the saved synthetic
regression gate. This candidate does not establish arbitrary scan accuracy,
hosted-provider quality, or OpenEMR persistence.
