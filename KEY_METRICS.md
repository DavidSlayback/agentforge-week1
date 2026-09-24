# Key metrics: AgentForge Week 2

**User:** a primary-care physician preparing a follow-up visit. They have
structured chart data plus a newly uploaded lab PDF and a patient intake form,
and they ask: *what changed, what should I pay attention to, and what evidence
supports it?*

**What success means here:** the physician can rely on what the co-pilot says.
Every statement it shows is traceable to its source. Nothing unsupported
reaches the screen. It surfaces what in the new documents needs attention.
Speed matters, but it comes second to trust.

These are definitions and targets for a synthetic-data system. They are not
claims of clinical benefit. Every measured value names its **source**
(offline: the golden set and gate; live: deployed traces) and the **commit**
it was measured on. Week 1's metrics are frozen in
[`docs/agentforge/KEY_METRICS.md`](docs/agentforge/KEY_METRICS.md).

## North star: trust

> **Zero unsupported statements are shown, and 100% of shown statements click
> through to their source.**

| Metric | Definition | Target | Measured | Source |
|---|---|---|---|---|
| **Adversarial block rate** | Injected unsupported answer claims blocked before display, over a fixed probe set: invented value, misquoted field, value borrowed from another field, paraphrased guideline, patient fact cited to a guideline, treatment directive, low-confidence fact, unsupported negation or interpretation, uncited claim. | 100% | *pending* | `npm run eval:trust-probes --prefix agentforge` (offline). The gate also keeps its invented-claim case. |
| **Citation resolvability** | Displayed answer claims whose citation resolves to its exact source: a document field's bounding box on the rendered page, or a verbatim guideline chunk with its URL. | 100% | *pending* | The gate's answer checks (offline). Live: the source-preview box ids for each claim of a deployed scan. |

Why this is the north star: a confidently wrong clinical statement can harm a
patient. The verifier drops unsupported claims, so "share of shown claims that
verify" is 100% by construction and proves nothing. These two metrics can fail.
They measure whether the verifier *catches* bad claims, and whether the claims
it lets through really lead back to their evidence.

## Supporting metrics

| Metric | Definition | Target | Measured | Source |
|---|---|---|---|---|
| **Abnormal-finding recall** | Of the abnormal or flagged lab results and key intake items in the truth files (chief concern, current medications, allergies), the share that appear as verified answer claims *or* are listed under **needs review**. Silently dropping one counts as a miss. | ≥ 95% | *pending* | Golden set + truth files (offline). |
| **Extraction accuracy** | Typed lab fields matching the hand-written truth on value, unit, reference range, collection date **and** abnormal flag, plus intake fields matching the truth. Also reported: the share of fields routed to review. | ≥ 98% | *pending* | Gate `factually_consistent` cases over 10 golden PDFs (offline). |
| **Model grounding rate** | Raw model answer claims that pass verification before anything is dropped. Reported together with the **composer fallback rate** (answers that fell back to the deterministic template). | ≥ 80% grounded; ≤ 20% fallback | *pending* | Live traces with the chosen answer model. If either target is missed, that triggers switching from Qwen to OpenRouter. |
| **Time to grounded answer** *(optional)* | p50 and p95 from upload to grounded answer, with per-stage durations (OCR, retrieval, answer). | p95 ≤ 30 s | *defined, unmeasured until the provider is chosen* | Live traces (`/v1/traces` stage timings). |

Why these: **recall** asks whether it finds what matters. **Accuracy** asks
whether what it read is right. **Grounding rate** asks whether the model's
answers are useful, and not mostly fallback templates. **Speed** asks whether
it fits the minutes before the physician walks in. Cost per encounter is
recorded in traces (`modelTotals.cost_usd`). It is reported with the latency
numbers once the provider is chosen.

## Guardrails (must hold at all times)

| Guardrail | Required | Evidence |
|---|---|---|
| Raw PHI in logs and traces (names, DOB, phone, document text, extracted values) | 0 | Gate `no_phi_in_logs` cases run real workflow traces and captured stdout/stderr; a key allowlist governs trace contents. |
| Fail-loud on unsafe inputs (wrong patient, wrong document type, unreadable file, zero extracted fields) | 100% refused or qualified | Gate `safe_refusal` cases; fail-loud unit tests. |
| Cross-patient access to documents, page images and answers | 0 | Scope tests, including a cached page-image read with another patient's token; module attack checks (8/8 live). |
| Duplicate OpenEMR writes when the same document is re-uploaded | 0 | Live OpenEMR smoke: same ids on re-upload, no new rows (48/48 checks). |
| Injected regressions blocked by the eval gate alone | 29/29 | [`W2_REGRESSION_MATRIX.md`](docs/agentforge/evidence/W2_REGRESSION_MATRIX.md), re-run with `node agentforge/scripts/run-regression-matrix.mjs`. This is an engineering guardrail: it proves the gate works. It is not a product outcome. |

## Measurement record

Values are filled in only from a named command run on a named commit. This
file is updated when the release commit is frozen.
