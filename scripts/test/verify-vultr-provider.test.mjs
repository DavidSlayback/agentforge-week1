import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function runVerifier(port) {
  const child = spawn(process.execPath, ['scripts/verify-vultr-provider.mjs'], {
    cwd: new URL('../..', import.meta.url),
    env: { ...process.env, AGENTFORGE_BASE_URL: `http://127.0.0.1:${port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  return { code, output: `${stdout}${stderr}` };
}

test('provider verifier fails closed on blocked briefing readback', async () => {
  let blocked = true;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/health') return json(response, 200, { status: 'ok' });
    if (url.pathname === '/ready') return json(response, 200, { status: 'ready', dependencies: { configuration: { status: 'ready' }, retrieval: { status: 'ready' }, model: { status: 'ready' }, trace: { status: 'ready' } } });
    if (url.pathname === '/v1/demo-context') return json(response, 200, { demo_token: 'synthetic-test-token' });
    if (url.pathname === '/v1/traces') return json(response, 200, []);
    if (url.pathname === '/v1/briefings') return json(response, 200, blocked ? { disposition: 'blocked', verification: { status: 'blocked' } } : { disposition: 'complete', verification: { status: 'passed' }, model: { provider: 'test', model: 'test' }, provider_status: 'primary' });
    return json(response, 404, { error: 'NOT_FOUND' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const blockedResult = await runVerifier(port);
  assert.notEqual(blockedResult.code, 0, `blocked provider readback unexpectedly passed: ${blockedResult.output}`);
  assert.match(blockedResult.output, /"briefing_disposition":"blocked"/);

  blocked = false;
  const safeResult = await runVerifier(port);
  server.close();
  assert.equal(safeResult.code, 0, `safe provider readback unexpectedly failed: ${safeResult.output}`);
  assert.match(safeResult.output, /"briefing_verification":"passed"/);
});
