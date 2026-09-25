const test = require('node:test');
const assert = require('node:assert/strict');
const { TraceRecorder, InMemoryTraceSink, redactPayload } = require('../index');

test('accumulates multiple model usage records in a list', () => {
  const trace = new TraceRecorder({
    correlationId: 'corr-multi-model',
    operation: 'briefing',
    clock: (() => { let i = 0; return () => new Date(1000 + (i++) * 25).toISOString(); })(),
  });

  // First model call (embeddings)
  trace.recordModelUsage({
    provider: 'openai',
    model: 'text-embedding-3-small',
    inputTokens: 100,
    outputTokens: 0,
    estimatedCostUsd: 0.002,
  });

  // Second model call (rerank)
  trace.recordModelUsage({
    provider: 'cohere',
    model: 'rerank-v3',
    inputTokens: 500,
    outputTokens: 50,
    estimatedCostUsd: 0.005,
  });

  // Third model call (answer generation)
  trace.recordModelUsage({
    provider: 'openai',
    model: 'gpt-4',
    inputTokens: 1000,
    outputTokens: 200,
    estimatedCostUsd: 0.03,
  });

  const completed = trace.complete({ status: 'success' });

  // Verify list contains all entries
  assert.equal(completed.modelUsage.length, 3);
  assert.equal(completed.modelUsage[0].model, 'text-embedding-3-small');
  assert.equal(completed.modelUsage[1].model, 'rerank-v3');
  assert.equal(completed.modelUsage[2].model, 'gpt-4');

  // Verify totals are summed
  assert.equal(completed.modelTotals.input_tokens, 1600);
  assert.equal(completed.modelTotals.output_tokens, 250);
  assert.equal(completed.modelTotals.cost_usd, 0.037);
  assert.equal(completed.modelTotals.calls, 3);

  // Verify backward-compatible single model view has summed totals
  assert.equal(completed.model.inputTokens, 1600);
  assert.equal(completed.model.outputTokens, 250);
  assert.equal(completed.model.estimatedCostUsd, 0.037);
  assert.equal(completed.model.totalTokens, 1850);
});

test('preserves model data in list while updating single view', () => {
  const trace = new TraceRecorder({
    correlationId: 'corr-preserve',
    operation: 'briefing',
  });

  trace.recordModelUsage({
    provider: 'openai',
    model: 'gpt-4',
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.01,
    provider_fallback: false,
    provider_status: 'success',
  });

  const completed = trace.complete({ status: 'success' });

  // Verify first entry is preserved as-is
  assert.equal(completed.modelUsage[0].provider, 'openai');
  assert.equal(completed.modelUsage[0].model, 'gpt-4');
  assert.equal(completed.modelUsage[0].provider_fallback, false);
  assert.equal(completed.modelUsage[0].provider_status, 'success');

  // Verify single view contains last entry's provider/model with totals
  assert.equal(completed.model.provider, 'openai');
  assert.equal(completed.model.model, 'gpt-4');
  assert.equal(completed.model.provider_fallback, false);
  assert.equal(completed.model.inputTokens, 100);
  assert.equal(completed.model.outputTokens, 50);
  assert.equal(completed.model.estimatedCostUsd, 0.01);
});

test('trace with no model calls has empty list and zero totals', () => {
  const sink = new InMemoryTraceSink();
  const trace = sink.start({
    correlationId: 'corr-no-model',
    operation: 'briefing',
  });

  const completed = trace.complete({ status: 'success' });

  assert.equal(completed.modelUsage.length, 0);
  assert.deepEqual(completed.modelTotals, {
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    calls: 0,
    cost_complete: true,
  });

  // Single model view should be empty
  assert.deepEqual(completed.model, {});
});

test('redaction applies to model usage list but preserves numeric fields', () => {
  const trace = new TraceRecorder({
    correlationId: 'corr-redact',
    operation: 'briefing',
  });

  trace.recordModelUsage({
    provider: 'openai',
    model: 'gpt-4',
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.01,
    prompt_content: 'secret patient info',
    raw_response: 'sensitive data',
  });

  const completed = trace.complete({ status: 'success' });

  // Verify sensitive fields are redacted
  assert.equal(completed.modelUsage[0].prompt_content, '[REDACTED]');
  assert.equal(completed.modelUsage[0].raw_response, '[REDACTED]');

  // Verify numeric fields are preserved
  assert.equal(completed.modelUsage[0].inputTokens, 100);
  assert.equal(completed.modelUsage[0].outputTokens, 50);
  assert.equal(completed.modelUsage[0].estimatedCostUsd, 0.01);

  // Verify totals numeric fields are preserved
  assert.equal(completed.modelTotals.input_tokens, 100);
  assert.equal(completed.modelTotals.output_tokens, 50);
  assert.equal(completed.modelTotals.cost_usd, 0.01);
});

test('aggregated trace totals sum across all model calls', () => {
  const sink = new InMemoryTraceSink();

  // First trace with two model calls
  const trace1 = sink.start({ correlationId: 'corr-1', operation: 'briefing' });
  trace1.recordModelUsage({ provider: 'openai', model: 'gpt-4', inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.01 });
  trace1.recordModelUsage({ provider: 'openai', model: 'gpt-4', inputTokens: 200, outputTokens: 100, estimatedCostUsd: 0.02 });
  trace1.complete({ status: 'success' });

  // Second trace with one model call
  const trace2 = sink.start({ correlationId: 'corr-2', operation: 'conversation_followup' });
  trace2.recordModelUsage({ provider: 'openai', model: 'gpt-4', inputTokens: 300, outputTokens: 150, estimatedCostUsd: 0.03 });
  trace2.complete({ status: 'success' });

  const snapshot = sink.snapshot();

  // Verify snapshot totals are aggregated across all traces
  assert.equal(snapshot.tokens.input, 600); // 100 + 200 + 300
  assert.equal(snapshot.tokens.output, 300); // 50 + 100 + 150
  assert.equal(snapshot.tokens.total, 900);
  assert.equal(snapshot.estimatedCostUsd, 0.06); // 0.01 + 0.02 + 0.03
});

test('each recorded model usage increments call count', () => {
  const trace = new TraceRecorder({
    correlationId: 'corr-call-count',
    operation: 'briefing',
  });

  trace.recordModelUsage({ provider: 'openai', model: 'gpt-4', inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.01 });
  trace.recordModelUsage({ provider: 'openai', model: 'gpt-4', inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.01 });
  trace.recordModelUsage({ provider: 'openai', model: 'gpt-4', inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.01 });

  const completed = trace.complete({ status: 'success' });

  assert.equal(completed.modelTotals.calls, 3);
});

test('backward-compatible single model view works with dashboard', () => {
  const trace = new TraceRecorder({
    correlationId: 'corr-dashboard',
    operation: 'briefing',
  });

  trace.recordModelUsage({
    provider: 'openai',
    model: 'gpt-4',
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.01,
    provider_fallback: false,
  });

  trace.recordModelUsage({
    provider: 'openai',
    model: 'gpt-4',
    inputTokens: 200,
    outputTokens: 100,
    estimatedCostUsd: 0.02,
    provider_fallback: true,
  });

  const completed = trace.complete({ status: 'success' });

  // Dashboard reads trace.model?.model
  const displayModel = completed.model?.model || 'No model call';
  assert.equal(displayModel, 'gpt-4');

  // Dashboard reads trace.model?.provider_fallback
  const isFallback = completed.model?.provider_fallback ? ' · fallback' : ' · primary';
  assert.equal(isFallback, ' · fallback'); // Last entry's fallback status

  // Verify totals reflect all calls
  assert.equal(completed.model?.inputTokens, 300);
  assert.equal(completed.model?.outputTokens, 150);
  assert.equal(completed.model?.estimatedCostUsd, 0.03);
});

test('a trace with one unknown-cost stage never reports a silent full/partial total as if it were complete', () => {
  const trace = new TraceRecorder({
    correlationId: 'corr-unknown-cost',
    operation: 'briefing',
  });

  // Known-cost stage (e.g. Gemini embeddings, priced in pricing.js).
  trace.recordModelUsage({ stage: 'embed', provider: 'google', model: 'gemini-embedding-2', inputTokens: 1000, outputTokens: 0, estimatedCostUsd: 0.0002 });
  // Unknown-cost stage (e.g. a model with no confirmed price) -- estimatedCostUsd
  // is `null`, exactly what modelProvider.js's `resolveCostUsd` and
  // pricing.js's `estimateCostUsd` return for an unpriced call, never `0`.
  trace.recordModelUsage({ stage: 'answer', provider: 'some-provider', model: 'unpriced-model', inputTokens: 500, outputTokens: 200, estimatedCostUsd: null });

  const completed = trace.complete({ status: 'success' });

  // The per-stage list keeps the real (null) value -- it is never coerced to 0.
  assert.equal(completed.modelUsage[0].estimatedCostUsd, 0.0002);
  assert.equal(completed.modelUsage[1].estimatedCostUsd, null);

  // The trace total must not silently present a $0.0002 total as if that were
  // the whole trace's cost -- cost_usd is null and cost_complete is false,
  // never a bare partial number a caller could mistake for the full spend.
  assert.equal(completed.modelTotals.cost_complete, false);
  assert.equal(completed.modelTotals.cost_usd, null);
  assert.equal(completed.modelTotals.input_tokens, 1500);
  assert.equal(completed.modelTotals.output_tokens, 200);
  assert.equal(completed.modelTotals.calls, 2);

  // The backward-compatible single-model view must agree: null, not 0 and
  // not the partial 0.0002 sum.
  assert.equal(completed.model.estimatedCostUsd, null);
});

test('a trace where every stage has a known cost is cost_complete with a real total', () => {
  const trace = new TraceRecorder({ correlationId: 'corr-known-cost', operation: 'briefing' });
  trace.recordModelUsage({ stage: 'embed', provider: 'google', model: 'gemini-embedding-2', inputTokens: 1000, outputTokens: 0, estimatedCostUsd: 0.0002 });
  trace.recordModelUsage({ stage: 'rerank', provider: 'alibaba-qwen', model: 'qwen3.8-flash', inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.00001 });
  const completed = trace.complete({ status: 'success' });
  assert.equal(completed.modelTotals.cost_complete, true);
  assert.equal(completed.modelTotals.cost_usd, 0.00021);
});
