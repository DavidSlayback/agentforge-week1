// W3 remediation (F-ca9486ff1b, API3 / LLM02): what the HTTP boundary removes
// from a response before a client sees it. Internal telemetry stays in the
// service result, where traces and tests read it; only the wire copy is trimmed.
//
// Removed here:
//   /v1/follow-up-evidence: `retrieval.guideline_provider` (embedding and
//     reranker provider and model names) and `retrieval.guideline_usage`
//     (per-stage provider, model, token and cost telemetry).
//   /v1/scan-supervisor: `workflow.workflow_version`, `workflow.ocr_mode`, and
//     the OpenEMR-internal uuids `document_uuid` and `derived_document_uuid`
//     wherever they appear.
//
// Kept on purpose (docs/agentforge/REMEDIATION_W3.md records them as deferred):
//   - the integer `openemr.document_id` family and `handoffs` on scan-supervisor:
//     the W2 OpenEMR round-trip proof and the page's worker trail read them;
//   - `persistence_boundary` and `source_system`: AGENTS.md requires a
//     simulation to be named as one in API output (`in-memory-synthetic`).

const without = (source, keys) => {
  if (!source || typeof source !== 'object') return source;
  const copy = { ...source };
  for (const key of keys) delete copy[key];
  return copy;
};

const stripUuids = (value) => {
  if (Array.isArray(value)) return value.map(stripUuids);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'document_uuid' && key !== 'derived_document_uuid').map(([key, inner]) => [key, stripUuids(inner)]));
};

export function clientFollowUpEvidence(result) {
  return { ...result, retrieval: without(result.retrieval, ['guideline_provider', 'guideline_usage']) };
}

export function clientScanSupervisor(body) {
  const clean = { ...body };
  if (clean.workflow) clean.workflow = without(clean.workflow, ['workflow_version', 'ocr_mode']);
  if (clean.openemr) clean.openemr = stripUuids(clean.openemr);
  return stripUuids(clean);
}

// W3 hardening (H2): the error code a client or trace may see. Errors in this
// codebase carry a code either as `error.code` or as an upper-case message
// (`new Error('DOCUMENT_SCOPE_MISMATCH')`). Anything else (a library message,
// a URIError, an upstream body) can carry internal detail or PHI, so it is
// replaced by `fallback`; the caller logs the error's name, never its message.
const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.:-]{1,79}$/;
const MESSAGE_CODE = /^[A-Z][A-Z0-9_]{2,79}$/;
export function errorCodeOf(error, fallback = 'internal_error') {
  if (typeof error?.code === 'string' && ERROR_CODE.test(error.code)) return error.code;
  if (typeof error?.message === 'string' && MESSAGE_CODE.test(error.message)) return error.message;
  return fallback;
}
