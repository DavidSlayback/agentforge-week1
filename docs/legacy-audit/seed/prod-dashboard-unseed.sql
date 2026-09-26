-- Removes exactly the rows added by prod-dashboard-seed.sql (patients with pubpid 'DASH-SYN-%').
START TRANSACTION;
CREATE TEMPORARY TABLE dash_pids AS SELECT pid FROM patient_data WHERE pubpid LIKE 'DASH-SYN-%';
DELETE m FROM care_team_member m JOIN care_teams t ON t.id = m.care_team_id WHERE t.pid IN (SELECT pid FROM dash_pids);
DELETE FROM care_teams WHERE pid IN (SELECT pid FROM dash_pids);
DELETE v FROM form_vitals v WHERE v.pid IN (SELECT pid FROM dash_pids);
DELETE FROM forms WHERE pid IN (SELECT pid FROM dash_pids);
DELETE FROM form_encounter WHERE pid IN (SELECT pid FROM dash_pids);
DELETE FROM prescriptions WHERE patient_id IN (SELECT pid FROM dash_pids);
DELETE FROM lists WHERE pid IN (SELECT pid FROM dash_pids);
DELETE FROM patient_data WHERE pid IN (SELECT pid FROM dash_pids);
DROP TEMPORARY TABLE dash_pids;
COMMIT;
SELECT COUNT(*) AS dash_patients_left FROM patient_data WHERE pubpid LIKE 'DASH-SYN-%';
