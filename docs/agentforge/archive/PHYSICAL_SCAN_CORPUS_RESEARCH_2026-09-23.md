# Harder synthetic scan corpus for AgentForge

**Research date:** 2026-09-23  
**Purpose:** Get beyond clean generated PDFs without printing or introducing real patient data.

## Recommended source: ClinOCR-Bench

[ClinOCR-Bench repository](https://github.com/ClinOCR-Bench/ClinOCR-Bench) and [Hugging Face dataset viewer/download](https://huggingface.co/datasets/ClinOCR-Bench/ClinOCR-Bench) provide 384 synthetic clinical document images paired with human-audited ground-truth transcriptions. The six subsets cover normal, handwriting-font, poor-quality/degraded, rotation, tables, and mixed artifacts. The hosted dataset is reported as 123 MB, MIT-licensed, and downloadable without special tooling.

The documents and patient-like content are generated; the dataset authors describe artifact simulation by printing/crumpling/copying/resolution reduction/rotation. This is a ready-to-download **synthetic scan-artifact benchmark**, not proof from genuinely camera-captured paper. It fits the project's synthetic-only boundary and avoids asking the user to print. It is the best immediate harder clinical input set. Start with one each from `poor`, `rotated`, `tables`, and `mixed`; retain only the images and expected ground truth needed for local evaluation. Do not send any examples to Google until key configuration is ready; if using Gemini, test only this public synthetic dataset and keep results/source citations local.

The repository says MIT, but retain its license and attribution if copying samples into the project. Source ground truth is full-document transcription rather than AgentForge's exact field/citation schema, so it can directly score OCR text quality; mapped extraction and citation boxes require a small manually checked subset.

## Other sources

| Source | What it provides | Fit / limitation |
|---|---|---|
| [FUNSD](https://guillaumejaume.github.io/FUNSD/) | 199 real noisy scanned forms with word boxes, question/answer labels, and linking annotations. | Best true scanned-form layout baseline. It is non-commercial research/education only; source scans may have identifying content and are not clinical. Keep out of hosted demo/provider calls unless separately cleared. |
| [NIST Special Database 2](https://www.nist.gov/srd/nist-special-database-2) | 5,590 completed binary form images from 900 simulated tax submissions, paired with answer text; no charge. | Synthetic and safe-looking complex-form OCR stress, but not genuinely scanned and not clinical. Useful for general form OCR, not the best next clinical test. |
| [MIDV-2020](https://l3i-share.univ-lr.fr/MIDV2020/midv2020.html) | Mock identity documents with scans, photos, and video. | Synthetic values and actual capture modalities, but not clinical forms and the reported 124 GB archive requires access request/licence acceptance. Too heavy for this checkpoint. |

## Suggested local evaluation

1. Use a small fixed ClinOCR sample across `poor`, `rotated`, `tables`, and `mixed`, with the dataset's ground truth.
2. Measure OCR character/word error and exact AgentForge field matches separately. Require each emitted value to have an exact source quote and a visually checked page box; otherwise abstain and mark human review.
3. Compare current local Tesseract path and Google Gemini on the exact same synthetic pages once the API key is available. Record model/version, latency, cost, invalid-schema rate, field accuracy, and citation-box accuracy. Keep the existing 38/38 clean-fixture result as a separate clean-input baseline.
4. Report ClinOCR results as a synthetic scan-artifact benchmark, not real-camera clinical accuracy. No source found here provides a small, open, genuinely camera-captured synthetic clinical form set that also matches AgentForge's lab/intake field schema.

## Evidence sources

- [ClinOCR-Bench dataset card](https://huggingface.co/datasets/ClinOCR-Bench/ClinOCR-Bench): 384 rows, 123 MB, subset definitions, synthetic-content methodology, ground truth, and MIT license.
- [ClinOCR-Bench repository](https://github.com/ClinOCR-Bench/ClinOCR-Bench): release/archive, annotations, and construction materials.
- [FUNSD official terms](https://guillaumejaume.github.io/FUNSD/work/): restrict use to non-commercial research/education and state images are real scanned forms whose further rights must be assessed.
- [NIST Special Database 2](https://www.nist.gov/srd/nist-special-database-2): free images and answer files for simulated completed forms.
