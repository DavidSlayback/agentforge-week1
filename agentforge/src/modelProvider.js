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
  constructor({ endpoint, apiKey, model }) { this.endpoint = endpoint; this.apiKey = apiKey; this.model = model; }
  async checkReady() { return Boolean(this.endpoint && this.apiKey && this.model); }
  async generate({ prompt }) {
    if (!(await this.checkReady())) throw new Error('MODEL_NOT_CONFIGURED');
    const response = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: prompt }] }) });
    if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
    const data = await response.json();
    return { text: data.choices?.[0]?.message?.content || '', inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, estimatedCostUsd: 0 };
  }
}
