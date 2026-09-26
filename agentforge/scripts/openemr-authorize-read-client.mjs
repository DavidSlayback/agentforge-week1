#!/usr/bin/env node
/**
 * F-LIVE: re-authorize AgentForge's OpenEMR read client as a clinician user.
 *
 * OAuth2 authorization code + PKCE (S256) for the confidential read client
 * whose refresh token `OpenEMRRefreshTokenProvider` (src/openemrAdapter.js)
 * uses for live chart reads. The operator runs it; the clinician (`grader`)
 * signs in and consents in a browser:
 *
 *   1. It prints the authorize URL.
 *   2. The clinician opens it, signs in on OpenEMR's OAuth login page and
 *      clicks Authorize. OpenEMR redirects the browser to the client's
 *      registered redirect URI with `?code=…&state=…` (the page itself may
 *      fail to load; only the address bar matters).
 *   3. The operator pastes that redirect URL (or the bare code) back here
 *      within a minute (OpenEMR codes expire after 60 s). It checks `state`,
 *      exchanges the code with the PKCE verifier and the client secret, and
 *      writes the token cache JSON the provider reads
 *      (`{access_token, refresh_token, expires_at, scope}`, mode 0600).
 *
 * It never prints a token, code, verifier or the client secret; it prints the
 * granted scopes, the expiry and the id token's `sub` (the user uuid) so the
 * operator can confirm who authorized it. It writes nothing unless the grant
 * has a refresh token and every required read scope.
 *
 * Config, from the same env the service uses (deploy/vultr/README.md):
 * AGENTFORGE_OPENEMR_TOKEN_URL, AGENTFORGE_OPENEMR_CLIENT_ID,
 * AGENTFORGE_OPENEMR_CLIENT_SECRET, AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH.
 * Required flag: --redirect-uri <exact registered redirect URI>. Optional:
 * --authorize-url (default: the token URL with /token → /authorize),
 * --scope "<space separated>" (default: DEFAULT_SCOPE).
 *
 * Usage: node scripts/openemr-authorize-read-client.mjs --redirect-uri '<uri>'
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/** The read routes OpenEMRRestAdapter calls, plus a refresh token. `user/document.rs` is no longer needed: notes are not read (F-LIVE). */
export const REQUIRED_SCOPES = Object.freeze(['openid', 'offline_access', 'api:oemr', 'user/patient.rs', 'user/encounter.rs', 'user/medical_problem.rs', 'user/allergy.rs', 'user/medication.rs']);
export const DEFAULT_SCOPE = REQUIRED_SCOPES.join(' ');

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

/** RFC 7636 S256 pair: a 43-character verifier and its SHA-256 challenge. */
export function createPkcePair(random = crypto.randomBytes) {
  const verifier = base64url(random(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

export function authorizeUrlFor(tokenUrl) {
  const url = new URL(tokenUrl);
  if (!/\/token$/.test(url.pathname)) throw new Error('AUTHORIZE_URL_REQUIRED: the token URL does not end in /token; pass --authorize-url');
  url.pathname = url.pathname.replace(/\/token$/, '/authorize');
  url.search = '';
  return url.toString();
}

export function buildAuthorizeUrl({ authorizeUrl, clientId, redirectUri, scope = DEFAULT_SCOPE, state, nonce, challenge }) {
  const url = new URL(authorizeUrl);
  // OpenEMR needs `state` to redeem the code (it restores the session by it) and S256 when a challenge is sent.
  const params = { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope, state, nonce, code_challenge: challenge, code_challenge_method: 'S256' };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * The code from what the operator pasted: the full redirect URL (its `state`
 * must match) or the bare code (state then cannot be checked).
 */
export function parseRedirectInput(input, { expectedState, redirectUri }) {
  const text = String(input || '').trim();
  if (!text) throw new Error('NO_INPUT: paste the redirect URL or the code');
  if (!/^https?:\/\//i.test(text)) return { code: text, stateChecked: false };
  const url = new URL(text);
  const expected = new URL(redirectUri);
  if (`${url.origin}${url.pathname}` !== `${expected.origin}${expected.pathname}`) throw new Error('REDIRECT_URI_MISMATCH: the pasted URL is not the registered redirect URI');
  const error = url.searchParams.get('error');
  if (error) throw new Error(`AUTHORIZATION_DENIED: ${error}`);
  const code = url.searchParams.get('code');
  if (!code) throw new Error('CODE_MISSING: the pasted URL has no code parameter');
  if (url.searchParams.get('state') !== expectedState) throw new Error('STATE_MISMATCH: the pasted URL is not from this authorization');
  return { code, stateChecked: true };
}

/** Exchange the code at the token endpoint (client_secret_post, as the refresh provider authenticates). */
export async function exchangeCode({ tokenUrl, clientId, clientSecret, redirectUri, code, verifier, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
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

/** The id token's subject (the OpenEMR user uuid); the JWT is not verified here, it only labels the output. */
export function idTokenSubject(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).sub || null; } catch { return null; }
}

/**
 * Write in place (no rename): on the VM the cache is a single-file bind mount,
 * and a rename would detach it from the running container.
 */
export async function writeTokenCache(cachePath, cache) {
  await fs.writeFile(cachePath, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
  await fs.chmod(cachePath, 0o600).catch(() => {});
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split(/=(.*)/s);
    if (!['--redirect-uri', '--authorize-url', '--scope'].includes(flag)) throw new Error(`UNKNOWN_ARGUMENT: ${flag}`);
    args[flag.slice(2)] = inline !== undefined ? inline : argv[(index += 1)];
  }
  return args;
}

/** The whole flow with injectable I/O, so the tests drive it without a browser or OpenEMR. */
export async function runAuthorization({ env = process.env, argv = [], prompt, log = console.log, fetchImpl = globalThis.fetch, now = Date.now, random = crypto.randomBytes }) {
  const args = parseArgs(argv);
  const tokenUrl = env.AGENTFORGE_OPENEMR_TOKEN_URL;
  const clientId = env.AGENTFORGE_OPENEMR_CLIENT_ID;
  const clientSecret = env.AGENTFORGE_OPENEMR_CLIENT_SECRET;
  const cachePath = env.AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH;
  const redirectUri = args['redirect-uri'] || env.AGENTFORGE_OPENEMR_REDIRECT_URI;
  const missing = [['AGENTFORGE_OPENEMR_TOKEN_URL', tokenUrl], ['AGENTFORGE_OPENEMR_CLIENT_ID', clientId], ['AGENTFORGE_OPENEMR_CLIENT_SECRET', clientSecret], ['AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH', cachePath], ['--redirect-uri', redirectUri]].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`CONFIG_MISSING: ${missing.join(', ')}`);
  const pkce = createPkcePair(random);
  const state = base64url(random(16));
  const nonce = base64url(random(16));
  const scope = args.scope || DEFAULT_SCOPE;
  const authorizeUrl = buildAuthorizeUrl({ authorizeUrl: args['authorize-url'] || authorizeUrlFor(tokenUrl), clientId, redirectUri, scope, state, nonce, challenge: pkce.challenge });
  log('1. Open this URL in a browser, sign in to OpenEMR as the clinician (grader) and click Authorize. Leave every scope ticked.');
  log(authorizeUrl);
  log(`2. OpenEMR then redirects to ${redirectUri}?code=...&state=... (the page may not load; copy the address bar).`);
  const pasted = await prompt('3. Paste the full redirect URL (or the code) within 60 s: ');
  const { code, stateChecked } = parseRedirectInput(pasted, { expectedState: state, redirectUri });
  if (!stateChecked) log('Note: a bare code was pasted, so state was not checked.');
  const response = await exchangeCode({ tokenUrl, clientId, clientSecret, redirectUri, code, verifier: pkce.verifier, fetchImpl });
  const cache = tokenCacheFrom(response, { now });
  await writeTokenCache(cachePath, cache);
  const subject = idTokenSubject(response.id_token);
  log(`Wrote the token cache ${cachePath} (mode 0600).`);
  log(`Granted scopes: ${cache.scope}`);
  log(`Access token expires in ${Math.round((cache.expires_at - now()) / 1000)} s; the refresh token was saved.`);
  log(`Authorized by OpenEMR user uuid: ${subject || 'unknown (no id_token)'}`);
  return { cachePath, scope: cache.scope, subject };
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
