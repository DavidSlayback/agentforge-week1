import { buildUpstreamPath, type UpstreamRouteId } from '../../../core/upstreamRoutes.ts';

/** The subset of a pino logger the BFF uses. Messages are constants; context carries no PHI. */
export interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Largest upstream body the BFF reads (W3 hardening H4). One patient's card
 * data is kilobytes; a larger body is refused as `too-large`, never parsed.
 */
export const MAX_UPSTREAM_BODY_BYTES = 2 * 1024 * 1024;

/** What an upstream call produced. The body is parsed JSON, never logged or forwarded. */
export type UpstreamOutcome =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown; readonly bodyEmpty: boolean }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network' }
  | { readonly kind: 'too-large' };

export interface UpstreamClientDeps {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly logger: Logger;
  readonly now: () => number;
  /** `MAX_UPSTREAM_BODY_BYTES` unless a test sets it. */
  readonly maxBodyBytes?: number;
}

export interface UpstreamRequest {
  readonly routeId: UpstreamRouteId;
  readonly pathParams?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly accessToken: string;
  readonly correlationId: string;
  /** A caller's overall deadline (e.g. the Vitals walk); aborting it ends this call as `timeout`. */
  readonly signal?: AbortSignal;
}

export interface UpstreamClient {
  get(request: UpstreamRequest): Promise<UpstreamOutcome>;
}

class BodyTooLarge extends Error {
  override readonly name = 'BodyTooLarge';
}

/** Read the body as text, refusing (and cancelling the stream) past `maxBytes`. */
async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new BodyTooLarge();
  }
  if (!res.body) return '';
  const chunks: AsyncIterable<unknown> = res.body;
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  // Leaving the loop early (the throw) cancels the stream, so the rest is never read.
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) throw new TypeError('unexpected body chunk');
    total += chunk.byteLength;
    if (total > maxBytes) throw new BodyTooLarge();
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * OpenEMR client. URLs come only from the allow-list (`buildUpstreamPath`
 * throws on anything else). Logs record route id, status, duration and the
 * correlation id: never the URL (it holds patient ids), the body or the token.
 * The per-call timeout covers the body read, and the body is capped.
 */
export function createUpstreamClient(deps: UpstreamClientDeps): UpstreamClient {
  const maxBodyBytes = deps.maxBodyBytes ?? MAX_UPSTREAM_BODY_BYTES;
  return {
    async get(request) {
      const url = `${deps.baseUrl}${buildUpstreamPath(request.routeId, request.pathParams, request.query)}`;
      const started = deps.now();
      const log = (fields: Record<string, unknown>): void => {
        deps.logger.info(
          { routeId: request.routeId, correlationId: request.correlationId, durationMs: deps.now() - started, ...fields },
          'upstream call',
        );
      };
      if (request.signal?.aborted === true) {
        log({ outcome: 'timeout' });
        return { kind: 'timeout' };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, deps.timeoutMs);
      const signal = request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal;
      try {
        const res = await deps.fetch(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${request.accessToken}`, accept: 'application/json' },
          signal,
          redirect: 'manual',
        });
        const text = await readCappedText(res, maxBodyBytes);
        let body: unknown = null;
        if (text.trim() !== '') {
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            body = null; // Non-JSON: treated as a schema mismatch by the mapper.
          }
        }
        log({ status: res.status });
        return { kind: 'response', status: res.status, body, bodyEmpty: text.trim() === '' };
      } catch (err) {
        if (err instanceof BodyTooLarge) {
          log({ outcome: 'too-large' });
          return { kind: 'too-large' };
        }
        if (signal.aborted) {
          log({ outcome: 'timeout' });
          return { kind: 'timeout' };
        }
        log({ outcome: 'network' });
        return { kind: 'network' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
