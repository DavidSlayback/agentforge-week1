/**
 * Concurrency limit for PDF page renders (`/v1/source-documents/:id/pages/:n.png`).
 *
 * At most `maxConcurrent` renders run at once. W3 hardening (H2): the wait
 * queue is bounded too. Each waiting request holds its source document (up to
 * 5 MiB) in memory, so an unbounded queue let a burst of page requests grow
 * memory without limit. When `maxWaiting` requests already wait, `run` rejects
 * at once with `PAGE_RENDER_QUEUE_FULL`, which the server answers with 503 and
 * `Retry-After`.
 */
export const PAGE_RENDER_QUEUE_FULL = 'PAGE_RENDER_QUEUE_FULL';

export function createPageRenderLimiter({ maxConcurrent = 2, maxWaiting = 8 } = {}) {
  let active = 0;
  const waiting = [];
  return {
    async run(render) {
      if (active >= maxConcurrent) {
        if (waiting.length >= maxWaiting) throw Object.assign(new Error(PAGE_RENDER_QUEUE_FULL), { code: PAGE_RENDER_QUEUE_FULL });
        await new Promise((resolve) => waiting.push(resolve));
      }
      active += 1;
      try { return await render(); }
      finally {
        active -= 1;
        waiting.shift()?.();
      }
    },
    status: () => ({ active, waiting: waiting.length, maxConcurrent, maxWaiting }),
  };
}
