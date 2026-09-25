# Modules layer — the API behind the port (Phase 3 catalog)

These modules serve every REST/FHIR call the new dashboard will make.
Request-to-row flow is in [`DATA-FLOW.md`](DATA-FLOW.md). Counts are provisional
and per analysis; duplicates are merged in Phase 7.

## Catalog

| Module | Analysis | Serves | Tier | C / H / M / L |
|---|---|---|---|---|
| OAuth2/OIDC server | [AUTHORIZATION-CONTROLLER](AUTHORIZATION-CONTROLLER.md) | registration, login, patient picker, token, logout (DB-01) | 3 | 0 / 2 / 5 / 11 |
| CORS | [CORS-LISTENER](CORS-LISTENER.md) | headers on `/apis`, `/oauth2` | 3 | 0 / 1 / 0 / 5 |
| API pipeline + in-scope routes | [API-ROUTES](API-ROUTES.md) | auth → route → scope → ACL → handler | 3 | 0 / 1 / 6 / 7 |
| Medications + prescriptions | [MEDICATION-SERVICES](MEDICATION-SERVICES.md) | `/api/patient/:pid/medication`, `/api/prescription`, FHIR `MedicationRequest` (DB-05, DB-06) | 3 (re-run, scoped) | 0 / 2 / 9 / 7 |
| Patient | [PATIENT-SERVICES](PATIENT-SERVICES.md) | FHIR `Patient`, `/api/patient` (DB-02) | 2 | 0 / 0 / 3 / 4 |
| Allergies | [ALLERGY-SERVICES](ALLERGY-SERVICES.md) | `/api/patient/:puuid/allergy`, FHIR `AllergyIntolerance` (DB-03) | 2 | 0 / 0 / 5 / 3 |
| Conditions | [CONDITION-SERVICES](CONDITION-SERVICES.md) | `/api/patient/:puuid/medical_problem`, FHIR `Condition` (DB-04) | 2 | 0 / 2 / 6 / 3 |
| Care team | [CARE-TEAM-SERVICES](CARE-TEAM-SERVICES.md) | FHIR `CareTeam` (DB-07) | 2 | 0 / 2 / 1 / 3 |
| Vitals | [VITALS-SERVICES](VITALS-SERVICES.md) | FHIR `Observation` vital-signs; REST per-encounter vitals (DB-08) | 2 | 0 / 1 / 2 / 2 |
| Legacy router + lists | [LEGACY-ROUTER-AND-LISTS](LEGACY-ROUTER-AND-LISTS.md) | `controller.php`, issue lists (not on the port path) | 2 | 0 / 1 / 2 / 5 |

**Totals (before dedup):** 0 Critical, 12 High, 39 Medium, 50 Low. The allergy
auditor's provisional High was downgraded to Medium on tier-3 review
(invalid-data robustness only).

## Verified High findings (tier 3)

| # | Finding | Evidence | Port impact |
|---|---|---|---|
| M-1 | **Authenticated SQL injection** via query-parameter *names* on `GET /api/prescription` (no key allow-list) | `PrescriptionService.php:56-77`, `FhirSearchWhereClauseBuilder.php:33-45`, `SearchFieldStatementResolver.php:289-293` | Port sends only fixed keys; catalog + upstream report (David's call) |
| M-2 | **Public OAuth clients can't get `user/` scopes**, so a public SPA can't call any `/api/*` route; it gets FHIR with `patient/` scopes, one patient per authorization | `AuthorizationController.php:324-330`, `BearerTokenAuthorizationStrategy.php:373` | **Architecture decision A vs B** (see checkpoint) |
| M-3 | CORS preflight always 404s (route listener runs before CORS), so a cross-origin SPA can't send `Authorization` | `CORSListener.php:20,36-40`, `RoutesExtensionListener.php:28`; **confirmed live**: `OPTIONS` → 404 | Serve the SPA same-origin (dev proxy / BFF) |
| M-4 | Confidential client not authenticated at `/token` when `client_secret` is omitted | `ClientRepository.php:185-221` | Catalog; relevant if option B |
| M-5 | FHIR vitals has **no deleted filter**: the deleted set is served as current | `VitalsService::search()` (joins `forms` by `formdir`, no `deleted`); `FhirObservationVitalsService.php:441` | Decision 2 is only implementable via REST per-encounter vitals (filters `deleted=0`, `VitalsService.php:448`) |
| M-6 | FHIR `CareTeam` exposes inactive members like active ones, with no status field | `FhirCareTeamService.php:345` (only `period.start`) vs `CareTeamService.php:177,215` | Unavoidable parity break for DB-07 |
| M-7 | `refills` never selected: FHIR `numberOfRepeatsAllowed` is always **0** (wrong, not missing); REST omits it | `PrescriptionService.php:95-188`, `FhirMedicationRequestService.php:319` | Refills: "not available via API" |
| M-8 | FHIR `Condition` drops the coded diagnosis; `clinical-status` search param targets a non-existent column | `FhirConditionProblemListItemService.php:129-181` | Card shows the title only: no parity impact; don't use `clinical-status` |
| M-9 | 7 of 10 `controller.php` controllers (incl. `patient_finder`, insurance, pharmacy) have no ACL check | `Controller.class.php:131-144`; 0 ACL calls in each `C_*.class.php` | Not on the port path; Phase 6 live check |

Also verified: `/api/patient/:puuid/medical_problem` requires `encounters/notes`
(Allergies and Rx require `patients/med`); API errors return raw exception text,
including SQL (every route); validation errors come back as HTTP 200 or empty
bundles (the SPA must not render them as "Nothing Recorded"); auth codes aren't
single-use; logout revokes no tokens.

## Per-card data source by client model

| Card | A: public SPA (FHIR, `patient/` scopes) | B: BFF (confidential; FHIR + REST) |
|---|---|---|
| Header | FHIR `Patient` ✅ | FHIR `Patient` ✅ |
| Allergies | FHIR: severity coarsened; no raw "(1)"; `clinicalStatus` ≠ PHP rule ⚠️ | REST `/api/patient/:puuid/allergy` + client `filterActiveIssues` ✅ |
| Medical Problems | FHIR `Condition` + client filter on abatement ⚠️ | REST `/api/patient/:puuid/medical_problem` + client filter ✅ |
| Medications | ❌ not separable from Rx in FHIR | REST `/api/patient/:pid/medication` + client filter ✅ |
| Prescriptions | FHIR `MedicationRequest`: mixed with meds, refills=0, no numeric dosage ⚠️ | REST `/api/prescription?pid=&source_table=prescriptions`, client sort ✅ (no refills/form) |
| Care Team | FHIR `CareTeam` ⚠️ (inactive members shown) | same ⚠️ |
| Vitals | FHIR: **deleted set shown** ❌ (breaks decision 2) | REST per-encounter vitals ✅ |
