// W3 red-team fixes for the synthetic-context mints (/v1/demo-context,
// /v1/source-document-context, /v1/clinical-action-context):
//   F-831d4df407 / F-24b44c5180: a mint needs the evaluator access key.
//   F-6ee92046fb: a mint is rate limited per client address.
// The token format and its patient binding are unchanged (accessContext.js).
import crypto from 'node:crypto';

/** Request header that carries the evaluator access key (Node lower-cases header names). */
export const DEMO_KEY_HEADER = 'x-agentforge-demo-key';
/**
 * Audience this service stamps on the tokens it mints. The frozen Week 1
 * service signs synthetic-demo tokens with the same secret but no audience,
 * so without this check its anonymous mint would bypass the key.
 */
export const W2_TOKEN_AUDIENCE = 'agentforge-w2';
export const DEFAULT_MINT_RATE_LIMIT = 15;
export const DEFAULT_MINT_RATE_WINDOW_SECONDS = 60;

const digest = (value) => crypto.createHash('sha256').update(value, 'utf8').digest();

/**
 * Constant-time key check. Both sides are hashed first, so the comparison
 * time does not depend on where they differ or on the provided length. An
 * unset configured key matches nothing (fail closed).
 */
export function demoKeyMatches(provided, configured) {
  if (typeof configured !== 'string' || !configured || typeof provided !== 'string' || !provided) return false;
  return crypto.timingSafeEqual(digest(provided), digest(configured));
}

/**
 * The address the rate limit counts against. With `trustProxy`, the rightmost
 * X-Forwarded-For entry: the one the trusted proxy (Caddy in deploy/vultr)
 * wrote from its TCP peer. Entries to its left are client-supplied. Without
 * `trustProxy` the header is ignored, since any client can send it.
 */
export function clientAddress(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const forwarded = typeof header === 'string' ? header.split(',').map((entry) => entry.trim()).filter(Boolean).at(-1) : '';
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Sliding-window limiter: at most `limit` accepted takes per client in any
 * `windowSeconds`. A refused take is not recorded, so a client is let back in
 * as soon as its oldest accepted take leaves the window. Memory is bounded by
 * `maxClients`; the least recently seen client is dropped first.
 */
export function createMintRateLimiter({ limit = DEFAULT_MINT_RATE_LIMIT, windowSeconds = DEFAULT_MINT_RATE_WINDOW_SECONDS, now = Date.now, maxClients = 10000 } = {}) {
  if (!Number.isInteger(limit) || limit <= 0 || !Number.isInteger(windowSeconds) || windowSeconds <= 0) throw new Error('MINT_RATE_LIMIT_CONFIG_INVALID');
  const windowMs = windowSeconds * 1000;
  const hits = new Map();
  return {
    limit,
    windowSeconds,
    take(client) {
      const at = now();
      const recent = (hits.get(client) || []).filter((stamp) => stamp > at - windowMs);
      hits.delete(client);
      if (recent.length >= limit) {
        hits.set(client, recent);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - at) / 1000)) };
      }
      recent.push(at);
      hits.set(client, recent);
      if (hits.size > maxClients) hits.delete(hits.keys().next().value);
      return { allowed: true, remaining: limit - recent.length };
    },
  };
}
