import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { SessionStore } from './auth/session.ts';
import { readBuildSha } from './buildInfo.ts';
import { loadConfig, type Config } from './config.ts';
import { registerHealth } from './http/health.ts';
import { registerRoutes } from './http/routes.ts';
import { registerSecurity } from './http/security.ts';
import { registerStatic } from './http/static.ts';
import { createUpstreamClient, type FetchLike } from './upstream/client.ts';

/** Everything the app needs from the outside world, injected (MIGRATION-REACT.md §5). */
export interface AppDeps {
  readonly config: Config;
  readonly fetch: FetchLike;
  readonly now: () => number;
  readonly logger: FastifyBaseLogger;
  readonly sessionStore: SessionStore;
  readonly buildSha: string;
}

/**
 * Pino options: request objects are serialized without their URL (it carries
 * patient ids), and credential-bearing headers are redacted.
 */
export const LOGGER_OPTIONS = {
  level: 'info',
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.accessToken', '*.idToken'],
    censor: '[redacted]',
  },
  serializers: {
    req: (req: { method?: string; routeOptions?: { url?: string } }) => ({ method: req.method, route: req.routeOptions?.url }),
  },
};

/** Composition root: build the Fastify app from injected dependencies. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  // Fastify's own request logs include the raw URL (patient ids), so they are off;
  // the onResponse hook below logs the route template instead.
  const app = Fastify({
    loggerInstance: deps.logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16 * 1024,
  });

  await app.register(fastifyCookie, { secret: config.sessionSecret });
  registerSecurity(app, config);

  // One request log line per response: route template, never the raw URL.
  app.addHook('onResponse', async (req, reply) => {
    req.log.info({ route: req.routeOptions.url ?? 'unmatched', method: req.method, status: reply.statusCode, durationMs: Math.round(reply.elapsedTime) }, 'request');
  });
  app.setErrorHandler(async (err: FastifyError, req, reply) => {
    // Never the message: it can echo request input or upstream text (6.01).
    req.log.error({ route: req.routeOptions.url ?? 'unmatched', errorName: err.name, statusCode: err.statusCode }, 'request failed');
    const status = err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? 'internal error' : 'bad request' });
  });

  const upstream = createUpstreamClient({
    fetch: deps.fetch,
    baseUrl: config.openemrInternalUrl,
    timeoutMs: config.upstreamTimeoutMs,
    logger: deps.logger,
    now: deps.now,
  });
  registerHealth(app, config, { fetch: deps.fetch, buildSha: deps.buildSha });
  registerRoutes(app, { config, fetch: deps.fetch, logger: deps.logger, now: deps.now, sessions: deps.sessionStore, upstream });
  await registerStatic(app, config);
  return app;
}

async function main(): Promise<void> {
  const logger = pino(LOGGER_OPTIONS);
  const config = loadConfig(process.env, fileURLToPath(new URL('../../web/dist', import.meta.url)));
  const app = await buildApp({
    config,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    logger,
    sessionStore: new SessionStore(),
    buildSha: readBuildSha(undefined, process.env),
  });
  await app.listen({ port: config.port, host: config.host });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    // Config errors name keys only, never values.
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : 'startup failed');
    process.exit(1);
  });
}
