import { MAX_RETRIES } from './contracts.js';

/** Local deterministic synthesis for synthetic evaluation and fallback. */
export class DeterministicProvider {
  name = 'deterministic'; model = 'fixture-v1';
  async checkReady() { return true; }
  async generate({ patient, claims, qualification }) {
    const intro = `Preparing ${patient.display_name}'s return visit. `;
    const body = claims.length ? claims.map((claim) => `${claim.field}: ${claim.value}`).join('; ') : 'No supported clinical claims were available.';
    const caveat = qualification.required ? ` Review is incomplete: ${qualification.reasons.join('; ')}.` : '';
    return { text: `${intro}${body}.${caveat}`, inputTokens: 80, outputTokens: 40, estimatedCostUsd: 0 };
  }
}

/**
 * OpenAI-compatible provider. Readiness checks configuration only; generation
 * performs network I/O and this class does not establish redaction, consent,
 * or provider-eligibility policy.
 */
export class OpenAICompatibleProvider {
  constructor({ endpoint, apiKey, model, timeoutMs = 8000, siteUrl = '', siteName = 'AgentForge' }) { this.name = 'openai-compatible'; this.endpoint = endpoint; this.apiKey = apiKey; this.model = model; this.timeoutMs = timeoutMs; this.siteUrl = siteUrl; this.siteName = siteName; }
  async checkReady() { return Boolean(this.endpoint && this.apiKey && this.model); }
  async generate({ prompt }) {
    if (!(await this.checkReady())) throw new Error('MODEL_NOT_CONFIGURED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` };
    if (this.siteUrl) headers['HTTP-Referer'] = this.siteUrl;
    if (this.siteName) headers['X-Title'] = this.siteName;
    try {
      const response = await fetch(this.endpoint, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 300 }) });
      if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('MODEL_EMPTY_OUTPUT');
      return { text: text.trim(), inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, estimatedCostUsd: Number(data.usage?.cost ?? data.cost ?? 0) };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('MODEL_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** DashScope-compatible provider; readiness checks configuration only. */
export class DashScopeMultimodalProvider {
  constructor({ endpoint, apiKey, model, timeoutMs = 8000 }) { this.name = 'dashscope'; this.model = model; this.endpoint = endpoint; this.apiKey = apiKey; this.timeoutMs = timeoutMs; }
  async checkReady() { return Boolean(this.endpoint && this.apiKey && this.model); }
  async generate({ prompt }) {
    if (!(await this.checkReady())) throw new Error('MODEL_NOT_CONFIGURED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, input: { messages: [{ role: 'user', content: [{ text: prompt }] }] }, parameters: { result_format: 'message' } })
      });
      if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
      const data = await response.json();
      const content = data.output?.choices?.[0]?.message?.content;
      const text = Array.isArray(content) ? content.map((item) => item.text || '').join('') : content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('MODEL_EMPTY_OUTPUT');
      return { text: text.trim(), inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0, estimatedCostUsd: Number(data.usage?.cost ?? data.cost ?? 0) };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('MODEL_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** OpenAI Responses-wire provider; readiness checks configuration only. */
export class OpenAIResponsesProvider {
  constructor({ endpoint, apiKey, model, timeoutMs = 8000 }) { this.name = 'openai-responses'; this.model = model; this.endpoint = endpoint; this.apiKey = apiKey; this.timeoutMs = timeoutMs; }
  async checkReady() { return Boolean(this.endpoint && this.apiKey && this.model); }
  async generate({ prompt }) {
    if (!(await this.checkReady())) throw new Error('MODEL_NOT_CONFIGURED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], temperature: 0, max_output_tokens: 300 })
      });
      if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
      const data = await response.json();
      const text = data.output_text || data.output?.flatMap((item) => item.content || []).filter((item) => item.type === 'output_text').map((item) => item.text || '').join('');
      if (typeof text !== 'string' || !text.trim()) throw new Error('MODEL_EMPTY_OUTPUT');
      return { text: text.trim(), inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0, estimatedCostUsd: Number(data.usage?.cost ?? data.cost ?? 0) };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('MODEL_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timer);
    }
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
  async generate(args, { trace, validate } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await this.primary.generate(args);
        if (validate && validate(result).status !== 'passed') throw new Error('MODEL_OUTPUT_REJECTED');
        this.primaryHealthy = true;
        return { ...result, provider_status: 'primary', provider_fallback: false, provider_name: this.primary.name, model_name: this.primary.model };
      } catch (error) {
        lastError = error;
        trace?.recordRetry({ stage: 'model', attempt: attempt + 1, errorCode: error.message || 'MODEL_ERROR' });
      }
    }
    const result = await this.fallback.generate(args);
    if (validate && validate(result).status !== 'passed') throw new Error('MODEL_FALLBACK_OUTPUT_REJECTED');
    this.primaryHealthy = false;
    return { ...result, provider_status: 'fallback', provider_fallback: true, provider_name: this.fallback.name, model_name: this.fallback.model, provider_error_code: lastError?.message || 'MODEL_UNAVAILABLE' };
  }
}
