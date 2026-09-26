import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// F-OBS item 1 (W2_ARCHITECTURE.md §4 debt #13): the deployed W2 service keeps
// its trace store on a named Docker volume, so /observability does not reset
// to zero on every redeploy. The frozen W1 service (D8) is not touched.
const compose = fs.readFileSync(fileURLToPath(new URL('../../deploy/vultr/docker-compose.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

function serviceBlock(name) {
  const lines = compose.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.ok(start >= 0, `service ${name} not found`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z0-9-]+:\s*$/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

const envValue = (block, name) => block.match(new RegExp(`^\\s+${name}:\\s*(.+?)\\s*$`, 'm'))?.[1] ?? null;
const topLevelVolumes = () => {
  const lines = compose.split('\n');
  const start = lines.indexOf('volumes:');
  assert.ok(start >= 0, 'no top-level volumes section');
  const names = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(/^ {2}([a-z0-9_-]+):/);
    if (match) names.push(match[1]);
  }
  return names;
};
const namedMounts = (block) => [...block.matchAll(/^\s+- ([a-z0-9_-]+):(\/[^\s:]+)\s*$/gm)].map(([, volume, target]) => ({ volume, target }));

test('the W2 trace file lives on a declared named volume, not in the container filesystem', () => {
  const block = serviceBlock('agentforge-w2');
  const tracePath = envValue(block, 'AGENTFORGE_TRACE_PATH');
  assert.ok(tracePath, 'agentforge-w2 must set AGENTFORGE_TRACE_PATH');
  assert.ok(!tracePath.startsWith('/tmp/'), 'a /tmp trace file is lost on every container replacement');
  const mount = namedMounts(block).find(({ target }) => path.posix.dirname(tracePath) === target || path.posix.dirname(tracePath).startsWith(`${target}/`));
  assert.ok(mount, `no named volume is mounted over ${path.posix.dirname(tracePath)}`);
  assert.ok(topLevelVolumes().includes(mount.volume), `volume ${mount.volume} is not declared at the top level`);
  const w1Volumes = namedMounts(serviceBlock('agentforge')).map(({ volume }) => volume);
  assert.ok(!w1Volumes.includes(mount.volume), 'W2 must not share the frozen W1 trace volume');
});

test('the W2 store is bounded and the new settings are explicit', () => {
  const block = serviceBlock('agentforge-w2');
  assert.match(envValue(block, 'AGENTFORGE_TRACE_LIMIT') || '', /^\$\{AGENTFORGE_W2_TRACE_LIMIT:-500\}$/);
  assert.match(envValue(block, 'AGENTFORGE_TRACE_RETENTION_MS') || '', /^\$\{AGENTFORGE_W2_TRACE_RETENTION_MS:-\d+\}$/);
  assert.match(envValue(block, 'AGENTFORGE_ALERT_EVAL_INTERVAL_MS') || '', /^\$\{AGENTFORGE_ALERT_EVAL_INTERVAL_MS:-\d+\}$/);
});

test('the frozen W1 service keeps its original trace configuration', () => {
  const block = serviceBlock('agentforge');
  assert.match(block, /^\s+image: agentforge-w1:84f232b$/m);
  assert.equal(envValue(block, 'AGENTFORGE_TRACE_PATH'), '${AGENTFORGE_TRACE_PATH:-/data/traces.json}');
  assert.deepEqual(namedMounts(block), [{ volume: 'tracevolume', target: '/data' }]);
  for (const name of ['AGENTFORGE_TRACE_LIMIT', 'AGENTFORGE_ALERT_EVAL_INTERVAL_MS']) assert.equal(envValue(block, name), null);
});

test('Caddy never waits for agentforge-w2 to be healthy: a module outage must not block the proxy', () => {
  const block = serviceBlock('proxy');
  const w2 = block.match(/^\s+agentforge-w2:\n\s+condition:\s*(\S+)\s*$/m);
  assert.ok(!w2 || w2[1] !== 'service_healthy', 'proxy depends on agentforge-w2 being healthy');
});
