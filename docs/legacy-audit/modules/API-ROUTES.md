# API request pipeline and in-scope routes

This is the path every SPA call takes. `apis/dispatch.php` builds an
`HttpRestRequest` and runs `ApiApplication`, a Symfony `HttpKernel` event
pipeline. The pipeline sets up the site, authenticates the caller, matches
the route, checks the OAuth2 scope, and then calls a route closure. The
closure runs the ACL check and delegates to a controller and service. This
document covers the pipeline (kernel plus subscribers) and **only** the route
entries the dashboard port uses. The CORS subscriber has its own analysis:
[CORS-LISTENER.md](CORS-LISTENER.md). Field-level mapping per card is in
`api/CLINICAL-CARDS.md` and `ui/DEMOGRAPHICS-PART2-CARDS.md` ("Parity spec
for the port"). This document adds what the pipeline does to those calls:
scopes, ACL, honored params, status codes and error bodies.

**Source:**
- `apis/dispatch.php` (45 lines), `apis/.htaccess`
- `src/RestControllers/ApiApplication.php` (137)
- `src/RestControllers/Subscriber/` — `SiteSetupListener.php` (246), `AuthorizationListener.php` (252), `RoutesExtensionListener.php` (107), `ExceptionHandlerListener.php` (58), `ViewRendererListener.php` (49), `ApiResponseLoggerListener.php` (124), `SessionCleanupListener.php` (39), `TelemetryListener.php` (42), `OAuth2AuthorizationListener.php` (subscription and `/oauth2` gate only)
- `src/RestControllers/Authorization/` — `BearerTokenAuthorizationStrategy.php` (486), `LocalApiAuthorizationController.php` (148), `SkipAuthorizationStrategy.php` (88)
- `src/Common/Http/HttpRestRouteHandler.php` (201), `HttpRestParsedRoute.php` (route matching)
- `src/RestControllers/Config/RestConfig.php:180-194` (ACL helper)
- in-scope entries of `apis/routes/_rest_routes_standard.inc.php` (717) and `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php` (876)

**Audited by:** tier 3 · confidence high for the pipeline and routes. Service-layer filtering is cross-linked, not re-audited. No HTTP calls were made. Two read-only SQL checks were run on the local DB.

## Purpose & lifecycle

```text
Apache  apis/.htaccess  RewriteRule (.*) dispatch.php?_REWRITE_COMMAND=$1   (all methods)
  └ dispatch.php:27-30  HttpRestRequest::createFromGlobals(); new ApiApplication()->run()
      └ ApiApplication::run  (ApiApplication.php:71-136) registers subscribers :76-103,
        builds OEHttpKernel(handleAllThrowables = true) :110-111, handle() :123, send() :131, terminate() :133

kernel.request  (higher priority first; ties = registration order)
  100  SiteSetupListener        site id, API or OAuth session, globals.php, OAuth keys
   50  OAuth2AuthorizationListener   /oauth2/* only → sets response, stops propagation
   50  AuthorizationListener    ① AUTHENTICATION (strategy chain)
   40  RoutesExtensionListener  route match → ② SCOPE CHECK (RestApiSecurityCheckEvent)
                                 → sets _controller closure (or throws)
   25  CORSListener             preflight branch (never reached for OPTIONS; see CORS-LISTENER.md)
kernel.controller → closure runs  ③ ACL CHECK (RestConfig / FhirGenericRestController) → ④ HANDLER
kernel.view      50  ViewRendererListener   array/object → JsonResponse (always 200)
kernel.exception  0  ExceptionHandlerListener   any Throwable → JSON {error,message,code}
kernel.response   0  CORSListener::onKernelResponse   reflect Origin
kernel.terminate     TelemetryListener, ApiResponseLoggerListener, SessionCleanupListener
```

The priorities come from each class's `getSubscribedEvents()`:
`SiteSetupListener.php:95`, `OAuth2AuthorizationListener.php:37`,
`AuthorizationListener.php:43-44`, `RoutesExtensionListener.php:28`,
`CORSListener.php:20-21`, `ViewRendererListener.php:18`,
`ExceptionHandlerListener.php:18`, and the TERMINATE listeners
(`ApiResponseLoggerListener.php:287`, `SessionCleanupListener.php:14`,
`TelemetryListener.php:16`). Symfony `krsort`s priorities
(`vendor/symfony/event-dispatcher/EventDispatcher.php:215`). A request
listener that sets a response ends the request phase
(`vendor/symfony/http-kernel/HttpKernel.php:158-162`).

## Layout / interface

Public surface the port touches: routes only. The kernel classes have no
callers outside `ApiApplication` (and `oauth2/authorize.php`).

```text
ApiApplication::run(HttpRestRequest): ?Response                        ApiApplication.php:71
AuthorizationListener::onKernelRequest(RequestEvent): void             AuthorizationListener.php:112
AuthorizationListener::onRestApiSecurityCheck(RestApiSecurityCheckEvent)  :134
HttpRestRouteHandler::dispatch(array $routes, HttpRestRequest): ?ResponseInterface  HttpRestRouteHandler.php:40
HttpRestRouteHandler::checkSecurity(OEHttpKernel, HttpRestRequest, HttpRestParsedRoute)  :141
RestConfig::request_authorization_check(HttpRestRequest, $section, $value, $aclPermission='')  RestConfig.php:180
ExceptionHandlerListener::onExceptionEvent(ExceptionEvent): void       ExceptionHandlerListener.php:22
```

## State

```text
HttpRestRequest attributes  siteId, webroot, is_local_api, skipAuthorization, userId, clientId, tokenId,
                            user, userRole, _route, _controller, _serviceLocator   (per request)
HttpRestRequest fields      accessTokenScopes (validator array), requestUserRole, patientUuidString,
                            isPatientRequest, resource, requestRequiredScope
Session (API type)          site_id, userId, userRole, authUser, authUserID, authProvider, pid (patient role)
                            → invalidated at terminate unless local API / OAuth flow (SessionCleanupListener.php:182-184)
$_GET['site']               written for legacy code (SiteSetupListener.php:175)
OEGlobalsBag                loaded by require of interface/globals.php (SiteSetupListener.php:260);
                            is_local_api written (LocalApiAuthorizationController.php:134)
```

**Globals read:** `rest_api`, `rest_fhir_api` (only in the `/oauth2` gate,
`OAuth2AuthorizationListener.php:103`), `api_log_option`
(`ApiResponseLoggerListener.php:308-310`), `site_addr_oath` (bundle URLs),
`OE_SITE_DIR` (`SiteSetupListener.php:293`).
**Globals written:** `$_GET['site']`, `is_local_api`, session keys above.

## Logic

### ① Authentication — `AuthorizationListener::onKernelRequest` (`:112-127`, `:228-251`)

Strategies are tried in a fixed order (`:92-105`). The first one whose
`shouldProcessRequest()` is true and whose `authorizeRequest()` returns true
wins. If none does, the listener throws
`UnauthorizedHttpException("Bearer", "Authorization failed for the request.")`
(`:250`).

1. **`LocalApiAuthorizationController`** handles any request with an
   `APICSRFTOKEN` header (`:117-121`). It checks the CSRF token against the
   core session (`:139-152`), which is the in-app "local API" used by OpenEMR's
   own JS. The SPA won't use it.
2. **`SkipAuthorizationStrategy`** handles any `OPTIONS` request
   (`:48-50`) and the paths `/fhir/metadata`,
   `/fhir/.well-known/smart-configuration`, `/fhir/OperationDefinition`,
   `/api/version` and `/api/product` (`AuthorizationListener.php:95-99`). It
   sets `skipAuthorization` and role `system` (`:64-87`). The match is
   `str_starts_with($route, $pathInfo)` (`:57`), which is reversed: a request
   path that is a *prefix* of a skip route matches. Phase 1 (`api/AUTH-AND-PATIENT.md`
   §3.3) found this non-exploitable, and it is confirmed: no PHI route path
   is a prefix of those five. It reads `authUserId` (`:71`) while every writer
   uses `authUserID` (`BearerTokenAuthorizationStrategy.php:249`,
   `LocalApiAuthorizationController.php:153`). That branch is dead, so skip
   routes always run as `system`.
3. **`BearerTokenAuthorizationStrategy`** takes everything else
   (`shouldProcessRequest` is always `true`, `:131-134`):
   - `League\OAuth2\Server\ResourceServer::validateAuthenticatedRequest` checks
     the JWT signature, `exp` and DB revocation (`:327-341`). An
     `OAuthServerException` becomes `HttpException(401, $e->getMessage())`
     (`:342-344`). Any other throwable becomes a 500 "Server Error" (`:345-359`).
   - A token id revoked in the DB throws `OAuthServerException::accessDenied`
     (`:161-163`), which is a 401.
   - `TrustedUserService::isTrustedUser($clientId, $userId)` fails when the
     user has logged out or the refresh grant was revoked. That throws
     `OAuthServerException(..., 'invalid_request', 400)`, a **400**, not a 401
     (`:169-178`).
   - Expiry is checked again against the DB (`authenticateUserToken`,
     `:284-323`). This also writes an audit `log` row: "API success/failure …
     client[…] and user …" (`:299,311,316`).
   - Route family vs token (`isValidRequestForUserRole`, `:365-396`):
     `/api/*` requires scope `api:oemr` in the token (`:373`). The `users`
     role may call `/api` and `/fhir`, `patient` may call `/portal` and
     `/fhir`, and `system` may call only `/fhir`. Any failure is a 403.
   - Session setup (`:238-282`): for `users`, it sets `authUser`,
     `authUserID` and `authProvider`, which is what the later ACL check reads.
     If the token has `launch` or `launch/patient`, it binds the token's
     `context.patient` (`populateTokenContextForRequest`, `:434-454`).
     `checkUserHasAccessToPatient()` always returns `true` (`:479-485`,
     marked TODO).

### ② Scope check — `HttpRestRouteHandler::dispatch`/`checkSecurity` → `AuthorizationListener::onRestApiSecurityCheck`

`dispatch()` walks the route map in file order (`HttpRestRouteHandler.php:59-97`).
`HttpRestParsedRoute` needs an exact method match (`HttpRestParsedRoute.php:72`)
and a regex match where `:param` becomes `[a-zA-Z0-9\-\_\$\:]+` (`:154`).
For the first match:

- If the token's scope context for the route's resource is `patient`, the
  request is marked as a patient request (`HttpRestRouteHandler.php:65-67`).
- `checkSecurity` (`:141-188`) derives the required permission. GET is `r`
  when the route ends in a `:param` (instance) and `s` otherwise (`:190-200`).
  POST is `c`, PUT and PATCH are `u`, DELETE is `d`. Any other method
  (including HEAD, if it ever matched) is a 501 (`:165-174`). The resource
  is `parts[2]` for FHIR (e.g. `Patient`) and the last non-param segment for
  standard routes (e.g. `/api/patient/:puuid/allergy` gives `allergy`)
  (`HttpRestParsedRoute.php:172-203`).
- `onRestApiSecurityCheck` (`AuthorizationListener.php:134-196`):
  - Patient request without a bound UUID: deny (`:143-147`).
  - Local API or `skipAuthorization`: return with no scope check (`:154-158`).
  - FHIR: deny writes by the patient role (`:162-168`).
  - Standard API: deny unless role is `users` **and** scope type is `user`
    (`:169-175`). Patient-context scopes can't be used on `/api/*`.
  - Then it requires `<scopeType>/<resource>.<perm>`. `ScopeEntity::containsScope`
    matches v1 `read` (= `rs`) and `write` (= `cud`)
    (`api/AUTH-AND-PATIENT.md` §1.7).
  - Any `AccessDeniedException` here is caught in `dispatch()` and rethrown
    as `HttpException(401, "Unauthorized")` (`HttpRestRouteHandler.php:99-112`).
    A missing scope is therefore a **401**, the same status as a bad token.
- On success, `dispatch()` stores the closure as `_controller`
  (`:94-95`). **No route matched** gives a 404 "Route not found" (`:98`).
  Any other throwable in this phase is masked as 500 "System error occurred"
  (`:113-129`).

### ③ ACL check — inside the route closure (controller phase)

User-context branches call `RestConfig::request_authorization_check($request,
$section, $value)` (`RestConfig.php:180-183`). That calls
`AclMain::aclCheckCore($section, $value, $session['authUser'])` and throws
`AccessDeniedHttpException("Organization policy does not have permit access resource")`,
a **403** (`:185-193`). FHIR `Condition` and `Observation` do the same inside
`FhirGenericRestController::getAllProcessingResult` (`FhirGenericRestController.php:93-102`).
**Patient-context requests skip the ACL entirely** and pass
`getPatientUUIDString()` as a hard bind instead. That includes a `users`
token with a SMART launch patient (e.g. `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:75-81`).
The ACL runs *after* the scope check and *before* the service call. It is not
per-patient: any user with `patients/med` can read any patient. There is no
squad check anywhere in `apis/` or `src/RestControllers/` (`grep squad`: no
hits).

### ④ Handler and response rendering

The closure returns either a Symfony/PSR-7 response or a plain
array/object. `ViewRendererListener` wraps non-responses in
`new JsonResponse($result)` with **status 200**, or in `text/plain` when the
request's content type is text (`ViewRendererListener.php:131-154`). This
matters for the standard routes. `RestControllerHelper::handleProcessingResult`
sets the status with `http_response_code(400|500|…)` and returns an **array**
(`RestControllerHelper.php:204-221`). The kernel then wraps that array in a
200 `JsonResponse`, and `Response::sendHeaders()` calls
`header(..., $this->statusCode)` with 200, which overrides the earlier
`http_response_code()`. Result: validation and internal errors on
`/api/allergy*` and `/api/*medical_problem*` arrive as **HTTP 200** with
`validationErrors`/`internalErrors` in the body. (Verified from
`ViewRendererListener.php:153` and the vendor `Response::sendHeaders()`;
not observed on the wire.) Routes that use
`createProcessingResultResponse` (`/api/patient`, `/api/prescription`) return
real status codes (`RestControllerHelper.php:252-268`).

### Errors — `ExceptionHandlerListener::onExceptionEvent` (`:22-57`)

Every throwable becomes:

```json
{"error": "An error occurred", "message": "<$exception->getMessage()>", "code": <$exception->getCode()>}
```

The status is `HttpException::getStatusCode()`,
`OAuthServerException::getHttpStatusCode()`, or 500 (`:43-55`). The trace is
logged, not returned (`:28-41`). **The message is returned verbatim for every
exception type.** Controller-phase exceptions don't go through
`HttpRestRouteHandler`'s masking catch. So a `SqlQueryException`, whose
message is `"Failed to execute statement. Error: <db error> Statement: <full SQL>"`
(`src/Common/Database/QueryUtils.php:226-230`), is returned to the client
(verified). If the kernel itself fails, `dispatch.php:31-44` also echoes
`$e->getMessage()`.

### Terminate

- `ApiResponseLoggerListener` (`:291-357`): when `api_log_option > 0` and the
  request is not a local API call, it writes a `log` row plus an `api_log`
  row (`EventAuditLogger::recordLogItem`). With option `2` it stores the full
  JSON response body in `request_body` **and** `response` (`:314-338`). The
  code comment admits they are the same. The local DB has
  `api_log_option = 2` (SQL-verified), so every JSON response the SPA
  fetches, PHI included, is stored in plaintext in `api_log`. The encryption
  path was removed (`EventAuditLogger.php` ~`:660`). `patient_id` comes from
  session `pid` (`:327`), which is only set for the patient role
  (`BearerTokenAuthorizationStrategy.php:267`). So for a clinician's reads the
  audit row is **not linked to the patient**.
- `TelemetryListener`: if product-registration telemetry is enabled, it
  records `METHOD path`, which includes patient UUIDs in the path
  (`TelemetryListener.php:26-31`, `TelemetryService.php:236-240`). Not traced
  further.
- `SessionCleanupListener`: invalidates the per-request API session
  (`:182-184`). No server-side state survives between SPA calls. Each call
  re-authenticates from the bearer token.

## Answer: what each failure returns

| Case | Where decided | Status | Body `message` (exception text leaks?) |
|---|---|---|---|
| No `Authorization` header, bad signature, expired JWT | `BearerTokenAuthorizationStrategy.php:341-344` | 401 | "The resource owner or authorization server denied the request." (league generic; the hint such as `Missing "Authorization" header` is **not** returned) |
| Token revoked in DB | `:161-163` | 401 (`code` 9) | same generic text |
| User logged out / refresh revoked | `:169-178` | **400** | "Refresh Token revoked or logged out" |
| `/api/*` without `api:oemr`, or wrong role for route family | `:365-396` | 403 | "OpenEMR Error: API call failed due to insufficient permissions for the requested resource." |
| Scope missing (e.g. no `user/allergy.s`) | `AuthorizationListener.php:190-193` → `HttpRestRouteHandler.php:99-112` | **401** | "Unauthorized" (masked; scope name only in server log) |
| Patient-context token on `/api/*` | `AuthorizationListener.php:171-175` | 401 | "Unauthorized" |
| Route or method not found (incl. `OPTIONS`, `HEAD`) | `HttpRestRouteHandler.php:98` | 404 | "Route not found" |
| ACL denied | `RestConfig.php:192` / `FhirGenericRestController.php:99` | 403 | "Organization policy does not have permit access resource" |
| Patient token asks for another patient's `/fhir/Patient/:uuid` | route closure `:613-615` throws `AccessDeniedException` (not an `HttpException`) | **500** | "patient id invalid" |
| SQL error in a handler | `QueryUtils.php:226-230` → `ExceptionHandlerListener.php:52` | 500 | **full SQL statement and DB error text** |
| Invalid site segment | `SiteSetupListener.php:164-168` | 400 | "OpenEMR Error: api site error, so forced exit. …" |
| FHIR search with an invalid param (e.g. malformed `patient`) | controllers ignore `ProcessingResult::isValid()` (below) | **200** | empty `Bundle` |
| Standard allergy/problem validation error (e.g. bad `puuid`) | `RestControllerHelper.php:204-221` + `ViewRendererListener.php:153` | **200** | `{"validationErrors":{…},"internalErrors":[],"data":[],"links":[]}` |
| `/api/patient/:pid/medication` with zero rows | `RestControllerHelper.php:158-167` | **404** | empty body |

## In-scope routes: handler, scope, ACL

Scope notation is SMART v2. A v1 `.read` covers `rs` and `.write` covers
`cud`. **Every `/api/*` call also needs `api:oemr` in the token** and must be a
`users`-role, `user/` scope token. FHIR accepts `user/`, and also `patient/`
(patient-bound, ACL skipped).

### FHIR (`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`)

| Route | Line | Handler | Scope | ACL (user context) | Query params passed |
|---|---|---|---|---|---|
| `GET /fhir/Patient` | 578-595 | `FhirPatientRestController::getAll` (`FhirPatientRestController.php:730`) | `Patient.s` | `patients/demo` (:590) | all. Patient context forces `_id` = bound uuid (:587) |
| `GET /fhir/Patient/:uuid` | 610-625 | `FhirPatientRestController::getOne` (:558) | `Patient.r` | `patients/demo` (:618) | n/a. Patient context: uuid must equal bound uuid, else 500 (:613-615) |
| `GET /fhir/AllergyIntolerance[/:uuid]` | 73-95 | `FhirAllergyIntoleranceRestController::getAll/getOne` (:212/:136) | `AllergyIntolerance.s`/`.r` | `patients/med` (:79,:90) | all |
| `GET /fhir/Condition[/:uuid]` | 167-176 | `FhirGenericRestController` + `FhirConditionService` | `Condition.s`/`.r` | `patients/med` via `addAclRestrictions` (:169,:174) | all (`getAll()` with no args reads `$request->query->all()`, `FhirGenericRestController.php:124-126`) |
| `GET /fhir/MedicationRequest[/:uuid]` | 470-492 | `FhirMedicationRequestRestController::getAll/getOne` (:205/:115) | `MedicationRequest.s`/`.r` | `patients/med` (:476,:487) | all |
| `GET /fhir/CareTeam[/:uuid]` | 142-166 | `FhirCareTeamRestController::getAll/getOne` (:253/:172) | `CareTeam.s`/`.r` | `patients/med` (:150,:161) | all |
| `GET /fhir/Observation[/:uuid]` | 493-502 | `FhirGenericRestController` + `FhirObservationService` | `Observation.s`/`.r` (granular `?category=` constraints go through `ResourceConstraintFilterer`, `FhirGenericRestController.php:147-149`; not traced) | `patients/med` (:495,:500) | all |
| `GET /fhir/metadata` | 817-820 | `FhirMetaDataRestController::getMetaData` | none (skip) | none | — |
| `GET /fhir/.well-known/smart-configuration` | 821-825 | `SMARTConfigurationController::getConfig` | none (skip) | none | — |
| `GET /fhir/OperationDefinition[/:operation]` | 826-839 | `FhirOperationDefinitionRestController` | none (skip) | none | — |
| `POST /fhir/Patient`, `PUT /fhir/Patient/:uuid` | 560-577 | `FhirPatientRestController::post/put` | `Patient.c`/`.u` | `patients/demo` | not used by the port |

A user-context FHIR search with no `patient=` returns **every patient's**
resources: the ACL is not per-patient, and the closures add no patient
filter. The SPA must always send `patient=<uuid>`.

### Standard (`apis/routes/_rest_routes_standard.inc.php`)

| Route | Line | Handler | Scope | ACL | Params honored |
|---|---|---|---|---|---|
| `GET /api/patient` | 76-82 | `PatientRestController::getAll` (`PatientRestController.php:480-489`) | `user/patient.s` | `patients/demo` | whitelist `SUPPORTED_SEARCH_FIELDS` (`:137+`) plus `_limit`/`_maxresults`, `_offset`, `_sort` (sort whitelisted, `SearchConfigClauseBuilder.php:29-50`) |
| `GET /api/patient/:puuid` | 99-104 | `PatientRestController::getOne` | `user/patient.r` | `patients/demo` | none |
| `GET /api/allergy` | 253-258 | `AllergyIntoleranceRestController::getAll()` | `user/allergy.s` | `patients/med` | **none** (called with no args: all patients) |
| `GET /api/allergy/:auuid` | 259-264 | `::getOne` | `user/allergy.r` | `patients/med` | none |
| `GET /api/patient/:puuid/allergy` | 265-270 | `::getAll(['puuid' => …])` (`AllergyIntoleranceRestController.php:188-192`) | `user/allergy.s` | `patients/med` | **none** (query string ignored) |
| `GET /api/patient/:puuid/allergy/:auuid` | 271-276 | `::getAll([puuid, allergy_uuid])` | `user/allergy.r` | `patients/med` | none |
| `GET /api/medical_problem[/:muuid]` | 209-220 | `ConditionRestController::getAll/getOne` | `user/medical_problem.s`/`.r` | **`encounters/notes`** | none |
| `GET /api/patient/:puuid/medical_problem` | 221-225 | `ConditionRestController::getAll(['puuid' => …])` (`ConditionRestController.php:190-194`) | `user/medical_problem.s` | **`encounters/notes`** (:222) | **none** |
| `GET /api/patient/:puuid/medical_problem/:muuid` | 226-231 | `::getAll([puuid, condition_uuid])` | `user/medical_problem.r` | `patients/med` (:227) | none |
| `GET /api/patient/:pid/medication` | 298-303 | `ListRestController::getAll($pid, 'medication')` → `ListService::getAll` (`ListService.php:48-60`) | `user/medication.s` | `patients/med` | **none**. `:pid` is the **integer pid**, not a uuid. `ORDER BY date DESC`. Zero rows gives a 404 with empty body |
| `GET /api/patient/:pid/medication/:mid` | 319-324 | `ListRestController::getOne` | `user/medication.r` | `patients/med` | none |
| `GET /api/prescription` | 664-667 | `PrescriptionRestController::getAll` (`PrescriptionRestController.php:152-157`) → `PrescriptionService::getAll` (`PrescriptionService.php:56-85`) | `user/prescription.s` | `patients/med` | **every query key is used verbatim as a SQL column** (Finding 1). No paging |
| `GET /api/prescription/:uuid` | 668-671 | `::getOne` | `user/prescription.r` | `patients/med` | none |
| `POST /api/patient/:pid/message` | 586-592 | `MessageRestController::post` (`MessageRestController.php:129`) | `user/message.c` | `patients/notes` | body |
| `PUT /api/patient/:pid/message/:mid` | 615-621 | `::put` (:86) | `user/message.u` | `patients/notes` | body |
| `DELETE /api/patient/:pid/message/:mid` | 622-627 | `::delete` (:172) | `user/message.d` | `patients/notes` | — |
| `GET /api/version`, `GET /api/product` | 453-462 | `VersionRestController`, `ProductRegistrationRestController` | none (skip) | none | — |
| allergy/medical_problem/medication `POST`/`PUT`/`DELETE` | 233-252, 278-297, 305-318, 325-330 | same controllers | `.c`/`.u`/`.d` | `patients/med` | not used (port is read-only) |

There is **no `GET` for messages** (`pnotes`) in either route file. The
message routes are write-only (verified; confirms `api/CLINICAL-CARDS.md`
DB-08). There is **no standard CareTeam route**. There is no data-route
check of `rest_api`/`rest_fhir_api`: the only "API disabled" gate is on
`/oauth2/*` (`OAuth2AuthorizationListener.php:101-109`). This confirms
Phase 1's open question as a code fact.

## API contract for the port

**Topology first.** A browser SPA on another origin cannot call these routes,
because every preflight 404s ([CORS-LISTENER.md](CORS-LISTENER.md) #1). Serve
the SPA same-origin (Vite proxy in dev). Everything below assumes that.

**Token the SPA must hold** (`users` role, authorization-code + PKCE): `openid`,
`api:oemr` (for the `/api/*` calls), plus per-resource `user/` scopes with
**both `s` and `r`** (or v1 `.read`). `.r` alone fails every collection GET
with a 401. The minimum set for the six cards:
`user/Patient.rs user/AllergyIntolerance.rs user/Condition.rs user/MedicationRequest.rs user/CareTeam.rs user/Observation.rs user/Practitioner.rs`
(FHIR), or `user/patient.rs user/allergy.rs user/medical_problem.rs user/medication.rs user/prescription.rs`
(standard). Whether the server offers and issues each of these belongs to
`ScopeRepository` and the AuthorizationController analysis (not traced here).

**Status handling the SPA must implement** (from the table above):
- 401 means re-authenticate, **or** a scope is missing. The two can't be told apart; the body is "Unauthorized" either way. Log the route, and don't loop on login.
- 400 with message "Refresh Token revoked or logged out" means the session ended (not a bad request).
- 403 means the ACL denied the card. Show a "not permitted" state, not "Nothing Recorded".
- HTTP 200 does **not** mean success on `/api/*allergy*` and `/api/*medical_problem*`. Check that `validationErrors` and `internalErrors` are empty.
- HTTP 200 with an empty FHIR `Bundle` can mean a *rejected search parameter*: `FhirPatientRestController.php:730-743`, `FhirAllergyIntoleranceRestController.php:212-227` and `FhirGenericRestController.php:105-113,130` never check `ProcessingResult::isValid()`. Validate the patient uuid client-side before rendering "Nothing Recorded".
- 404 with an empty body on `/api/patient/:pid/medication` means zero rows, so show "Nothing Recorded".
- 500 bodies may contain SQL. Never render `message` to the user.

**Per card** (field mapping in `ui/DEMOGRAPHICS-PART2-CARDS.md` "Parity spec";
only the pipeline-level contract is added here):

| Card | Call | Scope / ACL | Params honored | Default filtering | Differences from the PHP card (pipeline level) | Parity decision implementable? |
|---|---|---|---|---|---|---|
| Header (DB-02) | `GET /fhir/Patient/:uuid` or `/api/patient/:puuid` | `Patient.r` / `patient.r`; `patients/demo` | none on the instance route | n/a | The PHP page's gate is also `patients/demo` (`ui/DEMOGRAPHICS-PART2-CARDS.md` gate), so it matches. **No squad check** in the API (`ui/README.md` U-9) | squad: accepted gap, consistent |
| Allergies (DB-03) | `GET /api/patient/:puuid/allergy` | `allergy.s`; `patients/med` | none (query ignored) | none: returns all rows including resolved (`api/CLINICAL-CARDS.md`) | ACL matches the card's `aclCheckIssue('allergy')` locally. 200-with-`validationErrors` on a bad puuid | **Yes**: highlight-only uses `severity_al`; "Nothing Recorded" when `data` is empty (the `lists_touch` "No Known Allergies" variant is not available via API) |
| Medical Problems (DB-04) | `GET /api/patient/:puuid/medical_problem` | `medical_problem.s`; **`encounters/notes`** | none | none | **ACL differs**: the card requires `patients/med`, the list route requires `encounters/notes`, and the single-item route requires `patients/med` (Finding 5). `ui/DEMOGRAPHICS-PART2-CARDS.md` says "route `patients/med`", which is wrong for the list route | Yes, for users who hold `encounters/notes` |
| Medications (DB-05) | `GET /api/patient/:pid/medication` | `medication.s`; `patients/med` | none | none; `ORDER BY date DESC` | needs the **integer pid** (resolve it via `/api/patient/:puuid` → `pid`). Zero rows gives a 404 | Yes. "Nothing Recorded" on 404 |
| Prescriptions (DB-06) | `GET /api/prescription?patient_id=<pid>` | `prescription.s`; `patients/med` (card: `patients/rx`, `ui/DEMOGRAPHICS-PART2-CARDS.md` #19) | any key becomes an exact-match column (Finding 1). `patient.uuid`, the only key the service validates (`PrescriptionService.php:58-69`), **cannot arrive**: PHP turns `.` into `_` in query names, so it becomes `patient_uuid`, an unknown column, and a 500 with SQL. `patient_id=<pid>` matches `combined_prescriptions.patient_id` (`BINARY patient_id = '13'` matched 5 of 56 rows locally, SQL-verified). `puuid` exists but needs raw 16-byte uuid bytes | none: **all patients** if unfiltered; both source tables | keep only `source_table == 'prescriptions'`; `refills` not available (`api/CLINICAL-CARDS.md`) | **Yes** ("show ALL rows"), but only through the undocumented `patient_id` key on the injectable path. Alternative: `GET /fhir/MedicationRequest?patient=` (no `source_table`; `intent` heuristic) |
| Care Team (DB-07) | `GET /fhir/CareTeam?patient=<uuid>` (+ `Practitioner` reads) | `CareTeam.s`; `patients/med` (card: `patients/demo`) | all FHIR params | none (`api/CLINICAL-CARDS.md`) | ACL differs from the card (Phase 2 #19). Empty/invalid search both give a 200 empty Bundle | per `modules/CARE-TEAM-SERVICES.md` |
| Vitals (DB-08) | `GET /fhir/Observation?patient=<uuid>&category=vital-signs` | `Observation.s`; `patients/med` | all FHIR params. `_count`/`_offset`/`_sort` go through `FhirServiceBase.php:262-266` (per-service support not traced) | per `modules/VITALS-SERVICES.md` | invalid param gives a 200 empty Bundle ("No vitals have been documented" risk) | "correct latest non-deleted set": depends on `modules/VITALS-SERVICES.md` (deleted-form filter) |
| Messages | none | — | — | — | **not available via API** (no GET route) | n/a (card not ported) |

`hide_dashboard_cards` has no API equivalent (accepted gap).

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| Authenticate | yes | strategy chain, deny by default (`AuthorizationListener.php:237-251`) | `OPTIONS` and 5 skip paths bypass it |
| Token covers route family | yes | `api:oemr` / `api:port` (`BearerTokenAuthorizationStrategy.php:373-374`) | FHIR needs no family scope |
| Resource scope | yes | `onRestApiSecurityCheck` (`AuthorizationListener.php:182-193`) | before the handler; failure is a 401 |
| ACL (user context) | yes, per route | `RestConfig::request_authorization_check` | inside the closure; **skipped for patient context** |
| Per-patient authorization | **missing** | — | any user with the ACL section reads any patient. The SMART launch patient bind trusts the token (`BearerTokenAuthorizationStrategy.php:479-485`) |
| Squad restriction | **missing** | — | not referenced anywhere in the API layer |
| Message read | n/a | no route | — |

## Data touches

| Table / entity | Read | Write | Where | Transactional? |
|---|---|---|---|---|
| `oauth_access_tokens` (revocation, expiry, context) | yes | no | `AccessTokenRepository` via `BearerTokenAuthorizationStrategy.php:161,292,461` | no |
| trusted-user table (`oauth_trusted_user`, per `TrustedUserService`; not re-read) | yes | no | `:169` | no |
| `users` | yes | yes (uuid bootstrap, local API only) | `UuidUserAccount`, `LocalApiAuthorizationController.php:225-235` | no |
| `log`, `log_comment_encrypt`, `api_log` | no | yes | `authenticateUserToken` (`:299,311,316`); `ApiResponseLoggerListener.php:342-355` | no |
| gacl tables | yes | no | `AclMain::aclCheckCore` via `RestConfig.php:187` | no |
| `product_registration` | yes | no | `TelemetryService.php:60` | no |
| clinical tables | via services | — | see service analyses | — |

## Cross-links

- **Entered from:** `apis/dispatch.php` (`/apis/*`), `oauth2/authorize.php` (`/oauth2/*`)
- **Calls into:** `AclMain::aclCheckCore`, `AccessTokenRepository`, `TrustedUserService`, `ScopeEntity`, route controllers listed above
- **Related:** [CORS-LISTENER.md](CORS-LISTENER.md); `modules/ALLERGY-SERVICES.md`, `modules/PATIENT-SERVICES.md`, `modules/CARE-TEAM-SERVICES.md`, `modules/VITALS-SERVICES.md`, the prescription/medication service analysis (`PrescriptionService.php`, which owns Finding 1's sink), and the AuthorizationController analysis (scope issuance, patient picker ACL); `api/AUTH-AND-PATIENT.md` §1.7, §3; `api/CLINICAL-CARDS.md`

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Security | High (verified) | SQL injection through query-parameter **names** on `GET /api/prescription`. The route passes the raw query array to `PrescriptionService::getAll`. `FhirSearchWhereClauseBuilder` turns each primitive `key => value` into `StringSearchField($key, …, EXACT)`, and the resolver concatenates the key into SQL as `"BINARY " . $key . " = ?"`. There is no whitelist (compare `PatientRestController.php:482-486`). This needs an authenticated user token with `api:oemr`, `user/prescription.s` and `patients/med`. Error text is echoed (#2), which makes error-based extraction practical. | `_rest_routes_standard.inc.php:664-667`; `PrescriptionRestController.php:152-157`; `PrescriptionService.php:56-77`; `FhirSearchWhereClauseBuilder.php:33-45`; `SearchFieldStatementResolver.php:293` | Upstream: whitelist search keys (as `PatientRestController` does). Port: call only with `patient_id` |
| 2 | Security | Medium (verified) | Every exception message is returned to the client, including `SqlQueryException` (full SQL and DB error) from any handler. `dispatch.php`'s fallback echoes messages too. | `ExceptionHandlerListener.php:50-55`; `QueryUtils.php:226-230`; `dispatch.php:41-44` | Upstream: generic message plus correlation id. Port: never display `message` |
| 3 | Bug / contract | Medium (verified) | Standard-API validation and internal errors return **HTTP 200**: `handleProcessingResult` sets `http_response_code()` but returns an array that `ViewRendererListener` wraps in a 200 `JsonResponse`, and `sendHeaders` overrides the status. | `RestControllerHelper.php:204-221`; `ViewRendererListener.php:148-154`; allergy/problem routes `:209-276` | Port: treat non-empty `validationErrors`/`internalErrors` as errors |
| 4 | Bug / contract | Medium (verified) | FHIR search controllers ignore `ProcessingResult::isValid()`. A rejected search parameter (e.g. malformed `patient`) returns a 200 empty Bundle, which the SPA would show as "Nothing Recorded". | `FhirAllergyIntoleranceRestController.php:212-227`; `FhirPatientRestController.php:730-743`; `FhirGenericRestController.php:105-113,122-145`; `FhirServiceBase.php:287-294` | Port: validate ids client-side; never infer "empty" from a search the SPA didn't validate |
| 5 | Authorization / parity | Medium (verified) | The Medical Problems list routes check `encounters/notes`, while the per-item route and the PHP card use `patients/med`. A user can see the card in PHP but get a 403 from the API, or the reverse. This corrects Phase 1 (`api/CLINICAL-CARDS.md` said the per-patient GET uses `patients/med`) and Phase 2 (`ui/DEMOGRAPHICS-PART2-CARDS.md` "route `patients/med`"). | `_rest_routes_standard.inc.php:210,216,222` vs `:227` | Port: document "who can see"; handle 403 per card |
| 6 | Authorization | Medium (provisional) | Patient-context requests skip the ACL entirely. A `users` token that carries a SMART launch patient is bound without any access check (`checkUserHasAccessToPatient` returns `true`), so a clinician lacking `patients/med` could read allergies/meds through `patient/` scopes, if the patient picker lets them. The picker's ACL is not traced here. | `BearerTokenAuthorizationStrategy.php:259-265,434-454,479-485`; `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:75-81,146-152,472-478`; `FhirGenericRestController.php:94-102` | Port: request `user/` scopes only; Phase 6: check the picker |
| 7 | Contract | Medium (verified) | `/api/prescription` has no working documented patient filter. `patient.uuid` becomes `patient_uuid` under PHP query-name mangling (unknown column, 500 with SQL). Only the undocumented `patient_id=<pid>` works, and unfiltered calls return every patient's rows. | `PrescriptionService.php:58-69,171,225,313` (`patient_id` in both union branches and the outer join); SQL check `BINARY patient_id='13'` → 5/56 | Port: `?patient_id=<pid>`; client filter `source_table` |
| 8 | Privacy / audit | Low (verified) | With `api_log_option=2` (the local value), full JSON response bodies (PHI) are stored in plaintext `api_log` twice per call, while `patient_id` is 0 for clinician calls, so audit rows don't link the patient. | `ApiResponseLoggerListener.php:314-338,327`; `BearerTokenAuthorizationStrategy.php:267` | Deploy: choose `api_log_option` deliberately; note it for PHI review |
| 9 | Bug | Low (verified) | A patient-context request for another patient's `/fhir/Patient/:uuid` throws `AccessDeniedException` in the controller phase, which returns a 500 "patient id invalid" instead of a 403/404. | `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:613-615`; `ExceptionHandlerListener.php:43-49` | n/a for the port (user tokens) |
| 10 | Contract | Low (verified) | A missing scope returns 401 "Unauthorized", the same as an invalid token. A logged-out user gets a 400, not a 401. | `HttpRestRouteHandler.php:99-112`; `BearerTokenAuthorizationStrategy.php:169-178` | Port: map these explicitly; avoid login loops |
| 11 | Contract | Low (verified) | `/api/patient/:pid/medication` takes the integer pid (the other routes use uuids), ignores query params, and returns 404 with an empty body for zero rows. | `_rest_routes_standard.inc.php:298-303`; `ListService.php:48-60`; `RestControllerHelper.php:158-167` | Port: resolve pid from `/api/patient/:puuid` |
| 12 | Dead code | Low (verified) | `SkipAuthorizationStrategy` reads session `authUserId`, but writers use `authUserID`. The user branch never runs. The reversed prefix match is confirmed non-exploitable. | `SkipAuthorizationStrategy.php:57,71-80` | n/a |
| 13 | Smell | Low (verified) | `smart-configuration` wraps the scope list in an extra array (`scopes_supported: [[…]]`) and advertises no revocation endpoint. The endpoint URLs come from `site_addr_oath` (`https://localhost:9300` locally, SQL-verified), not the request origin. | `SMARTConfigurationController.php:79-81,103` | Port: don't parse `scopes_supported`; configure endpoints explicitly for the proxy |
| 14 | Gap | Low (verified) | No data-route check of `rest_api`/`rest_fhir_api`. Only `/oauth2/*` is gated. | `OAuth2AuthorizationListener.php:101-109` | n/a (config) |

## Port notes

- **Must survive:** authorization before any data fetch (U-6, U-7). Every call carries an explicit patient id (U-11). One ACL/scope failure must not blank the other cards; handle each card's 401/403/404/200-error on its own.
- **Must not survive:** rendering server `message` text; inferring "Nothing Recorded" from an unvalidated search; cross-origin topology; any use of `/api/prescription` with keys other than `patient_id`.
- **Open questions:**
  - Which ACL groups hold `encounters/notes` but not `patients/med`, or the reverse, in the target deployment? (gacl query not run.)
  - Does the OAuth patient picker (AuthorizationController) enforce `patients/demo` or `patients/med` before binding a launch patient? (Finding 6.)
  - Does `ScopeRepository` issue `user/prescription.rs`, `user/medication.rs` and `user/medical_problem.rs` to a registered SPA client, and does issuing `api:oemr` depend on `rest_api`?
  - Per-service honoring of `_count`, `_offset` and `_sort` for the FHIR resources above (belongs to the service analyses).
  - Confirm Findings 3, 4 and 7 on the wire once an OAuth client exists (no HTTP in Phase 3).
