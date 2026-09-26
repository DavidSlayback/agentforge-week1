# E9: real OpenEMR chart reads, observed on the public URL

- **Deployed W2 SHA:** `b942391f2ed3bcf024209221200462e04f258b0a` (`/agentforge-w2/health`). The session was on 2026-09-26, about 20:41–20:43 UTC.
- **Production setup (operator, 2026-09-26):**
  - Synthetic patient `AF-LIVE-01` seeded as pid 9 (`deploy/vultr/seed/agentforge-live-chart-seed.sql`; 4 list rows, 2 encounters).
  - `.env`: `AGENTFORGE_OPENEMR_LIVE_READS=on`, `AGENTFORGE_LIVE_PATIENT_UUIDS` set to that one patient, the patient appended to `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS`, `AGENTFORGE_SERVICE_URL` pointed at `/agentforge-w2`, and `AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED=true`. The approval applies only to designated patients.
  - OpenEMR recreated.
  - The module enabled in OpenEMR (`modules.mod_active` 0 → 1, mod_id 19). It had been installed on 2026-09-17 but never enabled, so the patient-menu item was missing.
  - `grader`'s ACLs were checked read-only first: Physicians group, `patients/{demo,med,docs,lab}` and `encounters/{notes,auth_a}` allowed with write.
- **The flow:** the owner signed in to OpenEMR as `grader`, opened Test Patient One (`AF-LIVE-01`), chose **Prepare for visit** from the patient menu, opened the launch link, and ran "Lab result · Layout A".
- **Server-side evidence** (`/v1/traces`, codes and counts only):
  - `visit_briefing` at 20:41:12Z: retrieval attempts with `adapter: openemr`.
  - `w2-scan-supervisor` at 20:42:24Z: `adapter: openemr`, `critic_status: reviewed`, 3 worker handoffs.
- **OpenEMR write ledger** (read-only SQL, pid 9): `doc:lab_pdf` (20:42:24), `lab` and `doc:derived_facts` (20:42:42), all `issuer = openemr-module`. So these were writes under the launched OpenEMR session, not the public demo token.
- **Adapter-level read, pre-checked in the W2 container** (service identity):
  - identity, encounters (2) and medications (2): success;
  - problems and allergies: `unverified_empty` (`openemr_scoped_list_empty`, see the OpenEMR 8.0.0 finding in `W2_ARCHITECTURE.md` §3f);
  - notes: failed (HTTP 500).
- **The public no-login demo** still shows "Chart source: synthetic fixture".
- Valid for `b942391f` only. The E7 freeze redeploys from one SHA.
