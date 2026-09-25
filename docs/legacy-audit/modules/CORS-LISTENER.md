# CORSListener — cross-origin headers for the REST/FHIR/OAuth2 kernel

`CORSListener` is the only place in OpenEMR that emits CORS headers for
`/apis/*` and `/oauth2/*`. It is a Symfony event subscriber in the
`ApiApplication` kernel pipeline, with two jobs. It should answer browser
preflight (`OPTIONS`) requests itself, and it copies the caller's `Origin`
into `Access-Control-Allow-Origin` on every response. The port cares about
it because the SPA decides between two setups: calling the API from its own
origin (for example `http://localhost:5173` to `http://localhost:8300`), or
sitting behind a same-origin proxy.

**Bottom line (verified):** the preflight branch never runs. The
route-dispatch listener runs before it (priority 40 vs 25), finds no
`OPTIONS` route, and throws a 404. So every browser preflight to `/apis/*`
gets `404 {"error":"An error occurred","message":"Route not found","code":0}`,
with a reflected `Access-Control-Allow-Origin` and no `Allow-Headers`. The
browser rejects that preflight. A SPA on another origin therefore **cannot
make any call that carries `Authorization: Bearer …`**, which means every
data call. The Phase 1 "malformed Allow-Methods" array is real but sits in
that dead branch. The origin reflection is real, but actual responses never
carry `Access-Control-Allow-Credentials`. That, plus bearer-only auth for
anything reachable cross-site, keeps its severity **Low**.

**Source:** `src/RestControllers/Subscriber/CORSListener.php` · 78 lines · no file header, no version
**Audited by:** tier 3 · confidence high (code + vendor source read; no HTTP request sent, per Phase 3 rules)

## Purpose & lifecycle

The listener is registered in `ApiApplication::run()` at
`src/RestControllers/ApiApplication.php:91`. Its comment (`:90`) says it
"needs to be added early on". The kernel is `OEHttpKernel`
(`src/Core/OEHttpKernel.php:13`), a thin subclass of Symfony `HttpKernel`
(`symfony/http-kernel` v7.4.13, `composer.lock:11000-11001`). Entry points:
`apis/dispatch.php:27-30` for `/apis/*` (via `apis/.htaccess` rewrite) and
`oauth2/authorize.php` for `/oauth2/*` (`api/AUTH-AND-PATIENT.md` §1.1).

Subscriptions (`CORSListener::getSubscribedEvents`, `:17-23`):

| Event | Handler | Priority |
|---|---|---|
| `kernel.request` | `onKernelRequest` | **25** |
| `kernel.response` | `onKernelResponse` | 0 |

Symfony runs higher priorities first. It `krsort`s the listener table
(`vendor/symfony/event-dispatcher/EventDispatcher.php:215`, read in the
container). Equal priorities run in registration order. `RequestEvent::setResponse()`
stops propagation, and `HttpKernel::handleRaw()` returns as soon as a request
listener sets a response (`vendor/symfony/http-kernel/HttpKernel.php:158-162`).
The full `kernel.request` order for this kernel (all verified by reading each
subscriber):

| Order | Listener | Priority | Effect relevant to CORS |
|---|---|---|---|
| 1 | `SiteSetupListener::onKernelRequest` | 100 (`SiteSetupListener.php:95`) | site id, session, `globals.php`; throws 400 on bad site (`:164-168`) |
| 2 | `OAuth2AuthorizationListener::onKernelRequest` | 50 (`OAuth2AuthorizationListener.php:37`), registered first (`ApiApplication.php:93-94`) | for `/oauth2/*` only: **sets a response**, which stops propagation (`:79-82`) |
| 3 | `AuthorizationListener::onKernelRequest` | 50 (`AuthorizationListener.php:43`) | authenticates. `OPTIONS` is let through by `SkipAuthorizationStrategy` (`SkipAuthorizationStrategy.php:48-50`) |
| 4 | `RoutesExtensionListener::onKernelRequest` | **40** (`RoutesExtensionListener.php:28`) | matches the route. **Throws 404 for `OPTIONS`** (below) |
| 5 | `CORSListener::onKernelRequest` | **25** | would answer `OPTIONS`, but is never reached for `OPTIONS` |

## Layout / interface

```text
CORSListener implements EventSubscriberInterface
  static getSubscribedEvents(): array                      :17-23
  onKernelRequest(RequestEvent $event): void (untyped)     :24-42
  onKernelResponse(ResponseEvent $event): void (untyped)   :44-59
  private getInitialResponse(HttpRestRequest $r): Response :61-77
```

No callers outside the dispatcher (`grep CORSListener` over `src/`, `tests/`:
only `ApiApplication.php:10,91`). **No tests exist** for it (`tests/` has no
reference to `CORSListener` or `Access-Control`).

## State

```text
(none) — stateless; no properties, no globals, no config lookup
```

**Globals read:** none. **Globals written:** none. There is no setting,
allow-list or environment variable that changes its behavior. Deployment
config adds nothing either: no `Header set Access-Control-*` exists in
`docker/*/openemr.conf`. The only CORS config in the repo is the unrelated
`docker/library/dockers/dev-nginx/nginx.conf:136-139`.

## Logic

### `onKernelRequest` (`:24-42`)

1. If the event already has a response, return (`:26-30`). This check is
   unreachable in practice: a listener that sets a response stops propagation.
2. If the request has no `Origin` header, return (`:32-34`).
3. If the method is `OPTIONS`, build `getInitialResponse()` and set it as the
   event response (`:36-40`). Other methods fall through with no effect.

**What actually happens to an `OPTIONS` request (verified end to end):**

- `SiteSetupListener` (100) sets up the site and session.
- `AuthorizationListener` (50) runs its strategies in order
  (`AuthorizationListener.php:92-105`). `LocalApiAuthorizationController` only
  processes requests carrying an `APICSRFTOKEN` header
  (`LocalApiAuthorizationController.php:117-121`). A preflight never carries
  one: browsers list requested headers in `Access-Control-Request-Headers`
  and don't send them. `SkipAuthorizationStrategy::shouldProcessRequest`
  returns `true` for any `OPTIONS` (`SkipAuthorizationStrategy.php:48-50`).
  Its `authorizeRequest` marks the request `skipAuthorization` with role
  `system` (`:64-87`). So authentication passes.
- `RoutesExtensionListener` (40) calls `HttpRestRouteHandler::dispatch()`
  (`RoutesExtensionListener.php:51-60,102-106`). Each route key is matched by
  `HttpRestParsedRoute`, which requires `$this->requestMethod ===
  $routeDefinitionMethod` (`src/Common/Http/HttpRestParsedRoute.php:72`).
  No route in `_rest_routes_standard.inc.php` or
  `_rest_routes_fhir_r4_us_core_3_1_0.inc.php` starts with `OPTIONS`
  (`grep "OPTIONS /"` finds none; the only `RestApiCreateEvent` listener
  that adds routes is a test example, `tests/eventdispatcher/RestApiEventHookExample/Module.php:59`).
  So the loop ends in `throw new HttpException(404, "Route not found")`
  (`HttpRestRouteHandler.php:98`), which the `Throwable` catch rethrows unchanged
  (`:113-127`).
- The kernel's exception path runs `ExceptionHandlerListener`, which builds
  `JsonResponse(['error' => 'An error occurred', 'message' => 'Route not found', 'code' => 0], 404)`
  (`ExceptionHandlerListener.php:43-56`).
- `kernel.response` runs `CORSListener::onKernelResponse`, which adds the
  reflected `Access-Control-Allow-Origin` (below).

On the wire the preflight response is therefore:

```text
HTTP/1.1 404 Not Found
Content-Type: application/json
Access-Control-Allow-Origin: <whatever Origin was sent>
{"error":"An error occurred","message":"Route not found","code":0}
```

The Fetch spec requires an ok (2xx) status for a preflight, and it requires
`Authorization` to be listed in `Access-Control-Allow-Headers`. This
response fails both checks, so the browser aborts the real request.

For `/oauth2/*`, `OAuth2AuthorizationListener` (50) sets the response first
and stops propagation, so `onKernelRequest` is not reached there either.
The `/token` endpoint answers `OPTIONS` with a bare 200 itself
(`AuthorizationController.php:1355-1358`). **Conclusion:** `getInitialResponse()`
is unreachable on every path (verified).

### `onKernelResponse` (`:44-59`)

Runs for every response the kernel produces: normal responses, responses set
by request listeners, and error responses. `HttpKernel::handleThrowable()`
calls `filterResponse()`, which dispatches `kernel.response`. If the request
has an `Origin` header, the listener sets
`Access-Control-Allow-Origin: <$request->getHeader('Origin')[0]>` (`:56-57`).
It does not check the value against anything. It sets nothing else: **no
`Access-Control-Allow-Credentials`, no `Vary: Origin`, no
`Access-Control-Expose-Headers`**. The comment at `:53-55` states the intent:
"we have to allow public API clients to have CROSS ORIGIN access … @TODO:
review security implications".

`HttpRestRequest::getHeader()` returns the header's value list, so `[0]` is
the first `Origin` value. A literal `Origin: null` (sandboxed iframes,
`file://`) is reflected as `null`.

### `getInitialResponse` (`:61-77`) — dead code

```php
$response = new Response('', Response::HTTP_OK, [
    'Access-Control-Allow-Credentials' => 'true',
    "Access-Control-Allow-Headers" => "origin, authorization, accept, content-type, content-encoding, x-requested-with",
    "Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, PATCH, TRACE, OPTIONS"
]);
```

Line `:69` uses `,` instead of `=>`, so the array has two integer keys: `0 =>
"Access-Control-Allow-Methods"` and `1 => "GET, …"`. `HeaderBag::__construct`
calls `$this->set($key, $values)` for each entry
(`vendor/symfony/http-foundation/HeaderBag.php:32-37`). `HeaderBag.php` has no
`declare(strict_types=1)`, so the integer keys are coerced to the strings
`"0"` and `"1"`. `ResponseHeaderBag::set(string $key, …)` accepts them. If this
code ever ran, it would emit the headers `0: Access-Control-Allow-Methods` and
`1: GET, HEAD, …`, and no `Access-Control-Allow-Methods` header. Browsers then
allow only the CORS-safelisted methods (GET, HEAD, POST). The allowed headers
list omits `apicsrftoken` and `prefer`. `Access-Control-Allow-Credentials: true`
would be sent on the preflight only. (Verified by reading the vendor source.
Not observed on the wire, because the branch can't run.)

## Answers to the key questions

**Which headers are set?** Preflight (`OPTIONS`) to `/apis/*`: status 404 and
`Access-Control-Allow-Origin` = reflected Origin. There is no
`Allow-Headers`, `Allow-Methods` or `Allow-Credentials` (verified).
`OPTIONS /oauth2/default/token`: 200 with only the reflected
`Access-Control-Allow-Origin`. Actual responses (any status):
`Access-Control-Allow-Origin` = reflected Origin, and nothing else (verified).

**Is `Access-Control-Allow-Credentials` set?** Only inside the dead preflight
branch (`:67`). It is never set on a response a browser receives (verified).

**Is Origin reflected unconditionally?** Yes, on every response whose request
had an `Origin` header, with no allow-list and no config switch (`:56-57`,
verified).

**Severity given bearer vs cookie auth: can a malicious site use a victim's
OpenEMR session cookie against an `/apis` route?** No (verified). The reasons
stack up:

1. The only cookie-authenticated path is the "local API": the
   `APICSRFTOKEN` header plus the core session
   (`LocalApiAuthorizationController.php:117-152`,
   `SiteSetupListener.php:183-195`). A cross-site page can't attach a custom
   header without a preflight, and the preflight 404s. The dead preflight's
   allow-list doesn't include `apicsrftoken` either. The attacker also doesn't
   know the token. `CsrfUtils::verifyCsrfToken($csrfToken, $session, 'api')`
   (`:144`) ties it to the victim's session.
2. The core session cookie is `SameSite=Strict`. That is the default in
   `SessionConfigurationBuilder` (`src/Common/Session/SessionConfigurationBuilder.php:25`),
   and `forCore()` doesn't override it. So browsers don't send it on requests
   from another site. Only the OAuth session (`forOAuth()`, `:99`) is
   `SameSite=None`.
3. Without `APICSRFTOKEN`, every request goes to
   `BearerTokenAuthorizationStrategy`, whose `shouldProcessRequest()` is
   always `true` (`BearerTokenAuthorizationStrategy.php:131-134`). It
   requires a valid JWT in the `Authorization` header (`:146`, `:327-363`),
   and cookies don't count. A simple cross-site GET or form POST without a
   bearer token gets a 401.
4. Actual responses never carry `Access-Control-Allow-Credentials: true`, so
   a `credentials: 'include'` fetch cannot read any response body.

So the reflection is effectively `Access-Control-Allow-Origin: *` for a
bearer-token API. That is the normal posture for public SMART clients, and
anyone who can read a token can call the API from anywhere regardless.
**Low**. Residual risks: no `Vary: Origin` (a shared cache could serve one
origin's ACAO to another; responses are per-token, so the impact is
negligible), and a latent trap. If someone "fixes" preflight by lowering the
priority and adds `Allow-Credentials` to `onKernelResponse`, the reflection
would become a credentialed wildcard.

**Would a SPA on `http://localhost:5173` work against `http://localhost:8300`
with the current code?** **No, for data calls (verified from code; not run).**

- `GET /apis/default/fhir/...` with `Authorization: Bearer …` is not a
  CORS-simple request, so the browser sends a preflight. The preflight gets a
  404 with no `Allow-Headers`. Blocked.
- The OAuth2 `POST /oauth2/default/token` with
  `Content-Type: application/x-www-form-urlencoded` and no custom headers *is*
  CORS-simple. It goes straight through, and its response carries the
  reflected ACAO, so a PKCE token exchange would succeed cross-origin. Then
  every data call fails.
- `GET /apis/default/fhir/metadata` and `/.well-known/smart-configuration`
  need no Authorization header, so they work cross-origin (reflected ACAO,
  no preflight).
- Note: `localhost:5173` and `localhost:8300` are *same-site* (ports don't
  count), so the `SameSite=Strict` core cookie *would* be sent. That doesn't
  matter, because the cookie can't authenticate a data call without
  `APICSRFTOKEN`.

**What works without a backend change:** make the SPA same-origin with the
API. In dev, use a Vite `server.proxy` for `/apis`, `/oauth2` and
`/interface/login` that forwards to `http://localhost:8300`. In deploy, use a
reverse proxy that serves the SPA and OpenEMR from one origin. Same-origin
requests need no CORS at all. The OAuth redirect URI registered for the
client must then be the proxy origin.

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| Answer preflight | n/a (dead) | — | `OPTIONS` passes auth through `SkipAuthorizationStrategy.php:48-50`, then 404s in route dispatch |
| Reflect Origin | **no allow-list** | none | intentional per the `:53-55` comment; harmless because auth is bearer-only for cross-site callers |

## Data touches

None. No DB, session or filesystem access.

## Cross-links

- **Registered by:** `ApiApplication::run()` (`ApiApplication.php:91`)
- **Runs after:** `SiteSetupListener`, `OAuth2AuthorizationListener`, `AuthorizationListener`, `RoutesExtensionListener`. See [API-ROUTES.md](API-ROUTES.md) for the whole pipeline.
- **Corrects:** `api/AUTH-AND-PATIENT.md` §1.5 and its Open Question 4. See Findings #1 and #3.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Bug / port blocker | High (verified) | The preflight branch never runs. `RoutesExtensionListener` (priority 40) throws 404 "Route not found" for every `OPTIONS` before `CORSListener` (25) sees it, so browsers reject every cross-origin call that carries `Authorization`. This contradicts the "added early on" comment. | `CORSListener.php:20,36-40`; `RoutesExtensionListener.php:28`; `HttpRestParsedRoute.php:72`; `HttpRestRouteHandler.php:98`; `ApiApplication.php:90-91` | Port: same-origin via dev proxy / reverse proxy (no backend change). Upstream: raise the CORS request priority above 40 |
| 2 | Security | Low (verified) | Any `Origin` is reflected on every response, including errors. No allow-list, no config, no `Vary: Origin`. | `CORSListener.php:49-57` | Upstream: configurable allow-list plus `Vary: Origin` |
| 3 | Bug / dead code | Low (verified) | `Access-Control-Allow-Methods` is written as two positional array entries, which would emit headers named `0` and `1`. The code is unreachable (#1). | `CORSListener.php:66-70`; `vendor/symfony/http-foundation/HeaderBag.php:32-37` | Upstream: fix the `=>` when fixing #1 |
| 4 | Security (latent) | Low (verified) | `Access-Control-Allow-Credentials: true` combined with a reflected origin sits in the dead preflight. Making it reachable and copying it to actual responses would create a credentialed wildcard. | `CORSListener.php:67,73` | Upstream: never pair ACAC with reflection |
| 5 | Smell | Low (verified) | The preflight allow-list omits `apicsrftoken` and `prefer` (needed by `$export`), and TRACE is advertised. Also moot (#1). | `CORSListener.php:68-69` | n/a |
| 6 | Test gap | Low (verified) | No test covers `CORSListener` or preflight through the kernel, which is how #1 went unnoticed. | `tests/` (no matches) | Upstream: kernel-level test for `OPTIONS` with `Origin` |

## Port notes

- **Must survive:** nothing from this listener. The SPA must not depend on CORS.
- **Must not survive:** a cross-origin deployment topology. Plan for same-origin (Vite proxy in dev, reverse proxy in deploy). This needs no backend change, so it satisfies DB-10.
- **Open questions:**
  - Confirm #1 on the wire once an OAuth client exists: `curl -i -X OPTIONS -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization' http://localhost:8300/apis/default/fhir/Patient` should return 404. Not run here (no HTTP calls in Phase 3).
  - Where will the SPA be hosted in the Vultr deploy (`deploy/vultr/`)? A same-origin path under the OpenEMR host, or a proxy container?
