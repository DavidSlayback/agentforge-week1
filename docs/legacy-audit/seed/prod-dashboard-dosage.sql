-- Slice 01-06-04: one synthetic dosage instruction so the Medications card's FHIR enrichment
-- (MedicationRequest intent=plan → dosageInstruction.text) is observable. Synthetic data only.
-- Target: DASH-SYN-01's current medication (Lisinopril). Marker: usage_category_title = '[seed:dashboard]' (not displayed; keeps the shown instruction clean).
-- Remove: DELETE lm FROM lists_medication lm JOIN lists l ON l.id = lm.list_id JOIN patient_data p ON p.pid = l.pid
--         WHERE p.pubpid LIKE 'DASH-SYN-%' AND lm.usage_category_title = '[seed:dashboard]';
INSERT INTO lists_medication (list_id, drug_dosage_instructions, usage_category_title, request_intent_title)
SELECT l.id, 'Take 1 tablet by mouth once daily in the morning', '[seed:dashboard]', ''
FROM lists l JOIN patient_data p ON p.pid = l.pid
WHERE p.pubpid = 'DASH-SYN-01' AND l.type = 'medication' AND l.title LIKE 'Lisinopril%'
  AND NOT EXISTS (SELECT 1 FROM lists_medication lm WHERE lm.list_id = l.id);
SELECT p.pubpid, l.title, lm.drug_dosage_instructions FROM lists_medication lm JOIN lists l ON l.id = lm.list_id JOIN patient_data p ON p.pid = l.pid WHERE p.pubpid LIKE 'DASH-SYN-%';
