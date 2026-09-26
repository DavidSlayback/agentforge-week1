# Walkthrough: clinician signs in and opens a patient — the identity header renders (DB-01, DB-02)

Phase 6 code-reading walkthrough. Legacy baseline `3ccfe1d`; citations without a
tag are the working tree, which is unchanged for these paths (`git diff --stat
3ccfe1d HEAD -- src oauth2 templates apis interface library` is empty, per
`modules/AUTHORIZATION-CONTROLLER.md`). Client model is **B**: a thin BFF holds
a confidential OAuth2 client (auth code + PKCE); tokens stay server-side; the
SPA is served same-origin by the BFF (`AUDIT-STATE.md:85`).

## (a) Legacy path — login → tabbed shell → Finder → demographics.php → identity bar

1. **Login.** The user authenticates against the core OpenEMR session
   (`library/auth.inc.php`, included by `interface/globals.php:725-728`),
   distinct from the OAuth2 session used by the port (see (b) step 2).
2. **Tabbed shell boots.** `interface/main/tabs/main.php` renders once per
   browser session. The persistent identity bar's DOM,
   `<div id="attendantData">` (`main.php:522`), is bound to a Knockout
   `patient_data_view_model` (`patient_data_view_model.js:22-60`) that starts
   with no patient — the `<!-- ko if: patient -->` guards in
   `patient_data_template.php:54,65,119` all fail, so the bar renders empty.
3. **Patient selected.** The Finder, recent-patients list, or any link opens
   `demographics.php?set_pid=N` inside the shell's iframe
   (`ui/DEMOGRAPHICS-PART1-BOOT.md` "Purpose and lifecycle" step 2;
   `demographics.php:84-94`).
4. **`setpid()` switches the session patient — before any authorization
   check.** `setpid($_GET['set_pid'])` (`library/pid.inc.php:16-19` →
   `PatientSessionUtil::setPid()`, `src/Common/Session/PatientSessionUtil.php:44-81`)
   writes session `pid`, resets session `encounter`, and writes an audit
   `view` row (`PatientSessionUtil.php:80`). This is `ui/README.md` finding
   U-6 / `DEMOGRAPHICS-PART1-BOOT.md` finding #2 (High, verified).
5. **Patient row load.** `PatientService::findByPid($pid)`
   (`src/Services/PatientService.php:655-666`): `SELECT * FROM patient_data
   WHERE pid = ? LIMIT 1`, then `touchRecentPatientList($newPatient)`
   (`PatientService.php:939-975`, writes `recent_patients`).
   `findByPid()` has **no REST/FHIR route** — 14 legacy call sites only,
   zero under `src/RestControllers`/`apis/` (`modules/PATIENT-SERVICES.md`
   finding #2, Medium).
6. **CDR side work runs** (`demographics.php:105-134`, only if
   `enable_cdr`): allergy/medication conflict check, writes
   `clinical_rules_log`. Still before any authorization check.
7. **Data loads for the page** (`demographics.php:343-363`):
   `getPatientData($pid, "*, DATE_FORMAT(DOB,'%Y-%m-%d') as DOB_YMD")`
   (`library/patient.inc.php:68-72`) — same table, a second, differently
   shaped read from step 5.
8. **`<head>` JS is emitted, still pre-ACL.** The inline `setMyPatient()`
   function body (`demographics.php:916-967`) is written into the response,
   embedding `pname`, `pid`, `pubpid`, `str_dob` and the full encounter list.
   This is `DEMOGRAPHICS-PART1-BOOT.md` finding #1 (High, verified) / `ui/README.md`
   U-7: identity data reaches the browser (in page source) even for a user who
   is about to be denied.
9. **Page-level ACL gate.** `new ViewEvent($pid)` dispatches, then
   `$thisauth = aclCheckCore('patients','demo')` (`demographics.php:1051-1056`).
   On failure: "Not Authorized" partial + `exit()` (`:1058-1061`) — **after**
   steps 4-8 have already run and been sent (`ui/README.md` U-6/U-7).
10. **Client-side, on `window.load`:** `setMyPatient()` runs
    (`demographics.php:969-971`) and calls `parent.left_nav.setPatient(pname,
    pid, pubpid, '', str_dob)` (`:924-930`) — literally the parent (shell)
    frame's function.
11. **Shell state update.** `left_nav.setPatient()`
    (`interface/main/tabs/js/frame_proxies.js:27-54`) replaces (new patient)
    or patches (same patient) the `patient_data_view_model`; sets
    `app_view_model.attendant_template_type('patient-data-template')`
    (`:53`), which is what makes `#attendantData` render the identity
    template at all.
12. **Knockout redraw.** `main.php:522`'s `data-bind="template: {...}"`
    re-renders `patient-data-template` automatically — no page reload,
    since this DOM lives in the shell, not the iframe
    (`ui/DASHBOARD-HEADER.md` "Purpose & lifecycle" step 4).
13. **Bar renders:** picture → name (`fname + " " + lname`, no
    middle/suffix, `demographics.php:925`) → `(pubpid)` → `" DOB: <date> Age:
    <age>"` or `"... Age at death: <age>"` on its own line
    (`patient_data_template.php:64-115`). **No sex field, no active/status
    field exist anywhere in this template or its view model**
    (`DASHBOARD-HEADER.md` finding #1, Medium; `patient_data_view_model.js:22-28`
    has exactly `pname`/`pid`/`pubpid`/`str_dob`).

## (b) Port path — SPA → BFF → OpenEMR OAuth2/FHIR → header render

1. **SPA start.** The BFF serves the SPA same-origin (removes the CORS
   preflight 404 problem, M-3, `modules/README.md`). The SPA calls the BFF's
   own `/login`.
2. **BFF redirects the browser to OpenEMR's authorization endpoint:**
   `GET /oauth2/default/authorize` with `response_type=code`, its registered
   `client_id`, `redirect_uri`, `scope`, `state` (required in practice —
   `AUTHORIZATION-CONTROLLER.md` finding #17), `nonce` (hardens `/logout` —
   finding #4), `code_challenge`+`code_challenge_method=S256` (mandatory
   even for confidential clients in this design), optionally `aud`
   (`modules/AUTHORIZATION-CONTROLLER.md` "Authorize" section).
   `OAuth2AuthorizationListener::authorizeRequest()`
   (`src/RestControllers/Subscriber/OAuth2AuthorizationListener.php:93-187`)
   dispatches by first-match `str_contains` on the path; `/authorize` →
   `oauthAuthorizationFlow()` (`AuthorizationController.php:555-631`).
3. **Login page.** 307 → `/oauth2/default/provider/login`. This is a
   **separate OAuth2 login page**, not the core OpenEMR login
   (`userLogin()`, `AuthorizationController.php:800-945`). Password check via
   `AuthUtils::confirmPassword()` (same lockout/IP-tracking machinery as core
   login); MFA only for `user_role='api'` users who have TOTP/U2F registered.
4. **Consent page.** `scopeAuthorizeConfirm()` (`:1034-1113`) renders the
   scope tree; the user may narrow scopes. "Authorize" POSTs to
   `/device/code` → `authorizeUser()` (`:1198-1259`), which checks CSRF
   (only when `proceed` is posted), saves an `oauth_trusted_user` row keyed
   by the issued code, and returns **302 `redirect_uri?code=…&state=…`**.
5. **BFF exchanges the code server-side.** `POST /oauth2/default/token`
   (`application/x-www-form-urlencoded`,
   `grant_type=authorization_code&code=…&redirect_uri=…&client_id=…&code_verifier=…`).
   `oauthAuthorizeToken()` (`:1350-1418`) restores the saved session **by
   code**, validates PKCE, and (because this is a confidential client)
   **only checks `client_secret` if one is sent** — `ClientRepository::validateClient()`
   returns `true` when the secret is empty (`AUTHORIZATION-CONTROLLER.md`
   finding #1, High verified: `ClientRepository.php:185-221`). The BFF must
   always send its secret. Response: `access_token` (RS256 JWT, 1 h),
   `id_token` (if `openid` granted), `patient` (the picked patient's uuid,
   from the SMART patient-picker flow if `launch/patient` scope is used —
   or omitted if the BFF instead does per-request patient search, see Open
   question below), `refresh_token` only if `offline_access` was granted.
6. **BFF sets its own session cookie** for the SPA (server-side token
   storage — DB-01 "no PHP session, no stored passwords" is read as: no
   *OpenEMR* PHP session and no stored *password*, not "no server-side
   session" for the BFF itself, per `AGENT-BRIEF.md`'s client-model
   decision).
7. **Patient search / selection.** SPA calls the BFF, which calls
   `GET /fhir/Patient` or `GET /api/patient` with the bearer token (client
   model B allows either FHIR or standard REST, since the BFF holds a
   confidential client with `user/` scopes — `modules/README.md` "Per-card
   data source" column B, Header row). ACL gate:
   `RestConfig::request_authorization_check($request, "patients", "demo")`
   for standard REST (`_rest_routes_standard.inc.php:77,85,93,100`, cited
   `modules/PATIENT-SERVICES.md` Permission checks table) — the same ACL
   pair the legacy page gate uses at `demographics.php:1056`.
8. **BFF resolves the integer `pid` from the same call.**
   `GET /api/patient/:puuid` returns `patient_data.*` including `pid`
   directly (`PatientService.php:427`; response shape confirmed in
   `swagger/openemr-api.yaml:9915-10012`) — **no separate uuid↔id lookup or
   mapping table is needed** (`data/UUID-MAPPING.md` §6). This is also the
   single call that serves the header.
9. **Header fields extracted from the one `FHIRPatient`/patient-array
   response** (`modules/PATIENT-SERVICES.md` "Port notes — Must survive"):
   - **Name:** `Patient.name[0]` (`HumanName`: `family`=lname, `given[0]`=fname,
     `given[1]`=mname, `prefix[0]`=title) — `parseOpenEMRPatientName()`
     (`FhirPatientService.php:281-335`). Recommended: use this fuller form
     (matches the legacy page-title string, not the stripped-down shell
     bar) — see (c) below.
   - **DOB:** `Patient.birthDate`, raw ISO `YYYY-MM-DD`
     (`parseOpenEMRDateOfBirth()`, `FhirPatientService.php:274-279`).
   - **Sex:** `Patient.gender` (coarse FHIR enum) **and** the
     `us-core-birthsex` extension (`M`/`F`/`UNK`/…) — both derived from
     `patient_data.sex`, **not** `sex_identified`
     (`parseOpenEMRGenderAndBirthSex()`, `FhirPatientService.php:376-419`;
     `modules/PATIENT-SERVICES.md` "Port note").
   - **MRN:** `Patient.identifier` type `PT`, from `pubpid`
     (`parseOpenEMRPublicPatientIdentifier()`, `FhirPatientService.php:552-566`).
   - **Active status:** derive from `Patient.deceasedDateTime` /
     `deceasedBoolean` presence (`parseOpenEMRPatientDeceasedDateTime()`,
     `FhirPatientService.php:741-752`). **Never read `Patient.active`** — it
     is hardcoded `true` unconditionally, confirmed the sole `setActive()`
     call in the file (`FhirPatientService.php:212`).
10. **Logout.** SPA discards its (BFF-issued) session; BFF navigates the
    browser to `GET /oauth2/default/logout?id_token_hint=<id_token>&post_logout_redirect_uri=<exact
    registered URI>&state=<s>`. `userSessionLogout()`
    (`AuthorizationController.php:1450-1506`) deletes the `oauth_trusted_user`
    row for (client, user); every later bearer request for that pair then
    gets `400 "Refresh Token revoked or logged out"`
    (`BearerTokenAuthorizationStrategy.php:168-178`) — this is the actual
    revocation mechanism; there is no `/revoke` endpoint and no tokens are
    directly invalidated (`AUTHORIZATION-CONTROLLER.md` finding #7, Medium).

## (c) Where they diverge

| Rule | Legacy behavior | API/port behavior | Port rule (per AGENT-BRIEF / analyses) |
|---|---|---|---|
| Auth model | Core OpenEMR PHP session (`auth.inc.php`); OAuth2 session (separate cookie `authserverOpenEMR`) is unused by the dashboard at all | OAuth2 authorization-code + PKCE against `AuthorizationController`; confidential client, tokens server-side in the BFF | DB-01: OIDC login, no PHP session, no stored password |
| When authorization runs | `set_pid` switches the session, audits, runs CDR, and emits identity JS **before** `aclCheckCore('patients','demo')` at `:1056` (`ui/README.md` U-6/U-7; `DEMOGRAPHICS-PART1-BOOT.md` findings #1-#2, High verified) | ACL (`patients/demo`) is checked by the route closure on **every** API call, before any data is returned (`modules/PATIENT-SERVICES.md` Permission checks table) | Port: no data before authorization, per call, not per page |
| Identity source | Two different functions build two different name strings for the same load: shell bar uses `fname+" "+lname` (`demographics.php:925`); page/tab title uses `getPatientFullNameAsString()` (`fname [mname] lname [suffix]`, `OemrUI.php:87`) — `DASHBOARD-HEADER.md` finding #2 | One `FHIRPatient`/`patient` response feeds the whole header — `Patient.name[0]` gives the fuller form | Port: pick one canonical name (the fuller `HumanName` form) and use it everywhere; do not reproduce the two-strings bug |
| Sex field | **Not shown anywhere in the persistent bar** — no observable exists for it in `patient_data_view_model` (`DASHBOARD-HEADER.md` finding #1, Medium) | `Patient.gender` + `us-core-birthsex`, available on the same call | Port is **adding** a field the legacy bar never had (DB-02 requires it); call this out as a deliberate improvement, not silent parity break |
| Active/status field | **Not shown in the persistent bar at all.** Only signal is the "Age" → "Age at death" string swap inside `str_dob`, plus an unrelated mid-page red "Deceased" banner (`demographics.php:1333`, outside the bar, never a positive "Active" indicator) | `Patient.active` is hardcoded `true`, asserts nothing; only real signal is `deceasedDateTime`/`deceasedBoolean` | A2 / REQUIREMENTS-TRACE DB-02: "not available via API" in the `Patient.active` sense — port must derive from `deceasedDateTime`, never read `Patient.active` |
| Date/age format | `date_display_format`/`age_display_format`/`age_display_limit` globals drive `oeFormatShortDate()`/`getPatientAgeDisplay()` (`demographics.php:927`); the **deceased branch ignores `age_display_format`** and always uses `oeFormatAge()`'s hardcoded default (`DASHBOARD-HEADER.md` finding #4) | API returns raw ISO `birthDate`; **no FHIR/REST service consumes `date_display_format`/`age_display_format`/`age_display_limit`** (confirmed by grep, `data/CONFIG.md` §1) | BFF/SPA must read these globals itself (no API exposure confirmed) and apply date/age formatting client-side; age is not an API field at all — compute from `birthDate` |
| pid vs uuid | Session-implicit integer `pid`, switched by GET `set_pid` with no confirmation the patient exists (`DEMOGRAPHICS-PART1-BOOT.md` finding #8: non-existent pid → `TypeError` after the session already switched) | Explicit `puuid` in every call; BFF resolves integer `pid` once from the same `GET /api/patient/:puuid` response — no separate lookup (`data/UUID-MAPPING.md` §6) | DB-defining choice: explicit patient id in every call, never implicit session state |
| Client secret enforcement | n/a (no OAuth in legacy path) | Confidential client secret is **only checked if sent** — an omitted secret passes (`AUTHORIZATION-CONTROLLER.md` finding #1, High verified, `ClientRepository.php:185-221`) | BFF must always send its client secret at `/token`, for both auth-code and refresh grants; never rely on the gap |
| Logout semantics | No logout ends "API access" in the legacy path (concept doesn't apply) | `/logout` deletes the `oauth_trusted_user` row → every subsequent bearer request for (client,user) is rejected; but no `api_token`/`api_refresh_token` row is actually revoked, so **logging in again re-enables old unexpired tokens** (`AUTHORIZATION-CONTROLLER.md` finding #7, Medium) | DB-01 "logout ends the session": implementable via `end_session_endpoint`, but document the re-enable caveat; discard in-memory tokens on the client regardless |

## (d) Partial-failure points — what the user would see

- **BFF redirects to `/authorize` but the OpenEMR auth server key pair is
  broken** (`OAuth2KeyConfig` failure in the `AuthorizationController`
  constructor, `AuthorizationController.php:168-190`): the OAuth session is
  invalidated and a generic `serverError` is thrown → the user sees an OAuth
  error page before ever reaching login. No patient data involved yet.
- **Login page reached, wrong password / lockout:** standard `AuthUtils`
  failure path (same as core login) — user stays on the OAuth login page,
  no callback to the BFF.
- **Consent page, user narrows scopes below what the header needs (e.g.
  drops `patient/Patient.rs`/`user/patient.rs`):** token is still issued,
  but `finalizeScopes()` silently intersects to the granted set
  (`AUTHORIZATION-CONTROLLER.md` "`oauthAuthorizeToken()`" section,
  `ScopeRepository.php:137-188`). The BFF's later `GET /api/patient/:puuid`
  call gets a scope-denied error, not a data gap — the SPA must show "not
  authorized for this data," not treat an empty/error response as "Nothing
  Recorded" (`AGENT-BRIEF.md` "Security model to respect").
- **User clicks "Cancel" on consent:** `window.history.back()`
  (`scope-authorize.html.twig:298`) — **no callback to the BFF at all**
  (`AUTHORIZATION-CONTROLLER.md` finding #16). The SPA's redirect handler
  never fires; the login flow must time out or the user must retry from the
  SPA's own "Sign in" entry point, not rely on an `error=access_denied`
  redirect.
- **`/token` exchange fails PKCE** (`code_verifier` mismatch): league
  `invalid_grant` JSON — BFF should surface a generic "sign-in failed,
  please retry," never the raw exchange error to the browser (`AGENT-BRIEF.md`
  "API errors can leak SQL; never render API error text").
- **`/token` succeeds but the confidential client's secret was omitted by a
  BFF misconfiguration:** the exchange still succeeds (Finding #1) — this
  is a *silent* partial failure of the security model, not a user-visible
  one; only catchable by the BFF's own config validation, not by watching
  the UI.
- **Header fetch (`GET /api/patient/:puuid`) returns HTTP 200 with an empty
  result** (e.g. malformed/unknown uuid — `PatientValidator::isExistingUuid()`
  returns false for a bad uuid, `PatientService.php:632-647` →
  `getOne()`): standard REST 404s explicitly
  (`PatientRestController.php:327-329`), but a scope/search-level empty
  result elsewhere in the API can come back as **HTTP 200 with an empty
  bundle** — must be treated as an error state, never "Nothing Recorded"
  (`AGENT-BRIEF.md`).
- **`ListService` uuid null-guard** (`data/UUID-MAPPING.md` finding #1,
  provisional High, not the header's own route but adjacent risk if the
  header-first flow is skipped): not applicable to the header call itself
  (`PatientService`/`FhirPatientService` do their own lazy per-row uuid
  resolution, `PatientService.php:173,696-699` — no table-sweep dependency),
  but worth noting the header call is what keeps the `patient_data` uuid
  itself backfilled for every later card call in the same session.
- **Access token expires mid-session (1 h) and no `offline_access` was
  granted:** BFF has no refresh token; the SPA must force a full
  re-authorization (new password entry, and MFA if configured) — there is
  no silent refresh in this design (`AUTHORIZATION-CONTROLLER.md` "Must
  survive: Handle short access tokens").
- **Logout redirect URI doesn't exactly match the registered
  `post_logout_redirect_uris`:** falls through to a `200 text/plain` "You
  have been signed out" page instead of redirecting back to the SPA
  (`AuthorizationController.php:1494-1499`) — the BFF must register exactly
  the deployed callback/logout URLs, or the user gets stranded on an
  OpenEMR page after logout.
- **Patient not found / deceased with no `deceasedDateTime` but a
  non-empty `deceased_date` mismatch:** not observed in code; the header
  should treat presence/absence of `deceasedDateTime` as binary and not
  attempt to interpret partial values.

## (e) Live evidence to collect in the build

Checklist for the walking-skeleton slice (client model B, confidential BFF).
Expected counts below are from read-only `SELECT` SQL against the local
synthetic DB (`agentforge-week1-mysql-1`), no patient values pasted, per
`AGENTS.md` §PHI:

```sql
SELECT pid, COUNT(*) rows_found, SUM(uuid IS NULL) null_uuid,
       SUM(deceased_date IS NOT NULL AND deceased_date != '0000-00-00') deceased_flag,
       SUM(sex IS NULL OR sex='') missing_sex,
       SUM(pubpid IS NULL OR pubpid='') missing_pubpid,
       SUM(DOB IS NULL OR DOB='0000-00-00') missing_dob
FROM patient_data WHERE pid IN (13,3) GROUP BY pid;
```

| pid | rows_found | null_uuid | deceased_flag | missing_sex | missing_pubpid | missing_dob |
|---|---|---|---|---|---|---|
| 13 (data-rich) | 1 | 0 | 0 | 0 | 0 | 0 |
| 3 (empty-state) | 1 | 0 | 0 | 0 | 0 | 0 |

Both test patients have a complete `patient_data` row with a non-null uuid,
sex, pubpid and DOB, and neither is deceased — so **both should render a
full header with no "not available" gaps for name/DOB/sex/MRN**, and both
should show whatever "active" treatment the SPA picks for a non-deceased
patient (no positive legacy signal to match, per (c) above — this is new
UI, not parity).

Checklist:

- [ ] `GET /oauth2/default/authorize` with the BFF's confidential
      `client_id`, PKCE `S256`, `state`, `nonce` → reaches the OAuth2 login
      page (not the core OpenEMR login).
- [ ] Successful login + consent → 302 to the BFF's registered
      `redirect_uri` with `code` and matching `state`.
- [ ] BFF's server-side `POST /oauth2/default/token` (with client secret
      sent) → 200 with `access_token`, `id_token`; confirm `patient` field
      shape if the SMART patient-picker path is used, or confirm the BFF's
      own per-request patient search path if not (see Open question below).
- [ ] `GET /api/patient/:puuid` (or `GET /fhir/Patient/:uuid`) for pid 13's
      uuid → single record; `pid`/`id` present (standard REST) confirming
      `data/UUID-MAPPING.md` §6's "resolve pid once" claim.
- [ ] Same call for pid 3's uuid → single record, same field completeness
      (per the table above — pid 3 is "empty-state" for cards, not for the
      header itself).
- [ ] Header renders name, DOB, sex, MRN for both patients with no
      "missing field" fallback triggered (matches the 0-missing counts
      above).
- [ ] Deliberate regression check: temporarily break the
      `deceasedDateTime`-only rule (read `Patient.active` instead) and
      confirm the eval/gate fails, per `AGENTS.md` "make one small
      deliberate regression and show the gate fail" — both pid 13 and pid 3
      are non-deceased, so this specific regression won't be visible on
      them; use it only to prove the code path is exercised, not to assert
      deceased-patient parity (no deceased test patient is seeded).
- [ ] `GET /oauth2/default/logout?id_token_hint=…` → subsequent
      `GET /api/patient/:puuid` with the old access token returns
      `400 invalid_request "Refresh Token revoked or logged out"`.
- [ ] Confirm client-secret enforcement is actually configured
      server-side-only (BFF never ships the secret to the browser) — this
      can't be observed from the API response; it's a BFF code/config
      review item, not a live HTTP check.

## Open questions for the build (not resolved by this walkthrough)

- Whether the BFF uses the SMART `launch/patient` + patient-picker flow
  (one patient bound per authorization, per-patient re-login required,
  `AUTHORIZATION-CONTROLLER.md` "New constraint") or instead does its own
  patient search/selection with a broader `user/patient.rs` grant and picks
  the uuid per request (client model B, confidential, allows this — the
  public-client `patient/`-only restriction doesn't apply). This changes
  step (b)5's exact request shape and whether `patient`/`need_patient_banner`
  in the token response are used at all. Flagged in
  `AUTHORIZATION-CONTROLLER.md` "Open questions" as David's call, not
  re-decided here.
- Whether `date_display_format`/`age_display_format`/`age_display_limit`
  are exposed via any globals-reading API route was **not confirmed** by
  either `data/CONFIG.md` or `ui/DEMOGRAPHICS-PART1-BOOT.md` (both mark it
  an open question) — if no such route exists, the BFF/SPA must hardcode or
  configure these independently of OpenEMR.
