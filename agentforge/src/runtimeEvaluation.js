/**
 * W2 PRD §7 per-encounter runtime evaluation (S6 follow-up).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    AgentForge
 * @copyright Copyright (c) 2026 AgentForge
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 *
 * PRD §7 requires every encounter's trace to log "eval outcome" alongside
 * tool sequence, latency, tokens, cost, retrieval hits and extraction
 * confidence. Before this module, `service.js#runActiveSupervisorForDocument`
 * called `trace.setEvaluation({status: 'not_run', ...})` unconditionally --
 * a stub that never reflected what actually happened to the document.
 *
 * `kind: 'runtime_encounter'` names this deliberately: it is the per-document
 * scan-supervisor encounter's own outcome, computed once, from data this
 * single encounter already produced -- never the offline golden-set gate
 * (`npm run eval:gate` / `w2RegressionGate.js`), which grades many documents
 * against known-correct expectations. Production code must never read golden
 * -set expectations (AGENTS.md); this module only ever sees one workflow's
 * own `answer`/`final_state`/`stop_reason`/`qualification`, computed by
 * `answerComposer.js#composeGroundedAnswer` and `supervisor.js`.
 *
 * Inputs (all already computed elsewhere, nothing re-derived or re-verified
 * here):
 *   - `workflow.answer`: the answer verifier's own outcome
 *     (`answerComposer.js`) -- `composer`, `model_rejected_reason`,
 *     `unverified_dropped`, `model_claims_proposed`/`model_claims_verified`,
 *     and counts of `patient_facts`/`guideline_evidence`/`needs_review`. A
 *     claim in `patient_facts`/`guideline_evidence` is always one
 *     `verifyClaims` already confirmed -- the composer never ships a claim it
 *     could not verify -- so this module never re-checks claim text; it only
 *     asks whether anything had to be dropped, rejected, or flagged to reach
 *     that shipped set.
 *   - `workflow.final_state` / `stop_reason` / `qualification.reasons`: the
 *     fail-loud safety outcome (`documentSafety.js` via `supervisor.js`).
 *   - `readBack`: the OpenEMR observation read-back result
 *     (`openemrModuleWriteback.js#persistDerivedEvidence` ->
 *     `{verified, ...}`), when the caller has one. **Not wired from
 *     `service.js#runActiveSupervisorForDocument` today**: `server.js`
 *     persists derived facts (and therefore performs the read-back) only
 *     *after* this trace has already been completed and recorded -- and
 *     deliberately so (the F10 review fix: `workflow.answer` and the typed
 *     extraction must pass their own contract validation, in `server.js`,
 *     before anything is ever written; moving the write earlier so its
 *     result could reach this trace would mean persisting before that
 *     validation, weakening the "never persist an invalid answer" guarantee
 *     `answer-service-integration.test.js`/`source-document.test.js` cover).
 *     `readBack` is accepted and fully handled here, and unit-tested
 *     directly, so a future caller that *can* supply it (e.g. a writeback
 *     that resolves read-back before responding) wires in for free; until
 *     then every real call site passes `readBack: null`, which this module
 *     treats as "not applicable", never as a failure.
 *
 * Closed set of `evaluation.status` values:
 *   - `'blocked'`: the fail-loud safety check refused before any answer was
 *     composed (`workflow.readiness === 'stopped'`, `final_state ===
 *     'BLOCKED'`). No claims exist to grade; `stop_reason` and
 *     `qualification_reasons` say why.
 *   - `'degraded'`: an answer was composed (`final_state` is `READY` or
 *     `QUALIFIED`) but at least one of the following fired:
 *       (a) the real model's output was rejected and the answer fell back
 *           deterministically (`answer.model_rejected_reason` set);
 *       (b) at least one proposed claim failed verification and was dropped
 *           (`answer.unverified_dropped > 0`);
 *       (c) at least one extracted fact was excluded for low OCR confidence
 *           (`answer.needs_review.length > 0`);
 *       (d) the safety/evidence check could not reach READY on its own
 *           (`final_state === 'QUALIFIED'`);
 *       (e) the OpenEMR read-back explicitly failed
 *           (`readBack.verified === false`, only when a read-back was
 *           attempted -- see the `readBack` note above).
 *   - `'passed'`: an answer was composed, `final_state` is `READY` or
 *     `QUALIFIED`, none of the `'degraded'` triggers above fired, and the
 *     OpenEMR read-back either verified or never applied to this document
 *     (no `readBack` given, or the writeback has no read-back step for this
 *     document type -- e.g. `intake_form`, which never maps to lab
 *     observations).
 *
 * `verification` is the answer verifier's own per-claim summary: counts and
 * closed reason codes only, never claim text, citation quotes, or extracted
 * values (AGENTS.md: no PHI in logs; W2 PRD §7: "must not contain raw PHI").
 */

export const RUNTIME_EVALUATION_KIND = 'runtime_encounter';

/** `answer.needs_review` reason codes are already a closed set
 * (`answerComposer.js`: `'low_confidence'`, `'missing_citation'`) -- no
 * field names or values are pulled in here, only those codes. */
function summarizeAnswerVerification(answer) {
  if (!answer) {
    return {
      status: 'not_applicable',
      composer: null,
      claims_proposed: 0,
      claims_verified: 0,
      claims_dropped: 0,
      record_claims_count: 0,
      guideline_evidence_count: 0,
      needs_review_count: 0,
      reason_codes: [],
    };
  }
  const claimsDropped = answer.unverified_dropped || 0;
  const needsReview = answer.needs_review || [];
  const modelRejected = answer.model_rejected_reason || null;
  const reasonCodes = [...(modelRejected ? [`model_rejected:${modelRejected}`] : []), ...needsReview.map((item) => item.reason).filter(Boolean)];
  return {
    // 'passed'/'issues_found' deliberately match the vocabulary
    // `observabilityPage.js#computeDashboardMetrics` already recognizes for
    // its cross-lane "verification pass rate" KPI (`preVisitPreparation.js`'s
    // briefing-lane verification uses the same 'passed' word), so a
    // scan-supervisor encounter contributes to that rate rather than being
    // silently invisible to it.
    status: claimsDropped === 0 && !modelRejected ? 'passed' : 'issues_found',
    composer: answer.composer ?? null,
    claims_proposed: answer.model_claims_proposed || 0,
    claims_verified: answer.model_claims_verified || 0,
    claims_dropped: claimsDropped,
    record_claims_count: (answer.patient_facts || []).length,
    guideline_evidence_count: (answer.guideline_evidence || []).length,
    needs_review_count: needsReview.length,
    reason_codes: reasonCodes,
  };
}

/**
 * Compute this encounter's `{evaluation, verification}` trace payload. Pure
 * and side-effect-free -- callers pass the results to
 * `trace.setEvaluation(...)`/`trace.setVerification(...)` themselves, so this
 * is independently unit-testable without a `TraceRecorder`.
 *
 * `workflow` is the object `supervisor.js#runActiveSupervisor` returns
 * (optionally with `.answer` attached by `service.js`, as it is for every
 * non-stopped workflow). `readBack` is `{verified: boolean, ...}` or `null`
 * -- see the module doc for why every current call site passes `null`.
 */
export function computeRuntimeEvaluation({ workflow, readBack = null } = {}) {
  const finalState = workflow?.final_state ?? null;
  const stopReason = workflow?.stop_reason ?? null;
  const qualificationReasons = workflow?.qualification?.reasons ?? [];
  const answer = workflow?.answer ?? null;
  const verification = summarizeAnswerVerification(answer);
  const readBackSummary = readBack ? { verified: Boolean(readBack.verified) } : null;

  if (workflow?.readiness === 'stopped') {
    return {
      evaluation: {
        kind: RUNTIME_EVALUATION_KIND,
        status: 'blocked',
        final_state: finalState,
        stop_reason: stopReason,
        qualification_reasons: qualificationReasons,
        read_back: readBackSummary,
      },
      verification,
    };
  }

  const issues = [];
  if (!answer) issues.push('answer_missing');
  if (answer?.model_rejected_reason) issues.push(`model_rejected:${answer.model_rejected_reason}`);
  if ((answer?.unverified_dropped || 0) > 0) issues.push('claims_dropped');
  if ((answer?.needs_review || []).length > 0) issues.push('needs_review');
  if (finalState === 'QUALIFIED') issues.push('qualified_not_ready');
  if (readBack && readBack.verified === false) issues.push('read_back_failed');

  return {
    evaluation: {
      kind: RUNTIME_EVALUATION_KIND,
      status: issues.length ? 'degraded' : 'passed',
      final_state: finalState,
      stop_reason: stopReason,
      qualification_reasons: qualificationReasons,
      issues,
      read_back: readBackSummary,
    },
    verification,
  };
}
