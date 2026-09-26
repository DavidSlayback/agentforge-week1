# Bugs, Security Flaws & Mitigations

A consolidated catalog of bugs, half-implemented features, security flaws and
architectural smells in the OpenEMR patient dashboard and the REST/FHIR API
behind it, at tag `legacy-baseline` (`3ccfe1d`). Each entry has an ID,
location, severity, description, a concrete mitigation with a disposition, and
its relevance to the dashboard port (SPA + thin BFF on OpenEMR's existing API,
read-only, no backend change: [`AGENT-BRIEF.md`](AGENT-BRIEF.md)). Sourced from
the analyses in [`ui/`](ui/README.md), [`modules/`](modules/README.md),
[`data/`](data/README.md), [`project/`](project/WHATS-MISSING.md) and
[`BASELINE-ERRORS.md`](BASELINE-ERRORS.md). Every Critical and High entry is
verified against source; the `U-` and `M-` ids refer to
[`VERIFICATION.md`](VERIFICATION.md).

This is the working list for the port: what must be fixed, what can be
deleted, what to leave alone, and what to design out of the new architecture.
When a slice resolves an entry, strike it through and append the slice ID:
`~~Title~~ — resolved in slice NN-SS-LL`.

**Conventions.**
- Paths are repo-relative at `legacy-baseline`. Line numbers come from the
  source analyses; Critical and High locations were re-read by the tier-3
  reviewer.
- *Disposition*: **fix in legacy** (a change to OpenEMR itself; this project
  doesn't make it, per DB-10 / W2D-8, so it becomes an upstream report or later
  task), **design out in port**, **delete**, or **out of port scope (catalog
  only)**. Some entries carry two.
- *Port relevance*: **port depends on it** (the port calls or is shaped by this
  code), **port designs it out** (the port's architecture removes the problem),
  or **not on the port path**.
- *Sources* lists every contributing harvested row as `<analysis file>#<row id>`.
  Baseline rows use their `B-`/`E-` ids. `project/WHATS-MISSING.md` rows use the
  capability name plus the scope, e.g. `#Backups and restore (AgentForge)`.
- Security entries give location, what is wrong, impact and mitigation only.
  They contain no reproduction steps.

## Severity guide

| Severity | Meaning |
|---|---|
| **Critical** | Direct compromise of authentication or data integrity, or features so broken they fail their stated purpose entirely. Fix before any production use. |
| **High** | Significant security weakening, broken-but-recoverable feature, or design choice that will block modernization. Fix in any rewrite. |
| **Medium** | Incorrect behavior, latent bugs, defense-in-depth gaps, or a smell that is workable today but should not survive a rewrite. |
| **Low** | UX rough edges, dead code, naming inconsistencies, cosmetic issues, minor smells. Optional. |

## Summary

| Category | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| 1. Security: Authentication & Credentials | 0 | 1 | 6 | 5 | 12 |
| 2. Security: Injection & Input Sanitization | 0 | 2 | 3 | 1 | 6 |
| 3. Security: Authorization & Permissions | 0 | 6 | 8 | 4 | 18 |
| 4. Disabled or Half-Implemented Features | 0 | 1 | 9 | 2 | 12 |
| 5. Data Integrity & Concurrency | 2 | 6 | 10 | 11 | 29 |
| 6. Error Handling & Logging | 0 | 0 | 7 | 6 | 13 |
| 7. UI/UX Bugs | 0 | 2 | 10 | 14 | 26 |
| 8. Architectural Smells | 0 | 1 | 5 | 9 | 15 |
| 9. Build / Deployment Risks | 0 | 0 | 3 | 4 | 7 |
| 10. Dead Code & Inconsistencies | 0 | 0 | 0 | 27 | 27 |
| **Total** | **2** | **19** | **61** | **83** | **165** |

**Coverage:** harvested rows 238 → catalog entries 164 (74 merged). 53 entries combine 127 rows; the other 111 are standalone. Inputs: 119 rows from `ui/`, `project/` and `BASELINE-ERRORS.md`; 92 from `modules/`; 23 from `modules/LEGACY-ROUTER-AND-LISTS.md` and `data/`; plus 4 read from source that the harvest missed (`BASELINE-ERRORS.md` E-10; `project/WHATS-MISSING.md` "Input validation at boundaries" (OpenEMR), "Secrets management" (OpenEMR), "Backups and restore" (AgentForge)). Every row appears in exactly one entry's **Sources** line (checked by script).

### Critical-candidate decisions

| Candidate | Decision | Reason |
|---|---|---|
| U-1: Vitals card shows a deleted set as current | **Critical** ([5.01](#501-vitals-card-can-show-a-deleted-vitals-set-as-current--critical)) | It silently defeats the only retraction mechanism on the clinician's summary view: a set a clinician deleted is labelled "Most recent vitals". It is reproduced on pid 13, needs no special configuration, and the triggering `form_id` collisions are common (355 of 1,438 `forms` rows). That is a direct compromise of data integrity. |
| U-2: Allergy–medication conflict alert is a JS syntax error | **High** ([7.01](#701-allergymedication-conflict-alert-fails-with-two-or-more-conflicts--high)) | The failure is silent and suppresses its own retry, but it needs two or more new conflicts at once and three CDR globals switched on. A single conflict still alerts, and the Allergies card still lists the allergies, so the feature doesn't fail entirely. |
| M-5: FHIR vitals has no deleted filter | **Critical** ([5.02](#502-fhir-vital-signs-observations-include-deleted-sets-marked-final--critical)) | Every FHIR client receives retracted vitals with status `final` and has no search parameter to exclude them. That is the same integrity compromise as U-1, on the interoperability surface (code+SQL verified). |

**U-1 and M-5 are two root causes, not one.** U-1 is a wrong join predicate:
the legacy query *does* filter `deleted`, but it joins `forms` on `form_id`
alone (no `formdir`, no `pid`), so it checks other forms' rows. M-5 is a missing
predicate: `VitalsService::search()` joins `forms` correctly
(`formdir='vitals'`) but never filters `deleted`. The fixes are different, one
does not repair the other, they sit on different surfaces (legacy page vs FHIR
API), and the port handles them differently (U-1 is not on the port path; M-5
is avoided by using the REST per-encounter route). What they share is an
enabling schema design, D-5: `form_vitals` has no deleted flag, and the flag
lives on `forms`, which is reached through a non-unique `form_id`. D-5 is filed
once, under 5.01, because its evidence (`form_id` collisions across `formdir`)
is U-1's mechanism. 5.02 cross-references it.

### Severity changes from the source analyses

| Entry | Source severity | Final | Why |
|---|---|---|---|
| 5.01 | Critical (tier 2) / High (tier 3) | Critical | Decision above |
| 5.02 | High (provisional) | Critical | Decision above |
| 7.01 | High | High | Decision above |
| 1.05 | Critical (admin default) and High (password grant), both provisional and local-only | Medium | Both values are set by the dev stack's compose file (`docker/development-easy-light/docker-compose.yml:66-67,80`). The deploy compose requires `OE_USER`/`OE_PASS` from the environment with no default, and doesn't set the password grant, whose installer default is `0` (Off). Neither was observed on production. |
| 3.14 | High (provisional, CONDITION-SERVICES #2) | Medium | The ACL mismatch is verified, but every route still enforces an ACL. It changes who sees which card; it doesn't bypass authorization. |
| 6.07 | High (provisional, UUID-MAPPING #1) | Medium | Latent: 0 local `lists` rows lack a uuid (tier-3 downgrade, `data/README.md`). Re-read now: the `ListService` constructor is empty and `getAll()` has no null guard. |
| 3.03 | STATS #6 Medium (escalate) | High (merged) | Same root cause as U-8 |
| 4.01, 5.05, 5.07, 3.06, 5.03 | Some Low/Medium rows | High (merged) | Merged into a verified High with the same root cause |
| 2.04, 4.03 | Medium (escalate) | Medium | Not exploitable or not safety-breaking as written (see entries) |
| 5.25, 9.04, 9.05 | "Not a bug" / "Environment" | Low | Test-data or environment artifacts, kept for completeness |

---

## 1. Security: Authentication & Credentials

### 1.01 Confidential OAuth client not authenticated at `/token` when `client_secret` is omitted — High
- **Location:** `src/Common/Auth/OpenIDConnect/Repositories/ClientRepository.php:185-221` (verified, M-4); `vendor/league/oauth2-server` `AuthCodeGrant.php:100-107`, `AbstractGrant.php:192-199,253-270`
- **Description:** `validateClient` verifies the secret only when the request carries one. A client registered with `is_confidential=1` can therefore redeem codes and refresh tokens with no secret, which reduces it to a public client and makes its refresh tokens pure bearer credentials. Impact: whoever holds a leaked code or refresh token for a confidential client can obtain access tokens without the client secret.
- **Mitigation:** Require and verify the secret (or a `private_key_jwt` assertion) for every grant when `is_confidential=1`. *Disposition:* fix in legacy (upstream report).
- **Port relevance:** port depends on it. The BFF's client is confidential, so the BFF always sends the secret, uses PKCE, and keeps refresh tokens server-side only (never in the browser or logs).
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#1`

### 1.02 Authorization codes are not single-use — Medium
- **Location:** `src/Common/Auth/OpenIDConnect/Repositories/AuthCodeRepository.php:20-33`; `src/RestControllers/AuthorizationController.php:1366-1370`
- **Description:** Codes are not persisted or revoked on redemption, so one code can be exchanged again until it expires. Impact: an intercepted code stays usable after the legitimate exchange.
- **Mitigation:** Persist codes and revoke them on first use. PKCE limits exploitation meanwhile. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF uses PKCE and exchanges the code server-side immediately.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#5`

### 1.03 `id_token_hint` is never signature-verified — Medium
- **Location:** `src/RestControllers/AuthorizationController.php:1445-1448` (`decodeToken`), `:1462-1487` (`userSessionLogout`)
- **Description:** Logout decodes the hint without checking the JWS signature, `iss`, `aud` or `exp`, and uses its claims to decide which session and client to act on. Impact: logout decisions rest on unauthenticated token contents.
- **Mitigation:** Verify the JWS against the server key and check `iss`/`aud`/`exp` before using any claim. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF sends only its own id token at logout.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#4`

### 1.04 Logout revokes no tokens — Medium
- **Location:** `src/RestControllers/AuthorizationController.php:1487`; `src/Services/TrustedUserService.php:57-75`; `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php:168-178`
- **Description:** Logout deletes the trusted-user row but leaves `api_token` and `api_refresh_token` rows valid. Impact: tokens issued before logout keep working until they expire.
- **Mitigation:** Revoke every access and refresh token for the (user, client) pair at logout. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF must discard its stored tokens at logout rather than rely on OpenEMR's logout.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#7`

### 1.05 Dev-stack auth defaults: default `admin` credential and OAuth password grant on (local only) — Medium
- **Location:** local DB (`users` / `gacl` admin membership; `globals.oauth_password_grant=3`), set by `docker/development-easy-light/docker-compose.yml:66-67,80`; setting defined at `library/globals.inc.php:3278-3288` (default `'0'`, "Off (Recommended setting)")
- **Description:** On the local stack the `admin` account uses the dev default password, and the password grant is "On for Both Roles". The password grant lets a client trade a username and password for tokens outside the auth-code + consent flow that DB-01 specifies. **Both were observed locally only; production is unchecked.** The deploy configuration doesn't carry either value: `deploy/vultr/docker-compose.yml:30-31` requires `OE_USER`/`OE_PASS` from the environment with no default, and doesn't set `oauth_password_grant`. Impact if present on production: the default credential gives full administrative access, and the password grant allows credentials to be used directly for API tokens.
- **Mitigation:** David checks production: the admin password isn't the default (rotate it if it is), and Admin → Config → Connectors → "Enable OAuth2 Password Grant" is Off. *Disposition:* fix in legacy (configuration; production check).
- **Port relevance:** not on the port path. The BFF uses auth code + PKCE, never the password grant, but it shares the same OpenEMR instance.
- **Sources:** `data/CONFIG.md#2`, `data/CONFIG.md#1`

### 1.06 Session never re-prompts for authentication (timeout unverified) — Medium
- **Location:** application session (app-wide); session-timeout global
- **Description:** David observed no re-authentication prompt. Whether an idle timeout is configured and enforced hasn't been checked. Impact: an unattended logged-in workstation stays usable.
- **Mitigation:** Verify the timeout global and enforce idle and absolute timeouts server-side. *Disposition:* fix in legacy (configuration check).
- **Port relevance:** port designs it out. The BFF session has its own idle and absolute timeouts, and token lifetimes bound it.
- **Sources:** `BASELINE-ERRORS.md#B-12`

### 1.07 Secrets live in environment variables and `sqlconf.php`; no secret store — Medium
- **Location:** `sites/*/sqlconf.php`; `.env` files under `deploy/vultr/`
- **Description:** Database credentials sit in a PHP file on a Docker volume, and other secrets in environment variables. There's no vault, rotation procedure or access audit. Impact: anyone with filesystem or environment access to the host can read every secret, and rotation is manual.
- **Mitigation:** Use a secret store (at minimum Docker secrets with restricted permissions) and document rotation. *Disposition:* fix in legacy (deployment).
- **Port relevance:** port depends on it. The BFF's client secret is loaded from the environment or secret store, is never committed, and never reaches the browser.
- **Sources:** `project/WHATS-MISSING.md#Secrets management (OpenEMR)`

### 1.08 Refresh tokens issued regardless of the `offline_access` decision — Low
- **Location:** `src/RestControllers/AuthorizationController.php:324-330`, `:1386` vs `:1204-1205`; `src/Common/Auth/OpenIDConnect/IdTokenSMARTResponse.php:81-95`
- **Description:** `/token` always builds the auth-code grant with `includeAuthGrantRefreshToken=true`. The comment says public apps may not have `offline_access`, but the decision made at `/authorize` never reaches `/token`. Impact: clients can receive refresh tokens they weren't granted.
- **Mitigation:** Pass the offline decision through to `/token`; fix the comment. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF doesn't request `offline_access` and treats any refresh token as a server-side secret.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#11`, `modules/AUTHORIZATION-CONTROLLER.md#15`

### 1.09 OAuth session id not regenerated after login — Low
- **Location:** `src/RestControllers/AuthorizationController.php:918-944` (`userLogin`); `src/Common/Session/SessionConfigurationBuilder.php:94-102`
- **Description:** The session id is not regenerated after `verifyLogin`. Impact: a session id known before login stays valid after it (session fixation).
- **Mitigation:** Call `session->migrate(true)` after a successful login. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path. This is OpenEMR's login page; the BFF regenerates its own session id at login.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#12`

### 1.10 Client registration is unauthenticated and unthrottled — Low
- **Location:** `src/RestControllers/AuthorizationController.php:249-432`; `src/Common/Auth/OpenIDConnect/Repositories/ScopeRepository.php:341-362`
- **Description:** Anyone can register clients, with no rate limit. Impact: registration spam and unreviewed clients, unless manual approval is on.
- **Mitigation:** Rate-limit registration and set `oauth_app_manual_approval=1`. *Disposition:* fix in legacy (code and configuration).
- **Port relevance:** not on the port path. The BFF's client is registered once, by an admin.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#18`

### 1.11 `state` is effectively required, and server CSRF is keyed on it — Low
- **Location:** `src/RestControllers/AuthorizationController.php:579`, `:1388-1392`; `src/Common/Auth/OpenIDConnect/Grant/CustomAuthCodeGrant.php:235-238`
- **Description:** Requests without `state` fail, because the server keys its own CSRF check on the client's `state`; `is_enabled` is checked late. Impact: spec-conformant clients that omit `state` fail with unclear errors.
- **Mitigation:** Check `is_enabled` in `/authorize`; use a server-side CSRF value, not `state`. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF always sends `state` and PKCE.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#17`

### 1.12 `clientRegisteredDetails` discards its headers and compares tokens in non-constant time — Low
- **Location:** `src/RestControllers/AuthorizationController.php:495`, `:500`, `:511-513`
- **Description:** PSR-7 responses are immutable, so the `withHeader()` results are lost, and the token comparison is not constant-time. Impact: missing response headers, and a theoretical timing side channel.
- **Mitigation:** Reassign the response; use `hash_equals`. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#13`

## 2. Security: Injection & Input Sanitization

### 2.01 SQL injection through query-parameter names on `GET /api/prescription` — High
- **Location:** `apis/routes/_rest_routes_standard.inc.php:664-667`; `src/RestControllers/PrescriptionRestController.php:152-157`; `src/Services/PrescriptionService.php:56-77`; `src/Services/Search/FhirSearchWhereClauseBuilder.php:33-45`; `src/Services/Search/SearchFieldStatementResolver.php:289-293` (verified, M-1)
- **Description:** The controller turns every query-string key into a search field with no allow-list, and the where-clause builder writes the field name into SQL as an identifier. Values are bound; names are not. Impact: an authenticated caller holding a prescription-read scope can alter this query's SQL and read data beyond the prescription list.
- **Production fact:** not reachable on the public deploy today. No enabled client has a prescription scope (David checked 2026-09-25). The BFF's client will need that scope for the Rx card, so from then on the route is reachable with the BFF's tokens, which live only in the BFF.
- **Mitigation:** Map query keys through a fixed search-definition allow-list and reject unknown keys. *Disposition:* fix in legacy (upstream report, David's call); design out in port (the BFF sends only the allow-listed `patient_id` key and filters `source_table` client-side).
- **Port relevance:** port depends on it (Rx card) and designs the flaw out of its own calls.
- **Sources:** `modules/API-ROUTES.md#1`, `modules/MEDICATION-SERVICES.md#1`

### 2.02 Stored XSS in the Care Team card — High
- **Location:** `templates/patient/card/manage_care_team.html.twig:64-65,72-73` (verified, U-5)
- **Description:** `member.note` and `provider_since` are interpolated into `row.innerHTML` without escaping. Combined with 3.05 (no write ACL on save), any user who can open the dashboard can store content there. Impact: script stored in a care-team note runs in every viewer's session on the dashboard.
- **Mitigation:** Build rows with `textContent` / DOM nodes, or escape before insertion. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out. Care Team fields render through the framework's text binding, never raw HTML.
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#4`

### 2.03 Logout redirect validation: open redirect and whole-string URI compare — Medium
- **Location:** `src/RestControllers/AuthorizationController.php:1469-1475` (`userSessionLogout`), `:1488`, `:358`
- **Description:** When no trusted-user row matches, logout redirects to the supplied post-logout URI without checking the client's registered URIs. When it does check, it compares against the whole stored `logout_redirect_uris` string, so a client with several registered URIs never matches. Impact: OpenEMR's logout can forward users to an arbitrary site, which aids phishing.
- **Mitigation:** Validate against the parsed per-URI list before any redirect; URL-encode `state`. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF registers exactly one post-logout URI.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#3`, `modules/AUTHORIZATION-CONTROLLER.md#8`

### 2.04 Twig autoescape disabled globally; card templates rely on manual escaping — Medium
- **Location:** `src/Common/Twig/TwigContainer.php:70` (`autoescape => false`); `templates/patient/card/card_base.html.twig:1,8,11`; `templates/patient/card/rx.html.twig:11`
- **Description:** `card_base` concatenates `btnLink` into a raw `onclick` attribute with no filter, and emits the class-list and color variables unescaped. `rx.html.twig` splices captured Smarty HTML. Today every value reaching these sinks is server-built from configuration or enums, or escaped upstream, so there's no known exploit path. Impact: one future card that passes patient- or request-derived data becomes stored XSS. Kept Medium: not exploitable as written.
- **Mitigation:** Route `btnLink` through `js_escape`/`attr` or drop inline handlers; add `|attr` to the class and color variables; turn autoescape on for new templates. *Disposition:* fix in legacy.
- **Port relevance:** port designs it out (framework auto-escaping, no inline handlers).
- **Sources:** `ui/CARD-TEMPLATES.md#4`, `ui/CARD-TEMPLATES.md#5`, `ui/PRESCRIPTION-TEMPLATES.md#6`

### 2.05 CSRF token in GET URLs; web root echoed unescaped into JS — Low
- **Location:** `interface/patient_file/summary/demographics.php:419-423`, `:658-664`
- **Description:** The CSRF token appears in GET URLs (the dead `deleteme` path and the CDR rule-review launch). The web root, a configuration value, is echoed into JS without `js_escape`. Impact: the token leaks through history, logs and `Referer`.
- **Mitigation:** Send the token in a POST body or header; `js_escape` the web root. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#20`

### 2.06 Input validation at write boundaries is partial (e.g. SSN) — Medium
- **Location:** data-entry forms app-wide; validators exist only in places (`src/Validators/`, FHIR services)
- **Description:** Many demographic and clinical fields accept any value. Impact: malformed data reaches the database and every later reader, including the API the port uses.
- **Mitigation:** Validate server-side at every write boundary with shared rules. *Disposition:* fix in legacy; out of port scope (the port doesn't write).
- **Port relevance:** not on the port path for writes. The BFF still validates API responses at its boundary and shows invalid values as-is rather than crashing.
- **Sources:** `BASELINE-ERRORS.md#B-03`, `project/WHATS-MISSING.md#Input validation at boundaries (OpenEMR)`

## 3. Security: Authorization & Permissions

### 3.01 `set_pid` switches the session patient, audits and runs CDR before authorization — High
- **Location:** `interface/patient_file/summary/demographics.php:84-94` vs ACL gate `:1056` and squad check `:1069`; `src/Common/Session/PatientSessionUtil.php:44-81` (verified, U-6)
- **Description:** Before any authorization check, `set_pid` sets the session patient, writes an audit "view" and a recent-patients entry, and runs the CDR checks. The later squad check doesn't undo the switch, and session-scoped fragment endpoints then serve that patient. Impact: a user without access to a patient can make that patient the session patient, and session-scoped endpoints then serve that patient's data.
- **Mitigation:** Authorize (role and squad) before `setpid`, and don't audit a view that's then denied. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out. There is no session patient: every call carries an explicit patient id and is authorized by OAuth scope plus ACL.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#2`

### 3.02 Patient identity is emitted before the page ACL gate — High
- **Location:** `interface/patient_file/summary/demographics.php:916-967` (`setMyPatient`) vs `:1056-1061` (verified, U-7)
- **Description:** Name, pubpid, DOB or age, and the full encounter list are written into `<head>` JS, along with the CSRF token, before the `patients/demo` check runs. A denied user sees "Not Authorized" but already has these values in the page source. Impact: PHI is disclosed to users who lack `patients/demo`.
- **Mitigation:** Run the gate before any patient read or output. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out. Each API call is authorized before data returns, and the SPA renders nothing from a failed call.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#1`, `ui/DEMOGRAPHICS-PART2-CARDS.md#2`

### 3.03 Dashboard fragment endpoints run no ACL check — High
- **Location:** `interface/patient_file/summary/vitals_fragment.php:15-21`; `labdata_fragment.php:17-22`; `track_anything_fragment.php:19-21`; `clinical_reminders_fragment.php:22-24`; `patient_reminders_fragment.php:21-23`; `stats.php:25`, `:273-314` (immunizations; no page-level check); client-side gating only at `demographics.php:626-631,635,715`. Contrast `pnotes_fragment.php:45` (verified, U-8)
- **Description:** The page decides by ACL whether to *fetch* each fragment, but the endpoints check only CSRF (a per-session token every logged-in user has) and read the session patient. `stats.php` checks `patients/med` per issue type, has no page-level `patients/demo` or squad check, and has no check at all for immunizations. Impact: any logged-in user can get vitals, labs, reminders and immunizations for the session patient without the matching ACL.
- **Mitigation:** Check the ACL at the top of each fragment (`patients/med` for vitals; page-level `patients/demo` plus squad in `stats.php`), as `pnotes_fragment.php` does. *Disposition:* fix in legacy.
- **Port relevance:** port designs it out. It calls API routes that enforce scope and ACL on every request.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#3`, `ui/VITALS-FRAGMENT.md#4`, `ui/STATS.md#6`

### 3.04 Squad restriction hides only the header — High
- **Location:** `interface/patient_file/summary/demographics.php:1068-1077` vs cards `:1089-2045`; sibling `demographics_full.php:68-69` denies (verified, U-9)
- **Description:** For a user who lacks the patient's squad ACL, the page hides the header and delete button but still renders every clinical card. Impact: users outside a patient's squad see that patient's allergies, problems, medications, prescriptions, care team and vitals.
- **Mitigation:** Treat a squad failure as a whole-page deny. *Disposition:* fix in legacy; out of port scope for enforcement (the API has no squad concept).
- **Port relevance:** port depends on it. The API ignores squads, so the port can't enforce them either. This is documented as an access-model difference (checkpoint decision).
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#1`

### 3.05 Care Team save has no write ACL — High
- **Location:** `src/Patient/Cards/CareTeamViewCard.php:47,124-147` (`handleFormSubmission`); `src/Services/CareTeamService.php` (`saveCareTeam`; no ACL call in the file) (verified, U-4)
- **Description:** The save POST checks CSRF but no ACL. The `patients/demo` write check only decides whether the Edit button renders. Impact: any user who can view the dashboard can change a patient's care team, and with 2.02 can store script there.
- **Mitigation:** Check `patients/demo` write at the top of `handleFormSubmission()` and in the service. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (the port is read-only).
- **Sources:** `ui/CARE-TEAM-CARD.md#1`, `modules/CARE-TEAM-SERVICES.md#6`

### 3.06 `controller.php` router: 7 of 10 controllers have no ACL — High
- **Location:** `library/classes/Controller.class.php:131-144` (`checkControllerAcl`); `controllers/C_Document.class.php:472,1147,1163` (verified, M-9)
- **Description:** `document_category`, `hl7`, `insurance_company`, `insurance_numbers`, `patient_finder`, `pharmacy` and `x12_partner` have no router ACL entry and no checks inside their `C_*` classes. `document` has no router entry but checks internally, a split pattern invisible from the router map that a refactor could silently drop. Not yet checked live. Impact: any authenticated user can invoke every action of those seven controllers, including patient search and the insurance and pharmacy controllers.
- **Mitigation:** Default-deny in `checkControllerAcl`: every entry in `VALID_CONTROLLERS` needs an ACL, plus per-action checks. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `modules/LEGACY-ROUTER-AND-LISTS.md#1`, `modules/LEGACY-ROUTER-AND-LISTS.md#2`

### 3.07 `controller.php` ACL has no per-action or write level; Rx edit list reachable at view level — Medium
- **Location:** `library/classes/Controller.class.php:138`; `controllers/C_Prescription.class.php:176-187` (`list_action`); `interface/patient_file/summary/demographics.php:1219`; `templates/prescription/general_list.html.twig:364,418,449`
- **Description:** For `prescription` and `practice_settings`, the router runs one generic check per dispatch, with no access level. The Rx edit list is therefore reachable with base `patients/rx` (view) and renders Edit/Delete/Add controls regardless. Unverified: whether `edit_action` and `library/deletedrug.php` re-check write access. Impact: view-only users reach the edit UI, and if the write endpoints don't re-check, they can change prescriptions.
- **Mitigation:** Check the ACL per action with write/addonly levels; hide controls the user can't use. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `modules/LEGACY-ROUTER-AND-LISTS.md#3`, `ui/PRESCRIPTION-TEMPLATES.md#5`

### 3.08 `pnotes_fragment.php` writes before its ACL check — Medium
- **Location:** `interface/patient_file/summary/pnotes_fragment.php:34-36` vs `:45`; trigger `demographics.php:613-624`
- **Description:** "Completed" on a note runs `disappearPnote` before the `patients/notes` check. The click needs no confirmation (7.11). Impact: a user without `patients/notes` can hide a patient's note.
- **Mitigation:** Check the ACL before the write, and add a confirmation step. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (Messages is out of scope; the port is read-only).
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#12`

### 3.09 eRx SOAP import endpoints have no CSRF or ACL check — Medium
- **Location:** `interface/patient_file/summary/demographics.php:547-603`; `interface/soap_functions/soap_patientfullmedication.php:31-73`
- **Description:** The dashboard POSTs to the SOAP import endpoints by synchronous XHR without a CSRF token. The endpoints check neither CSRF nor ACL and take the patient from `$_REQUEST`. A synchronous `top.restoreSession()` in the same ready handler also aborts later dashboard JS outside the shell (see 7.03). Impact: any logged-in user, or a same-site request, can trigger an eRx medication import for any patient id.
- **Mitigation:** Add CSRF and ACL checks to the endpoints, take the patient from a validated context, make the calls async, and guard `restoreSession`. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (eRx is out of scope).
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#7`

### 3.10 `PUT /api/patient/:pid/medication/:mid` updates `lists` by id only — Medium
- **Location:** `src/Services/ListService.php:211-229`
- **Description:** The `UPDATE` uses `WHERE id=?` and ignores both the route's `:pid` and the list type. Impact: a caller with write scope can modify another patient's issue row, of any type, by id.
- **Mitigation:** Add `pid` and `type` to the `WHERE` clause. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (read-only).
- **Sources:** `modules/MEDICATION-SERVICES.md#13`

### 3.11 Medication and prescription write routes check `patients/med` with no write level — Medium
- **Location:** `apis/routes/_rest_routes_standard.inc.php:305-328,672-679`; `src/RestControllers/Config/RestConfig.php:180-187`
- **Description:** Mutating routes use the same read-level ACL as the read routes. Impact: users with read-only clinical access can modify medications and prescriptions if their token has a write scope.
- **Mitigation:** Pass the write/addonly ACL level on mutating routes. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `modules/MEDICATION-SERVICES.md#14`

### 3.12 Patient-context API requests skip the ACL entirely (provisional) — Medium
- **Location:** `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php:259-265,434-454,479-485`; `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:75-81,146-152,472-478`; `src/RestControllers/FHIR/FhirGenericRestController.php:94-102`
- **Description:** Requests made with a `patient/`-scope token bypass gacl and rely only on the patient bound to the token. Whether that binding holds on every route hasn't been checked live. Impact: for these requests, authorization rests entirely on the token's patient binding.
- **Mitigation:** Confirm that every patient-context route enforces the binding. *Disposition:* fix in legacy (verify first).
- **Port relevance:** not on the port path. The BFF requests only `user/` scopes.
- **Sources:** `modules/API-ROUTES.md#6`

### 3.13 User-scope collection routes are not scoped to a patient — Medium
- **Location:** `apis/routes/_rest_routes_standard.inc.php:76-104` (`GET /api/patient`), `:209-219` (`GET /api/medical_problem`); `src/Services/PatientService.php:392-523`; `src/RestControllers/ConditionRestController.php:74-83,190-194`; `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php:365-396`
- **Description:** With `user/` scopes, these routes return every patient's rows behind one ACL (`patients/demo` or `encounters/notes`). `PatientService::search()` applies no default scoping, and the documented filters are dead: live, `/api/patient?pubpid=13` returned all 13 patients. Impact: any user token with the scope reads the full patient list and every medical problem, with no minimum-necessary limit.
- **Mitigation:** Require a patient parameter on clinical collection routes, and add facility or provider scoping where policy needs it. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out. The BFF calls only patient-keyed routes (`/api/patient/:puuid`, `/api/patient/:puuid/...`) and never the unscoped collections.
- **Sources:** `modules/PATIENT-SERVICES.md#3`, `modules/PATIENT-SERVICES.md#4`, `modules/CONDITION-SERVICES.md#6`

### 3.14 Dashboard card ACLs and API route ACLs differ — Medium
- **Location:** `interface/patient_file/summary/demographics.php:1098` (Rx card: `patients/rx`), `:1270` (Care Team: `patients/demo`); `apis/routes/_rest_routes_standard.inc.php:210,216,222` (`medical_problem` list routes: `encounters/notes`) vs `:227` (single item: `patients/med`), `:665` (`/api/prescription`: `patients/med`); FHIR `CareTeam`: `patients/med`
- **Description:** The same data needs different ACLs on the dashboard and on the API, and even within one API resource (the Medical Problems list and item routes differ; re-read now). Downgraded from High: each route still enforces an ACL, so this changes who can see what rather than bypassing authorization. Impact: a user can see a card on one surface and be denied on the other, and the port's visibility won't match the PHP page.
- **Mitigation:** Align route ACLs with the card ACLs upstream. *Disposition:* fix in legacy; the port documents "who can see" per card.
- **Port relevance:** port depends on it. The BFF's user role needs `patients/med`, `encounters/notes` and `encounters/auth_a`, and each card handles 403 on its own.
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#19`, `modules/API-ROUTES.md#5`, `modules/CONDITION-SERVICES.md#2`

### 3.15 CORS reflects any `Origin` with credentials allowed — Low
- **Location:** `src/RestControllers/Subscriber/CORSListener.php:49-57,67,73`
- **Description:** Every response reflects the request's `Origin` and sets `Access-Control-Allow-Credentials: true`. API auth is bearer, not cookie, so the impact is latent. Impact: a cookie-authenticated route behind this listener would become readable cross-origin.
- **Mitigation:** Use a configurable origin allow-list with `Vary: Origin`; never pair credentials with reflection. *Disposition:* fix in legacy.
- **Port relevance:** port designs it out (same-origin BFF; no CORS).
- **Sources:** `modules/CORS-LISTENER.md#2`, `modules/CORS-LISTENER.md#4`

### 3.16 `set_pid` / `set_encounterid` change state on GET with no CSRF token — Low
- **Location:** `interface/patient_file/summary/demographics.php:84-94`; `src/Common/Session/SessionConfigurationBuilder.php:25` (`SameSite=Strict`)
- **Description:** Cross-site requests are blocked by `SameSite=Strict`; same-site links are not. Impact: a same-site link can switch a user's patient context.
- **Mitigation:** Use POST with a token for context switches. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out (no session patient).
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#13`

### 3.17 Several cards have no ACL beyond the page gate — Low
- **Location:** `src/Patient/Cards/BillingViewCard.php:32`; `interface/patient_file/summary/demographics.php:1280,1306,1641,1663,2030`
- **Description:** Billing, Treatment Preferences, Care Experience, Photos, Advance Directives and Tracks render for anyone with `patients/demo`. Impact: billing and advance-directive details reach users without a specific ACL for them.
- **Mitigation:** Add per-card ACLs. *Disposition:* out of port scope (catalog only).
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#18`

### 3.18 Data routes don't check the `rest_api` / `rest_fhir_api` enable flags — Low
- **Location:** `src/RestControllers/Subscriber/OAuth2AuthorizationListener.php:101-109`
- **Description:** The enable flags are checked on the OAuth path, not on data routes. Impact: switching an API off in globals may not stop data access for tokens that already exist.
- **Mitigation:** Check the flags on every data route. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it (both APIs are enabled by configuration).
- **Sources:** `modules/API-ROUTES.md#14`

## 4. Disabled or Half-Implemented Features

### 4.01 CORS preflight branch never runs — High
- **Location:** `src/RestControllers/Subscriber/CORSListener.php:20,36-40,66-70`; `src/RestControllers/Subscriber/RoutesExtensionListener.php:28`; `HttpRestParsedRoute.php:72`; `src/Common/Http/HttpRestRouteHandler.php:98`; `src/RestControllers/ApiApplication.php:90-91`; `tests/` (no CORS test) (verified, M-3, **live**: `OPTIONS` → 404)
- **Description:** The route listener runs before the CORS listener, so every preflight gets 404 and the preflight code is dead. Inside that dead branch, `Access-Control-Allow-Methods` is written as two positional array entries, and the allowed headers omit `apicsrftoken` and `prefer`. No kernel-level test covers the listener. Impact: no cross-origin browser client can send `Authorization` to the API.
- **Mitigation:** Raise the CORS listener's priority above routing, fix the header array and list, and add a kernel test for `OPTIONS` with `Origin`. *Disposition:* fix in legacy (upstream); design out in port.
- **Port relevance:** port designs it out. The BFF serves the SPA same-origin.
- **Sources:** `modules/CORS-LISTENER.md#1`, `modules/CORS-LISTENER.md#3`, `modules/CORS-LISTENER.md#5`, `modules/CORS-LISTENER.md#6`

### 4.02 Empty-state wording depends on `lists_touch`, which has no API — Medium
- **Location:** `templates/patient/card/allergies.html.twig:27-37`; `templates/patient/card/medical_problems.html.twig:7-15`; `interface/patient_file/summary/demographics.php:1128,1152,1174`
- **Description:** Whether a card says "No Known Allergies"/"None" or "Nothing Recorded" depends on whether the list was ever "touched", not on the data. "No Known Allergies" can appear for a patient with resolved allergies. No REST or FHIR route exposes `lists_touch`. Impact: the empty state can mislead, and the port can't reproduce it.
- **Mitigation:** Derive the empty state from data. *Disposition:* design out in port ("Nothing Recorded" for empty lists, a decided rule); legacy fix optional.
- **Port relevance:** port designs it out (documented parity deviation).
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#8`, `modules/LEGACY-ROUTER-AND-LISTS.md#6`

### 4.03 Allergies card promises severe allergies pinned to the top; not implemented — Medium
- **Location:** `templates/patient/card/allergies.html.twig:6-11,38-49`; `src/Services/AllergyIntoleranceService.php:51-103`; `critical_allergy_item_class_list` has no reader
- **Description:** The template docblock says severe, life-threatening and fatal allergies always render at the top regardless of overflow, and describes an override hook. The code only highlights them, and the service has no `ORDER BY`, so row order is whatever the database returns. Kept Medium (the tier-2 reviewer asked to escalate): severe rows are still highlighted. Impact: a fatal-severity allergy can sit below the fold, against the template's stated purpose.
- **Mitigation:** Implement the documented sort, or correct the docblock. *Disposition:* fix in legacy; the port follows the decided parity rule.
- **Port relevance:** port depends on it. The decided rule is to highlight severe allergies only and preserve API order, with no invented sort.
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#9`, `ui/CARD-TEMPLATES.md#2`

### 4.04 Identity bar has no sex or active status — Medium
- **Location:** `interface/main/tabs/js/patient_data_view_model.js:22-28`; `interface/main/tabs/js/frame_proxies.js:27-54`
- **Description:** The shell's view model has no field for sex or status, so a literal DB-02 parity reading can't show them. Impact: the port has to decide on a header the legacy app never had.
- **Mitigation:** Show sex and status from FHIR `Patient`. Derive status from `deceasedDateTime`, because `Patient.active` is always `true`. *Disposition:* design out in port.
- **Port relevance:** port designs it out (documented parity gap).
- **Sources:** `ui/DASHBOARD-HEADER.md#1`

### 4.05 `/api/patient/:pid/medication` doesn't join `lists_medication` — Medium
- **Location:** `src/Services/ListService.php:50`
- **Description:** The route returns bare `lists` rows, so fields stored in `lists_medication` are missing. Impact: API consumers get a thinner medication record than the database holds.
- **Mitigation:** Reuse `PatientIssuesService::search` for this route. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The Medications list comes from this route. Since slice 01-06-04, `drug_dosage_instructions` is joined in from FHIR `MedicationRequest` (`intent=plan`, by uuid), which does read `lists_medication`.
- **Sources:** `modules/MEDICATION-SERVICES.md#5`

### 4.06 `PatientService::findByPid()` has no REST or FHIR route — Medium
- **Location:** `src/Services/PatientService.php:655-666`
- **Description:** The API can't look up a patient by integer pid. Impact: pid-keyed deep links, like the legacy `set_pid`, can't be resolved through the API.
- **Mitigation:** Key deep links by uuid. *Disposition:* design out in port.
- **Port relevance:** port designs it out (routes use the patient uuid).
- **Sources:** `modules/PATIENT-SERVICES.md#2`

### 4.07 Care Team card shows only one team per patient — Medium
- **Location:** `src/Services/CareTeamService.php:652-661` (`getCareTeamData`; the `TODO` at `:652` acknowledges this)
- **Description:** The card returns the first active team, or else the first team, although the schema supports several. Impact: a patient's other care teams are invisible on the dashboard.
- **Mitigation:** Rework `getCareTeamData`/`saveCareTeam` for multiple teams. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. FHIR `CareTeam` returns every team, so the port applies a documented selection rule.
- **Sources:** `ui/CARE-TEAM-CARD.md#2`

### 4.08 FHIR `_sort`, `_count` and `_offset` are silently ignored — Medium
- **Location:** `src/Services/FHIR/FhirServiceBase.php:262-269,313-316`; `src/Services/FHIR/Traits/ResourceServiceSearchTrait.php:53-64`; affects `AllergyIntolerance`, `Condition` and vital-signs `Observation`
- **Description:** The parameters are accepted without error and have no effect. Impact: clients that rely on paging or sort get unsorted full result sets.
- **Mitigation:** Implement them, or reject them with an `OperationOutcome`. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The port never relies on FHIR paging or sort; it sorts client-side.
- **Sources:** `modules/ALLERGY-SERVICES.md#2`, `modules/CONDITION-SERVICES.md#7`, `modules/VITALS-SERVICES.md#2`

### 4.09 Documented REST query filters are ignored — Medium
- **Location:** `src/RestControllers/AllergyIntoleranceRestController.php:90-133` vs `apis/routes/_rest_routes_standard.inc.php:253,255,265,267`; `src/RestControllers/ConditionRestController.php:88-189` vs routes `:209-224`
- **Description:** The documented `title`/`begdate`/`enddate`/`diagnosis` filters don't filter. Impact: clients that trust the documented filters get unfiltered data.
- **Mitigation:** Implement the filters, or remove them from the documentation. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The port fetches everything and filters client-side.
- **Sources:** `modules/ALLERGY-SERVICES.md#4`, `modules/CONDITION-SERVICES.md#10`

### 4.10 `/api/prescription` has no working documented patient filter — Medium
- **Location:** `src/Services/PrescriptionService.php:56-85,171,225,308-313`
- **Description:** The route's contract has no patient parameter, and the `patient.uuid` branch can't be reached from HTTP. Only the undocumented `patient_id` and `pid` keys scope the result. Impact: clients depend on an undocumented contract, and a call without a filter returns every patient's prescriptions.
- **Mitigation:** Add a required, allow-listed patient (uuid) parameter, and replace the dead branch with a real puuid filter. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF sends only `patient_id` (see 2.01).
- **Sources:** `modules/API-ROUTES.md#7`, `modules/MEDICATION-SERVICES.md#3`, `modules/MEDICATION-SERVICES.md#12`

### 4.11 Consent "Cancel" is `history.back()` — Low
- **Location:** `scope-authorize.html.twig:298`; `src/RestControllers/SMART/SMARTAuthorizationController.php:227-235`
- **Description:** Cancel never returns `error=access_denied` to the client. Impact: the client is left waiting with no answer.
- **Mitigation:** Redirect with `error=access_denied` and `state`. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF expires pending authorizations and offers a retry.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#16`

### 4.12 `hide_dashboard_cards` is not honored for `stats.php` cards — Low
- **Location:** `interface/patient_file/summary/demographics.php:101,138-147`; `interface/patient_file/summary/stats.php`
- **Description:** The admin setting that hides dashboard cards applies only to cards rendered by `demographics.php`, not to cards rendered by `stats.php`. Impact: admins can't hide Health Concerns, Immunizations and similar cards.
- **Mitigation:** Pass the hidden-card list into `stats.php`. *Disposition:* out of port scope (catalog only).
- **Port relevance:** port designs it out. `hide_dashboard_cards` is "not available via API" (documented).
- **Sources:** `ui/STATS.md#5`

## 5. Data Integrity & Concurrency

### 5.01 Vitals card can show a deleted vitals set as current — Critical
- **Location:** `interface/patient_file/summary/vitals_fragment.php:27` (verified, U-1, code+SQL; re-read now); card `demographics.php:1507-1530`; schema `sql/database.sql:2418-2478`
- **Description:** The fragment picks the newest `form_vitals` row that has *some* `forms` row with the same `form_id` and `deleted != '1'`. The join is on `form_id` alone, with no `formdir='vitals'` and no matching `pid`, and `forms.form_id` is unique only within a `formdir`. A deleted vitals set therefore passes whenever a form of another type, for any patient, shares its numeric id. Reproduced: pid 13 shows set 28 (deleted, `forms.id` 1438) because `form_id` 28 also belongs to a non-deleted `procedure_order` (pid 4) and `newpatient` (pid 5). Such collisions are common: 355 of 1,438 `forms` rows share a `form_id` with a different `formdir` (D-5). The root schema design (D-5): `form_vitals` has no deleted column, and the soft-delete flag is reachable only through the non-unique `forms.form_id`. Impact: the dashboard labels a set that a clinician deleted as "Most recent vitals", and nothing on the page shows otherwise.
- **Severity decision:** Critical (see Summary).
- **Mitigation:** Join on `form_id` **and** `formdir='vitals'` **and** `pid`, or select through `forms` with `formdir='vitals' AND deleted=0` as `VitalsService.php:448-449` does. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out. Vitals uses the REST per-encounter route, which filters `deleted=0` and `formdir='vitals'`. This is the decided, intentional parity deviation (DB-08, [`walkthroughs/VITALS.md`](walkthroughs/VITALS.md)).
- **Sources:** `ui/VITALS-FRAGMENT.md#1`, `ui/DEMOGRAPHICS-PART2-CARDS.md#5`, `data/SCHEMA.md#D-5`

### 5.02 FHIR vital-signs Observations include deleted sets, marked `final` — Critical
- **Location:** `src/Services/FHIR/Observation/FhirObservationVitalsService.php:441` (calls `VitalsService::search()` with no deleted field), `:57` (`VITALS_DEFAULT_OBSERVATION_STATUS = "final"`); `src/Services/VitalsService.php:85-200` (joins `forms` on `formdir='vitals'`, no deleted predicate) (verified, M-5, code+SQL; re-read now)
- **Description:** The FHIR search path doesn't filter `forms.deleted` and offers no search parameter to do so, and every Observation it returns has status `final`. The REST per-encounter paths do add `deleted=0` (`VitalsService.php:448,464,509`). This is a different defect from 5.01 (a missing predicate, not a wrong join) on the same schema design (D-5, filed under 5.01). Impact: every FHIR client (SMART apps, patient-facing apps, integrations) receives retracted measurements as final results and cannot tell them apart.
- **Severity decision:** Critical (see Summary).
- **Mitigation:** Add a default `deleted=0` search field to the FHIR vitals search (or map deleted sets to `entered-in-error`). *Disposition:* fix in legacy (upstream report); design out in port.
- **Port relevance:** port designs it out. The port doesn't use FHIR for Vitals.
- **Sources:** `modules/VITALS-SERVICES.md#1`

### 5.03 Rx `active` filter never fires; saving an edit re-activates a stopped prescription — High
- **Location:** `src/Common/ORDataObject/ORDataObject.php:137` (`populate_array` skips `empty()` values); `library/classes/Prescription.class.php:149,241`; `templates/prescription/general_fragment.html:12-28`; `templates/prescription/general_edit.html.twig:155` (verified, U-3, code)
- **Description:** `populate_array()` skips empty values, so `active=0` never overrides the default `1`. The card's `active > 0` filter excludes nothing (stopped prescriptions show), and the edit form's Active checkbox is always checked, so saving an edit re-activates a stopped prescription. There is also a latent problem: the "None" empty state counts unfiltered rows, so if the filter worked, an all-inactive list would render a header-only table. Verified by code read, not reproduced (there are no `active=0` rows locally). This was considered for Critical and kept High because it's only code-verified and needs an edit of a stopped prescription. Impact: a stopped prescription can silently become active again through a routine edit.
- **Mitigation:** Populate with `array_key_exists` instead of `empty()`, fix the checkbox binding, and base the empty state on the filtered set. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The decided rule shows **all** rows, sorted `active DESC, date_modified DESC, date_added DESC`, with the active flag visible.
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#3`, `ui/DEMOGRAPHICS-PART2-CARDS.md#11`

### 5.04 Async fragments carry no patient id — High
- **Location:** `interface/patient_file/summary/demographics.php:494-513` (`fetchHtml`); every fragment reads `$session->get('pid')` (verified, U-11, code)
- **Description:** Every async card fetch, and the notes "Completed" reload, uses whatever session patient exists at fetch time. If another tab switches patient during the 3–5 s load, patient B's cards render under patient A's heading. The code path is verified; the race wasn't reproduced. Impact: one patient's clinical data can be shown under another patient's identity.
- **Mitigation:** Send and verify an explicit patient id on every request. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out ("must not survive"). Every BFF and API call carries the patient uuid from the route, and the SPA discards a response for any other patient.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#5`

### 5.05 Care-team member status not propagated; FHIR `CareTeam` shows inactive members as active — High
- **Location:** `src/Services/CareTeamService.php:177,215` (status selected, never read), `getCareTeamProviders`/`getCareTeamFacilities`/`getCareTeamContacts`; `src/Services/FHIR/FhirCareTeamService.php:345` (only `period.start`); `sql/database.sql:14796-14812` (verified, M-6, code+SQL)
- **Description:** `care_team_member.status` is honored by one of three read paths (`getCareTeamData`, which backs the PHP card). The provider, facility and contact readers behind FHIR ignore it, and FHIR members carry no status at all. Impact: API consumers see former care-team members as current.
- **Mitigation:** Filter or map the status (for example, `participant.period.end`). *Disposition:* fix in legacy (upstream).
- **Port relevance:** port depends on it. This is an unavoidable parity break for DB-07; member status is "not available via API".
- **Sources:** `modules/CARE-TEAM-SERVICES.md#1`, `data/SCHEMA.md#D-8`, `modules/CARE-TEAM-SERVICES.md#3`

### 5.06 `refills` never selected; FHIR reports 0 — High
- **Location:** `src/Services/PrescriptionService.php:95-188`; `src/Services/FHIR/FhirMedicationRequestService.php:319` (verified, M-7, code)
- **Description:** `refills` is not in the select, so FHIR `numberOfRepeatsAllowed` is always **0** (wrong, not missing), and REST omits the field. Impact: API consumers are told a prescription has no refills when it may have some.
- **Mitigation:** Select `prescriptions.refills` (NULL for `lists` rows) and map it only when present. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. Refills are "not available via API", and the port never displays FHIR's 0.
- **Sources:** `modules/MEDICATION-SERVICES.md#4`

### 5.07 FHIR `Condition` drops the coded diagnosis; `clinical-status` targets a missing column — High
- **Location:** `src/Services/FHIR/Condition/FhirConditionProblemListItemService.php:102,129-181`; `src/Services/FHIR/Condition/Trait/FhirConditionTrait.php:102-118,136-158`; `src/Services/ConditionService.php:101-108`; `src/Services/Search/SearchFieldStatementResolver.php:224-260` (verified, M-8, code)
- **Description:** Problem-list Conditions never carry `code`, because the diagnosis isn't mapped, and the `clinical-status` search parameter maps to a column that doesn't exist. Impact: FHIR consumers get problems without codes, and searches by clinical status fail.
- **Mitigation:** Map `lists.diagnosis` to `Condition.code`, and fix the parameter mapping. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path. Problems uses REST and the card shows the title only; the port never sends `clinical-status`.
- **Sources:** `modules/CONDITION-SERVICES.md#1`, `modules/CONDITION-SERVICES.md#4`

### 5.08 `filterActiveIssues()` ignores `activity` and disagrees with FHIR `clinicalStatus` — Medium
- **Location:** `interface/patient_file/summary/demographics.php:1110-1113`; `src/Services/FHIR/FhirAllergyIntoleranceService.php:117-122`
- **Description:** The PHP rule is `outcome != 1 && (!enddate || enddate > now)`. It ignores `lists.activity` (so disappeared issues still show) and hides an issue from midnight of its end date. FHIR `clinicalStatus` disagrees with it on 2 of 5 combinations. Impact: the "active" set differs between the dashboard and API consumers.
- **Mitigation:** Define one rule. *Disposition:* design out in port (replicate the PHP rule exactly on raw REST fields); legacy fix optional.
- **Port relevance:** port depends on it (the decided parity rule).
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#10`, `modules/ALLERGY-SERVICES.md#5`

### 5.09 `set_pid` and `set_encounterid` are not validated — Medium
- **Location:** `interface/patient_file/summary/demographics.php:86-94,954-964`; `src/Common/Database/QueryUtils.php:342-344`; `src/Services/PatientService.php:939`
- **Description:** A non-existent or non-numeric pid still switches the session and writes an audit row, then `touchRecentPatientList(null)` throws a `TypeError` (source-derived). `set_encounterid` is stored without checking that it belongs to `set_pid`. Impact: audit rows for patients that don't exist, and a session encounter that can belong to another patient.
- **Mitigation:** Validate that the patient exists and that the encounter's `pid` matches before switching. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out. The BFF resolves `pid`/`eid` from the patient's own responses.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#8`, `ui/DEMOGRAPHICS-PART1-BOOT.md#9`

### 5.10 `severity_al='1'` is not a defined severity code — Medium
- **Location:** `lists.severity_al` data (2 of 3 local allergy rows); `sql/database.sql:5389-5396`; `src/Common/Layouts/LayoutsUtils.php:17-24` (fallback returns the raw code); `src/Services/FHIR/FhirAllergyIntoleranceService.php:138-152`; `FHIRAllergyIntoleranceCriticality.php:95-99`
- **Description:** `'1'` isn't a `severity_ccda` option, so the card shows "(1)" and FHIR criticality has no mapping for it. Impact: severity is unreadable on the card and missing in FHIR for these rows.
- **Mitigation:** Clean up the data or define the code; log unmapped codes. *Disposition:* out of port scope (data quality; catalog only).
- **Port relevance:** port depends on it. The port shows the raw value as-is ("(1)"), documented.
- **Sources:** `data/SCHEMA.md#D-3`, `ui/LAYOUTS-UTILS.md#3`, `modules/ALLERGY-SERVICES.md#3`

### 5.11 Height stored in cm in an inches column — Medium
- **Location:** `form_vitals.height`; `interface/forms/vitals/report.php:112-124`; `interface/forms/vitals/vitals.js:129`
- **Description:** The Synthea import wrote cm values (40–183) into a column OpenEMR treats as inches, and there's no unit column. The report correctly renders "170.3 in (432.60 cm)". Impact: implausible heights are displayed as fact.
- **Mitigation:** Fix the import (convert, or tag the source unit) and clean the data. *Disposition:* out of port scope (data; catalog only).
- **Port relevance:** port depends on it. The data is shown as-is, with the units from the REST `<field>_unit` keys.
- **Sources:** `data/SCHEMA.md#D-6`, `ui/VITALS-FRAGMENT.md#3`

### 5.12 `lists.outcome=6` is not a defined outcome — Medium
- **Location:** `sql/database.sql:4401-4406` vs local data (246 of 249 `medical_problem` rows)
- **Description:** The value is outside the defined outcome list, so its title lookup is blank, and it counts as active under `filterActiveIssues()`. Impact: rows appear active with a blank outcome, and stricter validation would reject them.
- **Mitigation:** Clean up the data, or define the code. *Disposition:* out of port scope (catalog only).
- **Port relevance:** port depends on it (counted as active and shown as-is).
- **Sources:** `data/SCHEMA.md#D-2`

### 5.13 Prescription status is `completed` whenever an end date is set — Medium
- **Location:** `src/Services/PrescriptionService.php:180-184,234-238`
- **Description:** Any end date, including one in the future, yields `completed`. Impact: ongoing prescriptions with a planned end date appear completed.
- **Mitigation:** Compare the end date with the current date. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path. The Rx card uses the `active` flag, not the derived status.
- **Sources:** `modules/MEDICATION-SERVICES.md#6`

### 5.14 `dosageInstruction.text` drops a numeric dosage — Medium
- **Location:** `src/Services/FHIR/FhirMedicationRequestService.php:255,264-266`
- **Description:** The fallback isn't empty-aware, so a numeric dosage is lost from the text. Impact: FHIR consumers lose the dose.
- **Mitigation:** Use an empty-aware fallback. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (Rx uses REST).
- **Sources:** `modules/MEDICATION-SERVICES.md#7`

### 5.15 `parseSuffixForPatientRecord()` writes to an undeclared local — Medium
- **Location:** `src/Services/PatientService.php:902-919`
- **Description:** The parsed suffix never reaches the returned record. Impact: FHIR `name.family` can still contain the suffix.
- **Mitigation:** Assign to the record being returned. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The header doesn't assume a suffix-free family name.
- **Sources:** `modules/PATIENT-SERVICES.md#1`

### 5.16 FHIR `Condition` without `category` queries all three condition services — Medium
- **Location:** `src/Services/FHIR/FhirConditionService.php:93-111`
- **Description:** Problem-list items, encounter diagnoses and health concerns come back mixed. Impact: clients get non-problem-list conditions unless they filter by category.
- **Mitigation:** Always pass `category` explicitly; document the behavior. *Disposition:* out of port scope (catalog only).
- **Port relevance:** not on the port path (Problems uses REST).
- **Sources:** `modules/CONDITION-SERVICES.md#3`

### 5.17 Services return rows with no `ORDER BY` (allergies, conditions, care teams) — Medium
- **Location:** `src/Services/AllergyIntoleranceService.php:52-98,155-158`; `src/Services/ConditionService.php:44-84`; `src/Services/FHIR/Condition/FhirConditionProblemListItemService.php:129-184`; `src/Services/CareTeamService.php:87-121` vs `:550-582,653-661`
- **Description:** Row order is whatever the database returns. For Care Team, FHIR's team order can differ from the team the card picks. Impact: order is nondeterministic, and for Care Team so is which team appears first.
- **Mitigation:** Add explicit `ORDER BY` clauses. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The port sorts client-side where a rule is decided (conditions by `begdate` ascending, teams by name) and otherwise keeps API order.
- **Sources:** `modules/ALLERGY-SERVICES.md#7`, `modules/CONDITION-SERVICES.md#11`, `modules/CARE-TEAM-SERVICES.md#2`

### 5.18 FHIR allergy criticality coarsening doesn't match the card's severe highlight — Low
- **Location:** `src/Services/FHIR/FhirAllergyIntoleranceService.php:139-148` vs `templates/patient/card/allergies.html.twig:38`
- **Description:** FHIR's three-bucket criticality doesn't line up with the card's "severe" highlight. Impact: a FHIR-based card would highlight different rows.
- **Mitigation:** Read raw `severity_al` from REST for both the label and the highlight. *Disposition:* design out in port.
- **Port relevance:** port designs it out (REST allergies).
- **Sources:** `modules/ALLERGY-SERVICES.md#6`

### 5.19 FHIR quantity and dose values are truncated to integers — Low
- **Location:** `src/Services/FHIR/FhirMedicationRequestService.php:291-293,320-326`
- **Description:** `intval()` truncates decimal quantities and doses. Impact: FHIR consumers see a wrong dose (e.g. 0.5 becomes 0).
- **Mitigation:** Use decimal quantities and a dispense unit. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `modules/MEDICATION-SERVICES.md#16`

### 5.20 `request_intent_title` read but never selected — Low
- **Location:** `src/Services/PrescriptionService.php:363-369` vs `:102`
- **Description:** The field is read from a column the query never selects. Impact: the intent title is always empty.
- **Mitigation:** Read `intent_title`; drop the patch. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `modules/MEDICATION-SERVICES.md#11`

### 5.21 `DELETE …/medication/:mid` hard-deletes the `lists` row — Low
- **Location:** `src/Services/ListService.php:232-236`
- **Description:** The route deletes the row, unlike the soft-delete convention (`lists.activity`). Impact: the record and its history are lost.
- **Mitigation:** Soft-delete, or cascade deliberately. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `modules/MEDICATION-SERVICES.md#18`

### 5.22 `setListTouch()` SELECT-then-INSERT race — Low
- **Location:** `library/lists.inc.php:141-151`; `sql/database.sql:7744-7749`
- **Description:** The check and the insert aren't atomic. Impact: a second concurrent call hits an uncaught primary-key violation instead of doing nothing.
- **Mitigation:** Use `INSERT … ON DUPLICATE KEY UPDATE`. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `modules/LEGACY-ROUTER-AND-LISTS.md#4`

### 5.23 `ConditionService::search()` join to `issue_encounter` isn't deduplicated — Low
- **Location:** `src/Services/ConditionService.php:57-70`
- **Description:** A problem linked to several encounters can appear more than once. Impact: duplicate rows.
- **Mitigation:** Aggregate or `DISTINCT` the join. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The port dedupes by uuid client-side.
- **Sources:** `modules/CONDITION-SERVICES.md#5`

### 5.24 `get_document_by_catg` doesn't exclude deleted documents — Low
- **Location:** `interface/patient_file/summary/demographics.php:189-195` vs `:172`
- **Description:** Unlike `pic_array`, this lookup doesn't filter deleted documents. Impact: a deleted ID-card document can still show.
- **Mitigation:** Add `deleted = 0`. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#16`

### 5.25 Synthetic patient names carry digit suffixes (test data) — Low
- **Location:** `patient_data.fname` / `lname` (10 of 13 local patients)
- **Description:** This is Synthea test data, not a bug. No schema constraint prevents it.
- **Mitigation:** None needed. *Disposition:* out of port scope (catalog only).
- **Port relevance:** port depends on it (names shown as-is).
- **Sources:** `data/SCHEMA.md#D-1`, `BASELINE-ERRORS.md#B-11`

### 5.26 `lists.enddate` shares one bulk timestamp (Synthea artifact) — Low
- **Location:** `lists.enddate` (241 of 312 local rows = `2017-10-22 10:23:21`)
- **Description:** This is an import artifact, not per-row clinical data. Impact: these rows count as ended under `filterActiveIssues()`.
- **Mitigation:** None for the port. *Disposition:* out of port scope (catalog only).
- **Port relevance:** port depends on it (shown as-is; affects active counts).
- **Sources:** `data/SCHEMA.md#D-9`

### 5.27 Seeded care team's uuid is missing from `uuid_registry` — Low
- **Location:** `docs/legacy-audit/seed/phase1-seed.sql:19-22`
- **Description:** The seed calls raw `UUID()` and bypasses `UuidRegistry::createUuid()`. Impact: the assumption that `uuid_registry` lists every uuid-bearing row doesn't hold.
- **Mitigation:** Create seed uuids through the registry. *Disposition:* fix in legacy (the audit's seed script).
- **Port relevance:** port depends on it. The port doesn't assume the registry is complete.
- **Sources:** `data/UUID-MAPPING.md#2`

### 5.28 `GET /api/prescription/:uuid` validates against `prescriptions` only — Low
- **Location:** `src/Services/PrescriptionService.php:385-388`
- **Description:** The collection mixes `prescriptions` and `lists` rows, but single-item lookup accepts only the former. Impact: rows listed by the collection can't be fetched individually.
- **Mitigation:** Validate against the UNION, or document the mix. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (the port uses the collection only).
- **Sources:** `modules/MEDICATION-SERVICES.md#10`

### 5.29 Allergy REST route returns HTTP 500 for any allergy authored by a user — High
- **Location:** `src/Services/AllergyIntoleranceService.php:search()` (lines 58-60, 86, 95: `practitioner_uuid` / `organization_uuid` selected as `binary(16)`; only `uuid`, `puuid`, `patient_uuid` are converted at lines 114-116) (verified: local Apache log "Malformed UTF-8 characters" on `GET /api/patient/:puuid/allergy`, 2026-09-25, slice 01-06-01)
- **Description:** When `lists.user` names a real user (normal for clinician-entered allergies), the response carries that user's and facility's raw binary uuids; JSON encoding fails and the route returns 500. Synthea-imported allergies have no author, so the audit's Synthea data never triggered it; the dashboard's DASH-SYN seed (authored by `admin`) did. The legacy PHP card is unaffected (it renders via Twig, not JSON).
- **Mitigation:** Convert `practitioner_uuid` and `organization_uuid` with `UuidRegistry::uuidToString()` in `search()` like the other uuid columns. *Disposition:* fix in legacy (upstream patch; parked with the other backend fixes). For the demo the DASH-SYN allergy rows are authored by no user (`seed/prod-dashboard-seed.sql`), which hides this bug for those rows only.
- **Port relevance:** port depends on it: the Allergies card shows its explicit error state (never "Nothing Recorded") whenever this fires.
- **Sources:** `evidence/parity/README.md` (slice 01-06-01); orchestrator verification of the author difference (local and production rows, 2026-09-25)

## 6. Error Handling & Logging

### 6.01 API and OAuth errors return raw exception text, including SQL — Medium
- **Location:** `src/RestControllers/Subscriber/ExceptionHandlerListener.php:50-55`; `src/Common/Database/QueryUtils.php:226-230`; `apis/dispatch.php:41-44`; `src/RestControllers/AuthorizationController.php:624-629,1252-1257,1340-1342,1408-1416`
- **Description:** Exception messages go straight into the response body, on every API route (verified) and on several OAuth endpoints. Impact: database errors, SQL fragments and internal paths reach any caller.
- **Mitigation:** Return a generic message with a correlation id, and log the details server-side. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out. The BFF never forwards API error text; it logs a correlation id only.
- **Sources:** `modules/API-ROUTES.md#2`, `modules/MEDICATION-SERVICES.md#2`, `modules/AUTHORIZATION-CONTROLLER.md#6`

### 6.02 Standard REST validation and internal errors return HTTP 200 — Medium
- **Location:** `src/RestControllers/RestControllerHelper.php:204-221`; `src/RestControllers/Subscriber/ViewRendererListener.php:148-154`; allergy and problem routes `apis/routes/_rest_routes_standard.inc.php:209-276` (verified)
- **Description:** Errors come back as a 200 with `validationErrors`/`internalErrors` in the body. Impact: a failed call looks like a successful one.
- **Mitigation:** Return proper 4xx/5xx statuses. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF treats non-empty error arrays as errors and never renders them as "Nothing Recorded".
- **Sources:** `modules/API-ROUTES.md#3`

### 6.03 FHIR search errors become HTTP 200 bundles — Medium
- **Location:** `src/RestControllers/FHIR/FhirAllergyIntoleranceRestController.php:212-227`; `src/RestControllers/FHIR/FhirPatientRestController.php:730-743`; `src/RestControllers/FHIR/FhirGenericRestController.php:105-113,122-145`; `src/RestControllers/FHIR/FhirMedicationRequestRestController.php:205-220`; `src/Services/FHIR/FhirServiceBase.php:262-266,287-294,313-316`
- **Description:** Controllers ignore `ProcessingResult::isValid()`, so an invalid search yields an empty 200 `Bundle`. Impact: a failed query looks like "no data".
- **Mitigation:** Map errors to an `OperationOutcome` with a 4xx/5xx status. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it (Header and Care Team use FHIR). The BFF validates ids first and treats an unexpected empty bundle as an error.
- **Sources:** `modules/API-ROUTES.md#4`, `modules/MEDICATION-SERVICES.md#9`, `modules/VITALS-SERVICES.md#5`

### 6.04 `/api/patient/:pid/medication` returns 404 with an empty body for zero rows — Medium
- **Location:** `src/RestControllers/ListRestController.php:109-113`; `src/RestControllers/RestControllerHelper.php:158-166`
- **Description:** An empty collection is reported as "not found". Impact: clients can't tell "no medications" from a bad request.
- **Mitigation:** Return `200 []`. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF maps a 404 with an empty body on this route to an empty list (walkthrough checklist).
- **Sources:** `modules/MEDICATION-SERVICES.md#8`

### 6.05 Dashboard `fetchHtml` has no error handling — Medium
- **Location:** `interface/patient_file/summary/demographics.php:507-512,531-533`
- **Description:** There's no `response.ok` check and no `catch`. Error and CSRF-failure bodies render as card content, rejected fetches leave spinners, and there's no error state. Impact: errors look like content or hang.
- **Mitigation:** Check the status, catch failures, and render an error state. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out (explicit loading, error and empty states per card).
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#11`

### 6.06 API full logging stores request and response bodies (PHI) — Medium
- **Location:** `src/RestControllers/Subscriber/ApiResponseLoggerListener.php:314-338`; `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php:267`; `library/globals.inc.php:2893-2900`
- **Description:** With `api_log_option=2` ("Full Logging", the local value), every API request and response body, including clinical data, is stored in `api_log`. Local only; production unchecked. Impact: `api_log` becomes a second, less-guarded copy of PHI.
- **Mitigation:** Pick a production level that doesn't store bodies; restrict and expire `api_log`. *Disposition:* fix in legacy (configuration; production check).
- **Port relevance:** port depends on it. Every BFF call is logged according to this setting.
- **Sources:** `modules/API-ROUTES.md#8`, `data/CONFIG.md#3`

### 6.07 `ListService::getAll()` converts NULL uuids without a guard — Medium
- **Location:** `src/Services/ListService.php:27-30` (empty constructor, no back-fill), `:48-56` (re-read now)
- **Description:** Unlike other services, `ListService` doesn't back-fill uuids, and `getAll()` calls `UuidRegistry::uuidToString()` on every row with no NULL guard. Downgraded from High: latent, since 0 local `lists` rows lack a uuid and other services back-fill the table. Impact: one `lists` row without a uuid would make the Medications route fail.
- **Mitigation:** Guard for NULL, and back-fill `lists`. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it (Medications route). Fetching Allergies or Problems first keeps `lists` back-filled.
- **Sources:** `modules/MEDICATION-SERVICES.md#17`, `data/UUID-MAPPING.md#1`

### 6.08 Debug logs record session contents — Low
- **Location:** `src/Common/Session/SessionUtil.php:115-118` (called via `demographics.php:79,92,129`); `src/RestControllers/AuthorizationController.php:592,933-942,1145-1156,1375-1378`
- **Description:** Session keys and values, including `pid` and the full OAuth session, are logged at debug level. Impact: patient identifiers and OAuth state end up in logs whenever debug logging is on.
- **Mitigation:** Log keys only. *Disposition:* fix in legacy.
- **Port relevance:** port designs it out. The BFF logs no session values (AGENTS.md PHI rule).
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#14`, `ui/DEMOGRAPHICS-PART1-BOOT.md#23`

### 6.09 A missing scope returns 401, the same as an invalid token — Low
- **Location:** `src/Common/Http/HttpRestRouteHandler.php:99-112`; `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php:169-178`
- **Description:** An insufficient scope gets the same 401 as a bad token. Impact: clients can't tell "re-login" from "not permitted".
- **Mitigation:** Return 403 `insufficient_scope`. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF maps these cases explicitly to avoid login loops.
- **Sources:** `modules/API-ROUTES.md#10`

### 6.10 A patient-context request for another patient's `Patient` throws — Low
- **Location:** `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:613-615`; `src/RestControllers/Subscriber/ExceptionHandlerListener.php:43-49`
- **Description:** The denial surfaces as an exception, not a clean 403 or 404. Impact: an error response in place of a proper denial.
- **Mitigation:** Return 403 or 404. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (user tokens).
- **Sources:** `modules/API-ROUTES.md#9`

### 6.11 `getProviderIDsForPatientUuids()` throws for empty input (unconfirmed) — Low
- **Location:** `src/Services/PatientService.php:865-900`
- **Description:** An empty input list builds an invalid `IN ()` and raises a `ValueError` (source-derived). Impact: an error on an edge case.
- **Mitigation:** Return early with `[]` for empty input. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (the single-patient header read passes a non-empty list).
- **Sources:** `modules/PATIENT-SERVICES.md#7`

### 6.12 PHP warning on every `GET /fhir/metadata` — Low
- **Location:** `src/RestControllers/FHIR/FhirMetaDataRestController.php:85`
- **Description:** `Undefined array key "version"` is logged on every call. Impact: log noise, and possibly an incomplete capability statement.
- **Mitigation:** Guard the key. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it (the port reads `/fhir/metadata`).
- **Sources:** `BASELINE-ERRORS.md#E-07`

### 6.13 No evidence of correlation ids in OpenEMR logs — Low
- **Location:** Monolog configuration (no correlation-id evidence found)
- **Description:** Unverified: nothing shows that a request id links log lines. Impact: tracing a single failed request across logs is hard.
- **Mitigation:** Propagate a request id header into the log context. *Disposition:* fix in legacy.
- **Port relevance:** port designs it out for its own logs. The BFF assigns and logs a correlation id per request.
- **Sources:** `project/WHATS-MISSING.md#Logging with correlation IDs (OpenEMR)`

## 7. UI/UX Bugs

### 7.01 Allergy–medication conflict alert fails with two or more conflicts — High
- **Location:** `interface/patient_file/summary/demographics.php:111-118` (verified, U-2; re-read now); `library/clinical_rules.php:363-369` (conflicts logged via `compare_log_alerts`)
- **Description:** The alert string is built with no `+` between entries, so with two or more new conflicts the emitted `<script>` is a JS `SyntaxError` and the alert never appears. `allergy_conflict(..., 'new', ...)` has already logged those conflicts as seen, so this alert never retries for them. It runs only when `enable_cdr`, `enable_allergy_check` and `enable_alert_log` are all on; a single conflict alerts correctly. Impact: the pop-up warning about active prescriptions for drugs the patient is allergic to silently never appears.
- **Severity decision:** High, not Critical (see Summary).
- **Mitigation:** Build the list server-side as one JSON-encoded array, and log conflicts as seen only after the alert has displayed. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (CDR is out of port scope; catalog only).
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#4`

### 7.02 Add-prescription link builds `controller.php??prescription` — High
- **Location:** `templates/prescription/general_list.html.twig:449`; `library/classes/Controller.class.php:78` (thrown at `:202`) (verified, U-10; **live**: David hit it)
- **Description:** `CONTROLLER` already ends in `?`, so the extra `?` makes the first key `?prescription`, which fails the `VALID_CONTROLLERS` check and throws "Missing or invalid 'controller' parameter". Impact: a prescription can't be added from the Rx edit list.
- **Mitigation:** Drop the leading `?` from the template link. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (read-only).
- **Sources:** `ui/PRESCRIPTION-TEMPLATES.md#1`, `BASELINE-ERRORS.md#B-14`

### 7.03 Dashboard opened outside the tabbed shell throws, and reminder cards spin forever — Medium
- **Location:** `interface/patient_file/summary/demographics.php:495-498,635,715,904,969-971`; `probe/results/claude-laptop-seeded/screens/dashboard-13-full.png`
- **Description:** `top.restoreSession` and `setPatient` don't exist outside the shell (E-08 twice per load, E-09 once). Clinical Reminders and Patient Reminders never load, and collapse state isn't saved. Impact: the page is partly broken when opened directly.
- **Mitigation:** Guard with `typeof top.restoreSession === 'function'`, as `dialog.js:184` does. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out (a standalone app with no shell dependency).
- **Sources:** `BASELINE-ERRORS.md#E-08`, `BASELINE-ERRORS.md#E-09`, `ui/DEMOGRAPHICS-PART1-BOOT.md#6`

### 7.04 Identity bar names the previous patient while the new one loads — Medium
- **Location:** `interface/patient_file/summary/demographics.php:969-971`; `interface/main/tabs/js/frame_proxies.js:27-54`
- **Description:** The shell's identity bar updates only on `window.load`, so for 3–5 s it names the previous patient while the frame shows the new one. Impact: risk of misidentifying the patient.
- **Mitigation:** Set the identity before any clinical data renders. *Disposition:* design out in port.
- **Port relevance:** port designs it out (the header renders from the same patient id before the cards).
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#10`

### 7.05 Collapse persistence and modal bindings are attached late — Medium
- **Location:** `interface/patient_file/summary/demographics.php:606-610,736-830,882-911`
- **Description:** Collapse persistence is bound only inside the `.then()` of the `stats.php` fetch, and only to toggles that exist at that moment. Modal bindings are direct, not delegated, and are made before the async fragments arrive. Impact: if `stats.php` is slow or fails, collapse state silently stops saving.
- **Mitigation:** Delegate the handlers and bind them on document ready. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out.
- **Sources:** `ui/CARD-TEMPLATES.md#1`, `ui/DEMOGRAPHICS-PART1-BOOT.md#22`

### 7.06 Messages footer misstates the count and hides `Done` notes silently — Medium
- **Location:** `interface/patient_file/summary/pnotes_fragment.php:127-128`; `library/pnotes.inc.php:184`
- **Description:** The footer shows the limit N as "number of most recent messages" even when fewer are shown, and `Done` notes are excluded without any indication. Impact: users misread how many messages exist.
- **Mitigation:** Show the actual count and state the filter. *Disposition:* out of port scope (catalog only).
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#7`

### 7.07 Injury Log / Treatment Protocols card overwrites its rows (latent) — Medium
- **Location:** `interface/patient_file/summary/stats.php:253-258`; `templates/patient/card/tp_il.html.twig:6-9`
- **Description:** A `$formRws` typo means `templateName` is never set, and `$formRows` is overwritten per row instead of appended. The code is inert here because the form tables don't exist. Impact: once the tables exist, the card renders garbled or blank.
- **Mitigation:** Fix the typo and append rows to a list. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/STATS.md#4`

### 7.08 Slow page loads and navigation — Medium
- **Location:** app-wide; dashboard network-idle 3.3–5.2 s (probes); tabbed shell reloads
- **Description:** Pages load slowly, and navigation reloads everything. Identified contributors are 8.03 (Rx card N+1 queries) and 8.08 (synchronous CDR). Impact: slow clinical workflow, and a wider window for 5.04 and 7.04.
- **Mitigation:** Measure first, then batch queries and defer CDR. *Disposition:* fix in legacy; design out in port.
- **Port relevance:** port designs it out. The BFF fetches cards in parallel with per-card loading states; the budget is checked in the walking skeleton.
- **Sources:** `BASELINE-ERRORS.md#B-02`, `BASELINE-ERRORS.md#B-06`

### 7.09 Navigation relies on the browser Back button — Medium
- **Location:** tabbed shell
- **Description:** It's easy to leave the patient view by accident. Impact: lost context mid-task.
- **Mitigation:** Use routable views keyed by patient id. *Disposition:* design out in port.
- **Port relevance:** port designs it out.
- **Sources:** `BASELINE-ERRORS.md#B-07`

### 7.10 The dashboard is a wall of text with no graphs, search or filters — Medium
- **Location:** `interface/patient_file/summary/demographics.php` (dashboard)
- **Description:** Every card is dense text. Impact: clinically relevant items are hard to find.
- **Mitigation:** Add structured cards, with filters where scope allows. *Disposition:* design out in port.
- **Port relevance:** port designs it out.
- **Sources:** `BASELINE-ERRORS.md#B-08`

### 7.11 Adding and removing entries needs no confirmation — Medium
- **Location:** dashboard cards (e.g. notes "Completed", `demographics.php:613-624`)
- **Description:** One click changes data. Impact: accidental data changes.
- **Mitigation:** Add a confirm or undo step on destructive actions. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (read-only).
- **Sources:** `BASELINE-ERRORS.md#B-13`

### 7.12 No accessibility tests or audit (OpenEMR and AgentForge) — Medium
- **Location:** ARIA in 84 `templates/` and `interface/` files; `agentforge/src/ui.js`; no accessibility tests in either scope
- **Description:** ARIA attributes exist, but nothing tests them. Impact: accessibility regressions go unnoticed.
- **Mitigation:** Add automated checks (e.g. axe) plus a manual audit. *Disposition:* design out in port (accessibility checks in the port's gate); legacy catalog only.
- **Port relevance:** port designs it out.
- **Sources:** `project/WHATS-MISSING.md#Accessibility (OpenEMR)`, `project/WHATS-MISSING.md#Accessibility (AgentForge)`

### 7.13 A card's default collapse state comes from the first user to toggle it — Low
- **Location:** `src/Services/Globals/UserSettingsService.php:40-51,84-107`; `library/ajax/user_settings.php:26-29`; e.g. `src/Patient/Cards/CareTeamViewCard.php:85`
- **Description:** A missing setting means collapsed. The first user to toggle a card creates the global default (`setting_user=0`) for everyone, and it's never updated. `ui/DASHBOARD-MAP.md` §3 explains this backwards: `NULL == 0` is true; the real reason is the pre-seeded default row. Impact: defaults are arbitrary.
- **Mitigation:** Define a default per card in code, and correct the map. *Disposition:* design out in port.
- **Port relevance:** port designs it out (fixed defaults per card).
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#12`, `ui/CARD-TEMPLATES.md#3`, `ui/CARD-TEMPLATES.md#6`

### 7.14 Care Team card has no empty state — Low
- **Location:** `templates/patient/card/manage_care_team.html.twig:31-32`
- **Description:** With no team, the card shows a blank editable form. Impact: an unclear empty card.
- **Mitigation:** Add an explicit empty-state string. *Disposition:* design out in port.
- **Port relevance:** port designs it out ("Nothing Recorded").
- **Sources:** `ui/CARE-TEAM-CARD.md#5`

### 7.15 Care Team view derives names from `<select>` options — Low
- **Location:** `templates/patient/card/manage_care_team.html.twig:98-101`; `src/Patient/Cards/CareTeamViewCard.php:201-224`; `src/Services/CareTeamService.php:651-660`
- **Description:** An inactive user shows as a blank member, and a facility that isn't a service or billing location shows as blank. Impact: missing names on the card.
- **Mitigation:** Render names from the data, not from form options. *Disposition:* design out in port.
- **Port relevance:** port designs it out (names come from FHIR references).
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#17`

### 7.16 Allergy alert `<script>` is echoed before `<!DOCTYPE html>` — Low
- **Location:** `interface/patient_file/summary/demographics.php:131-133` vs `:379`
- **Description:** When the alert fires, it forces quirks mode. Impact: layout differences.
- **Mitigation:** Emit the script inside `<head>`. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#14`

### 7.17 Age formatting is inconsistent — Low
- **Location:** `interface/patient_file/summary/demographics.php:928-930`; `library/formatting.inc.php:206-259`; `src/Services/PatientService.php:718-728,768-777`
- **Description:** A precedence bug renders "5months" (no space). Living ages switch at `> 24` months, deceased at `>= 24`, and living under-2 ages use the singular. Age at death ignores `age_display_format`. Impact: inconsistent ages in the header.
- **Mitigation:** Use one age formatter. *Disposition:* design out in port.
- **Port relevance:** port designs it out.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#17`, `ui/DASHBOARD-HEADER.md#4`

### 7.18 Patient name is built by two different functions — Low
- **Location:** `interface/patient_file/summary/demographics.php:925` vs `src/OeUI/OemrUI.php:87` (`library/patient.inc.php:869-892`)
- **Description:** The identity bar uses first + last; the page title adds middle name and suffix. Impact: two names for the same patient on one screen.
- **Mitigation:** Use one name formatter. *Disposition:* design out in port.
- **Port relevance:** port designs it out.
- **Sources:** `ui/DASHBOARD-HEADER.md#2`

### 7.19 LBF cards never save collapse state; "Trend" link hard-coded to vitals — Low
- **Location:** `interface/patient_file/summary/demographics.php:1566-1568`; `library/ajax/user_settings.php:25`
- **Description:** LBF card ids don't end in `_expand`, so collapse state isn't saved, and every LBF card's Trend link points at vitals. Impact: minor UX breakage on LBF cards.
- **Mitigation:** Use `_expand` ids and a per-form trend link. *Disposition:* out of port scope (catalog only).
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#13`

### 7.20 Vitals report renders whatever `SELECT *` returns — Low
- **Location:** `interface/forms/vitals/report.php:37,48,49-55`; `sql/database.sql:2418-2451`
- **Description:** Field order is the table's column order, and `last_updated` may print as an unlabeled row (not confirmed against live HTML). Impact: schema changes reorder the card silently.
- **Mitigation:** Use an explicit field list and order. *Disposition:* design out in port.
- **Port relevance:** port designs it out.
- **Sources:** `ui/VITALS-FRAGMENT.md#5`, `ui/VITALS-FRAGMENT.md#6`

### 7.21 Unexplained email pop-up at login ("OpenEMR Product Registration") — Low
- **Location:** login
- **Description:** A registration prompt appears on every login. Impact: confusing interruption.
- **Mitigation:** Complete or disable the registration prompt in configuration. *Disposition:* fix in legacy (configuration).
- **Port relevance:** not on the port path.
- **Sources:** `BASELINE-ERRORS.md#B-01`

### 7.22 Data-entry forms are hard to use (highlighting; add/edit UI) — Low
- **Location:** data-entry and edit forms
- **Description:** Field highlighting and the add/edit flows are hard to work with. Impact: slower, error-prone data entry.
- **Mitigation:** UX review of the forms. *Disposition:* out of port scope (catalog only).
- **Port relevance:** not on the port path (read-only).
- **Sources:** `BASELINE-ERRORS.md#B-04`, `BASELINE-ERRORS.md#B-15`

### 7.23 Pop-ups appear with no clear trigger — Low
- **Location:** app-wide (intermittent)
- **Description:** The cause hasn't been identified. Impact: confusing interruptions.
- **Mitigation:** Capture a reproduction, then fix. *Disposition:* out of port scope (catalog only).
- **Port relevance:** not on the port path.
- **Sources:** `BASELINE-ERRORS.md#B-10`

### 7.24 Vitals card sits near the bottom of the dashboard — Low
- **Location:** `interface/patient_file/summary/demographics.php` card order
- **Description:** Frequently needed data is placed low on the page. Impact: extra scrolling.
- **Mitigation:** Decide the card order in the port. *Disposition:* design out in port.
- **Port relevance:** port designs it out.
- **Sources:** `BASELINE-ERRORS.md#B-09`

### 7.25 Medications vs Prescriptions is confusing — Low
- **Location:** dashboard (two tables with different filters)
- **Description:** Two similar lists have different sources and rules. Impact: users don't know which list to trust.
- **Mitigation:** Label each card's source and rule. *Disposition:* design out in port.
- **Port relevance:** port designs it out (both cards kept, labelled).
- **Sources:** `BASELINE-ERRORS.md#B-16`

### 7.26 AgentForge UI is English-only — Low
- **Location:** `agentforge/src` (no i18n)
- **Description:** No translation layer. Impact: non-English users are unsupported.
- **Mitigation:** Add i18n if needed. *Disposition:* out of port scope (catalog only).
- **Port relevance:** not on the port path.
- **Sources:** `project/WHATS-MISSING.md#Internationalization (AgentForge)`

## 8. Architectural Smells

### 8.01 Public OAuth clients cannot obtain `user/` scopes — High
- **Location:** `src/RestControllers/AuthorizationController.php:324-330`; `src/RestControllers/SMART/SMARTAuthorizationController.php:174-184`; `src/Common/Http/HttpRestRouteHandler.php:63-67`; `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php:373` (verified, M-2; live-consistent)
- **Description:** Registration refuses `user/` and `system/` scopes for public clients. A browser-only SPA therefore gets only FHIR with `patient/` scopes, one patient per authorization, and no `/api/*` routes. Our confidential client did obtain `user/` scopes. Impact: a pure-SPA port can't reach the REST routes several cards need.
- **Mitigation:** None upstream (a defensible policy). *Disposition:* design out in port (SPA + thin BFF holding a confidential client, auth code + PKCE, tokens server-side).
- **Port relevance:** port designs it out (the decided client model).
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#2`

### 8.02 Services back-fill uuids on every construction (writes on the read path) — Medium
- **Location:** `src/Services/AllergyIntoleranceService.php:39-40`; `src/Services/PrescriptionService.php:41-42`; `src/Common/Uuid/UuidRegistry.php:229-249,295-322`
- **Description:** Constructing these services runs uuid back-fill queries on every request, including GETs. Impact: per-request overhead, and writes during reads.
- **Mitigation:** Move back-fill to install and upgrade. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it (per-request latency; `lists` back-fill ordering, see 6.07).
- **Sources:** `modules/ALLERGY-SERVICES.md#1`, `modules/MEDICATION-SERVICES.md#15`

### 8.03 Prescriptions card issues about 5 queries per row — Medium
- **Location:** `library/classes/Prescription.class.php:201-260,497-503`; `src/Common/ORDataObject/ORDataObject.php:123-125`
- **Description:** Each `Prescription` object loads its list-option attributes separately, serially and uncached, and the edit iframe repeats the work. Impact: load time grows with the number of prescriptions (7.08).
- **Mitigation:** Batch-load the lookups once per request. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path (the REST route is a single UNION query).
- **Sources:** `ui/PRESCRIPTION-TEMPLATES.md#3`

### 8.04 Care Team members are rendered client-side from embedded JSON — Medium
- **Location:** `templates/patient/card/manage_care_team.html.twig:23,31-107,203-205`
- **Description:** Member rows aren't in the server HTML; JS builds them from an `existing_care_team` blob. Impact: tools that read server HTML see zero members, as the probe did.
- **Mitigation:** Render from the API in the SPA's own templates. *Disposition:* design out in port.
- **Port relevance:** port designs it out.
- **Sources:** `ui/CARE-TEAM-CARD.md#6`

### 8.05 Care Team template nests `<html><head>` and re-emits assets mid-body — Medium
- **Location:** `templates/patient/card/manage_care_team.html.twig:3-7`; `src/Core/Header.php:84-150`
- **Description:** The template calls `setupHeader` again, re-emitting jQuery and other autoload assets. The runtime effect on plugins bound to the first jQuery is unverified. Impact: possible duplicate libraries and broken plugins.
- **Mitigation:** Render as a fragment without a head. *Disposition:* fix in legacy.
- **Port relevance:** port designs it out.
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#6`

### 8.06 Tabbed shell: many windows and unclear authentication between parts — Medium
- **Location:** tabbed shell and pop-ups (`interface/main/tabs/`)
- **Description:** The shell opens many tab pop-ups, and each part relies on a shared session and `restoreSession`. Impact: fragile context and state that's hard to reason about.
- **Mitigation:** One app with one session. *Disposition:* design out in port.
- **Port relevance:** port designs it out (one SPA, one BFF session).
- **Sources:** `BASELINE-ERRORS.md#B-05`

### 8.07 Rendering the dashboard (a GET) can insert a `contact` row — Low
- **Location:** `src/Patient/Cards/CareTeamViewCard.php:190`; `src/Services/ContactService.php:38-57`
- **Description:** The Care Team card calls `getOrCreateForEntity('patient_data', $pid)` during render. Impact: data is written on read.
- **Mitigation:** Create the row on the save path only. *Disposition:* fix in legacy.
- **Port relevance:** port designs it out (the API doesn't do this).
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#20`, `ui/CARE-TEAM-CARD.md#4`

### 8.08 CDR runs synchronously before the first byte — Low
- **Location:** `interface/patient_file/summary/demographics.php:122-128`; `interface/patient_file/summary/clinical_reminders_fragment.php:24`
- **Description:** CDR runs on new-patient loads and again in the Clinical Reminders fragment. Impact: slower first paint (7.08).
- **Mitigation:** Measure, then defer. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#15`

### 8.09 `src/` classes depend on global functions defined only in this page — Low
- **Location:** `src/Patient/Cards/PortalCard.php:85-92`; `src/Common/Twig/TwigExtension.php:184-190`
- **Description:** These classes call functions that exist only when the dashboard page has been included. Impact: hidden coupling; the classes break outside the page.
- **Mitigation:** Move the helpers into services. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#19`

### 8.10 `Controller` copies `$GLOBALS` into every Smarty template — Low
- **Location:** `library/classes/Controller.class.php:80`
- **Description:** Every template gets the whole global scope. Impact: any template can read any global.
- **Mitigation:** Pass explicit variables. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `modules/LEGACY-ROUTER-AND-LISTS.md#7`

### 8.11 `lists.inc.php` runs queries on every include — Low
- **Location:** `library/lists.inc.php:52,83-86`
- **Description:** Two unconditional queries run at include time. Impact: wasted queries.
- **Mitigation:** Load lazily. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `modules/LEGACY-ROUTER-AND-LISTS.md#8`

### 8.12 Variable reuse and an unrestored `chdir` in `demographics.php` — Low
- **Location:** `interface/patient_file/summary/demographics.php:1233-1240,1451,1841,1902`
- **Description:** `$result` and `$result2` are reused as loop and statement variables, and `chdir("../../../")` is never undone. Impact: fragile code for anything that follows.
- **Mitigation:** Restore the working directory and rename the variables. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#16`, `ui/PRESCRIPTION-TEMPLATES.md#7`

### 8.13 Two different columns surface under one JSON key (`drug_dosage_instructions`) — Low
- **Location:** `src/Services/PrescriptionService.php:113,175,229`; `sql/database.sql:7720,8744`
- **Description:** The UNION's two branches fill the key from different tables. Impact: the key's meaning depends on `source_table`.
- **Mitigation:** Use distinct keys, or document the mapping. *Disposition:* out of port scope (catalog only).
- **Port relevance:** port depends on it. The Rx card uses the `prescriptions` branch only.
- **Sources:** `data/SCHEMA.md#D-4`

### 8.14 `patient_data` has no `PRIMARY KEY` — Low
- **Location:** `sql/database.sql:8467-8471`
- **Description:** The table has only `UNIQUE` keys on `pid` and `uuid`. Impact: ORM code that assumes a primary key misbehaves.
- **Mitigation:** Add a primary key in a migration. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `data/SCHEMA.md#D-7`

### 8.15 `care_team_member` has no uuid or external id — Low
- **Location:** `sql/database.sql:14796-14811`
- **Description:** Members have no stable external id. Impact: clients can't key member rows stably.
- **Mitigation:** Add a uuid. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. Rendered rows are keyed by (`care_team_id`, `user_id`) or by position.
- **Sources:** `data/UUID-MAPPING.md#3`

## 9. Build / Deployment Risks

### 9.01 No CI runner; the gate runs no OpenEMR checks, and the fork's own code fails static analysis — Medium
- **Location:** `.githooks/pre-commit`, `.gitlab-ci.yml` (no runner, AGENTS.md); `project/CI-AND-HOOKS.md`; `interface/modules/custom_modules/oe-module-agentforge/**` (E-11: 272 PHPStan level-10 errors on the LF run; E-04: PHPCS use-order at `public/index.php:7`, `tests/run.php:50`); `agentforge/src/ui.js:109`, `agentforge/test/openemr-module-roundtrip.test.js:33`, `evals/lib/runner.js:7` (E-06: ESLint)
- **Description:** The GitLab project has no runner. The enforced pre-commit hook runs the AgentForge, evals and observability tests plus the W2 gate, but no PHPUnit, PHPStan, PHPCS or ESLint, and the upstream `.github/` workflows don't run here. That's why the fork's own module carries 272 PHPStan errors and lint violations. Impact: regressions in OpenEMR code and in the fork's module reach `main` unchecked.
- **Mitigation:** Add the port's tests, plus PHPStan/PHPCS/ESLint on changed paths, to `.githooks/pre-commit` (keeping `.gitlab-ci.yml` in sync), then fix E-11, E-04 and E-06. *Disposition:* fix in legacy (gate and module code).
- **Port relevance:** port depends on it. The new app's tests must run in `.githooks/pre-commit`, because nothing else runs.
- **Sources:** `project/WHATS-MISSING.md#CI running build + tests (OpenEMR)`, `project/WHATS-MISSING.md#CI running build + tests (AgentForge)`, `BASELINE-ERRORS.md#E-11`, `BASELINE-ERRORS.md#E-04`, `BASELINE-ERRORS.md#E-06`

### 9.02 No documented production backup and restore — Medium
- **Location:** `contrib/util/backup_oemr.sh` (outside audit scope); `openemr-cmd backup-snapshot`/`restore-snapshot` (dev only); `deploy/vultr/langfuse/` (no backup)
- **Description:** Neither OpenEMR's database and `sites/` volume nor the Langfuse stack has a documented, tested production backup. Impact: a host failure could lose data with no recovery path.
- **Mitigation:** Schedule database and volume backups, run a restore drill, and back up the Langfuse volumes. *Disposition:* fix in legacy (deployment).
- **Port relevance:** not on the port path (the port is stateless apart from BFF sessions).
- **Sources:** `project/WHATS-MISSING.md#Backups and restore (OpenEMR)`, `project/WHATS-MISSING.md#Backups and restore (AgentForge)`

### 9.03 No monitoring or alerting for OpenEMR — Medium
- **Location:** repo-wide (no configuration); `/meta/health/readyz` exists (`deploy/vultr/docker-compose.yml:55`)
- **Description:** Logging exists but nothing monitors or alerts. Impact: outages and error spikes go unnoticed.
- **Mitigation:** Add uptime and error-rate alerts on the readiness endpoint and the API. *Disposition:* fix in legacy (deployment).
- **Port relevance:** port depends on it. The BFF relies on OpenEMR being up and should expose its own readiness.
- **Sources:** `project/WHATS-MISSING.md#Monitoring and alerting (OpenEMR)`

### 9.04 CRLF checkout breaks byte-exact tests and PHPStan — Low
- **Location:** `tests/Tests/Isolated/Common/Twig/fixtures/render/*.html` (E-01: 14 fixture mismatches); `bin/console` (E-02: syntax error plus 9 related); `Carecoordination/…/CarecoordinationController.php` and others (E-12: 116 `ignore.unmatched`, `binaryOp.invalid` on multi-line SQL literals)
- **Description:** These are environment artifacts, proven: an LF copy passes 3,474/3,474 tests and shows no such PHPStan errors. Impact: false failures on Windows checkouts.
- **Mitigation:** `.gitattributes` `eol=lf` for fixtures and scripts (or `core.autocrlf=input`); run checks from an LF copy. *Disposition:* fix in legacy (repo configuration).
- **Port relevance:** port depends on it. The port's own fixtures must be line-ending-safe.
- **Sources:** `BASELINE-ERRORS.md#E-01`, `BASELINE-ERRORS.md#E-02`, `BASELINE-ERRORS.md#E-12`

### 9.05 Installer-written `sqlconf.php` fails PHPCS — Low
- **Location:** `sites/default/sqlconf.php:1,5` (Docker volume)
- **Description:** A blank header line and tab alignment in a file the installer generates. Impact: lint noise.
- **Mitigation:** Exclude the file from PHPCS. *Disposition:* out of port scope (catalog only).
- **Port relevance:** not on the port path.
- **Sources:** `BASELINE-ERRORS.md#E-05`

### 9.06 OpenEMR architecture documentation is partial — Low
- **Location:** only `API_README.md` and `FHIR_README.md`
- **Description:** Nothing documents OpenEMR's own architecture; the `docs/agentforge/*` docs cover AgentForge only. Impact: onboarding and changes depend on code archaeology (this audit partly fills the gap).
- **Mitigation:** Keep the audit docs current. *Disposition:* out of port scope (catalog only).
- **Port relevance:** not on the port path.
- **Sources:** `project/WHATS-MISSING.md#Architecture docs (OpenEMR)`

### 9.07 PHPUnit run emits vendor warnings and a notice — Low
- **Location:** `vendor/particle/validator` (×2), `vendor/league/oauth2-server/src/CryptKey.php:74`, `src/Cqm/Qdm/BaseTypes/AbstractType.php:23`
- **Description:** Three warnings and one notice, from upstream and vendor code. Impact: test-output noise.
- **Mitigation:** Track upstream. *Disposition:* out of port scope (catalog only).
- **Port relevance:** not on the port path.
- **Sources:** `BASELINE-ERRORS.md#E-10`

## 10. Dead Code & Inconsistencies

### 10.01 Discovery and SMART configuration documents are inaccurate — Low
- **Location:** `src/RestControllers/Authorization/OAuth2DiscoveryController.php:66-110`; `src/RestControllers/SMART/SMARTConfigurationController.php:79-103`
- **Description:** The documents advertise unsupported features, and `scopes_supported` is wrapped in an extra array.
- **Mitigation:** Generate the documents from the enabled grants. *Disposition:* fix in legacy.
- **Port relevance:** port depends on it. The BFF pins its OAuth configuration and doesn't parse `scopes_supported`.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#9`, `modules/API-ROUTES.md#13`

### 10.02 "Remember Me" is stored but never used — Low
- **Location:** `src/RestControllers/AuthorizationController.php:583,921,1543-1555`; `src/Services/TrustedUserService.php:67`
- **Description:** `persist_login` goes into the session and has no effect.
- **Mitigation:** Remove it or implement it. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `modules/AUTHORIZATION-CONTROLLER.md#10`

### 10.03 `SkipAuthorizationStrategy` reads the session `authUserId` — Low
- **Location:** `src/RestControllers/Authorization/SkipAuthorizationStrategy.php:57,71-80`
- **Description:** A dead code path.
- **Mitigation:** Remove it. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `modules/API-ROUTES.md#12`

### 10.04 REST routes mix integer ids and uuids — Low
- **Location:** `apis/routes/_rest_routes_standard.inc.php:298-303`; `src/Services/ListService.php:48-60`; `src/RestControllers/RestControllerHelper.php:158-167`
- **Description:** `/api/patient/:pid/medication` takes the integer pid, while sibling routes take uuids.
- **Mitigation:** Use uuids consistently. *Disposition:* out of port scope (catalog only).
- **Port relevance:** port depends on it. The BFF resolves `pid` from `GET /api/patient/:puuid`.
- **Sources:** `modules/API-ROUTES.md#11`

### 10.05 Unused functions and handlers in `demographics.php` — Low
- **Location:** `interface/patient_file/summary/demographics.php:73-75,136,149-163,418-430,447-467,736-765`
- **Description:** `print_as_money`, `$insurance_array`, `toggleIndicator`, `deleteme`, the `.large_modal`/`.rx_modal` handlers, and the `!isset($pid)` fallback are never used.
- **Mitigation:** Remove them. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#18`

### 10.06 eRx medication blocks can never render — Low
- **Location:** `interface/patient_file/summary/demographics.php:1186`; `interface/patient_file/summary/stats.php:136-146,154-155,190-191,200,317`
- **Description:** "Current Medications" depends on a variable set only in another request, or on a type removed before the loop. "Old Medication" depends on a flag set only inside that dead branch.
- **Mitigation:** Remove the blocks, or fix the exclusion order if eRx cards are wanted. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#14`, `ui/STATS.md#1`, `ui/STATS.md#2`

### 10.07 `getPrescriptions()` in `stats.php` is never called — Low
- **Location:** `interface/patient_file/summary/stats.php:107-121`
- **Description:** No callers anywhere in the repo.
- **Mitigation:** Remove it. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `ui/STATS.md#3`

### 10.08 Edit pencils shown regardless of write ACL; placeholder link; `btnCLass` typo — Low
- **Location:** `interface/patient_file/summary/demographics.php:1129,1153,1177,1268,1464`
- **Description:** Controls display without the write check, `btnLink => 'test'` is a placeholder, and `btnCLass` is misspelled.
- **Mitigation:** Gate the controls on the ACL and fix the placeholder and typo. *Disposition:* fix in legacy.
- **Port relevance:** port designs it out (read-only, with no edit controls).
- **Sources:** `ui/DEMOGRAPHICS-PART2-CARDS.md#15`

### 10.09 `message` listener uses the implicit global `event` and logs every message — Low
- **Location:** `interface/patient_file/summary/demographics.php:670-671`
- **Description:** The listener reads the implicit global `event` and logs every cross-frame message to the console.
- **Mitigation:** Use the handler parameter; drop the log. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/DEMOGRAPHICS-PART1-BOOT.md#21`

### 10.10 `hasActiveTeam` is computed with a query but never used — Low
- **Location:** `src/Patient/Cards/CareTeamViewCard.php:119`
- **Description:** The query runs on every render, and no template reads the result.
- **Mitigation:** Remove it, or show a "no active team" note. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `ui/CARE-TEAM-CARD.md#3`

### 10.11 `dashboard_header.php` passes an unused `pid` and CSRF token — Low
- **Location:** `interface/patient_file/summary/dashboard_header.php:30-36`; `templates/patient/dashboard_header.html.twig:1`
- **Description:** The template renders only `pageHeading`.
- **Mitigation:** Drop the unused arguments. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `ui/DASHBOARD-HEADER.md#3`

### 10.12 `if ($deceased > 0)` relies on array-vs-int comparison — Low
- **Location:** `interface/patient_file/summary/demographics.php:1333`; `library/patient.inc.php:1656-1667`
- **Description:** It's correct as read, but fragile to changes in comparison semantics.
- **Mitigation:** `if ($deceased !== false)`. *Disposition:* fix in legacy.
- **Port relevance:** port designs it out (status derived from `deceasedDateTime`).
- **Sources:** `ui/DASHBOARD-HEADER.md#5`

### 10.13 `LayoutsUtils` signatures are untyped or mistyped — Low
- **Location:** `src/Common/Layouts/LayoutsUtils.php:17,33`; callers in `library/options.inc.php`, `interface/forms/LBF/new.php`
- **Description:** No parameter or return types, and `isOption(array …)` receives mixed values. PHPStan baseline entries result.
- **Mitigation:** Add accurate types and a type guard. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/LAYOUTS-UTILS.md#1`, `ui/LAYOUTS-UTILS.md#2`

### 10.14 Cryptic comment in `LayoutsUtils::isOption` — Low
- **Location:** `src/Common/Layouts/LayoutsUtils.php:35-36`
- **Description:** A `// why bother?` comment on the empty-value check.
- **Mitigation:** Explain the check. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/LAYOUTS-UTILS.md#4`

### 10.15 `fragment_action` is marked deprecated but renders the Rx card — Low
- **Location:** `controllers/C_Prescription.class.php:278-286`
- **Description:** The docblock says it isn't used, yet it's the live render path. A cleanup guided by that comment would break the dashboard.
- **Mitigation:** Correct the docblock. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/PRESCRIPTION-TEMPLATES.md#2`

### 10.16 `rx_zend_html_action` is assigned from the PDF global — Low
- **Location:** `controllers/C_Prescription.class.php:247-249`
- **Description:** Looks like a copy-paste error.
- **Mitigation:** Use the correct global, or document why. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/PRESCRIPTION-TEMPLATES.md#4`

### 10.17 `vitals_report()` ignores its `$pid` and `$encounter` parameters — Low
- **Location:** `interface/forms/vitals/report.php:34`; `interface/patient_file/summary/vitals_fragment.php:43`
- **Description:** The function reads the global pid instead, which is hidden session coupling.
- **Mitigation:** Use the parameters or drop them. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `ui/VITALS-FRAGMENT.md#2`

### 10.18 Unreachable `?? 'unknown'` fallback on sex — Low
- **Location:** `src/Services/FHIR/FhirPatientService.php:378`
- **Description:** `strtolower()` never returns null.
- **Mitigation:** Drop the fallback. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `modules/PATIENT-SERVICES.md#5`

### 10.19 `FhirPatientService::$searchParameters` is declared but unused — Low
- **Location:** `src/Services/FHIR/FhirPatientService.php:100`
- **Description:** Declared, never read.
- **Mitigation:** Remove it. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `modules/PATIENT-SERVICES.md#6`

### 10.20 `FhirObservationService::loadSearchParameters()` is dead and maps `code` to `status` — Low
- **Location:** `src/Services/FHIR/FhirObservationService.php:79-94`
- **Description:** A dead method with a wrong mapping.
- **Mitigation:** Remove it. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `modules/VITALS-SERVICES.md#3`

### 10.21 `FhirObservationService::$observationService` is declared but unused — Low
- **Location:** `src/Services/FHIR/FhirObservationService.php:51-53`
- **Description:** Declared, never read.
- **Mitigation:** Remove it. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `modules/VITALS-SERVICES.md#4`

### 10.22 `PatientIssuesService::getActiveIssues()` has no caller — Low
- **Location:** `src/Services/PatientIssuesService.php:89-100`
- **Description:** No callers.
- **Mitigation:** Remove it (or use it for 4.05). *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `modules/CONDITION-SERVICES.md#8`

### 10.23 `FhirConditionRestController` is deprecated and has no route — Low
- **Location:** `src/RestControllers/FHIR/FhirConditionRestController.php:26`
- **Description:** Unreachable controller.
- **Mitigation:** Remove it. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `modules/CONDITION-SERVICES.md#9`

### 10.24 `populateRelatedPersonTeamMembers()` short-circuits under US Core 3.1.1 — Low
- **Location:** `src/Services/FHIR/FhirCareTeamService.php:396-400`
- **Description:** Related-person members are omitted, depending on configuration.
- **Mitigation:** Document the behavior. *Disposition:* out of port scope (catalog only).
- **Port relevance:** port depends on it. Care Team members may omit related persons; documented.
- **Sources:** `modules/CARE-TEAM-SERVICES.md#4`

### 10.25 `populateManagingOrganization()` never fires — Low
- **Location:** `src/Services/FHIR/FhirCareTeamService.php:445-451`
- **Description:** Unreachable code.
- **Mitigation:** Wire it up or remove it. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `modules/CARE-TEAM-SERVICES.md#5`

### 10.26 `getListById`, `addList`, `disappearList`, `reappearList` have no callers — Low
- **Location:** `library/lists.inc.php:106-128`
- **Description:** No callers anywhere in the repo.
- **Mitigation:** Remove them. *Disposition:* delete.
- **Port relevance:** not on the port path.
- **Sources:** `modules/LEGACY-ROUTER-AND-LISTS.md#5`

### 10.27 Implicitly nullable parameter deprecation — Low
- **Location:** `src/Services/PatientPortalService.php:183`
- **Description:** `getRequest(): Implicitly marking parameter $param as nullable is deprecated`.
- **Mitigation:** Declare the parameter `?Type`. *Disposition:* fix in legacy.
- **Port relevance:** not on the port path.
- **Sources:** `BASELINE-ERRORS.md#E-03`
