# Walkthrough: Allergies, Medical Problems and Medications cards render for a patient (DB-03, DB-04, DB-05)

Audited commit: tag `legacy-baseline` = `3ccfe1d` (equals the working tree for
every path cited below). Legacy-side citations are `path:line`, all at that
tag; port-side citations are the same tree's API/service code, which the
brief's "do not change OpenEMR's backend" rule (DB-10 / W2D-8) pins to the
same commit.

This walkthrough traces one end-to-end scenario — "the three in-scope issue
cards render for a patient" — from the PHP dashboard's current behavior
through to the SPA + BFF port. It reuses verified facts from
`ui/CARD-TEMPLATES.md`, `ui/DEMOGRAPHICS-PART2-CARDS.md`,
`modules/ALLERGY-SERVICES.md`, `modules/CONDITION-SERVICES.md`,
`modules/MEDICATION-SERVICES.md` and `data/SCHEMA.md` rather than re-auditing
them; it does not repeat their finding IDs beyond the one-line references
required by the brief.

All three cards share one shape — ACL+hidden-card gate → fetch all rows →
`filterActiveIssues()` in PHP → Twig row loop → one of two empty strings —
but each hits a **different** service, a **different** SQL shape, and (for
Medical Problems) a **different** ACL than its siblings. That divergence,
not any single bug, is what the port has to bridge.

## (a) Legacy path — PHP dashboard, one render pass

The sequence is identical in shape for all three cards; steps 4–7 fork per
card and are given once each.

1. **Browser navigates** to
   `interface/patient_file/summary/demographics.php?set_pid=13` inside the
   tabbed shell's iframe (`AGENT-BRIEF.md` "Entry point"). Before any
   authorization check, `setpid()`/`touchRecentPatientList()` run
   (Part 1, `demographics.php:83-94`) and the whole `<head>` — including
   inline JS carrying the patient's name, `pid`, `pubpid`, DOB/age and
   encounter list — is emitted (`demographics.php:916-967`).
2. **Page gate**: `AclMain::aclCheckCore('patients','demo')`
   (`demographics.php:1056-1061`). Fail → `core/unauthorized-partial.html.twig`
   and `exit()`. Pass → continue into the card block.
3. **Row-1 show flags and column width**
   (`demographics.php:1095-1102`): `$allergy = aclCheckIssue('allergy') && !hidden`,
   `$pl = aclCheckIssue('medical_problem') && !hidden`,
   `$meds = aclCheckIssue('medication') && !hidden`. Locally all three
   `issue_types.aco_spec = patients|med`
   (`ui/DEMOGRAPHICS-PART2-CARDS.md:140`). `filterActiveIssues()` is declared
   once (`:1104-1113`):
   `array_filter($i, fn($_i) => $_i['outcome'] != 1 && (empty($_i['enddate']) || strtotime((string)$_i['enddate']) > strtotime('now')))`.
4. **Allergies** (`demographics.php:1115-1136`): `new AllergyIntoleranceService()->getAll(['lists.pid' => $pid])`
   → `getAll()` renames the key to `patient_id`
   (`src/Services/AllergyIntoleranceService.php:155-158`) → `search()` builds one
   SQL statement forcing `type='allergy'`, joining `list_options` (reaction,
   verification), `patient_data`, `users`, `facility`, **no `ORDER BY`**
   (`AllergyIntoleranceService.php:52-101`), de-dupes by uuid in PHP
   (`:112-135`). Table: `lists`.
5. **Medical Problems** (`demographics.php:1138-1160`):
   `PatientIssuesService::search(['lists.pid'=>$pid, 'lists.type'=>'medical_problem'])`
   → `lists LEFT JOIN lists_medication`, **`ORDER BY lists.begdate` ASC, NULLs
   first** (`src/Services/PatientIssuesService.php:170-211`). Tables: `lists`,
   `lists_medication`.
6. **Medications** (`demographics.php:1162-1182`): the same
   `PatientIssuesService::search()` with `type='medication'`, same
   `ORDER BY lists.begdate` ASC. `lists_medication.drug_dosage_instructions`
   is copied into the row for the template (`PatientIssuesService.php:223-243`).
   Tables: `lists`, `lists_medication`.
7. **Filter, all three**: `filterActiveIssues()` runs in PHP after each full
   result set is already in memory (`demographics.php:1128`, `:1152`, `:1174`).
   `activity` is never consulted; a `disappearList()`-hidden issue
   (`activity=0`) still shows (`ui/README.md` U-... / `DEMOGRAPHICS-PART2-CARDS.md`
   Finding 10).
8. **`$viewArgs` built and rendered** (`demographics.php:1120-1132`,
   `:1144-1156`, `:1166-1178`) → `$t->render('patient/card/<name>.html.twig', $viewArgs)`.
   Each template `{% extends card_base.html.twig %}` for chrome (title,
   collapse icon, edit pencil) and loops `list` unsorted
   (`templates/patient/card/allergies.html.twig:39`,
   `medical_problems.html.twig:8`, `medication.html.twig:8`). Allergies also
   calls `getListItemTitle('severity_ccda', l.severity_al)`
   (`src/Common/Layouts/LayoutsUtils.php:17-24`) per row — one query per
   allergy row, N+1 — for the severity label, falling back to the raw stored
   code (e.g. `"1"`) when no `list_options` row matches.
9. **Empty state**: `listTouched = !empty(getListTouch($pid, $type))`
   (`library/lists.inc.php:130-139`, table `lists_touch`) selects between
   `"No Known Allergies"`/`"None"` (touched) and `"Nothing Recorded"`
   (untouched) — independently per `(pid, type)`.
10. **HTML is echoed** inline into the page's main synchronous response —
    these three cards have no loading state; a thrown exception anywhere in
    steps 4–9 fails the whole page render (`ui/DEMOGRAPHICS-PART2-CARDS.md`
    "Common states").

## (b) Port path — SPA → BFF → API → scope/ACL → controller → service → SQL

The BFF is a confidential OAuth2 client (auth code + PKCE); tokens stay
server-side (`AGENT-BRIEF.md` "Client model"). Every call below carries an
explicit patient id — no session pid (U-11).

1. **SPA requests the dashboard for patient X.** The BFF first resolves ids
   it needs downstream: `GET /api/patient/:puuid` → integer `pid`
   (`PatientService.php:427`, per `data/README.md` "Ids") — required because
   the Medications route below takes the integer `pid`, not a uuid. This is a
   **hard dependency**: if this call fails, none of the three cards below can
   be fetched (Medications needs `pid` directly; Allergies/Medical Problems
   need the same `puuid` already in hand from the dashboard's own patient
   lookup, so they are not blocked by this specific call, but a missing
   resolved patient means the BFF has nothing to key the UI on at all).
2. **BFF → `GET /api/patient/:puuid/allergy`**
   (`apis/routes/_rest_routes_standard.inc.php:265-270`) → ACL
   `patients/med` (`AllergyIntoleranceRestController.php` via
   `_rest_routes_standard.inc.php:266`; scope `user/allergy.rs` family) →
   `AllergyIntoleranceRestController::getAll(['puuid'=>$puuid])` →
   `AllergyIntoleranceService::getAll()` → `search()` — **the same SQL
   statement as legacy step 4**, no `ORDER BY`
   (`modules/ALLERGY-SERVICES.md` "search()"). Response: standard-REST
   envelope `{validationErrors, internalErrors, data: [...], links}`.
3. **BFF → `GET /api/patient/:puuid/medical_problem`**
   (`_rest_routes_standard.inc.php:221-224`) → ACL **`encounters/notes`**,
   not `patients/med` (`ConditionRestController` per that route; scope
   `user/medical_problem.rs`/`user/Condition.rs` family — confirm exact
   scope name against the OAuth client registration) →
   `ConditionRestController::getAll(['puuid'=>$puuid])` →
   `ConditionService::search()` — a **different** 5-way join than legacy
   step 5 (no `lists_medication`, adds `issue_encounter`/`form_encounter`/
   `users` joins), **no `ORDER BY`**
   (`modules/CONDITION-SERVICES.md` "`ConditionService::search()`").
   `PatientIssuesService`, legacy's actual query, has **no API route at all**
   (`modules/CONDITION-SERVICES.md` "Purpose & lifecycle").
4. **BFF → `GET /api/patient/:pid/medication`** (integer `pid` from step 1;
   `_rest_routes_standard.inc.php:298-303`) → ACL `patients/med` (scope
   `user/medication.rs` family) → `ListRestController::getAll` →
   `ListService::getAll($pid, 'medication')` → `SELECT * FROM lists WHERE
   pid=? AND type=? ORDER BY date DESC` (`ListService.php:50`) — a bare
   `lists` select with **no `lists_medication` join**, so
   `drug_dosage_instructions` is absent from every row
   (`modules/MEDICATION-SERVICES.md` Q1).
5. **SPA receives three JSON payloads** (or a 404 for Medications on an
   empty patient — see (c)) and, client-side, re-implements
   `filterActiveIssues()` against the raw `outcome`/`enddate` fields
   returned by each endpoint: `outcome != 1 && (!enddate || enddate > now)`,
   compared in the same timezone the PHP server used
   (`modules/ALLERGY-SERVICES.md` "Port notes — API contract"). This must be
   done against the **raw REST fields**, never FHIR `clinicalStatus` or
   `activity` (both use different, non-equivalent rules — see (c)).
6. **SPA sorts client-side**: Allergies keeps API order (no real order to
   match); Medical Problems and Medications re-sort by `begdate` ascending,
   NULLs first, to match legacy's `ORDER BY lists.begdate`
   (`ui/CARD-TEMPLATES.md` "Parity spec for the port").
7. **SPA renders rows**: Allergies needs a client-side `severity_ccda`
   label lookup (`GET /api/list/severity_ccda`, resolved once and cached,
   not per-row like the legacy N+1) with the same raw-code fallback;
   Medical Problems shows `title` only; Medications shows `title` only
   (`drug_dosage_instructions` is a documented gap, not an implementation
   bug — see (c)).
8. **SPA renders empty state**: `lists_touch` has no API exposure on any
   surface checked (`grep -rn lists_touch src/RestControllers apis/routes` →
   no hits, confirmed independently by both `ui/CARD-TEMPLATES.md` and
   `modules/ALLERGY-SERVICES.md`). Per the approved parity simplification
   (`AGENT-BRIEF.md` "Empty lists say 'Nothing Recorded'"), the port always
   shows `"Nothing Recorded"` for an empty list — it does not attempt the
   touched/untouched distinction.

## (c) Where they diverge

| Rule | Legacy (PHP card) behavior | API behavior | Port rule (per `AGENT-BRIEF.md`) |
|---|---|---|---|
| Active-issue filter | `filterActiveIssues()` in PHP, `outcome != 1 && (empty(enddate) \|\| enddate > now)`; `activity` ignored | REST returns every row unfiltered (all three endpoints); FHIR `Condition` filters `activity=1` instead (a different, non-equivalent signal — pid 13: 26/39 medical problems disagree between the two rules) | Reproduce `filterActiveIssues()` client-side against REST's raw `outcome`/`enddate`; never use FHIR `activity`/`clinicalStatus` for this |
| Allergy severity source | Raw `severity_al`, human label via per-row `list_options(severity_ccda)` lookup, raw-code fallback (e.g. `"1"`) | Standard REST: raw `severity_al`, untouched. FHIR `criticality`: coarsened to 3 buckets, and **silently `null`** for `severity_al='1'` (an unguarded array access) | Use standard REST `severity_al`; do the label lookup client-side; keep the raw-code fallback (bug-for-bug, per Card-Templates parity spec) |
| Allergy row order | No `ORDER BY` in `AllergyIntoleranceService::search()` | Same SQL, same absence of `ORDER BY` | No gap — API order = legacy order in practice, not guaranteed; do not add a client sort |
| Medical Problems / Medications row order | `ORDER BY lists.begdate` ASC (NULLs first), via `PatientIssuesService` | `ConditionService`/`ListService` have **no `ORDER BY`** (Medications: `ORDER BY date DESC`, a different column entirely) | Client must re-sort by `begdate` ASC, NULLs first, on every row the API returns |
| Medical Problems ACL | `aclCheckIssue('medical_problem')` = `patients\|med` | `GET /api/patient/:puuid/medical_problem` requires **`encounters/notes`**, not `patients/med` (`modules/CONDITION-SERVICES.md` Finding 1/2) | Port's OAuth client needs an `encounters/notes`-equivalent scope in addition to `patients/med`, or this card silently 403s for a token scoped only like the UI's own ACL |
| Medications: dosage instructions | `lists_medication.drug_dosage_instructions` joined and shown next to title | `GET /api/patient/:pid/medication` is a bare `lists` select — **not present** | Not available via API on this endpoint; title-only row, documented gap (locally invisible since `lists_medication` has 0 rows) |
| Empty-list text | `"No Known Allergies"`/`"None"` if `lists_touch(pid,type)` exists, else `"Nothing Recorded"` | `lists_touch` is exposed by **no** REST/FHIR route | Per approved simplification: always `"Nothing Recorded"` for an empty list |
| Empty response shape | n/a (server-rendered) | Allergy/Medical-Problems: HTTP 200, `data: []`. **Medications: HTTP 404 with an empty body** for zero rows — indistinguishable from an unknown `pid` (`modules/MEDICATION-SERVICES.md` Finding 8) | Treat both the 200-empty-array and the 404-empty-body shapes as "Nothing Recorded", not as errors; never render either as a blank/broken card |
| Ids | Implicit session `$pid` | Allergy/Medical-Problems take `:puuid`; Medications takes integer `:pid` | BFF resolves `pid` once from `GET /api/patient/:puuid` and threads both ids explicitly through every call (U-11: no session state) |
| Edit-pencil ACL | Shown to every viewer regardless of write ACL (`auth => true`, `demographics.php:1129,1153,1177`) | n/a | Port is read-only; no pencil at all |

## (d) Partial-failure points

| Failure | What the user sees |
|---|---|
| Step (b)1 fails (`GET /api/patient/:puuid` errors or times out) | Nothing downstream can run — the BFF has no `pid`; the dashboard should show a page-level error, not per-card spinners that never resolve |
| Allergy or Medical-Problems `puuid` malformed | The service's own validator short-circuits **before SQL runs**, returning `validationErrors` as HTTP 400 (`AllergyIntoleranceService.php:172,185,198`) — the port must render this as an error state, never as "Nothing Recorded" (`AGENT-BRIEF.md` "Treat HTTP 200 validation errors ... as errors") |
| Medical-Problems call 403s (ACL mismatch, see (c)) while Allergy/Medications succeed | A **partial** dashboard: two cards render, one shows an access-denied state — this can happen even for a legitimately-scoped user because the route's ACL doesn't match the other two cards' or the PHP card's own gate |
| Medications call for an empty patient | HTTP 404, empty body, indistinguishable from "no such pid" (`modules/MEDICATION-SERVICES.md` Finding 8) — the client must not surface this as a fetch error; it must render "Nothing Recorded" the same as the 200-empty-array cases on the other two cards |
| Any endpoint returns HTTP 500 | The response can carry the raw SQL/exception text in `internalErrors` — never render that text to the user (`AGENT-BRIEF.md` "API errors can leak SQL"); show a generic per-card error |
| `severity_ccda` list lookup (allergy label) fails independently of the allergy fetch | Allergies card has rows but no severity label — must degrade to the raw `severity_al` code rather than blanking the row or failing the whole card |
| One card's fetch is slow, others return quickly | Per-card loading state is required (legacy has none to copy — these three cards are server-rendered with no loading state at all, `ui/DEMOGRAPHICS-PART2-CARDS.md` "Common states") — the port must not let one slow card block or blank the other two |

## (e) Live evidence to collect in the build

Expected counts, read-only SQL against the local synthetic DB
(`docker exec agentforge-week1-mysql-1 ... mariadb ... openemr`), 2026-09-25:

```
SELECT pid, type, COUNT(*) AS total,
  SUM(outcome != 1 AND (enddate IS NULL OR enddate > NOW())) AS php_active
FROM lists WHERE pid IN (13,3) AND type IN ('allergy','medical_problem','medication')
GROUP BY pid, type;

 pid | type            | total | php_active
 13  | allergy         |   2   |    2
 13  | medical_problem |  39   |   13
 13  | medication      |   5   |    1
 (pid 3: zero rows for all three types — no rows returned at all)

SELECT pid, type FROM lists_touch WHERE pid IN (13,3);
 13 | medical_problem     (only this one row; allergy and medication untouched for pid 13; pid 3 has none)

SELECT id, severity_al FROM lists WHERE pid=13 AND type='allergy';
 272 | 1
 273 | 1     (both rows: raw-code fallback "(1)", not in the highlight set)
```

Checklist for the walking skeleton (tick each against the running BFF/SPA,
patient-token-scoped, once an OAuth2 client is registered):

- [ ] Allergies card, pid 13: exactly 2 rows, both titled with `"(1)"` (not
  a resolved severity word), neither highlighted `bg-warning`.
- [ ] Medical Problems card, pid 13: exactly **13** rows shown (not 39) —
  confirms the client-side `filterActiveIssues()` port, not the raw REST
  count or the FHIR `activity=1` count (which would show 39, per
  `modules/CONDITION-SERVICES.md` "Verification").
- [ ] Medications card, pid 13: exactly **1** row shown (not 5); the row
  shows a title with no dosage-instructions text (documented gap, not a
  bug — `lists_medication` is empty locally so this is untestable beyond
  "absent, not wrong").
- [ ] Medical Problems row order, pid 13: ascending by `begdate`, not the
  API's raw (unordered) response order — spot-check against `SELECT id,
  begdate FROM lists WHERE pid=13 AND type='medical_problem' AND (outcome
  != 1 AND (enddate IS NULL OR enddate > NOW())) ORDER BY begdate ASC`.
- [ ] Allergies, Medical Problems, Medications cards, pid 3: all three show
  the literal string `"Nothing Recorded"` (pid 3 has zero `lists` rows of
  any of these types, and zero `lists_touch` rows, so this also indirectly
  confirms the "always Nothing Recorded when empty" simplification doesn't
  need the touched/untouched branch to be right for this patient).
- [ ] Medications fetch for pid 3 resolves to the empty state, not a
  visible error, even though the raw HTTP response is `404`.
- [ ] With a token scoped `patients/med` only (no `encounters/notes`
  equivalent), confirm whether the Medical Problems card 403s while
  Allergies/Medications succeed — this needs a second, narrower-scoped
  test client/role, since the dev `admin` account's grants won't surface
  the mismatch (`modules/CONDITION-SERVICES.md` Finding 1/2 is
  code-verified, not yet live-verified against a real ACL boundary).
- [ ] Confirm the BFF never fetches any of the three cards before
  `GET /api/patient/:puuid` has resolved successfully (no session-state
  fallback, no card rendered against a stale/previous patient — U-11).

---

Wrote: C:\Users\david\repos\agentforge-week1-w2-dashboard\docs\legacy-audit\walkthroughs\ISSUE-CARDS.md (249 lines)
Confidence: high — every claim above traces to an existing tier-2/tier-3 finding in the five source analyses plus one fresh read-only SQL check (pid 13/pid 3 counts, `lists_touch` rows, allergy `severity_al` values) run for this walkthrough; no new code paths were audited.

Contradictions found against existing analyses: none. One clarification, not a contradiction: `modules/ALLERGY-SERVICES.md`'s DB check ("`severity_al = '1'` for 2 rows and NULL for 1 row") was a practice-wide aggregate, not pid-13-specific; pid 13's own 2 allergy rows are both `severity_al='1'` (confirmed above), so the NULL row belongs to a different patient. This doesn't change any port guidance in that doc.
