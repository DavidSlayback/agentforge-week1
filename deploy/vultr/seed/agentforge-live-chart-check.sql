-- Read-only check for agentforge-live-chart-seed.sql. SELECTs only; safe to run any time.

-- 1. The demo patient (0 rows = not seeded).
SELECT p.pid, p.pubpid, p.fname, p.mname, p.lname, p.DOB, p.sex,
       LOWER(INSERT(INSERT(INSERT(INSERT(HEX(p.uuid), 9, 0, '-'), 14, 0, '-'), 19, 0, '-'), 24, 0, '-')) AS patient_uuid
FROM patient_data p WHERE p.pubpid = 'AF-LIVE-01';

-- 2. Marked rows per table (all zero when unseeded). Expect 1 / 4 / 2 / 2 when seeded.
SELECT
  (SELECT COUNT(*) FROM patient_data WHERE pubpid = 'AF-LIVE-01') AS patients,
  (SELECT COUNT(*) FROM lists WHERE comments LIKE '%[seed:af-live]%') AS list_rows,
  (SELECT COUNT(*) FROM form_encounter WHERE billing_note = '[seed:af-live]') AS encounters,
  (SELECT COUNT(*) FROM forms f JOIN form_encounter e ON e.encounter = f.encounter AND e.pid = f.pid
     WHERE e.billing_note = '[seed:af-live]' AND f.formdir = 'newpatient') AS encounter_forms;

-- 3. The seeded clinical rows as the REST services will see them.
SELECT l.type, l.title, DATE_FORMAT(l.date, '%Y-%m-%d %H:%i') AS date, l.begdate, l.enddate, l.activity, l.outcome,
       l.reaction, l.user, l.comments, l.uuid IS NOT NULL AS has_uuid
FROM lists l JOIN patient_data p ON p.pid = l.pid
WHERE p.pubpid = 'AF-LIVE-01' ORDER BY l.type, l.date;

SELECT e.encounter, e.date, e.reason, e.facility_id, e.provider_id, e.pc_catid, e.billing_note, e.uuid IS NOT NULL AS has_uuid
FROM form_encounter e JOIN patient_data p ON p.pid = e.pid
WHERE p.pubpid = 'AF-LIVE-01' ORDER BY e.date;

-- 4. The launcher sends the signed-in user's users.uuid as clinician_uuid; a user without one cannot launch.
SELECT username, active, uuid IS NOT NULL AS has_uuid FROM users WHERE username IN ('admin', 'grader');

-- 5. Table totals, to compare before seed / after unseed (must match).
SELECT
  (SELECT COUNT(*) FROM patient_data) AS patient_data_total,
  (SELECT COUNT(*) FROM lists) AS lists_total,
  (SELECT COUNT(*) FROM form_encounter) AS form_encounter_total,
  (SELECT COUNT(*) FROM forms) AS forms_total,
  (SELECT MAX(id) FROM sequences) AS sequences_id;
