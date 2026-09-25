# Recon — AgentForge (OpenEMR, for the patient dashboard port)

Everything here came from *looking*: running the app, reading the README,
looking over the file tree. No source code has been read yet. Each fact says
who observed it: **[David]** or **[agent]**.

_Status: in progress. Waiting on David's run-through of the patient
dashboard with synthetic data (discovery guide item 10)._

## What it is

OpenEMR is an open-source electronic health record system, built in PHP
since 2001. This repo is the Gauntlet `openemr-base-clean` fork plus the
AgentForge Co-Pilot work. The W2 surprise challenge ports **the patient
dashboard** (a PHP, server-rendered page) to a modern framework that uses
only the existing REST/FHIR API. **[agent, from the README and brief]**

## Provenance

| Field | Value |
|---|---|
| Upstream | `Gauntlet-HQ/openemr-base-clean` @ `ef3d4909` **[agent]** |
| License | GPL-3 (OpenEMR) **[agent]** |
| Maintainer | OpenEMR community upstream; this fork is David's |

## Vital signs **[agent, from INVENTORY.md with exclusions]**

| Metric | Value |
|---|---|
| Lines (excluding docs, data dumps, generated code) | ~1.0M |
| Largest areas | `interface` 300K, `src` 179K, `tests` 134K, `library` 117K |
| Dashboard page | `interface/patient_file/summary/demographics.php` + ~30 fragment files |
| FHIR controllers for the required cards | Patient, AllergyIntolerance, Condition, Medication/MedicationRequest, CareTeam all exist |
| Existing tests | AgentForge 103/103, evals 10/10, W2 eval gate pass; PHP checks pending |

## Run-through

- **How it was run:** David, locally on Docker Desktop (`docker/development-easy-light`). **[David]**
- **Login and session:** a pop-up asks for an email address. It's unclear
  what it's for or whether the session is remembered. Probably OpenEMR's
  product-registration prompt; to confirm. **[David]**
- **Performance:** loading is slow in general. **[David]**
- **Navigation:** the endless tab pop-ups are unpleasant. It's also not
  clear how the different parts authenticate (OpenEMR login vs API vs
  AgentForge service). **[David]**
- **Data entry:** the highlighting of form fields is painful during data
  entry. Many fields have no validation, for example SSN. **[David]**
- **Center of gravity:** _pending_. Expected to be the patient
  chart/dashboard; confirm in the run-through.
- **Patient dashboard:** _pending_. Needs a data-rich synthetic patient.

## Observed red flags

- **No input validation on sensitive identifiers (SSN).** A data-quality
  and security concern for the catalog. The dashboard port is read-only,
  so it doesn't change this. **[David]**
- **Auth model is unclear to a user.** Several login and session
  mechanisms with no explanation. This matters directly for DB-01
  (OAuth2/OIDC) and for parity of who can see what. **[David]**
- **Slow page loads.** A baseline for the port to beat; worth measuring
  before and after on the dashboard. **[David]**

## Relevance to the port

| Observation | In scope for the dashboard port? |
|---|---|
| Slow loading | **Yes, as a measure.** Record dashboard load time now as the "before" number for `PATIENT_DASHBOARD_MIGRATION.md`. |
| Unclear auth | **Yes.** DB-01 must make the login flow explicit, and the audit must map the dashboard's ACL checks. |
| Email pop-up | Only if it appears in the OAuth2 login flow. |
| Tab pop-ups, form highlighting, SSN validation | **No.** The brief says reimplement, not redesign, and these are outside the dashboard. They go to the catalog and side quests. |

## Constraints

- There's no Docker daemon in the cloud container, so every live-app
  observation comes from David's laptop. **[agent]**

## Project manifest

`composer.json` (PHP) and `package.json` (JS build). The AgentForge
service has its own `agentforge/package.json`. The dashboard entry point
is `interface/patient_file/summary/demographics.php`. **[agent]**
