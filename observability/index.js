const fs = require('node:fs');
const path = require('node:path');

const REDACTED = '[REDACTED]';
const SENSITIVE = /(patient|chart|prompt|response|text|excerpt|note|dob|address|phone|email|author)/i;

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
    this.latency = { acknowledgementMs: null };
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
  recordRetry(retry) { this.retries.push(redactPayload(retry)); }
  recordModelUsage(model) { this.model = redactPayload({ ...model, totalTokens: (model.inputTokens || 0) + (model.outputTokens || 0) }); }
  setCoverage(value) { this.coverage = redactPayload(value); }
  setVerification(value) { this.verification = redactPayload(value); }
  setDisplay(value) { this.display = redactPayload(value); }
  setCache(value) { this.cache = redactPayload(value); }

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
      retries: { total: this.retries.length, events: this.retries, exhausted: false },
      model: this.model || {},
      coverage: this.coverage || {},
      verification: this.verification || {},
      display: this.display || {},
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

  snapshot() {
    const durations = this.traces.map((trace) => trace.durationMs || 0).sort((a, b) => a - b);
    const percentile = (p) => durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)] : 0;
    const interactionTypes = [...new Set(this.traces.map((trace) => trace.interactionType || 'unknown'))];
    const latencyByInteraction = Object.fromEntries(interactionTypes.map((interactionType) => {
      const values = this.traces.filter((trace) => (trace.interactionType || 'unknown') === interactionType).map((trace) => trace.durationMs || 0).sort((a, b) => a - b);
      const byPercentile = (p) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : 0;
      return [interactionType, { p50: byPercentile(.5), p95: byPercentile(.95), p99: byPercentile(.99) }];
    }));
    const deadlineOutcomes = this.traces.reduce((outcomes, trace) => { const key = trace.deadlineOutcome || 'not_applicable'; outcomes[key] = (outcomes[key] || 0) + 1; return outcomes; }, {});
    const cacheOutcomes = this.traces.reduce((outcomes, trace) => { const key = trace.cache?.status || 'not_used'; outcomes[key] = (outcomes[key] || 0) + 1; return outcomes; }, {});
    const errors = this.traces.filter((trace) => trace.status !== 'success').length;
    const retrievalAttempts = this.traces.reduce((total, trace) => total + (trace.retrieval?.attempts?.length || 0), 0);
    const toolFailures = this.traces.reduce((total, trace) => total + (trace.retrieval?.attempts || []).filter((attempt) => ['failed', 'timeout'].includes(attempt.status)).length, 0);
    const retries = this.traces.reduce((total, trace) => total + (trace.retries?.total || 0), 0);
    const providerFallbacks = this.traces.filter((trace) => trace.model?.provider_fallback === true).length;
    const estimatedCostUsd = this.traces.reduce((total, trace) => total + Number(trace.model?.estimatedCostUsd || trace.model?.estimated_cost_usd || 0), 0);
    return {
      requests: this.traces.length,
      errors,
      errorRate: this.traces.length ? errors / this.traces.length : 0,
      latencyMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) },
      latencyByInteraction,
      deadlineOutcomes,
      cacheOutcomes,
      queueDepth: 0,
      retrievalAttempts,
      toolFailures,
      toolFailureRate: retrievalAttempts ? toolFailures / retrievalAttempts : 0,
      retries,
      providerFallbacks,
      estimatedCostUsd,
      verificationOutcomes: this.traces.reduce((outcomes, trace) => { const key = trace.verification?.status || 'unknown'; outcomes[key] = (outcomes[key] || 0) + 1; return outcomes; }, {}),
      displayOutcomes: this.traces.reduce((outcomes, trace) => { const key = trace.display?.status || 'unknown'; outcomes[key] = (outcomes[key] || 0) + 1; return outcomes; }, {}),
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

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.traces)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      if (!['EPERM', 'EEXIST'].includes(error.code)) throw error;
      fs.rmSync(this.filePath, { force: true });
      fs.renameSync(temporaryPath, this.filePath);
    }
  }

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
    this.persist();
  }

  purgeExpired(now = this.clock()) {
    const removed = this.prune(now);
    if (removed) this.persist();
    return removed;
  }

  list() {
    this.purgeExpired();
    return clone(this.traces);
  }

  deleteAll() {
    const deleted = this.traces.length;
    this.traces = [];
    this.persist();
    return deleted;
  }

  backup(backupPath) {
    if (!backupPath) throw new Error('TRACE_BACKUP_PATH_REQUIRED');
    this.purgeExpired();
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(this.filePath, backupPath);
    fs.chmodSync(backupPath, 0o600);
    return { path: backupPath, records: this.traces.length };
  }

  restore(backupPath) {
    if (!backupPath) throw new Error('TRACE_BACKUP_PATH_REQUIRED');
    const restored = this.readStore(backupPath);
    this.traces = restored;
    this.prune(this.clock());
    this.persist();
    return { records: this.traces.length };
  }

  health() { return { status: 'ok', durable: true, retentionMs: this.retentionMs }; }
}

class MetricsRegistry {
  constructor() { this.traces = []; this.queueDepth = 0; }
  setQueueDepth(value) { this.queueDepth = value; }
  observe(trace) { this.traces.push(trace); }
  snapshot() {
    const durations = this.traces.map((trace) => trace.durationMs || 0).sort((a, b) => a - b);
    const percentile = (p) => durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)] : 0;
    const errors = this.traces.filter((trace) => trace.status !== 'success').length;
    const retrievalAttempts = this.traces.reduce((total, trace) => total + (trace.retrieval?.attempts?.length || 0), 0);
    const toolFailures = this.traces.reduce((total, trace) => total + (trace.retrieval?.attempts || []).filter((attempt) => ['failed', 'timeout'].includes(attempt.status)).length, 0);
    return { requests: this.traces.length, errors, errorRate: this.traces.length ? errors / this.traces.length : 0, latencyMs: { p50: percentile(.5), p95: percentile(.95) }, queueDepth: this.queueDepth, retrievalAttempts, toolFailures, toolFailureRate: retrievalAttempts ? toolFailures / retrievalAttempts : 0 };
  }
}

function evaluateAlerts(snapshot, { p95LatencyMs = 2000, errorRate = 0.05, toolFailureRate = 0.1 } = {}) {
  const rules = [
    { id: 'p95_latency', metric: 'latencyMs.p95', threshold: p95LatencyMs, observed: snapshot.latencyMs?.p95 || 0, operator: '>', triggered: (snapshot.latencyMs?.p95 || 0) > p95LatencyMs },
    { id: 'error_rate', metric: 'errorRate', threshold: errorRate, observed: snapshot.errorRate || 0, operator: '>', triggered: (snapshot.errorRate || 0) > errorRate },
    { id: 'tool_failure_rate', metric: 'toolFailureRate', threshold: toolFailureRate, observed: snapshot.toolFailureRate || 0, operator: '>', triggered: (snapshot.toolFailureRate || 0) > toolFailureRate },
  ];
  const fired = rules.filter((rule) => rule.triggered).map((rule) => rule.id);
  return { status: fired.length ? 'firing' : 'ok', fired, rules };
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

module.exports = { redactPayload, TraceRecorder, InMemoryTraceSink, FileTraceSink, MetricsRegistry, evaluateAlerts, createReadinessChecker };
