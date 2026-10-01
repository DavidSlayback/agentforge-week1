import { MAX_RETRIES } from './contracts.js';
import { clinicalFact, clinicalLabel } from './clinicalLanguage.js';
import { estimateCostUsd } from './pricing.js';

/**
 * Cost for one model call: trust a provider-reported figure when present
 * (`data.usage.cost` / `data.cost`, e.g. OpenRouter's per-request actual);
 * otherwise compute it from `pricing.js`'s `PRICE_TABLE` via `priceKey`, if
 * the caller configured one. When neither is available, the cost is
 * genuinely unknown and this returns `null` -- never a silent `0`, which
 * would misreport an unpriced call as free (AGENTS.md: never present an
 * unknown as $0).
 */
function resolveCostUsd({ reportedCost, priceKey, inputTokens, outputTokens }) {
  if (reportedCost !== undefined && reportedCost !== null) return Number(reportedCost);
  if (priceKey) return estimateCostUsd(priceKey, { inputTokens, outputTokens });
  return null;
}

/** Where a call's cost figure came from: the provider's own per-call
 * report, the `pricing.js` table, or nowhere (`estimatedCostUsd` is null). */
function costSourceFor(reportedCost, estimatedCostUsd) {
  if (reportedCost !== undefined && reportedCost !== null) return 'provider_reported';
  return estimatedCostUsd === null ? 'unknown' : 'price_table';
}

async function postJson({ endpoint, apiKey, body, timeoutMs, correlationId = '', headers = {}, fetchImpl = globalThis.fetch, parseJson = true, signal: parentSignal = null }) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestHeaders = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...headers };
  if (correlationId) requestHeaders['x-correlation-id'] = correlationId;
  try {
    const response = await fetchImpl(endpoint, { method: 'POST', headers: requestHeaders, signal: controller.signal, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
    return parseJson ? await response.json() : response;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('MODEL_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

/** Local deterministic synthesis for synthetic evaluation and fallback. */
export class DeterministicProvider {
  name = 'deterministic'; model = 'fixture-v1';
  async checkReady() { return true; }
  async generate({ patient, claims, qualification, comparison = { changes: [] } }) {
    const intro = `${patient.display_name} — return visit. `;
    const latest = new Map();
    claims.forEach((claim) => {
      const recordedAt = claim.evidence?.[0]?.recorded_at || '';
      const previous = latest.get(claim.field);
      if (!previous || recordedAt > previous.recordedAt) latest.set(claim.field, { claim, recordedAt });
    });
    const body = latest.size ? [...latest.values()].map(({ claim }) => clinicalFact(claim)).join('. ') : 'No supported clinical claims were available';
    const changes = (comparison.changes || []).map((change) => `${clinicalLabel(change.field)} changed from ${change.previous.value} to ${change.current.value}`).join('; ');
    const caveat = qualification.required ? ` Review is incomplete: ${qualification.reasons.join('; ')}.` : '';
    return { text: `${intro}${changes ? `Documented changes: ${changes}. ` : ''}${body}.${caveat}`, inputTokens: 80, outputTokens: 40, estimatedCostUsd: 0 };
  }
}

/**
 * OpenAI-compatible provider. Readiness checks configuration only; generation
 * performs network I/O and this class does not establish redaction, consent,
 * or provider-eligibility policy.
 */
export class OpenAICompatibleProvider {
  // `requestExtras` is spread into the request body (e.g. OpenRouter's
  // `usage: { include: true }` for a per-call reported cost). Distinct from
  // the Qwen `extraBody` other providers take, which this class never sent.
  constructor({ endpoint, apiKey, model, timeoutMs = 8000, siteUrl = '', siteName = 'AgentForge', fetchImpl = globalThis.fetch, priceKey = null, requestExtras = {} }) { this.name = 'openai-compatible'; this.endpoint = endpoint; this.apiKey = apiKey; this.model = model; this.timeoutMs = timeoutMs; this.siteUrl = siteUrl; this.siteName = siteName; this.fetchImpl = fetchImpl; this.priceKey = priceKey; this.requestExtras = requestExtras; }
  async checkReady() { return Boolean(this.endpoint && this.apiKey && this.model); }
  async checkReachable() { return probeProviderEndpoint({ endpoint: this.endpoint, apiKey: this.apiKey, model: this.model, timeoutMs: Math.min(this.timeoutMs, 15000), body: { model: this.model, messages: [{ role: 'user', content: 'Return only OK.' }], temperature: 0, max_tokens: 16 }, fetchImpl: this.fetchImpl }); }
  async generate({ prompt, correlationId = '', signal, maxTokens = 300 }) {
    if (!(await this.checkReady())) throw new Error('MODEL_NOT_CONFIGURED');
    const data = await postJson({ endpoint: this.endpoint, apiKey: this.apiKey, timeoutMs: this.timeoutMs, correlationId, signal, fetchImpl: this.fetchImpl, headers: { ...(this.siteUrl ? { 'HTTP-Referer': this.siteUrl } : {}), ...(this.siteName ? { 'X-Title': this.siteName } : {}) }, body: { ...this.requestExtras, model: this.model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: maxTokens } });
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('MODEL_EMPTY_OUTPUT');
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const reportedCost = data.usage?.cost ?? data.cost;
    const estimatedCostUsd = resolveCostUsd({ reportedCost, priceKey: this.priceKey, inputTokens, outputTokens });
    return { text: text.trim(), inputTokens, outputTokens, estimatedCostUsd, costSource: costSourceFor(reportedCost, estimatedCostUsd) };
  }
}

/** DashScope-compatible provider; readiness checks configuration only. */
export class DashScopeMultimodalProvider {
  constructor({ endpoint, apiKey, model, timeoutMs = 8000, fetchImpl = globalThis.fetch, priceKey = null }) { this.name = 'dashscope'; this.model = model; this.endpoint = endpoint; this.apiKey = apiKey; this.timeoutMs = timeoutMs; this.fetchImpl = fetchImpl; this.priceKey = priceKey; }
  async checkReady() { return Boolean(this.endpoint && this.apiKey && this.model); }
  async checkReachable() {
    return probeProviderEndpoint({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      model: this.model,
      timeoutMs: Math.min(this.timeoutMs, 15000),
      body: { model: this.model, input: { messages: [{ role: 'user', content: [{ text: 'Return only OK.' }] }] }, parameters: { result_format: 'message', max_tokens: 16 } },
      fetchImpl: this.fetchImpl,
    });
  }
  async generate({ prompt, correlationId = '', signal, maxTokens = 300 }) {
    if (!(await this.checkReady())) throw new Error('MODEL_NOT_CONFIGURED');
    const data = await postJson({ endpoint: this.endpoint, apiKey: this.apiKey, timeoutMs: this.timeoutMs, correlationId, signal, fetchImpl: this.fetchImpl, body: { model: this.model, input: { messages: [{ role: 'user', content: [{ text: prompt }] }] }, parameters: { result_format: 'message', max_tokens: maxTokens } } });
    const content = data.output?.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((item) => item.text || '').join('') : content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('MODEL_EMPTY_OUTPUT');
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    return { text: text.trim(), inputTokens, outputTokens, estimatedCostUsd: resolveCostUsd({ reportedCost: data.usage?.cost ?? data.cost, priceKey: this.priceKey, inputTokens, outputTokens }) };
  }
}

/** OpenAI Responses-wire provider; readiness checks configuration only. */
export class OpenAIResponsesProvider {
  // extraBody carries provider-specific request fields, e.g. { enable_thinking: false }
  // for Qwen models whose reasoning roughly doubles latency on copy-only tasks.
  constructor({ endpoint, apiKey, model, timeoutMs = 8000, fetchImpl = globalThis.fetch, extraBody = {}, priceKey = null }) { this.name = 'openai-responses'; this.model = model; this.endpoint = endpoint; this.apiKey = apiKey; this.timeoutMs = timeoutMs; this.fetchImpl = fetchImpl; this.extraBody = extraBody; this.priceKey = priceKey; }
  async checkReady() { return Boolean(this.endpoint && this.apiKey && this.model); }
  async checkReachable() {
    return probeProviderEndpoint({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      model: this.model,
      timeoutMs: Math.min(this.timeoutMs, 15000),
      body: { model: this.model, input: [{ role: 'user', content: [{ type: 'input_text', text: 'Return only OK.' }] }], temperature: 0, max_output_tokens: 16 },
      fetchImpl: this.fetchImpl,
    });
  }
  async generate({ prompt, correlationId = '', signal, maxTokens = 300 }) {
    if (!(await this.checkReady())) throw new Error('MODEL_NOT_CONFIGURED');
    const data = await postJson({ endpoint: this.endpoint, apiKey: this.apiKey, timeoutMs: this.timeoutMs, correlationId, signal, fetchImpl: this.fetchImpl, body: { ...this.extraBody, model: this.model, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], temperature: 0, max_output_tokens: maxTokens } });
    const text = data.output_text || data.output?.flatMap((item) => item.content || []).filter((item) => item.type === 'output_text').map((item) => item.text || '').join('');
    if (typeof text !== 'string' || !text.trim()) throw new Error('MODEL_EMPTY_OUTPUT');
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    return { text: text.trim(), inputTokens, outputTokens, estimatedCostUsd: resolveCostUsd({ reportedCost: data.usage?.cost ?? data.cost, priceKey: this.priceKey, inputTokens, outputTokens }) };
  }
}

/** Add one primary call's usage to a running total. An unknown cost (`null`)
 * makes the total unknown: a partial sum would under-report the bill. */
function addUsage(total, result) {
  const cost = result?.estimatedCostUsd;
  return {
    attempts: total.attempts + 1,
    inputTokens: total.inputTokens + (result?.inputTokens || 0),
    outputTokens: total.outputTokens + (result?.outputTokens || 0),
    estimatedCostUsd: total.estimatedCostUsd === null || cost === null || cost === undefined ? null : Number((total.estimatedCostUsd + Number(cost)).toFixed(8)),
  };
}

/**
 * Tries the primary once plus `maxRetries` additional times, with no delay or
 * backoff. It records failures when tracing is supplied, validates output,
 * then uses deterministic fallback; fallback marks the primary unhealthy.
 * Deterministic-only configuration remains ready.
 *
 * Billing: a primary attempt whose output was returned but rejected by
 * `validate` (`MODEL_OUTPUT_REJECTED`) was still billed. Its tokens and cost
 * are kept: a successful result reports the sum over every returned attempt
 * (`billed_attempts`), and a fallback result carries the rejected attempts as
 * `primary_usage` (`{provider_name, model_name, attempts, inputTokens,
 * outputTokens, estimatedCostUsd}`), next to the fallback's own numbers. An
 * abort after billed attempts throws with the same `primary_usage` attached.
 * A call that threw before returning (timeout, HTTP error) reports no usage
 * and is not counted.
 */
export class ResilientProvider {
  constructor({ primary, fallback = new DeterministicProvider(), maxRetries = MAX_RETRIES }) { this.primary = primary; this.fallback = fallback; this.maxRetries = maxRetries; this.name = primary.name; this.model = primary.model; this.primaryHealthy = null; }
  async checkReady() {
    const fallbackReady = await this.fallback.checkReady().catch(() => false);
    const primaryReady = await this.primary.checkReady().catch(() => false);
    return Boolean(fallbackReady && primaryReady && this.primaryHealthy !== false);
  }
  async checkReachable() { return Boolean(await this.checkReady()) && (typeof this.primary.checkReachable !== 'function' || await this.primary.checkReachable()); }
  async generate(args, { trace, validate, signal } = {}) {
    let lastError = null;
    let billed = { attempts: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
    const primaryUsage = () => (billed.attempts ? { provider_name: this.primary.name, model_name: this.primary.model, ...billed } : null);
    const withUsage = (error) => { const usage = primaryUsage(); if (usage && error && typeof error === 'object') error.primary_usage = usage; return error; };
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await this.primary.generate({ ...args, signal });
        billed = addUsage(billed, result);
        if (validate && validate(result).status !== 'passed') throw new Error('MODEL_OUTPUT_REJECTED');
        this.primaryHealthy = true;
        return { ...result, inputTokens: billed.inputTokens, outputTokens: billed.outputTokens, estimatedCostUsd: billed.estimatedCostUsd, billed_attempts: billed.attempts, provider_status: 'primary', provider_fallback: false, provider_name: this.primary.name, model_name: this.primary.model };
      } catch (error) {
        if (signal?.aborted) throw withUsage(error);
        lastError = error;
        trace?.recordRetry({ stage: 'model', attempt: attempt + 1, errorCode: error.message || 'MODEL_ERROR' });
      }
    }
    if (signal?.aborted) throw withUsage(new Error('MODEL_ABORTED'));
    const result = await this.fallback.generate({ ...args, signal });
    if (validate && validate(result).status !== 'passed') throw withUsage(new Error('MODEL_FALLBACK_OUTPUT_REJECTED'));
    this.primaryHealthy = false;
    const usage = primaryUsage();
    return { ...result, provider_status: 'fallback', provider_fallback: true, provider_name: this.fallback.name, model_name: this.fallback.model, provider_error_code: lastError?.message || 'MODEL_UNAVAILABLE', ...(usage ? { primary_usage: usage } : {}) };
  }
}

async function probeProviderEndpoint({ endpoint, apiKey, model, timeoutMs, body, fetchImpl = globalThis.fetch }) {
  if (!endpoint || !apiKey || !model) return false;
  try {
    await postJson({ endpoint, apiKey, body, timeoutMs, fetchImpl, parseJson: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Provider-specific request fields from the environment. For the synthesis
 * model the variable is AGENTFORGE_MODEL_ENABLE_THINKING; for a role prefix
 * such as AGENTFORGE_CONVERSATION_ it is `${prefix}MODEL_ENABLE_THINKING`.
 * Only the literal string 'false' disables Qwen reasoning.
 */
export function modelExtraBodyFromEnv(env, prefix = '') {
  const value = prefix ? env[`${prefix}MODEL_ENABLE_THINKING`] : env.AGENTFORGE_MODEL_ENABLE_THINKING;
  return value === 'false' ? { enable_thinking: false } : {};
}
