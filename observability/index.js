const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const REDACTED = '[REDACTED]';
const SENSITIVE = /(patient|clinician|chart|prompt|response|text|excerpt|note|dob|address|phone|email|author|source[_-]?ref|content|raw|value|field|quote|image|screenshot|extracted)/i;

function redactPayload(value) {
  if (Array.isArray(value)) return value.map(redactPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE.test(key) ? REDACTED : redactPayload(item)]));
  }
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const isOperationalError = (trace) => trace.status === 'failure' || trace.status === 'deadline-exceeded';
const tracesInWindow = (traces, windowMs, now) => {
  if (!Number.isFinite(windowMs)) return traces;
  const cutoff = now - windowMs;
  return traces.filter((trace) => {
    const completedAt = Date.parse(trace.completedAt || trace.storedAt || '');
    return Number.isFinite(completedAt) && completedAt >= cutoff && completedAt <= now;
  });
};

class TraceRecorder {
  constructor({ correlationId, operation, interactionType = 'briefing', deadlineMs = null, scope = {}, clock = () => new Date().toISOString() }) {
    this.correlationId = correlationId;
    this.operation = operation;
    this.interactionType = interactionType;
    this.deadlineMs = deadlineMs;
    this.scope = scope;
    this.clock = clock;
    this.startedAt = this.clock();
    this.stages = [];
    this.retries = [];
    this.retrieval = { attempts: [] };
    this.handoffs = [];
    this.decisions = [];
    this.latency = { acknowledgementMs: null };
    this.modelUsage = [];
    // `cost_complete` starts true (no calls recorded yet -- a $0 total is
    // accurate for zero calls) and latches to false the moment any recorded
    // call's cost is unknown (`estimatedCostUsd` null/undefined). Once false,
    // `cost_usd` is `null` for the rest of the trace: a total that silently
    // summed an unknown-cost stage as $0 would understate real spend without
    // saying so (AGENTS.md: never present an unknown as $0). `cost_complete`
    // makes the same fact explicit for any caller that wants to distinguish
    // "no cost recorded" from "an unpriced call happened".
    this.modelTotals = { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0, cost_complete: true };
  }

  markAcknowledged() {
    this.latency.acknowledgementMs = Math.max(0, new Date(this.clock()) - new Date(this.startedAt));
  }

  startStage(name, attributes = {}) {
    this.current = { name, sequence: this.stages.length + 1, start: this.clock(), ...redactPayload(attributes) };
  }

  finishStage(name, attributes = {}) {
    const end = this.clock();
    if (!this.current || this.current.name !== name) throw new Error('STAGE_ORDER');
    this.stages.push({ ...this.current, end, durationMs: Math.max(0, new Date(end) - new Date(this.current.start)), ...redactPayload(attributes) });
    this.current = null;
  }

  recordRetrievalAttempt(attempt) { this.retrieval.attempts.push(redactPayload(attempt)); }
  recordHandoff(handoff) { this.handoffs.push(redactPayload(handoff)); }
  recordRetry(retry) { this.retries.push(redactPayload(retry)); }
  /** Supervisor routing decisions (`supervisor.js#decideNext`), W2-C6:
   * "routing decisions inspectable". `decision` is always `{next, reason}` --
   * fixed state names and reason codes, never a value -- so no redaction is
   * needed, but it still goes through `redactPayload` for defense in depth
   * against an unexpected extra key. */
  recordDecision(decision) { this.decisions.push(redactPayload(decision)); }
  recordModelUsage(model) {
    const redactedModel = redactPayload(model);
    const inputTokens = model.inputTokens || 0;
    const outputTokens = model.outputTokens || 0;
    const costKnown = model.estimatedCostUsd !== null && model.estimatedCostUsd !== undefined;

    // Append entry to usage list
    this.modelUsage.push(redactedModel);

    // Update running totals
    this.modelTotals.input_tokens += inputTokens;
    this.modelTotals.output_tokens += outputTokens;
    this.modelTotals.calls += 1;
    if (!costKnown) this.modelTotals.cost_complete = false;
    // Once incomplete, cost_usd stays null for the rest of the trace -- see
    // the constructor comment for why this is null rather than a partial sum.
    this.modelTotals.cost_usd = this.modelTotals.cost_complete
      ? Number(((this.modelTotals.cost_usd || 0) + Number(model.estimatedCostUsd || 0)).toFixed(8))
      : null;

    // Keep derived single-model view for backward compatibility (last entry + totals)
    this.model = redactPayload({
      ...redactedModel,
      inputTokens: this.modelTotals.input_tokens,
      outputTokens: this.modelTotals.output_tokens,
      estimatedCostUsd: this.modelTotals.cost_usd,
      totalTokens: this.modelTotals.input_tokens + this.modelTotals.output_tokens,
    });
  }
  setCoverage(value) { this.coverage = redactPayload(value); }
  setVerification(value) { this.verification = redactPayload(value); }
  setDisplay(value) { this.display = redactPayload(value); }
  setCache(value) { this.cache = redactPayload(value); }
  setExtraction(value) { this.extraction = redactPayload(value); }
  setEvaluation(value) { this.evaluation = redactPayload(value); }

  complete({ status, deadlineOutcome = 'not_applicable' }) {
    const completedAt = this.clock();
    const stageDuration = (names) => {
      const stage = this.stages.find((item) => names.includes(item.name));
      return stage ? stage.durationMs : null;
    };
    return redactPayload({
      schemaVersion: 2,
      correlationId: this.correlationId,
      operation: this.operation,
      interactionType: this.interactionType,
      deadlineMs: this.deadlineMs,
      deadlineOutcome,
      scope: this.scope,
      startedAt: this.startedAt,
      completedAt,
      durationMs: Math.max(0, new Date(completedAt) - new Date(this.startedAt)),
      latencyMs: {
        acknowledgement: this.latency.acknowledgementMs,
        retrieval: stageDuration(['retrieval']),
        synthesis: stageDuration(['synthesis', 'model']),
        verification: stageDuration(['verification']),
        display: stageDuration(['display']),
      },
      stages: this.stages,
      retrieval: this.retrieval,
      handoffs: this.handoffs,
      decisions: this.decisions,
      retries: { total: this.retries.length, events: this.retries, exhausted: false },
      model: this.model || {},
      modelUsage: this.modelUsage,
      modelTotals: this.modelTotals,
      coverage: this.coverage || {},
      verification: this.verification || {},
      display: this.display || {},
      extraction: this.extraction || { status: 'not_requested', confidence: null },
      evaluation: this.evaluation || { status: 'not_recorded' },
      cache: this.cache || { status: 'not_used' },
      status,
    });
  }
}

class InMemoryTraceSink {
  constructor({ maxTraces = 100 } = {}) {
    this.maxTraces = maxTraces;
    this.traces = [];
  }

  start(meta) {
    const trace = new TraceRecorder(meta);
    const original = trace.complete.bind(trace);
    trace.complete = (result) => {
      const value = original(result);
      this.record(value);
      return value;
    };
    return trace;
  }

  record(trace) {
    this.traces.push(redactPayload(trace));
    if (this.traces.length > this.maxTraces) this.traces.shift();
  }

  list() { return clone(this.traces); }

  snapshot({ windowMs = null, now = Date.now() } = {}) {
    const traces = tracesInWindow(this.traces, windowMs, now);
    const durations = traces.map((trace) => trace.durationMs || 0).sort((a, b) => a - b);
    const percentile = (p) => durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)] : 0;
    const interactionTypes = [...new Set(traces.map((trace) => trace.interactionType || 'unknown'))];
    const latencyByInteraction = Object.fromEntries(interactionTypes.map((interactionType) => {
      const values = traces.filter((trace) => (trace.interactionType || 'unknown') === interactionType).map((trace) => trace.durationMs || 0).sort((a, b) => a - b);
      const byPercentile = (p) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : 0;
      return [interactionType, { p50: byPercentile(.5), p95: byPercentile(.95), p99: byPercentile(.99) }];
    }));
    const deadlineOutcomes = traces.reduce((outcomes, trace) => { const key = trace.deadlineOutcome || 'not_applicable'; outcomes[key] = (outcomes[key] || 0) + 1; return outcomes; }, {});
    const cacheOutcomes = traces.reduce((outcomes, trace) => { const key = trace.cache?.status || 'not_used'; outcomes[key] = (outcomes[key] || 0) + 1; return outcomes; }, {});
    const errors = traces.filter(isOperationalError).length;
    const retrievalAttempts = traces.reduce((total, trace) => total + (trace.retrieval?.attempts?.length || 0), 0);
    const toolFailures = traces.reduce((total, trace) => total + (trace.retrieval?.attempts || []).filter((attempt) => ['failed', 'timeout'].includes(attempt.status)).length, 0);
    const retries = traces.reduce((total, trace) => total + (trace.retries?.total || 0), 0);
    const providerFallbacks = traces.filter((trace) => trace.model?.provider_fallback === true).length;
    // A trace whose modelTotals.cost_complete is false has at least one
    // recorded call with no known cost (TraceRecorder#recordModelUsage) --
    // its cost_usd is null, so it contributes nothing here (never a silent
    // 0-for-unknown). `costComplete`/`tracesWithUnknownCost` say so
    // explicitly, so a caller never mistakes a partial sum for the full
    // window spend.
    const tracesWithUnknownCost = traces.filter((trace) => trace.modelTotals?.cost_complete === false).length;
    const estimatedCostUsd = traces.reduce((total, trace) => {
      if (trace.modelTotals) return total + Number(trace.modelTotals.cost_usd || 0);
      return total + Number(trace.model?.estimatedCostUsd || trace.model?.estimated_cost_usd || 0);
    }, 0);
    const inputTokens = traces.reduce((total, trace) => {
      if (trace.modelTotals) return total + Number(trace.modelTotals.input_tokens || 0);
      return total + Number(trace.model?.inputTokens || trace.model?.input_tokens || 0);
    }, 0);
    const outputTokens = traces.reduce((total, trace) => {
      if (trace.modelTotals) return total + Number(trace.modelTotals.output_tokens || 0);
      return total + Number(trace.model?.outputTokens || trace.model?.output_tokens || 0);
    }, 0);
    return {
      requests: traces.length,
      errors,
      errorRate: traces.length ? errors / traces.length : 0,
      latencyMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) },
      latencyByInteraction,
      deadlineOutcomes,
      cacheOutcomes,
      windowMs,
      queueDepth: 0,
      retrievalAttempts,
      toolFailures,
      toolFailureRate: retrievalAttempts ? toolFailures / retrievalAttempts : 0,
      retries,
      providerFallbacks,
      estimatedCostUsd,
      costComplete: tracesWithUnknownCost === 0,
      tracesWithUnknownCost,
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      verificationOutcomes: traces.reduce((outcomes, trace) => { const key = trace.verification?.status || 'unknown'; outcomes[key] = (outcomes[key] || 0) + 1; return outcomes; }, {}),
      displayOutcomes: traces.reduce((outcomes, trace) => { const key = trace.display?.status || 'unknown'; outcomes[key] = (outcomes[key] || 0) + 1; return outcomes; }, {}),
    };
  }

  health() { return { status: 'ok', durable: false }; }
}

class FileTraceSink extends InMemoryTraceSink {
  constructor({ filePath, maxTraces = 100, retentionMs = 24 * 60 * 60 * 1000, clock = () => new Date().toISOString() } = {}) {
    if (!filePath) throw new Error('TRACE_FILE_PATH_REQUIRED');
    super({ maxTraces });
    this.filePath = filePath;
    this.retentionMs = retentionMs;
    this.clock = clock;
    this.persistQueue = Promise.resolve();
    this.pendingWrites = 0;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.lastPersistError = null;
    this.traces = this.readFromDisk();
    this.prune(this.clock());
  }

  readStore(filePath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('TRACE_STORE_INVALID');
      return parsed.map(redactPayload);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  readFromDisk() { return this.readStore(this.filePath); }

  async persist() {
    try {
      const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      await fsp.writeFile(temporaryPath, `${JSON.stringify(this.traces)}\n`, { encoding: 'utf8', mode: 0o600 });
      try {
        await fsp.rename(temporaryPath, this.filePath);
      } catch (error) {
        if (!['EPERM', 'EEXIST'].includes(error.code)) throw error;
        await fsp.rm(this.filePath, { force: true });
        await fsp.rename(temporaryPath, this.filePath);
      }
      this.lastPersistError = null;
    } catch (error) {
      this.lastPersistError = 'TRACE_STORE_WRITE_FAILED';
      throw error;
    }
  }

  enqueuePersist() {
    this.pendingWrites += 1;
    this.persistQueue = this.persistQueue.catch(() => {}).then(() => this.persist()).finally(() => { this.pendingWrites -= 1; });
    this.persistQueue.catch(() => {});
    return this.persistQueue;
  }

  async flush() { await this.persistQueue; }

  prune(now) {
    const cutoff = new Date(now).getTime() - this.retentionMs;
    const retained = this.traces.filter((trace) => new Date(trace.storedAt || trace.completedAt || 0).getTime() > cutoff);
    if (retained.length > this.maxTraces) retained.splice(0, retained.length - this.maxTraces);
    const removed = this.traces.length - retained.length;
    this.traces = retained;
    return removed;
  }

  record(trace) {
    const storedAt = this.clock();
    this.traces.push({ ...redactPayload(trace), storedAt });
    this.prune(storedAt);
    this.enqueuePersist();
  }

  purgeExpired(now = this.clock()) {
    const removed = this.prune(now);
    if (removed) this.enqueuePersist();
    return removed;
  }

  list() {
    this.purgeExpired();
    return clone(this.traces);
  }

  deleteAll() {
    const deleted = this.traces.length;
    this.traces = [];
    this.enqueuePersist();
    return deleted;
  }

  async backup(backupPath) {
    if (!backupPath) throw new Error('TRACE_BACKUP_PATH_REQUIRED');
    await this.flush();
    this.purgeExpired();
    await this.flush();
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(this.filePath, backupPath);
    fs.chmodSync(backupPath, 0o600);
    return { path: backupPath, records: this.traces.length };
  }

  async restore(backupPath) {
    if (!backupPath) throw new Error('TRACE_BACKUP_PATH_REQUIRED');
    const restored = this.readStore(backupPath);
    this.traces = restored;
    this.prune(this.clock());
    await this.enqueuePersist();
    return { records: this.traces.length };
  }

  health() {
    let writable = true;
    try { fs.accessSync(path.dirname(this.filePath), fs.constants.W_OK); } catch { writable = false; }
    return { status: writable && !this.lastPersistError ? 'ok' : 'not_ready', durable: true, writable, pendingWrites: this.pendingWrites, retentionMs: this.retentionMs, errorCode: writable ? this.lastPersistError : 'TRACE_STORE_UNAVAILABLE' };
  }
}

/**
 * Export already-redacted AgentForge traces to Langfuse's v4 OTLP endpoint.
 * The exporter sends operational metadata only; local persistence remains the
 * fail-safe when Langfuse is unavailable.
 */
class LangfuseOtelExporter {
  constructor({
    baseUrl = process.env.LANGFUSE_BASE_URL,
    publicKey = process.env.LANGFUSE_PUBLIC_KEY,
    secretKey = process.env.LANGFUSE_SECRET_KEY,
    timeoutMs = Number(process.env.LANGFUSE_TIMEOUT_MS || 3000),
    fetchImpl = globalThis.fetch,
    idFactory = (bytes) => crypto.randomBytes(bytes).toString('hex'),
    now = () => Date.now(),
  } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.publicKey = publicKey || '';
    this.secretKey = secretKey || '';
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.idFactory = idFactory;
    this.now = now;
    this.lastExport = null;
    this.lastErrorCode = null;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.publicKey && this.secretKey && typeof this.fetchImpl === 'function');
  }

  status() {
    return { configured: this.isConfigured(), lastExport: this.lastExport, lastErrorCode: this.lastErrorCode };
  }

  /** Send one safe OTLP span without throwing into the request lifecycle. */
  async export(trace) {
    if (!this.isConfigured()) return { status: 'disabled' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const safeTrace = operationalTrace(trace);
      const traceId = this.idFactory(16);
      const spanId = this.idFactory(8);
      const attributes = [
        otelAttribute('service.name', 'agentforge'),
        otelAttribute('agentforge.operation', safeTrace.operation || 'unknown'),
        otelAttribute('agentforge.status', safeTrace.status || 'unknown'),
        otelAttribute('agentforge.correlation_id', safeTrace.correlationId || 'unknown'),
        otelAttribute('agentforge.trace', JSON.stringify(safeTrace)),
      ];
      const response = await this.fetchImpl(`${this.baseUrl}/api/public/otel/v1/traces`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Basic ${Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64')}`,
          'content-type': 'application/json',
          'x-langfuse-ingestion-version': '4',
        },
        body: JSON.stringify({
          resourceSpans: [{
            resource: { attributes: [otelAttribute('service.name', 'agentforge')] },
            scopeSpans: [{ spans: [{ name: safeTrace.operation || 'agentforge.request', traceId, spanId, startTimeUnixNano: toUnixNanos(safeTrace.startedAt, this.now), endTimeUnixNano: toUnixNanos(safeTrace.completedAt, this.now), attributes }] }],
          }],
        }),
      });
      if (!response?.ok) throw new Error(`HTTP_${response?.status || 'UNKNOWN'}`);
      this.lastExport = 'success';
      this.lastErrorCode = null;
      return { status: 'exported' };
    } catch (error) {
      const errorCode = error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.message || 'EXPORT_FAILED').split(':')[0].slice(0, 64);
      this.lastExport = 'failure';
      this.lastErrorCode = errorCode;
      return { status: 'failed', errorCode };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Durable local traces plus optional asynchronous Langfuse export. Langfuse
 * is never part of readiness or response correctness.
 */
class LangfuseTraceSink extends FileTraceSink {
  constructor({ exporter = new LangfuseOtelExporter(), onExportError = () => {}, maxPendingExports = Number(process.env.LANGFUSE_MAX_PENDING_EXPORTS || 16), ...options } = {}) {
    super(options);
    this.exporter = exporter;
    this.onExportError = onExportError;
    this.maxPendingExports = Math.max(1, maxPendingExports);
    this.pendingExports = 0;
    this.droppedExports = 0;
  }

  record(trace) {
    super.record(trace);
    if (!this.exporter?.isConfigured?.()) return;
    if (this.pendingExports >= this.maxPendingExports) {
      this.droppedExports += 1;
      this.onExportError({ correlationId: trace.correlationId, errorCode: 'EXPORT_QUEUE_FULL' });
      return;
    }
    this.pendingExports += 1;
    Promise.resolve(this.exporter.export(trace)).then((result) => {
      if (result?.status === 'failed') this.onExportError({ correlationId: trace.correlationId, errorCode: result.errorCode });
    }).catch(() => this.onExportError({ correlationId: trace.correlationId, errorCode: 'EXPORT_FAILED' })).finally(() => { this.pendingExports -= 1; });
  }

  snapshot(options = {}) {
    const snapshot = super.snapshot(options);
    const langfuse = this.exporter?.status?.() || { configured: false };
    return {
      ...snapshot,
      queueDepth: this.pendingExports,
      telemetry: {
        backend: 'local_file',
        exporterConfigured: Boolean(langfuse.configured),
        lastExport: langfuse.lastExport || null,
        lastErrorCode: langfuse.lastErrorCode || null,
        pendingExports: this.pendingExports,
        droppedExports: this.droppedExports,
        maxPendingExports: this.maxPendingExports,
      },
    };
  }

  health() {
    return { ...super.health(), langfuse: { ...(this.exporter?.status?.() || { configured: false }), pendingExports: this.pendingExports, droppedExports: this.droppedExports, maxPendingExports: this.maxPendingExports } };
  }
}

class MetricsRegistry {
  constructor() { this.traces = []; this.queueDepth = 0; }
  setQueueDepth(value) { this.queueDepth = value; }
  observe(trace) { this.traces.push(trace); }
  snapshot({ windowMs = null, now = Date.now() } = {}) {
    const traces = tracesInWindow(this.traces, windowMs, now);
    const durations = traces.map((trace) => trace.durationMs || 0).sort((a, b) => a - b);
    const percentile = (p) => durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)] : 0;
    const errors = traces.filter(isOperationalError).length;
    const retrievalAttempts = traces.reduce((total, trace) => total + (trace.retrieval?.attempts?.length || 0), 0);
    const toolFailures = traces.reduce((total, trace) => total + (trace.retrieval?.attempts || []).filter((attempt) => ['failed', 'timeout'].includes(attempt.status)).length, 0);
    return { requests: traces.length, errors, errorRate: traces.length ? errors / traces.length : 0, latencyMs: { p50: percentile(.5), p95: percentile(.95) }, queueDepth: this.queueDepth, retrievalAttempts, toolFailures, toolFailureRate: retrievalAttempts ? toolFailures / retrievalAttempts : 0, windowMs };
  }
}

function evaluateAlerts(snapshot, { p95LatencyMs = 2000, errorRate = 0.05, toolFailureRate = 0.02 } = {}) {
  const rules = [
    { id: 'p95_latency', metric: 'latencyMs.p95', threshold: p95LatencyMs, observed: snapshot.latencyMs?.p95 || 0, operator: '>', triggered: (snapshot.latencyMs?.p95 || 0) > p95LatencyMs },
    { id: 'error_rate', metric: 'errorRate', threshold: errorRate, observed: snapshot.errorRate || 0, operator: '>', triggered: (snapshot.errorRate || 0) > errorRate },
    { id: 'tool_failure_rate', metric: 'toolFailureRate', threshold: toolFailureRate, observed: snapshot.toolFailureRate || 0, operator: '>', triggered: (snapshot.toolFailureRate || 0) > toolFailureRate },
  ];
  const fired = rules.filter((rule) => rule.triggered).map((rule) => rule.id);
  return { status: fired.length ? 'firing' : 'ok', fired, rules, windowMs: snapshot.windowMs ?? null };
}

function createReadinessChecker(dependencies) {
  return {
    health: () => ({ status: 'ok' }),
    ready: async () => {
      const result = {};
      let ok = true;
      for (const [name, dependency] of Object.entries(dependencies)) {
        try {
          const ready = await dependency.checkReady();
          result[name] = { status: ready ? 'ready' : 'not_ready' };
          if (!ready) ok = false;
        } catch {
          result[name] = { status: 'not_ready', errorCode: 'CHECK_FAILED' };
          ok = false;
        }
      }
      return { status: ok ? 'ready' : 'not_ready', dependencies: result };
    },
  };
}

function otelAttribute(key, value) {
  return { key, value: { stringValue: String(value) } };
}

/** Keep the external trace contract narrower than the local redacted record. */
function operationalTrace(trace = {}) {
  const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
  return {
    schemaVersion: trace.schemaVersion,
    correlationId: trace.correlationId,
    operation: trace.operation,
    interactionType: trace.interactionType,
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    deadlineMs: trace.deadlineMs,
    deadlineOutcome: trace.deadlineOutcome,
    durationMs: trace.durationMs,
    latencyMs: pick(trace.latencyMs, ['acknowledgement', 'retrieval', 'synthesis', 'verification', 'display']),
    stages: Array.isArray(trace.stages) ? trace.stages.map((stage) => pick(stage, ['name', 'sequence', 'durationMs', 'status', 'provider_status'])) : [],
    retrieval: { attempts: Array.isArray(trace.retrieval?.attempts) ? trace.retrieval.attempts.map((attempt) => pick(attempt, ['adapter', 'group', 'status', 'attempts', 'errorCode'])) : [] },
    handoffs: Array.isArray(trace.handoffs) ? trace.handoffs.map((handoff) => pick(handoff, ['worker', 'status', 'input_type', 'output_status'])) : [],
    decisions: Array.isArray(trace.decisions) ? trace.decisions.map((decision) => pick(decision, ['next', 'reason'])) : [],
    retries: { total: trace.retries?.total || 0, exhausted: Boolean(trace.retries?.exhausted) },
    model: pick(trace.model, ['provider', 'provider_name', 'model', 'model_name', 'totalTokens', 'inputTokens', 'outputTokens', 'estimatedCostUsd', 'provider_fallback', 'provider_status', 'provider_error_code']),
    modelUsage: Array.isArray(trace.modelUsage) ? trace.modelUsage.map((usage) => pick(usage, ['stage', 'provider', 'provider_name', 'model', 'model_name', 'inputTokens', 'outputTokens', 'estimatedCostUsd'])) : [],
    modelTotals: trace.modelTotals ? pick(trace.modelTotals, ['input_tokens', 'output_tokens', 'cost_usd', 'calls', 'cost_complete']) : { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0, cost_complete: true },
    coverage: pick(trace.coverage, ['status', 'groups']),
    // `evidence_grounding`/`patient_scope`/`read_only` are the briefing lane's
    // own verification shape (preVisitPreparation.js); `composer` through
    // `reason_codes` are the scan-supervisor runtime-encounter verification
    // summary (runtimeEvaluation.js) -- counts and reason codes only, never
    // claim text or extracted values.
    verification: pick(trace.verification, ['status', 'evidence_grounding', 'patient_scope', 'read_only', 'composer', 'claims_proposed', 'claims_verified', 'claims_dropped', 'record_claims_count', 'guideline_evidence_count', 'needs_review_count', 'reason_codes']),
    display: pick(trace.display, ['status']),
    extraction: pick(trace.extraction, ['status', 'confidence']),
    // `caseType`/`outcome` are the briefing lane's own evaluation shape
    // (preVisitPreparation.js); `kind` through `read_back` are the
    // scan-supervisor per-encounter runtime evaluation (runtimeEvaluation.js,
    // `kind: 'runtime_encounter'`) -- fixed status/reason codes only.
    evaluation: pick(trace.evaluation, ['status', 'caseType', 'outcome', 'kind', 'final_state', 'stop_reason', 'qualification_reasons', 'issues', 'read_back']),
    cache: pick(trace.cache, ['status']),
    status: trace.status,
  };
}

function toUnixNanos(value, now) {
  const milliseconds = Date.parse(value || '');
  return String(Number.isFinite(milliseconds) ? Math.max(0, milliseconds) * 1_000_000 : Math.max(0, now()) * 1_000_000);
}

module.exports = { redactPayload, TraceRecorder, InMemoryTraceSink, FileTraceSink, LangfuseOtelExporter, LangfuseTraceSink, MetricsRegistry, evaluateAlerts, createReadinessChecker };
