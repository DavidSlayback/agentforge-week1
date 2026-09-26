import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';

/**
 * Serve the built SPA same-origin under `/dashboard/` (no CORS, catalog 4.01),
 * with an `index.html` fallback for the SPA's deep links
 * (`/dashboard/patients/:puuid`, catalog 4.06 / 7.09). Unknown `/bff/*` paths
 * get a JSON 404. Nothing here logs the URL (it can carry a patient uuid).
 */
export async function registerStatic(app: FastifyInstance, config: Config): Promise<void> {
  const root = config.staticDir;
  const built = root !== null && existsSync(root) && existsSync(`${root}/index.html`);
  if (built) {
    await app.register(fastifyStatic, { root, prefix: `${config.basePath}/`, index: ['index.html'], wildcard: true });
  }

  app.get(config.basePath, async (_req, reply) => reply.redirect(`${config.basePath}/`, 308));

  app.setNotFoundHandler(async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (built && req.method === 'GET' && path.startsWith(`${config.basePath}/patients/`)) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not found' });
  });
}
