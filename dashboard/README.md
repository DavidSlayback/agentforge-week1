# Patient dashboard (port of OpenEMR's PHP patient dashboard)

A React + TypeScript + Vite SPA served same-origin by a Fastify BFF that holds
a **confidential** OpenEMR OAuth client. The browser only ever holds an
HttpOnly session cookie; OAuth tokens and the client secret stay in the BFF.
Playbook: [`docs/legacy-audit/MIGRATION-REACT.md`](../docs/legacy-audit/MIGRATION-REACT.md);
slices and status: [`docs/legacy-audit/arcs/ARC-01-DASHBOARD.md`](../docs/legacy-audit/arcs/ARC-01-DASHBOARD.md)
and `docs/agentforge/PLAN.md` (W2D-1…W2D-8, the status of record).

Current scope. Slice 01-01-01 (walking skeleton): sign-in / sign-out through
OpenEMR's OAuth2 server, patient selection by MRN (`pubpid`) or configured demo
link, and the persistent patient header (name, DOB with age, sex, MRN, status;
sticky at the top of the viewport since slice 01-06-04, except on viewports
20 rem tall or less, about 400 % zoom, where it scrolls with the page; its
scroll padding follows its measured height). A card body that scrolls
sideways becomes a named, focusable region while it overflows. Accessibility
evidence: [`docs/legacy-audit/evidence/a11y/`](../docs/legacy-audit/evidence/a11y/README.md).
Status is **Deceased** iff FHIR `deceasedDateTime` (or `deceasedBoolean: true`)
is present; `Patient.active` is never read (OpenEMR hard-codes it `true`).

Clinical cards (slice 01-02-01 on; all six are built), laid out as on the legacy page
(Allergies | Medical Problems | Medications in one row, Prescriptions and Care
Team full width, Vitals in the left two-thirds; one column on phones), each loaded by its own BFF route with its
own loading, empty ("Nothing Recorded"), forbidden, error and sign-in-again
state. Every card first resolves the patient through `GET /api/patient/:puuid`;
no card route is called before that read succeeds.

- **Allergies** (`/bff/patients/:puuid/allergies`): REST
  `/api/patient/:puuid/allergy`, filtered by the PHP card's
  `filterActiveIssues()` rule (`core/rules/issues.ts`: `outcome != 1` and
  `enddate` empty or later than now in `DASHBOARD_OPENEMR_TZ`), API order kept.
  Each row shows the `severity_ccda` label from `/api/list/severity_ccda`, or
  the raw code ("(1)") when no label exists; only severe, life-threatening and
  fatal rows are highlighted.
- **Medical Problems** (`/bff/patients/:puuid/problems`): REST
  `/api/patient/:puuid/medical_problem` (ACL `encounters/notes`, so this card
  can be "Not authorized for this section" while the others load), one row per
  problem uuid, the same active-issue rule, sorted by `begdate` ascending with
  missing dates first; title only.
- **Medications** (`/bff/patients/:puuid/medications`): hybrid. The list is
  REST `/api/patient/:pid/medication` with the integer `pid` taken from the
  patient read (only REST carries the `outcome` the active-issue rule needs);
  the same active-issue rule and `begdate` sort. When at least one row is
  active, the BFF also reads FHIR
  `/fhir/MedicationRequest?patient=<puuid>&intent=plan` (exactly those two
  keys) and joins each `dosageInstruction[].text` onto the REST row with the
  same uuid, shown after the title as the legacy card does. Every entry's
  `subject` must be the patient (else `PATIENT_MISMATCH`). If that read fails
  for any reason (a client registered without `user/MedicationRequest.rs`
  gets 401), the list still shows and a note says the instructions couldn't
  be loaded; the card never asks to sign in again for it. The REST route
  answers a patient with no rows with HTTP 404 and an empty body; on this
  route only, that is "Nothing Recorded".

- **Prescriptions** (`/dashboard/bff/patients/:puuid/prescriptions`): REST
  `/api/prescription?patient_id=<pid>&source_table=prescriptions`, with the
  integer `pid` taken from the patient read. Those two keys are the only ones
  ever sent (M-1: the route builds SQL from query-parameter names; the
  allow-list throws on any other key, and `/bff/*` refuses query strings).
  **All** rows are shown (the legacy `active` filter never fires), sorted
  `active` DESC, `date_modified` DESC (NULLs last), `date_added` DESC, then
  `uuid`. Columns Drug, Details (size + unit, dosage, " in <interval>"),
  Qty, Refills ("Not available via API": the API never selects `refills`) and
  Filled (raw `date_added`). Every row's `puuid` must be the patient's. Empty
  (HTTP 200, `data: []`) reads "None", the legacy card's text.

- **Care Team** (`/dashboard/bff/patients/:puuid/care-team`): FHIR
  `/fhir/CareTeam?patient=<puuid>` after the patient read (an empty Bundle is
  "Nothing Recorded" only because that read succeeded). Every team's
  `subject` must be the patient. One team is chosen as the legacy card does:
  `entered-in-error` teams skipped, then the first `active` team by name
  (case-insensitive, missing name first), else the first by name; ties break
  on the resource id, so the choice never depends on Bundle order. Every
  Practitioner/RelatedPerson participant is a row, **inactive ones included**
  (FHIR has no member status, M-6); Organization participants are the members'
  facilities and fill the Facility column. Member and facility names come from
  `/fhir/Practitioner/:id` and `/fhir/Organization/:id` (uuid-validated ids
  from the CareTeam, at most 20 reads); a failed read shows "Name unavailable"
  and the card stays up. Those reads need `admin/users`, and OpenEMR serves
  only users with an NPI as Practitioners, so locally every member name is
  unavailable. Status and Note read "Not available via API". The legacy card
  had no empty text; the port says "Nothing Recorded".

- **Vitals** (`/dashboard/bff/patients/:puuid/vitals`, the additional
  section, kept in its legacy position): REST `/api/patient/:puuid/encounter`,
  then `/api/patient/:pid/encounter/:eid/vital` one encounter at a time,
  newest encounter number first, until an encounter has a set. That route
  excludes deleted forms, so the card shows the **latest non-deleted** set, a
  deliberate deviation from the legacy card, whose join can show a deleted set
  (5.01); FHIR `Observation` is never used (no deleted filter, 5.02). At most
  50 encounters are walked; past that with encounters left unchecked the card
  is an error (`VITALS_SCAN_LIMIT`), never "Nothing Recorded". Every encounter
  and vitals row must be the patient's. Fields follow the legacy order, labels,
  skip rule and number formats, with the unit each value carries from the API
  (`<field>_unit`; one unit system, no metric secondary). Pediatric patients
  (age 20 or under) get the legacy "See Growth-Chart" BMI status and the
  percentile fields. No encounters (HTTP 200 `data: []`, or the 404 with an
  empty envelope the controller asks for) is "Nothing Recorded".

## Layout

| Folder | What | Depends on |
|---|---|---|
| `core/` | Pure TypeScript: branded ids, `CardResult`, DTOs, parity rules (`rules/header.ts`), formatters, the upstream allow-list (`upstreamRoutes.ts`), wire guards | nothing (lint-enforced) |
| `bff/src/` | Fastify BFF: config, OAuth (`auth/`), OpenEMR client + response mapping (`upstream/`), use cases (`cards/`), HTTP routes and security headers (`http/`) | `core` |
| `web/` | React SPA (`web/src`), built by Vite into `web/dist` | `core` (never `bff`, lint-enforced) |
| `test/` | Vitest: `core`, `bff` (Fastify `inject`), `contract` (fake OpenEMR asserting exact outbound URLs), `web` (jsdom + axe), `lint` (proves the boundary rules fire); `integration/` is opt-in | — |

Fixtures: `test/fixtures/shaped/` are **shaped, not recorded**: values from
read-only SELECT on the local synthetic DB, structure from OpenEMR's FHIR/REST
serializers (each file's `_meta` says so). `test/fixtures/hand-built/` are
error shapes. Recorded responses go to `test/fixtures/recorded/` via the
integration script's `--record`.

## Commands

```sh
npm ci --prefix dashboard
npm run check --prefix dashboard        # typecheck, lint, tests, build + bundle budget (the gate)
npm run dev --prefix dashboard          # http://localhost:8790/dashboard/ (reads dashboard/.env.local)
npm run test:integration --prefix dashboard   # opt-in; needs DASHBOARD_IT_ACCESS_TOKEN, else prints SKIPPED
node dashboard/scripts/live-check.mjs <base-url> <sha|any> [--out file.json]   # unauthenticated checks
```

`npm run check` runs in `.githooks/pre-commit` on every commit and is mirrored
by the `dashboard-check` job in `.gitlab-ci.yml`.

## Local OAuth setup

1. Register a confidential client on the local OpenEMR
   (`POST https://localhost:9300/oauth2/default/registration`,
   `application_type: private`) with redirect URI
   `http://localhost:8790/dashboard/callback`, post-logout URI
   `http://localhost:8790/dashboard/`, and the scope string in
   `bff/src/config.ts` (`OAUTH_SCOPE`); then enable it in the local DB
   (`oauth_clients.is_enabled = 1`).
2. Copy `.env.example` to `.env.local` (gitignored) and fill in the client id,
   secret and a random `DASHBOARD_SESSION_SECRET`.
3. `npm run dev --prefix dashboard`, open `http://localhost:8790/dashboard/`,
   and sign in with an OpenEMR user on OpenEMR's own OAuth2 login page.

## Configuration

`bff/src/config.ts` is the only module that reads the environment; it refuses
to start on a missing or short secret, a public origin with a path, or a
non-https public origin in production.

| Variable | Required | Meaning |
|---|---|---|
| `DASHBOARD_PUBLIC_ORIGIN` | yes | Browser-facing origin (`https://host`); builds the redirect and post-logout URIs |
| `DASHBOARD_OAUTH_ISSUER` | yes | OpenEMR issuer = id token `iss` (`<site_addr_oath>/oauth2/default`); the browser's authorize and end-session URLs hang off it |
| `DASHBOARD_OAUTH_CLIENT_ID` | yes | Confidential client id |
| `DASHBOARD_OAUTH_CLIENT_SECRET` | yes | Client secret, sent on every `/token` call |
| `DASHBOARD_SESSION_SECRET` | yes | ≥ 32 chars; signs the session cookies |
| `DASHBOARD_OPENEMR_INTERNAL_URL` | no (`http://openemr`) | Server-side origin for `/token`, JWKS and the APIs |
| `DASHBOARD_OPENEMR_TZ` | no (`America/Chicago`) | OpenEMR's PHP timezone: "today" for ages and "now" for the active-issue rule. Must match the PHP `date.timezone` (the local stack runs UTC) |
| `DASHBOARD_DEMO_PATIENTS` | no | `label=<uuid>,…` neutral demo links |
| `DASHBOARD_UPSTREAM_TIMEOUT_MS` | no (5000) | Per-call upstream timeout |
| `DASHBOARD_GIT_SHA` | no | SHA fallback when `BUILD_SHA` is not stamped |
| `PORT`, `HOST` | no (8790, 0.0.0.0) | Listen address |

`/dashboard/health` reports `git_sha` from `BUILD_SHA` (stamped by
`git archive` through `export-subst`), else `DASHBOARD_GIT_SHA`, else
`unversioned`.

## Known limits (this slice)

- Sessions are in memory: a restart signs everyone out. No refresh token is
  requested (`offline_access` is never asked for), so sessions end with the
  1 h access token.
- OpenEMR's logout revokes no token; the BFF destroys its own copy first.
