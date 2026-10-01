import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { issueSignedContext, parseLaunchVerifyKey, verifySignedContext } from '../src/accessContext.js';
import { LAUNCH_VECTORS, TEST_LAUNCH_VERIFY_KEY, issueTestLaunchToken } from './helpers/launchKeys.js';
import { startTestServer } from './helpers/testServer.js';

// W3 H1: launcher tokens (issuer openemr-module) are Ed25519-signed with a key
// only the openemr container holds. Anything that holds AGENTFORGE_DEMO_SECRET
// (frozen W1, agentforge-w2) can still mint synthetic-demo tokens, but never
// an openemr-module token that a verifier accepts.
const demoSecret = 'synthetic-vector-secret-not-deployed'; // the top-level `secret` in hmac-vectors.json
const verifyKey = parseLaunchVerifyKey(TEST_LAUNCH_VERIFY_KEY);
const at = () => LAUNCH_VECTORS.now;
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

test('launch vector: the PHP-minted Ed25519 launcher token verifies in Node, and the test signer reproduces its bytes', () => {
  const context = verifySignedContext(LAUNCH_VECTORS.write_token, demoSecret, at, { launchVerifyKey: verifyKey });
  assert.ok(context);
  assert.deepEqual([context.issuer, context.authn, context.scope, context.acl, context.patient_uuid, context.clinician_uuid], ['openemr-module', 'openemr-session', 'write-source-document', 'write', LAUNCH_VECTORS.patient_uuid, LAUNCH_VECTORS.clinician_uuid]);
  assert.equal(issueTestLaunchToken({ patient_uuid: LAUNCH_VECTORS.patient_uuid, clinician_uuid: LAUNCH_VECTORS.clinician_uuid, scope: 'write-source-document', now: LAUNCH_VECTORS.now }), LAUNCH_VECTORS.write_token);
});

test('an openemr-module token HMAC-signed with AGENTFORGE_DEMO_SECRET is rejected, with or without a launch verify key', () => {
  assert.equal(verifySignedContext(LAUNCH_VECTORS.hmac_forged_write_token, demoSecret, at, { launchVerifyKey: verifyKey }), null);
  assert.equal(verifySignedContext(LAUNCH_VECTORS.hmac_forged_write_token, demoSecret, at), null);
});

test('this service cannot mint an openemr-module token: issueSignedContext refuses the launcher issuer', () => {
  assert.throws(() => issueSignedContext({ patient_uuid: LAUNCH_VECTORS.patient_uuid, clinician_uuid: LAUNCH_VECTORS.clinician_uuid, issuer: 'openemr-module', authn: 'openemr-session', secret: demoSecret }), /LAUNCH_ISSUER_RESERVED/);
});

test('each issuer has exactly one signature scheme: a synthetic-demo claim signed with the launch key is rejected', () => {
  const [, signature] = LAUNCH_VECTORS.write_token.split('.');
  const encoded = Buffer.from(JSON.stringify({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', scope: 'read-briefing', issuer: 'synthetic-demo', authn: 'synthetic', role: 'clinician', acl: 'read', expires_at: LAUNCH_VECTORS.now + 200 })).toString('base64url');
  assert.equal(verifySignedContext(`${encoded}.${signature}`, demoSecret, at, { launchVerifyKey: verifyKey }), null, 'wrong signature over this payload');
  // A genuinely Ed25519-signed synthetic claim (if the key ever signed one) is still refused.
  const synthetic = issueTestLaunchToken({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', issuer: 'synthetic-demo', authn: 'synthetic', now: LAUNCH_VECTORS.now });
  assert.equal(verifySignedContext(synthetic, demoSecret, at, { launchVerifyKey: verifyKey }), null);
});

test('a launch token is refused when no verify key is configured, and a non-canonical signature encoding is refused', () => {
  assert.equal(verifySignedContext(LAUNCH_VECTORS.write_token, demoSecret, at), null);
  const [encoded, signature] = LAUNCH_VECTORS.write_token.split('.');
  // The last base64url character carries 4 unused bits; flipping one keeps the bytes but changes the string (replay-cache bypass).
  const last = signature.at(-1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const twin = alphabet[alphabet.indexOf(last) ^ 1];
  assert.deepEqual(Buffer.from(signature.slice(0, -1) + twin, 'base64url'), Buffer.from(signature, 'base64url'));
  assert.equal(verifySignedContext(`${encoded}.${signature.slice(0, -1)}${twin}`, demoSecret, at, { launchVerifyKey: verifyKey }), null);
  const other = crypto.generateKeyPairSync('ed25519').publicKey;
  assert.equal(verifySignedContext(LAUNCH_VECTORS.write_token, demoSecret, at, { launchVerifyKey: other }), null, 'another key');
});

test('parseLaunchVerifyKey: empty is null; anything but a strict base64 32-byte key fails at startup', () => {
  assert.equal(parseLaunchVerifyKey(undefined), null);
  assert.equal(parseLaunchVerifyKey(''), null);
  assert.ok(parseLaunchVerifyKey(TEST_LAUNCH_VERIFY_KEY));
  for (const bad of ['not-base64!', Buffer.alloc(31).toString('base64'), Buffer.alloc(64).toString('base64'), TEST_LAUNCH_VERIFY_KEY.replace('=', '')]) {
    assert.throws(() => parseLaunchVerifyKey(bad), /AGENTFORGE_LAUNCH_VERIFY_KEY_INVALID/, bad);
  }
});

test('server: live reads on without AGENTFORGE_LAUNCH_VERIFY_KEY refuses to start, naming the setting', async () => {
  const child = spawn(process.execPath, ['agentforge/src/server.js'], { cwd: repoRoot, env: { ...process.env, PORT: '18961', AGENTFORGE_DEMO_SECRET: 'synthetic-test-secret', AGENTFORGE_SYNTHETIC_CONTEXT: 'true', AGENTFORGE_PROVIDER_MODE: 'deterministic', AGENTFORGE_OPENEMR_LIVE_READS: 'on', AGENTFORGE_LAUNCH_VERIFY_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 10000);
  const code = await new Promise((resolve) => child.once('exit', resolve));
  clearTimeout(timer);
  assert.equal(code, 1, 'the server must exit on its own, not be killed after starting');
  assert.match(stderr, /AGENTFORGE_LAUNCH_VERIFY_KEY/);
});

test('server: with no verify key the launcher link is refused with a labeled page; an HMAC-forged launch never creates a session', async () => {
  const port = 18962;
  const child = await startTestServer(port, { AGENTFORGE_PROVIDER_MODE: 'deterministic', AGENTFORGE_LAUNCH_VERIFY_KEY: '' }, { path: '/health' });
  const base = `http://127.0.0.1:${port}`;
  try {
    const launch = issueTestLaunchToken({ patient_uuid: LAUNCH_VECTORS.patient_uuid, clinician_uuid: LAUNCH_VECTORS.clinician_uuid });
    const refused = await fetch(`${base}/?demo_token=${encodeURIComponent(launch)}`);
    assert.equal(refused.status, 503);
    assert.match(await refused.text(), /OpenEMR launch is not configured/);
    assert.equal(refused.headers.get('set-cookie'), null);
    const [encoded] = launch.split('.');
    const forged = `${encoded}.${crypto.createHmac('sha256', 'synthetic-test-secret').update(encoded).digest('base64url')}`;
    const page = await fetch(`${base}/?demo_token=${encodeURIComponent(forged)}`);
    assert.equal(page.headers.get('set-cookie'), null, 'no launch session for a forged token');
    assert.doesNotMatch(await page.text(), /launch-session\./);
  } finally { child.kill(); }
});

test('server: with the verify key an HMAC-forged launch is still refused, and the genuine launch creates a session', async () => {
  const port = 18963;
  const child = await startTestServer(port, { AGENTFORGE_PROVIDER_MODE: 'deterministic', AGENTFORGE_LAUNCH_VERIFY_KEY: TEST_LAUNCH_VERIFY_KEY }, { path: '/health' });
  const base = `http://127.0.0.1:${port}`;
  try {
    const launch = issueTestLaunchToken({ patient_uuid: LAUNCH_VECTORS.patient_uuid, clinician_uuid: LAUNCH_VECTORS.clinician_uuid });
    const [encoded] = launch.split('.');
    const forged = `${encoded}.${crypto.createHmac('sha256', 'synthetic-test-secret').update(encoded).digest('base64url')}`;
    const forgedPage = await fetch(`${base}/?demo_token=${encodeURIComponent(forged)}`);
    assert.equal(forgedPage.headers.get('set-cookie'), null);
    assert.doesNotMatch(await forgedPage.text(), /launch-session\./);
    const genuine = await fetch(`${base}/?demo_token=${encodeURIComponent(launch)}`);
    assert.equal(genuine.status, 200);
    assert.match(genuine.headers.get('set-cookie') || '', /^af_launch_/);
    assert.match(await genuine.text(), /demoToken: "launch-session\./);
  } finally { child.kill(); }
});

test('deploy: only openemr holds the launch signing key; agentforge-w2 gets only the verify key; Week 1 gets neither', () => {
  const compose = fs.readFileSync(path.join(repoRoot, 'deploy/vultr/docker-compose.yml'), 'utf8').replace(/\r\n/g, '\n');
  const services = {};
  let current = null;
  for (const line of compose.split('\n')) {
    const header = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (header) { current = header[1]; services[current] = ''; continue; }
    if (/^\S/.test(line)) current = null;
    if (current) services[current] += `${line}\n`;
  }
  const holds = (service, name) => new RegExp(`^\\s+${name}:`, 'm').test(services[service] || '');
  assert.ok(services.openemr && services['agentforge-w2'] && services.agentforge, 'the three services are present');
  assert.deepEqual([holds('openemr', 'AGENTFORGE_LAUNCH_SIGNING_KEY'), holds('openemr', 'AGENTFORGE_LAUNCH_VERIFY_KEY')], [true, true]);
  assert.deepEqual([holds('agentforge-w2', 'AGENTFORGE_LAUNCH_SIGNING_KEY'), holds('agentforge-w2', 'AGENTFORGE_LAUNCH_VERIFY_KEY')], [false, true]);
  assert.deepEqual([holds('agentforge', 'AGENTFORGE_LAUNCH_SIGNING_KEY'), holds('agentforge', 'AGENTFORGE_LAUNCH_VERIFY_KEY')], [false, false]);
  for (const [service, block] of Object.entries(services)) if (service !== 'openemr') assert.doesNotMatch(block, /AGENTFORGE_LAUNCH_SIGNING_KEY/, service);
});
