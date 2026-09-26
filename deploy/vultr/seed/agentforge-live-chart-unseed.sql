-- Removes exactly the rows added by agentforge-live-chart-seed.sql (patient pubpid 'AF-LIVE-01',
-- rows marked '[seed:af-live]'). Rows written for this patient by anything else (for example
-- oe-module-agentforge lists/documents/procedure orders) are left alone, and in that case the
-- patient_data row is kept too so nothing is orphaned; the final SELECT reports it.
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

SET @remaining := (SELECT COUNT(*) FROM lists WHERE pid = @pid)
                + (SELECT COUNT(*) FROM form_encounter WHERE pid = @pid)
                + (SELECT COUNT(*) FROM forms WHERE pid = @pid)
                + (SELECT COUNT(*) FROM form_vitals WHERE pid = @pid)
                + (SELECT COUNT(*) FROM prescriptions WHERE patient_id = @pid)
                + (SELECT COUNT(*) FROM pnotes WHERE pid = @pid)
                + (SELECT COUNT(*) FROM documents WHERE foreign_id = @pid)
                + (SELECT COUNT(*) FROM procedure_order WHERE patient_id = @pid);

DELETE FROM patient_data WHERE pubpid = 'AF-LIVE-01' AND pid = @pid AND @remaining = 0;

DROP TEMPORARY TABLE af_live_enc;
COMMIT;

SELECT @pid AS af_live_pid,
       @remaining AS other_rows_still_referencing_pid,
       (SELECT COUNT(*) FROM patient_data WHERE pubpid = 'AF-LIVE-01') AS af_live_patients_left,
       (SELECT COUNT(*) FROM lists WHERE comments LIKE '%[seed:af-live]%') AS marked_lists_left,
       (SELECT COUNT(*) FROM form_encounter WHERE billing_note = '[seed:af-live]') AS marked_encounters_left;
