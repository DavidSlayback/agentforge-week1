-- AgentForge live-chart demo patient (slice E9). Synthetic data only.
--
-- Seeds ONE patient, pubpid 'AF-LIVE-01', printed as "Test Patient One", DOB 1980-04-12,
-- mirroring the fixture-patient-001 "complete_return_visit" case in
-- docs/agentforge/fixtures/clinical-cases.json, so OpenEMRRestAdapter (agentforge/src/openemrAdapter.js)
-- reads real rows from the standard REST API:
--   problem     Hypertension (active, begdate 2026-08-13)
--   medications Lisinopril 5 mg daily (2026-08-13, ended 2026-09-10), Lisinopril 10 mg daily (2026-09-10, current)
--   allergy     Penicillin, reaction hives
--   encounters  2026-08-13 hypertension evaluation; 2026-09-10 blood-pressure follow-up
--
-- Marker: pubpid 'AF-LIVE-01' plus '[seed:af-live]' in lists.comments and form_encounter.billing_note.
-- The marker is kept out of the columns the adapter maps (title, reason, reaction), so chart facts stay clean.
-- Idempotent: a second run is a no-op. Remove with agentforge-live-chart-unseed.sql.
-- Pattern: docs/legacy-audit/seed/prod-dashboard-seed.sql.

START TRANSACTION;

SET @already := (SELECT COUNT(*) FROM patient_data WHERE pubpid = 'AF-LIVE-01');
SELECT IF(@already > 0, 'ALREADY SEEDED - no changes (run agentforge-live-chart-unseed.sql to reset)', 'seeding AF-LIVE-01') AS seed_status;

SET @pid  := (SELECT COALESCE(MAX(pid), 0) + 1 FROM patient_data);
SET @user := (SELECT id FROM users WHERE username = 'admin' LIMIT 1);
SET @fac  := (SELECT id FROM facility ORDER BY id LIMIT 1);
SET @facname := COALESCE((SELECT name FROM facility WHERE id = @fac), '');

INSERT INTO patient_data (uuid, pid, pubpid, fname, mname, lname, DOB, sex, date, regdate, providerID)
SELECT UNHEX(REPLACE(UUID(),'-','')), @pid, 'AF-LIVE-01', 'Test', '', 'Patient One', '1980-04-12', 'Female', NOW(), '2026-08-13', @user
FROM DUAL WHERE @already = 0;

-- Problem. lists.date is what the adapter reports as recorded_at, so it carries the clinical date.
INSERT INTO lists (uuid, date, type, title, begdate, enddate, outcome, activity, pid, user, comments)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-08-13 09:00:00', 'medical_problem', 'Hypertension', '2026-08-13', NULL, 0, 1, @pid, 'admin', 'reassessed at 2026-09-10 follow-up [seed:af-live]'
FROM DUAL WHERE @already = 0;

-- Medications: dose change 5 mg -> 10 mg on 2026-09-10. Title stays 'Lisinopril' so both rows map to the
-- same adapter field (medication.lisinopril.*); the dose is in comments (lists has no dose column).
INSERT INTO lists (uuid, date, type, title, begdate, enddate, outcome, activity, pid, user, comments)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-08-13 09:05:00', 'medication', 'Lisinopril', '2026-08-13', '2026-09-10', 0, 1, @pid, 'admin', '5 mg daily [seed:af-live]' FROM DUAL WHERE @already = 0
UNION ALL
SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-09-10 09:05:00', 'medication', 'Lisinopril', '2026-09-10', NULL, 0, 1, @pid, 'admin', '10 mg daily [seed:af-live]' FROM DUAL WHERE @already = 0;

-- Allergy authored by NO user (user NULL): AllergyIntoleranceService returns the author's raw binary uuid,
-- which breaks JSON encoding (HTTP 500) when a user is set. See docs/legacy-audit/BUGS-MITIGATIONS.md 5.29.
INSERT INTO lists (uuid, date, type, title, begdate, enddate, outcome, severity_al, reaction, activity, pid, user, comments)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-08-13 09:02:00', 'allergy', 'Penicillin', '2001-05-01', NULL, 0, 'moderate', 'hives', 1, @pid, NULL, '[seed:af-live]'
FROM DUAL WHERE @already = 0;

-- Encounters. Numbers come from above both form_encounter and the `sequences` counter that OpenEMR's
-- generate_id() uses for new encounters, and the counter is advanced past them, so a later
-- UI-created encounter can never reuse a seeded number. (The counter only moves forward; unseed leaves it.)
SET @e1 := GREATEST((SELECT COALESCE(MAX(encounter), 0) FROM form_encounter), (SELECT COALESCE(MAX(id), 0) FROM sequences)) + 1;
SET @e2 := @e1 + 1;
INSERT INTO form_encounter (uuid, date, reason, facility, facility_id, billing_facility, pid, encounter, provider_id, pc_catid, class_code, billing_note)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-08-13 09:00:00', 'hypertension evaluation; lisinopril started', @facname, @fac, @fac, @pid, @e1, @user, 5, 'AMB', '[seed:af-live]' FROM DUAL WHERE @already = 0
UNION ALL
SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-09-10 09:10:00', 'blood-pressure follow-up', @facname, @fac, @fac, @pid, @e2, @user, 9, 'AMB', '[seed:af-live]' FROM DUAL WHERE @already = 0;
UPDATE sequences SET id = @e2 WHERE @already = 0 AND id < @e2;

-- 'newpatient' forms rows so the encounters show in the OpenEMR UI (the REST route does not need them).
INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir)
SELECT '2026-08-13 09:00:00', @e1, 'New Patient Encounter', 0, @pid, 'admin', 'Default', 1, 0, 'newpatient' FROM DUAL WHERE @already = 0
UNION ALL
SELECT '2026-09-10 09:10:00', @e2, 'New Patient Encounter', 0, @pid, 'admin', 'Default', 1, 0, 'newpatient' FROM DUAL WHERE @already = 0;

COMMIT;

-- The patient uuid: add it to AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS (openemr + agentforge-w2) so a launcher
-- session may upload for this patient. It is also the patient_ref the live chart path reads.
SELECT p.pid, p.pubpid, LOWER(INSERT(INSERT(INSERT(INSERT(HEX(p.uuid), 9, 0, '-'), 14, 0, '-'), 19, 0, '-'), 24, 0, '-')) AS patient_uuid,
       (SELECT COUNT(*) FROM lists l WHERE l.pid = p.pid AND l.comments LIKE '%[seed:af-live]%') AS seeded_list_rows,
       (SELECT COUNT(*) FROM form_encounter e WHERE e.pid = p.pid AND e.billing_note = '[seed:af-live]') AS seeded_encounters
FROM patient_data p WHERE p.pubpid = 'AF-LIVE-01';
