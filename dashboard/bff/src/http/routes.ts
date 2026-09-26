import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PatientLookupResult, SessionDto } from '../../../core/dto.ts';
import { parseMrn, parsePatientUuid } from '../../../core/ids.ts';
import {
  buildAuthorizeUrl,
  buildEndSessionUrl,
  exchangeCode,
  sanitizeReturnTo,
  verifyIdToken,
  type OAuthDeps,
} from '../auth/oauth.ts';
import { LOGIN_TX_TTL_MS, randomId, type Session, type SessionStore } from '../auth/session.ts';
import type { CardResult } from '../../../core/cardResult.ts';
import { loadAllergies, type IssueCardDeps } from '../cards/allergies.ts';
import { loadHeader, type CardContext } from '../cards/header.ts';
import { lookupPatientByMrn } from '../cards/patientLookup.ts';
import { isoDateInZone, localDateTimeInZone } from '../clock.ts';
import type { UpstreamClient } from '../upstream/client.ts';

export const SESSION_COOKIE = 'dashboard_sid';
export const TX_COOKIE = 'dashboard_tx';

export interface RouteDeps extends OAuthDeps {
  readonly sessions: SessionStore;
  readonly upstream: UpstreamClient;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Sign-in, sign-out and the SPA-facing BFF API (MIGRATION-REACT.md §2.3-2.4).
 */
export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, sessions } = deps;
  const base = config.basePath;
  const cookieBase = { path: base, httpOnly: true, sameSite: 'lax' as const, secure: config.cookieSecure, signed: true };

  const readSigned = (req: FastifyRequest, name: string): string | undefined => {
    const raw = req.cookies[name];
    if (!raw) return undefined;
    const unsigned = req.unsignCookie(raw);
    return unsigned.valid ? unsigned.value : undefined;
  };
  const currentSession = (req: FastifyRequest): Session | null => sessions.getSession(readSigned(req, SESSION_COOKIE), deps.now());
  const clearSession = (reply: FastifyReply): void => {
    reply.clearCookie(SESSION_COOKIE, { path: base });
  };

  // ---- Sign-in ---------------------------------------------------------------
  app.get<{ Querystring: { returnTo?: string } }>(`${base}/login`, async (req, reply) => {
    const tx = sessions.createTransaction(
      {
        state: randomId(),
        nonce: randomId(),
        codeVerifier: randomId(48),
        returnTo: sanitizeReturnTo(req.query.returnTo, base),
      },
      deps.now(),
    );
    reply.setCookie(TX_COOKIE, tx.id, { ...cookieBase, maxAge: LOGIN_TX_TTL_MS / 1000 });
    return reply.redirect(buildAuthorizeUrl(config, tx), 302);
  });

  app.get<{ Querystring: Record<string, unknown> }>(`${base}/callback`, async (req, reply) => {
    const fail = (reason: string): FastifyReply => {
      req.log.warn({ route: `${base}/callback`, reason }, 'sign-in failed');
      return reply.redirect(`${base}/?signin=failed`, 303);
    };
    const tx = sessions.takeTransaction(readSigned(req, TX_COOKIE), deps.now());
    reply.clearCookie(TX_COOKIE, { path: base });
    const { code, state, error } = req.query;
    if (!tx) return fail('no-transaction');
    if (error !== undefined) return fail('authorization-error');
    if (typeof state !== 'string' || !safeEqual(state, tx.state)) return fail('state-mismatch');
    if (typeof code !== 'string' || code.length === 0 || code.length > 4096) return fail('no-code');

    const tokens = await exchangeCode(deps, code, tx.codeVerifier);
    if (!tokens) return fail('token-exchange');
    if (!(await verifyIdToken(deps, tokens.idToken, tx.nonce))) return fail('id-token');

    sessions.destroySession(readSigned(req, SESSION_COOKIE)); // no session fixation
    const session = sessions.createSession(tokens, deps.now());
    reply.setCookie(SESSION_COOKIE, session.id, { ...cookieBase, maxAge: tokens.expiresInSec });
    req.log.info({ route: `${base}/callback` }, 'signed in');
    return reply.redirect(tx.returnTo, 303);
  });

  // ---- Sign-out (1.04: destroy our tokens first; OpenEMR revokes nothing) -----
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 1024 }, (_req, _body, done) => {
    done(null, {});
  });
  app.post(`${base}/logout`, async (req, reply) => {
    if (req.headers.origin !== config.publicOrigin) {
      return reply.code(403).send({ error: 'origin not allowed' });
    }
    const session = sessions.destroySession(readSigned(req, SESSION_COOKIE));
    clearSession(reply);
    if (!session) return reply.redirect(`${base}/`, 303);
    return reply.redirect(buildEndSessionUrl(config, session.idToken, randomId(16)), 303);
  });

  // ---- BFF API (GET only, no query strings, explicit patient id) -------------
  app.get(`${base}/bff/session`, (req, reply) => {
    const session = currentSession(req);
    const dto: SessionDto = session
      ? {
          authenticated: true,
          displayConfig: { dateFormat: 'YYYY-MM-DD', ageFormat: 'years-or-months' },
          demoPatients: config.demoPatients,
        }
      : { authenticated: false };
    return reply.send(dto);
  });

  app.get<{ Params: { puuid: string } }>(`${base}/bff/patients/:puuid/header`, async (req, reply) => {
    const session = currentSession(req);
    if (!session) return reply.code(401).send({ kind: 'reauth' });
    const patientId = parsePatientUuid(req.params.puuid);
    if (patientId === null) return reply.code(400).send({ error: 'invalid patient id' });
    const { card } = await loadHeader(
      { upstream: deps.upstream, today: () => isoDateInZone(deps.now(), config.openemrTimeZone) },
      { patientId, accessToken: session.accessToken, correlationId: randomUUID() },
    );
    if (card.kind === 'reauth') {
      sessions.destroySession(session.id);
      clearSession(reply);
      return reply.code(401).send(card);
    }
    return card;
  });

  // ---- Clinical cards: one route per card, each loads independently (7.08) --
  const issueDeps: IssueCardDeps = {
    upstream: deps.upstream,
    nowLocal: () => localDateTimeInZone(deps.now(), config.openemrTimeZone),
  };
  const cardRoute = <T>(card: string, load: (ctx: CardContext) => Promise<CardResult<T>>): void => {
    app.get<{ Params: { puuid: string } }>(`${base}/bff/patients/:puuid/${card}`, async (req, reply) => {
      const session = currentSession(req);
      if (!session) return reply.code(401).send({ kind: 'reauth' });
      const patientId = parsePatientUuid(req.params.puuid);
      if (patientId === null) return reply.code(400).send({ error: 'invalid patient id' });
      const result = await load({ patientId, accessToken: session.accessToken, correlationId: randomUUID() });
      if (result.kind === 'reauth') {
        sessions.destroySession(session.id);
        clearSession(reply);
        return reply.code(401).send(result);
      }
      return result;
    });
  };
  cardRoute('allergies', (ctx) => loadAllergies(issueDeps, ctx));

  app.get<{ Params: { mrn: string } }>(`${base}/bff/patients/by-mrn/:mrn`, async (req, reply) => {
    const session = currentSession(req);
    if (!session) return reply.code(401).send({ kind: 'reauth' });
    const mrn = parseMrn(req.params.mrn);
    if (mrn === null) return reply.code(400).send({ error: 'invalid MRN' });
    const result: PatientLookupResult = await lookupPatientByMrn(deps.upstream, {
      mrn,
      accessToken: session.accessToken,
      correlationId: randomUUID(),
    });
    if (result.kind === 'reauth') {
      sessions.destroySession(session.id);
      clearSession(reply);
      return reply.code(401).send(result);
    }
    return result;
  });
}
