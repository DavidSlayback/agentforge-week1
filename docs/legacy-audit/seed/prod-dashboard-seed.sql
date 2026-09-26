-- Dashboard test data for the PUBLIC deploy (and testable locally). Synthetic data only.
-- Approved by David 2026-09-25 ("yes yes yes": synthetic, marked, removable production test data).
--
-- Adds two NEW dedicated patients so AgentForge's own fixtures (pubpid AF-SYN-*) are untouched:
--   DASH-SYN-01  data-rich: allergies, problems, medications, prescriptions, 3 encounters with vitals
--                (one vitals set soft-deleted), one care team with the admin user as active member
--   DASH-SYN-02  deceased (deceased_date set), a single allergy
-- Empty-state patient on production: existing pid 1 (no clinical rows).
-- Filter cases: an allergy with outcome=1 (resolved), a problem and a medication with a past enddate,
-- a prescription with active=0, a soft-deleted vitals set newer than the visible ones.
-- Marker: pubpid 'DASH-SYN-%' plus '[seed:dashboard]' in comments/notes. Remove with prod-dashboard-unseed.sql.

START TRANSACTION;

SET @already := (SELECT COUNT(*) FROM patient_data WHERE pubpid LIKE 'DASH-SYN-%');
SELECT IF(@already > 0, 'ALREADY SEEDED - run prod-dashboard-unseed.sql first', 'seeding dashboard test data') AS seed_status;

SET @pidA := (SELECT COALESCE(MAX(pid), 0) + 1 FROM patient_data);
SET @pidB := @pidA + 1;
SET @user := (SELECT id FROM users WHERE username = 'admin' LIMIT 1);
SET @fac  := (SELECT id FROM facility ORDER BY id LIMIT 1);

INSERT INTO patient_data (uuid, pid, pubpid, fname, lname, DOB, sex, date, regdate, providerID)
SELECT UNHEX(REPLACE(UUID(),'-','')), @pidA, 'DASH-SYN-01', 'Dana', 'Seedcase', '1970-04-12', 'Female', NOW(), '2020-01-15', @user FROM DUAL WHERE @already = 0;
INSERT INTO patient_data (uuid, pid, pubpid, fname, lname, DOB, sex, date, regdate, providerID, deceased_date, deceased_reason)
SELECT UNHEX(REPLACE(UUID(),'-','')), @pidB, 'DASH-SYN-02', 'Morgan', 'Seedcase', '1948-09-01', 'Male', NOW(), '2019-06-01', @user, '2026-08-30 14:00:00', '[seed:dashboard]' FROM DUAL WHERE @already = 0;

-- Allergies are authored by NO user (user NULL): OpenEMR's AllergyIntoleranceService returns the author's
-- raw binary uuid, which breaks JSON encoding (HTTP 500) when a user is set. See BUGS-MITIGATIONS 5.29 / evidence/parity/README.md.
-- Allergies (A): one active severe, one resolved (outcome=1, hidden by the card). (B): one.
INSERT INTO lists (uuid, date, type, title, begdate, enddate, outcome, severity_al, reaction, activity, pid, user, comments)
SELECT UNHEX(REPLACE(UUID(),'-','')), NOW(), 'allergy', 'Penicillin', '2001-05-01', NULL, 0, 'severe', 'hives', 1, @pidA, NULL, '[seed:dashboard]' FROM DUAL WHERE @already = 0
UNION ALL SELECT UNHEX(REPLACE(UUID(),'-','')), NOW(), 'allergy', 'Latex', '2010-03-01', NULL, 1, 'mild', '', 1, @pidA, NULL, 'resolved [seed:dashboard]' FROM DUAL WHERE @already = 0
UNION ALL SELECT UNHEX(REPLACE(UUID(),'-','')), NOW(), 'allergy', 'Sulfa drugs', '1990-01-01', NULL, 0, 'moderate', '', 1, @pidB, NULL, '[seed:dashboard]' FROM DUAL WHERE @already = 0;

-- Problems (A): two open, one ended (hidden by the card).
INSERT INTO lists (uuid, date, type, title, begdate, enddate, outcome, activity, pid, user, comments)
SELECT UNHEX(REPLACE(UUID(),'-','')), NOW(), 'medical_problem', 'Essential hypertension', '2015-02-10', NULL, 0, 1, @pidA, 'admin', '[seed:dashboard]' FROM DUAL WHERE @already = 0
UNION ALL SELECT UNHEX(REPLACE(UUID(),'-','')), NOW(), 'medical_problem', 'Prediabetes', '2019-08-20', NULL, 0, 1, @pidA, 'admin', '[seed:dashboard]' FROM DUAL WHERE @already = 0
UNION ALL SELECT UNHEX(REPLACE(UUID(),'-','')), NOW(), 'medical_problem', 'Acute bronchitis', '2022-01-05', '2022-02-01', 0, 1, @pidA, 'admin', 'ended [seed:dashboard]' FROM DUAL WHERE @already = 0;

-- Medications (A): one current, one ended (hidden by the card).
INSERT INTO lists (uuid, date, type, title, begdate, enddate, outcome, activity, pid, user, comments)
SELECT UNHEX(REPLACE(UUID(),'-','')), NOW(), 'medication', 'Lisinopril 10 MG Oral Tablet', '2015-02-10', NULL, 0, 1, @pidA, 'admin', '[seed:dashboard]' FROM DUAL WHERE @already = 0
UNION ALL SELECT UNHEX(REPLACE(UUID(),'-','')), NOW(), 'medication', 'Amoxicillin 500 MG Oral Capsule', '2022-01-05', '2022-01-15', 0, 1, @pidA, 'admin', 'ended [seed:dashboard]' FROM DUAL WHERE @already = 0;

-- Prescriptions (A): three, one inactive (the card shows all rows; sort active DESC, date_modified DESC, date_added DESC).
INSERT INTO prescriptions (uuid, patient_id, provider_id, drug, dosage, quantity, size, unit, refills, active, date_added, date_modified, start_date, txDate, usage_category_title, request_intent_title, note)
SELECT UNHEX(REPLACE(UUID(),'-','')), @pidA, @user, 'Lisinopril 10 MG Oral Tablet', '1', '90', '10', '1', 3, 1, '2025-11-02 09:00:00', '2025-11-02', '2025-11-02', '2025-11-02', '', '', '[seed:dashboard]' FROM DUAL WHERE @already = 0
UNION ALL SELECT UNHEX(REPLACE(UUID(),'-','')), @pidA, @user, 'Metformin 500 MG Oral Tablet', '1', '60', '500', '1', 1, 1, '2026-03-14 10:30:00', '2026-03-14', '2026-03-14', '2026-03-14', '', '', '[seed:dashboard]' FROM DUAL WHERE @already = 0
UNION ALL SELECT UNHEX(REPLACE(UUID(),'-','')), @pidA, @user, 'Amoxicillin 500 MG Oral Capsule', '1', '21', '500', '1', 0, 0, '2022-01-05 08:15:00', '2022-01-05', '2022-01-05', '2022-01-05', '', '', 'inactive [seed:dashboard]' FROM DUAL WHERE @already = 0;

-- Encounters (A) for vitals.
SET @e1 := (SELECT COALESCE(MAX(encounter), 0) + 1 FROM form_encounter);
SET @e2 := @e1 + 1; SET @e3 := @e1 + 2;
INSERT INTO form_encounter (uuid, date, reason, facility, facility_id, pid, encounter, provider_id, pc_catid)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2024-03-24 09:00:00', 'Annual exam [seed:dashboard]', '', @fac, @pidA, @e1, @user, 5 FROM DUAL WHERE @already = 0
UNION ALL SELECT UNHEX(REPLACE(UUID(),'-','')), '2025-03-30 09:00:00', 'Annual exam [seed:dashboard]', '', @fac, @pidA, @e2, @user, 5 FROM DUAL WHERE @already = 0
UNION ALL SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-04-05 09:00:00', 'Follow-up [seed:dashboard]', '', @fac, @pidA, @e3, @user, 5 FROM DUAL WHERE @already = 0;
INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir)
SELECT '2024-03-24 09:00:00', @e1, 'New Patient Encounter', 0, @pidA, 'admin', 'Default', 1, 0, 'newpatient' FROM DUAL WHERE @already = 0
UNION ALL SELECT '2025-03-30 09:00:00', @e2, 'New Patient Encounter', 0, @pidA, 'admin', 'Default', 1, 0, 'newpatient' FROM DUAL WHERE @already = 0
UNION ALL SELECT '2026-04-05 09:00:00', @e3, 'New Patient Encounter', 0, @pidA, 'admin', 'Default', 1, 0, 'newpatient' FROM DUAL WHERE @already = 0;

-- Vitals (A): three visible sets, plus a newer soft-deleted set on the latest encounter (must be hidden).
INSERT INTO form_vitals (uuid, date, pid, user, groupname, authorized, activity, bps, bpd, height, weight, temperature, temp_method, pulse, respiration, note, BMI, BMI_status, oxygen_saturation)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2024-03-24 09:10:00', @pidA, 'admin', 'Default', 1, 1, '142', '90', 65.0, 190.0, 98.4, 'Oral', 80, 16, '[seed:dashboard]', 31.6, 'Obesity', 97 FROM DUAL WHERE @already = 0;
SET @v1 := LAST_INSERT_ID();
INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir) SELECT '2024-03-24 09:10:00', @e1, 'Vitals', @v1, @pidA, 'admin', 'Default', 1, 0, 'vitals' FROM DUAL WHERE @already = 0;
INSERT INTO form_vitals (uuid, date, pid, user, groupname, authorized, activity, bps, bpd, height, weight, temperature, temp_method, pulse, respiration, note, BMI, BMI_status, oxygen_saturation)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2025-03-30 09:10:00', @pidA, 'admin', 'Default', 1, 1, '136', '86', 65.0, 184.5, 98.6, 'Oral', 76, 16, '[seed:dashboard]', 30.7, 'Obesity', 98 FROM DUAL WHERE @already = 0;
SET @v2 := LAST_INSERT_ID();
INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir) SELECT '2025-03-30 09:10:00', @e2, 'Vitals', @v2, @pidA, 'admin', 'Default', 1, 0, 'vitals' FROM DUAL WHERE @already = 0;
INSERT INTO form_vitals (uuid, date, pid, user, groupname, authorized, activity, bps, bpd, height, weight, temperature, temp_method, pulse, respiration, note, BMI, BMI_status, oxygen_saturation)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-04-05 09:10:00', @pidA, 'admin', 'Default', 1, 1, '128', '82', 65.0, 176.0, 98.2, 'Oral', 72, 14, '[seed:dashboard]', 29.3, 'Overweight', 98 FROM DUAL WHERE @already = 0;
SET @v3 := LAST_INSERT_ID();
INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir) SELECT '2026-04-05 09:10:00', @e3, 'Vitals', @v3, @pidA, 'admin', 'Default', 1, 0, 'vitals' FROM DUAL WHERE @already = 0;
INSERT INTO form_vitals (uuid, date, pid, user, groupname, authorized, activity, bps, bpd, height, weight, temperature, temp_method, pulse, respiration, note, BMI, BMI_status, oxygen_saturation)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-05-01 09:00:00', @pidA, 'admin', 'Default', 1, 1, '190', '120', 65.0, 150.0, 101.0, 'Oral', 130, 30, 'DELETED vitals, must be hidden [seed:dashboard]', 25.0, 'Normal', 88 FROM DUAL WHERE @already = 0;
SET @v4 := LAST_INSERT_ID();
INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir) SELECT '2026-05-01 09:00:00', @e3, 'Vitals', @v4, @pidA, 'admin', 'Default', 1, 1, 'vitals' FROM DUAL WHERE @already = 0;

-- Care team (A): one active team, the admin user as active primary care provider (production has one user).
INSERT INTO care_teams (uuid, pid, status, team_name, note, created_by, updated_by)
SELECT UNHEX(REPLACE(UUID(),'-','')), @pidA, 'active', 'Primary care team [seed:dashboard]', '[seed:dashboard]', @user, @user FROM DUAL WHERE @already = 0;
SET @team := LAST_INSERT_ID();
INSERT INTO care_team_member (care_team_id, user_id, role, facility_id, provider_since, status, created_by, updated_by, note)
SELECT @team, @user, 'primary_care_provider', @fac, '2020-01-15', 'active', @user, @user, '[seed:dashboard]' FROM DUAL WHERE @already = 0;

COMMIT;

SELECT pid, pubpid, deceased_date IS NOT NULL AS deceased FROM patient_data WHERE pubpid LIKE 'DASH-SYN-%';
