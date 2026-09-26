# Migration & Port Options — patient dashboard

Five routes for moving OpenEMR's PHP patient dashboard to a modern
presentation layer on OpenEMR's existing REST/FHIR API, scored against the
weights David agreed before any scoring (`AUDIT-STATE.md`, Decisions,
2026-09-25). The aim is **route selection**. The chosen route gets its
playbook in Phase 10, and this scoring is the evidence base for the graded
defense in `PATIENT_DASHBOARD_MIGRATION.md` (W2D-7, DB-11).

**Result in one line:** R1 (React + Vite SPA + Node BFF) scores 110 of 135.
That is a **near-tie** with R3 (Vue, 109) and R2 (SvelteKit, 108), so David
decides. See [Recommendation](#recommendation).

Tier 3 (Opus), Phase 8 Part A, 2026-09-25. Legacy code cited at
`legacy-baseline` (`3ccfe1d`).

**Size of the problem.** The codebase is about 1.0M non-blank lines after
exclusions (`INVENTORY.md`), but the port is requirements-scoped. It covers 29
audited units: the 2,080-line `demographics.php` and its fragments, the header,
6 cards (Allergies, Problems, Medications, Prescriptions, Care Team, Vitals),
the OAuth2 server and 7 tables (`PROJECT-MAP.md`, `data/SCHEMA.md`). There are
no reports. **Catalog:** 164 findings: 2 Critical, 18 High, 61 Medium and 83
Low (`BUGS-MITIGATIONS.md`).

**Fixed by earlier phases, not re-decided here.**
- The client model is an SPA plus a thin BFF holding a confidential OAuth
  client (auth code + PKCE). Tokens stay server-side, and the BFF serves the
  SPA from the same origin.
- Data is FHIR-first, with REST per card where FHIR can't match the card.
- The parity rules are fixed (`AGENT-BRIEF.md`).
- The language is TypeScript.
- The backend is untouched (W2D-8 / DB-10).

## Decision dimensions

David agreed these weights on 2026-09-25 ("defaults"), before scoring. The
weights run from 1 to 5 and sum to 27, so the maximum weighted total is
27 × 5 = **135**.

| # | Dimension | Question | Weight |
|---|---|---|---|
| 1 | Working by Sunday | Can this route pass every W2D row at one deployed SHA by Sunday 2026-09-27 12:00 CT? The release freeze is 08:00 CT (`docs/agentforge/PLAN.md:5-11`), about 36 h of wall clock from Friday evening, shared with the AgentForge W2 slices. | 5 |
| 2 | Defensibility | Can `PATIENT_DASHBOARD_MIGRATION.md` say why this framework, what leaving PHP gained and what it cost, tied to this implementation (bundle size, auth model, testing, accessibility; `PLAN.md:164`)? | 5 |
| 3 | BFF fit | Does the route give one deployable, same-origin serving and tokens server-side (`AGENT-BRIEF.md` "Client model")? | 4 |
| 4 | David's familiarity | Does David already know the stack? This is inferred from repo evidence only; see the box below. | 4 |
| 5 | Testability + gate fit | Can the port's tests run in the enforced `.githooks/pre-commit` (Node 24, no runner, mirrored in `.gitlab-ci.yml`)? | 3 |
| 6 | Parity ergonomics | How easy are tables, client-side filters and sorts, distinct loading/error/empty states, and escaping by default? | 3 |
| 7 | Deploy fit | Does the route fit Vultr + Caddy + Docker Compose built by `deploy/vultr/deploy.sh` with SHA reporting? | 2 |
| 8 | Long-term ecosystem | Is the stack maintained, and can we hire for it? | 1 |

> **Familiarity assumption (David can override at confirmation).** The only
> evidence is what this repo shows David building and shipping:
> - **The AgentForge service** is Node ESM, plain JavaScript, with no
>   TypeScript (`agentforge/package.json`: `"type": "module"`, one dependency
>   `zod 4.6.5`, tests on `node --test`).
> - **Its HTTP server is raw `node:http`**, with no Express or Fastify
>   (`agentforge/src/server.js:1`).
> - **Its UI is server-built template-literal HTML** with a hand-written
>   `escapeHtml` (`agentforge/src/ui.js:3-8`).
> - **It already has a Node OAuth token client** for OpenEMR that sends
>   `client_secret` (`OpenEMRRefreshTokenProvider`,
>   `agentforge/src/openemrAdapter.js:115-160`).
> - **The fork has its own PHP module** with a test runner
>   (`interface/modules/custom_modules/oe-module-agentforge`, run by
>   `.githooks/pre-commit`).
> - **No framework code at all.** No `.ts`, `.tsx`, `.svelte` or `.vue` file
>   and no React, Vue, Svelte or Next code exists in fork-authored code. The
>   only React in the repo is an unused upstream `react 15.1.0` napa
>   dependency (`project/PACKAGE-JSON.md`).
>
> So familiarity is scored on how much of each route is plain Node + Zod +
> `node:test`. **No front-end framework gets credit, because there is no
> evidence for any.** If David knows one of them, that changes the result;
> see [Sensitivity](#sensitivity-what-would-flip-it).

## What every route must replace or decide regardless

**Must replace (legacy → port)**

- **Authentication.** Today the dashboard runs on OpenEMR's core PHP session
  inside the tabbed shell (8.06). The port replaces this with OAuth2 auth
  code + PKCE through a confidential client held by the BFF (W2D-1, 8.01).
  Rules that follow from the catalog:
  - Always send `client_secret`, because an omitted secret passes (1.01).
  - Always send `state` (1.11) and a `nonce` (1.03).
  - Don't request `offline_access`, and treat any refresh token as a
    server-side secret anyway (1.08, M-4).
  - At logout, discard the BFF's own tokens and don't rely on OpenEMR's
    logout, which revokes nothing (1.04).
  - Register exactly one post-logout URI (2.03).
  - Pin the OAuth endpoints in configuration instead of trusting discovery
    (10.01).
- **Patient context.** The implicit session `pid` becomes an explicit `puuid`
  in the URL and in every BFF call. The BFF resolves the integer `pid` once
  from `GET /api/patient/:puuid`. This removes 5.04, 3.01, 3.02, 7.04 and 5.09
  by construction.
- **Rendering and escaping.** Twig with `autoescape => false` (2.04) and the
  `innerHTML` Care Team rows (2.02, 8.04, 8.05) give way to the framework's
  default text escaping. A lint rule bans that framework's raw-HTML escape
  hatch.
- **Error handling.** `fetchHtml` has none (6.05). The port adds one typed
  result per card (ok / empty / error / forbidden / not-available). The BFF
  treats each of these as an error, never as "Nothing Recorded":
  - HTTP 200 with a non-empty `validationErrors`/`internalErrors` (6.02);
  - an unexpected empty FHIR bundle (6.03).

  It maps the Medications 404-with-empty-body to an empty list (6.04), and it
  never forwards API error text, which can carry SQL (6.01).
- **Display configuration with no API.** Date format, age format and US units
  become BFF configuration (`data/CONFIG.md`).

**Must decide regardless of route (open for David; the framework choice
doesn't settle these)**

1. **The brief's word "FHIR" versus client model B.** The brief says the
   clinical cards each pull "live data from the FHIR API" (`w2-surprise.txt`).
   `PLAN.md:160` (W2D-3) names FHIR resources per card, and `PLAN.md:161`
   (W2D-4) says Vitals uses FHIR `Observation`. The audit instead decided:
   - REST for Allergies, Problems, Medications and Prescriptions
     (`modules/README.md` column B);
   - the REST per-encounter route for Vitals, because FHIR vitals serve
     deleted sets (5.02, `walkthroughs/VITALS.md`).

   `AGENTS.md` says hard-gate wording is literal. So either `PLAN.md` W2D-3
   and W2D-4 are updated to the audited decision, and the migration doc
   defends each REST card with its catalog ID, or some cards move to FHIR
   and accept the documented parity breaks. This risk is the same under
   every route.
2. **The Prescriptions scope.** The Rx card needs `user/prescription.*`. That
   makes 2.01 (SQL injection through parameter names) reachable with the BFF's
   tokens. The AUDIT-STATE rule applies: the BFF sends only allow-listed keys.
3. **Patient selection.** Either the SMART `launch/patient` picker (one
   patient per authorization) or a BFF-side patient search with
   `user/patient.rs` (`walkthroughs/SIGN-IN-AND-HEADER.md`, open questions).
4. **Production configuration, which needs David.**
   - Enable `rest_fhir_api` (it is off on the deploy, `PLAN.md`, verified
     facts).
   - Register the production confidential client with the public redirect and
     logout URIs.
   - Create a grader demo login (a human step).
   - Check `api_log_option`, because full logging stores PHI (6.06).
5. **Where the app lives.** The top-level folder (A4, named in Phase 10), a
   Caddy route such as `/dashboard`, and a compose service. The service must
   report its git SHA and be added to `deploy.sh`'s health loop, which today
   hard-codes `agentforge agentforge-w2` (`deploy/vultr/deploy.sh:102`).

---

## R0 — Keep the PHP dashboard and modernize it in place (Twig/JS)

**Summary.** Keep `demographics.php`, its fragments and its Twig card
templates. Modernize them in place: turn autoescape on for the cards, replace
the `innerHTML` rows, fix the fragment error handling, and perhaps move the
card fetches onto the REST API. This is the required baseline. **The brief
effectively rules it out.** It asks to "port the dashboard to a modern
framework of your choosing" and to move "the presentation layer to a better
tool" (`w2-surprise.txt`). W2D-8 forbids OpenEMR PHP changes for the
dashboard. DB-01's OAuth2 login can't front a page that runs on OpenEMR's own
PHP session without changing OpenEMR's login. It is scored honestly anyway.

### Pros
- The only route with a working dashboard today. Parity is true by
  definition.
- Some fields that the API can't serve are still available here: refills
  (5.06), Care Team member status and Note (5.05), and `lists_touch` empty-state
  wording (4.02).
- There is PHP evidence in the fork (the AgentForge module and its tests).

### Cons
- It fails W2D-6 (a modern framework) and W2D-8 (backend untouched) outright,
  and DB-01 can't be met without changing OpenEMR's login.
- The deploy doesn't carry core PHP changes. `deploy/vultr/docker-compose.yml:20-24`
  runs the upstream `openemr/openemr:latest@sha256` image and bind-mounts only
  the AgentForge module. Shipping dashboard edits would need a custom image.
- The enforced gate runs no OpenEMR PHP suites (9.01). The isolated Twig render
  tests break on the CRLF Windows checkout (9.04, E-01).

### Roadmap (for completeness; not viable for the deliverable)
1. Patch 2.04 and 2.02 in the card templates, and fix 6.05 in `fetchHtml`.
2. Fix 5.01 (the vitals join) and 5.04 (fragments with no patient id).
3. Wire PHPUnit isolated and Twig render tests into the gate from an LF copy.
4. Build and deploy a custom OpenEMR image carrying the changes.

### Tooling
Twig 3, jQuery 3.7, Bootstrap 4.6 (end of life), PHPUnit 11 isolated, Twig
render fixtures (`composer update-twig-fixtures`).

### Effort
20–30 h to rewrite 6 cards against the API with a login in front. **Even
then it doesn't meet W2D-6 or W2D-8**, so no amount of effort makes it
compliant.

### Catalog impact
- **Inherits:** everything on the legacy dashboard path. That includes
  **5.01 (Critical)**, 7.01, 5.03 and 5.04, plus 3.01–3.05, 3.08, 2.02, 2.04,
  6.05, 7.03 and 7.04. From the Architectural Smells it inherits 8.03–8.12
  (the shell, the Care Team JSON rendering, the nested `<html>`, write-on-read,
  CDR before first byte, globals). Each would have to be fixed in legacy code,
  which W2D-8 forbids.
- **Designs out:** nothing. **5.02 (Critical)** is not on its path, because
  it doesn't use FHIR vitals.

## R1 — React + TypeScript + Vite SPA, plus a separate Node BFF

**Summary.** A Vite-built React 19 SPA with one route, `/patients/:puuid`, and
the header plus six card components. A Node BFF (Fastify recommended for its
built-in TypeScript types; Express works) does four jobs:
- runs the OAuth flow;
- holds the session server-side;
- serves `dist/` and a small `/bff/*` JSON API from the **same container and
  origin**;
- calls OpenEMR through an explicit route and query-key allow-list.

This is the decided client model instance for instance.

### Pros
- It maps 1:1 onto the decided architecture (`AGENT-BRIEF.md`). The defense
  can reuse the audit's reasoning directly: the BFF exists because of 8.01
  and 4.01, and the SPA is the new presentation layer.
- The BFF is the stack David already runs: Node ESM, Zod, `node --test`, and
  the OpenEMR token-client pattern in `agentforge/src/openemrAdapter.js`.
  Node 24 runs erasable-syntax `.ts` directly (the laptop has v24.19.0), so BFF
  tests can run with `node --test` the way `agentforge` does.
- It has the largest ecosystem, the most examples and the easiest hiring.
- The parity core (filters, sorts, the vitals pick, the status derivation) is
  plain TypeScript with no framework dependency.

### Cons
- It is two artifacts: two build configs, plus a Vite dev proxy so dev stays
  same-origin.
- Sessions, cookie flags and CSRF checks for the BFF are hand-wired.
- It has the largest client runtime of the SPA options, which makes the
  bundle-size argument in W2D-7 the weakest one.
- Loading, error and empty states need a small hook or a query library.

### Roadmap (anchored to the Sunday 08:00 CT freeze)
1. **Friday evening:** the no-regret steps (see [First steps](#first-steps-regardless-of-route)).
2. **Saturday morning, walking skeleton:** BFF `/login` → OpenEMR authorize
   → `/callback` (token exchange with the secret) → session cookie → SPA
   header for pid 13, pid 3 and pid 12 (deceased) → `/logout`. This follows the
   `walkthroughs/SIGN-IN-AND-HEADER.md` (e) checklist. The hook runs the BFF and
   parity tests. **Circuit breaker:** if sign-in plus the header isn't working
   locally by Saturday 12:00 CT, stop and re-plan with David.
3. **Saturday afternoon, cards:**
   - one issue-list component with three configurations: Allergies, Problems,
     Medications (`walkthroughs/ISSUE-CARDS.md`);
   - Prescriptions, with the allow-listed keys and the three-key sort
     (`walkthroughs/PRESCRIPTIONS.md`);
   - Care Team (`walkthroughs/CARE-TEAM.md`).
4. **Saturday evening:** Vitals through the REST per-encounter route
   (`walkthroughs/VITALS.md`); error-state drills (401, 403, 200 with errors,
   404-empty); side-by-side screenshots against the legacy dashboard for pid 13
   and pid 3 (W2D-5).
5. **Sunday by 08:00:**
   - the compose service, a Caddy `handle_path /dashboard*` block, and the
     `deploy.sh` route;
   - the production client (David);
   - a public-URL check at the deployed SHA;
   - `PATIENT_DASHBOARD_MIGRATION.md` with the measured bundle size.

### Tooling
- **SPA:** Vite, React 19, TypeScript. React Router is optional for a single
  route.
- **BFF:** Fastify, `@fastify/static`, `@fastify/cookie`; `openid-client`
  with endpoints pinned (10.01); Zod to parse OpenEMR responses at the BFF
  boundary.
- **Tests:** Vitest with `@testing-library/react` and jsdom for the SPA;
  `node --test` for the BFF; `tsc --noEmit`; ESLint `react/no-danger`;
  optional `vitest-axe` for 7.12.

### Effort
14–20 focused hours, agent-assisted. That assumes the local OAuth client from
Phase 6 is reused and no framework learning is needed beyond React basics.

### Catalog impact
- **Designs out:**
  - **5.01** and **5.02 (both Critical).** The legacy fragment isn't used, and
    Vitals uses the REST per-encounter route, not FHIR. This comes from the
    BFF allow-list, not the framework.
  - 2.01, because only allow-listed keys are sent.
  - 2.02 and 2.04, through JSX escaping and the lint ban.
  - 3.01–3.03 and 3.08, because the ACL runs per API call and no fragments are
    used.
  - 4.01 and 3.15, through same-origin serving.
  - 5.04, 6.01, 6.05, 7.03 and 7.04.
  - From the Smells: **8.01** (the confidential BFF), 8.04, 8.05, 8.06 and 8.07.
- **Inherits (API gaps; must be documented, not fixed):**
  - 5.05: Care Team member status and Note.
  - 5.06: refills.
  - 4.02: the empty-state wording.
  - 3.04: the squad restriction. 4.12: `hide_dashboard_cards`.
  - 3.14: the ACLs differ per card.
- **Depends on and handles in the BFF:** 1.01–1.04, 1.08, 1.11, 2.03, 4.08–4.10,
  5.03 (the decided rule is to show all rows), 6.02–6.04 and 6.06, plus
  Smells 8.02, 8.13 and 8.15.

## R2 — SvelteKit (TypeScript), with server routes and hooks as the BFF

**Summary.** One SvelteKit app on `adapter-node`. `hooks.server.ts` owns the
session, `+server.ts` routes are the BFF, and the root layout sets
`ssr = false`, so the UI stays a client-rendered SPA served same-origin by
the same process. Tokens and the client secret live in `$lib/server` and
`$env/static/private`, which SvelteKit refuses to import into client code.

### Pros
- It is one project, one dev server and one deployable, with the least glue
  code of any route.
- The build enforces server-only modules. That turns W2D-1's "tokens never in
  the browser" from a convention into something a failed build proves.
- It ships the smallest client bundle, which is a strong, measurable W2D-7
  point.
- `{#await}` gives distinct pending, then and catch branches, a direct fit
  for W2D-3's "empty, error and loading states are distinct". `{@html}` can be
  banned by lint (`svelte/no-at-html-tags`).

### Cons
- The repo has no evidence of Svelte or SvelteKit. Both halves use framework
  conventions (`load`, hooks, adapters, Svelte 5 runes), not the plain-Node
  style of `agentforge/src/server.js`.
- Server logic in hooks and `load` needs a mocked `RequestEvent` to unit-test,
  unless it is kept as thin wrappers over plain modules.
- The defense must explain `ssr = false`, or else defend a hybrid that departs
  from the decided "SPA".
- Its ecosystem and hiring pool are smaller than React's or Vue's.

### Roadmap
It has the same five steps as R1, with these differences:
- The skeleton is `src/hooks.server.ts` plus the `/login`, `/callback` and
  `/logout` `+server.ts` routes.
- Cards are `+page.svelte` components that fetch `/bff/*`.
- Caddy must use `handle /dashboard*`, **not** `handle_path`, because
  `paths.base` expects the prefix to reach the app.

Allow half a day of framework ramp-up inside step 2 if SvelteKit is new.

### Tooling
- **App:** SvelteKit with `@sveltejs/adapter-node`, Svelte 5, TypeScript,
  `openid-client`, Zod.
- **Tests and checks:** Vitest with `@testing-library/svelte`; `svelte-check`;
  `eslint-plugin-svelte`.

### Effort
12–18 h if SvelteKit is familiar. 16–24 h as a first SvelteKit project,
which is what the repo evidence suggests.

### Catalog impact
Same as R1: it designs out 5.01, 5.02, 2.01, 2.02, 2.04, 3.01–3.03, 4.01,
5.04, 6.01, 6.05, 7.03, 7.04 and Smells 8.01 and 8.04–8.07, and it inherits
the same API gaps (5.05, 5.06, 4.02, 3.04, 4.12, 3.14). **Beyond R1:** the
build-enforced server/client split is a structural guard for 1.01 and M-4,
because refresh tokens and the secret can't be imported into the bundle.

## R3 — Vue 3 + TypeScript + Vite SPA, plus a Node BFF

**Summary.** Identical in shape to R1: a Vite-built Vue 3 SPA using
`<script setup lang="ts">`, served same-origin by a Fastify BFF in one
container. Only the component layer differs.

### Pros
- It has every R1 advantage on the BFF side (the familiar Node stack,
  `node --test`, the existing token-client pattern).
- It has a repo-specific defense angle. Its template directives (`v-if`,
  `v-for`) are the direct successor to the AngularJS 1.8 that OpenEMR's other
  screens use (CLAUDE.md stack; `PROJECT-MAP.md`). The dashboard itself doesn't
  load AngularJS, so this is an argument about contributors, not about the code.
- Its runtime is smaller than React's. `v-html` can be banned by lint
  (`vue/no-v-html`), and `computed` filters fit the parity rules.

### Cons
- It is two artifacts, with a hand-wired session and dev proxy, as in R1.
- `<Suspense>` is still experimental, so async card states are written by
  hand.
- The defense must answer "why Vue and not React" with more than taste.
- Its hiring pool is smaller than React's.

### Roadmap
Same as R1.

### Tooling
- **SPA:** Vite, Vue 3, TypeScript, vue-router (optional).
- **BFF:** the same Fastify BFF as R1.
- **Tests and checks:** Vitest with `@vue/test-utils`; `vue-tsc --noEmit`;
  `eslint-plugin-vue`.

### Effort
14–20 h, with the same assumptions as R1.

### Catalog impact
Identical to R1.

## R4 — Next.js (App Router, TypeScript), with route handlers and server components as the BFF

**Summary.** One Next.js app. Route handlers (`app/**/route.ts`) run the
OAuth flow, and `cookies()` holds the session id. Either Server Components
call OpenEMR directly with server-side tokens, or client components call
route handlers. Build with `output: 'standalone'` and `basePath: '/dashboard'`.

### Pros
- One deployable. `server-only` guards token modules.
- `loading.tsx`, `error.tsx` and Suspense give per-segment states.
- It has React's ecosystem and hiring.

### Cons
- It has the most framework surface to get right in about 36 h:
  - the server/client component boundary;
  - the Data Cache and Full Route Cache, which must never cache a per-user
    PHI response;
  - the middleware runtime.
- Server Components render on the server again. That invites the grader's
  question "what did you gain over server-rendered PHP?" and blurs the
  decided "SPA + thin BFF".
- Next's own docs say Vitest doesn't support async Server Components and
  recommend E2E tests for them. `next build`, the real type and route check,
  is too slow for a pre-commit hook.
- It has the heaviest image and build. Images build on the VM (compose
  `build:`), next to services with tight limits (`agentforge-w2`: 0.5 CPU and
  512 MB, `deploy/vultr/docker-compose.yml:203-207`).

### Roadmap
Same five steps. The skeleton is route handlers plus middleware. Cards should
be client components calling route handlers, so the Vitest tests stay
possible. Caddy uses `handle`, because of `basePath`. Add Playwright for any
async Server Component.

### Tooling
- **App:** Next.js App Router, TypeScript, `server-only`, `openid-client`, Zod.
- **Tests:** Vitest for client components and route handlers; Playwright
  for Server Components.

### Effort
18–28 h, assuming no prior App Router experience (none is evidenced).

### Catalog impact
Same design-outs and inheritances as R1. It adds a new risk the other routes
don't have: cross-user caching of PHI if a route is accidentally static or
cached. That would be a new data-integrity and PHI finding in the port's own
code.

---

## Side-by-side comparison

| | R0 PHP in place | R1 React + BFF | R2 SvelteKit | R3 Vue + BFF | R4 Next.js |
|---|---|---|---|---|---|
| Stack | PHP 8, Twig, jQuery, Bootstrap 4 | Vite + React 19 + Fastify | SvelteKit + adapter-node | Vite + Vue 3 + Fastify | Next.js App Router |
| Deployables | the existing OpenEMR image (can't carry the edits) | 1 container (SPA + BFF) | 1 container | 1 container (SPA + BFF) | 1 container (standalone) |
| Effort | 20–30 h, still non-compliant | 14–20 h | 12–18 h familiar, 16–24 h new | 14–20 h | 18–28 h |
| Critical 5.01 / 5.02 | inherits 5.01 | designs out both | designs out both | designs out both | designs out both |
| Smells designed out | none | 8.01, 8.04–8.07 | 8.01, 8.04–8.07 | 8.01, 8.04–8.07 | 8.01, 8.04–8.07 |
| Tokens kept server-side by | n/a (PHP session) | a separate process | build-enforced server modules | a separate process | the `server-only` convention and caching discipline |
| Main risk | fails the brief (W2D-6, W2D-8) | two-artifact wiring | first-time framework conventions | "why Vue" needs arguing | caching/RSC complexity in 36 h |

## Weighted scoring

Each score runs from 1 to 5, with one-line justifications below. The
weighted total is Σ(weight × score), and the maximum is 135.

**1. Working by Sunday 12:00 CT (weight 5)**
- R0 = 2. The page runs today, but nothing it could ship counts: OAuth login
  and an API-only data layer mean rewriting OpenEMR PHP (W2D-8), and the deploy
  doesn't carry core PHP edits (`deploy/vultr/docker-compose.yml:20-24`).
- R1 = 4. Two small, conventional pieces. The BFF's token handling has a
  precedent in `agentforge/src/openemrAdapter.js:115-160`. The risk is the
  two-artifact wiring.
- R2 = 4. One project with the least glue. The risk is framework conventions
  with no precedent in the repo.
- R3 = 4. Same shape and risk as R1.
- R4 = 3. The most framework surface to get right in about 36 h (the RSC
  boundary, caches forced off for PHI, middleware, a slow build).

**2. Defensibility in `PATIENT_DASHBOARD_MIGRATION.md` (weight 5)**
- R0 = 1. It contradicts the brief's premise ("port … to a modern framework",
  `w2-surprise.txt`), and it keeps 2.02 and 2.04.
- R1 = 4. A 1:1 fit with the decided client model (`AGENT-BRIEF.md`): the BFF
  is justified by 8.01 and 4.01. Its bundle-size story is the weakest of the
  SPAs.
- R2 = 4. The strongest measurable gains: the smallest bundle and
  build-enforced server-only tokens for W2D-1. It must justify `ssr = false`
  or a hybrid.
- R3 = 4. The same architecture fit as R1, plus the AngularJS-successor
  argument (`PROJECT-MAP.md`). "Why not React" must be answered.
- R4 = 3. Server Components re-center server rendering, which is the
  "presentation layer" the brief moves away from, and caching must be
  defended for PHI.

**3. BFF fit: one deployable, same-origin, tokens server-side (weight 4)**
- R0 = 1. There is no BFF or token model at all. The dashboard is session-based
  inside the shell (8.06).
- R1 = 4. One container serves `dist/` and `/bff/*` from the same origin. The
  session, cookies and dev proxy are hand-wired.
- R2 = 5. Hooks, `+server.ts` and adapter-node give one process by
  construction, and `$lib/server` and `$env/static/private` can't reach the
  client.
- R3 = 4. Same as R1.
- R4 = 4. Route handlers, `cookies()` and `server-only` give one deployable,
  but the middleware runtime and caches are extra things to get right.

**4. David's familiarity, inferred (weight 4)**
- R0 = 3. The fork's own PHP module and its tests show PHP work
  (`oe-module-agentforge`, `.githooks/pre-commit`). There is no evidence of
  Twig card work.
- R1 = 3. The BFF half is the known stack (Node ESM, `node --test`, Zod,
  `agentforge/package.json`, `agentforge/src/server.js:1`). There is no
  React/TSX evidence.
- R2 = 2. Both halves use SvelteKit conventions, and there is no Svelte
  evidence. Only the server-side modules benefit from the Node/Zod experience.
- R3 = 3. Same as R1. There is no Vue evidence.
- R4 = 2. Both halves use Next conventions (RSC, route handlers, caching),
  and there is no evidence.

**5. Testability + fit with `.githooks/pre-commit` (weight 3)**
- R0 = 2. The gate runs no OpenEMR PHP checks (9.01), and the Twig render
  tests break on the CRLF checkout (9.04).
- R1 = 5. The BFF runs on `node --test` like `agentforge`, and the SPA on
  Vitest plus `tsc --noEmit`. It is all fast Node: a few `npm` lines in the
  hook.
- R2 = 4. Vitest shares the Vite config, and `svelte-check` adds a step.
  Hook and `load` logic needs `RequestEvent` mocks.
- R3 = 5. Same as R1, with `vue-tsc`.
- R4 = 3. Async Server Components can't be tested in Vitest (per Next's
  docs), and `next build` is too slow for a pre-commit hook.

**6. Parity ergonomics: tables, client filters, escaping by default (weight 3)**
- R0 = 2. Parity is free, but escaping is off (2.04, `src/Common/Twig/TwigContainer.php:70`),
  the `innerHTML` rows remain (2.02), and there are no error states (6.05).
- R1 = 4. JSX escapes by default and `react/no-danger` is available.
  Loading, error and empty states need a hook or library.
- R2 = 5. Default escaping, `svelte/no-at-html-tags`, and `{#await}`
  branches that map onto W2D-3's distinct states (`PLAN.md:160`).
- R3 = 4. Default escaping and `vue/no-v-html`. `<Suspense>` is experimental,
  so async states are written by hand.
- R4 = 4. React escaping, plus `loading.tsx` and `error.tsx`. Each card needs
  its own Suspense boundary.

**7. Deploy fit: Vultr + Caddy + Docker (weight 2)**
- R0 = 2. The upstream image has only the module bind-mounted
  (`docker-compose.yml:20-24`). Edits need a custom image and have no SHA
  endpoint.
- R1 = 5. One small Node container that fits Caddy's existing `handle_path`
  pattern (`deploy/vultr/Caddyfile:20-28`). `/health` can report `git_sha`
  by reusing `agentforge/src/buildInfo.js`.
- R2 = 5. One adapter-node container. Caddy needs `handle` instead of
  `handle_path` because of `paths.base`.
- R3 = 5. Same as R1.
- R4 = 4. The standalone build works, but it has the heaviest build and
  image, built on a VM with tight service limits (`docker-compose.yml:203-207`).

**8. Long-term ecosystem and hiring (weight 1)**
- R0 = 2. OpenEMR is maintained, but the dashboard's front end is jQuery plus
  Bootstrap 4, which is end of life (`PROJECT-MAP.md`).
- R1 = 5. The largest ecosystem and hiring pool.
- R2 = 3. A smaller ecosystem, and Svelte 5 recently changed the component
  model.
- R3 = 4. Large and stable, with a smaller hiring pool than React's.
- R4 = 4. React's pool, but framework churn and a vendor-driven roadmap.

### Arithmetic (weight × score)

| Dimension (weight) | R0 | R1 | R2 | R3 | R4 |
|---|---|---|---|---|---|
| Working by Sunday (5) | 5×2 = 10 | 5×4 = 20 | 5×4 = 20 | 5×4 = 20 | 5×3 = 15 |
| Defensibility (5) | 5×1 = 5 | 5×4 = 20 | 5×4 = 20 | 5×4 = 20 | 5×3 = 15 |
| BFF fit (4) | 4×1 = 4 | 4×4 = 16 | 4×5 = 20 | 4×4 = 16 | 4×4 = 16 |
| Familiarity (4) | 4×3 = 12 | 4×3 = 12 | 4×2 = 8 | 4×3 = 12 | 4×2 = 8 |
| Testability / gate (3) | 3×2 = 6 | 3×5 = 15 | 3×4 = 12 | 3×5 = 15 | 3×3 = 9 |
| Parity ergonomics (3) | 3×2 = 6 | 3×4 = 12 | 3×5 = 15 | 3×4 = 12 | 3×4 = 12 |
| Deploy fit (2) | 2×2 = 4 | 2×5 = 10 | 2×5 = 10 | 2×5 = 10 | 2×4 = 8 |
| Ecosystem (1) | 1×2 = 2 | 1×5 = 5 | 1×3 = 3 | 1×4 = 4 | 1×4 = 4 |
| **Weighted total / 135** | **49** (36%) | **110** (81.5%) | **108** (80.0%) | **109** (80.7%) | **87** (64.4%) |

**Near-tie check.** 5% of the top score (110) is 5.5, so any route at 104.5
or above is tied. R3 (109, 1 point or 0.9% behind) and R2 (108, 2 points or
1.8% behind) are both within it. **This is a three-way near-tie: R1, R3 and
R2.** R4 (87) and R0 (49) are well clear.

**Where the margins come from.**
- **R1 over R3** is 1 point, and all of it is long-term ecosystem (weight 1).
  The two routes score the same on every other dimension.
- **R1 over R2** is 2 points. R2 wins BFF fit (+4) and parity ergonomics (+3).
  R1 wins familiarity (+4), testability (+3) and ecosystem (+2).

### Sensitivity: what would flip it

Familiarity (weight 4) is the one dimension scored from inference, so it is
the one most likely to move at confirmation.

| If David says… | Change | New totals | Winner |
|---|---|---|---|
| "I know React well" | R1 familiarity 3 → 5 | R1 118 | R1, by 9 |
| "I know Vue well" | R3 familiarity 3 → 5 | R3 117 | R3, by 7 |
| "I know Svelte/SvelteKit well" | R2 familiarity 2 → 4 (and working by Sunday 4 → 5) | R2 116 (121) | R2, by 6 (11) |
| "None of them; I'll learn whichever" | none | as scored | R1, by 1 (near-tie) |

## Hybrid options

- **Strangler fig, which happens anyway.** The legacy dashboard stays live
  and unchanged at `/` (W2D-8). The port runs beside it at its own path, and
  there is no cut-over in scope. That gives the side-by-side screenshots W2D-5
  needs for free.
- **A framework-neutral core, which makes the near-tie cheap.** A plain
  TypeScript module holds the parity rules, BFF allow-list, error mapping and
  typed card results (see [First steps](#first-steps-regardless-of-route)). If
  so, the choice among R1, R2 and R3 affects only the component layer and the
  session wiring. Switching front ends after the walking skeleton would cost
  hours, not a day.
- **A React SPA inside Next, or SvelteKit with SSR on:** not recommended. Each
  re-introduces server rendering and caching risk for no requirement the
  brief asks for.

## Recommendation

- **Winner: R1, React + TypeScript + Vite SPA with a Node (Fastify) BFF.**
- **Score: 110 / 135 (81.5%), the highest in the table.**
- **Runner-up: R3, Vue 3 + Node BFF, 109. Then R2, SvelteKit, 108.**
- **Margin: 1 point (0.9%) over R3 and 2 points (1.8%) over R2.**
- **Near-tie: YES. Three routes are within 5%, so David decides.**
- **Why R1: it is the decided SPA + BFF model with a BFF on David's known Node stack.**
- **R1's only edge over Vue is ecosystem (weight 1). SvelteKit trades familiarity for BFF fit.**
- **To decide: reply R1, R2 or R3, or name a framework you know (see Sensitivity).**

If nothing changes, R1 wins on the numbers. The weaknesses we accept, and why
they're livable:
- **It is two artifacts.** One container still serves both, so the "one
  deployable, same-origin" requirement is met.
- **Its bundle-size story is the weakest.** We will measure it and report the
  real number rather than claim a win.
- **Session wiring is hand-written.** It is small, and it mirrors
  `agentforge/src/server.js`.

None of the routes changes the two Critical design-outs (5.01, 5.02). Both
come from the BFF's data-source choice, not the framework.

Confirmed by: _pending David_.

## First steps regardless of route

These no-regret moves are the same under R1, R2 and R3 (and R4), so they can
start before David picks.

1. **OAuth client configuration.**
   - Reuse the local confidential client from Phase 6.
   - Write its exact `redirect_uri`, `post_logout_redirect_uri` and scope list
     into `<app>` configuration: `openid`, `api:oemr`, `api:fhir`, and
     `user/` read scopes for patient, allergy, medical_problem, medication,
     prescription (see the scope decision above), encounter, vital, CareTeam
     and Practitioner.
   - Don't request `offline_access` (1.08).
   - Pin the endpoints instead of using discovery (10.01).
   - Prepare the production registration and the `rest_fhir_api` switch as a
     checklist for David.
2. **BFF allow-list as data.** Write one TypeScript table of upstream routes,
   each with its allowed query keys, the id it takes (`puuid` or `pid`,
   10.04), its expected empty shape (200 `[]`, 404 empty for Medications, or
   an empty Bundle) and the scope it needs. Add a test that rejects any other
   key. Prove it with the deliberate regression from
   `walkthroughs/PRESCRIPTIONS.md` (e) item 7, which forwards a client key and
   must turn the gate red (`AGENTS.md`, "done" #2).
3. **Parity functions and fixtures, framework-free.** Write
   `filterActiveIssues`, the begdate-ascending sort, the Rx three-key sort,
   the vitals latest-non-deleted pick, the header status from
   `deceasedDateTime`, and the error/empty mapping as pure TypeScript. Test
   them against recorded synthetic API responses, labelled as fixtures and
   not live data (`AGENTS.md` honesty rule). The expected values come from the
   walkthrough checklists:
   - **pid 13:** Allergies 2 rows with "(1)"; Problems 13 of 39; Medications
     1 of 5; Rx 5 rows in order 66…62 with refills "not available via API";
     Care Team 1 team with 3 participants; Vitals set 27, never deleted set 28.
   - **pid 3:** "Nothing Recorded" for the issue cards and Rx; Vitals set 14.
   - **pid 12:** deceased status.
4. **Pre-commit gate hookup.**
   - Add `npm ci --prefix <app>`, the typecheck and `npm test --prefix <app>`
     to `.githooks/pre-commit`, and the same lines to `.gitlab-ci.yml` so the
     two stay in sync.
   - Run one deliberate regression to show the hook fail. A candidate is
     reading `Patient.active` instead of `deceasedDateTime`, which is visible
     on pid 12.
5. **SHA reporting and routing.**
   - Add a `/health` that returns `git_sha`, using the `BUILD_SHA` +
     `export-subst` pattern from `agentforge/src/buildInfo.js`.
   - Add a compose service, a Caddy block and the `deploy.sh` route (line 102
     today checks only `agentforge` and `agentforge-w2`).
   - Scope the BFF session cookie to the app path, so it doesn't collide with
     OpenEMR's own cookies on `/`.
6. **Reconcile the FHIR wording with David** ("Must decide" item 1) before the
   cards are built. It changes what `PLAN.md` W2D-3 and W2D-4 must say and how
   the migration doc defends each REST card.
