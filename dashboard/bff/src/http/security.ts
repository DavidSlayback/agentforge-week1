import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';

/**
 * Referrer policy for every BFF response and the SPA's own `<meta name="referrer">` (they must match).
 * `strict-origin`: a Referer carries at most the origin, never the path with the patient uuid, and
 * the browser still sends a real `Origin` on same-origin POSTs (the sign-out form).
 */
export const REFERRER_POLICY = 'strict-origin';

/**
 * Route templates whose responses must never be cached (PHI, auth transitions).
 * Keyed on the router's matched template (`req.routeOptions.url`), never the raw
 * URL: the router decodes the path, so `/dashboard/%62ff/...` reaches a `/bff/`
 * handler while a raw-URL prefix check misses it (W3 hardening H4). An unmatched
 * request (404) is not cached either.
 */
function isNoStore(routeUrl: string | undefined, basePath: string): boolean {
  return (
    routeUrl === undefined ||
    routeUrl.startsWith(`${basePath}/bff/`) ||
    routeUrl === `${basePath}/login` ||
    routeUrl === `${basePath}/callback` ||
    routeUrl === `${basePath}/logout` ||
    routeUrl === `${basePath}/health` ||
    routeUrl === `${basePath}/ready`
  );
}

export function contentSecurityPolicy(config: Config): string {
  // form-action must also allow the issuer origin: the sign-out form POST is
  // answered with a 303 to OpenEMR's end-session endpoint, and browsers apply
  // form-action to that redirect. In production both are the same origin.
  const issuerOrigin = new URL(config.issuer).origin;
  const formAction = issuerOrigin === config.publicOrigin ? "'self'" : `'self' ${issuerOrigin}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    `form-action ${formAction}`,
  ].join('; ');
}

/**
 * Security headers on every response, request hygiene on `/bff/*`
 * (MIGRATION-REACT.md §2.3): cross-site fetches refused, and any query string
 * refused, because the only input is the validated path parameter.
 *
 * Both hooks decide on the route the router matched (`req.routeOptions.url`,
 * set before `onRequest` runs), so every spelling of a path that reaches a
 * `/bff/` handler (`%62ff`, `%62%66%66`, `%64ashboard`, dot segments) meets the
 * same guards. A raw-URL prefix match was bypassable (W3 hardening H4).
 */
export function registerSecurity(app: FastifyInstance, config: Config): void {
  const csp = contentSecurityPolicy(config);
  const bffPrefix = `${config.basePath}/bff/`;

  app.addHook('onRequest', async (req, reply) => {
    if (req.routeOptions.url?.startsWith(bffPrefix) !== true) return;
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') {
      return reply.code(403).send({ error: 'cross-site request refused' });
    }
    if (req.url.includes('?')) {
      return reply.code(400).send({ error: 'query strings are not accepted' });
    }
    return undefined;
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('content-security-policy', csp);
    // The patient uuid is in the URL, so no Referer ever carries a path: `strict-origin` sends the
    // origin alone. Not `no-referrer`: under it browsers send `Origin: null` on the same-origin sign-out
    // form POST, which the logout Origin check (rightly) refuses, so sign-out failed with 403.
    reply.header('referrer-policy', REFERRER_POLICY);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    if (isNoStore(req.routeOptions.url, config.basePath)) reply.header('cache-control', 'no-store');
    return payload;
  });
}
