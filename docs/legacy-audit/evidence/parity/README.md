# Slice 01-06-01 — Parity evidence: legacy dashboard vs the port

Captured 2026-09-26, local stack only (never production):

- Legacy: `http://localhost:8300/interface/patient_file/summary/demographics.php?set_pid=<pid>`
  (self-signed TLS on `https://localhost:9300` for the OAuth2/FHIR endpoints the port uses).
- Port: `npm run dev --prefix dashboard`, `http://localhost:8790/dashboard/patients/<puuid>`.
- Driven headlessly with Playwright (`docs/legacy-audit/probe/parity-capture.mjs`, run
  from the probe kit's `node_modules` and removed after use — not committed; the
  probe kit's own `probe-dashboard.mjs` documents the same legacy login flow). Login
  credentials came from `docker/development-easy-light/docker-compose.yml`
  (`OE_USER`/`OE_PASS`) at run time; never printed or written to a file.
- Patients: **DASH-SYN-01** (local pid 14, data-rich), **DASH-SYN-02** (local pid 15,
  deceased), **pid 3** (the card-level empty-state patient — it has an old vitals set,
  so only Allergies/Problems/Medications/Prescriptions/Care Team are empty for it).
- Screenshots: `legacy-<patient>.png` / `port-<patient>.png`, full page, 1280px
  viewport, all six cards + header settled before capture. Raw per-card/per-field data
  backing the tables below is in `capture-data.json` (states, row counts, header text).

## DASH-SYN-01 (pid 14)

| Section | Legacy | Port | Difference |
|---|---|---|---|
| Header | Page title only: "Medical Record Dashboard - Dana Seedcase" (no persistent identity bar outside the tabbed shell; DOB/sex/status not shown at all in that bar per `ui/DASHBOARD-HEADER.md`) | Name, DOB 1970-04-12 (Age: 56), **Sex: Female**, MRN DASH-SYN-01, **Status: Active** | **Intended**: sex + status are fields the legacy identity bar never has (4.04); this is a documented addition, not a parity break |
| Allergies | "Penicillin ( **Severe** )" — 1 row shown (the `outcome=1` Latex allergy is hidden) | **"Couldn't load Allergies. Reference \<id\> (UPSTREAM_STATUS)."** | **UNINTENDED — see Findings below.** The upstream REST route 500s for this patient |
| Medical Problems | Essential hypertension; Prediabetes (2 rows; the past-enddate problem hidden) | Same 2 rows | Same |
| Medications | Lisinopril 10 MG Oral Tablet (1 row) | Same, plus "Dosage instructions: not available via API" | **Intended**: dosage instructions gap, documented on-card |
| Prescriptions | 3 rows (Metformin, Lisinopril, Amoxicillin) with real Qty/Refills (1, 3, 0) and Filled dates | Same 3 rows, same drugs/qty/dates, **Refills: "Not available via API"** for all 3; no dosage-form suffix | **Intended** (documented deviation: "refills not available via API"; PrescriptionService's REST shape has no refill count, per `data/UUID-MAPPING.md` §6) |
| Care Team | Card present but **collapsed by default** — 0 visible rows on the full-page screenshot (a row exists in the DOM per `capture-data.json` but needs a manual expand click, unlike Allergies/Problems/Medications which render already expanded) | 1 row shown inline: Provider, **Name unavailable**, Primary Care Provider, Great Clinic, Since 2020-01-15, Status/Note "Not available via API" | **Intended**: the port always renders expanded; "Name unavailable" and the status/note gaps are explained in-card (Practitioner/Organization reads need admin/users permission; the seeded provider is `admin`, which has no NPI, so the FHIR `Practitioner` read 404s) |
| Vitals | Shows the **soft-deleted** 2026-05-01 set: BP 190/120, Temp 101 F, note "DELETED vitals, must be hidden [seed:dashboard]" | Shows the correct **non-deleted** 2026-04-05 set: BP 128/82, Temp 98.2 F, note "[seed:dashboard]" | **Intended, and the point of catalog 5.01/5.02**: the port fixes a Critical defect (legacy shows a soft-deleted vitals set); this is the deliberate divergence the arc calls out |

## DASH-SYN-02 (pid 15, deceased)

| Section | Legacy | Port | Difference |
|---|---|---|---|
| Header | Page title only; a red **"Deceased - 2026-08-30 (27 days ago)"** banner mid-page, outside the identity bar, no positive "Active" indicator ever exists | Name, DOB 1948-09-01 (**Age at death: 77**), Sex Male, MRN DASH-SYN-02, **Status: Deceased (2026-08-30)** | **Intended**: the port surfaces status/sex in the persistent header; legacy only has the disconnected banner |
| Allergies | "Sulfa drugs (Moderate)" — 1 row, not highlighted (severity below "severe") | **"Couldn't load Allergies. Reference \<id\> (UPSTREAM_STATUS)."** | **UNINTENDED — same root cause as DASH-SYN-01** |
| Medical Problems | Nothing Recorded | Nothing Recorded | Same |
| Medications | Nothing Recorded | Nothing Recorded | Same |
| Prescriptions | None | None | Same |
| Care Team | Collapsed, 0 visible rows (no team seeded for this patient) | Nothing Recorded | Same, modulo the same collapse-by-default note above |
| Vitals | "No vitals have been documented." | Nothing Recorded | Same wording difference only (4.02: legacy's per-card empty text vs the port's shared "Nothing Recorded"); accepted per REQUIREMENTS-TRACE DB-03 |

## pid 3 (card-level empty-state patient)

| Section | Legacy | Port | Difference |
|---|---|---|---|
| Header | Page title "Medical Record Dashboard - Wanda Moore" | Name Wanda Moore, DOB 2007-02-18 (Age: 19), Sex Female, MRN 3, Status Active | **Intended** (sex/status addition, as above) |
| Allergies | Nothing Recorded | Nothing Recorded | Same (no 500 here — see Findings; this patient's allergy list is empty, so the buggy join branch never fires) |
| Medical Problems | Nothing Recorded | Nothing Recorded | Same |
| Medications | Nothing Recorded | Nothing Recorded | Same |
| Prescriptions | None | None | Same |
| Care Team | Collapsed, 0 visible rows (no team) | Nothing Recorded | Same |
| Vitals | Most recent vitals from 2014-02-01: BP 120/80, Height 40 in (101.6 cm), Weight 40 lb (18.14 kg), Temp 102 F (38.89 C), BMI 18, "See Growth-Chart", Waist/Head circumference shown | Same set, same values, US units only (no metric conversion — the port doesn't compute the legacy's inline C/kg/cm conversions) | **Intended**: "Units are shown as the API returns them (one system); the legacy card also showed the metric equivalent" is noted directly on the port's card |

## Findings — UNINTENDED difference

**Allergies 500s for both DASH-SYN-01 and DASH-SYN-02 (never for pid 3), reproduced on
3+ consecutive loads each, with the BFF turning the upstream 500 into the card's
generic `error` state ("Couldn't load Allergies").** This is a real, currently-live
bug — not a port bug, and not something to fix as part of this evidence slice (scope
says report, don't fix) — but it means the Allergies card's live behavior for the two
dedicated dashboard patients does **not** match the "1 highlighted row" / "1 row, not
highlighted" contract-test expectations in `test/contract/allergies.test.ts` today.

- **Symptom, from the dashboard BFF's own log:** `rest.allergy.list` returns HTTP 500
  for DASH-SYN-01 and DASH-SYN-02 on every capture run; the BFF logs it as an
  `upstream call` failure and the SPA renders the shared error state with a
  correlation id (never upstream text, per catalog 6.01 — that part of the port is
  working as designed).
- **Root cause, traced in the legacy REST code** (`src/Services/AllergyIntoleranceService.php:52-97,110-134`,
  read-only, no writes): `search()`'s SQL joins `lists` to `users` (aliased
  `practitioners`) on `practitioners.username = lists.user`, and to `facility`
  (aliased `organizations`) on `organizations.name = practitioners.organization`,
  selecting `practitioners.practitioner_uuid` and `organizations.organization_uuid` as
  **raw `binary(16)` columns**. The row-mapping loop converts `uuid`, `puuid`,
  `patient_uuid`, `allergy_uuid`, `practitioner` and `organization` from binary to a
  dashed string via `UuidRegistry::uuidToString()` — but **never converts
  `practitioner_uuid` or `organization_uuid`**. When `json_encode()` (via Symfony's
  `JsonResponse::setData()`) later tries to serialize the response array, the raw
  binary bytes in those two fields aren't valid UTF-8, and the whole response 500s
  with `OpenEMR.ERROR: ExceptionHandlerListener exception Malformed UTF-8 characters,
  possibly incorrectly encoded` (confirmed in the container's
  `/var/log/apache2/error.log.1`, timestamps matching every capture run).
- **Why it's data-dependent:** the join only produces a `practitioners`/`organizations`
  row (and thus a raw-binary field) when `lists.user` matches a real
  `users.username`. `prod-dashboard-seed.sql` sets `user='admin'` for every DASH-SYN-01
  and DASH-SYN-02 allergy row (a realistic, not contrived, value — `admin` is a real
  user with a real facility) — hence a `admin`-authored allergy row consistently
  reproduces it. pid 3 has zero allergy rows, so the buggy join branch never runs and
  the card correctly shows empty.
- **Scope:** this is a pre-existing legacy REST API defect
  (`AllergyIntoleranceService::search()`), not a bug in the port's `bff`/`web`/`core`
  code — the BFF's own error handling (no upstream text leaked, a correlation id
  shown, `error` not `empty`) is behaving exactly as designed for an upstream 500.
  Flagging it here per AGENTS.md ("fail loudly... a document mismatch or patient
  mismatch is never READY") rather than silently treating it as parity; not fixed as
  part of this slice (scope says report, don't fix code).
- **Contradicts:** `DEV-LOG.md`'s 01-02-01 entry ("Owner sign-in (Window 1): ... DASH-SYN-01
  shows 1 highlighted "(Severe)" row") — that observation predates whatever changed
  (or was always contingent on hitting a code path where the join didn't return a
  matching user/facility row); it is not reproducible against the current local stack.

No other unintended differences were found across the three patients and six cards.

## Timing (local laptop, not production)

Three loads each, `DASH-SYN-01` (pid 14 / same puuid), same machine, same browser
engine (headless Chromium via Playwright), back-to-back in one script run so caches
are warm for both sides equally.

| Measure | Runs (ms) | Median | Range |
|---|---|---|---|
| Legacy: full page, network-idle | 3352, 3103, 3200 | 3200 ms | 3103–3352 ms |
| Port: header visible | 2557, 2654, 2154 | 2557 ms | 2154–2654 ms |
| Port: all 7 sections settled (header + 6 cards, every card past `loading`) | 4157, 4287, 4521 | 4287 ms | 4157–4521 ms |

The port's header appears faster than the legacy page reaches network-idle (single
`GET /api/patient/:puuid` call vs. the legacy page's full tabbed-shell asset load).
All-sections-settled is slower than header-visible alone, because the six cards fan
out in parallel behind the header but each waits on its own upstream call chain
(worst case here: Care Team's `patient read -> FHIR CareTeam search -> Practitioner
read (404) -> Organization read`, four sequential upstream calls for one card). Both
numbers are in the same ballpark as the legacy's 3.3-5.2 s network-idle baseline
noted in the arc (catalog 7.08); this run's legacy figure (3.1-3.4 s) sits at the fast
end of that range.

## Files

- `legacy-dash-syn-01.png`, `port-dash-syn-01.png`
- `legacy-dash-syn-02.png`, `port-dash-syn-02.png`
- `legacy-pid-3.png`, `port-pid-3.png`
- `capture-data.json` — per-card state/row-count/header-text data and the raw timing
  arrays behind the tables above.
