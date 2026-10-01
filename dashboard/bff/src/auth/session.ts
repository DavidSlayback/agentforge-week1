import { randomBytes } from 'node:crypto';

/** Idle timeout (catalog 1.06). */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Login transaction lifetime (`dashboard_tx`). */
export const LOGIN_TX_TTL_MS = 10 * 60 * 1000;
/**
 * Pending login transactions kept at once. `/login` is unauthenticated, so this
 * bounds what anyone can make the BFF hold (about 0.4 kB each, so about 2 MB at
 * the cap). Past it the oldest pending transaction is evicted; that sign-in
 * fails with the generic "Sign-in failed" and can simply be retried.
 */
export const MAX_PENDING_TRANSACTIONS = 5000;
/** The expiry sweep runs at most once per interval, so a request never walks every entry. */
export const SWEEP_INTERVAL_MS = 60 * 1000;

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

export interface SessionStoreOptions {
  readonly maxPendingTransactions?: number;
  readonly sweepIntervalMs?: number;
}

export function randomId(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * In-memory session and login-transaction store. A restart signs everyone out
 * (accepted tradeoff, MIGRATION-REACT.md §2.3 / R-5).
 *
 * Bounded (W3 hardening H4): pending transactions are capped, oldest evicted
 * first (a `Map` iterates in insertion order), and expired entries are swept at
 * most once per `sweepIntervalMs`. Lookups still check expiry themselves, so a
 * late sweep never lets an expired session or transaction through.
 */
export class SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #transactions = new Map<string, LoginTransaction>();
  readonly #maxPendingTransactions: number;
  readonly #sweepIntervalMs: number;
  #lastSweepAt: number | null = null;
  #sweepCount = 0;

  constructor(options: SessionStoreOptions = {}) {
    this.#maxPendingTransactions = options.maxPendingTransactions ?? MAX_PENDING_TRANSACTIONS;
    this.#sweepIntervalMs = options.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
  }

  createSession(tokens: { accessToken: string; idToken: string; expiresInSec: number }, now: number): Session {
    this.#maybeSweep(now);
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
    this.#maybeSweep(now);
    for (const oldest of this.#transactions.keys()) {
      if (this.#transactions.size < this.#maxPendingTransactions) break;
      this.#transactions.delete(oldest);
    }
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

  get pendingTransactionCount(): number {
    return this.#transactions.size;
  }

  /** How many full expiry sweeps have run (the amortization is asserted on this). */
  get sweepCount(): number {
    return this.#sweepCount;
  }

  #maybeSweep(now: number): void {
    // A clock that moved backwards also sweeps, rather than waiting out the gap.
    const last = this.#lastSweepAt;
    if (last !== null && now >= last && now - last < this.#sweepIntervalMs) return;
    this.#lastSweepAt = now;
    this.#sweepCount += 1;
    for (const [id, s] of this.#sessions) {
      if (now >= s.expiresAt || now - s.lastSeenAt >= IDLE_TIMEOUT_MS) this.#sessions.delete(id);
    }
    for (const [id, tx] of this.#transactions) {
      if (now >= tx.expiresAt) this.#transactions.delete(id);
    }
  }
}
