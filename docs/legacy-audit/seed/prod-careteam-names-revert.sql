-- Reverts prod-careteam-names.sql.
START TRANSACTION;
SET @acl := (SELECT id FROM gacl_acl WHERE note LIKE 'Dashboard demo: grader may read users%');
DELETE FROM gacl_aro_map WHERE acl_id = @acl;
DELETE FROM gacl_aco_map WHERE acl_id = @acl;
DELETE FROM gacl_acl WHERE id = @acl;
UPDATE users SET npi = NULL WHERE username = 'admin' AND npi = '1234567893';
COMMIT;
