-- Phase 6 synthetic seed: one deceased patient, so the header's derived status
-- ("Deceased" from Patient.deceasedDateTime; Patient.active is always true) is testable.
-- LOCAL DEV STACK ONLY. Synthetic data only. Approved by David, 2026-09-25.
-- Target: pid 12 (spare data-rich patient; pid 13 = probe patient, pid 3 = empty-state).
-- Marker: deceased_reason = '[seed:phase1]'. Remove with phase1-unseed.sql.
UPDATE patient_data
   SET deceased_date = '2026-08-30 14:00:00', deceased_reason = '[seed:phase1]'
 WHERE pid = 12 AND deceased_date IS NULL AND deceased_reason = '';
SELECT pid, deceased_date, deceased_reason FROM patient_data WHERE pid = 12;
