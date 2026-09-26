import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { authorizedUserMatches, buildAuthorizeUrl, createPkcePair, exchangeCode, parseRedirectInput, requireTokenUrl, runAuthorization, serviceIsRunning, tokenCacheFrom, writeTokenCache, REQUIRED_SCOPES } from '../scripts/openemr-authorize-read-client.mjs';
import { OpenEMRRefreshTokenProvider } from '../src/openemrAdapter.js';

// TEST-ONLY fake OpenEMR token endpoint: it answers the authorization_code
// grant only when the PKCE verifier matches the challenge the authorize URL
// carried, the redirect URI matches, and the client authenticates.
const CLIENT = { id: 'read-client', secret: 'synthetic-client-secret' };
const REDIRECT = 'https://openemr.example/oauth-callback';
const GRANTED = 'openid offline_access api:oemr user/patient.rs user/encounter.rs user/medical_problem.rs user/allergy.rs user/medication.rs';
const GRADER_UUID = '9f7c1e2d-0000-4000-8000-0000000000aa';
const ADMIN_UUID = '1a2b3c4d-0000-4000-8000-0000000000ad';
const idTokenFor = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

function fakeTokenEndpoint({ scope = GRANTED, refresh = true, idClaims = { sub: GRADER_UUID } } = {}) {
  const state = { challenge: null, calls: [] };
  const fetchImpl = async (url, options) => {
    const form = new URLSearchParams(options.body);
    state.calls.push({ url, method: options.method, contentType: options.headers['content-type'], form: Object.fromEntries(form) });
    const verifierOk = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') === state.challenge;
    const ok = form.get('grant_type') === 'authorization_code' && form.get('code') === 'code-123' && form.get('redirect_uri') === REDIRECT && form.get('client_id') === CLIENT.id && form.get('client_secret') === CLIENT.secret && verifierOk;
    if (!ok) return { ok: false, status: 400, async json() { return { error: 'invalid_grant' }; } };
    return { ok: true, status: 200, async json() { return { access_token: 'access-NEW-secret', ...(refresh ? { refresh_token: 'refresh-NEW-secret' } : {}), expires_in: 3600, token_type: 'Bearer', scope, ...(idClaims ? { id_token: idTokenFor(idClaims) } : {}) }; } };
  };
  return { state, fetchImpl };
}

// Production shape: the exchange goes to the Docker-internal token endpoint, the browser to the public authorize URL.
const env = (cachePath, tokenUrl = 'http://openemr/oauth2/default/token') => ({ AGENTFORGE_OPENEMR_TOKEN_URL: tokenUrl, AGENTFORGE_OPENEMR_AUTHORIZE_URL: 'https://openemr.example/oauth2/default/authorize', AGENTFORGE_OPENEMR_CLIENT_ID: CLIENT.id, AGENTFORGE_OPENEMR_CLIENT_SECRET: CLIENT.secret, AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH: cachePath });
const ARGV = ['--redirect-uri', REDIRECT, '--expect-user', 'grader', '--expect-user-uuid', GRADER_UUID];

/** Drive the whole flow: the "browser" returns the redirect URL for the authorize URL the script printed. */
async function run({ cachePath, endpoint, argv = ARGV, envOverride = {}, probeService = async () => false, redirectFor = (authorize) => `${REDIRECT}?code=code-123&state=${authorize.searchParams.get('state')}` }) {
  const lines = [];
  let authorize = null;
  const result = await runAuthorization({
    env: { ...env(cachePath), ...envOverride },
    argv,
    log: (line) => { lines.push(String(line)); if (String(line).startsWith('https://openemr.example/oauth2/default/authorize')) { authorize = new URL(line); endpoint.state.challenge = authorize.searchParams.get('code_challenge'); } },
    prompt: async () => redirectFor(authorize),
    fetchImpl: endpoint.fetchImpl,
    now: () => 1_000_000,
    probeService,
  });
  return { result, lines, authorize };
}

async function withCache(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentforge-authorize-'));
  const cachePath = path.join(dir, 'token.json');
  const original = JSON.stringify({ access_token: 'old', refresh_token: 'refresh-OLD-admin', expires_at: 0 });
  await writeFile(cachePath, original);
  try { await fn({ dir, cachePath, original }); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('PKCE: an S256 challenge of a 43-character verifier (RFC 7636 appendix B vector)', () => {
  const vectorBytes = Buffer.from([116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]);
  const pair = createPkcePair(() => vectorBytes);
  assert.equal(pair.verifier, 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert.equal(pair.challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(pair.method, 'S256');
  assert.equal(createPkcePair().verifier.length, 43);
});

test('URLs: the authorize URL is https only (the browser opens it); the token URL is https or exactly the Docker-internal http://openemr', async () => {
  const authorizeUrl = 'https://host.example/oauth2/default/authorize';
  assert.throws(() => buildAuthorizeUrl({ authorizeUrl: 'http://openemr/oauth2/default/authorize', clientId: 'c', redirectUri: REDIRECT, state: 's', nonce: 'n', challenge: 'ch' }), /AUTHORIZE_URL_NOT_HTTPS/);
  for (const ok of ['http://openemr/oauth2/default/token', 'http://openemr:80/oauth2/default/token', 'https://host.example/oauth2/default/token']) assert.equal(requireTokenUrl(ok).pathname, '/oauth2/default/token', ok);
  for (const bad of ['http://evil/oauth2/default/token', 'http://openemr.evil/oauth2/default/token', 'http://openemr:8080/oauth2/default/token', 'http://evil.example/openemr/oauth2/default/token']) assert.throws(() => requireTokenUrl(bad), /TOKEN_URL_NOT_HTTPS/, bad);
  assert.throws(() => requireTokenUrl('http://user:pw@openemr/oauth2/default/token'), /TOKEN_URL_INVALID/);
  await assert.rejects(exchangeCode({ tokenUrl: 'http://openemr.evil/oauth2/default/token', clientId: 'c', clientSecret: 's', redirectUri: REDIRECT, code: 'x', verifier: 'v', fetchImpl: async () => { throw new Error('must not be called'); } }), /TOKEN_URL_NOT_HTTPS/);
  const url = new URL(buildAuthorizeUrl({ authorizeUrl, clientId: 'c', redirectUri: REDIRECT, state: 's', nonce: 'n', challenge: 'ch' }));
  assert.deepEqual(Object.fromEntries(url.searchParams), { response_type: 'code', client_id: 'c', redirect_uri: REDIRECT, scope: REQUIRED_SCOPES.join(' '), state: 's', nonce: 'n', code_challenge: 'ch', code_challenge_method: 'S256' });
  assert.equal(REQUIRED_SCOPES.includes('offline_access'), true);
});

test('pasted redirect: state must match; errors, foreign URLs and bare codes are refused', () => {
  assert.deepEqual(parseRedirectInput(`${REDIRECT}?code=abc&state=s1`, { expectedState: 's1', redirectUri: REDIRECT }), { code: 'abc' });
  assert.throws(() => parseRedirectInput(`${REDIRECT}?code=abc&state=other`, { expectedState: 's1', redirectUri: REDIRECT }), /STATE_MISMATCH/);
  assert.throws(() => parseRedirectInput(`${REDIRECT}?code=abc`, { expectedState: 's1', redirectUri: REDIRECT }), /STATE_MISMATCH/);
  assert.throws(() => parseRedirectInput(`${REDIRECT}?error=access_denied&state=s1`, { expectedState: 's1', redirectUri: REDIRECT }), /AUTHORIZATION_DENIED: access_denied/);
  assert.throws(() => parseRedirectInput('https://evil.example/cb?code=abc&state=s1', { expectedState: 's1', redirectUri: REDIRECT }), /REDIRECT_URI_MISMATCH/);
  assert.throws(() => parseRedirectInput('  abc  ', { expectedState: 's1', redirectUri: REDIRECT }), /BARE_CODE_REFUSED/);
  assert.throws(() => parseRedirectInput('', { expectedState: 's1', redirectUri: REDIRECT }), /NO_INPUT/);
});

test('who authorized: sub must be the expected users.uuid, and preferred_username (when present) the expected username', () => {
  const expected = { expectUser: 'grader', expectUserUuid: GRADER_UUID };
  assert.deepEqual(authorizedUserMatches({ id_token: idTokenFor({ sub: GRADER_UUID.toUpperCase() }) }, expected), { match: true, reason: null });
  assert.deepEqual(authorizedUserMatches({ id_token: idTokenFor({ sub: GRADER_UUID, preferred_username: 'grader' }) }, expected), { match: true, reason: null });
  assert.equal(authorizedUserMatches({ id_token: idTokenFor({ sub: ADMIN_UUID }) }, expected).reason, 'subject_is_another_user');
  assert.equal(authorizedUserMatches({ id_token: idTokenFor({ sub: GRADER_UUID, preferred_username: 'admin' }) }, expected).reason, 'username_differs');
  assert.equal(authorizedUserMatches({}, expected).reason, 'no_id_token_subject');
});

test('exchange as the expected user: writes the provider cache atomically (0600) and prints no token, code, verifier, uuid or secret', async () => {
  await withCache(async ({ dir, cachePath }) => {
    const endpoint = fakeTokenEndpoint();
    const { result, lines } = await run({ cachePath, endpoint });
    const [call] = endpoint.state.calls;
    assert.equal(call.method, 'POST');
    assert.equal(call.contentType, 'application/x-www-form-urlencoded');
    assert.equal(call.url, 'http://openemr/oauth2/default/token', 'the exchange goes to the Docker-internal token endpoint');
    const cache = JSON.parse(await readFile(cachePath, 'utf8'));
    assert.deepEqual(cache, { access_token: 'access-NEW-secret', refresh_token: 'refresh-NEW-secret', expires_at: 1_000_000 + 3_600_000, scope: GRANTED });
    if (process.platform !== 'win32') assert.equal(result.mode, '0600');
    assert.match(lines.join('\n'), new RegExp(`\\(mode ${result.mode}\\)`), 'the actual mode is reported');
    assert.deepEqual(await readdir(dir), ['token.json'], 'no temp file is left behind');
    assert.ok(lines.includes('Authorized user: grader match'));
    const output = lines.join('\n');
    for (const secret of ['access-NEW-secret', 'refresh-NEW-secret', 'code-123', CLIENT.secret, call.form.code_verifier, GRADER_UUID]) assert.equal(output.includes(secret), false, 'a secret value or uuid was printed');
    // The service's provider reads the new cache as is: no refresh call while the access token is fresh.
    const provider = new OpenEMRRefreshTokenProvider({ tokenUrl: 'https://x/token', clientId: CLIENT.id, clientSecret: CLIENT.secret, cachePath, now: () => 1_000_000, fetchImpl: async () => { throw new Error('unexpected refresh'); } });
    assert.equal(await provider.getAccessToken(), 'access-NEW-secret');
  });
});

test('another user authorized (admin instead of grader), or no id token: refused, nothing written', async () => {
  await withCache(async ({ cachePath, original }) => {
    const lines = [];
    const endpoint = fakeTokenEndpoint({ idClaims: { sub: ADMIN_UUID, preferred_username: 'admin' } });
    await assert.rejects(run({ cachePath, endpoint }).catch((error) => { throw error; }), /AUTHORIZED_USER_MISMATCH: the grant is not grader's; nothing written/);
    await assert.rejects(run({ cachePath, endpoint: fakeTokenEndpoint({ idClaims: null }) }), /AUTHORIZED_USER_MISMATCH/);
    assert.equal(await readFile(cachePath, 'utf8'), original);
    // The mismatch line names only the expected username and the status.
    await runAuthorization({ env: env(cachePath), argv: ARGV, log: (line) => { lines.push(String(line)); if (String(line).startsWith('https://')) endpoint.state.challenge = new URL(line).searchParams.get('code_challenge'); }, prompt: async () => `${REDIRECT}?code=code-123&state=${new URL(lines.find((line) => line.startsWith('https://'))).searchParams.get('state')}`, fetchImpl: endpoint.fetchImpl, probeService: async () => false }).catch(() => {});
    assert.ok(lines.includes('Authorized user: grader MISMATCH (subject_is_another_user)'));
    assert.equal(lines.join('\n').includes(ADMIN_UUID), false);
  });
});

test('refusals before anything is sent: http token URL, running service, missing or malformed expected user', async () => {
  await withCache(async ({ cachePath, original }) => {
    const endpoint = fakeTokenEndpoint();
    await assert.rejects(run({ cachePath, endpoint, envOverride: { AGENTFORGE_OPENEMR_TOKEN_URL: 'http://openemr.evil/oauth2/default/token' } }), /TOKEN_URL_NOT_HTTPS/);
    await assert.rejects(run({ cachePath, endpoint, envOverride: { AGENTFORGE_OPENEMR_TOKEN_URL: 'http://openemr:8080/oauth2/default/token' } }), /TOKEN_URL_NOT_HTTPS/);
    await assert.rejects(run({ cachePath, endpoint, argv: [...ARGV, '--authorize-url', 'http://openemr/oauth2/default/authorize'] }), /AUTHORIZE_URL_NOT_HTTPS/);
    await assert.rejects(run({ cachePath, endpoint, envOverride: { AGENTFORGE_OPENEMR_AUTHORIZE_URL: '' } }), /CONFIG_MISSING: --authorize-url/, 'never derived from the internal token URL');
    await assert.rejects(run({ cachePath, endpoint, probeService: async () => true }), /SERVICE_RUNNING/);
    // The public token endpoint works too.
    const publicEndpoint = fakeTokenEndpoint();
    await run({ cachePath, endpoint: publicEndpoint, envOverride: { AGENTFORGE_OPENEMR_TOKEN_URL: 'https://openemr.example/oauth2/default/token' } });
    assert.equal(publicEndpoint.state.calls[0].url, 'https://openemr.example/oauth2/default/token');
    await writeFile(cachePath, original);
    await assert.rejects(run({ cachePath, endpoint, argv: ['--redirect-uri', REDIRECT] }), /CONFIG_MISSING: --expect-user, --expect-user-uuid/);
    await assert.rejects(run({ cachePath, endpoint, argv: ['--redirect-uri', REDIRECT, '--expect-user', 'grader', '--expect-user-uuid', 'grader'] }), /EXPECT_USER_UUID_INVALID/);
    assert.equal(endpoint.state.calls.length, 0, 'nothing reached the token endpoint');
    assert.equal(await readFile(cachePath, 'utf8'), original);
  });
  // The probe: a service that answers is running; a name that does not resolve is not.
  assert.equal(await serviceIsRunning('http://agentforge-w2:8788/health', { fetchImpl: async () => ({ ok: true, status: 200 }) }), true);
  assert.equal(await serviceIsRunning('http://agentforge-w2:8788/health', { fetchImpl: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); } }), false);
});

test('exchange refused or incomplete grant: nothing is written', async () => {
  await withCache(async ({ cachePath, original }) => {
    await assert.rejects(run({ cachePath, endpoint: fakeTokenEndpoint(), redirectFor: (authorize) => `${REDIRECT}?code=wrong-code&state=${authorize.searchParams.get('state')}` }), /TOKEN_EXCHANGE_FAILED: HTTP 400 invalid_grant/);
    // A verifier that does not match the challenge is refused by the endpoint (PKCE is really checked).
    const badPkce = fakeTokenEndpoint();
    let state = '';
    await assert.rejects(runAuthorization({ env: env(cachePath), argv: ARGV, log: (line) => { if (String(line).startsWith('https://')) state = new URL(line).searchParams.get('state'); }, prompt: async () => `${REDIRECT}?code=code-123&state=${state}`, fetchImpl: badPkce.fetchImpl, probeService: async () => false }), /TOKEN_EXCHANGE_FAILED/);
    await assert.rejects(run({ cachePath, endpoint: fakeTokenEndpoint({ refresh: false }) }), /REFRESH_TOKEN_MISSING/);
    await assert.rejects(run({ cachePath, endpoint: fakeTokenEndpoint({ scope: 'openid offline_access api:oemr user/patient.rs' }) }), /SCOPES_MISSING: user\/encounter\.rs user\/medical_problem\.rs user\/allergy\.rs user\/medication\.rs/);
    assert.equal(await readFile(cachePath, 'utf8'), original);
    await assert.rejects(runAuthorization({ env: {}, argv: [], log: () => {}, prompt: async () => '' }), /CONFIG_MISSING: AGENTFORGE_OPENEMR_TOKEN_URL, AGENTFORGE_OPENEMR_CLIENT_ID, AGENTFORGE_OPENEMR_CLIENT_SECRET, AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH, --authorize-url, --redirect-uri, --expect-user, --expect-user-uuid/);
    assert.throws(() => tokenCacheFrom({ refresh_token: 'r', scope: GRANTED }), /TOKEN_RESPONSE_INVALID/);
  });
});

test('atomic write: a rename that fails (a single-file bind mount) leaves the old cache and no temp file', async () => {
  await withCache(async ({ dir, cachePath, original }) => {
    // A directory at the target makes rename fail, as a bind-mounted file does (EBUSY) in the container.
    const blocked = path.join(dir, 'blocked');
    await writeFile(path.join(dir, 'placeholder'), '');
    await import('node:fs/promises').then((fs) => fs.mkdir(path.join(blocked, 'inner'), { recursive: true }));
    await assert.rejects(writeTokenCache(blocked, { access_token: 'a' }), /TOKEN_CACHE_RENAME_FAILED/);
    assert.deepEqual((await readdir(dir)).sort(), ['blocked', 'placeholder', 'token.json']);
    assert.equal(await readFile(cachePath, 'utf8'), original);
  });
});
