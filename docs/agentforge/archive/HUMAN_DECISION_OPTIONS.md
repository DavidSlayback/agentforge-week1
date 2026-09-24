# Human decision options

Date: 2026-09-22
Scope: decisions currently blocking promotion from local synthetic proof to external/provider/runtime or public evidence.

These are decision boundaries, not implied authorizations. A choice here mus
name the allowed data class, destination, model/tool, retention/contrac
assumptions, budget, and stop condition.

## 1. Scan-form extraction runtime

| Option | What it proves | Advantages | Costs / risks |
| --- | --- | --- | --- |
| A. Stay synthetic/provider-neutral | Contract behavior only | Zero data egress; fastest; current 109/109 and 50/50 evidence remains stable | Does not prove real PDF/OCR/VLM performance or satisfy the anti-synthetic extraction requirement by itself |
| B. Local classical OCR baseline: Tesseract plus OCRmyPDF | Real OCR text and coordinates on the sourced PDFs | No external data transfer; reproducible; low operating cost; Tesseract can emit hOCR/PDF coordinates and OCRmyPDF adds a searchable text layer ([Tesseract docs](https://tesseract-ocr.github.io/tessdoc/), [OCRmyPDF docs](https://ocrmypdf.readthedocs.io/en/latest/)) | Weaker at layout semantics, checkboxes, handwritten marks, and field/value association; needs our own label mapping |
| C. Local layout/VLM: PaddleOCR PP-Structure/PaddleOCR-VL | Real layout-aware form parsing with local model execution | Better fit for varied forms, tables, and selection marks; supports structured document parsing ([PaddleOCR docs](https://www.paddleocr.ai/main/en/), [document-parsing skill](https://github.com/PaddlePaddle/PaddleOCR/blob/main/skills/paddleocr-doc-parsing/SKILL.md)) | Larger install/model footprint; GPU/CPU latency and memory need measurement; model/license and reproducibility must be pinned |
| D. Managed document AI: Google Document AI, AWS Textract, or Azure Document Intelligence | External service quality and production-shaped bounding-box/field output | Purpose-built form parsing: KVPs, tables, selection marks, and geometry are documented by [Google](https://docs.cloud.google.com/document-ai/docs/form-parser), [AWS](https://docs.aws.amazon.com/textract/latest/dg/how-it-works-kvp.html), and [Azure](https://learn.microsoft.com/en-us/azure/applied-ai-services/form-recognizer/concept-general-document) | Documents leave the host; requires provider/data-processing approval, region/retention review, credentials, cost controls, and failure fallback |
| E. Hosted multimodal LLM as primary extractor | Flexible visual interpretation and semantic normalization | Handles unusual layouts and ambiguous text; can reuse the existing provider seam | Less deterministic; bounding boxes and empty-field behavior need strict validation; highest prompt/model drift and data-processing risk |
| F. Hybrid: local OCR/layout first, external model only for approved redacted crops or text | Layered quality and reduced egress | Local baseline remains usable; external model handles only hard cases; clearer audit boundary | Most engineering complexity; crop/redaction errors can leak data; two latency/cost paths |

### Recommendation

Use **B as the measurable deterministic baseline** and keep a local VLM
second-pass lane behind the same contract. The owner-approved free experimen
is now the larger official `PaddleOCR-VL-1.6-GGUF` on ambiguous crops; the
small SmolVLM result was insufficient. Keep D/E/F behind explicit approval.
The larger model stays local for now; the eventual API/managed migration can
replace the runner without changing the worker contract.

**Decision recorded 2026-09-22:** accepted. Deterministic tools remain the
initial baseline; a larger free local VLM is the bounded second-pass experiment;
bounded multi-agent workers remain required; the eventual production shape may
use API or managed access behind the same adapter. No hosted provider, PHI, or
production writeback is authorized by this decision.

### Small laptop VLM profile

| Candidate | Laptop trade-off | Role | Recommendation |
| --- | --- | --- | --- |
| SmolVLM-256M-Instruct-GGUF Q8 | Smallest practical local option; measured 0/8 on typed crop values in this corpus | Rejected for field extraction; retain only as an experiment | **Rejected** |
| PaddleOCR-VL-1.6-GGUF | Official document-focused local model; ~933 MB model plus ~882 MB projector; CPU-only runtime loaded successfully | Stronger visual reader, but structured output needs a parser/grammar layer and latency varies by crop | **Selected free experiment; not promoted yet** |
| SmolVLM2-2.2B | More capable general multimodal model; model files are multi-GB and unsuitable for the small-laptop target | Research comparison only | Defer |
| API/managed document AI or VLM | Easiest scale and likely end state; documents leave the laptop and require provider, retention, cost, and data-processing approval | Production candidate | Later, behind approval |

The free local candidates were exercised before any paid selection. The larger
PaddleOCR-VL runtime loaded locally and recovered 8/8 synthetic values as raw
text, but failed the structured extraction gate at 0/8; no paid model has been
selected or purchased.

SmolDocling-256M was also attempted as a free document-focused alternative;
the laptop runner could not use its official checkpoint, and a small GGUF
conversion was unusable. It was removed from the laptop runtime.

### Managed VLM choices if the local typed gate remains insufficien

| Option | Evidence/trade-off | Current boundary |
|---|---|---|
| Continue local PaddleOCR-VL plus deterministic OCR | No document egress or API spend; current typed run is 0/8, raw-text matches do not qualify, and 2.05–20.96s/crop is laptop evidence only | Safe default while parser/model work continues |
| Gemini Developer API free tier | Lowest cost for eligible models and synthetic-only feasibility; unpaid-service data may be used for product improvement and human review | Public blank/synthetic corpus only; no personal, sensitive, or confidential data |
| Gemini Developer API paid tier | Current docs list model-dependent published token rates; Gemini 3.8 Flash introductory text rates are $0.75/1M input and $3.75/1M output through 2026-12-31, then $1.50/$7.50; exact image cost depends on image tokens | Capped synthetic pilot only after account, region, retention, and spend review |
| OpenAI API vision model | Current GPT-4.1 mini page lists image input, structured outputs, and $0.40/1M input plus $1.60/1M output text rates; default abuse-monitoring retention is up to 30 days, with endpoint-specific controls | Capped synthetic pilot only; calculate from actual image-token usage and verify endpoint state/retention |
| Vertex AI / enterprise-managed service | More configuration/contract options for region, retention, and processing; zero-retention claims depend on service configuration and terms | Consider if managed controls become requirements; setup and billing overhead; confirm exact product terms |
| Self-host on deployment VM | Avoids third-party form transfer and token billing | Requires compute sizing, package/runtime ownership, monitoring, security, and rollback |
| Hybrid local OCR plus approved VLM crops | Can reduce calls and egress while preserving local fallback | Highest routing complexity; a crop may still identify a person and is not automatically de-identified |

Official research snapshot 2026-09-22: [OpenAI GPT-4.1 mini model/pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini unpaid-service terms](https://ai.google.dev/gemini-api/terms), and [Vertex zero-data-retention guidance](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention). No provider, budget, model, or data transfer was approved or selected.

## 2. OpenEMR round-trip scope

| Option | Data scope | Advantages | Costs / risks |
| --- | --- | --- | --- |
| A. Synthetic adapter only | Existing fixtures | Safest; already tested; no deployment dependency | Does not prove intended-client OpenEMR persistence/readback |
| B. Local OpenEMR with synthetic seeded patients | No PHI; local runtime | Best next evidence: real HTTP/session/readback/deduplication without PHI | Setup and runtime debugging; still not production identity/compliance proof |
| C. Deployed OpenEMR with synthetic data | No PHI; owner-authorized staging | Proves external client, routing, TLS, runtime identity, and readback | Public exposure, operational cost, candidate drift, and stronger release discipline |
| D. Real/production OpenEMR or PHI | PHI/production | Highest realism | Requires privacy/security review, contractual authorization/BAA where applicable, access approval, retention/incident plan, rollback, and clinical owner sign-off; currently outside scope |

### Recommendation

Choose **B**, then optionally **C** for submission evidence. Keep D blocked.

## 3. Form-copy and redistribution rights

| Option | What is checked in | Advantages | Costs / risks |
| --- | --- | --- | --- |
| A. URL/hash manifest only | No third-party PDFs | Lowest redistribution risk; reproducible retrieval record | Reviewers may not have stable access; source URLs can change |
| B. Keep downloaded PDFs private/internal | Actual PDFs remain local, not public | Best extraction convenience while limiting distribution | Does not solve rights for a public repository or submission artifact |
| C. Obtain written permission from each practice/agency | PDFs plus permission record | Strongest provenance and redistribution posture | Time and external coordination; permission may be refused or limited |
| D. Replace with clearly licensed/public-domain forms | Public-domain or explicitly open-license PDFs | Cleanest public release story | May reduce layout variety or clinical realism; U.S. government status does not automatically cover state or third-party works ([U.S. Copyright Office](https://www.copyright.gov/title17/92chap1.html)) |
| E. Create independent derived forms | New forms with similar field concepts but original layout/text | Full control and no source-copy dependency | Returns toward synthetic data; too-close copying can still create derivative-work concerns |

The UK government states that OGL reuse is the default for Crown material bu
third-party material and logos are excluded; the source page must identify the
license ([National Archives](https://www.nationalarchives.gov.uk/terms-and-conditions/copyright/)).
The NHS practice forms sourced here do not state an explicit reuse license.

### Recommendation

Use **B for local evaluation now** and **A or D for public release**. Do no
claim the four downloaded PDFs are freely redistributable merely because they
are public URLs.

## 4. Deployment and external proof

| Option | Advantages | Costs / risks |
| --- | --- | --- |
| A. Local-only evidence | No external exposure; fastest iteration | Cannot prove public routing, TLS, deployed identity, or clean-browser behavior |
| B. Synthetic staging deployment | Real external-client evidence without PHI | Requires target, credentials, budget, candidate identity, and rollback owner |
| C. Public submission deployment with synthetic data | Strongest demo/submission evidence | Publication risk, ongoing cost, security maintenance, and stale-candidate risk |
| D. Production/PHI deployment | Real product validation | Not authorized by current scope; requires the full clinical/privacy/release gate |

### Recommendation

Use **B** for the next verification checkpoint. Promote to C only after the
candidate identity, URL, observability, and submission custody are read back.

## 5. Jev/provider promotion

| Option | Advantages | Costs / risks |
| --- | --- | --- |
| A. Keep deterministic supervisor as baseline | Reproducible, cheap, inspectable, no provider dependency | Less flexible; no claim of Jev/provider improvement |
| B. Continue authorized Qwen synthetic lane | Existing hosted synthetic evidence and realistic model path | Cost, retention, provider terms, and quality still require measurement |
| C. Add OpenRouter follow-up lane | Broad model choice and comparison | Additional external data path, spend, drift, and retention review |
| D. Run Jev as a parallel experiment | Measures whether orchestration improves quality/cost | Requires provider/key approval; no promotion until paired results show no safety/traceability regression |

### Recommendation

Keep **A as the release baseline**, use B/C only for synthetic comparison, and
run D only as a bounded experiment with a fixed corpus and spend cap.

## 6. Demo, submission, publication, and interviews

These are owner actions, not agent defaults.

- **Private checkpoint:** prepare artifacts and a demo script; no public post or submission.
- **Internal review:** owner records or presents the demo; assistant prepares evidence and talk track.
- **Public submission:** owner approves exact URL, revision, files, and claims before submission.
- **Social/publication:** owner approves audience, wording, links, screenshots, and source-form reuse.
- **Interviews/email follow-up:** owner schedules, attends, and sends; assistant can prepare drafts.

## Decisions needed nex

The smallest safe next approval is:

1. Permit **local OCR baseline B** on the four blank public forms only.
2. Permit **local synthetic OpenEMR round-trip B**.
3. Choose **private/internal form copies** versus URL/hash-only or rights-cleared public copies.
4. Name whether the next deployment is local-only or synthetic staging.

No PHI, production OpenEMR, clinical writeback, or public publication is
included in those four approvals.
