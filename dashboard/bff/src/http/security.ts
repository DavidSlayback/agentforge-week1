import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';

/**
 * Referrer policy for every BFF response and the SPA's own `<meta name="referrer">` (they must match).
 * `strict-origin`: a Referer carries at most the origin, never the path with the patient uuid, and
 * the browser still sends a real `Origin` on same-origin POSTs (the sign-out form).
 */
export const REFERRER_POLICY = 'strict-origin';

/** Paths whose responses must never be cached (PHI, auth transitions). */
function isNoStore(path: string, basePath: string): boolean {
  return (
    path.startsWith(`${basePath}/bff/`) ||
    path === `${basePath}/login` ||
    path === `${basePath}/callback` ||
    path === `${basePath}/logout` ||
    path === `${basePath}/health` ||
    path === `${basePath}/ready`
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
 */
export function registerSecurity(app: FastifyInstance, config: Config): void {
  const csp = contentSecurityPolicy(config);
  const bffPrefix = `${config.basePath}/bff/`;

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (!path.startsWith(bffPrefix)) return;
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
    const path = req.url.split('?')[0] ?? '';
    reply.header('content-security-policy', csp);
    // The patient uuid is in the URL, so no Referer ever carries a path: `strict-origin` sends the
    // origin alone. Not `no-referrer`: under it browsers send `Origin: null` on the same-origin sign-out
    // form POST, which the logout Origin check (rightly) refuses, so sign-out failed with 403.
    reply.header('referrer-policy', REFERRER_POLICY);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    if (isNoStore(path, config.basePath)) reply.header('cache-control', 'no-store');
    return payload;
  });
}
