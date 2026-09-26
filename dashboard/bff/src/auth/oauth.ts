import { createHash } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { FetchLike, Logger } from '../upstream/client.ts';
import type { LoginTransaction } from './session.ts';

/**
 * OpenEMR OAuth2 / OIDC as a confidential client: authorization code + PKCE
 * S256 + `state` + `nonce`, the client secret sent on every `/token` call
 * (1.01 / M-4), id token verified against the JWKS (1.03). Endpoints come from
 * configuration; discovery and `scopes_supported` are never read (10.01).
 *
 * Hand-rolled `fetch` + `jose` (the playbook's named fallback to
 * `openid-client`): every upstream call goes through the injected `fetch`, so
 * the flow is testable against a mocked token endpoint and JWKS.
 */
export interface OAuthDeps {
  readonly config: Config;
  readonly fetch: FetchLike;
  readonly logger: Logger;
  readonly now: () => number;
}

export interface TokenSet {
  readonly accessToken: string;
  readonly idToken: string;
  readonly expiresInSec: number;
}

/** Browser-facing and server-side OpenEMR endpoints, derived from the configured issuer. */
export function endpoints(config: Config): { authorize: string; endSession: string; token: string; jwks: string } {
  const issuerPath = new URL(config.issuer).pathname.replace(/\/+$/, ''); // e.g. /oauth2/default
  return {
    authorize: `${config.issuer}/authorize`,
    endSession: `${config.issuer}/logout`,
    // Server-side calls use the Docker-network origin (R-3).
    token: `${config.openemrInternalUrl}${issuerPath}/token`,
    jwks: `${config.openemrInternalUrl}${issuerPath}/jwk`,
  };
}

export function redirectUri(config: Config): string {
  return `${config.publicOrigin}${config.basePath}/callback`;
}

export function postLogoutRedirectUri(config: Config): string {
  return `${config.publicOrigin}${config.basePath}/`;
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** `returnTo` must be a path under `/dashboard/`; anything else falls back to the landing page. */
export function sanitizeReturnTo(raw: unknown, basePath: string): string {
  const fallback = `${basePath}/`;
  if (typeof raw !== 'string' || raw.length > 512) return fallback;
  let hasControlChar = false;
  for (let i = 0; i < raw.length; i += 1) if (raw.charCodeAt(i) < 0x20) hasControlChar = true;
  if (!raw.startsWith(`${basePath}/`) || raw.includes('//') || raw.includes('\\') || hasControlChar) {
    return fallback;
  }
  return raw;
}

export function buildAuthorizeUrl(config: Config, tx: LoginTransaction): string {
  const url = new URL(endpoints(config).authorize);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri(config));
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', tx.state);
  url.searchParams.set('nonce', tx.nonce);
  url.searchParams.set('code_challenge', pkceChallenge(tx.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export function buildEndSessionUrl(config: Config, idToken: string, state: string): string {
  const url = new URL(endpoints(config).endSession);
  url.searchParams.set('id_token_hint', idToken);
  url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri(config));
  url.searchParams.set('state', state);
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1),
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z.coerce.number().int().positive(),
});

/**
 * Exchange the authorization code server-side. Returns `null` on any failure;
 * the exchange error body is never logged or shown (the user sees one generic
 * "Sign-in failed" message). A refresh token, if one ever came back, is dropped.
 */
export async function exchangeCode(deps: OAuthDeps, code: string, codeVerifier: string): Promise<TokenSet | null> {
  const { config } = deps;
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(config),
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: codeVerifier,
  });
  const started = deps.now();
  let status = 0;
  try {
    const res = await deps.fetch(endpoints(config).token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      redirect: 'manual',
    });
    status = res.status;
    const body: unknown = await res.json().catch(() => null);
    const parsed = res.ok ? tokenResponseSchema.safeParse(body) : null;
    deps.logger.info({ routeId: 'oauth.token', status, durationMs: deps.now() - started, parsed: parsed?.success === true }, 'token exchange');
    if (!parsed?.success) return null;
    return { accessToken: parsed.data.access_token, idToken: parsed.data.id_token, expiresInSec: parsed.data.expires_in };
  } catch {
    deps.logger.warn({ routeId: 'oauth.token', status, durationMs: deps.now() - started }, 'token exchange failed');
    return null;
  }
}

/** Verify signature (JWKS), `iss`, `aud = client_id`, `exp` and `nonce`. */
export async function verifyIdToken(deps: OAuthDeps, idToken: string, nonce: string): Promise<boolean> {
  const { config } = deps;
  try {
    const res = await deps.fetch(endpoints(config).jwks, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      redirect: 'manual',
    });
    if (!res.ok) {
      deps.logger.warn({ routeId: 'oauth.jwks', status: res.status }, 'jwks fetch failed');
      return false;
    }
    const jwks = (await res.json()) as JSONWebKeySet;
    const { payload } = await jwtVerify(idToken, createLocalJWKSet(jwks), {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ['RS256'],
      currentDate: new Date(deps.now()),
    });
    const ok = payload['nonce'] === nonce;
    if (!ok) deps.logger.warn({ routeId: 'oauth.id_token' }, 'id token nonce mismatch');
    return ok;
  } catch {
    deps.logger.warn({ routeId: 'oauth.id_token' }, 'id token verification failed');
    return false;
  }
}
