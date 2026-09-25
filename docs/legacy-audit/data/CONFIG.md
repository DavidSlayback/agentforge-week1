# Config — globals that change what the dashboard/API shows or allows

Phase 4 data audit. Read-only: source (`Read`/`Grep` of
`library/globals.inc.php`) plus read-only `SELECT ... FROM globals` against
the local synthetic dev DB. No writes, no HTTP calls to the app. Local
values are this dev stack's current settings, not a recommendation for the
public deploy — see §3.

## 1. Globals that gate or shape the port

For each: where declared (`library/globals.inc.php`, `'Connectors'` tab
unless noted), the local value (`SELECT gl_value FROM globals WHERE
gl_name=...`), what it does to the port, and whether the BFF must
replicate the behavior itself because no API surfaces it.

| Global | Declared | Local value | Effect on the port | BFF must replicate? |
|---|---|---|---|---|
| `rest_api` | `library/globals.inc.php:3264-3269` | `1` (on) | Gates every `/api/*` standard-REST route. `OAuth2AuthorizationListener::authorizeRequest()` 404s **all** of `/oauth2/*` if `rest_api`, `rest_fhir_api`, and `rest_portal_api` are all empty (`src/RestControllers/Subscriber/OAuth2AuthorizationListener.php:101-109`, cited `api/AUTH-AND-PATIENT.md` §1.4) — with it off, no token can be minted at all, so every card the BFF serves via REST (Medications, Prescriptions, Vitals-per-encounter, and both `/api/patient/:puuid/...` card routes) goes dark. | No — it's a deploy-time on/off switch, not a behavior the BFF can emulate. It must simply be on. `api/AUTH-AND-PATIENT.md:164-170` notes no separate explicit gate exists directly on the data routes themselves — enforcement is transitive through the token mint. |
| `rest_fhir_api` | `:3250-3255` | `1` (on) | Same 404-everything gate as `rest_api` (same OR check). Required for FHIR `Patient`, `AllergyIntolerance`, `Condition`, `MedicationRequest`, `CareTeam`, `Observation` (vitals) — i.e. the Header and Care Team cards, which have no standard-REST equivalent (`modules/README.md`'s per-card table). | No — must be on. |
| `rest_portal_api` | `:3271-3276` | `1` (on) | Same gate; "(EXPERIMENTAL)" per its own label. Not otherwise used by any in-scope card route in this audit's grep of `apis/routes/_rest_routes_portal.inc.php` for the DB-03..08 endpoints — its only confirmed effect here is keeping the OR-gate satisfied. | No — the port doesn't call `/portal/*` routes for these cards; it only needs the OR-gate not to be all-empty. |
| `rest_system_scopes_api` | `:3257-3262` | `1` (on) | Enables `system/` scopes (machine-to-machine, no user context). Client model B uses a confidential client with `user/` scopes, not `system/` — this audit found no in-scope route that requires it. | No — not on the port's path; on locally, effect on the port is none either way. |
| `oauth_password_grant` | `:3278-3288` (enum `0..3`: off / users / patient / both) | `3` — **"On for Both Roles"** | Label itself: `xl('Enable OAuth2 Password Grant (Not considered secure)')`, description `"Recommend turning this setting off for production server. Recommend only using for testing."` (`:3278-3287`). With it on, `AuthorizationController::getAuthorizationServer()` registers `CustomPasswordGrant` (`src/RestControllers/AuthorizationController.php:736-747`, gated on `!empty($this->globalsBag->get('oauth_password_grant'))`) — a grant type that trades a username+password directly for a token, bypassing the authorization-code/consent flow DB-01 specifies ("A user logs in via OAuth2/OpenID Connect... no stored passwords"). | **No — this must be off, not replicated.** It's not something the BFF can or should lean on; DB-01's auth-code + PKCE flow is the intended path. Flagged again in §3 as a public-deploy check. |
| `oauth_app_manual_approval` | `:3289-3297` (bool-like enum) | `0` — "Patient standalone apps auto-approved, EHR-Launch/Provider/System apps require manual approval" | Governs whether the BFF's confidential OAuth client (registered via `POST /oauth2/default/registration`, self-service — `api/AUTH-AND-PATIENT.md` §1.3) comes back `is_enabled=1` immediately or needs an admin to flip it in `interface/smart/admin-client.php` before it can mint tokens (`ScopeRepository::hasScopesThatRequireManualApproval()`, `src/Common/Auth/OpenIDConnect/Repositories/ScopeRepository.php:334-360`, cited `api/AUTH-AND-PATIENT.md:104-111`). A confidential client requesting only `patient/*` scopes auto-enables regardless of this setting (ONC carve-out, `:352-359`); the BFF's client requests `user/*` scopes too (client model B, per-card table), so this setting is the thing that decides whether registration alone is enough or an admin step is needed. | No — deploy-time step, not a behavior to emulate. Record which case applies at setup time (local: 0, so a `user/`-scope confidential client still needs manual enable unless it requests `patient/*` only — not verified live for the actual registered SPA client in this audit; flagged as open question). |
| `oauth_ehr_launch_authorization_flow_skip` | `:3298-3302` | `1` (on) | "Enable an OAuth2 Client application to be configured to skip the login screen and the scope authorization screen if the user is already logged into the EHR." Relevant only to EHR-launch (SMART launch from inside the legacy UI), not the BFF's standalone auth-code flow — the SPA is reached directly, not launched from `demographics.php`. | No — not on the port's path as designed (standalone launch, not EHR launch). |
| `site_addr_oath` | `:3243-3248` | `https://localhost:9300` | The base URL OpenEMR treats as its own OAuth2/FHIR/CCDA/payment origin. `getAuthBaseFullURL()` (cited `modules/AUTHORIZATION-CONTROLLER.md:59,168,178,273,856`) builds the issuer, discovery (`/.well-known/openid-configuration`), and default redirect-URI-matching base from this value plus the webroot path. The confidential client's registered `redirect_uris` (the BFF's own callback URL) must be reachable and must be what `/authorize` actually redirects to — this global is what OpenEMR itself believes its issuer origin is, which downstream OIDC discovery/validation depends on matching. | **Yes, indirectly** — the BFF's OAuth client registration and its stored `issuer`/discovery URLs must be built from whatever this global is set to in each environment (local: `https://localhost:9300`); no API call returns this value to a generic client except via `/.well-known/openid-configuration`, which the BFF should read at startup rather than hardcoding. |
| `api_log_option` | `library/globals.inc.php:2893-2900` (not `'Connectors'` — this one's declared elsewhere in the file; grep-confirmed line) | `2` — **"Full Logging"** ("Full includes requests and responses") | Governs what the `api_log` table stores per API call. Local dev logs full request **and response bodies** — for patient data endpoints that's PHI in a log table. Already flagged at the modules layer: `AUDIT-STATE.md:98` lists "`api_log` stores full response bodies" among the Phase 6 verification items; this doc confirms the specific setting and its local value. | N/A for the BFF's own behavior, but **directly relevant to the AGENTS.md PHI rule** ("Never log raw ... document text, prompts or extracted values") — if the BFF's own logs ever echo OpenEMR API responses for debugging, that's a second PHI-logging surface on top of this one. Not a BFF-replicate case; it's a "don't make it worse" case. |
| `units_of_measurement` | `library/globals.inc.php:727-736` (enum 1-4: both/US, both/metric, US only, metric only) | `1` — "Show both US and metric (main unit is US)" | Consumed **server-side**, inside the API's own data layer: `VitalsService::__construct(?int $units_of_measurement = null)` defaults to `OEGlobalsBag::getInstance()->get('units_of_measurement')` (`src/Services/VitalsService.php:50-55`) and the conversion logic branches on it (`:256-257`). So FHIR `Observation` vital-signs and the REST per-encounter vitals route **already return numbers converted per this global** — the API doesn't return raw stored values plus a unit flag for the client to convert itself. | **Yes, for display labeling only** — the BFF doesn't need to convert numbers (the API already did), but it does need to know which unit system a given value is in to label it correctly, since the global — not a per-response field — is what decided the conversion. Confirm whether the API response includes an explicit unit code per vital (not traced in this doc; see Open questions) or whether the client must know the global's value out-of-band. |
| `date_display_format` | `:756-764` (enum 0-2: YYYY-MM-DD / MM/DD/YYYY / DD/MM/YYYY) | `0` — YYYY-MM-DD | Confirmed **not** consumed by any FHIR/REST service in this audit's grep (`grep -rln date_display_format src interface library`, excluding vendor, turned up only legacy UI files — calendar, finder, Carecoordination CCD export; none under `src/Services/FHIR` or `src/RestControllers`). The API returns raw ISO dates (e.g. `Patient.DOB`, confirmed `api/AUTH-AND-PATIENT.md` §2.3) regardless of this global. | **Yes — entirely.** No API path applies this global at all; the PHP dashboard's date rendering (`oeFormatShortDate()`, called at `demographics.php:927,929`) is a pure legacy-UI concern the port must reimplement client-side reading this same global's value (or make its own formatting decision) to match what a user of the old UI is used to. |
| `age_display_format` | `:823-829` (enum 0-1: "Years or months" / "Years, months and days") | `0` | Same story as `date_display_format`: only used by legacy age-formatting helpers (`getPatientAgeDisplay()`, `library/patient.inc.php:1456`, called from `demographics.php:927`) that back the tabbed-shell identity bar's "Age: ..." string (`api/AUTH-AND-PATIENT.md` §2.4) — not exposed by any API field; the API returns `birthDate`/`DOB` only, no computed age. | **Yes** — DB-02's header must compute age client-side from `birthDate` if it wants to match the legacy display; this global controls the format, not just whether to show it. |
| `age_display_limit` | `:831-836` | `3` | "If YMD is selected for age display, switch to just Years when patients older than this value in years." Paired with `age_display_format`; same not-in-API status. | Yes, same as above, only relevant if `age_display_format=1`. |
| `num_of_messages_displayed` | `:376-381` | `3` | Caps how many `pnotes` rows the legacy Messages card shows (`getInt('num_of_messages_displayed')`, `pnotes_fragment.php:43`, cited `ui/DASHBOARD-MAP.md` row 142). **Moot for this port**: DB-08 was reassigned from Patient Notes to Vitals at the Phase 1 checkpoint specifically because `pnotes` has no read API (`AUDIT-STATE.md:86`, `api/CLINICAL-CARDS.md` DB-08 section) — Messages is "not ported: no read API." | No — the card this global governs isn't in the port's scope. Listed here for completeness per the brief's explicit ask, not because it affects anything live. |
| `hide_dashboard_cards` | `:203-208` (multi-select against card ids, e.g. `card_allergies`) | **unset** locally (`SELECT gl_name, gl_index, gl_value FROM globals WHERE gl_name LIKE 'hide%'` returns no `hide_dashboard_cards` row at all — only `hide_billing_widget=''` and `hide_document_encryption=1`, neither of which gates an in-scope card) | Per-card hide list, checked with `!in_array('card_allergies', $hiddenCards)` etc. (`demographics.php:1095` and siblings, cited `ui/DASHBOARD-MAP.md:127-130`). Already an accepted API gap per Phase 2 decision 5 (`AUDIT-STATE.md:84`): "squad restriction and `hide_dashboard_cards` accepted as API gaps, all cards shown." | No new information — confirms the local value (nothing hidden) matches the "all cards shown" decision; there's no API field for this setting so the acceptance stands regardless of value. |
| `enable_cdr` | `library/globals.inc.php:2593-2598` | `1` (on) | Master switch for Clinical Decision Rules. Gates the Clinical Reminders and Patient Reminders cards (`demographics.php` rows in `ui/DASHBOARD-MAP.md`'s per-card table) — neither is in the port's 6-card scope. | No — out of scope card. |
| `enable_allergy_check` | `:2600-2605` | `1` (on) | "Enable Allergy Check Against Medications and Prescriptions" — an interactive drug/allergy interaction check triggered from the *add/edit* medication and prescription forms, not the read-only dashboard cards. The port is read-only (DB-10), so this check's UI never renders in the SPA regardless of the global. | No — not reachable from a read-only port. |
| `enable_cdr_prw` / `enable_cdr_crw` | `:2621-2626` / `:2635-2640` | `1` / `1` | Gate the Patient Reminders and Clinical Reminders cards respectively (paired with `enable_cdr`) — both out of the port's 6-card scope, and also the source of two of the three unconditional `top.restoreSession`/`setPatient` JS errors RECON logged (`ui/DASHBOARD-MAP.md` §7) when either is on and the page loads outside the tabbed shell. | No — out of scope cards; the JS-error side effect is a legacy-UI-only symptom, not something the port inherits (the port doesn't include that JS at all). |

## 2. Confirmed local values (raw query)

```sql
SELECT gl_name, gl_value FROM globals WHERE gl_name IN (
  'rest_api','rest_fhir_api','rest_portal_api','rest_system_scopes_api',
  'oauth_password_grant','oauth_app_manual_approval','oauth_ehr_launch_authorization_flow_skip',
  'site_addr_oath','api_log_option','units_of_measurement','date_display_format',
  'age_display_format','age_display_limit','num_of_messages_displayed',
  'enable_cdr','enable_cdr_prw','enable_cdr_crw','enable_allergy_check','enable_alert_log'
) ORDER BY gl_name;
```

| gl_name | gl_value |
|---|---|
| age_display_format | 0 |
| age_display_limit | 3 |
| api_log_option | 2 |
| date_display_format | 0 |
| enable_alert_log | 1 |
| enable_allergy_check | 1 |
| enable_cdr | 1 |
| enable_cdr_crw | 1 |
| enable_cdr_prw | 1 |
| num_of_messages_displayed | 3 |
| oauth_app_manual_approval | 0 |
| oauth_ehr_launch_authorization_flow_skip | 1 |
| oauth_password_grant | 3 |
| rest_api | 1 |
| rest_fhir_api | 1 |
| rest_portal_api | 1 |
| rest_system_scopes_api | 1 |
| site_addr_oath | https://localhost:9300 |
| units_of_measurement | 1 |

`hide_dashboard_cards` had no matching row (`SELECT gl_name, gl_index,
gl_value FROM globals WHERE gl_name LIKE 'hide%'` returned only
`hide_billing_widget` and `hide_document_encryption`, neither in-scope).

## 3. Default/seed users in the local dev DB — usernames and roles only

**Critical check for David — do not treat this as verified for the public
deploy.** This audit only queried the local dev container
(`agentforge-week1-mysql-1`); it did not and per the read-only/no-HTTP rule
could not check the public deploy's user table or its `oauth_password_grant`
/ `oauth_app_manual_approval` values. Whether the public deploy still has
dev-default accounts, and whether `oauth_password_grant` is off there, is
unverified and needs a separate check against that environment — not
attempted here.

Usernames and their ACL role group only (no passwords, no password
hashes, no other columns read):

```sql
SELECT u.username, u.authorized, u.active, gg.value AS acl_group
FROM users u
LEFT JOIN gacl_aro a ON a.value = u.username AND a.section_value='users'
LEFT JOIN gacl_groups_aro_map m ON m.aro_id = a.id
LEFT JOIN gacl_aro_groups gg ON gg.id = m.group_id
ORDER BY u.id;
```

| username | authorized (provider) | active | ACL group |
|---|---|---|---|
| admin | 1 | 1 | admin |
| phimail-service | 0 | 0 | — |
| portal-user | 0 | 0 | — |
| accountant | 0 | 1 | back |
| clinician | 1 | 1 | clin |
| physician | 1 | 1 | doc |
| receptionist | 0 | 1 | front |
| zhportal | 0 | 1 | admin |
| oe-system | 0 | 0 | admin |
| ExternalProvider | 1 | 1 | — |
| *(blank/NULL username, id 11)* | — | 1 | — |
| *(blank username, id 12)* | — | 1 | — |

The stock `admin` account (ACL group `admin`) is present and `active=1` —
this is OpenEMR's well-known default administrator username. Two rows (id
11, 12) have no username at all and are `active=1`; not investigated
further here (likely placeholder/group-only rows from install, not
independently confirmed). **This is exactly the kind of account that must
not exist, or must not use a known/default credential, on the public
deploy** — usernames alone don't prove anything about password strength,
but a stock `admin` username is the first thing a credential-stuffing
attempt tries. David's call on whether to (a) confirm the public deploy's
`admin` account has a strong, non-default password, (b) rename/disable it,
or (c) accept the risk — not decided here, and not checked against the
public deploy per the read-only/local-only rule.

## Findings

| # | Type | Provisional severity | Finding | Citation | Mitigation idea |
|---|---|---|---|---|---|
| 1 | Security / config | High (provisional, local-only finding — not checked against production) | `oauth_password_grant=3` locally ("On for Both Roles"), explicitly labeled "Not considered secure... recommend turning off for production." If the public deploy inherited this dev setting, the resource-owner-password-credentials grant is live, bypassing the auth-code+consent flow DB-01 specifies. | `library/globals.inc.php:3278-3288`; local value via `SELECT gl_value FROM globals WHERE gl_name='oauth_password_grant'` | Confirm and set to `0` on any non-dev deploy; David decides whether/how to check the public value (out of scope for this read-only local audit). |
| 2 | Security / config | Critical (provisional — David's explicit ask, not independently verified beyond the local DB) | Local dev DB has a default `admin` username in ACL group `admin`, `active=1`. Whether the public deploy shares this username or a weak/default credential is unverified — flagged for David, not checked. | `users`/`gacl_aro`/`gacl_groups_aro_map` query, §3 | David confirms production credentials are non-default before any public exposure; do not attempt to verify production from this session. |
| 3 | PHI / logging | Medium (provisional) | `api_log_option=2` ("Full Logging") locally logs complete request and response bodies for API calls, including patient-data endpoints, into the `api_log` table. Already listed as a Phase 6 verification item at the modules layer; this doc confirms the specific global and value. | `library/globals.inc.php:2893-2900`; `AUDIT-STATE.md:98` | Confirm the public deploy's `api_log_option` value; consider `0`/`1` (no/minimal logging) or field-level redaction before response bodies reach the log table, consistent with the AGENTS.md PHI rule. |

## Port notes

- **Must survive:** the vitals unit-conversion behavior is already baked
  into the API response (`units_of_measurement`, §1) — the port must not
  re-convert, only label correctly.
- **Must not survive:** any reliance on `oauth_password_grant` for the
  BFF's own login flow — DB-01 specifies auth-code + PKCE, and the local
  value being "on" is flagged as a security config to fix, not a feature to
  use.
- **Open questions:**
  - Does the FHIR/REST vitals response carry an explicit unit code per
    value, or only the pre-converted number? Not traced in this doc —
    needed to resolve the `units_of_measurement` "BFF must replicate"
    label-only claim in §1 with certainty.
  - Whether the registered SPA/BFF OAuth client needs manual admin approval
    given `oauth_app_manual_approval=0` and a mix of `user/`+scoped
    requests — the ONC `patient/*`-only auto-enable carve-out
    (`api/AUTH-AND-PATIENT.md:110-111`) may not apply to this client;
    not verified against an actual registration attempt (no HTTP calls
    made per this audit's rules).
  - Public-deploy values for every global in §1, and the public-deploy user
    table for default/weak credentials (Finding 1, 2) — explicitly out of
    scope for this local, read-only session; David decides how/whether to
    check.
