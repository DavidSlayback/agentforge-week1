import { createHash } from 'node:crypto';
import { runEvidenceWorker, runExtractionWorker } from './activeWorkers.js';
import { assessDocumentSafety } from './documentSafety.js';
import { localLexicalGuidelineRetriever } from './guidelineEvidence.js';
import { summarizeExtractionConfidence } from './typedExtraction.js';

const STATES = Object.freeze({ START: 'START', INTAKE_EXTRACTOR: 'INTAKE_EXTRACTOR', EVIDENCE_RETRIEVER: 'EVIDENCE_RETRIEVER', VERIFY: 'VERIFY', READY: 'READY', QUALIFIED: 'QUALIFIED', CLARIFY: 'CLARIFY', BLOCKED: 'BLOCKED' });

/** The `decideNext` routing states (D3: "keep the hand-rolled supervisor;
 * routing becomes real decisions, each traced with its reason"). Distinct
 * from `STATES` above (the existing workflow/transitions vocabulary, kept
 * unchanged for backward compatibility) -- these four name what the
 * supervisor's loop does *next*, not where the workflow ended up. */
export const DECISIONS = Object.freeze({ EXTRACT: 'EXTRACT', RETRIEVE: 'RETRIEVE', ANSWER: 'ANSWER', DONE: 'DONE' });

const DEFAULT_MAX_STEPS = 6;
const LOW_CONFIDENCE_RETRY_THRESHOLD = 0.7;
const EXTRACTION_CACHE_LIMIT = 50;

/** A direct "what was the X value/result/level" question -- a pure record
 * lookup that does not need guideline evidence. This is the single, canonical
 * copy (`answerComposer.js` imports and re-exports it, rather than keeping
 * its own regex, so the two can never disagree about what counts as "record
 * lookup only"). Documented, simple rule: the assignment's own example
 * ("what was the hemoglobin value?") and its variants (result, level,
 * reading) match; anything else -- an interpretive, comparative, or
 * open-ended question -- does not, and still routes to RETRIEVE.
 *
 * A question is excluded even when it otherwise matches the shape above if
 * it names a guideline-seeking concept rather than a stored reading:
 * target/goal (what the value *should* reach), recommended/ideal/expected
 * (a guideline's suggested figure), threshold/cutoff/optimal (a guideline
 * boundary), or normal/abnormal (an interpretation of the value, not the
 * value itself) -- "What is the target A1C value?" and "What is the normal
 * potassium result?" ask for evidence, not a lookup, even though they end in
 * "value"/"result". */
const RECORD_LOOKUP_QUESTION = /^\s*what\s+(?:is|was|are|were)\s+the\s+[a-z0-9 /%.'-]+?\s+(?:value|values|result|results|level|levels|reading|readings)s?\s*\??\s*$/i;
const GUIDELINE_SEEKING_WORDS = /\b(?:target|goal|recommended|recommend|ideal|expected|threshold|cutoff|optimal|normal|abnormal|should)\b/i;

export function isRecordLookupQuestion(query) {
  const text = String(query || '').trim();
  if (GUIDELINE_SEEKING_WORDS.test(text)) return false;
  return RECORD_LOOKUP_QUESTION.test(text);
}

/** Content-addressed cache key: the same bytes at the same OCR mode always
 * hit the same entry, regardless of which `sourceDocumentId` they arrived
 * under (F11 review fix -- keying by document id let a re-uploaded or
 * re-fixtured document with different content silently reuse a stale
 * extraction). */
function extractionCacheKey(content, ocrMode) {
  return `${createHash('sha256').update(content).digest('hex')}:${ocrMode}`;
}

/** Bounded `Map.set`, mirroring `AgentForgeService#scanPreparations`'s FIFO
 * eviction, so a long-running server's extraction cache cannot grow without
 * bound. */
function boundedCacheSet(cache, key, value, limit = EXTRACTION_CACHE_LIMIT) {
  if (cache.size >= limit && !cache.has(key)) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

/**
 * Decide the supervisor's next step from the current workflow state.
 *
 * A pure function -- no I/O, no side effects -- so every routing decision is
 * independently testable. `runActiveSupervisor` calls this in a loop and
 * records every decision to the trace (W2-C6: "routing decisions
 * inspectable"). Real decisions, each with its own reason code:
 *
 * - `extraction_cached`: this document's extraction is already cached for
 *   the current OCR mode -- `next` is still `EXTRACT` (the trace should read
 *   truthfully: an extraction happened, just from cache, not `RETRIEVE`),
 *   and the loop loads the cached handoff instead of re-running the worker.
 * - `low_confidence_retry`: extraction just completed (not blocked) with
 *   mean confidence below 0.7 and no retry used yet -- re-run EXTRACT once
 *   with an alternate OCR page-segmentation mode.
 * - `record_lookup_only`: the question is a pure record lookup -- skip
 *   RETRIEVE and go straight to ANSWER.
 * - `evidence_needed` / `extraction_needed`: the ordinary path.
 * - `facts_and_evidence_ready`: everything needed for ANSWER is present.
 * - `max_steps_reached`: a safety cap was hit -- DONE, qualified.
 *
 * Args (all in `state`, every key optional):
 *   stepCount, maxSteps: loop-iteration guard.
 *   extraction: the extraction worker handoff once it has run, else `null`.
 *   extractionCached: a cached handoff exists for this doc + OCR mode.
 *   safetyBlocking: fail-loud blocking reasons from `documentSafety.js`
 *     (`assessDocumentSafety(...).blocking`), once known.
 *   confidenceSummary: `summarizeExtractionConfidence(...)` output.
 *   ocrRetryUsed: the one allowed low-confidence retry has already run.
 *   recordLookupOnly: `isRecordLookupQuestion(query)`.
 *   evidence: the evidence worker handoff once it has run, else `null`.
 *   retrieveSkipped: RETRIEVE was deliberately skipped (record lookup).
 *
 * Returns `{next, reason}`, `next` one of `DECISIONS`.
 */
export function decideNext(state = {}) {
  const {
    stepCount = 0,
    maxSteps = DEFAULT_MAX_STEPS,
    extraction = null,
    extractionCached = false,
    safetyBlocking = [],
    confidenceSummary = null,
    ocrRetryUsed = false,
    recordLookupOnly = false,
    evidence = null,
    retrieveSkipped = false,
  } = state;

  if (stepCount >= maxSteps) return { next: DECISIONS.DONE, reason: 'max_steps_reached' };

  if (!extraction) {
    if (extractionCached) return { next: DECISIONS.EXTRACT, reason: 'extraction_cached' };
    return { next: DECISIONS.EXTRACT, reason: 'extraction_needed' };
  }

  if (safetyBlocking.length) return { next: DECISIONS.DONE, reason: safetyBlocking[0] };

  if (!ocrRetryUsed && confidenceSummary && confidenceSummary.mean !== null && confidenceSummary.mean < LOW_CONFIDENCE_RETRY_THRESHOLD) {
    return { next: DECISIONS.EXTRACT, reason: 'low_confidence_retry' };
  }

  if (!evidence && !retrieveSkipped) {
    if (recordLookupOnly) return { next: DECISIONS.ANSWER, reason: 'record_lookup_only' };
    return { next: DECISIONS.RETRIEVE, reason: 'evidence_needed' };
  }

  return { next: DECISIONS.ANSWER, reason: 'facts_and_evidence_ready' };
}

/**
 * Run the inspectable multi-worker scan-form path against synthetic input.
 *
 * `documentText` (OCR text or the text envelope) and `targetPatient`
 * (`{name, dob}` or `null`) feed the fail-loud checks in `documentSafety.js`:
 * patient mismatch or zero facts stop at BLOCKED before retrieval; a
 * doc-type mismatch, an unverified intake identity or an incomplete
 * extraction caps the result at QUALIFIED. Every reason is listed in
 * `qualification.reasons`.
 *
 * Async: the evidence-retrieval worker awaits its retriever (it may be a
 * remote/async provider such as Cohere embed+rerank), so this supervisor must
 * itself be async and every caller must await it.
 *
 * `retrievalAdapter` is an injected `{name, retrieve}` guideline retriever
 * (sync or async — see `runEvidenceWorker`). It defaults to the deterministic
 * local lexical/dense proxy so behavior is unchanged when the caller does not
 * configure one (e.g. direct test calls that omit it entirely). The
 * retrieval provider label recorded on the observer trace always comes from
 * `retrievalAdapter.name`, never a hardcoded constant.
 *
 * S6 additions (all optional, all backward compatible when omitted):
 *   extractionCache: a `Map`-like `{has, get, set}` the caller owns across
 *     calls, keyed by `${sourceDocumentId}:${ocrMode}`, backing the
 *     `extraction_cached` decision. Defaults to a fresh, call-scoped `Map`,
 *     so behavior is unchanged unless a caller shares one across calls (the
 *     service does, for the same document).
 *   ocrMode: a label for the OCR mode `content` was produced with (the
 *     cache key's second half). Defaults to `'psm6'` (Tesseract's default
 *     page-segmentation mode).
 *   reextractWithAlternateOcr: an optional `async () => {content, ocrMode}`
 *     the caller supplies to actually re-OCR at an alternate mode for the
 *     `low_confidence_retry` decision. When absent, or when it throws/returns
 *     nothing usable, the retry decision is still recorded (once) but the
 *     original extraction is kept -- a missing retry seam never crashes or
 *     loops the workflow.
 *   maxSteps: loop safety cap (`max_steps_reached`), default 6.
 *
 * Every decision the loop makes is pushed to `workflow.decisions[]` and, when
 * an `observer` is given, recorded via `observer.recordDecision(...)` (never
 * `observer.recordHandoff`, which carries a different, redaction-checked
 * shape) -- reasons are fixed codes, never values, so this is redaction-safe
 * by construction.
 */
export async function runActiveSupervisor({ sourceDocumentId, documentType, layoutId, pageCount = 1, content, sourceClass = 'synthetic_fixture', syntheticOnly = true, processingMode = 'deterministic_local', query, patientFacts = [], extractionAdapter, retrievalAdapter, observer = null, documentText = '', targetPatient = null, extractionCache = new Map(), ocrMode = 'psm6', reextractWithAlternateOcr = null, maxSteps = DEFAULT_MAX_STEPS, signal = null } = {}) {
  const retriever = retrievalAdapter || localLexicalGuidelineRetriever;
  const transitions = [STATES.START];
  const decisions = [];
  const recordDecision = (decision) => { decisions.push(decision); observer?.recordDecision?.(decision); };
  const recordLookupOnly = isRecordLookupQuestion(query);

  let currentContent = content;
  let currentOcrMode = ocrMode;
  let extractionWorker = null;
  let confidenceSummary = null;
  let safety = null;
  let ocrRetryUsed = false;
  let evidenceWorker = null;
  let retrieveSkipped = false;

  const runExtraction = (extractContent) => {
    observer?.startStage('extraction');
    let handoff;
    try {
      handoff = runExtractionWorker({ sourceDocumentId, documentType, layoutId, pageCount, content: extractContent, sourceClass, syntheticOnly, processingMode, ...(extractionAdapter ? { adapter: extractionAdapter } : {}) });
    } finally {
      observer?.finishStage('extraction', { status: handoff?.output_status || 'failed' });
    }
    return handoff;
  };

  for (let step = 0; step < maxSteps + 1; step += 1) {
    const cacheKey = extractionCacheKey(currentContent, currentOcrMode);
    const decision = decideNext({
      stepCount: step,
      maxSteps,
      extraction: extractionWorker,
      extractionCached: !extractionWorker && extractionCache.has(cacheKey),
      safetyBlocking: safety?.blocking || [],
      confidenceSummary,
      ocrRetryUsed,
      recordLookupOnly,
      evidence: evidenceWorker,
      retrieveSkipped,
    });
    recordDecision(decision);

    if (decision.next === DECISIONS.DONE) {
      if (decision.reason === 'max_steps_reached') return activeQualifiedStop('max_steps_reached', transitions, extractionWorker, evidenceWorker, safety, decisions, currentOcrMode);
      return activeStop(STATES.BLOCKED, decision.reason, transitions, extractionWorker, evidenceWorker, safety, decisions, currentOcrMode);
    }

    if (decision.next === DECISIONS.EXTRACT) {
      if (decision.reason === 'extraction_cached') {
        extractionWorker = extractionCache.get(cacheKey);
        confidenceSummary = summarizeExtractionConfidence(extractionWorker.extraction);
        observer?.setExtraction({ status: extractionWorker.output_status, confidence: confidenceSummary, document_count: 1, fact_count: extractionWorker.extraction?.facts?.length || 0, issue_count: extractionWorker.extraction?.issues?.length || 0 });
        transitions.push(STATES.INTAKE_EXTRACTOR);
        safety = assessDocumentSafety({ documentType, documentText, extraction: extractionWorker.extraction, targetPatient });
        if (safety.blocking.length) return activeStop(STATES.BLOCKED, safety.blocking[0], transitions, extractionWorker, null, safety, decisions, currentOcrMode);
        continue;
      }

      const previousExtraction = extractionWorker;
      const previousConfidence = confidenceSummary;
      const previousContent = currentContent;
      const previousOcrMode = currentOcrMode;

      if (decision.reason === 'low_confidence_retry') {
        ocrRetryUsed = true;
        let alternate = null;
        if (!signal?.aborted && reextractWithAlternateOcr) {
          try {
            alternate = await reextractWithAlternateOcr({ signal });
          } catch {
            alternate = null;
          }
        }
        if (!alternate?.content) continue; // no usable retry seam (or the deadline already passed); keep the existing extraction and move on
        currentContent = alternate.content;
        currentOcrMode = alternate.ocrMode || currentOcrMode;
      }

      const candidate = runExtraction(currentContent);
      const candidateConfidence = summarizeExtractionConfidence(candidate.extraction);

      // Never let a retry replace a good extraction with a worse or invalid
      // one: keep whichever has the higher mean confidence, and never adopt
      // a `blocked` (contract-invalid) candidate over a previously valid one.
      if (decision.reason === 'low_confidence_retry' && previousExtraction) {
        const candidateMean = candidateConfidence.mean;
        const previousMean = previousConfidence?.mean ?? -Infinity;
        const candidateIsWorse = candidate.output_status === 'blocked' || (candidateMean !== null && candidateMean < previousMean);
        if (candidateIsWorse) {
          extractionWorker = previousExtraction;
          confidenceSummary = previousConfidence;
          currentContent = previousContent;
          currentOcrMode = previousOcrMode;
          continue; // ocrRetryUsed is already true, so decideNext will not retry again
        }
      }

      extractionWorker = candidate;
      confidenceSummary = candidateConfidence;
      observer?.setExtraction({ status: extractionWorker.output_status, confidence: confidenceSummary, document_count: 1, fact_count: extractionWorker.extraction?.facts?.length || 0, issue_count: extractionWorker.extraction?.issues?.length || 0 });
      transitions.push(STATES.INTAKE_EXTRACTOR);
      if (extractionWorker.output_status === 'blocked') return activeStop(STATES.BLOCKED, 'extraction_contract_invalid', transitions, extractionWorker, null, null, decisions, currentOcrMode);
      safety = assessDocumentSafety({ documentType, documentText, extraction: extractionWorker.extraction, targetPatient });
      boundedCacheSet(extractionCache, extractionCacheKey(currentContent, currentOcrMode), extractionWorker);
      if (safety.blocking.length) return activeStop(STATES.BLOCKED, safety.blocking[0], transitions, extractionWorker, null, safety, decisions, currentOcrMode);
      continue;
    }

    if (decision.next === DECISIONS.RETRIEVE) {
      observer?.startStage('retrieval');
      try {
        evidenceWorker = await runEvidenceWorker({ query, patientFacts, documentFacts: extractionWorker.extraction.facts, retrieve: retriever.retrieve });
      } finally {
        observer?.finishStage('retrieval', { status: evidenceWorker?.output_status || 'failed' });
      }
      observer?.recordRetrievalAttempt({ tool: 'evidence-retriever', provider: retriever.name || 'local-lexical-proxy', status: evidenceWorker.output_status === 'ready' ? 'complete' : 'qualified', hit_count: evidenceWorker.guideline_evidence?.length || 0 });
      transitions.push(STATES.EVIDENCE_RETRIEVER);
      continue;
    }

    if (decision.next === DECISIONS.ANSWER) {
      if (decision.reason === 'record_lookup_only') retrieveSkipped = true;
      break;
    }
  }

  if (evidenceWorker) {
    const ready = evidenceWorker.output_status === 'ready' && !safety.qualifying.length;
    transitions.push(evidenceWorker.output_status === 'ready' ? STATES.VERIFY : STATES.CLARIFY);
    transitions.push(ready ? STATES.READY : STATES.QUALIFIED);
    const reasons = [...safety.qualifying, ...(evidenceWorker.output_status === 'ready' ? [] : evidenceWorker.qualification.reasons)];
    return { workflow_version: 'w2-active-supervisor-v1', final_state: ready ? STATES.READY : STATES.QUALIFIED, readiness: ready ? 'ready' : 'qualified', stop_reason: null, qualification: { required: !ready, reasons }, safety_checks: safety.checks, transitions, decisions, ocr_mode: currentOcrMode, handoffs: [extractionWorker, evidenceWorker], typed_outputs: { extraction: extractionWorker.extraction, evidence: evidenceWorker } };
  }

  // Retrieval was deliberately skipped (record_lookup_only): the answer
  // rests on facts alone, so readiness depends only on the safety check.
  const ready = !safety.qualifying.length;
  transitions.push(STATES.VERIFY, ready ? STATES.READY : STATES.QUALIFIED);
  return { workflow_version: 'w2-active-supervisor-v1', final_state: ready ? STATES.READY : STATES.QUALIFIED, readiness: ready ? 'ready' : 'qualified', stop_reason: null, qualification: { required: !ready, reasons: [...safety.qualifying] }, safety_checks: safety.checks, transitions, decisions, ocr_mode: currentOcrMode, handoffs: [extractionWorker], typed_outputs: { extraction: extractionWorker.extraction, evidence: null } };
}

function activeStop(state, reason, transitions, extraction, evidence, safety, decisions = [], ocrMode = null) {
  return { workflow_version: 'w2-active-supervisor-v1', final_state: state, readiness: 'stopped', stop_reason: reason, qualification: { required: true, reasons: safety ? [...safety.blocking, ...safety.qualifying] : [reason] }, safety_checks: safety?.checks || null, transitions, decisions, ocr_mode: ocrMode, handoffs: [extraction, ...(evidence ? [evidence] : [])], typed_outputs: { extraction: extraction.extraction, evidence } };
}

/** A max-steps cap: distinct from `activeStop` because it is a degraded
 * QUALIFIED result (whatever facts/evidence were gathered are still
 * returned), not a hard fail-loud BLOCKED stop. */
function activeQualifiedStop(reason, transitions, extraction, evidence, safety, decisions = [], ocrMode = null) {
  return { workflow_version: 'w2-active-supervisor-v1', final_state: STATES.QUALIFIED, readiness: 'qualified', stop_reason: null, qualification: { required: true, reasons: [...(safety ? [...safety.blocking, ...safety.qualifying] : []), reason] }, safety_checks: safety?.checks || null, transitions, decisions, ocr_mode: ocrMode, handoffs: [extraction, ...(evidence ? [evidence] : [])].filter(Boolean), typed_outputs: { extraction: extraction?.extraction || null, evidence } };
}

export { STATES as SUPERVISOR_STATES };
