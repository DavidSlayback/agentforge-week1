import { retryDelayMs } from './geminiClient.js';

const MODEL_DEFAULT = 'gemini-3.8-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MAX_INLINE_BYTES = 12 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const FIELDS = {
  lab_pdf: [
    'lab.hgb.test_name', 'lab.hgb.value', 'lab.hgb.unit', 'lab.hgb.reference_range', 'lab.hgb.collection_date', 'lab.hgb.abnormal',
    'lab.a1c.test_name', 'lab.a1c.value', 'lab.a1c.unit', 'lab.a1c.reference_range', 'lab.a1c.collection_date', 'lab.a1c.abnormal',
  ],
  intake_form: ['patient.name', 'patient.date_of_birth', 'patient.phone', 'chief_concern', 'medications', 'allergies', 'family_history'],
};

const schema = (documentType) => ({
  type: 'object',
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field_id: { type: 'string', enum: FIELDS[documentType] },
          value: { type: 'string' },
          quote: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['field_id', 'value', 'quote', 'page'],
      },
    },
  },
  required: ['fields'],
});

const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const safe = (value) => String(value || '').replace(/[|\r\n]/g, ' ').trim();

function locateQuote(field, pages) {
  const valueTokens = normalize(field.value).split(' ').filter(Boolean);
  const quoteTokens = normalize(field.quote).split(' ').filter(Boolean);
  if (!valueTokens.length || !quoteTokens.length || !quoteTokens.join(' ').includes(valueTokens.join(' '))) return null;
  const page = pages[field.page - 1];
  if (!page) return null;
  let best = null;
  for (let start = 0; start < page.lines.length; start++) {
    for (let end = start; end < Math.min(page.lines.length, start + 4); end++) {
      const lines = page.lines.slice(start, end + 1);
      const sourceTokens = new Set(normalize(lines.map((line) => line.text).join(' ')).split(' ').filter(Boolean));
      if (!valueTokens.every((token) => sourceTokens.has(token)) || !quoteTokens.every((token) => sourceTokens.has(token))) continue;
      const candidate = { lines, size: lines.length };
      if (!best || candidate.size < best.size) best = candidate;
    }
  }
  if (!best) return null;
  const lines = best.lines;
  return {
    quote: lines.map((line) => line.text).join(' '),
    page: field.page,
    box: [Math.min(...lines.map((line) => line.left)), Math.min(...lines.map((line) => line.top)), Math.max(...lines.map((line) => line.right)), Math.max(...lines.map((line) => line.bottom))],
    confidence: Math.min(...lines.map((line) => line.confidence)),
  };
}

function responseText(body) {
  if (typeof body?.output_text === 'string') return body.output_text;
  const parts = body?.output?.flatMap((item) => item.content || []) || [];
  return parts.find((part) => part.type === 'text' && typeof part.text === 'string')?.text || '';
}

export function createGeminiScanAdapter({ apiKey, model = MODEL_DEFAULT, timeoutMs = 45000, dailyLimit = 12, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('GEMINI_SCAN_API_KEY_REQUIRED');
  const requestLimit = Number.isFinite(dailyLimit) ? Math.max(1, Math.min(50, Math.floor(dailyLimit))) : 12;
  let budgetDay = new Date().toISOString().slice(0, 10);
  let requestsToday = 0;
  return {
    name: `google-${model}`,
    async extract({ documentType, pages }) {
      const allowedFields = FIELDS[documentType];
      if (!allowedFields || !Array.isArray(pages) || pages.length < 1 || pages.length > 6) throw new Error('GEMINI_SCAN_INPUT_INVALID');
      const imageBytes = pages.reduce((sum, page) => sum + Buffer.from(page.image_base64, 'base64').length, 0);
      if (imageBytes > MAX_INLINE_BYTES) throw new Error('GEMINI_SCAN_INLINE_LIMIT_EXCEEDED');
      const input = [{ type: 'text', text: `Read this synthetic ${documentType} form. Images are pages 1 through ${pages.length}, in order. Extract only these field_id values: ${allowedFields.join(', ')}. For each observed field, return its exact value as visibly written, a short exact source quote containing that value, and the 1-based page number. Omit absent or unreadable fields. Do not infer, normalize, or fill missing information. The quote must be visible in that image.` }];
      pages.forEach((page) => input.push({ type: 'image', mime_type: 'image/png', data: page.image_base64 }));
      const requestBody = JSON.stringify({
        model,
        input,
        response_format: { type: 'text', mime_type: 'application/json', schema: schema(documentType) },
        generation_config: { thinking_level: 'low', max_output_tokens: 2048 },
      });
      let response;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const today = new Date().toISOString().slice(0, 10);
        if (today !== budgetDay) { budgetDay = today; requestsToday = 0; }
        if (requestsToday >= requestLimit) throw new Error('GEMINI_SCAN_DAILY_LIMIT_REACHED');
        requestsToday++;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          response = await fetchImpl(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: requestBody,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (response.ok) break;
        const error = new Error(`GEMINI_SCAN_HTTP_${response.status}`);
        if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS - 1 || requestsToday >= requestLimit) throw error;
        const delayMs = retryDelayMs(response, attempt);
        if (delayMs === null) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const text = responseText(await response.json());
      let result;
      try { result = JSON.parse(text); } catch { throw new Error('GEMINI_SCAN_JSON_INVALID'); }
      if (!Array.isArray(result?.fields)) throw new Error('GEMINI_SCAN_FIELDS_INVALID');
      const fields = [];
      for (const field of result.fields) {
        if (!field || !allowedFields.includes(field.field_id) || typeof field.value !== 'string' || !field.value.trim() || typeof field.quote !== 'string' || !field.quote.trim() || !Number.isInteger(field.page) || field.page < 1 || field.page > pages.length) continue;
        const source = locateQuote(field, pages);
        if (!source) continue;
        fields.push({ field_id: field.field_id, label: field.field_id, value: field.value.trim(), quote: source.quote, page: source.page, box: source.box, confidence: source.confidence });
      }
      return { fields, model };
    },
  };
}
