import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// W1-C3: the p95 latency alert must not fire on every W2 scan. The server
// default (2000 ms) predates W2, whose scans take 11-22 s, so the deployed W2
// service sets the KEY_METRICS.md p95 target instead. W1 is frozen (D8).
const compose = fs.readFileSync(fileURLToPath(new URL('../../deploy/vultr/docker-compose.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** The indented body of one top-level compose service. */
function serviceBlock(name) {
  const lines = compose.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.ok(start >= 0, `service ${name} not found`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z0-9-]+:\s*$/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

test('the deployed W2 service sets the p95 alert to the 30 s KEY_METRICS target', () => {
  const match = serviceBlock('agentforge-w2').match(/^\s+AGENTFORGE_ALERT_P95_MS:\s*\$\{AGENTFORGE_W2_ALERT_P95_MS:-(\d+)\}\s*$/m);
  assert.ok(match, 'agentforge-w2 must set AGENTFORGE_ALERT_P95_MS');
  assert.equal(Number(match[1]), 30000);
  const keyMetrics = fs.readFileSync(fileURLToPath(new URL('../../KEY_METRICS.md', import.meta.url)), 'utf8');
  assert.match(keyMetrics, /p95 ≤ 30 s/, 'the threshold tracks the documented p95 target');
});

test('the frozen W1 service keeps its original alert configuration', () => {
  assert.doesNotMatch(serviceBlock('agentforge'), /AGENTFORGE_ALERT_P95_MS/);
});
