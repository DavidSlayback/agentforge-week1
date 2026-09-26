# AuthorizationController: the OAuth2/OIDC authorization server behind DB-01

`AuthorizationController` is OpenEMR's whole OAuth2/OpenID Connect
authorization server. It handles dynamic client registration, the
authorization-code flow (login page, SMART patient picker, consent page),
the token endpoint, OIDC logout and introspection. Every `/oauth2/<site>/*`
request goes through Apache (`oauth2/.htaccess`), then `oauth2/authorize.php`,
then `ApiApplication::run()`. From there `OAuth2AuthorizationListener`
substring-matches the path and calls one public method on a fresh
`AuthorizationController`. That method builds a `league/oauth2-server`
`AuthorizationServer` on each request and returns a PSR-7 response. Most
methods invalidate the OAuth session before they return.

The SPA port (DB-01 / W2D-1) will be a browser app that is a public client,
uses authorization code + PKCE and keeps tokens in memory. Everything it
does to obtain, refresh or end a session goes through this file. The most
important finding for the port is this: **a public client cannot hold
`user/` scopes. So a public SPA cannot call the standard REST API
(`/api/...`) at all. It can reach only FHIR, and only for one patient that
the practitioner picks during the OAuth flow.** See "API contract for the
port" and Finding #2.

**Source:** `src/RestControllers/AuthorizationController.php` is 1,916 lines.
The prompt and `PROJECT-MAP.md:73` say 1,772, which is stale. The file has not
changed since the Phase 1 SHA `3ccfe1d`: `git diff --stat 3ccfe1d HEAD -- src
oauth2 templates apis` is empty, and HEAD is `44e237a` on
`agentforge/w2-dashboard`. The file has no version header. Lines 1023-1117 are
marked "AI-GENERATED CODE … 2025-11-14".
I also read these files in full: `src/RestControllers/Subscriber/OAuth2AuthorizationListener.php`
(188 lines), `src/Common/Auth/OpenIDConnect/Grant/CustomAuthCodeGrant.php`,
`CustomRefreshTokenGrant.php`, `Repositories/ClientRepository.php`,
`ScopeRepository.php`, `AuthCodeRepository.php`, `RefreshTokenRepository.php`,
`src/RestControllers/SMART/SMARTAuthorizationController.php`,
`src/Services/TrustedUserService.php`,
`src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php`,
`src/RestControllers/Subscriber/AuthorizationListener.php` and
`templates/oauth2/oauth2-login.html.twig`.
I read these in part: `ServerScopeListEntity.php:40-349`,
`IdTokenSMARTResponse.php:60-206`, `OAuth2DiscoveryController.php`,
`SMARTConfigurationController.php`, `ExceptionHandlerListener.php`,
`HttpRestRouteHandler.php:40-230`, `SessionConfigurationBuilder::forOAuth()`
and `templates/oauth2/scope-authorize.html.twig:283-470`.
For vendor behaviour (league/oauth2-server **8.5.5**, per `composer.lock:5115`)
I read the installed copy in the running `agentforge-week1-openemr-1`
container, read-only: `Grant/AuthCodeGrant.php`, `Grant/AbstractGrant.php`,
`RedirectUriValidators/RedirectUriValidator.php` and
`Exception/OAuthServerException.php`. The vendor directory is not present in
this checkout.
**Audited by:** tier 3 · confidence high · not escalated from a lower tier.

## Purpose & lifecycle

Each request builds a new `AuthorizationController($session, $kernel)`
(`OAuth2AuthorizationListener.php:119`). The constructor (`:168-190`):

- requires `site_id` in the session, which `SiteSetupListener` sets, and
  throws `serverError` if it is missing;
- builds `authBaseUrl` (`<webroot>/oauth2/<site>`) and `authBaseFullUrl`
  (`site_addr_oath` plus that path, `getAuthBaseFullURL()` `:1619-1624`);
- loads `authRequestSerial` from the session;
- loads the key pair through `OAuth2KeyConfig` (`configKeyPairs()` `:224-242`).
  On failure it logs, invalidates the session and throws
  `serverError("Security error - problem with authorization server keys.")`.

`OAuth2AuthorizationListener::authorizeRequest()` (`:93-187`) comes first. It
404s every `/oauth2/*` call when `rest_api`, `rest_fhir_api` and
`rest_portal_api` are all off (`:102-109`). It seeds a CSRF key in the OAuth
session (`:114-116`). Then it dispatches with `str_contains` checks, in this
order. **The order matters: the first match wins.**

| # | Path fragment (listener line) | Method | Session after |
|---|---|---|---|
| 1 | `/token` (`:124`) | `oauthAuthorizeToken()` `:1350` | invalidated |
| 2 | `/.well-known/openid-configuration` (`:129`) | `OAuth2DiscoveryController::getDiscoveryResponse()` | invalidated |
| 3 | `/authorize` (`:139`) | `oauthAuthorizationFlow()` `:555` | kept (flow in progress) / invalidated on error |
| 4 | `/device/code` (`:144`, `DEVICE_CODE_ENDPOINT` `:109`) | `authorizeUser()` `:1198` (consent submit, **not** a device-code grant despite the name) | invalidated |
| 5 | `/jwk` (`:149`) | `OAuth2PublicJsonWebKeyController` | n/a |
| 6 | `/login` (`:154`), which matches `/provider/login` | `userLogin()` `:800` | kept |
| 7 | SMART routes (`:158`): `/smart/patient-select`, `/smart/patient-select-confirm`, `/smart/ehr-launch-autosubmit`, `/smart/smart-style` | `SMARTAuthorizationController::dispatchRoute()` | kept |
| 8 | `/scope-authorize-confirm` (`:162`) | `scopeAuthorizeConfirm()` `:1034` | kept |
| 9 | `/registration` (`:167`) | `clientRegistration()` `:249` | invalidated |
| 10 | `/client` (`:172`) | `clientRegisteredDetails()` `:473` | invalidated |
| 11 | `/logout` (`:177`) | `userSessionLogout()` `:1450` | invalidated |
| 12 | `/introspect` (`:182`) | `tokenIntrospection()` `:1508` → `TokenIntrospectionRestController` | n/a |
| — | anything else | `404`, empty body (`:186`) | |

The OAuth flow for a practitioner who uses a public client with the
`launch/patient` scope. This is the only flow a public SPA can use; see
"API contract".

1. The SPA sends the browser to `GET` (or `POST`, via `convertPostParamsToGet()`
   `:1905-1915`) `/oauth2/default/authorize`. `oauthAuthorizationFlow()`
   validates the request through league plus `CustomAuthCodeGrant`. It stores
   `csrf`=state, `scopes`, `client_id`, `client_role`, `launch`,
   `redirect_uri` and `nonce` in the OAuth session (`:565-591`) and
   serializes the `AuthorizationRequest` into `authRequestSerial`
   (`serializeUserSession()` `:772-794`). It then returns
   **307 → `/oauth2/default/provider/login`** (`:607`).
2. `userLogin()` renders `templates/oauth2/oauth2-login.html.twig`. This is
   **a separate OAuth login page, not the core OpenEMR login screen**.
   Password check, lockout and MFA follow (see `userLogin`).
3. If `launch/patient` was requested and no `puuid` is set yet, the next step
   is 307 → `/smart/patient-select` (`SMARTAuthorizationController::needSMARTAuthorization()`
   `:174-184`), the patient picker. After that it goes to
   `/smart/patient-select-confirm`, then 307 → `/scope-authorize-confirm`.
4. `scopeAuthorizeConfirm()` renders the consent page. The user may untick
   scopes. "Authorize" POSTs to `/device/code`.
5. `authorizeUser()` issues the code, checks CSRF, saves an
   `oauth_trusted_user` row that holds a JSON dump of the OAuth session keyed
   by the code, and returns **302 to `redirect_uri?code=…&state=…`**.
6. The SPA POSTs `/oauth2/default/token`. `oauthAuthorizeToken()` restores
   the saved session **by code** (`:1366-1379`) and league issues the tokens.

## Layout / interface

Public methods (callers: `OAuth2AuthorizationListener` unless noted):

| Signature | Line | Notes |
|---|---|---|
| `__construct(SessionInterface $session, OEHttpKernel $kernel, bool $providerForm = true)` | 168 | `providerForm=false` makes `/authorize` throw `serverError` (`:608-611`). No caller passes false (grep). |
| `clientRegistration(HttpRestRequest): ResponseInterface` | 249 | RFC 7591 dynamic registration |
| `clientRegisteredDetails(HttpRestRequest): ResponseInterface` | 473 | RFC 7592-ish read of a registration |
| `getBearerToken(): string` | 525 | re-reads `$_SERVER` via `ServerRequestCreator::fromGlobals()` |
| `oauthAuthorizationFlow(HttpRestRequest): ResponseInterface` | 555 | `/authorize` |
| `getAuthorizationServer(ScopeRepository, bool $includeAuthGrantRefreshToken = true): AuthorizationServer` | 643 | builds the grant set for `$this->grantType`; no caller outside this file (grep) |
| `userLogin(HttpRestRequest): ResponseInterface` | 800 | `/provider/login` |
| `setUuidUserAccountFactory`, `setClientRepository`, `getClientRepository`, `getScopeRepository`, `getServerConfig`, `setScopeRepository`, `getUuidUserAccount` | 971-1021 | test seams / accessors |
| `scopeAuthorizeConfirm(HttpRestRequest): ResponseInterface` | 1034 | consent page (AI-generated block) |
| `isSMARTAuthorizationEndPoint($end_point): bool`, `dispatchSMARTAuthorizationEndpoint($end_point, HttpRestRequest)` | 1125, 1134 | delegate to `SMARTAuthorizationController` |
| `authorizeUser(HttpRestRequest): ResponseInterface` | 1198 | `/device/code` consent submit |
| `oauthAuthorizeToken(HttpRestRequest): ResponseInterface` | 1350 | `/token` |
| `trustedUser($clientId, $userId)`, `sessionUserByCode($code)`, `saveTrustedUser(...)` | 1420-1443 | thin wrappers over `TrustedUserService` |
| `decodeToken($token)` | 1445 | base64url JSON decode, **no signature check** |
| `userSessionLogout(HttpRestRequest): ResponseInterface` | 1450 | `/logout` (OIDC end-session) |
| `tokenIntrospection(HttpRestRequest): ResponseInterface` | 1508 | `/introspect` |
| `getTokenUrl()`, `getAuthorizeUrl()`, `getRegistrationUrl()`, `getIntrospectionUrl()` (all `@deprecated`), `getManageUrl()`, static `get*Path()`, static `getAuthBaseFullURL()` | 1525-1624 | `/manage` path is defined but has no route in the listener |

Constants: `GRANT_TYPE_ACCESS_TOKEN_TTL='PT1H'` (`:110`),
`GRANT_TYPE_REFRESH_TOKEN_TTL='P3M'` (`:111`),
`GRANT_TYPE_ACCESS_CODE_TTL='PT300S'` (client-credentials access token, `:104`),
`OFFLINE_ACCESS_SCOPE='offline_access'` (`:101`),
`ENDPOINT_SCOPE_AUTHORIZE_CONFIRM` (`:97`), `DEVICE_CODE_ENDPOINT` (`:109`).

## State

```text
authBaseUrl, authBaseFullUrl, siteId   // derived per request from session site_id + globals
privateKey, publicKey, passphrase, oaEncryptionKey  // OAuth2KeyConfig (sites/<site>/documents/certificates)
grantType            // set by /authorize ('authorization_code') or from POST grant_type at /token
authRequestSerial    // JSON of the pending AuthorizationRequest (mirrors session key)
userId               // users.id after verifyLogin(); used for MFA lookup
cryptoGen            // ServiceContainer::getCrypto() – decrypts client_secret
smartAuthController, twig, dsiService, scopeRepository, clientRepository, serverConfig  // lazily built
session              // the OAuth PHP session (cookie 'authserverOpenEMR'); replaced wholesale at /token
```

**OAuth session keys written:** `nonce` (`:566`), `csrf` = the client's `state`
(`:579`), `scopes` (`:580`), `client_id` (`:581`), `client_role` (`:583`, never
read anywhere; grep for `get('client_role')` finds nothing), `launch`, `redirect_uri`
(`:590-591`), `oauth2_in_progress` (`:603`), `authRequestSerial` (`:793`),
`user_id` (a user or patient **uuid**, `:1154`/`:1162`), `pid`, `puuid`
(`:1165-1166`, patient login), `persist_login` (`:921`), `claims` (`:923`),
`puuid` (patient picker, `SMARTAuthorizationController.php:221`).
`csrf_private_key` is seeded by the listener (`:114-116`). The whole session
is replaced from `oauth_trusted_user.session_cache` at `/token` (`:1370`).

**Globals read:** `rest_api`, `rest_fhir_api`, `rest_portal_api` (listener
`:102-104`; `userLogin` `:817`), `site_addr_oath` (`:700-703`, `:1623`),
`OE_SITE_DIR` (`:227`), `oauth_password_grant` (`:736`),
`enforce_signin_email` (`:826`), `oauth_ehr_launch_authorization_flow_skip`
(`:1659`), `oauth_app_manual_approval` (in `ClientRepository::insertNewClient`
`:82`), webroot. **Globals written:** none.

Local dev DB values (read-only SQL, `globals` table): `rest_api`,
`rest_fhir_api`, `rest_portal_api` and `rest_system_scopes_api` = 1,
`oauth_password_grant=3` (password grant on for users and patients),
`oauth_app_manual_approval=0`, `oauth_ehr_launch_authorization_flow_skip=1`,
`site_addr_oath=https://localhost:9300`. `oauth_clients` and
`oauth_trusted_user` both have **0 rows**, so no client is registered yet.

## Logic

### `clientRegistration()` (`:249-432`)

- **Open and unauthenticated.** No initial access token, no admin session and
  no rate limit are checked. The only request checks are these:
  - `Content-Type` must start with `application/json` (`:259-261`);
  - the body must parse (`:262-265`).
- `client_id` is `base64url(random_bytes(32))`, `registration_access_token`
  is 32 random bytes and `registration_client_uri_path` is 16 random bytes
  (`ClientRepository.php:128-131, 280-288`).
- **Public vs confidential** (`:308-330`):
  - `client_role` defaults to `'patient'`.
  - Only `application_type === 'private'` produces a secret (64 random bytes)
    and `client_role='user'`. Any other value, or an absent one, gives a
    **public** client.
  - A private client that asks for `system/` scopes must also send `jwks` or
    `jwks_uri`.
  - **A public client whose `scope` string contains `system/` or `user/` is
    rejected** with `invalid_client_metadata` "system and user scopes are
    only allowed for confidential clients" (`:325-330`).
  - The comment at `:324` also says offline_access is not allowed for public
    apps, **but the code does not block it** (Finding #11).
- **Scope is required in practice.** `validateScopesAgainstServerApprovedScopes()`
  (`:439-454`) explodes `$data->getString('scope')`. An absent scope becomes
  `''`, which fails the `ScopeEntity::createFromString` regex
  (`ScopeEntity.php:64-82`), so the request is rejected with `invalid_scope`.
  Every scope must be in the server list
  (`ServerScopeListEntity::getAllSupportedScopesList()` `:337-348`). The
  default scope in `ClientRepository::insertNewClient()` (`:73`) therefore
  cannot be reached over HTTP.
- **Metadata whitelist** (`:268-295`):
  - `token_endpoint_auth_method` must be one of `client_secret_basic`,
    `client_secret_post` or `private_key_jwt` (`:274`, enforced `:348-351`).
    **`"none"` (the RFC 7591 value for public clients) is rejected** with
    `Unsupported token_endpoint_auth_method value : none`. A public client
    must leave the field out.
  - `subject_type` must be `pairwise` or `public`.
  - Array fields are pipe-joined for storage (`:335-336`).
- `redirect_uris` is required (`:355-357`). The
  `post_logout_redirect_uris` check at `:358` is `has(x) && !has(x)`, which
  is always false, so it is dead.
- **Persistence** (`:362-391`) runs in an explicit transaction. It inserts
  the `oauth_clients` row and, if `dsi_type` is not "none", a DSI service row.
  Rollback happens on any `Throwable`, and the error is wrapped as
  `serverError("Try again. Unable to create account")`.
- **Enablement** is decided in `ClientRepository::insertNewClient()`
  (`:78-88`) by `ScopeRepository::hasScopesThatRequireManualApproval()`
  (`:334-363`):
  - A public client that requests the exact scope `launch` gets
    `is_enabled=0`. `launch/patient` is a different string and does **not**
    trigger this.
  - `oauth_app_manual_approval=1` disables every new client.
  - A confidential client with any `user/` or `system/` scope gets
    `is_enabled=0`.
  - Everything else, including a public SPA client with only `patient/`,
    `openid`, `fhirUser`, `launch/patient`, `offline_access` and `api:*`
    scopes, is **enabled immediately**.
- **Response** (200, `Cache-Control: no-store`): `client_id`, `client_secret`
  (`""` for public clients), `registration_access_token`,
  `registration_client_uri`, `client_id_issued_at`,
  `client_secret_expires_at: 0`, plus every stored metadata field echoed
  back.
- **Errors:** league JSON
  `{"error":"invalid_client_metadata"|"invalid_redirect_uri"|"invalid_scope","error_description":…,"message":…}`
  with the exception's status code. A missing JSON body gives
  `invalid_client_metadata` "No JSON body".

### `clientRegisteredDetails()` (`:473-523`)

- Takes the registration access token from POST `access_token` or from a
  Bearer header. `getBearerToken()` re-reads the headers from PHP globals.
- Finds `oauth_clients` by `registration_uri_path` with raw `sqlQuery`
  (`:491`).
- Compares the token with `!==` (`:495`), which is not constant time.
- Returns `client_id`, **the decrypted `client_secret`** (`:500`),
  `contacts`, `application_type`=`client_role`, `client_name`,
  `redirect_uris` and DSI data.
- The three `$response->withHeader(...)` calls (`:511-513`) throw their
  results away because PSR-7 is immutable. The response that carries the
  secret therefore has **no `Cache-Control: no-store` and no JSON
  content-type** (Finding #13).

### `oauthAuthorizationFlow()` (`:555-631`)

1. POST params are copied into the query string (`:559`, SMART
   `authorize-post`).
2. `nonce` is stored in the session **before** validation (`:565-567`).
3. `getAuthorizationServer()` (see below) and
   `validateAuthorizationRequest()` run the following checks.
   - **`CustomAuthCodeGrant::validateAuthorizationRequest()`** (`:72-124`):
     - If `aud` is present without `launch`, it must be one of the FHIR base
       URL, `<site_addr_oath><webroot>/apis/<site>/api` or `.../portal`
       (`:90-94`, list built at `AuthorizationController.php:703-708`).
     - With `launch`, `aud` is required, and the launch token must
       deserialize (`:100-120`).
     - `validateCodeChallengeMethod()` (`:253-270`): **when `code_challenge`
       is present, the method must be `S256`**. A missing method defaults to
       `plain` and is rejected.
   - **league `AuthCodeGrant::validateAuthorizationRequest()`**
     (vendor `AuthCodeGrant.php:260-345`):
     - `client_id` is required, and the client must exist.
     - `redirect_uri`, if sent, must match a registered URI (see Redirect
       URIs below). If it is not sent, the client must have exactly one.
     - Scopes are validated against the server list.
     - **For a public client with no `code_challenge`, the request fails**
       with `invalid_request` "Code challenge must be provided for public
       clients" (`:339-340`). `$requireCodeChallengeForPublicClients`
       defaults to `true` (`:43`), and OpenEMR never calls
       `disableRequireCodeChallengeForPublicClients()` (grep of `src/`).
     - `state` is optional to league.
   - **`CustomAuthCodeGrant` does not override the vendor redirect check.**
     Its `validateRedirectUri` override (`:126-141`) only logs and rethrows.
   - **`is_enabled` is not checked at `/authorize`.** It is checked only when
     the client is validated at `/token` (`CustomAuthCodeGrant::validateClient()`
     `:235-238`; `CustomRefreshTokenGrant::validateClient()` `:187-190`).
     So a disabled client still gets the full login and consent UI and fails
     only at the token exchange.
4. On success the flow writes the session keys listed above.
   - EHR launch path: if `launch` is present and the skip flag plus the
     per-client flag are on (`shouldSkipAuthorizationFlow()` `:1653-1670`),
     it borrows the **core** OpenEMR session cookie. Details:
     - `getLoggedInCoreUserUuid()` (`:1814-1862`) swaps session IDs to read
       `authUserID`.
     - `processAuthorizeFlowForLaunch()` (`:1680-1740`) then issues a code
       with **all scopes the client registered**, not the ones requested
       (`:1701-1704`), with no login and no consent page.
     - Only EHR launches from inside OpenEMR reach this path.
   - Otherwise it returns 307 → `/provider/login`.
5. **Errors:**
   - `OAuthServerException` makes league return JSON, or a 302 to the
     redirect URI when the exception carries one (e.g. `invalid_scope`),
     after the session is invalidated (`:613-623`).
   - **Any other `Throwable` becomes a 500 whose body is the raw
     `$exception->getMessage()`** (`:624-629`).

### `getAuthorizationServer()` (`:643-765`)

- Builds the `ClaimExtractor` from `ClaimRepository`. It adds a `nonce`
  claim set when the session has a nonce (`:654-656`).
- Builds `IdTokenSMARTResponse` with `SMARTSessionTokenContextBuilder`, and
  calls `markIsAuthorizationGrant()` for authorization codes.
- The `AuthorizationServer` signs tokens with the site key pair
  (`CryptKey($privateKey, $passphrase)`) and uses `oaEncryptionKey` for
  auth-code and refresh-token encryption.
- It enables **only the grant for `$this->grantType`**:
  - `authorization_code`: `CustomAuthCodeGrant`, auth code TTL **PT1M**,
    access token **PT1H**, refresh token **P3M** (`:709-723`).
  - `refresh_token`: `CustomRefreshTokenGrant`, PT1H / P3M (`:725-734`).
  - `password`, only when `oauth_password_grant` is non-empty (`:736-747`).
  - `client_credentials`: PT300S (`:748-761`).
- No implicit or hybrid grant is ever enabled. The discovery document still
  advertises them (Finding #9).

### `userLogin()` (`:800-945`)

- Needs `client_id` in the session. Without it, it renders a generic 500
  page.
- **Page and CSRF.** It renders the OAuth login form. The "Patient Login"
  button only appears when the FHIR or portal API is on (`:817`,
  template `patientRoleSupport`). On a POST that carries `user_role`, it
  verifies the CSRF token for the `oauth2` session (`:842-851`). A POST
  without `user_role` just re-renders the form.
- **Password check.** `verifyLogin()` (`:1139-1171`) calls
  `AuthUtils($type)->confirmPassword()`. `$type` is `api` for users or
  `portal-api` for patients. This is the same password check and
  failed-login/IP lockout that the core login uses (`AuthUtils.php:396`,
  `:1163-1300`). On success it stores the **uuid** as `user_id`, creating
  the uuid if it is missing (`getUserUuid()` `:1173-1193`; this is a write).
  - **Note:** `getUserUuid()` calls `UuidRegistry::createMissingUuidForRow()`,
    so a login can write `users.uuid` or `patient_data.uuid`.
- **MFA** (`:872-916`) applies **only when `user_role === 'api'`** and
  `MfaUtils::isMfaRequired()` is true for that user, i.e. the user has
  TOTP or U2F registered.
  - The MFA step re-renders the form with the username **and the plaintext
    password** in hidden inputs (template `oauth2-login.html.twig`
    `value="{{ user.password|attr }}"`; vars `:827-831`). The next POST
    re-runs `verifyLogin()` and then `MfaUtils::check()`.
  - A failed code is audit-logged through
    `EventAuditLogger::logAuthFailure(AuthEvent::mfa(), …)` (`:903`).
  - Patients never get MFA.
- **Session after success.** Username and password are removed from the
  request (`:918-920`). `persist_login` is stored ("Remember Me"; it is
  **never read anywhere**, Finding #10). `claims` are taken from
  `UserRepository`.
- **Redirect** is 307 to `/smart/patient-select` when `launch/patient` is in
  scope and there is no `puuid`, otherwise to `/scope-authorize-confirm`
  (`:928-944`).
- **The OAuth session ID is not regenerated after authentication** (no
  `migrate()` anywhere in the flow; grep), Finding #12.
- **No SSO.** The OAuth session is separate from the core session
  (cookie `authserverOpenEMR`, path `<webroot>/oauth2/`, `SameSite=None`,
  `Secure`, from `SessionConfigurationBuilder::forOAuth()` `:94-102`). It is
  invalidated at the end of every flow (`authorizeUser` `:1250`, `/token`
  `:1399`). **So every `/authorize` shows a blank login form again, even
  when the user is logged in to OpenEMR or finished another OAuth flow a
  minute earlier.** The EHR-launch skip path is the only exception.

### Patient picker (`SMARTAuthorizationController`)

- `patientSelect()` (`:252-321`):
  - requires the session `user_id`;
  - checks ACL `patients/demo` for that user
    (`PatientContextSearchController::checkUserAccessPatientData()`);
  - searches `fname`, `mname` and `lname` only, and shows at most 100
    patients: uuid, name, email, DOB, sex.
- `patientSelectConfirm()` (`:200-244`):
  - verifies the CSRF token;
  - re-checks ACL through `getPatientForUser()`;
  - sets `puuid`.
- **Errors:** an ACL failure returns an `access_denied` redirect to the
  client's redirect URI **without `state`** (`:227-235`). Other errors
  re-render the picker page.

### `scopeAuthorizeConfirm()` (`:1034-1113`, AI-generated)

- Reads the requested scopes from the session and holds back
  `offline_access`, which is shown separately with an expiry date
  3 months ahead (`:1044-1052`).
- Parses the scopes into a granular tree (`ScopePermissionParser`) and hides
  `openid`.
- Filters the user's claims to the ones that match the scopes, then renders
  `oauth2/scope-authorize.html.twig`.
- On submit, the page's JavaScript rebuilds `scope[...]` inputs from the
  checkboxes and adds `proceed=1` (template `:440-462`). **The user can drop
  scopes or narrow them to granular `?category=` variants.**
- **"Cancel" is `window.history.back()`** (template `:298`). It does not
  return `error=access_denied` to the client, so the SPA never gets a
  callback (Finding #16).

### `authorizeUser()` (`:1198-1259`)

1. `deserializeUserSession()` (`:1312-1345`) rebuilds the request. On any
   `Throwable` it runs **`echo $e`** (`:1340-1342`), which prints the
   exception and its stack trace into the response. In practice the setters
   are untyped, so null input mostly produces warnings rather than
   exceptions, and this line is hard to reach. It is still a defect
   (Finding #6).
2. `updateAuthRequestWithUserApprovedScopes()` (`:1274-1310`) keeps each
   POSTed `scope[]` value only if it is contained in the originally
   requested scopes.
3. It builds the server with
   `includeAuthGrantRefreshToken = (offline_access approved)`, sets the user,
   approves, and calls `completeAuthorizationRequest()`. That builds the 302
   Location with `code` and `state`.
4. **It keeps `csrf_private_key` out of the stored session**
   (`:1216-1220`) and then JSON-encodes the rest of the session.
5. It checks CSRF **only when `proceed` is posted** (`:1226-1242`).
   - If CSRF passes, it saves `oauth_trusted_user(client_id, user_id,
     scopes, persist_login, code, session_cache)`. There is one row per
     (client, user), and a second login **overwrites** it
     (`TrustedUserService::saveTrustedUser()` `:57-75`).
   - Without `proceed`, the code is still returned but no trusted-user row is
     written. That code then fails at `/token` because no session is found
     by code.
6. It invalidates the session and returns the 302.
   - **Any `Throwable` gives a 500 with `$exception->getMessage()` as the
     body** (`:1252-1257`).

### `oauthAuthorizeToken()` (`:1350-1418`)

- `OPTIONS` returns 200 (`:1355-1358`).
- `grant_type` is read from the parsed body. **The request must be
  `application/x-www-form-urlencoded`.**
- For `authorization_code`:
  - It loads `oauth_trusted_user` **by the encrypted code string**
    (`TrustedUserService::getTrustedUserByCode()`) and replaces the whole
    session with `session_cache` (`:1366-1379`).
  - **If the restored session has no `csrf` (the client's `state`), it
    returns `400 invalid_request "Bad request"`** (`:1388-1392`). **So
    `state` is effectively mandatory. A client that omits it (RFC 6749
    allows this) can never redeem its code** (Finding #17).
- For `refresh_token`, the league request is rebuilt from globals (`:1382-1384`).
- `respondToAccessTokenRequest()` then runs the following checks.
  - **Code checks** (vendor `AuthCodeGrant.php:95-195, 203-234`):
    - client id;
    - client authentication, only if the client is confidential (see
      Finding #1);
    - code decrypt;
    - `expire_time` (1 minute);
    - `isAuthCodeRevoked()`. **This is always `false`:
      `AuthCodeRepository` is a stub** (`AuthCodeRepository.php:20-33`),
      so codes are replayable within 60 s (Finding #5);
    - the code's `client_id`;
    - `redirect_uri` must equal what `/authorize` received.
  - **Scope and PKCE:**
    - `finalizeScopes()` (`ScopeRepository.php:137-188`) **silently
      intersects the scopes with the client's registered scopes** and adds a
      synthetic `nonce` scope when the session has one;
    - the PKCE `code_verifier` is verified against S256 when the code
      carries a challenge.
- The response is `IdTokenSMARTResponse`; field list under "API contract".
  - **A refresh token is returned only if `offline_access` was granted**
    (`IdTokenSMARTResponse.php:81-95`).
  - The `/token` server is always built with
    `includeAuthGrantRefreshToken=true` (`:1386`, default argument), so
    `api_refresh_token` rows are still **persisted** for tokens that are
    never delivered (Finding #15).
- **Errors:** `OAuthServerException` gives the league JSON with its status
  code. **Any other `Throwable` gives a 500 with the raw message**
  (`:1408-1416`).

### `userSessionLogout()` (`:1450-1506`)

This is `GET /oauth2/default/logout`, which discovery advertises as
`end_session_endpoint` (`OAuth2DiscoveryController.php:73`). Only the query
string is read.

1. `id_token_hint` is required. Without it the response is
   `400 invalid_request`.
2. The id_token payload is **base64-decoded without any signature
   verification** (`decodeToken()` `:1445-1448`). `aud` is taken as
   `client_id`, `sub` as the user uuid, and `nonce` is read.
3. If no `oauth_trusted_user` row matches (aud, sub):
   - **with `post_logout_redirect_uri` present, it returns 307 to that URL
     with no validation at all** (`:1469-1475`), an open redirect
     (Finding #3);
   - without it, it throws `HttpException(401, "You are currently not
     signed in.")`, which `ExceptionHandlerListener` turns into JSON
     `{"error":"An error occurred","message":"You are currently not signed
     in.","code":0}`.
4. The token's `nonce` is compared with the `nonce` inside the stored
   `session_cache` (`:1481-1485`). **If the client never sent a nonce, both
   are `''` and the check passes**, so a forged, unsigned id_token that
   names a client_id and user uuid can log that user out (Finding #4).
5. **It deletes the trusted-user row** (`:1487`). This is the actual
   "logout". `BearerTokenAuthorizationStrategy::authorizeRequest()`
   (`:168-178`) rejects **every** access token of that (client, user) pair
   once the row is gone, with `400 invalid_request "Refresh Token revoked or
   logged out"`.
   - Access-token rows and refresh-token rows are **not** revoked.
   - Refresh still mints access tokens, but those are unusable until a new
     login recreates the row.
   - **Once the row is recreated, old unexpired access tokens and refresh
     tokens work again** (Finding #7).
6. It redirects to `post_logout_redirect_uri?state=<state>` only if the URI
   **exactly equals the whole stored `logout_redirect_uris` column**
   (`:1488-1492`).
   - That column is pipe-joined, so a client that registered two logout URIs
     can never match (Finding #8).
   - `state` is concatenated without URL-encoding.
   - Otherwise it returns 200 `text/plain` "You have been signed out. Thank
     you." (`:1494-1499`). Note that `xlt()` HTML-escapes, so the plain-text
     body may contain entities.
7. Only the OAuth PHP session is invalidated. The core OpenEMR session, if
   any, is untouched. Since there is no OAuth SSO session (see `userLogin`),
   nothing else remains to end.

### Discovery documents (context for the SPA)

`/oauth2/default/.well-known/openid-configuration`
(`OAuth2DiscoveryController.php:43-127`) and
`/apis/default/fhir/.well-known/smart-configuration`
(`SMARTConfigurationController.php:45-107`) disagree with each other and
with the code:

- **PKCE `plain`:** the OIDC doc advertises it (`:85-88`), but
  `CustomAuthCodeGrant` rejects it.
- **`userinfo_endpoint`:** advertised at `:71`, but no listener branch
  matches `/userinfo`, so it returns 404.
- **Response types and modes:** the OIDC doc lists implicit/hybrid
  response types and `fragment` and `form_post` response modes. None are
  implemented.
- **`token_endpoint_auth_methods_supported`:** the OIDC doc says
  `client_secret_post` only, the SMART doc says `client_secret_basic` and
  `private_key_jwt`, and neither says `none`.
- **Revocation:** SMART comments out `revocation_endpoint` (`:99-103`).
- **SMART capabilities:** they include `client-public`, `launch-standalone`,
  `context-standalone-patient`, `permission-v1`, `permission-v2`,
  `permission-offline` and `authorize-post` (`Capability.php:27-52`).
- **The SPA should hardcode S256 and ignore `userinfo_endpoint`.**

## Permission checks

| Operation | Check present? | How | Notes |
|---|---|---|---|
| Any `/oauth2/*` | yes | `rest_api`, `rest_fhir_api` or `rest_portal_api` must be on (listener `:102-109`) | 404 JSON otherwise |
| Register a client | **missing (by design)** | none | open, unauthenticated; ONC information-blocking rationale in `ScopeRepository.php:352-359` |
| Read registration (`/client/...`) | yes | registration access token equality (`:495`) | non-constant-time compare; returns decrypted secret |
| `/authorize` | partial | client exists, redirect URI, scopes ⊆ server list, PKCE for public clients | **`is_enabled` not checked until `/token`** |
| Login | yes | `AuthUtils::confirmPassword` + CSRF (`:843`) + lockouts + MFA (users only) | MFA page echoes the password |
| Patient picker | yes | ACL `patients/demo` for the logged-in user (`PatientContextSearchController`) + CSRF on confirm | |
| Consent submit | yes, conditional | CSRF only when `proceed` posted (`:1226-1229`) | code without `proceed` is unusable |
| `/token` (auth code) | **partial** | code decrypt/expiry/client/redirect_uri + PKCE + `is_enabled`; **confidential secret only checked if sent** (Finding #1); code not single-use (Finding #5) | |
| `/token` (refresh) | **partial** | refresh-token decrypt/expiry/revocation, `is_enabled`; **client secret never required** (`ClientRepository.php:218-221`) | rotation: old refresh + access token revoked (vendor `RefreshTokenGrant.php:67-78`) |
| `/logout` | **weak** | trusted-user lookup + nonce equality; **no id_token signature check**; open redirect when no row | |
| Resource calls after logout | yes | `isTrustedUser(client, user)` on every bearer request (`BearerTokenAuthorizationStrategy.php:169`) | this is what makes logout effective |

## Data touches

| Table / entity | Read | Write | Where (function) | Transactional? |
|---|---|---|---|---|
| `oauth_clients` | ✓ | ✓ INSERT | `clientRegistration` → `ClientRepository::insertNewClient`; reads in `getClientEntity`, `validateClient`, `clientRegisteredDetails` (`:491`), `userSessionLogout` (`:1488`) | INSERT yes (`:364-391`) |
| DSI service tables | | ✓ | `createDecisionSupportInterventionServiceForType` (`:1770-1792`) | same transaction |
| `oauth_trusted_user` | ✓ | ✓ INSERT/UPDATE, DELETE | `authorizeUser`, `processAuthorizeFlowForLaunch`, `saveTrustedUserForPasswordGrant`; read by `/token` (by code), `/logout`, every bearer request; DELETE in `/logout` | no |
| `api_token` | ✓ | ✓ | `AccessTokenRepository` via league at `/token` | no |
| `api_refresh_token` | ✓ | ✓ INSERT, UPDATE revoked | `RefreshTokenRepository` at `/token` (always persisted for auth code, Finding #15) and on refresh | no |
| `users` / `patient_data` (`uuid`) | ✓ | ✓ (missing uuid) | `getUserUuid` → `UuidRegistry::createMissingUuidForRow` (`:1180`, `:1184`) | no |
| `users_secure`, `ip_tracking` | ✓ | ✓ counters | `AuthUtils::confirmPassword` | no |
| `log` (audit) | | ✓ | MFA failure (`:903`); bearer "API success/failure" events | no |
| `globals` | ✓ | | constructor, grants, discovery | n/a |
| OAuth PHP session | ✓ | ✓ | throughout; serialized into `oauth_trusted_user.session_cache` | n/a |

## Cross-links

- **Opened by:** `oauth2/authorize.php` → `ApiApplication::run()` (`ApiApplication.php:71-136`) → `OAuth2AuthorizationListener::authorizeRequest()` (`:93-187`).
- **Calls into:** league `AuthorizationServer`/`AuthCodeGrant`/`RefreshTokenGrant` 8.5.5; `CustomAuthCodeGrant`, `CustomRefreshTokenGrant`, `CustomPasswordGrant`, `CustomClientCredentialsGrant`; `ClientRepository`, `ScopeRepository`, `AuthCodeRepository` (stub), `RefreshTokenRepository`, `AccessTokenRepository`, `UserRepository`, `ClaimRepository`; `IdTokenSMARTResponse` + `SMARTSessionTokenContextBuilder`; `SMARTAuthorizationController` + `PatientContextSearchController`; `TrustedUserService`; `AuthUtils`, `MfaUtils`; `TokenIntrospectionRestController`; `DecisionSupportInterventionService`.
- **Consumed by (tokens):** `BearerTokenAuthorizationStrategy` → `AuthorizationListener::onRestApiSecurityCheck()` → every `/apis/<site>/{fhir,api,portal}` route. The data-route contracts are in `api/CLINICAL-CARDS.md`, `modules/PATIENT-SERVICES.md`, `modules/ALLERGY-SERVICES.md` and `modules/CARE-TEAM-SERVICES.md`.
- **Admin side:** `interface/smart/admin-client.php` → `src/FHIR/SMART/ClientAdminController.php`. It can enable or disable clients, toggle skip-EHR-flow, and revoke trusted users, access tokens and refresh tokens. **It cannot edit a client's scopes.** No `UPDATE oauth_clients SET scope` exists in `src/`, `interface/` or `library/`.
- **CLI:** `src/Common/Command/RegisterApiTestClientCommand.php:60-92` registers a *confidential* test client with every scope and enables it. It bypasses the public-client scope restriction only because it creates a confidential client.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Security | **High (verified)** | Confidential clients are not authenticated at `/token` when `client_secret` is **omitted**. `ClientRepository::validateClient()` compares the secret only `if (!empty($clientSecret) && …)` and otherwise returns `true`. For `refresh_token` it always returns `true`. league's `getClientCredentials()` does not require a secret. Anyone holding a confidential client's auth code (PKCE is optional for confidential clients) or refresh token can redeem it with just the public `client_id`. A wrong secret is rejected; only an absent secret passes. | `ClientRepository.php:185-221`; vendor `AuthCodeGrant.php:100-107`, `AbstractGrant.php:192-199, 253-270` | Require and verify the secret (or a JWT assertion) whenever `is_confidential=1`, for every grant. |
| 2 | Design constraint (port blocker) | **High (verified)** | Registration refuses `user/` and `system/` scopes for public clients. The standard REST API needs `api:oemr`, role `users` **and** a `user/<resource>` scope (`BearerTokenAuthorizationStrategy.php:373`; `AuthorizationListener.php:171-174, 186-193`). **A public SPA therefore cannot call `/api/patient/:puuid/{medical_problem,allergy,medication}`, `/api/patient/:puuid` or `/api/prescription`.** It gets FHIR only, and only with `patient/` scopes plus `launch/patient`, so each token is bound to **one** patient picked inside the OAuth flow. Switching patients means a full new authorization with password (and MFA) again, because there is no OAuth SSO session. | `AuthorizationController.php:324-330`; `SMARTAuthorizationController.php:174-184`; `HttpRestRouteHandler.php:63-67` | Decide the client model before building: FHIR-only public client (accept the DB-05/DB-06 gaps), or a confidential client behind a BFF (breaks "tokens in memory, public client"). Record this as an A-series assumption. |
| 3 | Security | Medium (verified) | Open redirect at `/logout`. When no trusted-user row matches (for example a garbage `id_token_hint`), the endpoint 307-redirects to any `post_logout_redirect_uri` without checking it against the client. `state` is appended unencoded. | `userSessionLogout` (`AuthorizationController.php:1469-1475`) | Validate against the client's registered logout URIs before any redirect; URL-encode `state`. |
| 4 | Security | Medium | `id_token_hint` is never signature-verified. The only proof is `nonce` equality, which is `'' === ''` when the client used no nonce. Anyone who knows a client_id and a user uuid can force-logout that user (DoS). | `decodeToken` `:1445-1448`; `:1462-1487` | Verify the JWS against the server key and check `iss`/`aud`/`exp`. **SPA: always send `nonce`.** |
| 5 | Security | Medium | Authorization codes are not single-use. `AuthCodeRepository` persists nothing and `isAuthCodeRevoked()` always returns `false`. The `oauth_trusted_user.code` row is never cleared, so a code can be exchanged repeatedly within its 60 s TTL, minting several token sets. | `AuthCodeRepository.php:20-33`; `:1366-1370` | Persist codes and revoke on use. PKCE (public) limits exploitation to holders of the verifier. |
| 6 | Security | Medium | Raw exception text reaches the browser: 500 bodies built from `$exception->getMessage()` in `/authorize`, `/device/code` and `/token`; `echo $e` (with stack trace) in `deserializeUserSession`; and `ExceptionHandlerListener` echoes `message` for every uncaught exception. | `:624-629`, `:1252-1257`, `:1408-1416`, `:1340-1342`; `ExceptionHandlerListener.php:50-55` | Log the exception and return a generic OAuth `server_error`. |
| 7 | Security / Half-implemented | Medium | "Logout" deletes the (client, user) trusted-user row but revokes no tokens. After the user logs in again, every earlier unexpired access token and refresh token (possibly leaked) becomes valid again. Because the row is per (client, user), logging out on one device also kills all other devices, and logging in on one device silently re-enables tokens elsewhere. | `:1487`; `TrustedUserService.php:57-75`; `BearerTokenAuthorizationStrategy.php:168-178` | Revoke `api_token` and `api_refresh_token` rows for the pair on logout. |
| 8 | Bug | Low | The logout redirect check is `logout_redirect_uris = ?` against the pipe-joined column, so clients with more than one registered logout URI never get redirected. The registration-time check for `post_logout_redirect_uris` (`has && !has`) is dead. | `:1488`, `:358` | Split and compare per URI. **SPA: register exactly one.** |
| 9 | Smell | Low | The discovery documents advertise unsupported features: `plain` PKCE, `userinfo_endpoint`, implicit and hybrid response types, `fragment` and `form_post` modes, and contradictory `token_endpoint_auth_methods_supported`. The SPA library may auto-configure from them. | `OAuth2DiscoveryController.php:66-110`; `SMARTConfigurationController.php:81-103` | Generate the documents from the enabled grants. **SPA: pin config.** |
| 10 | Dead code | Low | The "Remember Me" checkbox (`persist_login`) is stored in the session and in `oauth_trusted_user` but never read. `client_role` in the session is never read either. The `/manage` path has no route. | `:921`, `:583`, `:1543-1555`; `TrustedUserService.php:67` | Remove it, or implement it. |
| 11 | Smell | Low | The comment says public apps may not have `offline_access`, but the code allows it. A public SPA can obtain a 3-month refresh token that rotates on each use. | `:324-330`; `IdTokenSMARTResponse.php:81-84` | **SPA: do not request `offline_access`** (tokens stay in memory, so a refresh token adds exposure without benefit across reloads). |
| 12 | Security | Low | The OAuth session ID is not regenerated after login, which leaves it open to session fixation. The cookie is `HttpOnly`, `Secure`, `SameSite=None` and scoped to `/oauth2/`. | `userLogin` `:918-944`; `SessionConfigurationBuilder.php:94-102` | Call `$session->migrate(true)` after `verifyLogin`. |
| 13 | Bug | Low | `clientRegisteredDetails` discards its `withHeader()` results, so a response carrying the decrypted `client_secret` has no `Cache-Control: no-store` or JSON content-type. The registration token is compared with `!==`. | `:495`, `:500`, `:511-513` | Reassign the response; use `hash_equals`. |
| 14 | Security (logging) | Low | Debug logs record the full OAuth session (nonce, state, scopes, user uuid) and the user's claims (name, email and similar). `verifyLogin` logs usernames and emails. | `:592`, `:933-942`, `:1145-1156`, `:1375-1378` | Log keys only. |
| 15 | Smell | Low | `/token` always builds the auth-code grant with `includeAuthGrantRefreshToken=true`, so `api_refresh_token` rows are persisted even when `offline_access` was not granted and the token is stripped from the response. | `:1386` vs `:1204-1205`; `IdTokenSMARTResponse.php:81-95` | Pass the offline decision to `/token`. |
| 16 | Half-implemented | Low | Consent "Cancel" is `history.back()`, not an `access_denied` redirect. The patient-picker `access_denied` redirect omits `state`. | `scope-authorize.html.twig:298`; `SMARTAuthorizationController.php:227-235` | Redirect with `error=access_denied&state=`. |
| 17 | Bug | Low | `state` is effectively required. If the client sends none, `csrf` is empty in the stored session and `/token` answers `400 "Bad request"`. `is_enabled` is enforced only at `/token`, so a disabled client goes through login and consent before failing. | `:579`, `:1388-1392`; `CustomAuthCodeGrant.php:235-238` | Check `is_enabled` in `/authorize`; don't key CSRF on `state`. **SPA: always send `state`.** |
| 18 | Security (policy) | Low | Registration is unauthenticated and unthrottled, and public `patient/`-scope clients are auto-enabled. Anyone can create enabled client rows. This follows ONC policy per the in-code comment. | `:249-432`; `ScopeRepository.php:341-362` | Rate-limit; optionally set `oauth_app_manual_approval=1` locally. |

Findings #1-#3 were re-read at the cited lines after drafting. #1 and #2 are
High and marked `(verified)`. #3 is verified but kept at Medium because it is
an open redirect only. It needs no authentication, and it makes phishing
pages hosted on the EHR's own origin easy to create.

## API contract for the port

This module serves the **auth** endpoints the SPA calls. It serves no data
routes. The data routes' params and fields are in `api/CLINICAL-CARDS.md` and
the sibling `modules/*.md`. What this module decides for them is **which
routes a public client can reach at all.**

### Registration (one-time setup, A5 "config, not backend change")

`POST https://localhost:9300/oauth2/default/registration`,
`Content-Type: application/json`:

```json
{
  "application_type": "web",
  "client_name": "AgentForge Dashboard",
  "redirect_uris": ["https://<spa-origin>/callback"],
  "post_logout_redirect_uris": ["https://<spa-origin>/"],
  "scope": "openid fhirUser launch/patient api:fhir patient/Patient.rs patient/AllergyIntolerance.rs patient/Condition.rs patient/MedicationRequest.rs patient/CareTeam.rs patient/Observation.rs",
  "contacts": ["dev@example.invalid"]
}
```

- **Do not send `token_endpoint_auth_method`.** `"none"` is rejected
  (`:274`, `:348-351`).
- **Do not send `application_type: "private"`.** That creates a confidential
  client and requires a secret.
- **Do not include `user/…` or `system/…` scopes.** They are rejected
  (`:325-330`).
- `scope` and `redirect_uris` are required.
- The client is **enabled automatically**. It is public with no bare
  `launch` scope, and the local global is `oauth_app_manual_approval=0`.
- Keep `registration_access_token` if the setup script needs to read the
  registration back.
- **Redirect URIs match exactly:** scheme, host, port, path and query
  (`RedirectUriValidator::matchExactUri`). The one exception is
  `http://127.0.0.1:*` and `http://[::1]:*` loopback URIs, which match on
  anything but the port. `http://localhost:5173` is **not** treated as
  loopback, so the port must match. Register one post-logout URI (Finding
  #8).
- **SMART v1 vs v2 syntax:** both are accepted wherever the server list has
  them. v1 `patient/X.read` maps to `r`+`s`, and the route check asks for
  `.r` (instance) or `.s` (search) (`HttpRestRouteHandler.php:198-205`).
  - All six resources exist in both lists: v1 at
    `ServerScopeListEntity.php:75-117`, v2 at `:136-169`.
  - Granular v2 variants exist for `Condition` (problem-list-item,
    encounter-diagnosis, health-concern) and `Observation` (vital-signs,
    laboratory, …) (`:175-199`).
  - Pick one syntax and use the identical strings on refresh (the
    exact-match comment in `CustomRefreshTokenGrant.php:128-131`).
  - The registered scope set is an upper bound. Anything requested beyond it
    is **silently dropped** at `/token` (`finalizeScopes`).
  - `api:fhir` is not enforced for `/fhir/` routes. It is harmless and
    conventional.

### Authorize (browser redirect)

`GET /oauth2/default/authorize` with these parameters:

- `response_type=code`
- `client_id`
- `redirect_uri` (send it; it must also be repeated at `/token`)
- `scope`
- `state` (**required in practice**, Finding #17)
- `nonce` (**send it**; it hardens `/logout`, Finding #4)
- `code_challenge` with `code_challenge_method=S256` (**required for
  public clients**; `plain` is rejected)
- `aud=https://localhost:9300/apis/default/fhir` (optional without
  `launch`, but it must match if sent)

The UI the user then sees:

1. The **OAuth2 login page**, not the core login. The user presses "OpenEMR
   Login" (`user_role=api`). TOTP or U2F is prompted if the user has
   registered MFA.
2. The **SMART patient picker**. It requires ACL `patients/demo` and
   searches first, middle and last name, 100 results at most.
3. The **consent page**. The user can deselect or narrow scopes.

**Success:** `302 <redirect_uri>?code=<~encrypted>&state=<state>`.

**Errors:**
- JSON `{"error","error_description","hint","message"}` with status
  400, 401 or 500. `invalid_client` for a bad client_id or redirect_uri is
  **not** redirected.
- Or `302 <redirect_uri>?error=…` for errors that carry a redirect URI.
  Patient-picker `access_denied` redirects omit `state`.
- Or a **500 with a raw exception message as a plain body** (Finding #6).
- Cancel produces **no callback** (Finding #16).

### Token

`POST /oauth2/default/token`, `application/x-www-form-urlencoded`:
`grant_type=authorization_code&code=…&redirect_uri=…&client_id=…&code_verifier=…`.
This is a simple CORS request (no preflight). `CORSListener` reflects the
`Origin`; see `api/AUTH-AND-PATIENT.md` §1.5. The code expires in **60 s**.

The 200 response contains:

| Field | Notes |
|---|---|
| `token_type` | `Bearer` |
| `expires_in` | `3600` |
| `access_token` | RS256 JWT |
| `id_token` | when `openid` granted; claims include `iss`, `aud`=client_id, `sub`=user uuid, `nonce`, `fhirUser` when that scope is granted |
| `scope` | **the granted scopes, with `api:*` removed** (`IdTokenSMARTResponse.php:142-157`) |
| `patient` | the picked patient's uuid; use it as the FHIR `Patient/{id}` |
| `need_patient_banner` | `true` |
| `smart_style_url` | |
| `refresh_token` | **only if `offline_access` was granted** |

Validate the `id_token` against `/oauth2/default/jwk`.

**Errors:** league JSON, e.g. `invalid_request` (`code`, `redirect_uri`,
`code_verifier`), `invalid_grant` ("Failed to verify `code_verifier`"),
`invalid_client` (disabled or unknown client), or
`400 {"error":"invalid_request","error_description":"Bad request"}` for a
code with no stored session (no `state`, or no consent `proceed`).

### Refresh (only if `offline_access`; not recommended)

`grant_type=refresh_token&refresh_token=…&client_id=…` (plus identical
`scope` if sent). The response carries a new access token (PT1H) and a new
refresh token (P3M), and the old pair is revoked. Context (`patient`) is
carried over from the old access token (`CustomRefreshTokenGrant.php:85-100`).

### Logout (DB-01 "logout ends the session")

`GET /oauth2/default/logout?id_token_hint=<id_token>&post_logout_redirect_uri=<exact registered URI>&state=<s>`
as a top-level navigation. On success it deletes the trusted-user row, and
from then on **every** access token for that client and user gets
`400 {"error":"invalid_request","error_description":"Refresh Token revoked or logged out"}`
from the resource server. It then redirects to the URI with `?state=`, or
shows a 200 text page if the URI did not match exactly.

A spec-complete logout for the SPA therefore means:

1. discard the in-memory tokens;
2. navigate to the `end_session_endpoint` with the id_token (so `openid`
   is required);
3. accept that nothing is revoked (Finding #7).

There is no `/revoke` endpoint, and no OpenEMR SSO session exists to end.

### Reachability of the planned card sources for a **public** client

| Card / header | Planned source (`api/CLINICAL-CARDS.md`, `REQUIREMENTS-TRACE.md`) | Reachable by public SPA? | Scope |
|---|---|---|---|
| Header (DB-02) | `/fhir/Patient/:uuid` or `/api/patient/:puuid` | FHIR only | `patient/Patient.rs` (+ `launch/patient`) |
| Allergies (DB-03) | FHIR `AllergyIntolerance` / `/api/patient/:puuid/allergy` | FHIR only | `patient/AllergyIntolerance.rs` |
| Medical problems (DB-04) | `/api/patient/:puuid/medical_problem` or FHIR `Condition` | FHIR only (different server filter; see CLINICAL-CARDS) | `patient/Condition.rs` |
| Medications (DB-05) | `/api/patient/:pid/medication` (the only path that separates `lists` meds from prescriptions) | **Not available via API for a public client.** FHIR `MedicationRequest` only, mixed with prescriptions | `patient/MedicationRequest.rs` |
| Prescriptions (DB-06) | `/api/prescription` with `source_table=prescriptions` | **Not available via API for a public client.** FHIR `MedicationRequest` only | `patient/MedicationRequest.rs` |
| Care team (DB-07) | FHIR `CareTeam` | yes | `patient/CareTeam.rs` |
| Vitals (parity item) | FHIR `Observation` vital-signs | yes | `patient/Observation.rs` (or `…?category=…vital-signs`) |

Standard REST routes, for reference. They need a confidential client with `user/` scopes:

| Standard REST route | Route scope | ACL (user-context only) |
|---|---|---|
| `/api/patient/:puuid` | `user/patient.rs` + `api:oemr` | `patients/demo` |
| `/api/patient/:puuid/medical_problem` | `user/medical_problem.rs` + `api:oemr` | `patients/med` |
| `/api/patient/:puuid/allergy` | `user/allergy.rs` + `api:oemr` | `patients/med` |
| `/api/patient/:pid/medication` | `user/medication.rs` + `api:oemr` | `patients/med` |
| `/api/prescription` | `user/prescription.rs` + `api:oemr` | `patients/med` |

For a `patient/`-context FHIR token the ACL step does not run. The patient
bind replaces it (`api/AUTH-AND-PATIENT.md` §3.2).
`BearerTokenAuthorizationStrategy::checkUserHasAccessToPatient()` always
returns `true` (`:479-485`). The only per-user patient gate is therefore the
picker's `patients/demo` ACL check at selection time.

**Phase 2 parity decisions, from the auth side:**

- **Prescriptions ALL rows:** implementable only through FHIR
  `MedicationRequest`, which needs row separation from `lists` medications.
  See CLINICAL-CARDS. It is **not implementable via `/api/prescription`
  with a public client.**
- **Vitals, correct latest non-deleted set:** reachable, via
  `patient/Observation.rs`.
- **Allergies highlight-only:** reachable.
- **"Nothing Recorded":** client-side; unaffected by auth.
- **squad / hide_dashboard_cards gaps:** unaffected by auth.
- **New constraint:** the dashboard shows **one patient per authorization**.
  Changing patients means re-running the OAuth flow, including the password.

## Corrections to Phase 1 (`api/AUTH-AND-PATIENT.md`)

1. **§1.2, public vs confidential.** The doc says both types are supported
   and chosen by `application_type`. That is correct but misses the key
   limit: **public clients are forbidden `user/` and `system/` scopes at
   registration** (`AuthorizationController.php:325-330`). Combined with
   `BearerTokenAuthorizationStrategy.php:373` and
   `AuthorizationListener.php:171-174`, this means **a public client can
   never call the standard REST API**, so DB-05 and DB-06 as planned in
   `REQUIREMENTS-TRACE.md:30-31` are not reachable. It also misses that
   `client_role` has no enforcement effect: it is stored and put in the
   session but never read.
2. **§1.2, PKCE.** The doc's statement is confirmed, with detail. league
   8.5.5 `AuthCodeGrant.php:43, 339-340` requires `code_challenge` for
   public clients, and OpenEMR never disables that. Additions:
   - **PKCE is optional for confidential clients.**
   - S256 is enforced only when a challenge is sent
     (`CustomAuthCodeGrant.php:256-269`).
   - The OIDC discovery document wrongly advertises `plain`.
   - Also missing from §1.2: **confidential client secrets are not
     enforced when omitted** (Finding #1).
3. **§1.3, registration.** Confirmed as self-service and auto-enabled for
   public `patient/`-only clients. Additions:
   - `token_endpoint_auth_method: "none"` is **rejected**, so omit it;
   - `scope` and `redirect_uris` are required in practice;
   - `launch/patient` does **not** trigger manual approval, only the exact
     `launch` scope does;
   - `is_enabled` is checked only at `/token`, not `/authorize`.
4. **§1.6, token lifetimes.** The TTL values are correct. Corrections:
   - **A refresh token is issued to the client only when `offline_access`
     is granted** (`IdTokenSMARTResponse.php:81-95`), though a row is
     persisted either way;
   - refresh tokens rotate, and the old pair is revoked;
   - auth codes are **not single-use** (stub repository).
5. **§1.1 endpoint table and §4 "no revoke → unclear what logout means".**
   The table omits the UI endpoints: `/provider/login`, `/smart/*`,
   `/scope-authorize-confirm` and `/device/code`. `/device/code` is the
   consent submit, not a device grant. Also omitted: first-match
   `str_contains` ordering, and the fact that the advertised `/userinfo` is
   404.
   **More importantly, logout does end API access server-side.**
   `/logout` deletes `oauth_trusted_user`, and every bearer request checks
   that row (`BearerTokenAuthorizationStrategy.php:168-178`). So
   DB-01's "logout ends the session" is implementable with the existing
   `end_session_endpoint`, not only by discarding tokens on the client.
   Caveats are in Findings #3, #4, #7 and #8.
6. **§1.5, CORS.** "No separate CORS configuration step is needed" is right
   for `/token`, which the SPA POSTs as a simple form request. `/authorize`
   and `/logout` are top-level navigations and need no CORS. The OAuth
   cookie is `SameSite=None; Secure`, so **run the auth flow over HTTPS**
   (`https://localhost:9300`, which matches `site_addr_oath`).
7. **§3.3, "`/oauth2/*` … none touch PHI services".** Inaccurate:
   `/smart/patient-select` returns patient uuid, name, DOB, sex and email
   (`PatientContextSearchController::searchPatients()`). It is only
   reachable after login in the OAuth session and with ACL `patients/demo`,
   so the doc's conclusion "no *unauthenticated* PHI route" still holds.
8. **§1.4, globals.** Add `oauth_ehr_launch_authorization_flow_skip`, which
   gates the no-login EHR-launch path (`:1659`). Local dev has
   `oauth_password_grant=3`, i.e. the password grant is enabled; the SPA
   must not use it.
9. **Line counts.** `PROJECT-MAP.md:73` says 1,772 lines; the file has
   1,916. Phase 1's line citations into this file were spot-checked
   (`:249`, `:473`, `:555`, `:643-765`, `:1350`, `:1450`, `:1508`) and are
   still accurate.

## Port notes

- **Must survive:**
  - **Authorization code with S256 PKCE.** The SPA sends `state`, `nonce`
    and `aud`.
  - **Exact redirect-URI registration.** One callback and one post-logout
    URI.
  - **Tokens only in memory.** Discard them on logout, then navigate to
    `/oauth2/default/logout` with `id_token_hint`.
  - **Read the granted scopes.** Take the `scope` field from the token
    response, because the user may have narrowed the consent. Degrade each
    card to "not authorized" rather than error.
  - **Bind to the token's patient.** Use the `patient` field from the token
    response as the only patient id. Show a banner (`need_patient_banner`).
  - **Handle "no callback".** The user may abandon at Cancel.
  - **Handle short access tokens.** They expire after 1 h. Without
    `offline_access`, re-run `/authorize`, which means a new password entry.
- **Must not survive / must not depend on:**
  - the confidential-secret bypass (Finding #1). Never ship a
    "confidential" `client_id` in the SPA hoping the secret is optional;
  - `offline_access` in a browser;
  - the password grant (enabled locally);
  - the discovery document's `plain` / `userinfo` / implicit claims;
  - the assumption that OpenEMR login gives SSO into the SPA. It doesn't.
- **Open questions:**
  - **[David]** Which client model applies?
    - (a) Public, FHIR-only, one patient per authorization. DB-05 and
      DB-06 then come from FHIR `MedicationRequest` with the
      prescriptions/medications split problem noted in CLINICAL-CARDS.
    - (b) A confidential client behind a small BFF with `user/` scopes,
      admin-enabled. That conflicts with "public client, tokens in memory"
      and may count as a new backend.
    - (c) Direct DB edit of `oauth_clients.scope` for a public client.
      This is not supported by any code path, and whether it is
      "configuration" under A5 is doubtful.
  - Is the per-patient re-login acceptable UX for DB-01? The only no-login
    path is EHR launch from inside OpenEMR. It needs the `launch` scope,
    which makes a public client need admin approval, plus the per-client
    skip flag.
  - Does the practitioner's ACL beyond `patients/demo` need to limit what
    the FHIR `patient/` token returns? `checkUserHasAccessToPatient()` is
    a stub that returns `true`, and the `patients/med` ACL used by
    user-context routes is skipped for `patient/` tokens. That may be
    **broader** than what the PHP dashboard shows the same user; a
    practitioner with `demo` but not `med` rights would still get
    meds and allergies. Not verified against a live ACL setup.
  - Runtime confirmation of Findings #3-#5 and of CORS on `/token` belongs
    to Phase 6. No OAuth client exists yet, and this audit sent no
    requests.
