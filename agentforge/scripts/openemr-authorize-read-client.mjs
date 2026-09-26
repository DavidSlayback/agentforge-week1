#!/usr/bin/env node
/**
 * F-LIVE: re-authorize AgentForge's OpenEMR read client as a clinician user.
 *
 * OAuth2 authorization code + PKCE (S256) for the confidential read client
 * whose refresh token `OpenEMRRefreshTokenProvider` (src/openemrAdapter.js)
 * uses for live chart reads. The operator runs it; the clinician (`grader`)
 * signs in and consents in a browser:
 *
 *   1. It refuses to run while `agentforge-w2` answers on the Docker network
 *      (the running service caches the old refresh token and would write it
 *      back over the new one). Stop the service first; recreate it after.
 *   2. It prints the authorize URL (https only).
 *   3. The clinician opens it, signs in on OpenEMR's OAuth login page and
 *      clicks Authorize. OpenEMR redirects the browser to the client's
 *      registered redirect URI with `?code=…&state=…` (the page itself may
 *      fail to load; only the address bar matters).
 *   4. The operator pastes that whole redirect URL back within a minute
 *      (OpenEMR codes expire after 60 s). A bare code is refused: `state`
 *      must be checked. It exchanges the code with the PKCE verifier and the
 *      client secret (https only).
 *   5. It checks who authorized: the id token's `sub` must equal the
 *      expected user's `users.uuid` (`--expect-user-uuid`, from the
 *      read-only SQL in the runbook), and its `preferred_username`, when
 *      present, the expected username. The id token comes straight from the
 *      token endpoint over TLS, which OIDC Core 3.1.3.7 accepts in place of
 *      a signature check.
 *   6. Only then it writes the token cache JSON the provider reads
 *      (`{access_token, refresh_token, expires_at, scope}`) atomically: a
 *      0600 temp file in the same directory, renamed over the cache.
 *
 * It never prints a token, code, verifier, uuid or the client secret; it
 * prints the granted scopes, the expiry, the expected username with the match
 * status, and the file's actual mode. It writes nothing unless the grant has
 * a refresh token, every required read scope, and the expected user.
 *
 * Config, from the same env the service uses (deploy/vultr/README.md):
 * AGENTFORGE_OPENEMR_TOKEN_URL, AGENTFORGE_OPENEMR_CLIENT_ID,
 * AGENTFORGE_OPENEMR_CLIENT_SECRET, AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH.
 * Required flags: --redirect-uri <exact registered redirect URI>,
 * --expect-user <username>, --expect-user-uuid <that user's users.uuid>.
 * Optional: --authorize-url (default: the token URL with /token → /authorize),
 * --scope "<space separated>" (default: DEFAULT_SCOPE), --service-url (the
 * running-service probe, default http://agentforge-w2:8788/health).
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/** The read routes OpenEMRRestAdapter calls, plus a refresh token. `user/document.rs` is no longer needed: notes are not read (F-LIVE). */
export const REQUIRED_SCOPES = Object.freeze(['openid', 'offline_access', 'api:oemr', 'user/patient.rs', 'user/encounter.rs', 'user/medical_problem.rs', 'user/allergy.rs', 'user/medication.rs']);
export const DEFAULT_SCOPE = REQUIRED_SCOPES.join(' ');
export const DEFAULT_SERVICE_PROBE_URL = 'http://agentforge-w2:8788/health';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

/** RFC 7636 S256 pair: a 43-character verifier and its SHA-256 challenge. */
export function createPkcePair(random = crypto.randomBytes) {
  const verifier = base64url(random(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

/** The code, the client secret and the tokens cross these URLs: https only, no exception. */
export function requireHttps(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name}_INVALID: not a URL`); }
  if (url.protocol !== 'https:') throw new Error(`${name}_NOT_HTTPS: ${url.protocol} is refused; use https`);
  return url;
}

export function authorizeUrlFor(tokenUrl) {
  const url = requireHttps(tokenUrl, 'TOKEN_URL');
  if (!/\/token$/.test(url.pathname)) throw new Error('AUTHORIZE_URL_REQUIRED: the token URL does not end in /token; pass --authorize-url');
  url.pathname = url.pathname.replace(/\/token$/, '/authorize');
  url.search = '';
  return url.toString();
}

export function buildAuthorizeUrl({ authorizeUrl, clientId, redirectUri, scope = DEFAULT_SCOPE, state, nonce, challenge }) {
  const url = requireHttps(authorizeUrl, 'AUTHORIZE_URL');
  // OpenEMR needs `state` to redeem the code (it restores the session by it) and S256 when a challenge is sent.
  const params = { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope, state, nonce, code_challenge: challenge, code_challenge_method: 'S256' };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** The code from the pasted redirect URL. Its `state` must match; a bare code is refused. */
export function parseRedirectInput(input, { expectedState, redirectUri }) {
  const text = String(input || '').trim();
  if (!text) throw new Error('NO_INPUT: paste the full redirect URL');
  if (!/^https?:\/\//i.test(text)) throw new Error('BARE_CODE_REFUSED: paste the full redirect URL, so its state can be checked');
  const url = new URL(text);
  const expected = new URL(redirectUri);
  if (`${url.origin}${url.pathname}` !== `${expected.origin}${expected.pathname}`) throw new Error('REDIRECT_URI_MISMATCH: the pasted URL is not the registered redirect URI');
  const error = url.searchParams.get('error');
  if (error) throw new Error(`AUTHORIZATION_DENIED: ${error}`);
  const code = url.searchParams.get('code');
  if (!code) throw new Error('CODE_MISSING: the pasted URL has no code parameter');
  if (url.searchParams.get('state') !== expectedState) throw new Error('STATE_MISMATCH: the pasted URL is not from this authorization');
  return { code };
}

/** Exchange the code at the token endpoint (client_secret_post, as the refresh provider authenticates). */
export async function exchangeCode({ tokenUrl, clientId, clientSecret, redirectUri, code, verifier, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  requireHttps(tokenUrl, 'TOKEN_URL');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret, code_verifier: verifier });
  const response = await fetchImpl(tokenUrl, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(timeoutMs) });
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  // OAuth error codes are safe to show; token fields are never echoed.
  if (!response.ok) throw new Error(`TOKEN_EXCHANGE_FAILED: HTTP ${response.status}${typeof payload.error === 'string' ? ` ${payload.error}` : ''}`);
  return payload;
}

/** The provider's cache shape from a token response, or an error naming what is missing (never a value). */
export function tokenCacheFrom(response, { now = Date.now, requiredScopes = REQUIRED_SCOPES } = {}) {
  if (typeof response?.access_token !== 'string' || !response.access_token) throw new Error('TOKEN_RESPONSE_INVALID: no access_token');
  if (typeof response.refresh_token !== 'string' || !response.refresh_token) throw new Error('REFRESH_TOKEN_MISSING: offline_access was not granted; nothing written');
  const granted = String(response.scope || '').split(/\s+/).filter(Boolean);
  const missing = requiredScopes.filter((scope) => scope !== 'openid' && !granted.includes(scope));
  if (missing.length) throw new Error(`SCOPES_MISSING: ${missing.join(' ')} (re-run and leave every scope ticked on the consent page); nothing written`);
  return { access_token: response.access_token, refresh_token: response.refresh_token, expires_at: now() + Number(response.expires_in || 3600) * 1000, scope: granted.join(' ') };
}

/** The id token's claims (from the token endpoint over TLS), or null. */
export function idTokenClaims(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}

/**
 * Did the expected user authorize? `sub` (OpenEMR sets it to the user's
 * `users.uuid`) must equal the expected uuid, and `preferred_username`, when
 * the grant carries it, the expected username.
 */
export function authorizedUserMatches(response, { expectUser, expectUserUuid }) {
  const claims = idTokenClaims(response?.id_token);
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) return { match: false, reason: 'no_id_token_subject' };
  if (claims.sub.toLowerCase() !== String(expectUserUuid).toLowerCase()) return { match: false, reason: 'subject_is_another_user' };
  if (typeof claims.preferred_username === 'string' && claims.preferred_username && claims.preferred_username !== expectUser) return { match: false, reason: 'username_differs' };
  return { match: true, reason: null };
}

/**
 * Atomic write: a 0600 temp file in the cache's directory, renamed over the
 * cache. A failed chmod fails the write; so does a POSIX mode that leaves any
 * group or other bit. Returns the file's actual mode, e.g. `0600`.
 */
export async function writeTokenCache(cachePath, cache, { random = crypto.randomBytes } = {}) {
  const temp = path.join(path.dirname(cachePath), `.${path.basename(cachePath)}.${random(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temp, `${JSON.stringify(cache)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.chmod(temp, 0o600);
    const mode = (await fs.stat(temp)).mode & 0o777;
    if (process.platform !== 'win32' && (mode & 0o077)) throw new Error(`TOKEN_CACHE_MODE_UNSAFE: ${mode.toString(8).padStart(4, '0')}`);
    try {
      await fs.rename(temp, cachePath);
    } catch (error) {
      throw new Error(`TOKEN_CACHE_RENAME_FAILED: ${error.code || 'error'} (a single-file bind mount cannot be replaced; mount the secrets directory as the runbook shows)`);
    }
    return ((await fs.stat(cachePath)).mode & 0o777).toString(8).padStart(4, '0');
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** True when the service answers on the Docker network (then it must be stopped first). */
export async function serviceIsRunning(url, { fetchImpl = globalThis.fetch, timeoutMs = 2000 } = {}) {
  try {
    await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

const FLAGS = ['--redirect-uri', '--authorize-url', '--scope', '--expect-user', '--expect-user-uuid', '--service-url'];
export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split(/=(.*)/s);
    if (!FLAGS.includes(flag)) throw new Error(`UNKNOWN_ARGUMENT: ${flag}`);
    args[flag.slice(2)] = inline !== undefined ? inline : argv[(index += 1)];
  }
  return args;
}

/** The whole flow with injectable I/O, so the tests drive it without a browser, OpenEMR or Docker. */
export async function runAuthorization({ env = process.env, argv = [], prompt, log = console.log, fetchImpl = globalThis.fetch, now = Date.now, random = crypto.randomBytes, probeService = (url) => serviceIsRunning(url) }) {
  const args = parseArgs(argv);
  const tokenUrl = env.AGENTFORGE_OPENEMR_TOKEN_URL;
  const clientId = env.AGENTFORGE_OPENEMR_CLIENT_ID;
  const clientSecret = env.AGENTFORGE_OPENEMR_CLIENT_SECRET;
  const cachePath = env.AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH;
  const redirectUri = args['redirect-uri'] || env.AGENTFORGE_OPENEMR_REDIRECT_URI;
  const expectUser = args['expect-user'];
  const expectUserUuid = args['expect-user-uuid'];
  const missing = [['AGENTFORGE_OPENEMR_TOKEN_URL', tokenUrl], ['AGENTFORGE_OPENEMR_CLIENT_ID', clientId], ['AGENTFORGE_OPENEMR_CLIENT_SECRET', clientSecret], ['AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH', cachePath], ['--redirect-uri', redirectUri], ['--expect-user', expectUser], ['--expect-user-uuid', expectUserUuid]].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`CONFIG_MISSING: ${missing.join(', ')}`);
  if (!UUID.test(expectUserUuid)) throw new Error('EXPECT_USER_UUID_INVALID: pass the users.uuid from the runbook SQL');
  requireHttps(tokenUrl, 'TOKEN_URL');
  const authorizeBase = args['authorize-url'] || authorizeUrlFor(tokenUrl);
  requireHttps(authorizeBase, 'AUTHORIZE_URL');
  if (await probeService(args['service-url'] || DEFAULT_SERVICE_PROBE_URL)) throw new Error('SERVICE_RUNNING: agentforge-w2 answers; stop it first (it caches the old refresh token and would write it back), then recreate it after this helper');
  const pkce = createPkcePair(random);
  const state = base64url(random(16));
  const nonce = base64url(random(16));
  const scope = args.scope || DEFAULT_SCOPE;
  const authorizeUrl = buildAuthorizeUrl({ authorizeUrl: authorizeBase, clientId, redirectUri, scope, state, nonce, challenge: pkce.challenge });
  log(`1. Open this URL in a browser, sign in to OpenEMR as ${expectUser} and click Authorize. Leave every scope ticked.`);
  log(authorizeUrl);
  log(`2. OpenEMR then redirects to ${redirectUri}?code=...&state=... (the page may not load; copy the address bar).`);
  const pasted = await prompt('3. Paste the full redirect URL within 60 s: ');
  const { code } = parseRedirectInput(pasted, { expectedState: state, redirectUri });
  const response = await exchangeCode({ tokenUrl, clientId, clientSecret, redirectUri, code, verifier: pkce.verifier, fetchImpl });
  const cache = tokenCacheFrom(response, { now });
  const user = authorizedUserMatches(response, { expectUser, expectUserUuid });
  log(`Authorized user: ${expectUser} ${user.match ? 'match' : `MISMATCH (${user.reason})`}`);
  if (!user.match) throw new Error(`AUTHORIZED_USER_MISMATCH: the grant is not ${expectUser}'s; nothing written`);
  const mode = await writeTokenCache(cachePath, cache, { random });
  log(`Wrote the token cache ${cachePath} (mode ${mode}).`);
  log(`Granted scopes: ${cache.scope}`);
  log(`Access token expires in ${Math.round((cache.expires_at - now()) / 1000)} s; the refresh token was saved.`);
  return { cachePath, scope: cache.scope, user: expectUser, mode };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === (await fs.realpath(process.argv[1]).catch(() => process.argv[1])).toLowerCase();
if (invokedDirectly) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await runAuthorization({ argv: process.argv.slice(2), prompt: (question) => rl.question(question) });
  } catch (error) {
    // Error messages here are codes plus names, never token values.
    console.error(`Authorization failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}
