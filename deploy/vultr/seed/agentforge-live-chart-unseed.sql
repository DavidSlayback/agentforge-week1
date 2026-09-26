-- Removes exactly the rows added by agentforge-live-chart-seed.sql (patient pubpid 'AF-LIVE-01',
-- rows marked '[seed:af-live]'). Rows written for this patient by anything else (for example
-- oe-module-agentforge lists/documents/procedure orders, appointments, billing) are left alone, and
-- then the patient_data row is kept too so nothing is orphaned; the final SELECTs report which tables.
-- The `sequences` counter advanced by the seed is not rolled back (it only ever moves forward).

START TRANSACTION;

SET @pid := (SELECT pid FROM patient_data WHERE pubpid = 'AF-LIVE-01' LIMIT 1);

CREATE TEMPORARY TABLE af_live_enc AS
  SELECT encounter FROM form_encounter WHERE pid = @pid AND billing_note = '[seed:af-live]';

DELETE FROM forms
 WHERE pid = @pid AND formdir = 'newpatient' AND form_id = 0
   AND encounter IN (SELECT encounter FROM af_live_enc);
DELETE FROM form_encounter WHERE pid = @pid AND billing_note = '[seed:af-live]';
DELETE FROM lists WHERE pid = @pid AND comments LIKE '%[seed:af-live]%';

-- Every other row still linked to this pid, in ANY table with a pid, patient_id or pc_pid column
-- (appointments, billing, immunizations, issue_encounter, every form_* table, documents'
-- foreign_id, and anything added later), counted dynamically from information_schema. Append-only
-- audit logs (log, api_log, extended_log, *_log) are not counted. If any row remains, the
-- patient_data row is kept and the per-table counts are reported below. The pid is compared as a
-- string literal so varchar columns (openemr_postcalendar_events.pc_pid) do not fail strict mode.
SET @count_sql := (
  SELECT GROUP_CONCAT(CONCAT('SELECT ''', table_name, ''' AS table_name, COUNT(*) AS n FROM `', table_name, '` WHERE `', column_name, '` = ''', COALESCE(@pid, -1), '''') SEPARATOR ' UNION ALL ')
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND column_name IN ('pid', 'patient_id', 'pc_pid')
    AND table_name <> 'patient_data' AND table_name NOT IN ('log', 'api_log', 'extended_log') AND table_name NOT LIKE '%\_log'
);
SET @count_sql := CONCAT('CREATE TEMPORARY TABLE af_live_remaining AS SELECT table_name, n FROM (', @count_sql,
  ' UNION ALL SELECT ''documents'' AS table_name, COUNT(*) AS n FROM documents WHERE foreign_id = ''', COALESCE(@pid, -1), ''') t WHERE n > 0');
PREPARE af_live_count FROM @count_sql;
EXECUTE af_live_count;
DEALLOCATE PREPARE af_live_count;
SET @remaining := (SELECT COALESCE(SUM(n), 0) FROM af_live_remaining);

DELETE FROM patient_data WHERE pubpid = 'AF-LIVE-01' AND pid = @pid AND @remaining = 0;

DROP TEMPORARY TABLE af_live_enc;
COMMIT;

-- Tables still holding rows for this pid (empty when the patient was removed).
SELECT table_name, n AS rows_still_linked FROM af_live_remaining ORDER BY table_name;
DROP TEMPORARY TABLE af_live_remaining;

SELECT @pid AS af_live_pid,
       @remaining AS other_rows_still_referencing_pid,
       (SELECT COUNT(*) FROM patient_data WHERE pubpid = 'AF-LIVE-01') AS af_live_patients_left,
       (SELECT COUNT(*) FROM lists WHERE comments LIKE '%[seed:af-live]%') AS marked_lists_left,
       (SELECT COUNT(*) FROM form_encounter WHERE billing_note = '[seed:af-live]') AS marked_encounters_left;
