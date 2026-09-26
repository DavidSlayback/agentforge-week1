import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { pino } from 'pino';
import { SessionStore } from '../../bff/src/auth/session.ts';
import { loadConfig, type Config } from '../../bff/src/config.ts';
import { buildApp, LOGGER_OPTIONS } from '../../bff/src/server.ts';

/** Test-only helpers: fixtures, a fake OpenEMR, a JWKS signer and a log capture. */

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

export interface FixtureResponse {
  readonly status: number;
  readonly body: unknown;
}

function isFixtureResponse(v: unknown): v is FixtureResponse {
  return typeof v === 'object' && v !== null && 'status' in v && typeof v.status === 'number' && 'body' in v;
}

/** Read a fixture file (`shaped/…` or `hand-built/…`), dropping its `_meta`. */
export function readFixtureFile(relPath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES, relPath), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`bad fixture ${relPath}`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) if (k !== '_meta') out[k] = v;
  return out;
}

/** One route's response from a multi-route fixture file. */
export function routeFixture(relPath: string, routeId: string): FixtureResponse {
  const v = readFixtureFile(relPath)[routeId];
  if (!isFixtureResponse(v)) throw new Error(`fixture ${relPath} has no ${routeId}`);
  return v;
}

/** A single-response fixture file (hand-built shapes). */
export function responseFixture(relPath: string): FixtureResponse {
  const v = readFixtureFile(relPath);
  if (!isFixtureResponse(v)) throw new Error(`fixture ${relPath} is not a response`);
  return v;
}

export const PATIENT = {
  p3: 'a2c331a5-3b72-45c1-884e-94015f1f34fa',
  p12: 'a2d4d05f-5ff1-4d5d-9b6f-883f99ffc212',
  p13: 'a2d4d063-d949-4f5a-9001-01c1d919afc6',
  dashSyn01: '8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d',
  dashSyn02: '8e5045ab-b8c0-11f1-8c7a-0ed9af59d05d',
} as const;

export const TEST_ENV = {
  PORT: '8790',
  DASHBOARD_PUBLIC_ORIGIN: 'http://localhost:8790',
  DASHBOARD_OAUTH_ISSUER: 'https://openemr.test/oauth2/default',
  DASHBOARD_OPENEMR_INTERNAL_URL: 'http://openemr',
  DASHBOARD_OAUTH_CLIENT_ID: 'test-client-id-0001',
  DASHBOARD_OAUTH_CLIENT_SECRET: 'test-client-secret-value-0001',
  DASHBOARD_SESSION_SECRET: 'test-session-secret-0123456789-abcdefghij',
  DASHBOARD_OPENEMR_TZ: 'UTC',
  DASHBOARD_DEMO_PATIENTS: `Demo A (data-rich)=${PATIENT.p13}`,
} as const;

export function testConfig(overrides: Record<string, string> = {}, staticDir: string | null = null): Config {
  return loadConfig({ ...TEST_ENV, ...overrides }, staticDir);
}

/** A built-SPA stand-in so static routes can be exercised without `vite build`. */
export function makeStaticDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-static-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Patient Dashboard</title><div id="root"></div>');
  return dir;
}

export interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

type Responder = FixtureResponse | ((call: RecordedCall) => FixtureResponse | Promise<FixtureResponse>);

/**
 * A fake OpenEMR. Every call is recorded with its exact URL; a URL with no
 * registered response is answered 599 and listed in `unexpected`, so tests can
 * assert the outbound URL set exactly (the allow-list contract).
 */
export class FakeOpenEmr {
  readonly calls: RecordedCall[] = [];
  readonly unexpected: string[] = [];
  readonly #routes = new Map<string, Responder>();

  on(method: string, url: string, responder: Responder): this {
    this.#routes.set(`${method} ${url}`, responder);
    return this;
  }

  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = typeof init?.body === 'string' ? init.body : null;
    const call: RecordedCall = { method, url: input, headers, body };
    this.calls.push(call);
    const responder = this.#routes.get(`${method} ${input}`);
    if (!responder) {
      this.unexpected.push(`${method} ${input}`);
      return new Response('unexpected', { status: 599 });
    }
    const r = typeof responder === 'function' ? await responder(call) : responder;
    const text = r.body === null || r.body === undefined ? '' : JSON.stringify(r.body);
    return new Response(text === '' ? null : text, { status: r.status, headers: { 'content-type': 'application/json' } });
  };
}

/** An RS256 key pair standing in for OpenEMR's OAuth key, with a JWKS and an id-token signer. */
export async function makeIdTokenSigner(): Promise<{
  jwks: { keys: JWK[] };
  sign: (claims: Record<string, unknown>, opts?: { issuer?: string; audience?: string; expiresInSec?: number }) => Promise<string>;
}> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  return {
    jwks: { keys: [jwk] },
    sign: (claims, opts = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(opts.issuer ?? TEST_ENV.DASHBOARD_OAUTH_ISSUER)
        .setAudience(opts.audience ?? TEST_ENV.DASHBOARD_OAUTH_CLIENT_ID)
        .setSubject('synthetic-user-uuid')
        .setIssuedAt()
        .setExpirationTime(`${String(opts.expiresInSec ?? 3600)}s`)
        .sign(privateKey),
  };
}

/** A pino logger (with the production options) whose output lines are kept in memory. */
export function captureLogger(): { logger: ReturnType<typeof pino>; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  return { logger: pino(LOGGER_OPTIONS, stream), lines };
}

export async function buildTestApp(opts: {
  fake: FakeOpenEmr;
  config?: Config;
  now?: () => number;
  sessionStore?: SessionStore;
  logger?: ReturnType<typeof pino>;
  buildSha?: string;
}) {
  return buildApp({
    config: opts.config ?? testConfig(),
    fetch: opts.fake.fetch,
    now: opts.now ?? (() => Date.parse('2026-09-25T18:00:00Z')),
    logger: opts.logger ?? pino({ level: 'silent' }),
    sessionStore: opts.sessionStore ?? new SessionStore(),
    buildSha: opts.buildSha ?? 'unversioned',
  });
}

/** Pull `name=value` for one cookie out of Set-Cookie headers. */
export function cookieValue(setCookie: string | string[] | undefined, name: string): string | null {
  const list = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of list) {
    const first = c.split(';')[0] ?? '';
    const eq = first.indexOf('=');
    if (first.slice(0, eq) === name) return first.slice(eq + 1);
  }
  return null;
}

export const TOKEN_URL = 'http://openemr/oauth2/default/token';
export const JWKS_URL = 'http://openemr/oauth2/default/jwk';
export const SYNTHETIC_ACCESS_TOKEN = 'synthetic-access-token-SECRETMARKER-0001';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/**
 * Drive the full browser sign-in through `inject`: /login → (OpenEMR, faked)
 * → /callback. Returns the session cookie pair and what OpenEMR was sent.
 */
export async function signIn(
  app: TestApp,
  fake: FakeOpenEmr,
  signer: Awaited<ReturnType<typeof makeIdTokenSigner>>,
  opts: { idTokenNonce?: string; returnTo?: string } = {},
): Promise<{ sessionCookie: string; idToken: string; callbackLocation: string; authorizeUrl: URL }> {
  const login = await app.inject({ method: 'GET', url: `/dashboard/login${opts.returnTo ? `?returnTo=${encodeURIComponent(opts.returnTo)}` : ''}` });
  const authorizeUrl = new URL(String(login.headers.location));
  const tx = cookieValue(login.headers['set-cookie'], 'dashboard_tx');
  if (!tx) throw new Error('no dashboard_tx cookie');
  const idToken = await signer.sign({ nonce: opts.idTokenNonce ?? authorizeUrl.searchParams.get('nonce') });
  fake.on('POST', TOKEN_URL, { status: 200, body: { access_token: SYNTHETIC_ACCESS_TOKEN, id_token: idToken, token_type: 'Bearer', expires_in: 3600, scope: 'openid' } });
  fake.on('GET', JWKS_URL, { status: 200, body: signer.jwks });
  const cb = await app.inject({
    method: 'GET',
    url: `/dashboard/callback?code=synthetic-auth-code&state=${encodeURIComponent(authorizeUrl.searchParams.get('state') ?? '')}`,
    cookies: { dashboard_tx: tx },
  });
  const sid = cookieValue(cb.headers['set-cookie'], 'dashboard_sid');
  return { sessionCookie: sid ?? '', idToken, callbackLocation: String(cb.headers.location), authorizeUrl };
}
