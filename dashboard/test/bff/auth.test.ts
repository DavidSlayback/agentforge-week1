import { describe, expect, it } from 'vitest';
import { IDLE_TIMEOUT_MS, LOGIN_TX_TTL_MS, MAX_PENDING_TRANSACTIONS, SessionStore } from '../../bff/src/auth/session.ts';
import { pkceChallenge, sanitizeReturnTo } from '../../bff/src/auth/oauth.ts';
import { OAUTH_SCOPE } from '../../bff/src/config.ts';
import { UPSTREAM_ROUTES } from '../../core/upstreamRoutes.ts';
import {
  buildTestApp,
  cookieValue,
  FakeOpenEmr,
  JWKS_URL,
  makeIdTokenSigner,
  PATIENT,
  signIn,
  SYNTHETIC_ACCESS_TOKEN,
  TEST_ENV,
  testConfig,
  TOKEN_URL,
} from '../support/harness.ts';

const EXPECTED_SCOPE =
  'openid api:oemr api:fhir user/Patient.rs user/CareTeam.rs user/Practitioner.rs user/Organization.rs user/MedicationRequest.rs user/patient.rs user/allergy.rs user/medical_problem.rs user/medication.rs user/prescription.rs user/encounter.rs user/vital.rs user/list.r';

describe('OAuth scope string', () => {
  it('requests the scope of every allow-listed upstream route (a missing one only shows up as a 401 on that route)', () => {
    const requested = OAUTH_SCOPE.split(' ');
    for (const spec of Object.values(UPSTREAM_ROUTES)) expect(requested, spec.id).toContain(spec.scope);
  });
});

describe('GET /dashboard/login', () => {
  it('redirects to the issuer authorize endpoint with S256, state, nonce and the exact scopes', async () => {
    const app = await buildTestApp({ fake: new FakeOpenEmr() });
    const res = await app.inject({ method: 'GET', url: '/dashboard/login' });
    expect(res.statusCode).toBe(302);
    const url = new URL(String(res.headers.location));
    expect(`${url.origin}${url.pathname}`).toBe('https://openemr.test/oauth2/default/authorize');
    const q = url.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe(TEST_ENV.DASHBOARD_OAUTH_CLIENT_ID);
    expect(q.get('redirect_uri')).toBe('http://localhost:8790/dashboard/callback');
    expect(q.get('scope')).toBe(EXPECTED_SCOPE);
    expect(q.get('scope')).not.toContain('offline_access');
    expect(q.get('scope')).not.toContain('launch');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('state')).not.toBe(q.get('nonce'));
    expect(q.has('client_secret')).toBe(false);
    expect(String(res.headers.location)).not.toContain(TEST_ENV.DASHBOARD_OAUTH_CLIENT_SECRET);
    const tx = [res.headers['set-cookie']].flat().find((c) => c?.startsWith('dashboard_tx='));
    expect(tx).toMatch(/HttpOnly/);
    expect(tx).toMatch(/SameSite=Lax/);
    expect(tx).toMatch(/Path=\/dashboard/);
    expect(tx).toMatch(/Max-Age=600/);
  });

  it('only accepts a returnTo under /dashboard/', () => {
    expect(sanitizeReturnTo('/dashboard/patients/x', '/dashboard')).toBe('/dashboard/patients/x');
    expect(sanitizeReturnTo('/dashboard/', '/dashboard')).toBe('/dashboard/');
    for (const bad of ['https://evil.test/', '//evil.test/dashboard/', '/dashboard//evil', '/other', '/dashboard\\x', undefined, 7]) {
      expect(sanitizeReturnTo(bad, '/dashboard')).toBe('/dashboard/');
    }
  });

  // W3 hardening H4: `/dashboard/../interface/...` passed the prefix check and the browser resolved
  // it outside the dashboard. Dot segments are refused in every spelling, as is anything that only
  // looks like a `/dashboard/` path before decoding.
  it('refuses a returnTo with dot segments, encoded dots, encoded slashes or backslashes', () => {
    for (const bad of [
      '/dashboard/../interface/main/main_screen.php',
      '/dashboard/..',
      '/dashboard/./../interface/',
      '/dashboard/patients/../../interface/',
      '/dashboard/%2e%2e/interface/',
      '/dashboard/%2E%2E/interface/',
      '/dashboard/.%2e/interface/',
      '/dashboard/%2e/x',
      '/dashboard/%252e%252e/interface/',
      '/dashboard/%2f%2fevil.test/',
      '/dashboard/%5c%5cevil.test/',
      '/dashboard/%zz',
      '/dashboard/patients/x/..',
    ]) {
      expect(sanitizeReturnTo(bad, '/dashboard'), bad).toBe('/dashboard/');
    }
  });

  // W3 hardening H4: /login is unauthenticated, and each call creates a server-side transaction. The
  // store is capped (oldest evicted) and its expiry sweep is amortized instead of walking every
  // entry on every request (40k logins took 9.9 s before: quadratic).
  it('caps pending login transactions (oldest evicted) and sweeps at most once per interval', () => {
    const store = new SessionStore({ maxPendingTransactions: 3, sweepIntervalMs: 60_000 });
    const fields = { state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/dashboard/' };
    const ids = [0, 1, 2, 3, 4].map(() => store.createTransaction(fields, 1000).id);
    expect(store.pendingTransactionCount).toBe(3);
    expect(store.takeTransaction(ids[0], 1000)).toBeNull(); // evicted
    expect(store.takeTransaction(ids[1], 1000)).toBeNull(); // evicted
    expect(store.takeTransaction(ids[4], 1000)).not.toBeNull(); // newest kept
    expect(store.sweepCount).toBe(1); // five creates in one interval: one sweep
    for (let i = 0; i < 100; i += 1) store.createTransaction(fields, 2000 + i);
    expect(store.sweepCount).toBe(1);
    // Past the interval the next create sweeps; past the TTL every older transaction is gone.
    store.createTransaction(fields, 2000 + LOGIN_TX_TTL_MS + 60_000);
    expect(store.sweepCount).toBe(2);
    expect(store.pendingTransactionCount).toBe(1);
  });

  it('bounds pending logins through the real /login route', async () => {
    const store = new SessionStore({ maxPendingTransactions: 5 });
    const app = await buildTestApp({ fake: new FakeOpenEmr(), sessionStore: store });
    for (let i = 0; i < 12; i += 1) expect((await app.inject({ method: 'GET', url: '/dashboard/login' })).statusCode).toBe(302);
    expect(store.pendingTransactionCount).toBe(5);
    expect(MAX_PENDING_TRANSACTIONS).toBeGreaterThan(0);
    expect(MAX_PENDING_TRANSACTIONS).toBeLessThanOrEqual(10_000);
  });
});

describe('GET /dashboard/callback', () => {
  it('exchanges the code server-side with the secret and PKCE verifier, verifies the id token, sets the session', async () => {
    const fake = new FakeOpenEmr();
    const signer = await makeIdTokenSigner();
    const app = await buildTestApp({ fake });
    const { sessionCookie, callbackLocation, authorizeUrl } = await signIn(app, fake, signer, { returnTo: `/dashboard/patients/${PATIENT.p13}` });

    expect(callbackLocation).toBe(`/dashboard/patients/${PATIENT.p13}`);
    expect(sessionCookie).not.toBe('');
    const tokenCall = fake.calls.find((c) => c.url === TOKEN_URL);
    expect(tokenCall?.method).toBe('POST');
    const form = new URLSearchParams(tokenCall?.body ?? '');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('synthetic-auth-code');
    expect(form.get('client_id')).toBe(TEST_ENV.DASHBOARD_OAUTH_CLIENT_ID);
    expect(form.get('client_secret')).toBe(TEST_ENV.DASHBOARD_OAUTH_CLIENT_SECRET); // 1.01: always sent
    expect(form.get('redirect_uri')).toBe('http://localhost:8790/dashboard/callback');
    const verifier = form.get('code_verifier') ?? '';
    expect(pkceChallenge(verifier)).toBe(authorizeUrl.searchParams.get('code_challenge'));
    expect(fake.calls.some((c) => c.url === JWKS_URL)).toBe(true);
    expect(fake.unexpected).toEqual([]);

    const session = await app.inject({ method: 'GET', url: '/dashboard/bff/session', cookies: { dashboard_sid: sessionCookie } });
    expect(session.json()).toMatchObject({ authenticated: true });
  });

  it('rejects a bad state without calling the token endpoint', async () => {
    const fake = new FakeOpenEmr();
    const app = await buildTestApp({ fake });
    const login = await app.inject({ method: 'GET', url: '/dashboard/login' });
    const tx = cookieValue(login.headers['set-cookie'], 'dashboard_tx') ?? '';
    const res = await app.inject({ method: 'GET', url: '/dashboard/callback?code=abc&state=forged-state-value', cookies: { dashboard_tx: tx } });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/dashboard/?signin=failed');
    expect(cookieValue(res.headers['set-cookie'], 'dashboard_sid')).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it('rejects a replayed transaction (single use) and a missing or forged tx cookie', async () => {
    const fake = new FakeOpenEmr();
    const signer = await makeIdTokenSigner();
    const app = await buildTestApp({ fake });
    const login = await app.inject({ method: 'GET', url: '/dashboard/login' });
    const tx = cookieValue(login.headers['set-cookie'], 'dashboard_tx') ?? '';
    const state = new URL(String(login.headers.location)).searchParams.get('state') ?? '';
    fake.on('POST', TOKEN_URL, { status: 400, body: { error: 'invalid_grant', hint: 'LEAK' } });
    fake.on('GET', JWKS_URL, { status: 200, body: signer.jwks });
    const first = await app.inject({ method: 'GET', url: `/dashboard/callback?code=abc&state=${state}`, cookies: { dashboard_tx: tx } });
    expect(first.headers.location).toBe('/dashboard/?signin=failed'); // token endpoint said no
    expect(first.body).not.toContain('invalid_grant');
    const replay = await app.inject({ method: 'GET', url: `/dashboard/callback?code=abc&state=${state}`, cookies: { dashboard_tx: tx } });
    expect(replay.headers.location).toBe('/dashboard/?signin=failed');
    const none = await app.inject({ method: 'GET', url: `/dashboard/callback?code=abc&state=${state}` });
    expect(none.headers.location).toBe('/dashboard/?signin=failed');
    const forged = await app.inject({ method: 'GET', url: `/dashboard/callback?code=abc&state=${state}`, cookies: { dashboard_tx: 'unsigned-value' } });
    expect(forged.headers.location).toBe('/dashboard/?signin=failed');
    expect(fake.calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it('rejects an id token with the wrong nonce, audience or issuer', async () => {
    for (const variant of ['nonce', 'audience', 'issuer'] as const) {
      const fake = new FakeOpenEmr();
      const signer = await makeIdTokenSigner();
      const app = await buildTestApp({ fake });
      const login = await app.inject({ method: 'GET', url: '/dashboard/login' });
      const tx = cookieValue(login.headers['set-cookie'], 'dashboard_tx') ?? '';
      const q = new URL(String(login.headers.location)).searchParams;
      const idToken = await signer.sign(
        { nonce: variant === 'nonce' ? 'another-nonce' : q.get('nonce') },
        { ...(variant === 'audience' ? { audience: 'another-client' } : {}), ...(variant === 'issuer' ? { issuer: 'https://evil.test/oauth2/default' } : {}) },
      );
      fake.on('POST', TOKEN_URL, { status: 200, body: { access_token: SYNTHETIC_ACCESS_TOKEN, id_token: idToken, token_type: 'Bearer', expires_in: 3600 } });
      fake.on('GET', JWKS_URL, { status: 200, body: signer.jwks });
      const res = await app.inject({ method: 'GET', url: `/dashboard/callback?code=abc&state=${q.get('state') ?? ''}`, cookies: { dashboard_tx: tx } });
      expect(res.headers.location, variant).toBe('/dashboard/?signin=failed');
      expect(cookieValue(res.headers['set-cookie'], 'dashboard_sid'), variant).toBeNull();
    }
  });

  // W3 hardening H4: jose checks `exp` only when it is present, so a token without one never expired.
  it('rejects an id token without exp, iat or sub', async () => {
    for (const claim of ['exp', 'iat', 'sub'] as const) {
      const fake = new FakeOpenEmr();
      const signer = await makeIdTokenSigner();
      const app = await buildTestApp({ fake });
      const login = await app.inject({ method: 'GET', url: '/dashboard/login' });
      const tx = cookieValue(login.headers['set-cookie'], 'dashboard_tx') ?? '';
      const q = new URL(String(login.headers.location)).searchParams;
      const idToken = await signer.sign({ nonce: q.get('nonce') }, { omit: [claim] });
      fake.on('POST', TOKEN_URL, { status: 200, body: { access_token: SYNTHETIC_ACCESS_TOKEN, id_token: idToken, token_type: 'Bearer', expires_in: 3600 } });
      fake.on('GET', JWKS_URL, { status: 200, body: signer.jwks });
      const res = await app.inject({ method: 'GET', url: `/dashboard/callback?code=abc&state=${q.get('state') ?? ''}`, cookies: { dashboard_tx: tx } });
      expect(res.headers.location, claim).toBe('/dashboard/?signin=failed');
      expect(cookieValue(res.headers['set-cookie'], 'dashboard_sid'), claim).toBeNull();
    }
  });

  it('treats an authorization error redirect as a failed sign-in', async () => {
    const fake = new FakeOpenEmr();
    const app = await buildTestApp({ fake });
    const login = await app.inject({ method: 'GET', url: '/dashboard/login' });
    const tx = cookieValue(login.headers['set-cookie'], 'dashboard_tx') ?? '';
    const state = new URL(String(login.headers.location)).searchParams.get('state') ?? '';
    const res = await app.inject({ method: 'GET', url: `/dashboard/callback?error=access_denied&state=${state}`, cookies: { dashboard_tx: tx } });
    expect(res.headers.location).toBe('/dashboard/?signin=failed');
    expect(fake.calls).toEqual([]);
  });
});

describe('POST /dashboard/logout', () => {
  it('refuses a request without the public Origin (403)', async () => {
    const app = await buildTestApp({ fake: new FakeOpenEmr() });
    const none = await app.inject({ method: 'POST', url: '/dashboard/logout' });
    expect(none.statusCode).toBe(403);
    const other = await app.inject({ method: 'POST', url: '/dashboard/logout', headers: { origin: 'https://evil.test' } });
    expect(other.statusCode).toBe(403);
  });

  it('destroys the session first, then sends the browser to end-session with our id token', async () => {
    const fake = new FakeOpenEmr();
    const signer = await makeIdTokenSigner();
    const store = new SessionStore();
    const app = await buildTestApp({ fake, sessionStore: store });
    const { sessionCookie, idToken } = await signIn(app, fake, signer);
    expect(store.sessionCount).toBe(1);

    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/logout',
      headers: { origin: 'http://localhost:8790', 'content-type': 'application/x-www-form-urlencoded' },
      cookies: { dashboard_sid: sessionCookie },
      payload: '',
    });
    expect(res.statusCode).toBe(303);
    expect(store.sessionCount).toBe(0);
    const loc = new URL(String(res.headers.location));
    expect(`${loc.origin}${loc.pathname}`).toBe('https://openemr.test/oauth2/default/logout');
    expect(loc.searchParams.get('id_token_hint')).toBe(idToken);
    expect(loc.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:8790/dashboard/');
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect([res.headers['set-cookie']].flat().join(';')).toMatch(/dashboard_sid=;/);

    const after = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/header`, cookies: { dashboard_sid: sessionCookie } });
    expect(after.statusCode).toBe(401);
  });

  it('without a session just returns to the landing page', async () => {
    const app = await buildTestApp({ fake: new FakeOpenEmr() });
    const res = await app.inject({ method: 'POST', url: '/dashboard/logout', headers: { origin: 'http://localhost:8790' } });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/dashboard/');
  });
});

describe('session timeouts (1.06)', () => {
  it('expires on idle and at the access token expiry', () => {
    const store = new SessionStore();
    const s = store.createSession({ accessToken: 'a', idToken: 'i', expiresInSec: 3600 }, 0);
    expect(store.getSession(s.id, IDLE_TIMEOUT_MS - 1)).not.toBeNull();
    expect(store.getSession(s.id, 2 * IDLE_TIMEOUT_MS - 2)).not.toBeNull(); // activity refreshed the idle clock
    expect(store.getSession(s.id, 3600 * 1000)).toBeNull(); // absolute expiry
    const idle = store.createSession({ accessToken: 'a', idToken: 'i', expiresInSec: 3600 }, 0);
    expect(store.getSession(idle.id, IDLE_TIMEOUT_MS)).toBeNull();
  });

  it('an upstream 401 destroys the BFF session', async () => {
    const fake = new FakeOpenEmr();
    const signer = await makeIdTokenSigner();
    const store = new SessionStore();
    const app = await buildTestApp({ fake, sessionStore: store, config: testConfig() });
    const { sessionCookie } = await signIn(app, fake, signer);
    fake.on('GET', `http://openemr/apis/default/fhir/Patient/${PATIENT.p13}`, { status: 401, body: null });
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/header`, cookies: { dashboard_sid: sessionCookie } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ kind: 'reauth' });
    expect(store.sessionCount).toBe(0);
  });
});
