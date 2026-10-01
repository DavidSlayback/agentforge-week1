import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createUpstreamClient, MAX_UPSTREAM_BODY_BYTES, type FetchLike } from '../../bff/src/upstream/client.ts';
import { mapUpstream } from '../../bff/src/upstream/mapResponse.ts';
import { captureLogger, PATIENT } from '../support/harness.ts';

const BASE = 'http://openemr';
const TOKEN = 'synthetic-access-token-CLIENT';

function client(fetch: FetchLike, opts: { maxBodyBytes?: number; timeoutMs?: number } = {}) {
  const { logger, lines } = captureLogger();
  return {
    lines,
    upstream: createUpstreamClient({
      fetch,
      baseUrl: BASE,
      timeoutMs: opts.timeoutMs ?? 1000,
      logger,
      now: () => 0,
      ...(opts.maxBodyBytes === undefined ? {} : { maxBodyBytes: opts.maxBodyBytes }),
    }),
  };
}

const read = { routeId: 'rest.patient.read', pathParams: { puuid: PATIENT.p13 }, accessToken: TOKEN, correlationId: 'corr-body' } as const;

/** A body that never ends: reading it to completion would never return. */
function endlessBody(pulled: { chunks: number }): ReadableStream<Uint8Array> {
  const chunk = new TextEncoder().encode(`[${'"x",'.repeat(1023)}`);
  return new ReadableStream({
    pull(controller) {
      pulled.chunks += 1;
      controller.enqueue(chunk);
    },
  });
}

// W3 hardening H4: `res.text()` read any upstream body whole. The body is now read as a stream with
// a byte cap, and an oversized body is a labeled upstream error, never parsed and never shown.
describe('upstream client body cap', () => {
  it('stops reading an oversized body and reports it as too large (UPSTREAM_BODY_TOO_LARGE)', async () => {
    const pulled = { chunks: 0 };
    const { upstream, lines } = client(() => Promise.resolve(new Response(endlessBody(pulled), { status: 200 })), { maxBodyBytes: 64 * 1024 });
    const outcome = await upstream.get(read);
    expect(outcome).toEqual({ kind: 'too-large' });
    expect(pulled.chunks).toBeLessThan(40); // about 16 chunks of 4 kB, not the endless stream
    expect(mapUpstream(outcome, { shape: 'rest-envelope', schema: z.unknown(), emptyMeans: 'error' })).toEqual({
      kind: 'failure',
      failure: { kind: 'error', code: 'UPSTREAM_BODY_TOO_LARGE' },
    });
    expect(lines.join('')).toContain('"outcome":"too-large"');
    expect(lines.join('')).not.toContain(PATIENT.p13);
  });

  it('refuses a declared Content-Length over the cap without reading the body', async () => {
    const pulled = { chunks: 0 };
    const { upstream } = client(
      () => Promise.resolve(new Response(endlessBody(pulled), { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } })),
      { maxBodyBytes: 64 * 1024 },
    );
    expect(await upstream.get(read)).toEqual({ kind: 'too-large' });
    expect(pulled.chunks).toBeLessThanOrEqual(1);
  });

  it('still parses a body under the cap, and keeps an empty body empty', async () => {
    const { upstream } = client(() => Promise.resolve(new Response(JSON.stringify({ data: [1, 2, 3] }), { status: 200 })), { maxBodyBytes: 64 });
    expect(await upstream.get(read)).toEqual({ kind: 'response', status: 200, body: { data: [1, 2, 3] }, bodyEmpty: false });
    const empty = client(() => Promise.resolve(new Response(null, { status: 404 })));
    expect(await empty.upstream.get(read)).toEqual({ kind: 'response', status: 404, body: null, bodyEmpty: true });
  });

  it('the production cap is a few MiB', () => {
    expect(MAX_UPSTREAM_BODY_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
    expect(MAX_UPSTREAM_BODY_BYTES).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it('an already-aborted caller signal is a timeout, with no fetch', async () => {
    let fetched = 0;
    const { upstream } = client(() => {
      fetched += 1;
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    expect(await upstream.get({ ...read, signal: AbortSignal.abort() })).toEqual({ kind: 'timeout' });
    expect(fetched).toBe(0);
  });

  it('a caller signal aborts an in-flight call before the per-call timeout', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const { upstream } = client(hang, { timeoutMs: 5000 });
    const started = Date.now();
    expect(await upstream.get({ ...read, signal: AbortSignal.timeout(30) })).toEqual({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
