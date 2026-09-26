/**
 * W2 critic worker (E2, PRD "Critic agent that rejects uncited claims or
 * unsafe action suggestions").
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    AgentForge
 * @copyright Copyright (c) 2026 AgentForge
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 *
 * An LLM critic that can only veto claims. It runs after the grounded answer
 * is composed and after `verifyClaims` (claimBinding.js) has already dropped
 * every claim it could not bind; the verifier stays the authority. The critic
 * sees each shipped claim's text and the `quote_or_value` strings of its
 * citations (what the clinician already sees), and returns one verdict per
 * claim: `keep`, or `reject` with a code from `CRITIC_REASON_CODES`. Its
 * output can only remove claims: verdicts are applied by claim index, the
 * critic's own text is never read back, and a verdict for an id it was not
 * sent (an "added" claim) is ignored.
 *
 * Why it exists next to the verifier: the verifier is a structural,
 * term-level check with documented gaps (it cannot tell that two cited values
 * were swapped between tests, it exempts a verbatim guideline span from the
 * directive check, and its directive patterns are a fixed list). The critic
 * is a model judgment over the same claims, so it can catch some of what the
 * structural check lets through. It is not proof of correctness.
 *
 * Status labels (`CRITIC_STATUS_VALUES`, schemas.js) are never upgraded:
 * `reviewed` only when the model returned a valid verdict for every claim it
 * was sent. A provider error, timeout, the scan deadline or invalid JSON is
 * `failed`, and the answer ships exactly as the verifier left it.
 *
 * PHI: the request carries only claim text and citation quotes, never a
 * patient reference, document id, name, date of birth or phone. The composer
 * already keeps demographics out of every claim (answerComposer.js, F8); a
 * claim whose citation names an identity field is still not sent (defense in
 * depth) and is counted in `claims_not_sent`; if every claim is held back the
 * status is `skipped_identity_only`. Traces carry counts, reason
 * codes, tokens, cost and duration only, never claim text.
 */
import { deterministicTopUpClaims } from './answerComposer.js';
import { OpenAICompatibleProvider } from './modelProvider.js';
import { PRICE_TABLE } from './pricing.js';
import { CRITIC_STATUS_VALUES } from './schemas.js';

export { CRITIC_STATUS_VALUES };
export const CRITIC_REASON_CODES = Object.freeze(['UNCITED', 'UNSUPPORTED_BY_SOURCE', 'UNSAFE_ACTION']);
export const CRITIC_WORKER = 'critic-worker';
export const DEFAULT_CRITIC_TIMEOUT_MS = 4000;
export const CRITIC_PROVIDERS = Object.freeze(['openrouter']);
const CRITIC_MAX_TOKENS = 600;
const OPENROUTER_DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Citation fields that name patient identity data; a claim citing one is
 * never sent to the critic model. Matched by whole field-id segment, so an
 * ordinary lab or medication field (`lab.a1c.test_name`, `medication.name`)
 * is not caught: a bare `name` segment counts only under a patient,
 * demographics or identity parent (`patient.name`, the intake form's field).
 */
const IDENTITY_SEGMENTS = new Set(['dob', 'date_of_birth', 'birth_date', 'birthdate', 'phone', 'telephone', 'phone_number', 'address', 'street_address', 'email', 'mrn', 'ssn', 'patient_name', 'full_name']);
const IDENTITY_PARENTS = new Set(['patient', 'demographics', 'identity']);

export function isIdentityField(fieldOrChunkId) {
  const segments = String(fieldOrChunkId || '').toLowerCase().split(/[.[\]\s]+/).filter(Boolean);
  return segments.some((segment, index) => IDENTITY_SEGMENTS.has(segment) || (segment === 'name' && index > 0 && IDENTITY_PARENTS.has(segments[index - 1])));
}

/** OpenRouter chat-completions client labeled `openrouter` in traces. */
export class OpenRouterCriticProvider extends OpenAICompatibleProvider {
  constructor(options) {
    super(options);
    this.name = 'openrouter';
  }
}

/**
 * Build the critic's provider from the environment.
 *
 * `AGENTFORGE_CRITIC_PROVIDER` (default `openrouter`, the only supported
 * value), `AGENTFORGE_CRITIC_MODEL` (no default: unset means the critic is
 * disabled and every answer says so) and `AGENTFORGE_CRITIC_TIMEOUT_MS`
 * (default 4000). The endpoint and key come from the existing OpenRouter lane
 * (`AGENTFORGE_OPENROUTER_ENDPOINT`, `AGENTFORGE_OPENROUTER_API_KEY`).
 *
 * Returns `{ provider, timeoutMs, disabledReason }`; `provider` is null when
 * disabled. Throws on an unsupported provider or a non-positive timeout, the
 * same fail-at-startup rule `server.js` applies to its other mode variables.
 */
export function createCriticProviderFromEnv(env = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const providerMode = env.AGENTFORGE_CRITIC_PROVIDER || 'openrouter';
  if (!CRITIC_PROVIDERS.includes(providerMode)) throw new Error('AGENTFORGE_CRITIC_PROVIDER must be openrouter');
  const timeoutMs = Number(env.AGENTFORGE_CRITIC_TIMEOUT_MS || DEFAULT_CRITIC_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('AGENTFORGE_CRITIC_TIMEOUT_MS must be a positive number');
  const model = String(env.AGENTFORGE_CRITIC_MODEL || '').trim();
  if (!model) return { provider: null, timeoutMs, disabledReason: 'critic_model_not_configured' };
  const apiKey = env.AGENTFORGE_OPENROUTER_API_KEY || '';
  if (!apiKey) return { provider: null, timeoutMs, disabledReason: 'critic_api_key_missing' };
  const priceKey = PRICE_TABLE[`openrouter/${model}`] ? `openrouter/${model}` : null;
  const provider = new OpenRouterCriticProvider({
    endpoint: env.AGENTFORGE_OPENROUTER_ENDPOINT || OPENROUTER_DEFAULT_ENDPOINT,
    apiKey,
    model,
    timeoutMs,
    siteUrl: env.AGENTFORGE_OPENROUTER_SITE_URL || '',
    siteName: env.AGENTFORGE_OPENROUTER_SITE_NAME || 'AgentForge',
    priceKey,
    fetchImpl,
    // OpenRouter usage accounting: the response then carries the call's
    // actual `usage.cost`, which modelProvider.js prefers over a table price.
    requestExtras: { usage: { include: true } },
  });
  return { provider, timeoutMs, disabledReason: null };
}

/** Every shipped claim, in the fixed order verdict indexes refer to. */
export function answerClaims(answer) {
  return [...(answer?.patient_facts || []), ...(answer?.guideline_evidence || [])];
}

/**
 * What the critic reviews, in the fixed order verdict indexes refer to: every
 * shipped claim, then every safety flag (F-CLIN) as a `safety_flag` item
 * with its text and citations. The critic may veto a flag like any claim.
 */
export function criticItems(answer) {
  const flags = (answer?.safety_flags || []).map((flag) => ({ kind: 'safety_flag', text: flag.text, citations: flag.citations }));
  return [...answerClaims(answer), ...flags];
}

const hasIdentityCitation = (claim) => (claim?.citations || []).some((citation) => isIdentityField(citation?.field_or_chunk_id));

/**
 * The critic request: `items` is `[{ id, index, kind, text, quotes }]` for
 * every claim that may leave the process (`id` is `C1`, `C2`, ...; `index` is
 * the claim's position in `answerClaims(answer)`), and `notSent` counts
 * claims withheld by the identity-field guard.
 */
export function buildCriticRequest(answer) {
  const items = [];
  let notSent = 0;
  criticItems(answer).forEach((claim, index) => {
    if (hasIdentityCitation(claim)) { notSent += 1; return; }
    const quotes = (claim.citations || []).map((citation) => String(citation?.quote_or_value || '').trim()).filter(Boolean);
    items.push({ id: `C${items.length + 1}`, index, kind: claim.kind, text: String(claim.text || ''), quotes });
  });
  return { items, notSent };
}

/** The critic prompt: rules, the strict JSON shape, then each claim with its quotes. */
export function buildCriticPrompt(items) {
  const claimLines = items.map((item) => {
    const quotes = item.quotes.length ? item.quotes.map((quote) => `  quote: ${JSON.stringify(quote)}`).join('\n') : '  quote: (none)';
    const label = item.kind === 'guideline' ? 'guideline evidence' : item.kind === 'safety_flag' ? 'safety flag' : 'patient record fact';
    return `${item.id} [${label}]: ${JSON.stringify(item.text)}\n${quotes}`;
  }).join('\n');
  return [
    'You are a safety critic for a clinical documentation assistant. You can only veto claims. You cannot add, merge or rewrite them.',
    'For each claim below, compare the claim with its quotes and answer "keep" or "reject". Reject only for one of these reasons:',
    '- UNCITED: the claim states something (a value, date, finding, or an application to this patient) that none of its quotes contain.',
    '- UNSUPPORTED_BY_SOURCE: the quotes do not support the claim as stated, for example a value attributed to the wrong test, a wrong date, or a changed meaning.',
    '- UNSAFE_ACTION: the claim tells a clinician or patient to start, stop, change, take or order a medication, dose, test, referral or treatment, or presents such an action as advice for this patient. A guideline sentence quoted and attributed to its source is evidence, not an action suggestion.',
    'Otherwise answer "keep". Do not judge style or completeness.',
    'Return ONLY a JSON object with exactly one verdict per claim id, no prose and no other keys:',
    '{"verdicts":[{"id":"C1","verdict":"keep"},{"id":"C2","verdict":"reject","reason":"UNSAFE_ACTION"}]}',
    'Claims:',
    claimLines,
  ].join('\n');
}

/**
 * Parse the critic model's reply strictly. Returns `{ ok: true, verdicts,
 * ignoredEntries }` (one `{ id, verdict, reason }` per sent id, in order) or
 * `{ ok: false, error }`, `error` one of `invalid_json`, `invalid_shape`,
 * `invalid_verdict`, `duplicate_verdict`, `missing_verdict`. An entry for an
 * id that was not sent is ignored (the critic cannot add a claim); any extra
 * key on an entry (a rewrite, a new text) is never read.
 */
export function parseCriticVerdicts(text, ids) {
  let raw = String(text ?? '').trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) raw = fenced[1];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.verdicts)) return { ok: false, error: 'invalid_shape' };
  const wanted = new Set(ids);
  const byId = new Map();
  let ignoredEntries = 0;
  for (const entry of parsed.verdicts) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') return { ok: false, error: 'invalid_shape' };
    if (!wanted.has(entry.id)) { ignoredEntries += 1; continue; }
    if (byId.has(entry.id)) return { ok: false, error: 'duplicate_verdict' };
    if (entry.verdict === 'keep') byId.set(entry.id, { verdict: 'keep', reason: null });
    else if (entry.verdict === 'reject' && CRITIC_REASON_CODES.includes(entry.reason)) byId.set(entry.id, { verdict: 'reject', reason: entry.reason });
    else return { ok: false, error: 'invalid_verdict' };
  }
  if (byId.size !== wanted.size) return { ok: false, error: 'missing_verdict' };
  return { ok: true, verdicts: ids.map((id) => ({ id, ...byId.get(id) })), ignoredEntries };
}

const emptyReasonCounts = () => Object.fromEntries(CRITIC_REASON_CODES.map((code) => [code, 0]));

function errorCodeFor(error, { deadlineSignal, timedOut }) {
  if (deadlineSignal?.aborted) return 'deadline';
  if (timedOut || error?.message === 'MODEL_TIMEOUT') return 'timeout';
  return 'provider_error';
}

/**
 * Run the critic over one composed answer.
 *
 * Args:
 *   answer: The `GroundedAnswerResult` the composer returned.
 *   provider: `{ name, model, generate({ prompt, signal, maxTokens }) }`
 *     returning `{ text, inputTokens, outputTokens, estimatedCostUsd,
 *     costSource? }` (modelProvider.js shape).
 *   timeoutMs: The critic's own time limit; enforced here even when a
 *     provider ignores its abort signal.
 *   signal: The scan request's deadline signal.
 *   now: Clock for the duration measurement.
 *
 * Returns a worker handoff. `output_status` is `reviewed`, `failed` or
 * `skipped_no_claims` / `skipped_identity_only`; `verdicts` holds `{ index, verdict, reason }` (claim
 * index and codes only); `usage` is the model call's usage entry when a call
 * was made. Never throws for a provider or parse failure.
 */
export async function runCriticWorker({ answer, provider, timeoutMs = DEFAULT_CRITIC_TIMEOUT_MS, signal = null, now = () => Date.now() } = {}) {
  const request = buildCriticRequest(answer);
  const steps = [{ name: 'inspect', decision: `claims_to_review:${request.items.length}` }];
  const base = { worker: CRITIC_WORKER, input_type: 'grounded-answer-claims', retry_count: 0, citations: [], provider: provider?.name || null, model: provider?.model || null };
  const metrics = (verdicts = [], extra = {}) => {
    const reasonCounts = emptyReasonCounts();
    for (const verdict of verdicts) if (verdict.verdict === 'reject') reasonCounts[verdict.reason] += 1;
    const rejected = verdicts.filter((verdict) => verdict.verdict === 'reject').length;
    return { claims_reviewed: verdicts.length, claims_kept: verdicts.length - rejected, claims_rejected: rejected, claims_not_sent: request.notSent, reason_counts: reasonCounts, ...extra };
  };
  if (!request.items.length) {
    // Every claim was held back by the identity guard: nothing was reviewed,
    // and that is a different fact from an answer with no claims at all.
    const status = request.notSent ? 'skipped_identity_only' : 'skipped_no_claims';
    steps.push({ name: 'qualify', decision: status });
    return { ...base, output_status: status, steps, verdicts: [], usage: null, error_code: null, duration_ms: 0, redacted_metrics: metrics() };
  }

  const prompt = buildCriticPrompt(request.items);
  const controller = new AbortController();
  const abortFromDeadline = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromDeadline();
  else signal?.addEventListener('abort', abortFromDeadline, { once: true });
  let timedOut = false;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('CRITIC_TIMEOUT')); }, timeoutMs);
  });
  const startedAt = now();
  let result = null;
  let errorCode = null;
  try {
    if (signal?.aborted) throw new Error('CRITIC_DEADLINE');
    result = await Promise.race([provider.generate({ prompt, signal: controller.signal, maxTokens: CRITIC_MAX_TOKENS }), timeout]);
  } catch (error) {
    errorCode = errorCodeFor(error, { deadlineSignal: signal, timedOut });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromDeadline);
  }
  const durationMs = Math.max(0, now() - startedAt);
  steps.push({ name: 'critique', decision: errorCode ? `provider_failed:${errorCode}` : 'verdicts_returned' });

  // A call was made; tokens are known only when a reply came back. An
  // unknown cost stays null (never a silent 0), with the reason alongside.
  const usage = {
    stage: 'critic',
    provider: base.provider,
    model: base.model,
    inputTokens: result?.inputTokens || 0,
    outputTokens: result?.outputTokens || 0,
    estimatedCostUsd: result ? (result.estimatedCostUsd ?? null) : null,
    cost_source: result ? (result.costSource || (result.estimatedCostUsd === null || result.estimatedCostUsd === undefined ? 'unknown' : 'unspecified')) : 'no_response',
  };

  if (errorCode) {
    steps.push({ name: 'qualify', decision: 'answer_ships_as_verified' });
    return { ...base, output_status: 'failed', steps, verdicts: [], usage, error_code: errorCode, duration_ms: durationMs, redacted_metrics: metrics() };
  }
  const parsed = parseCriticVerdicts(result.text, request.items.map((item) => item.id));
  if (!parsed.ok) {
    steps.push({ name: 'qualify', decision: `answer_ships_as_verified:${parsed.error}` });
    return { ...base, output_status: 'failed', steps, verdicts: [], usage, error_code: parsed.error, duration_ms: durationMs, redacted_metrics: metrics() };
  }
  const verdicts = parsed.verdicts.map((verdict, position) => ({ index: request.items[position].index, verdict: verdict.verdict, reason: verdict.reason }));
  steps.push({ name: 'qualify', decision: `rejected:${verdicts.filter((verdict) => verdict.verdict === 'reject').length}` });
  return { ...base, output_status: 'reviewed', steps, verdicts, usage, error_code: null, duration_ms: durationMs, redacted_metrics: metrics(verdicts, { ignored_entries: parsed.ignoredEntries }) };
}

const factKey = (citation) => (citation ? `${citation.source_type}:${citation.source_id}:${citation.field_or_chunk_id}` : null);

/**
 * Apply a critic handoff to the answer. Only a `reviewed` handoff changes
 * claims: each rejected claim is removed by index, and every fact or
 * guideline chunk a rejected claim cited is barred from coming back. The
 * composer's deterministic top-up (`deterministicTopUpClaims`) may still fill
 * a gap for a fact no rejected claim cited; such a claim was added after the
 * critic ran, so it is counted in `critic_topup_unreviewed`, never as
 * reviewed. There is no other fallback: if the vetoes remove every claim,
 * the answer ships with none. Any other status ships the answer unchanged,
 * labeled with that status.
 *
 * Answer metadata (all counts): `critic_rejected` is exactly the number of
 * claims removed from what ships; `critic_claims_not_sent` is claims kept
 * without review because the identity guard held them back;
 * `critic_topup_unreviewed` is claims added after the critic ran.
 *
 * `parts` is `partitionAnswerInputs(...)` for the same inputs the answer was
 * composed from (answerComposer.js).
 */
export function applyCriticVerdicts(answer, handoff, parts = null) {
  const status = handoff?.output_status;
  const notSent = handoff?.redacted_metrics?.claims_not_sent || 0;
  if (status !== 'reviewed') return { ...answer, critic_status: CRITIC_STATUS_VALUES.includes(status) ? status : 'failed', critic_rejected: 0, critic_claims_not_sent: notSent, critic_topup_unreviewed: 0 };
  const claims = answerClaims(answer);
  const rejected = new Set(handoff.verdicts.filter((verdict) => verdict.verdict === 'reject').map((verdict) => verdict.index));
  const survivors = claims.filter((_, index) => !rejected.has(index));
  // Safety flags follow the claims in `criticItems`; a vetoed flag is removed
  // and counted, and bars nothing (its facts may still be stated).
  const flags = answer.safety_flags || [];
  const keptFlags = flags.filter((_, position) => !rejected.has(claims.length + position));
  const barredFacts = new Set(claims.filter((_, index) => rejected.has(index)).flatMap((claim) => (claim.citations || []).map(factKey)));
  const topup = rejected.size && parts
    ? deterministicTopUpClaims(parts, survivors).filter((claim) => !(claim.citations || []).some((citation) => barredFacts.has(factKey(citation))))
    : [];
  const shipped = [...survivors, ...topup];
  return {
    ...answer,
    composer: topup.length && answer.composer === 'model' ? 'model+deterministic-topup' : answer.composer,
    patient_facts: shipped.filter((claim) => claim.kind === 'patient_fact'),
    guideline_evidence: shipped.filter((claim) => claim.kind === 'guideline'),
    ...(answer.safety_flags ? { safety_flags: keptFlags, critic_flags_rejected: flags.length - keptFlags.length } : {}),
    critic_status: 'reviewed',
    critic_rejected: claims.length - survivors.length,
    critic_claims_not_sent: notSent,
    critic_topup_unreviewed: topup.length,
  };
}

/**
 * The trace's `critic` block: status, provider/model, duration, tokens,
 * cost (null with `cost_source` when unknown), verdict counts and reason codes.
 * Counts and codes only; never claim text.
 */
export function criticTraceSummary(handoff) {
  const metrics = handoff?.redacted_metrics || {};
  const usage = handoff?.usage || null;
  const costUsd = usage ? (usage.estimatedCostUsd ?? null) : null;
  return {
    status: handoff?.output_status || 'failed',
    provider: handoff?.provider || null,
    model: handoff?.model || null,
    duration_ms: handoff?.duration_ms ?? 0,
    input_tokens: usage?.inputTokens || 0,
    output_tokens: usage?.outputTokens || 0,
    cost_usd: costUsd,
    cost_source: costUsd !== null ? (usage?.cost_source || null) : (usage ? (usage.cost_source === 'no_response' ? 'no_response' : 'unpriced_model') : 'no_call'),
    claims_reviewed: metrics.claims_reviewed || 0,
    claims_kept: metrics.claims_kept || 0,
    claims_rejected: metrics.claims_rejected || 0,
    claims_not_sent: metrics.claims_not_sent || 0,
    claims_topup_unreviewed: 0,
    reason_counts: metrics.reason_counts || emptyReasonCounts(),
    error_code: handoff?.error_code || null,
  };
}

/** The trace summary for an applied handoff: `claims_rejected` and
 * `claims_topup_unreviewed` come from what actually ships, not the verdicts. */
export function criticAppliedSummary(handoff, appliedAnswer) {
  return { ...criticTraceSummary(handoff), claims_rejected: appliedAnswer.critic_rejected || 0, claims_topup_unreviewed: appliedAnswer.critic_topup_unreviewed || 0 };
}

/** The trace's `critic` block when the critic never ran (disabled, budget, no claims). */
export function criticNotRunSummary(status, reason) {
  return { status, reason, provider: null, model: null, duration_ms: 0, input_tokens: 0, output_tokens: 0, cost_usd: null, cost_source: 'no_call', claims_reviewed: 0, claims_kept: 0, claims_rejected: 0, claims_not_sent: 0, claims_topup_unreviewed: 0, reason_counts: emptyReasonCounts(), error_code: null };
}
