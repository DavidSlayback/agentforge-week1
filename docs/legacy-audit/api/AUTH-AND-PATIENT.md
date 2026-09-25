# Auth and Patient — API Map (DB-01, DB-02)

**Audited by:** tier 2 (sonnet)
**Date:** 2026-09-25
**Git SHA:** `3ccfe1d` (branch `agentforge/w2-dashboard`)

Phase 1 scrape. This is a map, not a critique: it records what the code
does and where, with `path:line` citations, and flags gaps or uncertainty
explicitly rather than guessing or recommending fixes. Read-only — no
files outside this one were modified, nothing was executed.

Sources read: `docs/legacy-audit/REQUIREMENTS-TRACE.md`,
`docs/legacy-audit/RECON.md`, `API_README.md`, `FHIR_README.md`, plus
direct `Read`/`Grep` of the cited source files. `Documentation/api/*.md`
(linked from the two READMEs) was not used as a primary source — every
claim below is cited to code, not to that community-maintained doc set.

---

## 1. OAuth2/OIDC map (DB-01)

### 1.1 How requests reach the authorization server

There is **no static route-map array** for `/oauth2/*` (unlike the
standard/FHIR/portal data APIs — see §3). Routing is a single dispatch
method that does substring matching on the request path:

- Entry: `oauth2/.htaccess` rewrites all `/oauth2/*` requests to
  `oauth2/authorize.php` → `oauth2/authorize.php:22-26` → boots
  `ApiApplication::run()` (`src/RestControllers/ApiApplication.php:71-136`),
  a Symfony `HttpKernel` (`OEHttpKernel`) event pipeline.
- `OAuth2AuthorizationListener` is registered as a `KernelEvents::REQUEST`
  subscriber at `src/RestControllers/ApiApplication.php:93-94`, and only
  activates when the base path ends in `/oauth2`
  (`OAuth2AuthorizationListener::shouldProcessRequest()`,
  `src/RestControllers/Subscriber/OAuth2AuthorizationListener.php:57-60`).
- The endpoint table lives in
  `OAuth2AuthorizationListener::authorizeRequest()`,
  `src/RestControllers/Subscriber/OAuth2AuthorizationListener.php:93-187`,
  as a chain of `if (str_contains($end_point, ...))` blocks.

| Endpoint | Match | Delegates to |
|---|---|---|
| `/oauth2/default/authorize` | `OAuth2AuthorizationListener.php:139-142` | `AuthorizationController::oauthAuthorizationFlow()`, `src/RestControllers/AuthorizationController.php:555` |
| `/oauth2/default/token` | `OAuth2AuthorizationListener.php:124-127` | `AuthorizationController::oauthAuthorizeToken()`, `AuthorizationController.php:1350` |
| `/oauth2/default/introspect` | `OAuth2AuthorizationListener.php:182-185` | `AuthorizationController::tokenIntrospection()`, `AuthorizationController.php:1508` → `TokenIntrospectionRestController::postAction()`, `src/RestControllers/TokenIntrospectionRestController.php:72` |
| `/oauth2/default/revoke` | **not found** | No public revoke endpoint exists. `SMARTConfigurationController.php:99-103` explicitly comments out a `revocation_endpoint` ("we don't support API revocation of tokens right now"). Revocation is admin-UI-only — see §1.4. |
| `/oauth2/default/jwk` (jwks) | `OAuth2AuthorizationListener.php:149-152` | `OAuth2PublicJsonWebKeyController::getJsonWebKeyResponse()`, `src/RestControllers/Authorization/OAuth2PublicJsonWebKeyController.php:23` |
| `/.well-known/openid-configuration` | `OAuth2AuthorizationListener.php:129-137` | `OAuth2DiscoveryController::getDiscoveryResponse()`, `src/RestControllers/Authorization/OAuth2DiscoveryController.php:43` |
| `/fhir/.well-known/smart-configuration` (note: under `/fhir`, not `/oauth2`) | static FHIR route, `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:821-822` | `SMARTConfigurationController::getConfig()`, `src/RestControllers/SMART/SMARTConfigurationController.php:34-45`; exempted from bearer-token check via `SkipAuthorizationStrategy::addSkipRoute()`, `src/RestControllers/Subscriber/AuthorizationListener.php:96` |
| `/oauth2/default/registration` | `OAuth2AuthorizationListener.php:167-170` | `AuthorizationController::clientRegistration()`, `AuthorizationController.php:249` |
| `/oauth2/default/logout` | `OAuth2AuthorizationListener.php:177-180` | `AuthorizationController::userSessionLogout()`, `AuthorizationController.php:1450` |
| `/oauth2/default/client` (registered-client details) | `OAuth2AuthorizationListener.php:172-175` | `AuthorizationController::clientRegisteredDetails()`, `AuthorizationController.php:473` |

Anything else under `/oauth2` falls through to a 404
(`OAuth2AuthorizationListener.php:186`).

### 1.2 Grant types, PKCE, public vs. confidential clients

Registered in `AuthorizationController::getAuthorizationServer()`,
`src/RestControllers/AuthorizationController.php:643-765`:

- **`authorization_code`** — `CustomAuthCodeGrant`, `AuthorizationController.php:674-724`.
- **`refresh_token`** — `CustomRefreshTokenGrant`, `AuthorizationController.php:725-734`.
- **`password`** — `CustomPasswordGrant`, `AuthorizationController.php:736-747`, gated by
  `!empty($this->globalsBag->get('oauth_password_grant'))` (`:736`).
- **`client_credentials`** — `CustomClientCredentialsGrant`, `AuthorizationController.php:748-761`.

**PKCE:** `src/Common/Auth/OpenIDConnect/Grant/CustomAuthCodeGrant.php`
extends the vendor `league/oauth2-server` `AuthCodeGrant` (`:28`) and calls
`parent::validateAuthorizationRequest($request)` (`:123`) without
disabling PKCE — so the requirement that public clients supply a
`code_challenge` is the **vendor library's default behavior**, not code
OpenEMR authored itself. What OpenEMR's own code does add is narrowing
the accepted `code_challenge_method` to `S256` only, rejecting `plain`
(`CustomAuthCodeGrant.php:245-270`, comment at `:245-249` citing the SMART
on FHIR spec).

**Public vs. confidential:** determined by the `oauth_clients.is_confidential`
column, set at registration time —
`$is_confidential_client = empty($info['client_secret']) ? 0 : 1;`
(`src/Common/Auth/OpenIDConnect/Repositories/ClientRepository.php:56`),
persisted (`:97`, `:111`), and read back for validation (`:172`, `:186`,
`:198`, `:263`). Both client types are supported; which one a caller gets
depends on whether it registers as `"application_type": "private"`
(forces a secret + confidential client + `client_role = 'user'`,
`AuthorizationController.php:312-316`) or omits it (public/patient client,
`:308`).

### 1.3 Client registration

`POST /oauth2/default/registration` is **self-service** —
`AuthorizationController::clientRegistration()`,
`AuthorizationController.php:249-432` — it creates the `oauth_clients` row
and returns `client_id`/`client_secret`/`registration_access_token`
synchronously (`:394-422`). No admin approval gates the registration call
itself.

Whether the new client can immediately obtain tokens is a separate,
scope-dependent gate:

- `ClientRepository::insertNewClient()`,
  `src/Common/Auth/OpenIDConnect/Repositories/ClientRepository.php:78-88`
  calls `ScopeRepository::hasScopesThatRequireManualApproval()`
  (`src/Common/Auth/OpenIDConnect/Repositories/ScopeRepository.php:334-360`)
  and sets `oauth_clients.is_enabled = 0` if approval is required.
- That method requires manual approval when: a public client requests the
  `launch` scope (`:341-345`); the global `oauth_app_manual_approval = 1`
  forces it for every app (`:348-350`); confidential clients requesting
  only `patient/*` scopes (no `user/`/`system/`) are auto-enabled per an
  ONC information-blocking carve-out (`:352-359`).
- Enforced at token time: `CustomAuthCodeGrant::validateClient()`,
  `CustomAuthCodeGrant.php:235-238` — `if (!$client->isEnabled()) { throw
  OAuthServerException::invalidClient($request); }`.

**Admin approval UI:** `interface/smart/admin-client.php` →
`src/FHIR/SMART/ClientAdminController.php`: `enableAction()`/
`disableAction()` (`:379`/`:360`) → `handleEnabledAction()` (`:410`) →
`ClientRepository::saveIsEnabled()` (`ClientRepository.php:231-241`, `UPDATE
oauth_clients SET is_enabled=?`). The same controller is also where the
only token/session revocation lives (admin-only):
`revokeTrustedUserAction` (`:659`), `revokeRefreshToken` (`:687`),
`revokeAccessToken` (`:759`), `toolsRevokeAccessTokenAction` (`:714`),
`toolsRevokeRefreshToken` (`:736`).

**Configuration note (not a code change):** per A5 in
`REQUIREMENTS-TRACE.md:46`, enabling the settings in §1.5 and registering
a SPA client via the registration endpoint above is local-environment
configuration, not a backend code change, and is in scope for the port.

### 1.4 Globals/settings required for the API and FHIR

Enum: `src/Services/Globals/GlobalConnectorsEnum.php:16-27`:

```
SITE_ADDRESS_OAUTH               = 'site_addr_oath'
REST_FHIR_API                    = 'rest_fhir_api'
REST_SYSTEM_SCOPES_API           = 'rest_system_scopes_api'
REST_API                         = 'rest_api'
REST_PORTAL_API                  = 'rest_portal_api'
OAUTH_PASSWORD_GRANT              = 'oauth_password_grant'
OAUTH_APP_MANUAL_APPROVAL         = 'oauth_app_manual_approval'
OAUTH_EHR_LAUNCH_AUTHORIZATION_FLOW_SKIP = 'oauth_ehr_launch_authorization_flow_skip'
```

Declared with labels/defaults in the "Connectors" tab of
`library/globals.inc.php:3241-3304`:

- `rest_api` — bool, default `'0'`, "Enable OpenEMR Standard REST API" (`:3264-3269`)
- `rest_fhir_api` — bool, default `'0'`, "Enable OpenEMR Standard FHIR REST API" (`:3250-3255`)
- `rest_portal_api` — bool, default `'0'`, "Enable OpenEMR Patient Portal REST API (EXPERIMENTAL)" (`:3271-3276`)
- `rest_system_scopes_api` — bool, default `'0'` (`:3257-3262`)
- `oauth_password_grant` — 0-3 enum: off / users / patient / both (`:3278-3288`)
- `oauth_app_manual_approval` — (`:3289-3298`)
- `site_addr_oath` — "Site Address Override (if needed for OAuth2, FHIR, CCDA, or Payment Processing)" (`:3243-3248`)

**Enforcement found:** `OAuth2AuthorizationListener::authorizeRequest()`,
`src/RestControllers/Subscriber/OAuth2AuthorizationListener.php:101-109` —
if `rest_api`, `rest_fhir_api`, and `rest_portal_api` are **all** empty,
every `/oauth2/*` request 404s (`NotFoundHttpException("OpenEMR Error: API
is disabled")`) and the session is invalidated. This was independently
confirmed by direct read of that file during this audit.

**Not found:** an equivalent explicit "disabled → 404" check on the data
routes themselves (`apis/routes/_rest_routes_standard.inc.php`,
`..._fhir_r4_us_core_3_1_0.inc.php`, `..._portal.inc.php`, or in
`AuthorizationListener`/`BearerTokenAuthorizationStrategy`). In practice a
bearer token can't be minted with the API off, so the data routes are
unreachable transitively — but no direct gate on `/apis/*` was located.
Also not found under those exact names anywhere in this repo:
`is_client_registration_enabled`, `google_authenticator`,
`api_allow_patient_portal`.

### 1.5 CORS for a browser SPA on another origin

Found: `src/RestControllers/Subscriber/CORSListener.php` (full file, 79
lines), registered as an event subscriber at
`src/RestControllers/ApiApplication.php:91`.

- Preflight (`OPTIONS`): handled at `CORSListener.php:24-42` via
  `getInitialResponse()` (`:61-77`).
- Real-response CORS header: `CORSListener.php:44-59`.

Behavior, read directly off the code: it is an **unconditional
origin-reflection** policy, not a whitelist and not a literal `*`. Any
request carrying an `Origin` header gets that exact value echoed back:

```
CORSListener.php:56-57   $origins = $request->getHeader('Origin');
                         $response->headers->set("Access-Control-Allow-Origin", $origins[0]);
```

with `Access-Control-Allow-Credentials: true` on the OPTIONS preflight
response (`:67`). The in-code comment at `:53-55` states this is
intentional ("we have to allow public API clients to have CROSS ORIGIN
access") and flags it with a `@TODO: review security implications if we
need to tighten this up`. There is no global/config toggle for an origin
whitelist — this behavior is unconditional for any request that presents
an `Origin` header.

One literal-code fact worth recording for the port: the preflight
response's header array at `CORSListener.php:66-70` is

```php
$response = new Response('', Response::HTTP_OK, [
    'Access-Control-Allow-Credentials' => 'true',
    "Access-Control-Allow-Headers" => "origin, authorization, accept, content-type, content-encoding, x-requested-with",
    "Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, PATCH, TRACE, OPTIONS"
]);
```

The last element (`:69`) has no `=>`, so `"Access-Control-Allow-Methods"`
and the methods string become two separate positional array entries
rather than a `name => value` pair passed to Symfony's `Response` header
bag. This was read from source only — no request was sent to confirm the
resulting header on the wire (out of scope for a read-only audit); see
Open Questions.

For a browser SPA: no separate CORS configuration step is needed beyond
enabling the API globals in §1.4 — the reflection is unconditional.

### 1.6 Token lifetimes

All constants in `src/RestControllers/AuthorizationController.php:99-111`,
applied in `getAuthorizationServer()`:

| Grant | TTL | Constant / citation |
|---|---|---|
| Access token (auth code, refresh, password grants) | `PT1H` (1 hour) | `GRANT_TYPE_ACCESS_TOKEN_TTL`, `:110`, applied `:722`, `:732`, `:745` |
| Refresh token | `P3M` (3 months) | `GRANT_TYPE_REFRESH_TOKEN_TTL`, `:111`, applied `:719`, `:727`, `:742`; comment at `:719` notes "minimum per ONC" |
| Client-credentials access token | `PT300S` (5 min) | `GRANT_TYPE_ACCESS_CODE_TTL`, `:104`, applied `:759` |
| Authorization code | `PT1M` (1 min) | inline `new DateInterval('PT1M')`, `:712`, comment "should be short turn around" |

### 1.7 Scope format and where scopes are checked

**Both SMART v1 (`patient/*.read`/`.write`) and v2 (CRUDS: `.c`, `.r`,
`.u`, `.d`, `.s`, combinations like `.rs`/`.cruds`, plus
`?category=...`/other constraint suffixes) are accepted**, parsed by two
OpenEMR classes (not vendor code):

- `ScopeEntity::createFromString()`,
  `src/Common/Auth/OpenIDConnect/Entities/ScopeEntity.php:56-86` — parses
  `context/resource.permission` (or `context:resource.permission`).
- `ScopePermissionObject::createFromString()`,
  `src/Common/Auth/OpenIDConnect/Entities/ScopePermissionObject.php:40-84`:
  literal `read` → v1, mapped to `r`+`s` (`:44-48`); literal `write` → v1,
  mapped to `c`+`u`+`d` (`:49-54`); otherwise validated as an ordered v2
  CRUDS string (`isOrderedCrudString()`, `:60`, `:87-116`), with an
  optional `?constraint=value` suffix (`:69-73`). Back-compat `v1Read`/
  `v1Write` flags are inferred when a v2 combination fully covers `rs` or
  `cud` (`:75-80`).

**Per-request enforcement pipeline**, run before any route controller
executes:

1. `HttpRestRouteHandler::checkSecurity()`,
   `src/Common/Http/HttpRestRouteHandler.php:141-188` (dispatch call at
   `:183`), invoked from the route-dispatch loop at `:70`, before the
   matched route's controller callback runs. It dispatches
   `RestApiSecurityCheckEvent`.
2. `AuthorizationListener::onRestApiSecurityCheck()`,
   `src/RestControllers/Subscriber/AuthorizationListener.php:134-196` —
   builds the required scope string for the route/method (`:154-180`) and
   checks it:
   ```
   :190  $scopeEntity = ScopeEntity::createFromString($scope);
   :191  if (!$restRequest->requestHasScopeEntity($scopeEntity)) {
   :192      throw new AccessDeniedException($scopeType, $restRequest->getResource() ?? '', "scope " . $scope . " not in access token");
   ```
3. `HttpRestRequest::requestHasScopeEntity()`,
   `src/Common/Http/HttpRestRequest.php:373-380`, delegates the actual
   comparison to `ScopeEntity::containsScope()`,
   `ScopeEntity.php:140-179`.

Granted scopes are populated onto the request earlier by
`BearerTokenAuthorizationStrategy::authorizeRequest()`
(`src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php:204-211`)
via `ScopeValidatorFactory::buildScopeValidatorArray()`
(`src/Common/Auth/OpenIDConnect/Validators/ScopeValidatorFactory.php:23-38`).

**Dead-code note:** a second, older scope-check method,
`RestConfig::scope_check()` (`src/RestControllers/Config/RestConfig.php:201-220`),
exists but has **zero callers** anywhere under `src/` or `apis/` — the
only other references are PHPStan baseline entries for its own untyped
parameters. It appears superseded by the `AuthorizationListener`/
`RestApiSecurityCheckEvent` pipeline above. Confirmed independently by two
separate greps in this audit (once by the researching sub-agent, once
directly by the primary author of this document).

---

## 2. Patient resource map (DB-02)

### 2.1 FHIR `Patient`

- Route registration: `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`
  — `GET /fhir/Patient` (`:578-595`), `GET /fhir/Patient/:uuid` (`:608-620`),
  `POST /fhir/Patient` (`:560-568`), `PUT /fhir/Patient/:uuid` (`:569-577`),
  `GET /fhir/Patient/$export` (`:598-609`, bulk export, separate
  `FhirOperationExportRestController`).
- Controller: `src/RestControllers/FHIR/FhirPatientRestController.php` —
  class (`:30`), `getOne()` (`:558-562`, delegates to
  `FhirPatientService::getOne()`), `getAll()` (`:730`), `post()` (`:272`),
  `put()` (`:408`).
- Service/mapping: `src/Services/FHIR/FhirPatientService.php`, entry point
  `parseOpenEMRRecord()` (`:196-253`).

### 2.2 Standard REST `/api/patient/:puuid`

- Route: `apis/routes/_rest_routes_standard.inc.php:99-104` —

  ```php
  "GET /api/patient/:puuid" => function ($puuid, HttpRestRequest $request) {
      RestConfig::request_authorization_check($request, "patients", "demo");
      $return = (new PatientRestController())->getOne($puuid, $request);
      return $return;
  },
  ```

  (param name is `:puuid`, not `:pid`). List route `GET /api/patient` at
  `:76-82`.
- Controller: `src/RestControllers/PatientRestController.php` — class
  (`:130`), `getOne()` (`:323-332`), `getAll()` (`:480`).
- Service: `src/Services/PatientService.php` — `getOne()` (`:632-647`,
  validates uuid via `PatientValidator::isExistingUuid`, then searches on
  `uuid`), `search()` (`:418+`, selects `patient_data.*` plus joined
  `patient_history`/`patient_additional_addresses`/`provider` fields,
  `:426-440`), `createResultRecordFromDatabaseResult()` (`:363-377`,
  converts binary `uuid` columns to string).
- Response field list, per `swagger/openemr-api.yaml:9915-10012`
  (`api_patient_response.data[]`): `id`, `pid`, `pubpid`, `title`,
  `fname`, `mname`, `lname`, `ss`, `street`, `postal_code`, `city`,
  `state`, `county`, `country_code`, `drivers_license`,
  `contact_relationship`, `phone_contact`, `phone_home`, `phone_biz`,
  `phone_cell`, `email`, `DOB`, `sex`, `race`, `ethnicity`, `status`. Since
  the SQL is `SELECT patient_data.*` (`PatientService.php:427`), the
  actual response is not limited to this documented subset, but this is
  the documented contract.

### 2.3 Field map (patient_data → header UI → FHIR / REST)

| Header field | `patient_data` column(s) | FHIR path | REST field | Available? |
|---|---|---|---|---|
| Name | `fname`, `mname`, `lname`, `title`, `suffix` (`sql/database.sql:8340-8342`) | `Patient.name` (HumanName) via `parseOpenEMRPatientName()`, `FhirPatientService.php:281-335` — `title`→`prefix` (`:287-289`), `lname`→`family` (`:290-292`), `fname`→`given[0]` (`:294-296`), `mname`→`given[1]` (`:298-300`); `name.use` hardcoded `'official'` (`:285`); prior names from `patient_history` mapped with `use='old'` (`:308-333`) | `fname`/`mname`/`lname`/`title` (`swagger/openemr-api.yaml:9942-9953`) | **Yes** |
| Date of birth | `DOB` (`sql/database.sql:8343`) | `Patient.birthDate` via `parseOpenEMRDateOfBirth()`, `FhirPatientService.php:274-279`, called at `:222` | `DOB` (`swagger/openemr-api.yaml:9996`) | **Yes** |
| Sex | `sex`, comment "Sex at birth" (`sql/database.sql:8360`); related but separate: `gender_identity` (`sql/database.sql:8448`), `sex_identified` "Patient reported current sex" (`sql/database.sql:8465`, not referenced in `FhirPatientService.php` — not verified as mapped anywhere) | `Patient.gender` + `us-core-birthsex` extension via `parseOpenEMRGenderAndBirthSex()`, `FhirPatientService.php:376-419`, called at `:223` (constant `FIELD_NAME_GENDER = 'sex'`, `:98`); `gender_identity` separately feeds a `us-core-genderidentity` extension via `parseOpenEMRGenderIdentity()`, `:599+` | `sex` (`swagger/openemr-api.yaml:9999`) | **Yes** (sex at birth only; `sex_identified` not confirmed mapped) |
| MRN / external ID | `pubpid` (`sql/database.sql:8379`) | `Patient.identifier` via `parseOpenEMRPublicPatientIdentifier()`, `FhirPatientService.php:552-566`, called at `:227`; `createIdentifier('official', 'http://terminology.hl7.org/CodeSystem/v2-0203', 'PT', 'http://terminology.hl7.org/CodeSystem/v2-0203', $pubpid)` (`:557-563`) — both the identifier-type coding system and `identifier.system` use the same v2-0203 URI, type code `PT` | `pubpid` (`swagger/openemr-api.yaml:9939`) | **Yes** |
| SSN (not a header field, listed for completeness) | `ss` (`sql/database.sql:8350`) | `Patient.identifier` via `parseOpenEMRSocialSecurityRecord()`, `FhirPatientService.php:493-512`, called at `:226`; identifier system `http://hl7.org/fhir/sid/us-ssn`, type `SS` (`:502-510`); code comment `:495-500` notes US Core discourages SSN as an identifier value but the mapping fires whenever `ss` is non-empty | `ss` (`swagger/openemr-api.yaml:9954`) | Yes (mapped; not a DB-02 field) |
| **Active status** | **none** — no `patient_data` column drives it. Closest related columns: `deceased_date` (`sql/database.sql:8422`, feeds a *different* FHIR element) and an untyped `status` varchar (`sql/database.sql:8357`, no documented enum, never referenced in `FhirPatientService.php`) | `Patient.active` is **hardcoded `true`**, unconditionally: `$patientResource->setActive(true);`, `FhirPatientService.php:212` — confirmed as the only `setActive`/`active` reference in that file. `deceased_date` instead feeds `Patient.deceased[x]` via `parseOpenEMRPatientDeceasedDateTime()`, `FhirPatientService.php:741-752` (sets `deceasedDateTime` if present, else explicit `setDeceasedBoolean(false)`) — a distinct FHIR element, not `active` | `status` (`swagger/openemr-api.yaml:10008`) — raw `patient_data.status` column, undocumented accepted values, not consulted by the FHIR mapper | **No** — FHIR `Patient.active` carries no real signal (always `true`); the legacy PHP dashboard has no "active" concept either (see §2.4) — its nearest analog is "not deceased" |

### 2.4 What the legacy dashboard actually shows as identity

Neither `interface/patient_file/summary/dashboard_header.php` (renders
only the page heading and a CSRF token via
`patient/dashboard_header.html.twig`, no patient fields —
`dashboard_header.php:30-36`) nor the direct-URL
`interface/patient_file/summary/demographics.php` render sends
name/DOB/sex/pubpid/status as a persistent identity bar by themselves.
What actually populates the tabbed shell's persistent identity bar is a
JS call embedded in the page:

```
demographics.php:925           parent.left_nav.setPatient(fname+" "+lname, pid, pubpid, '', "DOB: ... Age: ...")
demographics_full.php:510      parent.left_nav.setPatient(fname+" "+lname, pid, pubpid, '', "DOB: ... Age: ...")
```

`left_nav.setPatient(pname, pid, pubpid, frname, str_dob)` is defined at
`interface/main/tabs/js/frame_proxies.js:27-54`; the 4th parameter
(`frname`) is accepted but never passed into the view model — only
`pname`, `pid`, `pubpid`, `str_dob` reach
`new patient_data_view_model(pname, pid, pubpid, str_dob)`
(`frame_proxies.js:37`, model defined
`interface/main/tabs/js/patient_data_view_model.js:21-30`). **Sex and any
active/status concept are never passed into this identity bar at all** —
matching `RECON.md:63` ("No DOB, sex, MRN or status on the direct URL")
and `RECON.md:138-139` ("No persistent patient identity on the dashboard
page... This matters for DB-02"). This JS call is also the origin of the
`top.restoreSession is not a function` / `setPatient` console errors
`RECON.md` records (`RECON.md:82-84`) when the page is loaded outside the
tabbed shell — it assumes `parent.left_nav` exists.

### 2.5 `pid` (integer) → API `uuid`

- Schema: `patient_data.uuid binary(16) DEFAULT NULL` is part of the base
  `CREATE TABLE` (`sql/database.sql:8336`), with `UNIQUE KEY uuid (uuid)`
  (`sql/database.sql:8468`) — not a later `ALTER TABLE` in this dump.
- `BaseService::getUuidById($id, $table, $field)`
  (`src/Services/BaseService.php:402-408`, `SELECT uuid FROM $table WHERE
  $field = ?`) and `getIdByUuid()` (`:387-392`, the inverse).
- `PatientService::getUuid(string $pid)` (`src/Services/PatientService.php:696-699`)
  resolves via `patient_data.pid` (not the `id` auto-increment PK).
  `PatientService::getPidByUuid($uuid)` (`:701-704`) is the inverse.
- New-patient uuid assignment: `(new UuidRegistry(['table_name' =>
  'patient_data']))->createUuid()`, `PatientService.php:173`; registry
  class `src/Common/Uuid/UuidRegistry.php:36`.
- **Search-by-legacy-id, standard REST:** `GET /api/patient?pubpid=...`
  works via `PatientService`'s generic exact-match search branch
  (`PatientService.php:408-413`), reachable because
  `PatientRestController::getAll()` passes query params straight through
  (`_rest_routes_standard.inc.php:76-82`, `PatientRestController.php:480`).
- **Search-by-legacy-id, FHIR:** `GET /fhir/Patient?identifier=<value>`
  searches the `ss` or `pubpid` columns
  (`FhirPatientService::loadSearchParameters()`, `:129`); `_id`/`{id}`
  resolves against `patient_data.uuid` (`:128`, definition `:986-989`).
  **Not found:** any FHIR search parameter mapped directly to the legacy
  integer `pid`/`id` columns — a caller must go through `pubpid`/`ss`
  (`identifier`) or already know the `uuid`.

---

## 3. Access control on these routes (scopes + ACL)

### 3.1 Two independent gates for `user/`(and `system/`)-context tokens

Both of the following run for a non-patient-context request, and **both**
must pass:

1. **OAuth2 scope check** (always runs first, for every matched route,
   before the controller executes) —
   `HttpRestRouteHandler::checkSecurity()`
   (`src/Common/Http/HttpRestRouteHandler.php:141-188`, dispatch at
   `:183`, called from the route-dispatch loop at `:70`) dispatches
   `RestApiSecurityCheckEvent` →
   `AuthorizationListener::onRestApiSecurityCheck()`
   (`src/RestControllers/Subscriber/AuthorizationListener.php:134-196`,
   scope match `:190-193`, detailed in §1.7).
2. **ACL check** via `AclMain::aclCheckCore()`
   (`src/Common/Acl/AclMain.php:166`), reached through
   `RestConfig::request_authorization_check()` /
   `RestConfig::authorization_check()`
   (`src/RestControllers/Config/RestConfig.php:180-194`,
   `AclMain::aclCheckCore(...)` call at `:187`) — called from inside the
   **non-patient-context branch** of each route closure, e.g.:
   - Patient: `GET /fhir/Patient` → `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:590`
     (`"patients","demo"`); `GET /fhir/Patient/:uuid` → `:618`;
     `GET /api/patient/:puuid` → `_rest_routes_standard.inc.php:101`
     (same `"patients","demo"`).
   - AllergyIntolerance: `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:79` /
     `:90` (`"patients","med"`).
   - CareTeam: `:150` / `:161` (`"patients","med"`).
   - MedicationRequest: `:476` / `:487` (`"patients","med"`).
   - Condition (routed through the shared `FhirGenericRestController`):
     `addAclRestrictions("patients","med")` registered at `:169`/`:174`,
     consumed by `FhirGenericRestController::getAllProcessingResult()`
     (`src/RestControllers/FHIR/FhirGenericRestController.php:97-100`).
   - `GET /fhir/Patient/$export` uses a different section entirely —
     `"admin","users"`, unconditionally (`:599`).

   `RestConfig::authorization_check()` throws
   `AccessDeniedHttpException` on ACL failure
   (`RestConfig.php:188-193`), independent of the scope result already
   checked in step 1.

   The ACL section/value pair (`"patients","demo"`) used to gate
   `GET /fhir/Patient` and `GET /api/patient/:puuid` for a user-context
   token is the **same** pair the legacy UI checks to gate the whole
   demographics/dashboard page:
   `AclMain::aclCheckCore('patients', 'demo')`,
   `interface/patient_file/summary/demographics.php:1056`. Individual
   legacy cards use `AclMain::aclCheckIssue('allergy'|'medical_problem'|
   'medication')` (`demographics.php:1095-1097`), a different, per-card
   ACL entry point not directly mirrored by the API's per-route checks
   above (the API checks are coarser: `"patients","med"` for allergies,
   problems, and medications alike).

### 3.2 Patient-context tokens: ACL is skipped, replaced by a hard UUID bind

For a `patient/`-scope token, the ACL step (§3.1 item 2) **does not run**.
Each route closure branches on `$request->isPatientRequest()`:

```
_rest_routes_fhir_r4_us_core_3_1_0.inc.php:75-81 (AllergyIntolerance)
    if ($request->isPatientRequest()) {
        $return = (new FhirAllergyIntoleranceRestController($request))
            ->getAll($getParams, $request->getPatientUUIDString());
    } else {
        RestConfig::request_authorization_check($request, "patients", "med");
        ...
```

The same pattern repeats for Patient (`:608-620`), CareTeam
(`:150-165`), and (via `FhirGenericRestController.php:94-101`) Condition.
When true, the controller is called with the token's bound patient UUID
as a hard filter/bind argument, and the ACL branch is simply not
executed. The scope check from §1.7/§3.1-item-1 still runs, with
`$scopeType` forced to `'patient'`
(`AuthorizationListener.php:149`).

The bound UUID comes from
`HttpRestRequest::getPatientUUIDString()`
(`src/Common/Http/HttpRestRequest.php:544-552`), set either directly for
a patient-role user
(`src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php:227`)
or, for a practitioner/user-role token carrying a SMART EHR-launch
`patient` context claim, via `populateTokenContextForRequest()`
(`BearerTokenAuthorizationStrategy.php:414-444`).

**Conclusion:** ACL (`AclMain`) only gates `user/`/`system/`-context API
calls. A `patient/`-context token bypasses ACL entirely and is restricted
purely by the hard patient-UUID bind — it is not true that "ACL only
applies to the traditional UI"; it applies to user-context API calls too,
as a second gate on top of the scope check.

### 3.3 Unauthenticated-route check (explicit security pass)

The unauthenticated-route allowlist is short and hardcoded:
`/fhir/metadata`, `/fhir/.well-known/smart-configuration`,
`/fhir/OperationDefinition`, `/api/version`, `/api/product` — all
registered at
`src/RestControllers/Subscriber/AuthorizationListener.php:95-99` via
`SkipAuthorizationStrategy::addSkipRoute()`. None of these return patient
data: `/fhir/metadata` returns only a `FHIRCapabilityStatement`
(`src/RestControllers/FHIR/FhirMetaDataRestController.php:36`, no
patient/PHI service calls). `/oauth2/default/*` and
`/.well-known/openid-configuration` are handled entirely inside
`OAuth2AuthorizationListener::authorizeRequest()` (§1.1), which only
dispatches to auth-server endpoints (token, authorize, jwk, discovery,
login, introspection) — none touch PHI services. **No unauthenticated
PHI-returning route was found.**

One implementation detail worth recording (not independently exploitable,
per this audit's check): `SkipAuthorizationStrategy::shouldProcessRequest()`
(`src/RestControllers/Authorization/SkipAuthorizationStrategy.php:56-59`)
tests `str_starts_with($route, $pathInfo)` — i.e., whether the
*allow-listed skip route* starts with the *request path*, the reverse of
the more intuitive `str_starts_with($pathInfo, $route)`. In practice this
only widens matching to short prefixes of the 5 allow-listed paths (e.g. a
request to `/fhir/m` would match the `/fhir/metadata` skip-route), which
isn't independently routable to any PHI-returning controller.

---

## 4. Open questions

- **No `/oauth2/default/revoke` public endpoint exists.** Token
  revocation is admin-UI-only (`ClientAdminController`, §1.3). For the
  SPA's "logout ends the session" requirement (DB-01), it's unclear
  whether that should mean client-side token discard only, or whether
  David wants a call into the admin revoke actions — those are gated by
  the admin ACL/UI, not a client-callable API route in this codebase.
- **No explicit "API disabled → 404" gate was found directly on
  `/apis/*`** (standard/FHIR/portal data routes) — only on `/oauth2/*`
  (§1.4). Practically moot (no token can be minted without `/oauth2`
  enabled), but not verified as a direct code fact for the data routes
  themselves.
- **Globals named `is_client_registration_enabled`, `google_authenticator`,
  `api_allow_patient_portal` do not exist** in this codebase under those
  names (checked `library/globals.inc.php` and all of `src/`). The actual
  toggles are `rest_api`/`rest_fhir_api`/`rest_portal_api`/
  `rest_system_scopes_api`/`oauth_password_grant`/`oauth_app_manual_approval`/
  `site_addr_oath` (§1.4).
- **Whether `Access-Control-Allow-Methods` actually reaches the browser**
  on an OPTIONS preflight is uncertain from source alone — the array
  literal at `CORSListener.php:69` lacks a `=>`, which reads as though the
  header name and value become two unkeyed array entries rather than a
  `name => value` pair (§1.5). Not confirmed at runtime — no requests were
  sent, per the read-only rule for this audit.
- **`patient_data.status`** (`sql/database.sql:8357`) has no documented
  enum of accepted values in the schema dump, is never referenced in
  `FhirPatientService.php`, and was not found displayed anywhere in
  `interface/patient_file/summary/demographics_full.php` by this audit's
  searches — its intended semantics are unclear. It is **not** the
  "active status" DB-02 asks for; do not conflate the two.
- **`patient_data.sex_identified`** ("Patient reported current sex",
  `sql/database.sql:8465`) was located in the schema but this audit did
  not confirm whether it is surfaced by any API path — flagged as
  unclear, not guessed either way.
- **CareTeam and Patient Notes have zero test data** per
  `RECON.md:11,58-59,113-115,142-143`. The field-mapping and access-control
  findings above don't depend on live data, but DB-02 parity can't be
  demonstrated end-to-end against a live response until patient data
  exists for those cards (out of scope for this document, which covers
  DB-01/DB-02 only).

---

**Confidence:** high — every claim above was read directly from source
(`Read`/`Grep`) with `path:line` citations; nothing was inferred from the
`Documentation/api/*.md` narrative docs or run against a live server.
**Escalate:** none — this audit specifically checked for an
unauthenticated PHI-returning route (§3.3) and found none; the
unauthenticated allowlist returns only capability/discovery metadata.
