import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

test('load harness rejects invalid concurrency instead of reporting zero completed work', async () => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/v1/demo-context') return json(response, 200, { demo_token: 'synthetic-test-token' });
    if (url.pathname === '/v1/metrics') return json(response, 200, {});
    if (url.pathname === '/v1/briefings') return json(response, 200, { disposition: 'complete' });
    return json(response, 404, { error: 'NOT_FOUND' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const child = spawn(process.execPath, [
    'scripts/agentforge-load.mjs',
    '--base-url', `http://127.0.0.1:${port}`,
    '--concurrency', 'not-a-number',
    '--requests', '1',
  ], { cwd: new URL('../..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [result] = await once(child, 'close');

  assert.notEqual(result, 0, `invalid concurrency unexpectedly passed: ${stdout}${stderr}`);
  assert.match(`${stdout}${stderr}`, /concurrency.*positive integer/i);

  const validChild = spawn(process.execPath, [
    'scripts/agentforge-load.mjs',
    '--base-url', `http://127.0.0.1:${port}`,
    '--concurrency', '1',
    '--requests', '1',
  ], { cwd: new URL('../..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  let validStdout = '';
  let validStderr = '';
  validChild.stdout.on('data', (chunk) => { validStdout += chunk; });
  validChild.stderr.on('data', (chunk) => { validStderr += chunk; });
  const [validResult] = await once(validChild, 'close');
  server.close();

  assert.equal(validResult, 0, `valid load unexpectedly failed: ${validStdout}${validStderr}`);
  assert.equal(JSON.parse(validStdout).outcome.completed, 1);
});
