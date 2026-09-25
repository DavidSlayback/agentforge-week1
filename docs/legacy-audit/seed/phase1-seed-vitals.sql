-- Phase 2 synthetic vitals seed for DB-08 = Vitals. LOCAL DEV STACK ONLY. Synthetic data only.
-- Approved by David, 2026-09-25 ("go" after the Phase 1 checkpoint).
--
-- pid 13 has exactly one vitals set (2018). This adds three newer sets on pid 13's existing
-- 2024/2025/2026 encounters so "most recent" and a trend are testable, plus one set whose
-- forms row is soft-deleted (forms.deleted=1) to test that deleted vitals are hidden.
-- Values are US units (globals units_of_measurement = 1). Marker: form_vitals.note = '[seed:phase1]'.
-- Remove with phase1-unseed.sql.

START TRANSACTION;

SET @already := (SELECT COUNT(*) FROM form_vitals WHERE note LIKE '%[seed:phase1]%');
SELECT IF(@already > 0, 'ALREADY SEEDED - run phase1-unseed.sql first', 'seeding vitals') AS seed_status;

-- 2024-03-24, encounter 365
INSERT INTO form_vitals (uuid, date, pid, user, groupname, authorized, activity, bps, bpd, height, weight, temperature, temp_method, pulse, respiration, note, BMI, BMI_status, oxygen_saturation)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2024-03-24 20:06:27', 13, 'physician', 'Default', 1, 1, '138', '88', 67.0, 212.0, 98.4, 'Oral', 78, 16, '[seed:phase1]', 33.2, 'Obesity', 97 FROM DUAL WHERE @already = 0;
SET @v1 := LAST_INSERT_ID();
INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir)
SELECT '2024-03-24 20:06:27', 365, 'Vitals', @v1, 13, 'physician', 'Default', 1, 0, 'vitals' FROM DUAL WHERE @already = 0;

-- 2025-03-30, encounter 366
INSERT INTO form_vitals (uuid, date, pid, user, groupname, authorized, activity, bps, bpd, height, weight, temperature, temp_method, pulse, respiration, note, BMI, BMI_status, oxygen_saturation)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2025-03-30 20:06:27', 13, 'physician', 'Default', 1, 1, '134', '86', 67.0, 206.5, 98.6, 'Oral', 74, 16, '[seed:phase1]', 32.3, 'Obesity', 98 FROM DUAL WHERE @already = 0;
SET @v2 := LAST_INSERT_ID();
INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir)
SELECT '2025-03-30 20:06:27', 366, 'Vitals', @v2, 13, 'physician', 'Default', 1, 0, 'vitals' FROM DUAL WHERE @already = 0;

-- 2026-04-05, encounter 367 (should be "most recent")
INSERT INTO form_vitals (uuid, date, pid, user, groupname, authorized, activity, bps, bpd, height, weight, temperature, temp_method, pulse, respiration, note, BMI, BMI_status, oxygen_saturation)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-04-05 20:06:27', 13, 'clinician', 'Default', 1, 1, '128', '82', 67.0, 199.0, 98.2, 'Oral', 72, 14, '[seed:phase1]', 31.2, 'Obesity', 98 FROM DUAL WHERE @already = 0;
SET @v3 := LAST_INSERT_ID();
INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir)
SELECT '2026-04-05 20:06:27', 367, 'Vitals', @v3, 13, 'clinician', 'Default', 1, 0, 'vitals' FROM DUAL WHERE @already = 0;

-- 2026-05-01, encounter 367, forms row soft-DELETED: newer than the others but must be hidden.
INSERT INTO form_vitals (uuid, date, pid, user, groupname, authorized, activity, bps, bpd, height, weight, temperature, temp_method, pulse, respiration, note, BMI, BMI_status, oxygen_saturation)
SELECT UNHEX(REPLACE(UUID(),'-','')), '2026-05-01 09:00:00', 13, 'clinician', 'Default', 1, 1, '190', '120', 67.0, 150.0, 101.0, 'Oral', 130, 30, 'DELETED vitals, must be hidden [seed:phase1]', 23.5, 'Normal', 88 FROM DUAL WHERE @already = 0;
SET @v4 := LAST_INSERT_ID();
INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir)
SELECT '2026-05-01 09:00:00', 367, 'Vitals', @v4, 13, 'clinician', 'Default', 1, 1, 'vitals' FROM DUAL WHERE @already = 0;

COMMIT;

SELECT v.date, v.bps, v.bpd, v.weight, f.deleted FROM form_vitals v JOIN forms f ON f.form_id = v.id AND f.formdir = 'vitals'
WHERE v.note LIKE '%[seed:phase1]%' ORDER BY v.date;
