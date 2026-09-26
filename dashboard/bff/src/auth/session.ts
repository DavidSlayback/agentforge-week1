import { randomBytes } from 'node:crypto';

/** Idle timeout (catalog 1.06). */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Login transaction lifetime (`dashboard_tx`). */
export const LOGIN_TX_TTL_MS = 10 * 60 * 1000;

/**
 * A signed-in BFF session. Tokens never leave this process: the browser holds
 * only the random session id in an HttpOnly cookie.
 */
export interface Session {
  readonly id: string;
  readonly accessToken: string;
  /** Our own verified id token; the only value ever sent as `id_token_hint` (1.03). */
  readonly idToken: string;
  readonly createdAt: number;
  /** Absolute expiry = the access token's expiry; no refresh token is ever held (1.08). */
  readonly expiresAt: number;
  lastSeenAt: number;
}

/** Server-side half of a login transaction (`state`, `nonce`, PKCE verifier). */
export interface LoginTransaction {
  readonly id: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly expiresAt: number;
}

export function randomId(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * In-memory session and login-transaction store. A restart signs everyone out
 * (accepted tradeoff, MIGRATION-REACT.md §2.3 / R-5).
 */
export class SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #transactions = new Map<string, LoginTransaction>();

  createSession(tokens: { accessToken: string; idToken: string; expiresInSec: number }, now: number): Session {
    this.#sweep(now);
    const session: Session = {
      id: randomId(),
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      createdAt: now,
      expiresAt: now + tokens.expiresInSec * 1000,
      lastSeenAt: now,
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  /** Returns the live session and refreshes its idle clock; destroys it when idle or expired. */
  getSession(id: string | undefined, now: number): Session | null {
    if (!id) return null;
    const session = this.#sessions.get(id);
    if (!session) return null;
    if (now >= session.expiresAt || now - session.lastSeenAt >= IDLE_TIMEOUT_MS) {
      this.#sessions.delete(id);
      return null;
    }
    session.lastSeenAt = now;
    return session;
  }

  destroySession(id: string | undefined): Session | null {
    if (!id) return null;
    const session = this.#sessions.get(id) ?? null;
    this.#sessions.delete(id);
    return session;
  }

  createTransaction(fields: Omit<LoginTransaction, 'id' | 'expiresAt'>, now: number): LoginTransaction {
    this.#sweep(now);
    const tx: LoginTransaction = { ...fields, id: randomId(), expiresAt: now + LOGIN_TX_TTL_MS };
    this.#transactions.set(tx.id, tx);
    return tx;
  }

  /** Single use: the transaction is removed whether or not it is still valid. */
  takeTransaction(id: string | undefined, now: number): LoginTransaction | null {
    if (!id) return null;
    const tx = this.#transactions.get(id) ?? null;
    this.#transactions.delete(id);
    if (!tx || now >= tx.expiresAt) return null;
    return tx;
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  #sweep(now: number): void {
    for (const [id, s] of this.#sessions) {
      if (now >= s.expiresAt || now - s.lastSeenAt >= IDLE_TIMEOUT_MS) this.#sessions.delete(id);
    }
    for (const [id, tx] of this.#transactions) {
      if (now >= tx.expiresAt) this.#transactions.delete(id);
    }
  }
}
