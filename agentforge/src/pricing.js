/**
 * Small per-token price table for observability cost estimation (W2-S3/S9).
 *
 * Every entry states its source and a `retrieved_at` date. Prices confirmed
 * from an official provider pricing page are `estimate: false`; anything
 * this environment could not confirm against a live pricing page is
 * `estimate: true` and says so in `source` — never silently presented as a
 * measured number.
 */
export const PRICE_TABLE = Object.freeze({
  'google/gemini-embedding-2': {
    input_per_million_usd: 0.20,
    output_per_million_usd: 0,
    source: 'https://ai.google.dev/gemini-api/docs/pricing (Gemini Embedding 2, text input)',
    retrieved_at: '2026-09-24',
    estimate: false,
  },
  'google/gemini-3.8-flash': {
    input_per_million_usd: 0.75,
    output_per_million_usd: 3.75,
    source: 'https://ai.google.dev/gemini-api/docs/pricing (Gemini 3.8 Flash, standard tier)',
    retrieved_at: '2026-09-24',
    estimate: false,
    // Confirmed on the same pricing page: both rates double to $1.50/$7.50
    // per 1M tokens starting this date. `estimateCostUsd` always uses the
    // current (pre-increase) rate above; callers projecting cost past this
    // date must account for the increase themselves.
    price_increases_after: '2027-01-01',
    price_after_increase: { input_per_million_usd: 1.50, output_per_million_usd: 7.50 },
  },
  // The deployed Qwen synthesis lane and the OpenRouter-hosted conversation
  // lane route through OpenRouter, whose per-model price varies by route and
  // was not reachable/confirmed as a fixed number from this environment.
  // Marked as an estimate pending a confirmed OpenRouter invoice figure.
  'openrouter/qwen-default': {
    input_per_million_usd: 0.40,
    output_per_million_usd: 0.40,
    source: 'estimate — OpenRouter per-model pricing varies by route/model selection and was not confirmed from this environment',
    retrieved_at: '2026-09-24',
    estimate: true,
  },
  'openrouter/google/gemini-2.5-flash-lite': {
    input_per_million_usd: 0.10,
    output_per_million_usd: 0.40,
    source: 'estimate — OpenRouter-listed Gemini 2.5 Flash-Lite rate was not independently confirmed from this environment',
    retrieved_at: '2026-09-24',
    estimate: true,
  },
});

/**
 * Estimate USD cost for one model call.
 *
 * Args:
 *   priceKey: A key into `PRICE_TABLE` (e.g. `"google/gemini-embedding-2"`).
 *   usage: `{ inputTokens, outputTokens }`, either defaulting to 0.
 *
 * Returns:
 *   The estimated cost in USD (rounded to 8 decimal places), or `null` if
 *   `priceKey` is not in the table — callers must not guess a price for an
 *   unlisted model.
 */
export function estimateCostUsd(priceKey, { inputTokens = 0, outputTokens = 0 } = {}) {
  const price = PRICE_TABLE[priceKey];
  if (!price) return null;
  const cost = (inputTokens / 1_000_000) * price.input_per_million_usd + (outputTokens / 1_000_000) * price.output_per_million_usd;
  return Number(cost.toFixed(8));
}

/** Whether `priceKey`'s price is a confirmed figure (`false`) or an estimate (`true`); `null` if the key is unlisted. */
export function isPriceEstimated(priceKey) {
  return PRICE_TABLE[priceKey]?.estimate ?? null;
}
