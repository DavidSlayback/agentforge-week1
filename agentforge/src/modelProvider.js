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
  constructor({ endpoint, apiKey, model, timeoutMs = 8000, siteUrl = '', siteName = 'AgentForge', fetchImpl = globalThis.fetch, priceKey = null }) { this.name = 'openai-compatible'; this.endpoint = endpoint; this.apiKey = apiKey; this.model = model; this.timeoutMs = timeoutMs; this.siteUrl = siteUrl; this.siteName = siteName; this.fetchImpl = fetchImpl; this.priceKey = priceKey; }
  async checkReady() { return Boolean(this.endpoint && this.apiKey && this.model); }
  async checkReachable() { return probeProviderEndpoint({ endpoint: this.endpoint, apiKey: this.apiKey, model: this.model, timeoutMs: Math.min(this.timeoutMs, 15000), body: { model: this.model, messages: [{ role: 'user', content: 'Return only OK.' }], temperature: 0, max_tokens: 16 }, fetchImpl: this.fetchImpl }); }
  async generate({ prompt, correlationId = '', signal, maxTokens = 300 }) {
    if (!(await this.checkReady())) throw new Error('MODEL_NOT_CONFIGURED');
    const data = await postJson({ endpoint: this.endpoint, apiKey: this.apiKey, timeoutMs: this.timeoutMs, correlationId, signal, fetchImpl: this.fetchImpl, headers: { ...(this.siteUrl ? { 'HTTP-Referer': this.siteUrl } : {}), ...(this.siteName ? { 'X-Title': this.siteName } : {}) }, body: { model: this.model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: maxTokens } });
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('MODEL_EMPTY_OUTPUT');
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    return { text: text.trim(), inputTokens, outputTokens, estimatedCostUsd: resolveCostUsd({ reportedCost: data.usage?.cost ?? data.cost, priceKey: this.priceKey, inputTokens, outputTokens }) };
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

/**
 * Tries the primary once plus `maxRetries` additional times, with no delay or
 * backoff. It records failures when tracing is supplied, validates output,
 * then uses deterministic fallback; fallback marks the primary unhealthy.
 * Deterministic-only configuration remains ready.
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
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await this.primary.generate({ ...args, signal });
        if (validate && validate(result).status !== 'passed') throw new Error('MODEL_OUTPUT_REJECTED');
        this.primaryHealthy = true;
        return { ...result, provider_status: 'primary', provider_fallback: false, provider_name: this.primary.name, model_name: this.primary.model };
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
        trace?.recordRetry({ stage: 'model', attempt: attempt + 1, errorCode: error.message || 'MODEL_ERROR' });
      }
    }
    if (signal?.aborted) throw new Error('MODEL_ABORTED');
    const result = await this.fallback.generate({ ...args, signal });
    if (validate && validate(result).status !== 'passed') throw new Error('MODEL_FALLBACK_OUTPUT_REJECTED');
    this.primaryHealthy = false;
    return { ...result, provider_status: 'fallback', provider_fallback: true, provider_name: this.fallback.name, model_name: this.fallback.model, provider_error_code: lastError?.message || 'MODEL_UNAVAILABLE' };
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
