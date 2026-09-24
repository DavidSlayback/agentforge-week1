# AgentForge Week 2 architecture checkpoint

Status: local synthetic evidence checkpoint with an agreed local-VLM lane, 2026-09-22.

## Flow

```text
source form (synthetic fixture or approved public blank form)
  -> source document stored: OpenEMR via oe-module-agentforge (W2 service),
     or the in-memory synthetic store (default mode)
  -> scan-form extraction worker
     (Tesseract/deterministic baseline, then optional larger local VLM crop resolver)
     (inspect -> extract -> validate/qualify)
  -> evidence retrieval worker
     (inspect -> formulate -> retrieve/check -> qualify)
  -> inspectable active supervisor
  -> cited READY or qualified/blocked result
```

The W1 deterministic briefing path (`PreVisitPreparation`/`verifyClaims`)
remains the safety baseline for the clinical co-pilot. The legacy LAB|/INTAKE|
text-path supervisor this section used to describe alongside it was retired in
R2 (issue #4): it could not persist under the deployed OpenEMR module
writeback and did not refuse loudly. The active path is a bounded
multi-worker document/evidence seam and does not write clinical actions. The
local VLM adapter is opt-in, typed, crop-bounded, and fail-closed when no local
model runner is configured or measured. The eventual API/managed provider can
replace this runner without changing the worker contract. The separate
`write-clinical-action` lane still
requires explicit clinician confirmation and remains synthetic-only.

## OpenEMR persistence (S8)

With `AGENTFORGE_PERSISTENCE_MODE=openemr-module` (set for `agentforge-w2` in
Compose) the service calls `oe-module-agentforge/public/api.php` on the internal
network. Requests are HMAC-signed with `AGENTFORGE_MODULE_HMAC_SECRET`, which
only `openemr` and `agentforge-w2` hold, and carry a context token signed with
`AGENTFORGE_DEMO_SECRET`. On upload the source is stored as an OpenEMR document
("Lab Report" or "Medical Record"). After a validated extraction, and only when
the caller's own context is write-scoped (`write-source-document`), the service
stores a derived-facts JSON document linked to the source and, for a lab PDF,
one `procedure_order`/`_report` plus one `procedure_result` per LOINC-mapped
result (`718-7` hemoglobin, `4548-4` A1c; others are reported as unmapped). A
read-scoped caller gets `openemr.status: not_persisted`, `reason:
persistence_not_authorized`. The service then reads the results back as FHIR
Observations and fails the request (502) unless every value matches. A write
ledger keyed by patient and content hash makes re-uploads return the same ids
with `duplicate: true` and zero new rows; a different payload on an existing key
is reported as `derived_payload_differs` / `lab_payload_differs` and not
written. Every write is limited to the allowlisted synthetic patients, whatever
the token issuer, and recorded with its issuer. Clinician-confirmed intake
medications and allergies have a module route, but the service's
clinical-action lane does not call it yet.

**Lab values are preliminary.** The rows are unreviewed AI extraction, so
`procedure_report.report_status` and `procedure_result.result_status` are
`prelim` (OpenEMR's own option) and `review_status` is `received`, pending
clinician review. OpenEMR 8.0.0's FHIR mapper does not translate `prelim`, so the
Observations report `status: "unknown"`, never `final`.

Known gaps:
- The lab read-back uses OpenEMR's FHIR Observation service **in-process**
  (`read_path: openemr-fhir-service-in-process`), not the `/fhir` HTTP API,
  which is disabled on the deployment (`rest_fhir_api=0`) and would need an
  interactive OAuth grant with `api:fhir user/Observation.rs`.
- Orphan file on rollback: `Document::createDocument` writes the encrypted file
  before the ledger transaction commits. If the transaction rolls back, the
  database rows are rolled back but the file stays under
  `sites/default/documents/<pid>/`, referenced by no `documents` row and never
  served; the request fails with `write_failed` (see `Write/DocumentWriter.php`).
- The Week 1 launcher (`public/index.php`) is unchanged and still has the F18
  ACL bug (it checks the numeric user id instead of the username); W1 is frozen.
- The live round-trip is unverified until `agentforge/scripts/w2-openemr-smoke.mjs`
  passes on the deployed SHA.

## Evidence and retrieval

Observed fields carry a `w2-scan-v1` citation with source document, page, field,
quote, layout, and bounding box. Missing, unreadable, and conflicting values are
represented as qualification metadata and are not promoted to facts;
low-confidence values stay facts but carry an `uncertainty` marker and are
listed for review. Guideline evidence is returned separately from patient
facts. The local retrieval choice is the existing deterministic sparse plus
dense-proxy index because the fixed synthetic benchmark is replayable, cited,
and zero-cost; `dense_score` is not a true embedding score.

## Evaluation and observability

The 50-case gate runs the deployed scan path on 10 golden PDFs, replaying OCR
recorded from the real Tesseract image, and asserts `schema_valid`,
`citation_present`, `factually_consistent`, `safe_refusal`, and
`no_phi_in_logs` (10 cases each) against hand-written truth files; see the root
`EVAL_GATE.md`. The fail-loud rules live in `documentSafety.js`:

- BLOCKED: zero extracted fields, or patient demographics that contradict the
  chart. For intake forms that means the typed name or DOB; for lab reports, the
  printed `Patient:`/`DOB:` header.
- QUALIFIED:
  - a declared type contradicted by the document's text;
  - an identity that cannot be verified (nothing readable, or no chart record);
  - an incomplete extraction.
- An unreadable PDF on `/v1/scan-supervisor` is a BLOCKED
  `document_unreadable` refusal (HTTP 422).

Traces record allowlisted handoff summaries (`traceSafeHandoff`), not
extraction payloads. The server serves the committed gate report on `/evals`
and does not run the gate per request.

Facts read from OCR lines below 0.85 confidence carry
`low_confidence_requires_human_review`. They do not by themselves stop a
document from being READY. The source preview lists them in a separate "not
verified" section, and the W2 answer excludes them (`answerComposer.js`,
below) or lists them under `needs_review` -- never as a fact.

## Supervisor decisions and the grounded answer (S6)

`supervisor.js#decideNext(state) -> {next, reason}` is a pure function called
in a loop by `runActiveSupervisor`; every decision is pushed to
`workflow.decisions[]` and, when a trace is attached, recorded via
`observer.recordDecision({next, reason})` (fixed state names and reason
codes only -- no PHI, so no redaction is needed, but it is still passed
through the trace's key-based redactor for defense in depth).

| State (before) | Decision (`next`) | `reason` | When |
|---|---|---|---|
| No extraction yet, nothing cached | `EXTRACT` | `extraction_needed` | Ordinary first step |
| No extraction yet, a handoff is cached for this content hash + OCR mode | `EXTRACT` | `extraction_cached` | `next` stays `EXTRACT` (review fix F11: it was `RETRIEVE`, which misdescribed a cache load as a retrieval step); the loop loads the cached handoff instead of re-running the worker, and still calls `observer.setExtraction(...)` so the trace's confidence figures are never silently missing on a cache hit |
| Extraction just ran, fail-loud safety check found a blocking reason (`documentSafety.js`) | `DONE` | the blocking reason (`patient_mismatch`, `no_fields_extracted`, or `extraction_contract_invalid` for an invalid handoff) | Existing fail-loud behavior, now routed through the same decision loop |
| Extraction valid, not blocking, mean confidence < 0.7, no retry used yet | `EXTRACT` | `low_confidence_retry` | Re-extracts once with the alternate Tesseract `--psm 4` mode (`ALTERNATE_OCR_MODE` in `pdfScanAdapter.js`); the candidate is kept only if it is not contract-invalid (`blocked`) and its mean confidence is not lower than the original's (review fix F6: a retry can no longer replace a good extraction with a worse or invalid one); with no retry seam, no usable alternate content, or an already-expired scan deadline, the original extraction is kept and the loop moves on -- never a crash or a second retry |
| Facts ready, no evidence yet, the question is a pure record lookup (`isRecordLookupQuestion`, e.g. "What was the hemoglobin value?") | `ANSWER` | `record_lookup_only` | RETRIEVE is skipped entirely; `typed_outputs.evidence` is `null` and the handoff list has only the extraction worker |
| Facts ready, no evidence yet, an ordinary question | `RETRIEVE` | `evidence_needed` | Unchanged evidence-retrieval path |
| Facts and (if not skipped) evidence both ready | `ANSWER` | `facts_and_evidence_ready` | Normal completion |
| The loop safety cap is hit | `DONE` | `max_steps_reached` | QUALIFIED with that reason added to `qualification.reasons`, never BLOCKED -- whatever facts/evidence were gathered are still returned |

`isRecordLookupQuestion` has one canonical definition, in `supervisor.js`
(`answerComposer.js` imports and re-exports it, rather than keeping a second
copy that could quietly drift -- review fix F5). It matches a direct "what
is/was/are/were the X value/result/level/reading" question, *unless* the
question also names a guideline-seeking concept -- target, goal,
recommended, ideal, expected, threshold, cutoff, optimal, normal, abnormal,
or should (e.g. "What is the target A1C value?" asks for evidence, not a
lookup, even though it ends in "value"). An interpretive or open-ended
question always still retrieves evidence.

The extraction cache (`supervisor.js`'s `extractionCache`, owned by
`AgentForgeService`) is keyed by a SHA-256 of the extracted content plus the
OCR mode, not by `sourceDocumentId` (review fix F11) -- so a re-uploaded or
re-fixtured document with the same bytes still hits the cache, and it is
bounded to 50 entries with the same FIFO eviction as `scanPreparations`.

### Answer composer (`answerComposer.js`)

Inputs are exactly three things: this document's typed extraction (lab
results / intake form leaves), the top guideline evidence the
evidence-retrieval worker already found, and chart facts from
`AgentForgeService.retrievePatientChartFacts` (used by both the scan-supervisor
answer and `/v1/follow-up-evidence`; each now carries a full 5-key `Citation`
with `source_type: 'openemr_record'`, not just the flat fields it had before).
Facts with `confidence < 0.85` are excluded before composition and listed
under `needs_review` with a reason code -- never as a claim.

A provider (the real model, or `DeterministicAnswerComposer`) returns
`{claims:[{kind, text, citations}]}` -- the `GroundedAnswer` Zod contract --
with a per-call `maxTokens` of 2000 (review fix F1: the briefing lane's
300-token default truncated the ~1.1-1.6k tokens a handful of claims with
full citations actually costs, guaranteeing a JSON parse failure; the
briefing lane's own 300-token default is untouched). Every claim is then run
through `verifyClaims` (`claimBinding.js`) with `allowedValues` set to
exactly the facts/evidence given; a claim that fails binding is dropped, and
the count survives as `unverified_dropped`. If the model's entire output has
zero claims survive verification, the composer falls back to the
deterministic composer rather than return a hollow answer.

Beyond that all-or-nothing fallback, a model that verifies *something* but
missed facts or evidence that were actually available (never cited by any
surviving claim) has those specific gaps filled deterministically (review fix
F1: "top-up"), labeled `composer: 'model+deterministic-topup'`. When a real
model's own output could not be used as-is, `model_rejected_reason` records
why (review fix F2): `invalid_json` (never passed the `GroundedAnswer` schema
after retries), `provider_error` (network/timeout/other failure),
`all_claims_unverified` (schema-valid JSON, but every claim failed content
verification -- `unverified_dropped` carries the model's own drop count
forward in this case, rather than resetting to 0), or `deadline` (the
per-request scan deadline, `AGENTFORGE_SCAN_DEADLINE_MS`, had already
passed). The field is absent when no model was configured at all. Exactly
one `trace.recordModelUsage({stage: 'answer', ...})` entry is recorded per
composed answer, whichever provider ultimately produced the shipped claims
(review fix F4).

The result (`GroundedAnswerResult`, schemas.js) separates `patient_facts`
(`kind: 'patient_fact'`) from `guideline_evidence` (`kind: 'guideline'`) --
the W2 scenario's "separate patient-record facts from guideline evidence" --
and labels `composer` honestly, never relabeled.

The deterministic composer builds claims directly from the typed facts using
only a closed, pre-approved vocabulary plus the cited value/label/field text,
so they are guaranteed to verify (`labResultClaim`/`fieldValueClaim`/
`guidelineClaim`). One caveat, documented in code: `claimBinding.js`'s
tokenizer has no guard against a letter immediately following a digit
(unlike the sentence-level checker), so a lab code such as "A1C" tokenizes
into a stray, uncitable number ("hba", "1", "c"). Rather than change that
shared tokenizer, the deterministic templates describe a test generically
("A lab result was recorded at...") whenever its name contains a digit.

`ResilientProvider` (`modelProvider.js`) wraps whichever real model is
configured (`AGENTFORGE_PROVIDER_MODE`/`AGENTFORGE_MODEL_*` -- the same env
`agentforge`'s briefing synthesis already reads) with
`DeterministicAnswerComposer` as its fallback, not the briefing-shaped
`DeterministicProvider` (which expects `patient`/`qualification`/`comparison`
args the composer never has and would throw on). When no model is configured
at all -- the primary is itself `DeterministicProvider` or
`DeterministicAnswerComposer`, bare or wrapped in a `ResilientProvider` --
the composer calls the deterministic composer directly rather than dance
through a doomed real-provider attempt (review fix F7: this used to cost 3
wasted retries with a `TypeError` on every answer, and marked
`ResilientProvider.primaryHealthy = false` for no reason). A live OpenEMR
chart adapter with no explicit `allowExternalLiveProvider` approval also
never reaches a real model for the answer, the same way it is already
enforced for briefings (review fix F8). No model is configured for either
the gate or the current deployment secrets in this checkpoint, so every
observed `workflow.answer.composer` today is `deterministic-fallback`; the
model and `model+deterministic-topup` paths are exercised only by fake
providers in tests and the gate (below), not against a live model.

A per-request deadline, `AGENTFORGE_SCAN_DEADLINE_MS` (default 25000,
`agentforge-w2` only), shares one `AbortSignal` between the low-confidence
OCR retry and the answer composer's provider call (review fix F6). If it has
already passed by the time the composer would call a real model, the model
is skipped entirely and the answer is composed deterministically with
`model_rejected_reason: 'deadline'`.

`/v1/scan-supervisor` validates `workflow.answer` against
`GroundedAnswerResult` *before* persisting any derived facts (review fix
F10: this validation used to run after the persist call, so a contract
failure could still have written) -- an invalid shape is a 500
`response_contract_invalid`, matching the existing typed-extraction boundary
check, never an unvalidated answer and never a write from an invalid one.
The UI (`ui.js`) renders "Patient record" and "Guideline evidence" as
separate sections with citation links: only a `document` citation links to
its source-preview page (`#box-<field_or_chunk_id-slug>`); a `guideline`
citation (no public URL in the current synthetic corpus) and an
`openemr_record` citation (a chart record, not a document) both render as
plain text, never a link that goes nowhere real (review fix F9) -- plus a
"Needs review" list.

### Gate coverage

Five of the 50 golden cases carry `expect.answer` assertions on top of their
existing checks (no new case ids -- S4/S5 own other numeric ranges in the
same 50-case file, so this stays additive to existing cases rather than
risking an id collision at merge): `fc-01` (every claim verifies, cited, and
correctly separated), `cp-05` (a low-confidence lab value never becomes a
patient_fact claim), `fc-05` (every observed intake leaf survives as a cited
patient_fact claim -- exercises the intake template specifically), `sr-07`
(an off-topic question yields zero guideline claims), and `fc-08` (a fake,
honestly-named model provider that returns *only* a fabricated claim, so
`verifyClaims` verifies none of it, forcing the zero-verified-claims fallback
rule -- the fabricated claim is dropped and counted, and the deterministic
fallback still answers in full from the same facts/evidence).

Whenever `expect.answer` is set at all, `checkAnswer` (review fix F3) also
runs three checks unconditionally, independent of the composer's own
verification: every emitted claim is re-verified with `verifyClaims` against
a freshly, independently reconstructed allowed-value set (not the one the
composer itself used); `guideline_evidence` is non-empty whenever the
evidence-retrieval worker actually returned guideline evidence for that
query; and every typed fact at or above the confidence threshold (lab result
or observed intake leaf) is represented by a citation in `patient_facts`.
Confirmed by deliberately reintroducing each regression and reverting once
the failure was observed:

| Mutation | What broke | Gate result |
|---|---|---|
| i | `answerComposer.js` skips `verifyClaims` entirely (`verified = claims`) | `fc-08` fails: `answer_claim_fails_independent_reverification`, `answer_fake_provider_zero_verified_did_not_force_fallback`, `answer_invented_claim_survived_verification`, and 2 more |
| ii | `decideNext` never retries on low confidence | Caught by `supervisor-decisions.test.js` (unit); not gate-visible -- no golden document's confidence swing changes a typed value enough to fail a current gate check |
| iii′ | Intake template (`fieldValueClaim`) drops the cited value | `fc-05` fails: `answer_high_confidence_fact_not_represented` for all 7 intake fields |
| iv | Low-confidence facts stop being excluded (`LOW_CONFIDENCE_THRESHOLD` zeroed) | `cp-05`, `fc-01`, `sr-07` all fail (`answer_claim_fails_independent_reverification`; `cp-05` also fails `answer_low_confidence_value_present_as_patient_fact` and `answer_low_confidence_fact_not_listed_as_needs_review`) |
| v | Zero-verified-claims fallback rule removed | `fc-08` fails: `answer_fake_provider_zero_verified_did_not_force_fallback`, `answer_fake_provider_rejection_reason_wrong` |
| vi | Deterministic fallback stops emitting guideline claims | `cp-05`, `fc-01`, `fc-05`, `fc-08` all fail (`answer_guideline_evidence_empty_despite_retrieved_evidence`) |

Each was reintroduced one at a time, confirmed against the gate above, then
reverted; the working tree is clean of all six between confirmations.

The baseline was rebaselined for these (old corpus hash
`2a08f384982c8595e8c5152b820b963593428270002e8ab3318c9e70aa0f5428`, new
`b0982306708df761a0bbc79990359ba7944b54811cfd0650da4b0aba084bdc9d`); no case
was removed, so the category counts are unchanged (9/9/10/13/9 = 50).

## Boundaries and residuals

The sourced forms are public blank layouts held for local/internal evaluation.
The free small local VLM was installed and smoke-tested, then rejected for
field extraction after a redacted 8-case crop benchmark scored 0/8. Tesseract
5.4.0 is now the measured deterministic OCR baseline at 50/53 manifest labels
with coordinates on every page. The larger official PaddleOCR-VL GGUF was
loaded locally through llama.cpp and recovered 8/8 synthetic values as raw
text, but failed the typed JSON contract at 0/8; it remains an experimental
reader. A managed model remains an explicit future decision. Vector retrieval,
live OpenEMR read/writeback, current deployment identity, external reviewer
access, owner-recorded video, social post, and interviews remain
`INCONCLUSIVE` or `NEEDS_HUMAN` until separately evidenced.

Guideline citations carry the same 5-key `Citation` as document citations,
but the synthetic guideline corpus (`guidelineEvidence.js`) has no field for
a real, public URL -- only `title`/`section`/`version`/`snippet`. The S6
grounded-answer UI therefore shows the full guideline quote and its
title/section/version but does not render it as a clickable link, rather
than fabricate one from `source_id`. A real guideline corpus with citable
URLs would close this gap without changing the citation contract.
