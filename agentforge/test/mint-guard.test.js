// W3 red-team fixes for the synthetic-context mints. Each HTTP test runs the
// real server (the deployed code path) and fails if its fix is removed:
//   F-831d4df407  anonymous /v1/demo-context read-token mint       -> 401 without the key
//   F-24b44c5180  anonymous /v1/source-document-context write mint -> 401 without the key
//   F-6ee92046fb  no rate limit on the mints                       -> 429 + Retry-After
//   W1 bypass     a token minted by the frozen W1 service (same secret, no audience) -> 403
import test from 'node:test';
import assert from 'node:assert/strict';
import { issueSignedContext } from '../src/accessContext.js';
import { DEFAULT_MINT_RATE_LIMIT, W2_TOKEN_AUDIENCE, clientAddress, createMintRateLimiter, demoKeyMatches } from '../src/mintGuard.js';
import { DEMO_KEY_REQUEST, TEST_DEMO_ACCESS_KEY, startTestServer } from './helpers/testServer.js';

const SECRET = 'synthetic-test-secret'; // startTestServer's AGENTFORGE_DEMO_SECRET
const MINTS = ['/v1/demo-context', '/v1/source-document-context', '/v1/clinical-action-context'];
const mint = (base, route, init = {}) => fetch(`${base}${route}?patient_uuid=fixture-patient-001`, init);
const withKey = (headers = {}) => ({ headers: { ...DEMO_KEY_REQUEST.headers, ...headers } });

test('F-831d4df407 / F-24b44c5180: every synthetic-context mint refuses a missing or wrong access key', async () => {
  const port = 18961;
  const base = `http://127.0.0.1:${port}`;
  const child = await startTestServer(port);
  try {
    for (const route of MINTS) {
      const anonymous = await mint(base, route);
      assert.equal(anonymous.status, 401, `${route} without a key`);
      assert.equal((await anonymous.json()).error, 'demo_access_key_required');
      const wrong = await mint(base, route, { headers: { 'x-agentforge-demo-key': `${TEST_DEMO_ACCESS_KEY}x` } });
      assert.equal(wrong.status, 401, `${route} with a wrong key`);
      const empty = await mint(base, route, { headers: { 'x-agentforge-demo-key': '' } });
      assert.equal(empty.status, 401, `${route} with an empty key`);
      const keyed = await mint(base, route, DEMO_KEY_REQUEST);
      assert.equal(keyed.status, 200, `${route} with the key`);
      assert.equal(typeof (await keyed.json()).demo_token, 'string');
    }
  } finally {
    child.kill();
  }
});

test('mints fail closed when AGENTFORGE_DEMO_ACCESS_KEY is unset, and /ready says so', async () => {
  const port = 18962;
  const base = `http://127.0.0.1:${port}`;
  const child = await startTestServer(port, { AGENTFORGE_DEMO_ACCESS_KEY: '' }, { path: '/health' });
  try {
    for (const route of MINTS) {
      const response = await mint(base, route, DEMO_KEY_REQUEST);
      assert.equal(response.status, 503, route);
      assert.equal((await response.json()).error, 'demo_access_key_not_configured');
    }
    assert.equal((await fetch(`${base}/ready`)).status, 503);
  } finally {
    child.kill();
  }
});

test('F-6ee92046fb: the default limit lets normal use through and 429s 20 rapid mints with Retry-After', async () => {
  const port = 18963;
  const base = `http://127.0.0.1:${port}`;
  // An empty value selects the built-in default, which is what deploy/vultr runs unless overridden.
  const child = await startTestServer(port, { AGENTFORGE_MINT_RATE_LIMIT: '', AGENTFORGE_MINT_RATE_WINDOW_SECONDS: '' });
  try {
    const statuses = [];
    let limited = null;
    for (let index = 0; index < 20; index += 1) {
      // The three mints share one budget, as the UI mixes read and write mints.
      const response = await mint(base, MINTS[index % MINTS.length], DEMO_KEY_REQUEST);
      statuses.push(response.status);
      if (response.status === 429 && !limited) limited = response;
    }
    assert.deepEqual(statuses.slice(0, DEFAULT_MINT_RATE_LIMIT), Array(DEFAULT_MINT_RATE_LIMIT).fill(200));
    assert.deepEqual(statuses.slice(DEFAULT_MINT_RATE_LIMIT), Array(20 - DEFAULT_MINT_RATE_LIMIT).fill(429));
    const retryAfter = Number(limited.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After ${retryAfter}`);
    assert.equal((await limited.json()).error, 'mint_rate_limited');
    // Wrong-key attempts are throttled too (the limit is checked before the key).
    assert.equal((await mint(base, MINTS[0])).status, 429);
    // Without AGENTFORGE_TRUST_PROXY a client cannot pick a fresh bucket with X-Forwarded-For.
    assert.equal((await mint(base, MINTS[0], withKey({ 'x-forwarded-for': '203.0.113.9' }))).status, 429);
  } finally {
    child.kill();
  }
});

test('F-6ee92046fb: behind a trusted proxy the limit is per forwarded client, keyed on the rightmost entry', async () => {
  const port = 18964;
  const base = `http://127.0.0.1:${port}`;
  const child = await startTestServer(port, { AGENTFORGE_MINT_RATE_LIMIT: '3', AGENTFORGE_TRUST_PROXY: 'true' });
  try {
    // Caddy appends the real peer last; a client-supplied left part must not open a new bucket.
    for (let index = 0; index < 3; index += 1) assert.equal((await mint(base, MINTS[0], withKey({ 'x-forwarded-for': `198.51.100.${index}, 203.0.113.7` }))).status, 200);
    assert.equal((await mint(base, MINTS[0], withKey({ 'x-forwarded-for': '198.51.100.99, 203.0.113.7' }))).status, 429);
    // A different real client still has its own budget.
    assert.equal((await mint(base, MINTS[0], withKey({ 'x-forwarded-for': '203.0.113.8' }))).status, 200);
  } finally {
    child.kill();
  }
});

test('W1 bypass: a synthetic-demo token without this service audience is refused; a minted one is accepted', async () => {
  const port = 18965;
  const base = `http://127.0.0.1:${port}`;
  const child = await startTestServer(port);
  try {
    const probe = (token) => fetch(`${base}/v1/source-documents/does-not-exist/pages/1.png?patient_uuid=fixture-patient-001&demo_token=${encodeURIComponent(token)}`);
    // Exactly what the frozen Week 1 service mints: same secret and claims, no `aud`.
    const w1Token = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', issuer: 'synthetic-demo', authn: 'synthetic', secret: SECRET });
    const refused = await probe(w1Token);
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).error, 'invalid_demo_context');
    const otherAudience = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', audience: 'agentforge-w1', secret: SECRET });
    assert.equal((await probe(otherAudience)).status, 403);
    // A token from this service's mint passes the context check and reaches the lookup.
    const minted = (await (await mint(base, MINTS[0], DEMO_KEY_REQUEST)).json()).demo_token;
    const accepted = await probe(minted);
    assert.equal(accepted.status, 404);
    assert.equal((await accepted.json()).error, 'DOCUMENT_NOT_FOUND');
  } finally {
    child.kill();
  }
});

test('AGENTFORGE_DEMO_ACCESS=open: mints need no key, but the rate limit and the audience check stay on', async () => {
  const port = 18966;
  const base = `http://127.0.0.1:${port}`;
  const child = await startTestServer(port, { AGENTFORGE_DEMO_ACCESS: 'open', AGENTFORGE_DEMO_ACCESS_KEY: '', AGENTFORGE_MINT_RATE_LIMIT: '4' });
  try {
    assert.doesNotMatch(await (await fetch(`${base}/`)).text(), /<form id="access-form">/);
    for (const route of MINTS) assert.equal((await mint(base, route)).status, 200, `${route} anonymous in open mode`);
    assert.equal((await mint(base, MINTS[0])).status, 200);
    const limited = await mint(base, MINTS[0]);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    const w1Token = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret: SECRET });
    const refused = await fetch(`${base}/v1/source-documents/does-not-exist/pages/1.png?patient_uuid=fixture-patient-001&demo_token=${encodeURIComponent(w1Token)}`);
    assert.equal(refused.status, 403);
  } finally {
    child.kill();
  }
});

test('mintGuard units: constant-time key match, proxy-aware client address, sliding window', () => {
  assert.equal(demoKeyMatches('k', 'k'), true);
  assert.equal(demoKeyMatches('k', 'kk'), false);
  assert.equal(demoKeyMatches('', ''), false);
  assert.equal(demoKeyMatches(undefined, 'k'), false);
  assert.equal(demoKeyMatches(['k'], 'k'), false); // a repeated header arrives as an array
  assert.equal(demoKeyMatches('k', undefined), false);

  const req = (xff, remoteAddress = '172.18.0.5') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress } });
  assert.equal(clientAddress(req('1.1.1.1, 2.2.2.2')), '172.18.0.5');
  assert.equal(clientAddress(req('1.1.1.1, 2.2.2.2'), { trustProxy: true }), '2.2.2.2');
  assert.equal(clientAddress(req(undefined), { trustProxy: true }), '172.18.0.5');
  assert.equal(clientAddress(req(' , '), { trustProxy: true }), '172.18.0.5');

  let clock = 0;
  const limiter = createMintRateLimiter({ limit: 2, windowSeconds: 10, now: () => clock });
  assert.equal(limiter.take('a').allowed, true);
  clock = 4000;
  assert.equal(limiter.take('a').allowed, true);
  const refused = limiter.take('a');
  assert.deepEqual(refused, { allowed: false, retryAfterSeconds: 6 });
  assert.equal(limiter.take('b').allowed, true);
  clock = 10001; // the first take has left the window
  assert.equal(limiter.take('a').allowed, true);
  assert.equal(limiter.take('a').allowed, false);
  assert.throws(() => createMintRateLimiter({ limit: 0 }), /MINT_RATE_LIMIT_CONFIG_INVALID/);
  assert.equal(W2_TOKEN_AUDIENCE, 'agentforge-w2');
});
