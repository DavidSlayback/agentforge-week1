# Clinical Guideline Corpus

`corpus.json` is a real, verbatim clinical-guideline text corpus for AgentForge's
RAG system, built for a primary-care follow-up visit scenario (labs: A1C/diabetes,
lipids/cholesterol, blood pressure, hemoglobin/anemia, kidney function; plus intake
concerns like fatigue and medication reconciliation).

**This replaces the earlier synthetic 3-chunk placeholder corpus. That placeholder
must not be used in production** — it was invented text, not real guideline
content.

## What's in it

47 chunks. Each chunk's `text` field is a **verbatim excerpt** copied word-for-word
from a real, live, public page — never paraphrased, summarized, or invented. The
exact source URL, page section, and the date/version the source page itself states
(publication date, "Last Reviewed", "Date Last Updated", etc. — `"undated"` only
where the page genuinely states no date) are recorded per-chunk in `corpus.json`.
All chunks were retrieved 2026-09-24 (`retrieved_at`).

Some excerpts are single short sentences (as few as ~10 words) rather than padded
to a target length — this is intentional: the alternative would be joining
unrelated sentences or adding connective text that is not in the source, which
would break the verbatim guarantee.

## Sources and public-domain / reproduction basis

| Publisher | Basis for reproduction | Chunks |
|---|---|---|
| **USPSTF** (U.S. Preventive Services Task Force) | Recommendation statements are public and freely reproducible with attribution | 7 |
| **CDC** (Centers for Disease Control and Prevention) | Work of the U.S. federal government; public domain domestically (17 U.S.C. §105) | 9 |
| **NIDDK** (National Institute of Diabetes and Digestive and Kidney Diseases, NIH) | Work of the U.S. federal government; public domain domestically | 5 |
| **NHLBI** (National Heart, Lung, and Blood Institute, NIH) | Work of the U.S. federal government; public domain domestically | 6 |
| **MedlinePlus** (National Library of Medicine, NIH) | Work of the U.S. federal government; public domain domestically | 20 |

Every chunk still carries its own `url` in `corpus.json` for attribution and
traceability back to the live page it was copied from.

## Topics covered

- Diabetes / prediabetes screening, A1C interpretation and diagnostic ranges,
  testing frequency (USPSTF, CDC, NIDDK, MedlinePlus)
- Lipids / cholesterol, statin-use recommendations by age and CVD risk (USPSTF,
  NHLBI, MedlinePlus)
- Hypertension / blood pressure screening, definitions, categories, symptoms
  (USPSTF, CDC, NHLBI, MedlinePlus)
- Anemia / hemoglobin, including fatigue as a presenting symptom (MedlinePlus)
- Kidney function: eGFR, creatinine, kidney test overviews (NIDDK, MedlinePlus)
- Medication reconciliation / medication safety (CDC, MedlinePlus)

## Notes on retrieval

All 25 source URLs listed in `corpus.json` were successfully fetched. A small
number of NIDDK professional/clinical-tool pages on kidney disease (e.g. the CKD
evaluation page) were fetched but not used for chunks because their visible text
was list/bullet fragments rather than clean, self-contained sentences suitable for
a verbatim excerpt; a cleaner NIDDK page (Laboratory Evaluation of Kidney Disease)
was used instead. No source was fabricated or substituted with paraphrased text.
