# Clinical Guideline Corpus

`corpus.json` is a real, verbatim clinical-guideline text corpus for AgentForge's
RAG system, built for a primary-care follow-up visit scenario (labs: A1C/diabetes,
lipids/cholesterol, blood pressure, hemoglobin/anemia, kidney function; plus intake
concerns like fatigue and medication reconciliation).

**This replaces the earlier synthetic 3-chunk placeholder corpus. That placeholder
must not be used in production** — it was invented text, not real guideline
content. It now lives in `src/guidelineEvidence.js` as `SYNTHETIC_COHERE_CORPUS`,
clearly named and confined to the (currently unused) Cohere retriever lane's own
tests.

## What's in it

42 chunks. Each chunk's `text` field is a **verbatim, contiguous excerpt** copied
word-for-word from a single real, live, public page — never paraphrased,
summarized, spliced from non-adjacent parts of a page, or invented. Every chunk
was checked against a live re-fetch of its source page to confirm the exact text
appears as one unbroken span. The exact source URL, page section, and the
date/version the source page itself states (publication date, "Last Reviewed",
"Date Last Updated", etc. — `"undated"` only where the page genuinely states no
date) are recorded per-chunk in `corpus.json`. Chunks were retrieved 2026-09-24
and 2026-09-25 (`retrieved_at`, per chunk).

Some excerpts are single short sentences, or end mid-sentence, rather than padded
to a target length. Two causes:

- The alternative to a short excerpt would be joining unrelated sentences or
  adding connective text not in the source, which would break the verbatim
  guarantee.
- A few source pages inject an inline citation-footnote marker (e.g. a bare `1`)
  or a glossary tooltip's popup text directly into the page's own extracted text,
  between two sentences that read as contiguous prose. Where that marker itself
  falls inside a chunk, it is kept exactly as extracted (verbatim over tidy);
  where it falls at a natural chunk boundary, the chunk simply ends there rather
  than continuing across it.

Two chunks that were originally reformatted diagnostic-range/category **tables**
into a slash- or comma-separated summary were removed rather than kept in a form
that was not an exact, contiguous rendering of the source page's own text (S5
review finding). No table content is quoted in this corpus.

## Sources and public-domain / reproduction basis

| Publisher | Basis for reproduction | Chunks |
|---|---|---|
| **USPSTF** (U.S. Preventive Services Task Force) | Recommendation statements are public and freely reproducible with attribution | 7 |
| **CDC** (Centers for Disease Control and Prevention) | Work of the U.S. federal government; public domain domestically (17 U.S.C. §105) | 9 |
| **NIDDK** (National Institute of Diabetes and Digestive and Kidney Diseases, NIH) | Work of the U.S. federal government; public domain domestically | 4 |
| **NHLBI** (National Heart, Lung, and Blood Institute, NIH) | Work of the U.S. federal government; public domain domestically | 8 |
| **MedlinePlus** (National Library of Medicine, NIH) — **NLM-authored pages only** | Work of the U.S. federal government; public domain domestically | 14 |

Every chunk still carries its own `url` in `corpus.json` for attribution and
traceability back to the live page it was copied from.

### MedlinePlus: NLM-authored pages only, never `/ency/` A.D.A.M. content

MedlinePlus's own Medical Encyclopedia (`medlineplus.gov/ency/article/*` and
`medlineplus.gov/ency/patientinstructions/*`) is licensed from A.D.A.M., Inc., not
authored by NLM, and its terms prohibit redistribution/duplication. An earlier
version of this corpus included 7 chunks from three `/ency/` pages (an anemia
article and two patient-instruction pages); **all 7 were removed** (S5 review
finding) and are not present in `corpus.json`. Every MedlinePlus chunk now in this
corpus comes from an NLM-authored page: a `medlineplus.gov/lab-tests/*` page, a
plain topic page (`prediabetes.html`, `highbloodpressure.html`, `kidneytests.html`,
`medicines.html`), which are NLM's own public-domain content, not the licensed
encyclopedia. The two removed anemia chunks were replaced with real, verbatim,
public-domain NHLBI content on the same topic
(`nhlbi.nih.gov/health/anemia/iron-deficiency-anemia`); the removed
medication-list chunks are not directly replaced 1:1 — medication-list/reconciliation
coverage comes from the two CDC `medication-safety` chunks plus one new
MedlinePlus `medicines.html` chunk.

## Topics covered

- Diabetes / prediabetes screening, A1C interpretation and diagnostic ranges,
  testing frequency (USPSTF, CDC, NIDDK, MedlinePlus)
- Lipids / cholesterol, statin-use recommendations by age and CVD risk (USPSTF,
  NHLBI, MedlinePlus)
- Hypertension / blood pressure screening, definitions, hypertensive-crisis
  guidance (USPSTF, CDC, NHLBI, MedlinePlus)
- Anemia / iron-deficiency anemia, including fatigue as a presenting symptom
  (NHLBI)
- Kidney function: eGFR, creatinine, kidney test overviews (NIDDK, MedlinePlus)
- Medication safety / keeping a medicine list (CDC, MedlinePlus)

## Verifying this corpus

Every chunk's `text` is checked against a live re-fetch of its `url` for exact,
contiguous verbatim inclusion (whitespace-normalized). Run
`node agentforge/scripts/verify-corpus.mjs` (network access required; not part of
the pre-commit hook) to re-run this check — it fetches all 25 unique source URLs
and reports `VERBATIM` or a mismatch per chunk.
