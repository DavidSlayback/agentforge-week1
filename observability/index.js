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
  constructor({ correlationId, operation, scope = {}, clock = () => new Date().toISOString() }) {
    this.correlationId = correlationId;
    this.operation = operation;
    this.scope = scope;
    this.clock = clock;
    this.startedAt = this.clock();
    this.stages = [];
    this.retries = [];
    this.retrieval = { attempts: [] };
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

  complete({ status }) {
    const completedAt = this.clock();
    return redactPayload({
      schemaVersion: 1,
      correlationId: this.correlationId,
      operation: this.operation,
      scope: this.scope,
      startedAt: this.startedAt,
      completedAt,
      durationMs: Math.max(0, new Date(completedAt) - new Date(this.startedAt)),
      stages: this.stages,
      retrieval: this.retrieval,
      retries: { total: this.retries.length, events: this.retries, exhausted: false },
      model: this.model || {},
      coverage: this.coverage || {},
      verification: this.verification || {},
      display: this.display || {},
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
    const errors = this.traces.filter((trace) => trace.status !== 'success').length;
    return {
      requests: this.traces.length,
      errors,
      errorRate: this.traces.length ? errors / this.traces.length : 0,
      latencyMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) },
      queueDepth: 0,
      retrievalAttempts: this.traces.reduce((total, trace) => total + (trace.retrieval?.attempts?.length || 0), 0),
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

  readFromDisk() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('TRACE_STORE_INVALID');
      return parsed.map(redactPayload);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.traces)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
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
    return { requests: this.traces.length, errors, errorRate: this.traces.length ? errors / this.traces.length : 0, latencyMs: { p50: percentile(.5), p95: percentile(.95) }, queueDepth: this.queueDepth };
  }
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

module.exports = { redactPayload, TraceRecorder, InMemoryTraceSink, FileTraceSink, MetricsRegistry, createReadinessChecker };
