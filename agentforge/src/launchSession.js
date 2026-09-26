import crypto from 'node:crypto';

/**
 * F-LIVE: single-use OpenEMR launch tokens.
 *
 * The module launcher (`oe-module-agentforge/public/index.php`) puts a 280 s
 * signed token in the page URL. The first page load exchanges it, once, for a
 * server-side launch session: an in-memory record of the verified read (and
 * optional write) context that ends when the launch token would have expired.
 *
 * - The session secret travels only in an HttpOnly, Secure, SameSite=Strict
 *   cookie (`af_launch_<tag>`), scoped to the public base path.
 * - The page and its links carry only a handle, `launch-session.<tag>.read`
 *   or `.write`. The tag is not a secret: without the cookie the handle
 *   resolves to nothing.
 * - A second load of the same launch token is refused (`replayed`), and
 *   server.js never accepts an `openemr-module` token on the API directly, so
 *   a copied launch URL or token is useless after the first load.
 *
 * Sessions live in this process only: a restart ends them (relaunch from
 * OpenEMR). This is not an OpenEMR session and does not extend the token TTL.
 */
export const LAUNCH_HANDLE_PREFIX = 'launch-session.';
export const LAUNCH_COOKIE_PREFIX = 'af_launch_';
const HANDLE = /^launch-session\.([A-Za-z0-9_-]{16})\.(read|write)$/;
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

export class LaunchSessionStore {
  constructor({ now = () => Date.now(), maxSessions = 500 } = {}) {
    this.now = now;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
    this.consumed = new Map();
  }

  /** True when `value` has the shape of a launch-session handle (it may still resolve to nothing). */
  static isHandle(value) { return typeof value === 'string' && value.startsWith(LAUNCH_HANDLE_PREFIX); }

  /**
   * Exchange a verified launch token for a session, once. `readContext` and
   * `writeContext` are contexts `verifySignedContext` returned for
   * `readToken` and `writeToken` (the write pair is optional).
   */
  exchange({ readToken, readContext, writeToken = '', writeContext = null }) {
    this.prune();
    if (!readToken || !readContext) return { status: 'invalid' };
    const readKey = digest(readToken).toString('hex');
    const writeKey = writeToken ? digest(writeToken).toString('hex') : null;
    if (this.consumed.has(readKey) || (writeKey && this.consumed.has(writeKey))) return { status: 'replayed' };
    const expiresAtMs = Number(readContext.expires_at) * 1000;
    const remainingMs = expiresAtMs - this.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return { status: 'expired' };
    this.consumed.set(readKey, expiresAtMs);
    if (writeKey) this.consumed.set(writeKey, Number(writeContext?.expires_at) * 1000 || expiresAtMs);
    while (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
    const tag = crypto.randomBytes(12).toString('base64url');
    const secret = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(tag, { secretDigest: digest(secret), read: readContext, write: writeContext, expiresAtMs });
    return {
      status: 'created',
      cookieName: `${LAUNCH_COOKIE_PREFIX}${tag}`,
      cookieValue: secret,
      maxAgeSeconds: Math.max(1, Math.floor(remainingMs / 1000)),
      readHandle: `${LAUNCH_HANDLE_PREFIX}${tag}.read`,
      writeHandle: writeContext ? `${LAUNCH_HANDLE_PREFIX}${tag}.write` : '',
    };
  }

  /** The verified context a handle names, only with its session cookie and before the session ends. */
  resolve(handle, cookieHeader) {
    const match = HANDLE.exec(String(handle || ''));
    if (!match) return null;
    const [, tag, scope] = match;
    const session = this.sessions.get(tag);
    if (!session) return null;
    if (session.expiresAtMs <= this.now()) { this.sessions.delete(tag); return null; }
    const secret = parseCookies(cookieHeader)[`${LAUNCH_COOKIE_PREFIX}${tag}`];
    if (!secret || !crypto.timingSafeEqual(digest(secret), session.secretDigest)) return null;
    return (scope === 'read' ? session.read : session.write) || null;
  }

  prune() {
    const now = this.now();
    for (const [tag, session] of this.sessions) if (session.expiresAtMs <= now) this.sessions.delete(tag);
    for (const [key, expiresAtMs] of this.consumed) if (expiresAtMs <= now) this.consumed.delete(key);
  }
}

/** `Set-Cookie` for a created session: HttpOnly, Secure, SameSite=Strict, the page's path, the session's remaining life. */
export function launchSessionCookie(exchange, basePath = '') {
  return `${exchange.cookieName}=${exchange.cookieValue}; Path=${basePath || '/'}; Max-Age=${exchange.maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}
