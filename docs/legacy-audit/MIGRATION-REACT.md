# Migration: R1 — React + TypeScript + Vite SPA with a Node (Fastify) BFF

This playbook is the single source of truth for **how** the patient dashboard
port gets built. The **what** lives elsewhere:
- [`BUGS-MITIGATIONS.md`](BUGS-MITIGATIONS.md): the issues to design out;
- [`DEV-LOG.md`](DEV-LOG.md): one entry per slice;
- [`arcs/ARC-01-DASHBOARD.md`](arcs/ARC-01-DASHBOARD.md): the stories, slices,
  acceptance checks and time boxes up to the deadline.

**Requirement status of record stays in `docs/agentforge/PLAN.md` (W2D-1…W2D-8)**
(`AGENTS.md`: one plan file). This playbook, the arc file and the DEV-LOG are
audit artifacts that serve that plan; they don't replace it. If a process rule
changes mid-build, edit this file and reference the change in `DEV-LOG.md`.

Route chosen by David on 2026-09-25 (`AUDIT-STATE.md`, Decisions; scoring in
[`MIGRATION-OPTIONS.md`](MIGRATION-OPTIONS.md), R1 = 110/135, a near-tie with Vue
109 and SvelteKit 108). Legacy code is cited at tag `legacy-baseline` (`3ccfe1d`).
Deadline: Sunday 2026-09-27 12:00 CT. The release freeze is 08:00 CT
(`PLAN.md:10`).

## Contents

1. Purpose and scope
2. Target architecture
3. Solution and project structure
4. Tech stack and rationale
5. Coding standards
6. Test strategy and gates
7. Deploy plan
8. Required documentation artifacts
9. Git workflow
10. The slice loop
11. Arc / Story / Slice hierarchy
12. Roadmap
13. Templates
14. Definition of Done
15. Human-readiness items (David)
16. Conflicts with `PLAN.md` / `AGENTS.md` to resolve

---

## 1. Purpose and scope

**In scope.** Behavior parity with the PHP dashboard
(`interface/patient_file/summary/demographics.php` and its fragments) for the
brief's sections, on OpenEMR's existing REST and FHIR APIs only:

| Req | Section | Legacy analysis | Walkthrough (parity spec) |
|---|---|---|---|
| W2D-1 / DB-01 | Sign-in via OAuth2/OIDC, sign-out | `modules/AUTHORIZATION-CONTROLLER.md` | `walkthroughs/SIGN-IN-AND-HEADER.md` |
| W2D-2 / DB-02 | Persistent patient header: name, DOB, sex, MRN, active status | `ui/DASHBOARD-HEADER.md`, `modules/PATIENT-SERVICES.md` | `walkthroughs/SIGN-IN-AND-HEADER.md` |
| W2D-3 / DB-03…05 | Allergies, Medical Problems, Medications | `ui/CARD-TEMPLATES.md`, `modules/ALLERGY-SERVICES.md`, `modules/CONDITION-SERVICES.md` | `walkthroughs/ISSUE-CARDS.md` |
| W2D-3 / DB-06 | Prescriptions | `ui/PRESCRIPTION-TEMPLATES.md`, `modules/MEDICATION-SERVICES.md` | `walkthroughs/PRESCRIPTIONS.md` |
| W2D-3 / DB-07 | Care Team | `ui/CARE-TEAM-CARD.md`, `modules/CARE-TEAM-SERVICES.md` | `walkthroughs/CARE-TEAM.md` |
| W2D-4 / DB-08 | Vitals (the one additional section) | `ui/VITALS-FRAGMENT.md`, `modules/VITALS-SERVICES.md` | `walkthroughs/VITALS.md` |
| W2D-5 / DB-09 | Parity evidence: side-by-side against the legacy dashboard, differences documented | all of the above | every walkthrough's section (e) |
| W2D-7 / DB-11 | `PATIENT_DASHBOARD_MIGRATION.md` at the repo root (graded) | `MIGRATION-OPTIONS.md` | — |

Every catalog entry whose disposition is **design out in port**, plus every
Architectural Smell (8.01–8.15), is mapped to a design decision and a slice in
§2.6.

**Out of scope.**
- **Any OpenEMR backend change** (PHP, schema, API): W2D-8 / DB-10. Only
  configuration is allowed: enabling `rest_fhir_api` and registering an OAuth
  client (A5).
- **Redesign.** The brief says "reimplement", not "redesign". Layout, card set
  and card order follow the legacy page; improvements go to Phase 9 side quests.
  This applies to 7.10 as well (see §2.6).
- **Writes of any kind.** The port is read-only. There is no edit pencil and no
  Care Team save (3.05, 3.10, 3.11 stay legacy-only).
- **Other dashboard cards** (Demographics, Billing, Insurance, Messages,
  Reminders, Labs, Appointments, and the rest): marked "not ported" (A1).
  Messages has no read API.
- **Patient search / Finder.** The legacy Finder belongs to the tabbed shell,
  not the dashboard. The port opens a patient by uuid deep link (4.06).
- **Squad restriction and `hide_dashboard_cards`** (3.04, 4.12): the API has
  neither concept. Documented as access-model differences.
- **Upstream reports** for M-1 and the other "fix in legacy" entries. David
  deferred these ("we'll think about it later").
- **The AgentForge Co-Pilot** inside the dashboard (A6).

## 2. Target architecture

### 2.1 Shape

```
Browser ──same origin──▶ Caddy ──handle /dashboard/*──▶ dashboard (Node 24, Fastify BFF)
  SPA (React)                                             │  serves web/dist + /dashboard/bff/*
  holds: HttpOnly session cookie only                     │  holds: OAuth tokens, client secret (memory/env)
                                                          ▼
                                            OpenEMR (http://openemr on the Docker network)
                                              /oauth2/default/*   /apis/default/api/*   /apis/default/fhir/*
```

- **One container, one origin.** The BFF serves the built SPA and its own JSON
  API under `/dashboard/`. There is no CORS, because the CORS preflight is dead
  upstream (4.01, M-3 live).
- **The SPA never sees a token, a client secret, or OpenEMR's error text.** It
  talks only to `/dashboard/bff/*` and gets card DTOs back.
- **The BFF is a confidential OAuth client** (auth code + PKCE S256 + `state` +
  `nonce`, with the secret sent on every `/token` call). It's needed because
  public clients can't get `user/` scopes and so can't reach `/api/*` (8.01, M-2).
- **Every call carries an explicit patient id.** The SPA route is
  `/dashboard/patients/:puuid`. The BFF resolves the integer `pid` once per
  request chain from `GET /api/patient/:puuid` (10.04). There is no session
  patient anywhere, which designs out 3.01, 3.16, 5.04 and 5.09.
- **Data sources are FHIR-first, standard REST where FHIR can't match the PHP
  card** (Decision 2026-09-25, `modules/README.md` column B):
  - FHIR: Header, Care Team.
  - REST: Allergies, Problems, Medications, Prescriptions, and Vitals (per
    encounter).

### 2.2 Layer model (strict one-way dependencies)

```
┌────────────────────────────────────────────────────────────┐
│ bff/src/server.ts — composition root (buildApp(deps))      │ ← everything below
├────────────────────────────────────────────────────────────┤
│ bff/src/http — Fastify routes, security headers, cookies   │ ← bff/auth, bff/cards, core
│ web/src — React SPA (presentation, browser bundle)         │ ← core (types + formatters only)
├────────────────────────────────────────────────────────────┤
│ bff/src/auth — OAuth flow, session store                   │ ← core
│ bff/src/cards — one use case per card                      │ ← bff/upstream, core
├────────────────────────────────────────────────────────────┤
│ bff/src/upstream — OpenEMR client, Zod schemas, allow-list │ ← core
├────────────────────────────────────────────────────────────┤
│ core — ids, CardResult, DTOs, parity rules, route table,   │ ← nothing (no I/O, no clock,
│        formatters                                          │   no framework)
└────────────────────────────────────────────────────────────┘
```

- **`web` never imports `bff`**, and `core` imports nothing outside `core`.
  ESLint `no-restricted-imports` enforces both. A test lints a deliberately bad
  import so the rule is proven to fire.
- The SPA imports DTO **types** from `core` (`import type`) plus the display
  formatters (`core/format.ts`). That keeps the date, age and name rules in one
  place (7.17, 7.18).
- **Parity rules run in the BFF**, so the browser receives only the rows the
  card shows. Problems for pid 13 sends 13 rows, not 39. That is the minimum
  necessary PHI in the browser, and the rules stay testable without React.

### 2.3 Session, cookies and OAuth

**Session store**
- The store is an in-memory `Map` keyed by a random 256-bit id.
- The cookie `dashboard_sid` holds only that id, signed with HMAC by
  `@fastify/cookie` using `DASHBOARD_SESSION_SECRET`.
- Cookie flags: `HttpOnly`, `SameSite=Lax`, `Path=/dashboard`, `Secure` in
  production. Path scoping keeps it clear of OpenEMR's cookies on `/`
  (`MIGRATION-OPTIONS.md` first steps, item 5).
- **Why `Lax`, not `Strict`:** a grader who follows a link from another site
  would otherwise look signed out on arrival. Lax still withholds the cookie on
  cross-site subresource requests. All `/bff/*` routes are `GET` and
  side-effect-free.

**Timeouts (1.06)**
- Idle timeout: 30 min.
- Absolute timeout: the access token's expiry, 1 h. `offline_access` is never
  requested, so there is no refresh token and no silent refresh (1.08, M-4).
- An upstream 401 destroys the session, and the SPA shows "Sign in again".

**Restart behavior.** A container restart signs everyone out, because sessions
live in memory. This is accepted and documented as a tradeoff in W2D-7.

**Login transaction (`/dashboard/login`)**
- The BFF generates `state`, `nonce` and a PKCE `code_verifier`, plus a
  `returnTo` that must be a path under `/dashboard/`.
- It stores these server-side under a transaction id held in a short-lived
  signed cookie (`dashboard_tx`, 10 min).
- It redirects (302) to `{issuer}/oauth2/default/authorize` with:
  `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`,
  `nonce`, `code_challenge`, `code_challenge_method=S256`.

**Callback (`/dashboard/callback`)**
1. Require the `state` to match the transaction.
2. Exchange the code server-side at `/token`, **always sending
   `client_secret`** (1.01, M-4), along with `code_verifier` and the same
   `redirect_uri`.
3. Verify the `id_token`: signature against the JWKS, `iss`, `aud =
   client_id`, `exp`, and `nonce` (1.03).
4. Create the session.
5. Redirect to `returnTo`.
6. On any failure, show one generic message: "Sign-in failed, please retry".
   The exchange error body is never shown.

**Logout (`POST /dashboard/logout`)**
- The request must carry `Origin` equal to the public origin; anything else
  gets 403.
- The BFF destroys the session and its tokens **first** (1.04: OpenEMR's logout
  revokes nothing).
- It then answers 303 to `/oauth2/default/logout` with `id_token_hint` (our own
  id token only), the one registered `post_logout_redirect_uri` =
  `{public}/dashboard/` (2.03), and a fresh `state`.

**Pinned OAuth configuration (10.01).** Endpoints come from configuration.
`scopes_supported` is never parsed. The issuer is OpenEMR's `site_addr_oath`
(`data/CONFIG.md`). The browser-facing authorize and logout URLs use the public
origin. Server-side `/token` and JWKS calls go to
`DASHBOARD_OPENEMR_INTERNAL_URL` (default `http://openemr`), following the
AgentForge adapter pattern (`deploy/vultr/docker-compose.yml`,
`AGENTFORGE_OPENEMR_BASE_URL`). Slice 01-01-01 verifies this against production
(risk R-3, §15).

**Scopes requested** (SMART v2 syntax, exact strings, identical on every
request):

```
openid api:oemr api:fhir
user/Patient.rs user/CareTeam.rs user/Practitioner.rs user/Organization.rs
user/patient.rs user/allergy.rs user/medical_problem.rs user/medication.rs
user/prescription.rs user/encounter.rs user/vital.rs user/list.r
```

**What the scopes deliberately leave out**
- `offline_access` (1.08).
- `launch/patient`. The BFF gets a user-context token; confirmed live in
  Phase 6 (`VERIFICATION.md`, "Resolved").

**What the BFF user must be granted.** The OpenEMR user needs these ACLs:
`patients/demo`, `patients/med`, `encounters/notes`, `encounters/auth_a` and
`lists/default` (3.14). Each card handles its own 403.

**`user/prescription.rs` makes M-1 (2.01) reachable with the BFF's token.**
The AUDIT-STATE rule applies: grant it only to this client, only with David's
explicit approval (HD-4), and only because the BFF sends allow-listed keys.

**Security headers on every BFF response**
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src
  'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none';
  base-uri 'none'; form-action 'self'`.
- `Referrer-Policy: no-referrer`, because the puuid is in the URL.
- `X-Content-Type-Options: nosniff`.
- `Cache-Control: no-store` on `/bff/*`, `/login`, `/callback` and `/logout`,
  so PHI is never cached.

**Request hygiene on `/bff/*`**
- Refuse requests whose `Sec-Fetch-Site` is present and isn't `same-origin`.
- Refuse any query string with a 400. The only input is the validated `:puuid`
  path parameter.

### 2.4 BFF routes (SPA-facing) and the upstream calls behind each

Base path `/dashboard` (Caddy `handle`, no prefix strip; see §7). JSON routes
return a `CardResult<T>` DTO (§2.5). Any row whose patient id doesn't match the
requested patient fails the whole card with an error (fail loudly, U-11).

| BFF route | Upstream calls, in order (under `http://openemr`) | Parity rule applied in the BFF (from `core`) |
|---|---|---|
| `GET /dashboard/health` | none | `{"status":"ok","service":"dashboard","git_sha":"<40 hex>"}`, compact JSON (`deploy.sh` greps `"git_sha":"<sha>"`) |
| `GET /dashboard/ready` | `GET /meta/health/readyz` (OpenEMR readiness; no token) | 200 only if OpenEMR is ready |
| `GET /dashboard/login` · `GET /dashboard/callback` · `POST /dashboard/logout` | `/oauth2/default/authorize` (browser) · `POST /oauth2/default/token`, `GET /oauth2/default/jwk` · `/oauth2/default/logout` (browser) | §2.3 |
| `GET /dashboard/bff/session` | none | `{authenticated, displayConfig}`: date format, age format, units (`data/CONFIG.md`; no API exposes them) |
| `GET /dashboard/bff/patients/:puuid/header` | 1. `GET /apis/default/fhir/Patient/{puuid}` 2. `GET /apis/default/api/patient/{puuid}` (resolves `pid`; a mismatch with the FHIR `id` → error) | Name = one `HumanName` formatter (fuller form, 7.18). DOB = `birthDate`. Sex = `gender` (+ `us-core-birthsex`). MRN = `identifier` type `PT` (`pubpid`). **Status = "Deceased" iff `deceasedDateTime`/`deceasedBoolean`, else "Active"; `Patient.active` is never read** (hard-coded `true`, `FhirPatientService.php:212`). Age / "Age at death" computed from `birthDate` with one formatter (7.17) |
| `GET /dashboard/bff/patients/:puuid/allergies` | 1. `GET /apis/default/api/patient/{puuid}/allergy` 2. `GET /apis/default/api/list/severity_ccda` (cached per process) | `filterActiveIssues`; keep API order (no sort); severity label with **raw-code fallback** ("(1)"); highlight only `severe` / `life_threatening_severity` / `fatal` (no promote-to-top, 4.03) |
| `GET /dashboard/bff/patients/:puuid/problems` | `GET /apis/default/api/patient/{puuid}/medical_problem` | `filterActiveIssues`; sort by `begdate` ascending, NULLs first; title only |
| `GET /dashboard/bff/patients/:puuid/medications` | 1. `rest.patient.read` (for `pid`) 2. `GET /apis/default/api/patient/{pid}/medication` | `filterActiveIssues`; sort by `begdate` ascending, NULLs first; title only (dosage instructions: "not available via API", 4.05). **404 with an empty body on this route only → empty** (6.04) |
| `GET /dashboard/bff/patients/:puuid/prescriptions` | 1. `rest.patient.read` (for `pid`) 2. `GET /apis/default/api/prescription?patient_id={pid}&source_table=prescriptions` | **All rows** (the legacy `active` filter never fires, 5.03). Sort by `active` DESC, `date_modified` DESC (NULLs last), `date_added` DESC, then `uuid` as a documented tiebreak. Refills = "Not available via API", never `0` (5.06). Details = size + unit + dosage (+ " in <interval>" when present; `form` isn't selected by the API). Filled = raw `date_added` |
| `GET /dashboard/bff/patients/:puuid/care-team` | 1. `GET /apis/default/fhir/CareTeam?patient={puuid}` 2. per participant: `GET /apis/default/fhir/Practitioner/{id}` or `/Organization/{id}` (ids taken from step 1, uuid-validated) | Pick the team: the first `active` by `name`, else the first by `name` (legacy `ORDER BY team_name`). Show **all** participants (inactive can't be hidden, 5.05/M-6). Status and Note = "Not available via API". Team status title from the 5 hard-coded `Care_Team_Status` titles. Rows keyed by position (8.15) |
| `GET /dashboard/bff/patients/:puuid/vitals` | 1. `rest.patient.read` (for `pid`) 2. `GET /apis/default/api/patient/{puuid}/encounter` (newest first by `eid`) 3. per encounter, newest first, until non-empty: `GET /apis/default/api/patient/{pid}/encounter/{eid}/vital` | First row of the first non-empty encounter. The route filters `deleted=0 AND formdir='vitals'` (5.01/5.02 designed out). **Cap: 50 encounters.** Hitting the cap is an error (`VITALS_SCAN_LIMIT`), never "Nothing Recorded". Explicit field list and order (7.20). Units from the `<field>_unit` keys; the metric secondary is computed client-side |

**Upstream allow-list** (`core/upstreamRoutes.ts`; the only way the BFF can
build an OpenEMR URL). REST prefix `/apis/default/api`, FHIR prefix
`/apis/default/fhir`.

| Route id | Path template | Path params (source) | **Allowed query keys (exact)** | Scope | ACL | Empty / non-2xx mapping |
|---|---|---|---|---|---|---|
| `fhir.patient.read` | `/fhir/Patient/{puuid}` | puuid (SPA route, uuid-validated) | none | `user/Patient.rs` | `patients/demo` | any non-200, or a Bundle instead of a Patient → error |
| `rest.patient.read` | `/api/patient/{puuid}` | puuid | none | `user/patient.rs` | `patients/demo` | 404 → error (the patient must exist) |
| `rest.list.read` | `/api/list/severity_ccda` | none (fixed literal) | none | `user/list.r` | `lists/default` | failure → labels fall back to the raw code; the card doesn't fail |
| `rest.allergy.list` | `/api/patient/{puuid}/allergy` | puuid | none | `user/allergy.rs` | `patients/med` | 200 `data: []` → empty |
| `rest.problem.list` | `/api/patient/{puuid}/medical_problem` | puuid | none | `user/medical_problem.rs` | `encounters/notes` | 200 `data: []` → empty |
| `rest.medication.list` | `/api/patient/{pid}/medication` | pid (from `rest.patient.read`) | none | `user/medication.rs` | `patients/med` | 200 `[]` or **404 with an empty body** → empty; any other 404 → error |
| `rest.prescription.search` | `/api/prescription` | none | **`patient_id`** (= pid, BFF-supplied) and **`source_table`** (fixed value `prescriptions`). Nothing else, ever (M-1 / 2.01, 4.10) | `user/prescription.rs` | `patients/med` | 200 `data: []` → empty |
| `fhir.careteam.search` | `/fhir/CareTeam` | none | **`patient`** (= puuid) | `user/CareTeam.rs` | `patients/med` | Bundle `total: 0` → empty, **only** because `fhir.patient.read` already succeeded in this chain (6.03) |
| `fhir.practitioner.read` / `fhir.organization.read` | `/fhir/Practitioner/{id}`, `/fhir/Organization/{id}` | id (from the CareTeam response, uuid-validated) | none | `user/Practitioner.rs` / `user/Organization.rs` | — | failure → that cell shows "Name unavailable" (logged); the card stays up |
| `rest.encounter.list` | `/api/patient/{puuid}/encounter` | puuid | none | `user/encounter.rs` | `encounters/auth_a` | 404 whose body shape is verified in slice 01-05-01 as "no encounters" → empty; anything else → error |
| `rest.vital.list` | `/api/patient/{pid}/encounter/{eid}/vital` | pid, eid (from the encounter list; which field the route expects is verified in slice 01-05-01) | none | `user/vital.rs` | `encounters/notes` | 200 `[]` → try the next encounter |

**How the allow-list is enforced**
- `buildUpstreamUrl(routeId, pathParams, query)` throws on:
  - any query key not in the route's list;
  - any missing fixed value;
  - any path param that fails its parser (uuid regex, positive integer).
- Values are URL-encoded after validation.
- The table has **no unscoped collection route**. `GET /api/patient` and
  `GET /api/medical_problem` are absent, which designs out 3.13. A test asserts
  that every route either carries a patient path param or a patient query key,
  or is `rest.list.read` or `*.read` by id.
- **The deliberate regression for slice 01-03-01** is to forward any
  SPA-supplied key into `rest.prescription.search`. The allow-list test must go
  red (`walkthroughs/PRESCRIPTIONS.md` (e) item 7).

### 2.5 Error and state model

`core/cardResult.ts` holds one discriminated union, shared by BFF and SPA:

```ts
type CardResult<T> =
  | { kind: 'ok'; patientId: PatientUuid; rows: readonly T[]; notes: readonly GapNote[] }
  | { kind: 'empty'; patientId: PatientUuid }                 // "Nothing Recorded"
  | { kind: 'forbidden'; patientId: PatientUuid }             // upstream 403
  | { kind: 'reauth' }                                        // upstream 401 / session gone
  | { kind: 'error'; patientId: PatientUuid; correlationId: string; code: ErrorCode };
```

(The header uses the same shape with one row.) Loading is a client-only state.
Every card renders exactly one of loading, ok, empty, forbidden, error or
reauth, and they are visually and textually distinct (W2D-3).

**Upstream → result mapping** (`bff/upstream/mapResponse.ts`; exhaustive
`switch` with an `assertNever` default):

| Upstream condition | Result | Catalog |
|---|---|---|
| 200 + `validationErrors` or `internalErrors` non-empty (REST envelope) | `error` | 6.02 |
| 200 + body that fails the route's Zod schema | `error` (`SCHEMA_MISMATCH`) | fail loudly |
| 200 + `data: []` (REST) | `empty` | — |
| 404 with an empty body, **`rest.medication.list` only** | `empty` | 6.04 |
| 404 on `rest.encounter.list` with the verified "no results" shape | `empty` (Vitals) | `walkthroughs/VITALS.md` (d) |
| FHIR Bundle `total: 0` after a successful `fhir.patient.read` in this chain | `empty` | 6.03 |
| FHIR Bundle empty without that precondition, or `OperationOutcome` in a 200 | `error` | 6.03 |
| 401 | `reauth` (the session is destroyed) | — |
| 403 | `forbidden`, for this card only | 3.14 |
| any other 4xx/5xx, timeout (5 s per call), network error | `error` | 6.01 |
| a row whose `puuid`/`pid`/`patient_id` ≠ the requested patient | `error` (`PATIENT_MISMATCH`) | 5.04 |

**Never render upstream error text.** OpenEMR error bodies can contain SQL and
paths (6.01). The BFF logs the route id, status, duration and a correlation id.
It never logs the body, the URL with ids, tokens, names, DOBs or clinical
values (AGENTS.md §PHI). The SPA shows "Couldn't load <card>. Reference
<correlationId>."

**Stale responses.** The SPA fetches with an `AbortController` keyed to the
current `:puuid`. It aborts on navigation and discards any result whose
`patientId` isn't the route's (5.04, 7.04). The header renders from the same
puuid before or alongside the cards; no card renders under another patient's
header.

### 2.6 How the catalog is designed out

#### Every "design out in port" entry

| Catalog ID | Legacy problem | Design decision in the port | Slice |
|---|---|---|---|
| 2.01 (High) | SQLi through query-parameter names on `/api/prescription` (M-1) | Allow-list table; only `patient_id` + fixed `source_table`; unknown key → throw; regression proof | 01-03-01 |
| 2.02 (High) | Care Team `note`/`provider_since` → `innerHTML` (U-5) | JSX text binding only; ESLint `react/no-danger` = error; no `innerHTML` anywhere (`no-restricted-properties`); CSP `script-src 'self'` | 01-01-01 (lint/CSP), 01-04-01 (card) |
| 3.01 (High) | `set_pid` switches the session patient, audits and runs CDR before auth (U-6) | No session patient; every call is authorized per request by scope + ACL upstream | 01-01-01 |
| 3.02 (High) | Identity emitted before the ACL gate (U-7) | The header DTO comes only from a successful authorized call; the SPA renders nothing from a failed call | 01-01-01 |
| 3.13 | Unscoped `user/` collection routes | The allow-list has no unscoped collection route; a test asserts it | 01-01-01 |
| 3.16 | `set_pid` state change on GET | No session patient; `/bff/*` is read-only GET; logout is POST + Origin check | 01-01-01 |
| 4.01 (High) | CORS preflight dead (M-3) | Same-origin serving through the BFF behind Caddy; no CORS needed | 01-01-01 |
| 4.02 | Empty-state wording depends on `lists_touch` (no API) | Always "Nothing Recorded" for an empty list (documented deviation); Prescriptions keeps its legacy "None" (not `lists_touch`-driven) | 01-02-01 (component), every card |
| 4.04 | Identity bar has no sex/status | Header adds sex (`gender`) and status derived from `deceasedDateTime` (documented addition) | 01-01-01 |
| 4.06 | No route by integer pid | Deep links keyed by puuid: `/dashboard/patients/:puuid` | 01-01-01 |
| 5.01 (Critical) | Vitals card shows a deleted set (join bug, U-1) | Legacy fragment unused; REST per-encounter route (`deleted=0 AND formdir='vitals'`); pid 13 must show set 27, never 28 | 01-05-01 |
| 5.02 (Critical) | FHIR vitals include deleted sets (M-5) | The port never calls `/fhir/Observation` for vitals; the allow-list has no such route | 01-05-01 |
| 5.04 (High) | Async fragments carry no patient id (U-11) | puuid in every BFF/API call; stale-response discard; `PATIENT_MISMATCH` error | 01-01-01 |
| 5.08 | `filterActiveIssues` vs FHIR `clinicalStatus` | Reproduce the PHP rule exactly on raw REST `outcome`/`enddate`, in OpenEMR's timezone (`DASHBOARD_OPENEMR_TZ`); never FHIR `clinicalStatus`/`activity` | 01-02-01 |
| 5.09 | `set_pid`/`set_encounterid` not validated | puuid parsed at the boundary; `pid`/`eid` come only from the patient's own API responses | 01-01-01, 01-05-01 |
| 5.18 | FHIR criticality ≠ card's severe highlight | Raw `severity_al` from REST for both the label and the highlight | 01-02-01 |
| 6.01 | API errors return raw exception text incl. SQL | The BFF never forwards bodies; correlation id only; test: a 500 body containing `SQLSTATE` never reaches the DTO or the logs | 01-01-01 |
| 6.05 | `fetchHtml` has no error handling | `CardResult` union; explicit loading/ok/empty/forbidden/error/reauth per card | 01-01-01 |
| 7.03 | Dashboard breaks outside the tabbed shell | Standalone SPA; no shell dependency | 01-01-01 |
| 7.04 | Identity bar names the previous patient while the new one loads | Header and cards keyed to the same route puuid; stale responses discarded | 01-01-01 |
| 7.05 | Collapse persistence bound late | React state per card; persistence in `localStorage` (try/catch, per viewer) | 01-02-01 |
| 7.08 | Slow loads | Cards fetched in parallel; header first; per-card loading; timing measured and reported in W2D-7 | 01-06-01 |
| 7.09 | Back-button navigation | Routable view per patient (URL = state) | 01-01-01 |
| 7.10 | Wall of text | **Not redesigned**: the brief forbids redesign. Cards stay tabular as in legacy. Logged as a Phase 9 side quest | won't (brief) |
| 7.12 | No accessibility tests | `vitest-axe` on every card state in the gate; `eslint-plugin-jsx-a11y`; manual keyboard pass in 01-06-01 | 01-01-01 → 01-06-01 |
| 7.13 | Collapse default = first user to toggle | Fixed default per card in code (expanded); per-viewer override in `localStorage` | 01-02-01 |
| 7.14 | Care Team has no empty state | "Nothing Recorded" when the Bundle is truly empty | 01-04-01 |
| 7.15 | Care Team names from `<select>` options | Names from FHIR `Practitioner`/`Organization` references | 01-04-01 |
| 7.17 | Inconsistent age formatting | One `formatAge` in `core/format.ts` (living and deceased) | 01-01-01 |
| 7.18 | Two name builders | One `formatName` (fuller `HumanName` form) used everywhere | 01-01-01 |
| 7.20 | Vitals renders `SELECT *` column order | Explicit field list and order from `ui/VITALS-FRAGMENT.md` parity spec | 01-05-01 |
| 7.24 | Vitals card near the bottom | **Decision: keep legacy relative card order** (no redesign). Recorded as decided, not moved | 01-05-01 |
| 7.25 | Medications vs Prescriptions confusing | Both cards kept; each card header carries a one-line source/rule label | 01-02-03, 01-03-01 |
| 8.01 (High) | Public clients can't get `user/` scopes (M-2) | SPA + thin BFF with a confidential client | 01-01-01 |
| 8.04 | Care Team rows built client-side from embedded JSON | Rendered from the API DTO in React components | 01-04-01 |
| 8.06 | Tabbed shell, many windows, unclear auth | One SPA, one BFF session | 01-01-01 |

#### Architectural Smells 8.01–8.15

| ID | Smell | Port decision | Slice |
|---|---|---|---|
| 8.01 | Public clients can't get `user/` scopes | Designed out: confidential BFF (above) | 01-01-01 |
| 8.02 | Services back-fill uuids on every read | Not ours to fix (legacy). The BFF absorbs the latency, and the timing budget in 01-06-01 includes it. Fetch Allergies or Problems before Medications where sequencing matters (6.07) | 01-02-03 |
| 8.03 | Rx card N+1 queries | Off the port path: `/api/prescription` is a single UNION query | — |
| 8.04 | Care Team rows from embedded JSON | Designed out (above) | 01-04-01 |
| 8.05 | Care Team template nests `<html><head>` | Off the port path by construction: the SPA renders fragments only | 01-04-01 |
| 8.06 | Tabbed shell | Designed out (above) | 01-01-01 |
| 8.07 | GET render inserts a `contact` row | Off the port path: the FHIR CareTeam read doesn't do this. Noted in the migration doc | 01-04-01 |
| 8.08 | CDR before first byte | Off the port path (no CDR in the API reads) | — |
| 8.09 | `src/` classes depend on page-global functions | Off the port path | — |
| 8.10 | `Controller` copies `$GLOBALS` into templates | Off the port path | — |
| 8.11 | `lists.inc.php` queries on include | Off the port path | — |
| 8.12 | Variable reuse / unrestored `chdir` | Off the port path | — |
| 8.13 | Two columns under one key (`drug_dosage_instructions`) | The Rx card reads only the `prescriptions` branch (`source_table=prescriptions`); the Zod schema documents the mapping | 01-03-01 |
| 8.14 | `patient_data` has no primary key | Off the port path | — |
| 8.15 | `care_team_member` has no uuid | Rows keyed by position within the chosen team; documented | 01-04-01 |

#### "Port depends on it": BFF rules (not design-outs, but enforced by tests)

| ID | Rule in the BFF | Slice |
|---|---|---|
| 1.01 / M-4 | Always send `client_secret` at `/token`; config validation refuses to start without it | 01-01-01 |
| 1.02 | PKCE S256; exchange the code immediately, server-side | 01-01-01 |
| 1.03 | `id_token_hint` = our own verified id token only | 01-01-01 |
| 1.04 | Logout destroys BFF tokens first; don't rely on OpenEMR revocation | 01-01-01 |
| 1.06 | BFF idle and absolute timeouts | 01-01-01 |
| 1.08 | No `offline_access`; any refresh token is treated as a secret, never logged or sent to the browser | 01-01-01 |
| 1.11 | Always send `state` (+ `nonce`) | 01-01-01 |
| 2.03 | Exactly one registered post-logout URI | 01-01-01 (+ HD-4) |
| 3.04 / 4.12 | Squad restriction and `hide_dashboard_cards` not enforceable: documented as access-model differences | 01-06-02 |
| 3.14 | Per-card 403 handling; the ACL list in HD-5 | every card slice |
| 4.08 / 4.09 | Never rely on FHIR `_sort`/`_count` or REST filters; sort and filter in `core` | every card slice |
| 5.03 | Rx shows all rows, sorted by the three keys | 01-03-01 |
| 5.05 / M-6 | Care Team inactive members shown; status/note "Not available via API" | 01-04-01 |
| 5.06 / M-7 | Refills "Not available via API", never 0 | 01-03-01 |
| 6.02 / 6.03 / 6.04 | Mapping table §2.5 | 01-01-01 (mapper), card slices (cases) |
| 6.06 | Production `api_log_option` must not store bodies (HD-6) | 01-06-01 |
| 6.07 | Null-uuid guard on the Medications route: sequence after Allergies/Problems, or treat a 500 as `error` | 01-02-03 |
| 9.01 | The port's tests run in `.githooks/pre-commit` (§6.4) | 01-01-01 |
| 9.03 | `/dashboard/ready` reflects OpenEMR readiness | 01-01-01 |
| 9.04 | Fixtures and scripts are line-ending safe (`.gitattributes` `dashboard/** text=auto eol=lf`; no byte-exact snapshots) | 01-01-01 |
| 10.01 | Pinned OAuth endpoints | 01-01-01 |
| 10.04 | `pid` resolved from `GET /api/patient/:puuid` | 01-01-01 |

**Won't carry forward.** Every other catalog entry is legacy-only. That covers
dispositions of "fix in legacy", "delete" and "out of port scope (catalog
only)" whose port relevance is "not on the port path": for example 1.05, 1.07,
1.09, 1.10, 1.12, 2.05, 2.06, 3.05–3.12, 3.17, 3.18, 4.11, the write-path bugs,
most of section 10, and 9.02 and 9.05–9.07. W2D-8 forbids fixing them here.
They remain upstream or Phase 9 material. Accepted API gaps are shown in the UI
as "Not available via API" and listed in `PATIENT_DASHBOARD_MIGRATION.md`:
5.05, 5.06, 4.02, 4.05, 3.04, 4.12, and the `form` field in Rx details.

### 2.7 Modular design within a layer

One module per card per layer, so a card slice touches exactly one file in
each of: `core/rules/<card>.ts`, `bff/src/upstream/schemas/<card>.ts`,
`bff/src/cards/<card>.ts`, `web/src/cards/<Card>.tsx`, plus their tests and
fixtures. Shared pieces (the `Card` shell, `useCard`, `mapResponse`,
`buildUpstreamUrl`) are built in slices 01-01-01 and 01-02-01, and only as far
as those slices need them.

## 3. Solution and project structure

**App folder (A4): `dashboard/`**, a new top-level folder. It is one npm
package with one lockfile, so the hook needs a single install and check line.
There are no workspaces.

```
dashboard/
├── package.json            scripts: dev, build, typecheck, lint, test, check, test:integration, live-check
├── package-lock.json
├── .gitignore              node_modules/, web/dist/, .env*, test-results/
├── BUILD_SHA               "$Format:%H$" (export-subst; stamped by git archive in deploy.sh)
├── Dockerfile              node:24-alpine; build stage (npm ci, check, vite build) → runtime (prod deps, web/dist, bff, core)
├── README.md               how to run locally, test, deploy (kept true; cites commands)
├── tsconfig.base.json      strict settings (§5); tsconfig per project (core, bff, web)
├── eslint.config.js        typescript-eslint strict, react, react-hooks, jsx-a11y, import boundaries
├── vitest.config.ts        projects: core+bff (node), web (jsdom)
├── core/                   pure TypeScript: no I/O, no clock, no framework
│   ├── ids.ts              branded PatientUuid, Pid, EncounterId, FhirId + parsers
│   ├── cardResult.ts       CardResult<T>, ErrorCode, GapNote, assertNever
│   ├── dto.ts              HeaderDto, AllergyRow, ProblemRow, MedicationRow, RxRow, CareTeamDto, VitalsDto
│   ├── upstreamRoutes.ts   the allow-list table (§2.4) as data
│   ├── format.ts           formatName, formatDate, formatAge (one each)
│   └── rules/              header.ts, issues.ts, prescriptions.ts, careTeam.ts, vitals.ts
├── bff/src/
│   ├── server.ts           composition root: buildApp({ config, fetch, now, logger, sessionStore })
│   ├── config.ts           env → typed config (Zod); refuses to start on missing secret or issuer
│   ├── buildInfo.ts        readBuildSha(): dashboard/BUILD_SHA → DASHBOARD_GIT_SHA → "unversioned"
│   ├── auth/               oauth.ts (login, callback, logout), session.ts (store, timeouts)
│   ├── upstream/           client.ts (buildUpstreamUrl, fetch with timeout), mapResponse.ts, schemas/*.ts
│   ├── cards/              header.ts, allergies.ts, problems.ts, medications.ts, prescriptions.ts, careTeam.ts, vitals.ts
│   └── http/               routes.ts, security.ts (headers, CSP, Sec-Fetch-Site), health.ts, static.ts
├── web/
│   ├── index.html
│   ├── vite.config.ts      base '/dashboard/'
│   └── src/                main.tsx, App.tsx, api.ts, useCard.ts, components/{PatientHeader,Card,States}.tsx, cards/*.tsx, styles.css
├── test/
│   ├── fixtures/recorded/  upstream responses recorded from the LOCAL SYNTHETIC stack (each file has _meta: route, pid, date, OpenEMR SHA, "recorded fixture, not live")
│   ├── fixtures/hand-built/ error shapes: 200+validationErrors, 404 empty body, 500 with SQL text, OperationOutcome
│   ├── core/  bff/  web/  contract/     *.test.ts(x), run by `npm test`
│   └── integration/        *.it.ts: local stack, opt-in, NOT in the hook (§6.3)
└── scripts/
    └── live-check.mjs      unauthenticated public-URL checks (§6.5)
```

**Outside `dashboard/`.** These touches are confined to the named slices:
- `.githooks/pre-commit` and `.gitlab-ci.yml`: add a gate step (01-01-01).
- `.gitattributes`: `dashboard/BUILD_SHA export-subst` and
  `dashboard/** text=auto eol=lf` (01-01-01).
- `deploy/vultr/docker-compose.yml`, `deploy/vultr/Caddyfile`,
  `deploy/vultr/deploy.sh` and `deploy/vultr/README.md` (01-01-01).
- `PATIENT_DASHBOARD_MIGRATION.md` at the repo root (01-06-02).
- `docs/agentforge/PLAN.md` W2D rows, `docs/agentforge/evidence/LEDGER.md` and
  `docs/legacy-audit/*`: status and evidence (every slice).
- **No file under OpenEMR's PHP tree is touched** (W2D-8). A `git diff --stat
  main...HEAD -- src interface library apis oauth2 templates sql` must be
  empty in every slice's handoff.

**Local dev loop (single origin, no Vite proxy).** Run `npm run dev --prefix
dashboard`. It runs `vite build --watch` into `web/dist` and the BFF with
`node --watch bff/src/server.ts` on `http://localhost:8790`, which serves
`/dashboard/`. The BFF calls OpenEMR at `http://localhost:8300`, and the issuer
is `https://localhost:9300` (`site_addr_oath`). The local client needs the
redirect URI `http://localhost:8790/dashboard/callback` (HD-2). Secrets live in
`dashboard/.env.local`, which is gitignored.

## 4. Tech stack and rationale

| Concern | Choice | Why | Replaces |
|---|---|---|---|
| Language | TypeScript 5.8+ (`strict`, `erasableSyntaxOnly`) | Decided (Phase 8 weights); one language front to back; erasable syntax lets Node 24 run the BFF's `.ts` directly | PHP 8 + Twig + inline JS |
| UI | React 19 + Vite 7 | Chosen route R1: default JSX escaping (2.02/2.04), largest ecosystem, fast build for the hook | Twig card templates, jQuery, `fetchHtml`/`placeHtml` fragments |
| Routing | None (one route parsed from `location.pathname`) | One view; keeps the bundle small for the W2D-7 bundle argument | Tabbed shell + iframe |
| Data fetching | A 40-line `useCard(url, puuid)` hook with `AbortController` | Six cards, no cache needed; `no-store` PHI; explicit states | `placeHtml` with no error handling (6.05) |
| Styling | Plain CSS reproducing the legacy card chrome (header bar, collapsible card, tables) | Parity without Bootstrap 4.6 (EOL) or a CSS framework | Bootstrap 4.6 + theme CSS |
| BFF | Fastify 5 + `@fastify/cookie` + `@fastify/static` | Typed, fast, `inject()` for HTTP tests without a socket | PHP session + `demographics.php` controller |
| OAuth | `openid-client` v6 with a static `Configuration` (no discovery, 10.01) | PKCE, state, nonce, id_token verification done by a maintained library. Fallback if it resists OpenEMR's quirks (e.g. the `scope` string missing `api:oemr`): hand-rolled `fetch` as in `agentforge/src/openemrAdapter.js:115-160` plus `jose` for the id_token | Core login (`auth.inc.php`) |
| Boundary parsing | Zod 4 | Same library as `agentforge` (4.6.5); parse, don't validate, at the upstream boundary | Untyped arrays |
| Tests | Vitest 3 (node + jsdom projects), `@testing-library/react`, `vitest-axe` | One runner for core, BFF and SPA; fast enough for the pre-commit hook | None on this path (9.01) |
| Lint | ESLint 9 + typescript-eslint strict + `eslint-plugin-react` (`no-danger`) + `react-hooks` + `jsx-a11y` | Bans raw HTML, `any`, and layer violations mechanically | — |
| Runtime | Node 24 (`node:24-alpine`), same as the `agentforge` image and `.gitlab-ci.yml` | One Node version across the repo; the laptop runs v24.19.0 | Apache + PHP-FPM for this page |

## 5. Coding standards

- **Types.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax` and `erasableSyntaxOnly` are all on. That means no
  `enum`, no `namespace` and no parameter properties.
  - Closed sets are string-literal unions matched with an exhaustive `switch`
    ending in `assertNever`, with no catch-all branch. This is the TypeScript
    form of CLAUDE.md's "exhaustive matching".
  - `any` is banned (lint error). Narrow `unknown` with Zod or type guards;
    never with `as`.
- **Domain primitives.** Use branded `PatientUuid`, `Pid`, `EncounterId` and
  `FhirId`, built only by their parsers in `core/ids.ts`. A `Pid` can't be
  passed where a `PatientUuid` is expected.
- **Parse at the boundary.** Every upstream response goes through its route's
  Zod schema, and every SPA path parameter goes through `ids.ts`. Downstream
  code never re-validates.
- **Immutability.** Use `readonly` DTO fields and `readonly T[]`. Rules return
  new arrays; nothing mutates input rows.
- **Dependency injection.** `buildApp(deps)` receives `fetch`, `now()`
  (clock), `logger`, `sessionStore` and `config`. `core` rules take `now` and
  the timezone as arguments. No module reads `process.env` except
  `bff/src/config.ts`. No `new Date()` in `core`.
- **Rendering.**
  - No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`.
    Lint errors enforce this.
  - Text goes through JSX only.
  - Every card renders through the shared `Card` shell with the six states.
- **Errors.**
  - Upstream failures become `CardResult` values; they are never thrown
    through to the SPA.
  - Programmer errors (a missing config value, an allow-list violation) throw
    and fail loudly.
  - Never catch-log-continue.
  - Never put upstream text into a response or a log message.
- **Logging.** Use Fastify's pino logger with redaction for `req.headers.cookie`,
  `authorization` and `set-cookie`.
  - Request logs record the **route template** (`/bff/patients/:puuid/allergies`),
    never the raw URL.
  - Upstream logs record the route id, status, duration and correlation id.
  - No names, DOBs, clinical values, tokens, puuids or pids appear in logs.
    A test runs the full login → callback → all cards flow through
    `fastify.inject` with a fake upstream, captures the log stream, and asserts
    none of the fixture's names, DOBs, tokens or ids appear. This is the
    "redaction tested against a real workflow trace" rule in AGENTS.md.
- **Honesty in names** (AGENTS.md).
  - Recorded fixtures are labelled `recorded` with their `_meta`; hand-built
    error shapes are labelled `hand-built`.
  - Nothing is called "live" unless it ran against a running OpenEMR.
  - `core` never reads expected values from fixtures or evals.
- **Comments.** Explain why, and cite the catalog ID or walkthrough, e.g.
  `// 6.04: medication route returns 404 + empty body for zero rows`.
  Public contracts (`CardResult`, DTOs, the route table, `buildApp`) get
  docstrings.
- **Style.** 2-space indent, LF, ESM only, named exports, one component per
  file, `PascalCase.tsx` for components and `camelCase.ts` otherwise.

## 6. Test strategy and gates

### 6.1 Layers

1. **Unit (`test/core`)**, table-driven, for every parity rule. Required
   cases:
   - **`filterActiveIssues`:** `outcome=1` hidden; `enddate` null shown;
     `enddate` = today hidden from midnight in OpenEMR's timezone (5.08
     semantics, bug-for-bug); `enddate` tomorrow shown; `outcome=6` shown.
   - **The `begdate` sort:** ascending, NULLs first, stable.
   - **The Rx sort:** `active` DESC, `date_modified` DESC with NULLs last,
     `date_added` DESC, then the `uuid` tiebreak. Include cases that exercise
     the `active` and `date_modified` legs, which pid 13 alone can't.
   - **Header status:** `deceasedDateTime` → Deceased; its absence → Active,
     **whatever `Patient.active` says**. One case sets `active: false` with no
     `deceasedDateTime` and expects Active.
   - **The vitals pick:** the first non-empty encounter, newest first; the cap
     returns an error.
   - **Care Team selection:** first active by name, else first by name.
   - **Formatters:** name, date and age, both living and "Age at death".
   - **`buildUpstreamUrl`:** an unknown key throws; a missing fixed value
     throws; a bad uuid or pid throws; no route is unscoped.
   - **`mapResponse`:** every row of §2.5.
2. **Contract (`test/contract`).** Recorded upstream fixtures for pids 13, 3
   and 12 go into each card use case through an injected fake `fetch`.
   - The expected outputs are the walkthrough counts (§6.2).
   - The fake `fetch` **asserts the exact outbound URL**: path, query keys and
     values, scope-bearing route id. This is the allow-list contract.
   - Hand-built fixtures cover the error shapes. One case sends a 500 whose
     body contains `SQLSTATE` and asserts that neither the DTO nor the logs
     contain it.
3. **BFF HTTP (`test/bff`, `fastify.inject`).**
   - Cookie flags: `HttpOnly`, `SameSite=Lax`, `Path=/dashboard`, and
     `Secure` under the production config.
   - `/bff/*` without a session returns 401 JSON.
   - No response body anywhere contains `access_token`, `refresh_token`,
     `id_token`, `client_secret` or a JWT-shaped string.
   - CSP and `no-store` headers are present.
   - A query string on `/bff/*` returns 400.
   - Logout without the right `Origin` returns 403.
   - `/login` redirects with `code_challenge_method=S256`, `state` and
     `nonce`, and without `offline_access`.
   - `/health` returns the compact SHA JSON.
   - The log-redaction flow test (§5).
4. **Component (`test/web`, jsdom).**
   - Every card in each state: loading, ok, empty, forbidden, error, reauth.
   - "Nothing Recorded" is the exact empty text (Prescriptions: "None", its legacy text).
   - The Refills and Care Team Status/Note cells read "Not available via API".
   - The header renders before the cards resolve.
   - A late response for a previous puuid is discarded.
   - `vitest-axe` finds no violations for each state (7.12).
5. **Integration (`test/integration`, opt-in, local stack only).** These run
   the real upstream client against `http://localhost:8300` with
   `DASHBOARD_IT_ACCESS_TOKEN`, a short-lived token David supplies from a
   local sign-in; it is never committed or logged.
   - They assert the walkthrough counts against live local responses.
   - `--record` refreshes `fixtures/recorded/`, and the diff is reviewed in
     the slice.
   - With no token, the run prints `SKIPPED (no token)` and exits 0. It is
     reported as skipped, never as passed.
6. **Live (public URL)**: §6.5.

### 6.2 Parity spec (expected values, from the walkthroughs' section (e))

These come from read-only SQL on the local synthetic DB. They are the contract
and integration expectations; the arc repeats them per slice.

| Card | pid 13 (data-rich) | pid 3 (empty-state) | pid 12 (deceased) |
|---|---|---|---|
| Header | name, DOB, sex, MRN all present; **Active** | all present; **Active** | **Deceased** + "Age at death" |
| Allergies | **2** rows, both labelled "(1)" (raw-code fallback), neither highlighted | "Nothing Recorded" | — |
| Problems | **13** of 39 rows, `begdate` ascending | "Nothing Recorded" | — |
| Medications | **1** of 5 rows, title only | "Nothing Recorded" (the upstream response is 404 with an empty body) | — |
| Prescriptions | **5** rows in order 66, 65, 64, 63, 62; Refills "Not available via API"; no " in <form>" suffix | 200 `[]` → "None" (the legacy Rx text) | — |
| Care Team | **1** team, **3** member rows from 4 participants (3 Practitioners + 1 Organization, the facility; the legacy card shows 2: documented break 5.05); roles "Primary Care Provider" and "Nurse" on the active members | Bundle `total: 0` → "Nothing Recorded" | — |
| Vitals | set **27** (2026-04-05) from encounter 367; **never set 28** (deleted) | set **14** (2014-02-01), encounter 12 (not empty) | — |

### 6.3 What each slice must prove (the "done" bar, AGENTS.md)

1. **Wired.** The deployed code path calls it. The compose service is on, and
   there is no flag or mode left off.
2. **Tested, with a deliberate regression.** Make one small deliberate break,
   show the hook go red (paste the failing test name into DEV-LOG), then
   revert. Each slice's regression is named in the arc file.
3. **Observed on the public URL** at the SHA that `/dashboard/health` reports,
   with the evidence written to `docs/agentforge/evidence/<sha>/dashboard/`
   and a row added to `docs/agentforge/evidence/LEDGER.md`.

Until all three hold, report the slice as `implemented, not wired`, `wired,
untested`, or `wired, tested, not yet observed`.

### 6.4 Test gates per slice (wired into the enforced hook)

`dashboard/package.json`:

```json
"scripts": {
  "typecheck": "tsc -b",
  "lint": "eslint .",
  "test": "vitest run",
  "build": "vite build --config web/vite.config.ts && node scripts/bundle-report.mjs",
  "check": "npm run typecheck && npm run lint && npm run test && npm run build"
}
```

- `bundle-report.mjs` prints the gzip size of the JS and CSS in `web/dist` and
  fails above **150 kB gzip JS**. Raising the budget needs a DEV-LOG entry. The
  printed number feeds W2D-7.

**`.githooks/pre-commit`: additions only.** No existing line is changed or
removed. These lines go after the `agentforge` install block (lines 15–18) and
before the W2 eval gate (line 48):

```sh
if [ ! -d dashboard/node_modules ] || [ dashboard/package-lock.json -nt dashboard/node_modules ]; then
  echo "Dashboard gate: installing locked dependencies..."
  npm ci --silent --prefix dashboard
fi

echo "Dashboard gate: typecheck, lint, unit/contract/component tests, build..."
npm run --silent --prefix dashboard check
```

**`.gitlab-ci.yml` mirror** (a new job; existing jobs untouched):

```yaml
dashboard-check:
  image: node:24-alpine
  stage: test
  script:
    - npm ci --prefix dashboard
    - npm run check --prefix dashboard
```

**Gate rules**
- The step runs on **every** commit, not only commits touching `dashboard/`,
  exactly as the `agentforge` suites do.
- A slice may add tests. It may never skip, `.only`, weaken or delete one to
  get green.
- Never commit with `--no-verify` (the PLAN.md incidents record one such
  slip).
- The existing gates are unchanged: `agentforge`, `evals`, `observability`,
  the module PHP checks and the W2 50-case gate. A dashboard commit runs all of
  them.
- Integration and live checks are **not** in the hook, because they need a
  running stack and a human sign-in. Their results are recorded per slice in
  DEV-LOG with the command and the result.

**Baseline.** `BASELINE-ERRORS.md` has no entries for `dashboard/`, because the
folder is new. Its baseline is zero: zero type errors, zero lint errors, zero
axe violations.

### 6.5 Live checks

- **`node dashboard/scripts/live-check.mjs <public-url> <sha>`** runs
  automatically, needs no credentials, and writes JSON into the evidence
  folder. It checks:
  - `/dashboard/health` reports `<sha>`;
  - `/dashboard/` serves the SPA with the CSP header;
  - `/dashboard/bff/session` without a cookie reports unauthenticated, and a
    card route returns 401;
  - `/dashboard/login` answers 302 to `/oauth2/default/authorize` with S256,
    `state`, `nonce`, the exact scope string and no `offline_access`;
  - the `Set-Cookie` flags.
- **Authenticated observation.** Agents may not type credentials, so David
  signs in on the public URL. The agent then reads the signed-in page through
  the browser tools, or David captures screenshots.
- Each card's checklist in the arc is ticked against a named SHA.
- Screenshots go to `docs/agentforge/evidence/<sha>/dashboard/`. They must
  hold synthetic data only, and no name or DOB is ever pasted into text
  evidence.

## 7. Deploy plan

It follows the existing pattern (`project/DEPLOY-VULTR.md`): one Compose
service built on the VM from a `git archive` of a commit on `staging/main`,
behind Caddy, reporting its SHA. Deployment itself needs David's approval
(A4 says "deployment only if David approves"; HD-1).

**1. Compose service** (`deploy/vultr/docker-compose.yml`, new block):

```yaml
  dashboard:
    restart: unless-stopped
    build:
      context: ../..
      dockerfile: dashboard/Dockerfile
    environment:
      PORT: 8790
      NODE_ENV: production
      DASHBOARD_BASE_PATH: /dashboard
      DASHBOARD_PUBLIC_ORIGIN: ${DASHBOARD_PUBLIC_ORIGIN:?DASHBOARD_PUBLIC_ORIGIN is required}
      DASHBOARD_OAUTH_ISSUER: ${DASHBOARD_OAUTH_ISSUER:?DASHBOARD_OAUTH_ISSUER is required}
      DASHBOARD_OPENEMR_INTERNAL_URL: ${DASHBOARD_OPENEMR_INTERNAL_URL:-http://openemr}
      DASHBOARD_OAUTH_CLIENT_ID: ${DASHBOARD_OAUTH_CLIENT_ID:?DASHBOARD_OAUTH_CLIENT_ID is required}
      DASHBOARD_OAUTH_CLIENT_SECRET: ${DASHBOARD_OAUTH_CLIENT_SECRET:?DASHBOARD_OAUTH_CLIENT_SECRET is required}
      DASHBOARD_SESSION_SECRET: ${DASHBOARD_SESSION_SECRET:?DASHBOARD_SESSION_SECRET is required}
      DASHBOARD_OPENEMR_TZ: ${DASHBOARD_OPENEMR_TZ:-America/Chicago}
      DASHBOARD_DEMO_PATIENTS: ${DASHBOARD_DEMO_PATIENTS:-}
    expose:
      - "8790"
    depends_on:
      openemr:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'node', '-e', "fetch('http://localhost:8790/dashboard/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 256M
```

- **Don't add `dashboard` to `proxy.depends_on`.** A failing dashboard must
  not keep Caddy, and with it OpenEMR and AgentForge, from starting; Caddy
  returns 502 for `/dashboard/*` only.
- The `DASHBOARD_OPENEMR_TZ` default is a placeholder. Slice 01-02-01 must set
  it to the timezone OpenEMR's `NOW()` runs in, confirmed from the stack's
  config, not assumed.
- `DASHBOARD_DEMO_PATIENTS` is an optional list of `label=puuid` pairs for the
  landing page's "Demo patients (configured)" links. The labels are neutral,
  e.g. "Demo A (data-rich)"; there are no names.

**2. Caddy** (`deploy/vultr/Caddyfile`). Add this to **all three** site blocks
(the `nip.io` host, `:80` and `:443`), after the `import` line and before the
catch-all `handle`:

```
    redir /dashboard /dashboard/ 308
    handle /dashboard/* {
        reverse_proxy dashboard:8790
    }
```

- Use `handle`, not `handle_path`. The app owns its `/dashboard` prefix, so
  local and production URLs, the redirect URI and the cookie path are
  identical.
- `deploy.sh` already recreates the proxy when the Caddyfile hash changes.

**3. `deploy/vultr/deploy.sh`**
- Add `dashboard` to `replaced`, so the folder ships and stale files are moved
  aside. Line 26 becomes `replaced="Dockerfile agentforge dashboard
  observability evals docs/agentforge"`.
- Add `dashboard` to the health loop at line 102: `for route in agentforge
  agentforge-w2 dashboard`. The loop already requires `"git_sha":"$sha"` from
  `$public_url/$route/health`, so `/dashboard/health` must report the deployed
  SHA or the deploy fails.
- Update the header comment's service list.

**4. SHA stamping.** Add `dashboard/BUILD_SHA` containing `$Format:%H$`, and
add `dashboard/BUILD_SHA export-subst` to `.gitattributes`. `readBuildSha()` in
`bff/src/buildInfo.ts` mirrors `agentforge/src/buildInfo.js`: a 40-hex stamp,
then `DASHBOARD_GIT_SHA`, then `unversioned`, never a guess.

**5. VM `.env`** (David, HD-4): the `DASHBOARD_*` secrets and URLs.
`deploy/vultr/README.md` lists every variable. Secrets exist only in the VM's
`.env` (1.07 accepted).

**6. Commands**
- Per slice, after merging to `main`:
  `AGENTFORGE_DEPLOY_SERVICES="dashboard" sh deploy/vultr/deploy.sh`,
  then `node dashboard/scripts/live-check.mjs "$AGENTFORGE_PUBLIC_URL" "$(git
  rev-parse HEAD)"`.
- At the freeze, both services come from the one freeze SHA (PLAN S11):
  `AGENTFORGE_DEPLOY_SERVICES="agentforge-w2 dashboard" sh
  deploy/vultr/deploy.sh`.

**7. Rollback.** Redeploy the previous `main` SHA. `deploy.sh` keeps a
timestamped source backup on the VM. The dashboard holds no state except
in-memory sessions.

## 8. Required documentation artifacts

- **`DEV-LOG.md`.** Append-only, newest first, one entry per slice. Each entry
  records gate counts, the deliberate-regression proof (the failing test name),
  integration results, and the live-check result with its SHA.
- **`arcs/ARC-01-DASHBOARD.md`.** Written before the first slice (done). Tick a
  slice when it's merged, and again when it's observed.
- **`BUGS-MITIGATIONS.md`.** Strike through resolved entries:
  `~~Title~~ — resolved in slice NN-SS-LL`.
- **`docs/agentforge/PLAN.md`.** Update the W2D row status, citing a command,
  test or URL. This is the status of record.
- **`docs/agentforge/evidence/LEDGER.md`.** One row per W2D ID per SHA.
- **`AUDIT-STATE.md`.** Add a phase-log line per session.
- **`dashboard/README.md`** and **`deploy/vultr/README.md`.** Keep them true;
  fix any sentence the code contradicts in the same slice.
- **`PATIENT_DASHBOARD_MIGRATION.md`** at the repo root. Written in slice
  01-06-02 and reconciled with the code at the freeze SHA.

## 9. Git workflow (this repo's conventions)

**Where to work.** Use the `../agentforge-week1-w2-dashboard` worktree or a
fresh worktree off `staging/main`. **Not the primary checkout**: it is on
`agentforge/w2-final` with unrelated staged `docs/legacy-audit` files.

**Branches.** One per slice, `slice/<NN-SS-LL>-<short-name>` (e.g.
`slice/01-01-01-walking-skeleton`), created from an up-to-date `staging/main`.
The audit docs must reach `main` first (HD-8); otherwise slice branches don't
carry this playbook or the DEV-LOG.

**Commits**
- Use Conventional Commits with scope `dashboard`, `deploy` or `legacy-audit`,
  e.g. `feat(dashboard): sign-in via BFF and patient header`,
  `test(dashboard): allow-list rejects client query keys`,
  `build(deploy): dashboard service, Caddy route, SHA health loop`.
- Add `--trailer "Assisted-by: Claude Code"` (CLAUDE.md), or the actual tool's
  name.
- The hook must pass. Never use `--no-verify`.

**Merge**
- Merge into `main` with a merge commit (`--no-ff`), the repo's convention
  (e.g. `521af47 Merge fix/trace-eval and feat/live-acceptance`). Push to
  `staging` (GitLab `main`, canonical). GitHub `origin` is a one-way mirror.
- The implementer never merges or pushes to `main` without David's explicit
  "merge" for that slice.
- No proof or release branch is kept unmerged (AGENTS.md).

**Deploy.** Only from `main`. `deploy.sh` refuses a SHA that isn't on
`staging/main` unless `AGENTFORGE_DEPLOY_ALLOW_UNMERGED=1`, which is not used
for dashboard evidence.

**Tags.** `dashboard-arc-01-complete` on the freeze SHA.

## 10. The slice loop

**Roles**
- The **implementer** (a coding agent or David) branches, writes code, tests
  and docs, runs the gates, collects evidence and hands off.
- The **reviewer** (David) reviews, says "merge", and signs in for the
  authenticated live observation.

**Steps**
1. **Load context.** Read this file, the arc's slice block, the last 3–5
   DEV-LOG entries, the slice's catalog IDs in `BUGS-MITIGATIONS.md`, and the
   walkthrough for the card (sections (b)–(e)).
2. **Plan.** Write the slice plan (§13) in the DEV-LOG entry with status
   `in-progress`, covering the layers touched (core / bff / web / tests /
   deploy), the catalog IDs, the acceptance check and the named deliberate
   regression. The deadline pace leaves no approval round-trip unless the plan
   departs from the arc; if it does, stop and ask.
3. **Branch** from `staging/main`.
4. **Build** code and tests together. Parity comes from §2.4 and the
   walkthrough; catalog entries are designed out, not re-implemented.
5. **Gates.** Run `npm run check --prefix dashboard`, then the full hook
   through a real `git commit`. Run the integration tests if David has
   supplied a token.
6. **Deliberate regression.** Break the named rule, commit-attempt, capture
   the red hook output (test name), then revert.
7. **Docs.** Update DEV-LOG (`ready-for-commit`), the arc checkbox, the catalog
   strike-throughs, and the PLAN.md W2D row (`wired, tested, not yet
   observed`).
8. **Handoff.** Report the slice ID, branch, gate counts, regression proof,
   files changed, `git diff main...HEAD`, and confirmation that the PHP tree
   diff is empty.
9. **Merge on David's "merge", then deploy** (§7.6), then run
   `live-check.mjs`.
10. **Observe.** At the next observation window (arc: Sat 12:00, Sat 20:00,
    Sun 08:30), tick the live checklist, write the evidence and the LEDGER
    row, and set DEV-LOG to `merged` and PLAN.md to observed.

**Stop and ask if**
- a slice exceeds 150% of its time box (PLAN.md stop conditions);
- the gate needs loosening;
- a check would need a backend change;
- any step would write to OpenEMR.

## 11. Arc / Story / Slice hierarchy

- **Arc** → **Story** → **Slice**, as in the template, but sized to the
  deadline.
- A **story** is one card or one requirement.
- A **slice** is one vertical cut through `core` → `bff` → `web` → tests →
  deploy: **1–4 h**, **≤ ~500 lines** of meaningful diff.
- Slice IDs use the form `NN-SS-LL`.

## 12. Roadmap

| # | Arc | Slices | Requirements / catalog |
|---|---|---|---|
| 01 | **Dashboard to the deadline** (`arcs/ARC-01-DASHBOARD.md`) | 01-01-01 walking skeleton (sign-in + header, deployed) → 01-02-01 Allergies → 01-02-02 Problems → 01-02-03 Medications → 01-03-01 Prescriptions → 01-04-01 Care Team → 01-05-01 Vitals → 01-06-01 parity evidence and hardening → 01-06-02 `PATIENT_DASHBOARD_MIGRATION.md` → 01-06-03 freeze deploy and evidence | W2D-1…W2D-8; §2.6 |
| 02 | Post-deadline (not planned) | Phase 9 side quests: severe-allergy sort (4.03), patient search, restricted-user ACL live tests (3.14 mismatch), zero-vitals patient, upstream reports (M-1 etc.) | — |

Arc 01 starts with the walking skeleton. There is no separate "Arc 00",
because the skeleton is the first slice of the only arc this deadline allows.

## 13. Templates

- **Arc file:** `arcs/ARC-01-DASHBOARD.md`.
- **DEV-LOG entry:** see the `DEV-LOG.md` header.
- **Slice plan** (inside the DEV-LOG entry):

```markdown
## Slice NN-SS-LL — <title>
Flow / requirement delivered: W2D-x — ...
Legacy behavior replaced: <ui/ analysis>, <walkthrough>
Layers touched: core ... · bff ... · web ... · tests ... · deploy ...
Upstream routes added to the allow-list: <route ids>
Catalog IDs: ...
Deliberate regression: <the break> → expected red test: <name>
Acceptance check (a user can do this): ...
```

## 14. Definition of Done

**Slice**
- The three-part AGENTS.md bar (§6.3) holds at one named SHA. Until then, the
  slice is reported by its honest partial status.
- The gates are green with counts reported.
- The deliberate regression was shown red.
- The PHP-tree diff is empty.
- DEV-LOG, the arc checkbox, the catalog strike-throughs, the PLAN.md row and
  the LEDGER row are updated.

**Story.** Every slice is done, and the walkthrough checklist is ticked for
pids 13, 3 and (header) 12.

**Arc 01**
- Everything below holds **at the freeze SHA**, which `/dashboard/health` and
  `/agentforge-w2/health` both report:
  - W2D-1…W2D-5 and W2D-7 rows are PASS in the LEDGER;
  - `PATIENT_DASHBOARD_MIGRATION.md` matches the code;
  - there is a side-by-side screenshot set (W2D-5).
- The `dashboard-arc-01-complete` tag and a retrospective DEV-LOG entry exist.

**Project (parity).** Every in-scope section appears in the parity table of
`PATIENT_DASHBOARD_MIGRATION.md`, marked "same", "deliberate deviation" (with
its catalog ID) or "not available via API". Every design-out entry in §2.6 is
struck through or explicitly marked "won't".

## 15. Human-readiness items (David) and risks

| ID | Item | Blocks |
|---|---|---|
| HD-1 | Approve deploying the dashboard to the public VM (A4: "deployment only if David approves") | 01-01-01 deploy |
| HD-2 | Local: add redirect URI `http://localhost:8790/dashboard/callback` and post-logout URI `http://localhost:8790/dashboard/` to the Phase 6 local confidential client (or register a new one); confirm its scopes match §2.3; put the secret in `dashboard/.env.local` | 01-01-01 local |
| HD-3 | Production: enable `rest_fhir_api` (Header and Care Team use FHIR; it is off today, `PLAN.md` "Verified facts") | 01-01-01 deploy |
| HD-4 | Production: register the confidential client "AgentForge Dashboard" with redirect `https://<host>/dashboard/callback`, **one** post-logout URI `https://<host>/dashboard/`, and the §2.3 scopes, **including `user/prescription.rs`**. This explicitly approves making M-1 reachable with this client's tokens, under the allow-list rule. Enable the client, and put `DASHBOARD_*` values in the VM `.env` | 01-01-01 deploy, 01-03-01 |
| HD-5 | Production: a grader demo login with ACLs `patients/demo`, `patients/med`, `encounters/notes`, `encounters/auth_a` and `lists/default` (a human step) | 01-06-03 |
| HD-6 | Production: confirm `api_log_option` doesn't store bodies (6.06) and `site_addr_oath` equals the public origin | 01-01-01 deploy |
| HD-7 | Production data: the `seed/phase1-*.sql` files are marked **LOCAL DEV STACK ONLY**. Decide whether to apply them to production (synthetic; a write needs approval) or accept that the pid 13/3/12 expectations are local-only, with public evidence recorded against whichever synthetic patients production has | 01-01-01 live evidence onward |
| HD-8 | Merge the audit branch `agentforge/w2-dashboard` (draft MR staging !81) into `main`, so slice branches carry this playbook | 01-01-01 branch |

**Risks**
- **R-1 · FHIR wording.** Four cards and Vitals use REST. The brief says each
  card pulls "live data from the FHIR API". The defense in W2D-7 cites a
  catalog ID per REST card: 5.08/5.18 (Allergies), 5.08/M-8 (Problems), "not
  separable in FHIR" (Medications), 5.06/mixing (Prescriptions), 5.02
  (Vitals). PLAN.md W2D-3/4 must be reconciled (§16).
- **R-2 · Time.** The work is budgeted at about 18 h, against R1's 14–20 h
  estimate. The circuit breaker is the Saturday 12:00 checkpoint (arc). The
  cut order is in the arc.
- **R-3 · Issuer/host split.** The browser authorizes against the public
  origin while the BFF calls `/token` over the Docker network. If OpenEMR
  rejects that combination, the fallback is to call `/token` and the JWKS
  through the public origin.
- **R-4 · Unverified shapes.** The Vitals encounter-list 404 body, and which
  encounter field the vital route's `:eid` takes, are both open questions in
  `walkthroughs/VITALS.md`. They are verified in slice 01-05-01 before the
  mapping is written.
- **R-5 · In-memory sessions.** They are lost on restart. This is acceptable
  for the demo and stated in W2D-7.

## 16. Conflicts with `PLAN.md` / `AGENTS.md` to resolve

| # | Where | Conflict | Proposed resolution |
|---|---|---|---|
| C-1 | `PLAN.md:160` W2D-3 | The acceptance criterion names FHIR `AllergyIntolerance`, `Condition` and `MedicationRequest` for the cards. The decided sources are REST for Allergies, Problems, Medications and Rx | David updates W2D-3's criterion to "FHIR-first; REST where FHIR can't match, each defended with its catalog ID in W2D-7". Hard-gate wording is literal (AGENTS.md), so this must be explicit |
| C-2 | `PLAN.md:161` W2D-4 | "vitals (FHIR `Observation` vital-signs)". The port must use REST per-encounter, because FHIR serves the deleted set (5.02, Critical) | Update W2D-4 to "Vitals via REST per-encounter (5.02)" |
| C-3 | `PLAN.md:148,173-174,198-209` | The heading says "approach not decided"; the verified facts talk of "a public browser client with PKCE"; open decisions 1–4 are listed as open | Update the heading; say "confidential BFF client" (W2D-1 already does); close decisions 1–3 with pointers to this file |
| C-4 | `PLAN.md:5-7` Goal, S11 | The goal says the freeze commit is deployed to `/agentforge-w2`; S11 deploys "both routes" (W1 + W2) | Extend the goal and S11 to include `/dashboard` and the `dashboard` health check at the freeze SHA |
| C-5 | `PLAN.md` "Quality gates" | "Every MR: … new golden cases for the behavior it adds" is AgentForge-specific | Add "dashboard MRs: new tests in `dashboard/test` plus a deliberate-regression proof" |
| C-6 | `AGENTS.md` "One plan file … do not create another plan, checkpoint or status doc" | This playbook, the arc file and `DEV-LOG.md` are plan- and status-shaped | The requested audit skill artifacts. They stay subordinate: PLAN.md W2D rows are the status of record, and these files hold process and slice detail only. David confirms, or the arc and DEV-LOG fold into PLAN.md |
| C-7 | `AGENTS.md` scope line and `CLAUDE.md` precedence line | Both list `agentforge/`, `evals/`, `observability/`, `deploy/vultr/`, `docs/agentforge/` as the AgentForge surface. The new `dashboard/` isn't listed, so which rules govern it is ambiguous | Add `dashboard/` (and `docs/legacy-audit/`) to both lists in slice 01-01-01, with David's approval |
| C-8 | `REQUIREMENTS-TRACE.md` A4 | "Deployment only if David approves", but AGENTS.md "done" requires the public URL | HD-1 |
| C-9 | `walkthroughs/PRESCRIPTIONS.md` (b)2, (e)1–3 | Uses the query key `pid` | Superseded: `VERIFICATION.md` "Resolved", `modules/README.md` column B and BUGS 2.01/4.10 fix **`patient_id`** as the only patient key. The walkthrough's `pid` wording is stale |
| C-10 | `walkthroughs/CARE-TEAM.md` (b)4 | Assumes a patient-context token that bypasses the ACL | The BFF token is user-context (`VERIFICATION.md` "Resolved"), so `patients/med` + `user/CareTeam.rs` apply (§2.4) |
