-- Phase 1 synthetic seed for DB-07 (Care Team) and DB-08 (Patient Notes / Messages).
-- LOCAL DEV STACK ONLY (docker/development-easy-light). Synthetic data only.
-- Approved by David at the Phase 0 checkpoint, 2026-09-25.
--
-- Target: pid 13 (the Phase 0 probe patient). pid 3 stays empty (empty-state patient).
-- Every row carries the marker "[seed:phase1]" so phase1-unseed.sql removes exactly these rows.
-- Includes deliberate filter cases: one inactive care-team member, one inactive note
-- (activity=0) and one deleted note (deleted=1), so parity tests can check what each
-- card and API endpoint hides.
--
-- Run: docker exec -i agentforge-week1-mysql-1 sh -c 'mariadb -uroot -p"$MYSQL_ROOT_PASSWORD" openemr' < phase1-seed.sql

START TRANSACTION;

-- Refuse to double-seed.
SET @already := (SELECT COUNT(*) FROM care_teams WHERE team_name LIKE '%[seed:phase1]%');
SELECT IF(@already > 0, 'ALREADY SEEDED - run phase1-unseed.sql first', 'seeding') AS seed_status;

INSERT INTO care_teams (uuid, pid, status, team_name, note, created_by, updated_by)
SELECT UNHEX(REPLACE(UUID(), '-', '')), 13, 'active', 'Primary care team [seed:phase1]',
       'Synthetic care team for dashboard parity tests [seed:phase1]', 1, 1
FROM DUAL WHERE @already = 0;
SET @team := LAST_INSERT_ID();

INSERT INTO care_team_member (care_team_id, user_id, contact_id, role, facility_id, provider_since, status, created_by, updated_by, note)
SELECT @team, 6, NULL, 'primary_care_provider', 3, '2019-04-01', 'active',   1, 1, 'PCP [seed:phase1]'      FROM DUAL WHERE @already = 0
UNION ALL
SELECT @team, 5, NULL, 'nurse',                 3, '2021-09-15', 'active',   1, 1, 'Nurse [seed:phase1]'    FROM DUAL WHERE @already = 0
UNION ALL
SELECT @team, 10, NULL, 'specialist',           NULL, '2016-02-01', 'inactive', 1, 1, 'Former specialist [seed:phase1]' FROM DUAL WHERE @already = 0;

-- Body format mirrors OpenEMR's addPnote(): "<Y-m-d H:i> (<user> to <assigned_to>) <text>".
INSERT INTO pnotes (date, body, pid, user, groupname, activity, authorized, title, assigned_to, deleted, message_status)
SELECT '2026-09-20 09:15:00', '2026-09-20 09:15 (admin to physician) Patient asked about aspirin allergy wording on the portal. [seed:phase1]', 13, 'admin', 'Default', 1, 1, 'Chart Note',   'physician', 0, 'New'  FROM DUAL WHERE @already = 0
UNION ALL
SELECT '2026-09-22 14:40:00', '2026-09-22 14:40 (clinician to physician) Refill request for amlodipine; last filled 2020. [seed:phase1]', 13, 'clinician', 'Default', 1, 1, 'Pharmacy',  'physician', 0, 'Read' FROM DUAL WHERE @already = 0
UNION ALL
SELECT '2026-09-24 08:05:00', '2026-09-24 08:05 (physician to clinician) Schedule HbA1c recheck (prediabetes). [seed:phase1]', 13, 'physician', 'Default', 1, 1, 'Test Scheduling', 'clinician', 0, 'Done' FROM DUAL WHERE @already = 0
UNION ALL
SELECT '2026-09-10 11:00:00', '2026-09-10 11:00 (admin to admin) INACTIVE note, should be hidden where inactive notes are hidden. [seed:phase1]', 13, 'admin', 'Default', 0, 1, 'Other',       'admin', 0, 'Done' FROM DUAL WHERE @already = 0
UNION ALL
SELECT '2026-09-11 11:00:00', '2026-09-11 11:00 (admin to admin) DELETED note, should never be shown. [seed:phase1]', 13, 'admin', 'Default', 1, 1, 'Other',       'admin', 1, 'New'  FROM DUAL WHERE @already = 0;

COMMIT;

SELECT (SELECT COUNT(*) FROM care_teams WHERE team_name LIKE '%[seed:phase1]%') AS teams,
       (SELECT COUNT(*) FROM care_team_member WHERE note LIKE '%[seed:phase1]%') AS members,
       (SELECT COUNT(*) FROM pnotes WHERE body LIKE '%[seed:phase1]%') AS notes;
