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

export class ResilientProvider {
  constructor({ primary, fallback = new DeterministicProvider(), maxRetries = 2 }) { this.primary = primary; this.fallback = fallback; this.maxRetries = maxRetries; this.name = primary.name; this.model = primary.model; }
  async checkReady() { return Boolean(await this.fallback.checkReady()) && (await this.primary.checkReady().catch(() => false) || this.fallback.name === 'deterministic'); }
  async generate(args, { trace, validate } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await this.primary.generate(args);
        if (validate && validate(result).status !== 'passed') throw new Error('MODEL_OUTPUT_REJECTED');
        return { ...result, provider_status: 'primary', provider_fallback: false };
      } catch (error) {
        lastError = error;
        trace?.recordRetry({ stage: 'model', attempt: attempt + 1, errorCode: error.message || 'MODEL_ERROR' });
      }
    }
    const result = await this.fallback.generate(args);
    if (validate && validate(result).status !== 'passed') throw new Error('MODEL_FALLBACK_OUTPUT_REJECTED');
    return { ...result, provider_status: 'fallback', provider_fallback: true, provider_error_code: lastError?.message || 'MODEL_UNAVAILABLE' };
  }
}
