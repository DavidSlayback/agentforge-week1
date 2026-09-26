#!/usr/bin/env node
/**
 * Run the Bruno collection (agentforge/api/bruno) against a local AgentForge
 * server started from this checkout, and write a compact summary.
 *
 *   node agentforge/scripts/run-bruno-local.mjs [--port 18950] [--out <file>]
 *
 * The server is spawned the way the unit tests spawn it
 * (test/helpers/testServer.js): synthetic context, a test-only signing
 * secret, the deterministic provider (no model endpoint is configured, so no
 * model call leaves the machine) and in-memory synthetic persistence. Both
 * the W1 and W2 base URLs point at it: locally one server.js serves both
 * route sets.
 *
 * The summary (request names, statuses, assertion and test counts; no
 * response bodies, no tokens) goes to
 * docs/agentforge/evidence/bruno/<sha>-local.json unless --out is given.
 * Exits non-zero when any request, assertion or test fails.
 *
 * This script never targets the deployed URL. The deployed run is
 * `cd agentforge/api/bruno && npx @usebruno/cli run --env deployed`.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from '../test/helpers/testServer.js';

export const BRUNO_CLI = '@usebruno/cli@4.2.0';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const collectionDir = path.join(repoRoot, 'agentforge/api/bruno');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

/** Reduce a Bruno JSON report (an array of iterations) to counts per request. */
export function summarizeBrunoReport(report) {
  const iterations = Array.isArray(report) ? report : [report];
  const requests = [];
  const totals = { requests: 0, passed_requests: 0, failed_requests: 0, assertions: 0, failed_assertions: 0, tests: 0, failed_tests: 0 };
  for (const iteration of iterations) {
    const summary = iteration.summary || {};
    totals.requests += summary.totalRequests || 0;
    totals.passed_requests += summary.passedRequests || 0;
    totals.failed_requests += (summary.failedRequests || 0) + (summary.errorRequests || 0);
    totals.assertions += summary.totalAssertions || 0;
    totals.failed_assertions += summary.failedAssertions || 0;
    totals.tests += summary.totalTests || 0;
    totals.failed_tests += summary.failedTests || 0;
    for (const result of iteration.results || []) {
      const assertions = result.assertionResults || [];
      const tests = result.testResults || [];
      requests.push({
        file: String(result.test?.filename || result.name || '').replaceAll('\\', '/'),
        http_status: result.response?.status ?? null,
        passed: !result.error && assertions.every((item) => item.status === 'pass') && tests.every((item) => item.status === 'pass'),
        assertions: assertions.length,
        failed_assertions: assertions.filter((item) => item.status !== 'pass').map((item) => `${item.lhsExpr}: ${item.rhsExpr}`),
        tests: tests.length,
        failed_tests: tests.filter((item) => item.status !== 'pass').map((item) => item.description),
        error: result.error ? String(result.error).slice(0, 200) : null,
      });
    }
  }
  return { totals, requests };
}

function gitSha() {
  try { return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(); } catch { return 'unversioned'; }
}

function workingTreeDirty() {
  try { return execFileSync('git', ['status', '--porcelain', '--', 'agentforge/src', 'agentforge/api/bruno'], { cwd: repoRoot, encoding: 'utf8' }).trim().length > 0; } catch { return null; }
}

async function main() {
  const port = Number(argValue('--port', '18950'));
  if (!Number.isInteger(port) || port < 1024) throw new Error('--port must be an integer >= 1024');
  const sha = gitSha();
  const out = path.resolve(argValue('--out', path.join(repoRoot, 'docs/agentforge/evidence/bruno', `${sha}-local.json`)));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-bruno-'));
  const reportPath = path.join(scratch, 'bruno-report.json');
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await startTestServer(port, { AGENTFORGE_TRACE_PATH: path.join(scratch, 'traces.json') });
  const startedAt = new Date().toISOString();
  let exitCode;
  try {
    const args = ['-y', BRUNO_CLI, 'run', '--env', 'local', '--env-var', `w1BaseUrl=${baseUrl}`, '--env-var', `w2BaseUrl=${baseUrl}`, '--reporter-json', reportPath];
    // npx is a .cmd shim on Windows, which Node only spawns through a shell.
    // Every argument above is a constant or a validated port.
    exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: collectionDir, stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });
      child.on('error', reject);
      child.on('close', resolve);
    });
  } finally {
    server.kill();
  }
  if (!fs.existsSync(reportPath)) throw new Error(`Bruno wrote no report (exit ${exitCode})`);
  const { totals, requests } = summarizeBrunoReport(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
  const summary = {
    schema_version: '1',
    kind: 'bruno-collection-run',
    environment: 'local',
    target: 'agentforge/src/server.js spawned from this checkout (synthetic context, deterministic provider, in-memory synthetic persistence); W1 and W2 base URLs both point at it',
    git_sha: sha,
    working_tree_dirty: workingTreeDirty(),
    bruno_cli: BRUNO_CLI,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    bruno_exit_code: exitCode,
    passed: exitCode === 0 && totals.failed_requests === 0 && totals.failed_assertions === 0 && totals.failed_tests === 0,
    totals,
    requests,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`Bruno local run: ${totals.passed_requests}/${totals.requests} requests, ${totals.assertions - totals.failed_assertions}/${totals.assertions} assertions, ${totals.tests - totals.failed_tests}/${totals.tests} tests -> ${path.relative(repoRoot, out)}`);
  if (!summary.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
