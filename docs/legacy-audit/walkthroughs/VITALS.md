# Walkthrough: Vitals section shows the latest vitals set (DB-08)

**Decision (AGENT-BRIEF.md "Parity rules (decided)"):** Vitals shows the
**correct** latest non-deleted set, which deliberately differs from the PHP
join bug (U-1). This walkthrough traces both the legacy path and the port
path end to end, shows where they diverge, and lists the live evidence the
walking-skeleton slice must collect to prove the decision is actually wired.

Code cited at `path:line@legacy-baseline` (tag `legacy-baseline` = `3ccfe1d`,
equals the working tree for every path cited here). Source analyses reused,
not re-derived: [`ui/VITALS-FRAGMENT.md`](../ui/VITALS-FRAGMENT.md),
[`modules/VITALS-SERVICES.md`](../modules/VITALS-SERVICES.md),
[`data/SCHEMA.md`](../data/SCHEMA.md), [`data/CONFIG.md`](../data/CONFIG.md).
Security findings referenced by id only (U-1, M-5); no exploitation detail.

## (a) Legacy path

1. **UI event.** The dashboard shell loads `demographics.php?set_pid=13`
   inside the tabbed-shell iframe. The Vitals card shell (title, collapse
   toggle, "Trend" button) renders synchronously at
   `demographics.php:1507-1530@legacy-baseline`, using a separate,
   join-bug-free existence check (`SELECT * FROM form_vitals WHERE pid=?`,
   `demographics.php:1511-1512`) purely to decide whether to show the card
   at all — this check is independent of the query in step 4 and is not
   itself part of the DB-08 decision.
2. **Client-side gate.** On DOM ready, if `$vitals_is_registered`
   (`demographics.php:342-344`) and `AclMain::aclCheckCore('patients','med')`
   pass, the page emits `placeHtml("vitals_fragment.php", "vitals_ps_expand")`
   (`demographics.php:631`). This only controls whether the fetch is *sent* —
   see (d) for why it is not a server-side gate.
3. **Request in.** `vitals_fragment.php:13` (`require_once globals.php`,
   session/login only, no page-specific ACL); `:19-20` reads `$pid` from the
   session (`SessionWrapperFactory`), never from a request parameter; `:21`
   `CsrfUtils::checkCsrfInput(INPUT_POST, dieOnFail: true)`.
4. **The "which set wins" query** (`vitals_fragment.php:27`, cited in full
   in `ui/VITALS-FRAGMENT.md`): `LEFT JOIN forms ON FORM_VITALS.id =
   FORMS.form_id WHERE FORM_VITALS.pid=? AND FORMS.deleted != '1' ORDER BY
   FORM_VITALS.date DESC`, first row taken (no `LIMIT 1` needed — `sqlQuery()`
   only returns one row). **No `forms.formdir='vitals'` and no
   `forms.pid=form_vitals.pid` condition** — this is U-1: `forms.form_id` is
   unique only within `(formdir, pid)`, not globally, so the join can match
   an unrelated `forms` row (different patient, different form type) that
   happens to share the numeric id.
5. **Empty state.** If no row survives, `vitals_fragment.php:29-34` echoes
   the exact string `"No vitals have been documented."`.
6. **Populated state.** `vitals_fragment.php:37-39` prints `Most recent
   vitals from: <date>` (`$result['date']`, i.e. `form_vitals.date`), then
   `:42-43` includes `interface/forms/vitals/report.php` and calls
   `vitals_report('', '', 1, $result['id'])` (first two args unused — dead
   parameters, `ui/VITALS-FRAGMENT.md` Finding #2).
7. **Second, independent filter.** `vitals_report()` (`report.php:34-185`)
   calls `formFetch("form_vitals", $id)` → `WHERE id=? AND pid=? AND
   activity LIKE '1'`, `pid` from `OEGlobalsBag::getInstance()->get('pid')`
   (session pid again, not the unused parameter). On this seed every pid 13
   `form_vitals` row has `activity=1`, so this filter is a no-op here but is
   a real, independent soft-delete-ish signal from `forms.deleted`.
8. **Render.** `report.php:48` iterates the fetched row's columns in DB
   column order, skips a fixed set plus empty-date/`"0.0"` values, and
   builds one field-per-row HTML table with US-primary, dual-unit
   formatting (`units_of_measurement`, site value `1` — `data/CONFIG.md`
   §1). Tables touched: `form_vitals` (read), `forms` (read, `deleted`
   only), `patient_data` (read, for pediatric-age gating).

## (b) Port path

1. **SPA** calls the BFF for the patient's Vitals card (patient identified
   by `puuid`, per AGENT-BRIEF's "Ids" rule).
2. **BFF → `GET /api/patient/:puuid` .** ACL `patients`/`demo`
   (`apis/routes/_rest_routes_standard.inc.php:99-104`). Resolves the
   integer `pid` the rest of the sequence needs (`PatientRestController::getOne`).
3. **BFF → `GET /api/patient/:puuid/encounter` .** ACL `encounters`/`auth_a`
   (`_rest_routes_standard.inc.php:105-110`) → `EncounterRestController::getAll()`
   (`src/RestControllers/EncounterRestController.php:420-431`) →
   `EncounterService::search()` (`src/Services/EncounterService.php:152-333`),
   `ORDER BY fe.eid DESC` (`:322`) — encounters newest-first by the
   auto-increment `encounter` id, **not** by `form_encounter.date`
   (confirmed on both seed patients: `eid` order matches date order here,
   but the ordering key is a surrogate id, not the date column
   `VitalsService::search()` itself uses — see "Where they diverge"). Zero
   encounters → HTTP 404 with an empty result (`EncounterRestController.php:426-428`).
4. **BFF iterates the returned `eid` list, newest first.** For each `eid`,
   **`GET /api/patient/:pid/encounter/:eid/vital`** . ACL
   `encounters`/`notes` (`_rest_routes_standard.inc.php:154-159`, a
   **different** ACL section than the encounter-list call and than both the
   legacy card and the FHIR path — see divergence table) →
   `EncounterRestController::getVitals()` (`:580-584`) →
   `EncounterService::getVitals()` (`src/Services/EncounterService.php:598-603`)
   → **`VitalsService::getVitalsForPatientEncounter($pid, $eid)`**
   (`src/Services/VitalsService.php:504-518`), which adds `deleted=0 AND
   formdir='vitals'` search fields (`:507-510`) before calling the shared
   `search()` SQL (`:85-223`) — the same join shape
   `modules/VITALS-SERVICES.md` verified is collision-free (`forms.formdir
   = 'vitals'` present, `:152` in that unit's citation), now additionally
   filtered to live rows only. The BFF stops at the first `eid` that returns
   a non-empty array and takes its first element (already sorted `encounter_date
   DESC, date DESC` inside `search()`, `VitalsService.php:199`, so within one
   encounter's result the newest vitals form is first).
5. **Scope.** The confidential BFF client needs read/search actions within
   `user/encounter.*` and `user/vital.*` (both registered `['c','r','u','s']`,
   `src/Common/Auth/OpenIDConnect/Entities/ServerScopeListEntity.php:273,294`)
   — distinct from the `patient/Observation.rs` scope the FHIR path would use.
6. **Fields and units.** `VitalsService::createResultRecordFromDatabaseResult()`
   (`VitalsService.php:225-283`) returns the raw stored numbers, converted
   per the current `units_of_measurement` global (site value `1` → US
   identity branch, `:264-270`), **plus an explicit `<field>_unit` key per
   value** (`weight_unit`, `height_unit`, `temperature_unit`, `bps_unit`,
   etc., via `convertArrayValue()`, `:249-283`) — one unit system per call,
   not the legacy card's simultaneous dual display.
7. **Display.** SPA renders the single vitals-set record: BP, weight,
   height, temperature (with unit labels from the `_unit` keys), pulse,
   respiration, BMI/`BMI_status` (raw, pediatric override not recomputed by
   the API), waist/head circ, O2 sat/flow/inhaled-concentration, note,
   `temp_method`. Pediatric-only percentile fields and age-gating, and the
   dual-unit secondary display, are **not** in the API response — the SPA
   must compute both client-side to match the legacy card
   (`ui/VITALS-FRAGMENT.md` Parity spec).

## (c) Where they diverge

| Rule | Legacy behavior | REST per-encounter API (port's chosen path) | FHIR `Observation` API (not used for this card) | Port rule (AGENT-BRIEF) |
|---|---|---|---|---|
| Deleted-set filtering | **Buggy**: join on bare `forms.form_id`, no `formdir`/`pid` condition (`vitals_fragment.php:27`) — confirmed on pid 13 to return the deleted 2026-05-01 set as "most recent" (U-1) | **Correct**: `getVitalsForPatientEncounter()` adds `deleted=0 AND formdir='vitals'` (`VitalsService.php:507-510`) | **Missing entirely**: no `deleted` search parameter registered, no filter added by `search()`'s bare callers (`FhirObservationVitalsService.php:441`) — confirmed to also surface the deleted set (M-5) | Port must call the REST per-encounter route, not `/fhir/Observation`, to satisfy "show the correct latest non-deleted set" |
| ACL section | Client-side only: `patients`/`med` (`demographics.php:629`); **no server-side check at all** (U-1/Finding #4) | `encounters`/`auth_a` (list, `:106`), `encounters`/`notes` (vital fetch, `:141,148,155,161`) | `patients`/`med` (`_rest_routes_fhir_r4_us_core_3_1_0.inc.php:495`) — matches the legacy card's *intended* gate | Port inherits OAuth2 scope + `encounters`/`notes` server-side ACL enforcement — closes the missing-check gap, but the BFF's client user needs a **different** ACL section (`encounters`) than the legacy card's `patients`/`med`, not the same one |
| "Latest set" ordering key | `form_vitals.date DESC`, no `LIMIT` (`vitals_fragment.php:27`) | Encounter list: `form_encounter.eid DESC` (surrogate id, `EncounterService.php:322`); within an encounter: `encounter_date DESC, form_vitals.date DESC` (`VitalsService.php:199`) | `effectiveDateTime` (client must group Observations by this field; grouping by `Observation.encounter` would merge distinct sets — confirmed on pid 13, both the deleted and live 2026 sets share `eid=367`) | Port must trust the encounter-list order matches date order (true on seed data, not schema-enforced) rather than sort by date itself, since the per-encounter route has no date parameter |
| Units display | Dual, simultaneous US + metric, computed per-field in `report.php` (`ui/VITALS-FRAGMENT.md` table) | Single unit system per response, but each field carries an explicit `<field>_unit` key (`VitalsService.php:249-283`) | Single unit system, no explicit per-field unit key confirmed in `modules/VITALS-SERVICES.md`'s trace | SPA must independently compute the secondary unit for dual display; the REST route's `_unit` keys resolve `data/CONFIG.md`'s open question about whether a unit code is exposed (it is, for this route) |
| Pediatric BMI-status / percentile gating | PHP-side, keyed on `getPatientAge()` (`report.php`) | Not recomputed; `BMI_status` returned raw, `ped_*` fields returned regardless of age | Same — not on the FHIR resource at all | SPA must recompute the age gate client-side from `Patient.birthDate` |
| Height/weight raw-value trust | Raw stored number, interpreted per `units_of_measurement` — inherits D-6 (cm-scale values in the inches-documented `height` column for Synthea-imported patients) | Same raw number, same D-6 exposure — the API does not correct or flag it | Same | Not fixable at the port layer either way; document as inherited data-quality risk, not a port bug |

## (d) Partial-failure points

**Legacy:**
- ACL/CSRF gate fails silently for the *client-side* case (`$vitals_is_registered`
  false or `patients/med` denied): the JS `placeHtml()` call is never emitted, so
  the card body simply stays empty — no error, no "Nothing Recorded" text either.
- A user with a valid session/CSRF token but without `patients/med` can still
  POST directly to `vitals_fragment.php` and get vitals PHI back (Finding #4,
  U-1) — a security partial-failure, not a UX one: nothing visibly fails.
- `CsrfUtils::checkCsrfInput(..., dieOnFail: true)` dies on a bad/missing
  token; the fragment's response body for that case was not observed live in
  any audit pass — flagged as an open question, not confirmed, whether the
  card body ends up showing a blank area or a raw PHP die() string.
- If `formFetch()`'s `activity` filter excludes the row after the join-bug
  query already picked an id, `vitals_report()` receives empty `$data`; the
  resulting render was not traced line-by-line for this exact case — likely
  an empty table, not confirmed.

**Port:**
- `GET /api/patient/:puuid` fails (bad `puuid`, expired token, missing
  `patients/demo`) → the whole card sequence aborts before it starts; SPA
  must show a generic load error per AGENT-BRIEF's "never render API error
  text" rule, not the raw 401/validation body (which can leak SQL, per the
  security model section).
- `GET /api/patient/:puuid/encounter` returns HTTP 404 when the patient has
  zero encounters (`EncounterRestController.php:426-428`) — the BFF must
  treat this as "no vitals to check" (skip straight to "Nothing Recorded"),
  not as a hard error; distinguishing this 404 from an authorization 404/401
  by body shape was not verified live in this pass (open question).
- The two calls in the loop use **different ACL sections** (`encounters/auth_a`
  vs `encounters/notes`): a BFF client authorized for one but not the other
  produces a card that partially renders — the encounter list succeeds, then
  every per-encounter vital fetch 401s — a failure mode with no legacy
  analogue (the legacy card has exactly one gate, and it's missing entirely).
- Iterating encounters with no bound: a patient with many encounters and no
  vitals ever recorded forces the BFF to walk the full encounter list before
  concluding "Nothing Recorded" — a latency/DoS-shaped smell worth a cap,
  not present in the legacy single-query design.
- Mid-loop failure (one `GET .../vital` call 5xxs while an earlier/later
  encounter would have succeeded): the SPA must not silently show "Nothing
  Recorded" for a transient error — must distinguish "confirmed no data
  after checking N encounters" from "a fetch failed," per the AGENT-BRIEF
  rule against treating errors as empty state.

## (e) Live evidence to collect in the build

Read-only SQL against the local seed DB, confirmed this session
(`docker exec agentforge-week1-mysql-1 … mariadb … openemr`, SELECT-only):

**pid 13** — 5 `form_vitals` rows join correctly to `forms` via
`formdir='vitals'` (no collision on this specific patient's ids, per
`modules/VITALS-SERVICES.md`'s own note that the 355-collision count is
install-wide density, not a per-row guarantee):

| vitals id | date | `forms.deleted` | eid |
|---|---|---|---|
| 28 | 2026-05-01 09:00:00 | **1** | 367 |
| 27 | 2026-04-05 20:06:27 | 0 | 367 |
| 26 | 2025-03-30 20:06:27 | 0 | 366 |
| 25 | 2024-03-24 20:06:27 | 0 | 365 |
| 24 | 2018-02-25 20:06:27 | 0 | 346 |

pid 13 has 36 total encounters, max `eid=367`.

- [ ] `GET /api/patient/13(uuid)/encounter` returns `eid=367` first (36 total).
- [ ] `GET /api/patient/13/encounter/367/vital` returns **exactly one** row:
      `id=27`, `date=2026-04-05 20:06:27` — the deleted `id=28` must **not**
      appear, and the BFF must not need to check any older encounter.
- [ ] The legacy `vitals_fragment.php` query, run read-only, still returns
      `id=28` (deleted) as top row for pid 13 — confirms U-1 is still live at
      the audited SHA and that the port genuinely diverges from it (not just
      on paper).
- [ ] `GET /fhir/Observation?patient=<puuid13>&category=vital-signs`, grouped
      client-side by `effectiveDateTime`, yields 5 groups; the max date
      (2026-05-01) is the deleted set — confirms the FHIR path is **not**
      an acceptable substitute for the chosen REST per-encounter path.
- [ ] Rendered card shows `height` for the phase-1-seeded rows as a
      plausible adult value (~67 in) — do **not** use pid 1-12's
      Synthea-imported vitals for this specific check (D-6: cm-scale values
      in the inches column).

**pid 3** — empty-state comparison, 1 `form_vitals` row, 1 total encounter:

| vitals id | date | `forms.deleted` | eid |
|---|---|---|---|
| 14 | 2014-02-01 21:47:33 | 0 | 12 |

- [ ] `GET /api/patient/3(uuid)/encounter` returns exactly one encounter,
      `eid=12`.
- [ ] `GET /api/patient/3/encounter/12/vital` returns exactly one row,
      `id=14` — pid 3 is **not** an empty-state patient for this specific
      card (matches `ui/VITALS-FRAGMENT.md`'s note that every patient has at
      least one vitals row); the card must show real data, not "Nothing
      Recorded", for pid 3.
- [ ] Confirm the SPA's "Nothing Recorded"/empty-state string only appears
      for a patient with **zero** encounters or zero non-deleted vitals sets
      across all of them — not exercisable on either seeded patient; needs a
      third, synthetic zero-vitals patient if this path is to be tested live.
- [ ] Confirm the two ACL sections (`encounters/auth_a`, `encounters/notes`)
      are both granted to the BFF's OAuth client/user in the deployed
      environment — a config check, not a code check, per the divergence
      table above.

## Confidence

High for the legacy path (fully reused from a tier-2, SQL-confirmed
analysis) and for the port path's route/service/SQL trace (independently
re-read and confirmed this session, including running the exact
`getVitalsForPatientEncounter()` SQL path by tracing `EncounterRestController`
→ `EncounterService` → `VitalsService` source, and re-confirming the pid
13/pid 3 row counts and eid mappings via fresh read-only SQL). Medium on two
specific claims not independently verified live in this pass: the exact
response-body shape that would let a BFF distinguish "zero encounters" (404,
empty) from an authorization failure (also potentially 404/401), and whether
`vitals_fragment.php`'s CSRF-failure response renders visibly in the card
body — both flagged as open questions above, matching the source analyses'
own tier-2 provisional-severity convention rather than asserting them as
confirmed.

## Contradicts / adds to existing analyses

1. `modules/VITALS-SERVICES.md` (Layout/interface, and again in "Port
   notes") flags `VitalsService::getVitalsForPatientEncounter()` as having
   "no caller ... found outside this file," an open question, "not confirmed
   unused." It is used: `EncounterService::getVitals()`
   (`src/Services/EncounterService.php:598-603`) calls it directly, backing
   the live route `GET /api/patient/:pid/encounter/:eid/vital`
   (`apis/routes/_rest_routes_standard.inc.php:154-159`) — exactly the route
   this walkthrough's port path uses. This resolves that unit's open
   question rather than contradicting its severity findings.
2. `data/CONFIG.md`'s open question — "Does the FHIR/REST vitals response
   carry an explicit unit code per value, or only the pre-converted number?"
   — is resolved for the REST path (not traced in that doc):
   `VitalsService::createResultRecordFromDatabaseResult()`
   (`src/Services/VitalsService.php:249-283`) appends a `<field>_unit` key
   per value (`weight_unit`, `height_unit`, `temperature_unit`, etc.),
   confirming the "BFF must replicate for display labeling only" framing
   rather than requiring the BFF to infer units purely from the
   `units_of_measurement` global out-of-band.
3. `modules/VITALS-SERVICES.md`'s "DB-08 decision support" section states
   flatly "No — confirmed... A port built strictly against `GET
   /fhir/Observation?category=vital-signs` cannot implement 'show the
   correct latest non-deleted set'." That conclusion is correct **only for
   the FHIR sub-path it analyzed**; it does not generalize to "the API"
   as stated in that section's own framing. The standard REST per-encounter
   route (traced in full in (b) above) does filter `deleted=0 AND
   formdir='vitals'` and, combined with iterating the encounter list
   newest-first, achieves the decided semantics — confirmed live on pid 13,
   where the deleted 2026-05-01 set and the correct 2026-04-05 set share
   `eid=367` and the per-encounter query correctly returns only the latter.
   This matches `modules/README.md`'s own M-5 mitigation note ("Decision 2
   is only implementable via REST per-encounter vitals") but is understated
   by the sibling unit's more totalizing conclusion.
4. Neither `ui/VITALS-FRAGMENT.md` nor `modules/VITALS-SERVICES.md` flags
   that the port's two required calls use **different ACL sections** from
   each other and from both legacy paths: `encounters/auth_a` (encounter
   list) vs `encounters/notes` (vital fetch) vs `patients/med` (legacy card
   and the FHIR `Observation` route). `modules/VITALS-SERVICES.md`'s
   permission-checks table only covers the FHIR path's `patients/med` gate.
   This is a new port-facing fact, not a correction of a wrong claim.
