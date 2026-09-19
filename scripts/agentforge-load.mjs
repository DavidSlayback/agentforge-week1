#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (!value.startsWith('--')) return pairs;
  pairs.push([value.slice(2), values[index + 1]?.startsWith('--') ? true : values[index + 1] ?? true]);
  return pairs;
}, []));

const parsePositiveInteger = (value, flag) => {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${flag} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
};

const baseUrl = String(args['base-url'] || process.env.AGENTFORGE_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const concurrency = parsePositiveInteger(args.concurrency ?? 10, '--concurrency');
const totalRequests = parsePositiveInteger(args.requests ?? 100, '--requests');
const requestTimeoutMs = parsePositiveInteger(args['timeout-ms'] ?? 60000, '--timeout-ms');
const patient = String(args.patient || 'fixture-patient-001');
const startedAt = new Date().toISOString();

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};

async function getDemoToken() {
  try {
    const response = await fetch(`${baseUrl}/v1/demo-context?patient_uuid=${encodeURIComponent(patient)}`, { signal: AbortSignal.timeout(requestTimeoutMs) });
    if (!response.ok) return undefined;
    return (await response.json()).demo_token;
  } catch {
    return undefined;
  }
}

const demoToken = await getDemoToken();
if (!demoToken) throw new Error('SIGNED_SYNTHETIC_CONTEXT_REQUIRED');
const results = [];
let next = 0;
const worker = async () => {
  while (true) {
    const index = next;
    next += 1;
    if (index >= totalRequests) return;
    const requestStarted = performance.now();
    let status = 0;
    let error;
    try {
      const response = await fetch(`${baseUrl}/v1/briefings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(requestTimeoutMs),
        body: JSON.stringify({
          patient_uuid: patient,
          case_id: 'complete_return_visit',
          clinician_uuid: 'fixture-physician-001',
          correlation_id: `load-${Date.now()}-${index}`,
          ...(demoToken ? { demo_token: demoToken } : {}),
        }),
      });
      status = response.status;
      const body = response.headers.get('content-type')?.includes('application/json') ? await response.json().catch(() => null) : null;
      if (!response.ok) error = JSON.stringify(body || {}).slice(0, 200);
      else if (body?.disposition !== 'complete') error = `unexpected disposition: ${body?.disposition || 'missing'}`;
    } catch (caught) {
      error = caught.message;
    }
    results.push({ index, status, latencyMs: Math.round((performance.now() - requestStarted) * 100) / 100, error: error || null });
  }
};

const wallStarted = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, totalRequests) }, worker));
const wallDurationMs = Math.round((performance.now() - wallStarted) * 100) / 100;
const latencies = results.map((result) => result.latencyMs);
const errors = results.filter((result) => result.status < 200 || result.status >= 300 || result.error);
let metrics;
try { metrics = await fetch(`${baseUrl}/v1/metrics`, { signal: AbortSignal.timeout(requestTimeoutMs) }).then((response) => response.json()); } catch { metrics = null; }

const report = {
  schema_version: '0.1',
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  base_url: baseUrl,
  workload: { requests: totalRequests, concurrency, timeout_ms: requestTimeoutMs, patient, provider_mode: 'signed-synthetic-context' },
  timing: { wall_duration_ms: wallDurationMs, throughput_requests_per_second: Number((totalRequests / (wallDurationMs / 1000)).toFixed(3)), p50_ms: percentile(latencies, 0.5), p95_ms: percentile(latencies, 0.95), p99_ms: percentile(latencies, 0.99) },
  outcome: { completed: results.length, successful: results.length - errors.length, errors: errors.length, error_rate: results.length ? errors.length / results.length : 0 },
  service_metrics_after_run: metrics,
  raw_results: results.sort((a, b) => a.index - b.index),
};

const output = JSON.stringify(report, null, 2);
if (args.out) fs.writeFileSync(String(args.out), `${output}\n`, { encoding: 'utf8' });
console.log(output);
if (errors.length) process.exitCode = 1;
