import { buildUpstreamPath, type UpstreamRouteId } from '../../../core/upstreamRoutes.ts';

/** The subset of a pino logger the BFF uses. Messages are constants; context carries no PHI. */
export interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** What an upstream call produced. The body is parsed JSON, never logged or forwarded. */
export type UpstreamOutcome =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown; readonly bodyEmpty: boolean }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network' };

export interface UpstreamClientDeps {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly logger: Logger;
  readonly now: () => number;
}

export interface UpstreamRequest {
  readonly routeId: UpstreamRouteId;
  readonly pathParams?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly accessToken: string;
  readonly correlationId: string;
}

export interface UpstreamClient {
  get(request: UpstreamRequest): Promise<UpstreamOutcome>;
}

/**
 * OpenEMR client. URLs come only from the allow-list (`buildUpstreamPath`
 * throws on anything else). Logs record route id, status, duration and the
 * correlation id: never the URL (it holds patient ids), the body or the token.
 */
export function createUpstreamClient(deps: UpstreamClientDeps): UpstreamClient {
  return {
    async get(request) {
      const url = `${deps.baseUrl}${buildUpstreamPath(request.routeId, request.pathParams, request.query)}`;
      const started = deps.now();
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, deps.timeoutMs);
      const log = (fields: Record<string, unknown>): void => {
        deps.logger.info(
          { routeId: request.routeId, correlationId: request.correlationId, durationMs: deps.now() - started, ...fields },
          'upstream call',
        );
      };
      try {
        const res = await deps.fetch(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${request.accessToken}`, accept: 'application/json' },
          signal: controller.signal,
          redirect: 'manual',
        });
        const text = await res.text();
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
      } catch {
        if (controller.signal.aborted) {
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
