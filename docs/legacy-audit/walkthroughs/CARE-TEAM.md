# Walkthrough: Care Team card renders for a patient (DB-07)

> **Build correction (slice 01-04-01, code reading, 2026-09-25):** pid 13's
> `participant[]` has **4** entries, not 3: `populateFacilityTeamMembers()`
> adds one `Organization` participant per distinct member facility
> (`CareTeamService::getCareTeamFacilities()`), here facility 3. The port shows
> the 3 Practitioner participants as member rows and uses the Organization for
> the Facility column. Member names need `GET /fhir/Practitioner/:id`, which
> serves only users with a non-empty NPI (`PractitionerService::search()`); no
> seeded care-team user has one, so the port shows "Name unavailable" locally.
> Where this walkthrough says "3 entries", read "3 member rows (4 participants)".

Legacy commit: tag `legacy-baseline` = `3ccfe1d` (equals the working tree for
the paths cited below). Seed: pid 13 has 1 care team, 3 members (2 `active`,
1 `inactive`); pid 3 has 0 care teams. Both counts re-confirmed this pass by
read-only SQL against the local synthetic DB:

```
SELECT ct.pid, COUNT(*) AS team_count FROM care_teams ct WHERE ct.pid IN (3,13) GROUP BY ct.pid;
-- pid 13 -> team_count 1  (no row for pid 3, i.e. 0)
SELECT ct.pid, ctm.status, COUNT(*) FROM care_team_member ctm
  JOIN care_teams ct ON ct.id = ctm.care_team_id WHERE ct.pid IN (3,13)
  GROUP BY ct.pid, ctm.status;
-- pid 13 -> active 2, inactive 1
```

This matches `ui/CARE-TEAM-CARD.md`'s "Key question" and
`modules/CARE-TEAM-SERVICES.md`'s "Key question" reproductions exactly; it is
restated here only as the walking-skeleton's own evidence trail, not a
re-audit.

## (a) Legacy path — UI event → PHP → service → SQL → tables

1. **UI event.** Browser loads `demographics.php?set_pid=13` inside the
   tabbed shell's iframe (`interface/patient_file/summary/demographics.php`).
   `set_pid` switches the session patient and runs CDR **before** any
   authorization check (U-6, restated by reference only).
2. **Page gate.** `AclMain::aclCheckCore('patients','demo')` at
   `demographics.php:1056` — read-level. If this fails, no card (including
   Care Team) renders at all; see (d).
3. **Card construction.** `demographics.php:1253`:
   `new CareTeamViewCard($pid, ['dispatcher' => $ed])`.
4. **Constructor.** `CareTeamViewCard.php:41-48` calls `setupOpts()` (ACL
   probe + collapse state, cosmetic only) then **unconditionally** calls
   `handleFormSubmission()` (`:47`) — for a plain view/GET request this
   early-returns at `:127` (`save_care_team !== 'true'`); the write path
   (CSRF-only, no ACL — U-4) is not exercised on a render-only load.
5. **Card-level ACL check.** `demographics.php:1270-1271` checks
   `$card->getAcl()` (`['patients','demo']`, read) before rendering the
   card's template variables.
6. **Read path entry.** `getTemplateVariables()`
   (`CareTeamViewCard.php:112-122`) calls `getFormManagementData($pid)`
   (`:158-359`), which calls `CareTeamService::getCareTeamData($pid)`
   (`:162`).
7. **The query.** `CareTeamService::getCareTeamData()`
   (`CareTeamService.php:550-671`): `care_team_member` is pre-filtered in a
   derived subselect (`WHERE status != 'inactive' AND status !=
   'entered-in-error'`) **before** the `LEFT JOIN` to `care_teams` runs;
   team-level `WHERE ct.pid = ? AND (ct.status IS NULL OR ct.status !=
   'entered-in-error')`; `ORDER BY ct.team_name, ctm.date_created ASC`;
   returns exactly **one** team (first `active`, else first found). Also
   joins `users`, `contact`/`person`/`contact_relation`, `facility`,
   `list_options` (×3) for display strings.
8. **Reshape.** `getFormManagementData()` (`:166-183`) turns
   `$careTeamResult['members']` into `existing_care_team`; also runs three
   unrelated queries for the edit `<select>` option lists (active users,
   facilities, roles/statuses) and a `ContactService::getOrCreateForEntity()`
   call (`:190`, a possible write on a nominally read-only render — Finding
   4, not re-verified here).
9. **Template merge.** `demographics.php:1273`:
   `array_merge($viewArgs, $card->getTemplateVariables())` →
   `manage_care_team.html.twig`. `existing_care_team` is JSON-embedded into
   an inline `<script>` (`{{ existing_care_team|js_escape }}`, `:23`); the
   server-rendered `<tbody>` is **empty** (`:203-205`,
   `{# Populated by JS #}`) — no row markup ships from PHP at all.
10. **Client render.** `$(document).ready` → `preloadTeamRows()`
    (`manage_care_team.html.twig:31-107`) builds one `<tr>` per JSON member
    (`.viewOnly` span + `.editShow` input/select per cell), appends to
    `#care_team_table tbody`; `toggleEditMode(false)` leaves the card in
    view mode. If `existingCareTeam.length === 0` the function returns
    immediately — **no empty-state string exists for this card** (Finding
    5), unlike Allergies/Problems/Medications.
11. **pid 13 result:** 2 `<tr>` rows — Donna Lee (`primary_care_provider`)
    and Fred Stone (`nurse`); the inactive specialist (user 10) is absent
    from `existing_care_team` itself, excluded at step 7's SQL, not by CSS
    or JS.
12. **pid 3 result:** `getCareTeamData()` finds zero `care_teams` rows and
    returns the literal fallback shape (`:664-669`:
    `team_name=''`, `team_status='active'`, `members=[]`,
    `member_count=0`, no `team_id` key). `preloadTeamRows()` early-returns;
    the card shows a blank team-name input and an empty table — visually
    indistinguishable from "a team with no members" (there is no team at
    all).

## (b) Port path — SPA → BFF → API route → scope/ACL → controller → service → SQL

1. **SPA action.** Care Team card mounts for the currently-selected patient
   (explicit patient id from the SPA's own routing/state, not a session
   pid — the port's defining architectural change, AGENT-BRIEF).
2. **BFF call.** BFF, holding the confidential OAuth client's access token,
   issues `GET /fhir/CareTeam?patient=<puuid>` (patient-context token, per
   AGENT-BRIEF's SPA+BFF decision). `puuid` was already resolved by an
   earlier `GET /api/patient/:puuid` call for the header/identity bar; no
   separate id-mapping call is needed for Care Team itself.
3. **Route.** `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:142-166`.
4. **Scope/ACL.** A patient-context token **bypasses**
   `RestConfig::request_authorization_check()` entirely and is scoped by
   `puuidBind` instead (`:146-149`) — this is the path the BFF uses. A
   non-patient-context (client-credentials) token would instead need
   `patients/med` plus scope `user/CareTeam.rs` (`:150,161`); the walkthrough
   name's `user/CareTeam.rs` scope applies to that alternate flow, not the
   patient-context one the BFF actually uses for a logged-in patient's own
   dashboard.
5. **Controller.** `FhirCareTeamRestController::getAll()` (177 lines) does
   no ACL check itself — enforcement is entirely at the route closure (step
   4) — and calls `FhirCareTeamService::searchForOpenEMRRecords()`
   (`:283-287`).
6. **Search params.** `loadSearchParameters()`
   (`FhirCareTeamService.php:80-88`) maps `patient`→`puuid`,
   `status`→unqualified `status` (resolves to `ct.status`, **team-level
   only**), `_id`, `_lastUpdated`.
7. **Team query.** `CareTeamService::getAll()` → `search()` →
   `getCareTeamRecordsForSearch()` (`CareTeamService.php:83-121`):
   `care_teams JOIN patient_data (puuid) LEFT JOIN list_options
   (Care_Team_Status)`. **No `care_team_member` join at all** and **no
   `ORDER BY`** — unlike the legacy query's `ORDER BY ct.team_name`.
8. **Member fan-out.** For each matched team id:
   `getCareTeamProviders()`/`getCareTeamFacilities()`/`getCareTeamContacts()`
   (`:174-314`), each filtered **only** by `care_team_id` — **no `status`
   predicate anywhere in any of the three** — so all 3 seeded
   `care_team_member` rows for pid 13's team come back, including the
   inactive specialist.
9. **FHIR shaping.** `FhirCareTeamService::parseOpenEMRRecord()`
   (`:103-157`) builds one `FHIRCareTeam` per team row (`id`, `status`,
   `name`, `subject`), then `populateProviderTeamMembers()` (`:336-371`,
   `role` via `createRoleCodeableConcept()`, `period.start` =
   `provider_since` if non-empty, `onBehalfOf` if faciliated),
   `populateFacilityTeamMembers()` (`:373-395`, `Organization` reference
   participants), `populateRelatedPersonTeamMembers()` (`:396-443`, no-ops
   entirely if `fhir_us_core_profile_version` = `3.1.1`; confirmed this
   install runs `8.0.0`, so this path is active but unobservable — no
   contact-type members are seeded for pid 13), and
   `populateManagingOrganization()` (`:445-451`, permanently dead code — no
   query ever sets `primary_facility_uuid`).
10. **Response.** `RestControllerHelper::responseHandler()` returns **200**
    with a FHIR `Bundle` — always, even for zero matches (`total: 0`, empty
    `entry`) — never a 404 for the collection endpoint.
11. **BFF → SPA.** BFF relays the Bundle (or proxies/reshapes it) to the
    SPA. The SPA must pick "the" team to render, since — unlike the card's
    server-side "first active else first found" — the API applies no such
    narrowing and no default `ORDER BY`; the SPA implements its own
    tie-break (e.g. request `status=active` first, fall back to an
    unfiltered request, per `modules/CARE-TEAM-SERVICES.md`'s "Can the SPA
    replicate" analysis) — untestable against this seed since pid 13 has
    only one team.
12. **Column rendering.** SPA renders Type (inferred from
    `participant.member` reference type: `Practitioner`/`RelatedPerson`),
    Member (needs a second fetch — `GET /fhir/Practitioner/:uuid` or
    `/fhir/RelatedPerson/:uuid`, no name ships inline), Role
    (`role.coding[0].display`, same free-text label the legacy card shows,
    when resolved), Facility (`onBehalfOf`/`Organization` participant, a
    third fetch), Since (`period.start`, providers only — never set for
    `RelatedPerson`/`Organization` participants). Status (member-level) and
    Note have no field anywhere in the FHIR `CareTeamParticipant` shape —
    the SPA cannot render them regardless of fetch depth.
13. **pid 13 result:** one `CareTeam` resource, `participant[]` with 3
    entries — the 2 active members plus the inactive specialist,
    **structurally indistinguishable** from each other (no status, no
    `period.end`, no extension).
14. **pid 3 result:** `Bundle.total = 0`, empty `entry[]` — the SPA's
    genuine empty state (no team exists at all, not "a team with no
    members" — same underlying reality as the legacy card's fallback shape
    in (a)12, reached through a structurally different signal).

## (c) Where they diverge

| Rule | Legacy behavior | API (port) behavior | Port rule (AGENT-BRIEF) |
|---|---|---|---|
| Member visibility | SQL-level exclusion of `inactive`/`entered-in-error` members before the join runs | No status filter anywhere in the FHIR read path; inactive members appear identical to active | "Inactive members can't be hidden" — documented parity break, not fixed |
| Team selection | One query, `ORDER BY team_name, date_created`; first `active` else first found | No `ORDER BY`; no server-side narrowing; SPA must issue its own `status=active` query plus an unfiltered fallback and pick a team client-side | SPA picks a team (client-side tie-break); untestable on this single-team seed |
| Member status column | `care_team_member.status` badge per row | No field in `CareTeamParticipant` carries member status at all | "Care Team member status ... not available via API" |
| Note column | `care_team_member.note`, free text | No mapping anywhere in `FhirCareTeamService.php` (grep-confirmed, zero hits) | "Note ... not available via API" |
| Team-level status | `Care_Team_Status` list-option **title** (e.g. "Active") shown as badge | `CareTeam.status` raw code only, no title string | SPA hardcodes the 5 title strings (clean 1:1 code↔title mapping, safe to hardcode) |
| Role label | `care_team_roles` list-option title, free text | `role.coding[0].display` carries the same free-text label when it resolves; `.coding[0].code` is SNOMED, not shown by either side | Match — display text recoverable, coded value is extra |
| Type (Provider/Related Person) | Derived from `contact_id` set vs. not | Derived from participant reference type; RelatedPerson-type participants vanish entirely if `fhir_us_core_profile_version=3.1.1` (currently `8.0.0`, not triggered) | Match today; config-dependent risk flagged, not fixed |
| Empty state | No empty-state string exists at all (blank table + blank form) | `Bundle.total=0` is the correct, distinct empty signal | Port authors its own empty-state copy — no legacy string to reuse for this card specifically |
| Save / edit | Full in-card edit form, POSTs to `demographics.php` | No write endpoint in scope | Port is read-only (DB-10); the save path is catalogued, not ported |
| Authorization | Page-level `patients/demo` read ACL gates the whole card | Patient-context token bypasses ACL (scoped by `puuidBind`); non-patient-context needs `patients/med` + `CareTeam.rs` scope | Different resource/scope model entirely; not a 1:1 mapping |

## (d) Partial-failure points

- **Legacy, page-gate failure.** If `patients/demo` read ACL fails at
  `demographics.php:1056`, the entire dashboard — not just Care Team — fails
  to render; the user sees no card-specific error, just an access-denied
  page for the whole request.
- **Legacy, query failure.** `getCareTeamData()`'s query runs through
  `QueryUtils::sqlStatementThrowException()`-style helpers (Phase 3 scope,
  not re-traced here); no `try`/`catch` is visible in
  `getFormManagementData()`, so a DB error on this card's query would
  surface as an uncaught PHP error for the whole `demographics.php` request,
  not a card-local failure.
- **Legacy, read-triggers-write side effect.** `getFormManagementData()`
  calls `ContactService::getOrCreateForEntity()` (`:190`) on every render;
  if that call fails, an ostensibly read-only card load could break on a
  write-path error (Finding 4, not independently verified).
- **Port, transport/auth failure.** If the BFF's call to
  `GET /fhir/CareTeam` fails (network, expired/invalid token, scope
  mismatch — M-2/M-4 referenced by ID only), the SPA must render a
  card-level error, not "Nothing Recorded" — collapsing a fetch failure into
  the empty state would misreport a real team as absent.
- **Port, error-shape ambiguity.** A malformed request can come back as
  **200** with an empty bundle or a `validationErrors` payload rather than a
  4xx (`getOne()`'s validator-driven 400/404/500 shapes are call-specific;
  `getAll()`'s zero-match case is always 200). The SPA must distinguish a
  genuine `Bundle.total=0` (pid 3's true empty state) from a validation-error
  response shaped like one, and must never render raw API error text (it can
  leak SQL, per AGENT-BRIEF's security rules).
- **Port, silent config-dependent loss.** If `fhir_us_core_profile_version`
  is ever changed to `3.1.1`, `populateRelatedPersonTeamMembers()` silently
  stops adding any contact-type participant, with no error surfaced anywhere
  — a partial failure the SPA cannot detect from the response alone.
- **Security findings, catalogued only (no exploitation detail):**
  - U-4 — the legacy save endpoint has CSRF protection but no write ACL
    check; out of scope for the read-only port, catalogued for the legacy
    side.
  - U-5 — the legacy template interpolates `note`/`provider_since` into
    `innerHTML` unescaped (stored XSS); the port must rely on its
    framework's default escaping and must not reproduce this pattern.
  - M-6 — FHIR `CareTeam` exposes inactive members identically to active
    ones with no status field to filter on; this is the confirmed root
    cause of the member-visibility divergence in (c) above.

## (e) Live evidence to collect in the build

- [ ] Legacy `demographics.php?set_pid=13`, JS-executing browser/Selenium:
      Care Team card shows **exactly 2** `<tr>` rows (Donna Lee / Primary
      Care Provider, Fred Stone / Nurse); the inactive specialist never
      appears in the DOM or in the embedded JSON. (Read-only SQL this pass:
      pid 13 `care_teams` count = 1, `care_team_member` status counts
      `active`=2, `inactive`=1.)
- [ ] Legacy `demographics.php?set_pid=3`: Care Team card shows **0** rows
      and no empty-state text (blank table/blank form) — not previously
      confirmed in a real browser by any prior-phase doc; first live check
      for pid 3 specifically.
- [ ] Port: `GET /fhir/CareTeam?patient=<pid-13-uuid>` (via the BFF, patient
      context) returns a Bundle with **1** `CareTeam` resource whose
      `participant[]` has **3** entries (2 for the active members, 1 for the
      inactive specialist) — confirms Finding 1/M-6 against a live response,
      not just SQL/code reading.
- [ ] Port: `GET /fhir/CareTeam?patient=<pid-3-uuid>` returns `Bundle.total
      = 0`, empty `entry[]` — confirms pid 3's port-side empty state is a
      genuine empty Bundle, distinguishable from a validation-error-shaped
      200.
- [ ] Port: grep the raw pid-13 response JSON for any status-like key on a
      `participant` object — expect zero matches, confirming "member status
      not available via API" against a live payload.
- [ ] Port: confirm `participant[].role.coding[0].display` for the two
      active members reads "Primary Care Provider" and "Nurse" — validates
      the Role parity correction live.
- [ ] Regression gate (AGENTS.md "done" #2): deliberately break the SPA's
      team-selection tie-break or the empty-Bundle-vs-error distinction and
      show the relevant eval/test fails before re-fixing it.

---

**Confidence:** High for the legacy path and the FHIR read-path mechanics
(both traced to `path:line` in `ui/CARE-TEAM-CARD.md` and
`modules/CARE-TEAM-SERVICES.md`, and the member/team counts were
independently re-confirmed by read-only SQL this pass). Medium for the exact
live JSON shape of the FHIR response and for the SPA's not-yet-built
tie-break behavior — both are code-level predictions, not yet observed
against a running BFF/SPA (no build exists yet to check against, per the
brief's code-reading-only scope).

**Contradicts an existing analysis:**
- None found. This walkthrough's read-only SQL re-check (pid 13: 1 team, 2
  active + 1 inactive member; pid 3: 0 teams) matches
  `ui/CARE-TEAM-CARD.md`'s and `modules/CARE-TEAM-SERVICES.md`'s prior
  reproductions exactly, and no new discrepancy with `data/SCHEMA.md` was
  observed.
