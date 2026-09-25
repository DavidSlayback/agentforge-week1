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
| **Adversarial block rate** | Injected unsupported answer claims blocked before display, over a fixed probe set: invented value, misquoted field, value borrowed from another field, paraphrased guideline, patient fact cited to a guideline, treatment directive, low-confidence fact, unsupported negation or interpretation, uncited claim. | 100% | **100%** (10/10 blocked; 10/10 legitimate claims kept) | `npm run eval:trust-probes --prefix agentforge` (offline). The gate also keeps its invented-claim case. |
| **Citation resolvability** | Displayed answer claims whose citation resolves to its exact source: a document field's bounding box on the rendered page, or a verbatim guideline chunk with its URL. | 100% | **100% offline** (47/47 document and guideline citations). Live check pending (S11). | `npm run eval:metrics --prefix agentforge` (offline). The 50 chart-record citations are counted apart: offline they resolve by construction. Live: the source-preview box ids for each claim of a deployed scan. |

Why this is the north star: a confidently wrong clinical statement can harm a
patient. The verifier drops unsupported claims, so "share of shown claims that
verify" is 100% by construction and proves nothing. These two metrics can fail.
They measure whether the verifier *catches* bad claims, and whether the claims
it lets through really lead back to their evidence.

## Supporting metrics

| Metric | Definition | Target | Measured | Source |
|---|---|---|---|---|
| **Abnormal-finding recall** | Of the abnormal or flagged lab results and key intake items in the truth files (chief concern, current medications, allergies), the share that appear as verified answer claims *or* are listed under **needs review**. Silently dropping one counts as a miss. | ≥ 95% | **94.7%** (18/19). **Misses target.** The one miss is the table-layout lab: it is refused loudly (`no_fields_extracted`), not dropped silently. A form for another patient, correctly BLOCKED `patient_mismatch`, is excluded (3 items). | `npm run eval:metrics --prefix agentforge` (offline, deterministic composer). |
| **Extraction accuracy** | Typed lab fields matching the hand-written truth on value, unit, reference range, collection date **and** abnormal flag, plus intake fields matching the truth. Also reported: the share of fields routed to review. | ≥ 98% | **93.6%** (44/47). **Misses target.** Intake 35/35; labs 9/12. Misses: the table-layout lab (2 results, refused) and a noisy scan whose A1C OCR cannot read (the gate asserts it is not invented). Review share: 3/32 fields. | `npm run eval:metrics --prefix agentforge` (offline, 13 golden documents). |
| **Model grounding rate** | Raw model answer claims that pass verification before anything is dropped. Reported together with the **composer fallback rate** (answers that fell back to the deterministic template). | ≥ 80% grounded; ≤ 20% fallback | **100% grounded** (121/121 model claims); **0% fallback** (0/12). Before the prompt fix: 60% (81/135) and 8% (1/12) on `a91452b`. | `measure-live-metrics.mjs`, `qwen3.8-flash`, 4 golden PDFs × 3 runs on the public URL. Small sample. If either target is missed, that triggers switching from Qwen to OpenRouter. |
| **Time to grounded answer** *(optional)* | p50 and p95 from upload to grounded answer, with per-stage durations (OCR, retrieval, answer). | p95 ≤ 30 s | **p50 11.1 s, p95 22.1 s** (12 runs). Per-stage split not captured by the script; a single trace showed OCR ~6 s and retrieval ~3.5 s. | `measure-live-metrics.mjs` on the public URL, wall time from the request. |

Why these: **recall** asks whether it finds what matters. **Accuracy** asks
whether what it read is right. **Grounding rate** asks whether the model's
answers are useful, and not mostly fallback templates. **Speed** asks whether
it fits the minutes before the physician walks in. Cost per encounter is
recorded in traces (`modelTotals.cost_usd`, with `cost_complete` false and a
null total if any call is unpriced): live on `dcaa180`, $0.0004–0.0006 per
scan at the official Beijing rate. See [`W2_COST_LATENCY.md`](W2_COST_LATENCY.md).

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

All values above were measured on `131d5a3` (2026-09-24), except the
"before" grounding figures, which are from `a91452b`. Synthetic data only.

- **Offline:** `npm run eval:trust-probes` and `npm run eval:metrics`
  (`--prefix agentforge`). The offline answer uses the deterministic composer,
  so recall and resolvability there measure extraction and citation plumbing,
  not the model.
- **Live:** `AGENTFORGE_LIVE_URL=https://dtstest.64.177.10.182.nip.io/agentforge-w2
  AGENTFORGE_LIVE_RUNS=3 node agentforge/scripts/measure-live-metrics.mjs`.
- **Grounding before and after.** The first live run on `a91452b` measured
  60% grounding. A diagnostic run of the real model on the golden documents
  showed none of the rejected claims had invented a value. Every rejection
  came from the prompt not stating what the verifier binds: a lab split into
  several claims, a paraphrased "Label: value" line, framing words outside
  the closed vocabulary, or a guideline quote under 8 words. `131d5a3` states
  those rules in the prompt; the verifier is unchanged. That is why
  grounding rose to 100% and why the model's claims now stay close to the
  fact lines.
- **Targets missed:** recall and extraction accuracy both miss their targets
  because of two known OCR limits, the table layout and the noisy scan
  (see `W2_ARCHITECTURE.md` §2). Both are refused or qualified, never
  guessed at.
- **Guardrails:** the regression matrix was re-run on `131d5a3`: the R0 control
  passes and all 29 injected regressions fail the gate.
