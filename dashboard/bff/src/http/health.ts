import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import type { FetchLike } from '../upstream/client.ts';

/**
 * `/dashboard/health` reports the build SHA as compact JSON (`deploy.sh` greps
 * `"git_sha":"<sha>"`). `/dashboard/ready` is 200 only when OpenEMR's own
 * readiness probe answers 200 (catalog 9.03).
 */
export function registerHealth(app: FastifyInstance, config: Config, deps: { fetch: FetchLike; buildSha: string }): void {
  app.get(`${config.basePath}/health`, async (_req, reply) => {
    return reply.type('application/json').send(JSON.stringify({ status: 'ok', service: 'dashboard', git_sha: deps.buildSha }));
  });

  app.get(`${config.basePath}/ready`, async (_req, reply) => {
    let openemrReady = false;
    try {
      const res = await deps.fetch(`${config.openemrInternalUrl}/meta/health/readyz`, {
        signal: AbortSignal.timeout(config.upstreamTimeoutMs),
        redirect: 'manual',
      });
      openemrReady = res.status === 200;
    } catch {
      openemrReady = false;
    }
    return reply.code(openemrReady ? 200 : 503).send({ status: openemrReady ? 'ready' : 'not-ready', service: 'dashboard' });
  });
}
