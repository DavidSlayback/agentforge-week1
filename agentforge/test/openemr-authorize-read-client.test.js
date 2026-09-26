import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { authorizeUrlFor, buildAuthorizeUrl, createPkcePair, parseRedirectInput, runAuthorization, tokenCacheFrom, REQUIRED_SCOPES } from '../scripts/openemr-authorize-read-client.mjs';
import { OpenEMRRefreshTokenProvider } from '../src/openemrAdapter.js';

// TEST-ONLY fake OpenEMR token endpoint: it answers the authorization_code
// grant only when the PKCE verifier matches the challenge the authorize URL
// carried, the redirect URI matches, and the client authenticates.
const CLIENT = { id: 'read-client', secret: 'synthetic-client-secret' };
const REDIRECT = 'https://openemr.example/oauth-callback';
const GRANTED = 'openid offline_access api:oemr user/patient.rs user/encounter.rs user/medical_problem.rs user/allergy.rs user/medication.rs';
const idToken = `x.${Buffer.from(JSON.stringify({ sub: '9f7c0000-0000-4000-8000-00000000grdr' })).toString('base64url')}.y`;

function fakeTokenEndpoint({ scope = GRANTED, refresh = true } = {}) {
  const state = { challenge: null, calls: [] };
  const fetchImpl = async (url, options) => {
    const form = new URLSearchParams(options.body);
    state.calls.push({ url, method: options.method, contentType: options.headers['content-type'], form: Object.fromEntries(form) });
    const verifierOk = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') === state.challenge;
    const ok = form.get('grant_type') === 'authorization_code' && form.get('code') === 'code-123' && form.get('redirect_uri') === REDIRECT && form.get('client_id') === CLIENT.id && form.get('client_secret') === CLIENT.secret && verifierOk;
    if (!ok) return { ok: false, status: 400, async json() { return { error: 'invalid_grant' }; } };
    return { ok: true, status: 200, async json() { return { access_token: 'access-NEW-secret', ...(refresh ? { refresh_token: 'refresh-NEW-secret' } : {}), expires_in: 3600, token_type: 'Bearer', scope, id_token: idToken }; } };
  };
  return { state, fetchImpl };
}

const env = (cachePath) => ({ AGENTFORGE_OPENEMR_TOKEN_URL: 'https://openemr.example/oauth2/default/token', AGENTFORGE_OPENEMR_CLIENT_ID: CLIENT.id, AGENTFORGE_OPENEMR_CLIENT_SECRET: CLIENT.secret, AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH: cachePath });

/** Drive the whole flow: the "browser" returns the redirect URL for the authorize URL the script printed. */
async function run({ cachePath, endpoint, redirectFor = (authorize) => `${REDIRECT}?code=code-123&state=${authorize.searchParams.get('state')}` }) {
  const lines = [];
  let authorize = null;
  const result = await runAuthorization({
    env: env(cachePath),
    argv: ['--redirect-uri', REDIRECT],
    log: (line) => { lines.push(String(line)); if (String(line).startsWith('https://openemr.example/oauth2/default/authorize')) { authorize = new URL(line); endpoint.state.challenge = authorize.searchParams.get('code_challenge'); } },
    prompt: async () => redirectFor(authorize),
    fetchImpl: endpoint.fetchImpl,
    now: () => 1_000_000,
  });
  return { result, lines, authorize };
}

test('PKCE: an S256 challenge of a 43-character verifier (RFC 7636 appendix B vector)', () => {
  const vectorBytes = Buffer.from([116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]);
  const pair = createPkcePair(() => vectorBytes);
  assert.equal(pair.verifier, 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert.equal(pair.challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(pair.method, 'S256');
  assert.equal(createPkcePair().verifier.length, 43);
});

test('authorize URL: code flow with S256, state, the exact redirect URI and the read scopes', () => {
  const authorizeUrl = authorizeUrlFor('https://host.example/oauth2/default/token');
  assert.equal(authorizeUrl, 'https://host.example/oauth2/default/authorize');
  assert.throws(() => authorizeUrlFor('https://host.example/oauth2/default/other'), /AUTHORIZE_URL_REQUIRED/);
  const url = new URL(buildAuthorizeUrl({ authorizeUrl, clientId: 'c', redirectUri: REDIRECT, state: 's', nonce: 'n', challenge: 'ch' }));
  assert.deepEqual(Object.fromEntries(url.searchParams), { response_type: 'code', client_id: 'c', redirect_uri: REDIRECT, scope: REQUIRED_SCOPES.join(' '), state: 's', nonce: 'n', code_challenge: 'ch', code_challenge_method: 'S256' });
  assert.equal(REQUIRED_SCOPES.includes('offline_access'), true);
});

test('pasted redirect: state must match, errors and foreign URLs are refused, a bare code is accepted unchecked', () => {
  assert.deepEqual(parseRedirectInput(`${REDIRECT}?code=abc&state=s1`, { expectedState: 's1', redirectUri: REDIRECT }), { code: 'abc', stateChecked: true });
  assert.throws(() => parseRedirectInput(`${REDIRECT}?code=abc&state=other`, { expectedState: 's1', redirectUri: REDIRECT }), /STATE_MISMATCH/);
  assert.throws(() => parseRedirectInput(`${REDIRECT}?error=access_denied&state=s1`, { expectedState: 's1', redirectUri: REDIRECT }), /AUTHORIZATION_DENIED: access_denied/);
  assert.throws(() => parseRedirectInput('https://evil.example/cb?code=abc&state=s1', { expectedState: 's1', redirectUri: REDIRECT }), /REDIRECT_URI_MISMATCH/);
  assert.deepEqual(parseRedirectInput('  abc  ', { expectedState: 's1', redirectUri: REDIRECT }), { code: 'abc', stateChecked: false });
  assert.throws(() => parseRedirectInput('', { expectedState: 's1', redirectUri: REDIRECT }), /NO_INPUT/);
});

test('exchange: writes the provider cache format (mode 0600) and prints no token, code, verifier or secret', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentforge-authorize-'));
  const cachePath = path.join(dir, 'token.json');
  await writeFile(cachePath, JSON.stringify({ access_token: 'old', refresh_token: 'refresh-OLD-admin', expires_at: 0 }));
  try {
    const endpoint = fakeTokenEndpoint();
    const { result, lines } = await run({ cachePath, endpoint });
    const [call] = endpoint.state.calls;
    assert.equal(call.method, 'POST');
    assert.equal(call.contentType, 'application/x-www-form-urlencoded');
    assert.equal(call.url, 'https://openemr.example/oauth2/default/token');
    const cache = JSON.parse(await readFile(cachePath, 'utf8'));
    assert.deepEqual(cache, { access_token: 'access-NEW-secret', refresh_token: 'refresh-NEW-secret', expires_at: 1_000_000 + 3_600_000, scope: GRANTED });
    if (process.platform !== 'win32') assert.equal((await stat(cachePath)).mode & 0o777, 0o600);
    assert.equal(result.subject, '9f7c0000-0000-4000-8000-00000000grdr');
    const output = lines.join('\n');
    for (const secret of ['access-NEW-secret', 'refresh-NEW-secret', 'code-123', CLIENT.secret, call.form.code_verifier, idToken]) assert.equal(output.includes(secret), false, 'a secret value was printed');
    // The service's provider reads the new cache as is: no refresh call while the access token is fresh.
    const provider = new OpenEMRRefreshTokenProvider({ tokenUrl: 'x', clientId: CLIENT.id, clientSecret: CLIENT.secret, cachePath, now: () => 1_000_000, fetchImpl: async () => { throw new Error('unexpected refresh'); } });
    assert.equal(await provider.getAccessToken(), 'access-NEW-secret');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('exchange refused or incomplete grant: nothing is written', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentforge-authorize-'));
  const cachePath = path.join(dir, 'token.json');
  const original = JSON.stringify({ refresh_token: 'refresh-OLD-admin' });
  await writeFile(cachePath, original);
  try {
    await assert.rejects(run({ cachePath, endpoint: fakeTokenEndpoint(), redirectFor: (authorize) => `${REDIRECT}?code=wrong-code&state=${authorize.searchParams.get('state')}` }), /TOKEN_EXCHANGE_FAILED: HTTP 400 invalid_grant/);
    // A verifier that does not match the challenge is refused by the endpoint (PKCE is really checked).
    const badPkce = fakeTokenEndpoint();
    await assert.rejects(runAuthorization({ env: env(cachePath), argv: ['--redirect-uri', REDIRECT], log: () => {}, prompt: async () => 'code-123', fetchImpl: badPkce.fetchImpl }), /TOKEN_EXCHANGE_FAILED/);
    await assert.rejects(run({ cachePath, endpoint: fakeTokenEndpoint({ refresh: false }) }), /REFRESH_TOKEN_MISSING/);
    await assert.rejects(run({ cachePath, endpoint: fakeTokenEndpoint({ scope: 'openid offline_access api:oemr user/patient.rs' }) }), /SCOPES_MISSING: user\/encounter\.rs user\/medical_problem\.rs user\/allergy\.rs user\/medication\.rs/);
    assert.equal(await readFile(cachePath, 'utf8'), original);
    await assert.rejects(runAuthorization({ env: {}, argv: [], log: () => {}, prompt: async () => '' }), /CONFIG_MISSING: AGENTFORGE_OPENEMR_TOKEN_URL, AGENTFORGE_OPENEMR_CLIENT_ID, AGENTFORGE_OPENEMR_CLIENT_SECRET, AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH, --redirect-uri/);
    assert.throws(() => tokenCacheFrom({ refresh_token: 'r', scope: GRANTED }), /TOKEN_RESPONSE_INVALID/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
