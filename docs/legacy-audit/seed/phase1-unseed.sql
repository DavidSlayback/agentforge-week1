-- Removes exactly the rows added by phase1-seed.sql (marker "[seed:phase1]"). Local dev stack only.
START TRANSACTION;
DELETE m FROM care_team_member m JOIN care_teams t ON t.id = m.care_team_id WHERE t.team_name LIKE '%[seed:phase1]%';
DELETE FROM care_teams WHERE team_name LIKE '%[seed:phase1]%';
DELETE FROM pnotes WHERE body LIKE '%[seed:phase1]%';
COMMIT;
SELECT (SELECT COUNT(*) FROM care_teams WHERE team_name LIKE '%[seed:phase1]%') AS teams_left,
       (SELECT COUNT(*) FROM pnotes WHERE body LIKE '%[seed:phase1]%') AS notes_left;
