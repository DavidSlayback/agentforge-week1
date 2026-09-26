# E4, E5 and E8: observed on the public URL

Each observation is valid only for the W2 SHA it names (`/agentforge-w2/health`). E7 repeats all of them on the freeze SHA. Synthetic data only; the seeded patient is `fixture-patient-001` (OpenEMR pid 1).

## X-3 `medication_list` (E4)

- **Deployed W2 SHA:** `d952660b` (MR !101), 2026-09-26.
- **Flow:** the public UI's "Medication list · Layout A → Run this sample" (synthetic `filled-medlist-a.pdf`).
- **Seen:** final state READY, 19 cited fields, critic `reviewed`. Medication 3 appeared as a cited claim. Medications 1 and 2 went to "Needs review" (low OCR confidence), not into claims.
- **OpenEMR ledger** (read-only SQL): a `doc:medication_list` write for pid 1 at 2026-09-26 14:11:34 UTC, then `doc:derived_facts` at 14:11:53 UTC. No OpenEMR restart was needed for the new document type.
- **Offline regression cover:** 15 `x3-*` extension cases (`E4-medlist-regression.txt`).

## X-4 lab trend chart (E5)

- **Deployed W2 SHA:** `e0f9eb35` (MR !102), 2026-09-26.
- **Flow:** "Lab result · Layout A → Run this sample", then "Layout C" (an earlier lab B upload was already stored for the same patient).
- **Seen:** a "Lab trends" section reading "Read from OpenEMR's FHIR Observation service (read back after the upload)", with 2 SVG charts:
  - A1C: 2026-06-18 6.8 %, 2026-09-20 6.1 %, 2026-09-21 7.2 %. Its reference range "under 5.7" is shown as not parseable, so no band is drawn.
  - Hemoglobin: 12.4, 13.2 and 11.9 g/dL (11.9 flagged abnormal), each with a 12–16 reference band.
  - Each point links to its source document.
- **Offline regression cover:** 5 `x4-*` extension cases (`E5-lab-trend-regression.txt`).

## E8 W1 trust fixes

- **Deployed W2 SHA:** `fd6c959b` (MR !103), 2026-09-26 (deployed 09:36 CT).
- **Chart-fact label:** chart facts in the answer are labeled "[Synthetic chart fixture]"; before E8 they read "[OpenEMR chart record]".
- **p95 alert:** `GET /agentforge-w2/v1/alerts` reports `p95_latency` with threshold 30000 ms and observed 21228 ms, not triggered.
- **Offline regression cover:** `E8-w1-trust-regression.txt` (including extension case `x8-scope-other-patient-question`).

## Production ledger check

A read-only query of the production OpenEMR AgentForge write ledger (2026-09-26) found every AgentForge write is for pid 1, and no cross-patient lab rows.
