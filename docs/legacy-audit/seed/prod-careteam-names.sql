-- Option B (David, 2026-09-25: "go with B, it's a demo"): make Care Team member names visible to the
-- demo login. OpenEMR's FHIR CareTeam carries no member display names; the card reads each Practitioner,
-- which needs (a) the member user to have an NPI and (b) the viewer to hold admin/users.
-- Narrowest grant: a new phpGACL ACL giving 'view' on admin/users to the single user 'grader' only.
-- Synthetic NPI 1234567893 (standard test value) on the admin user, the seeded care-team member.
-- Revert: prod-careteam-names-revert.sql
START TRANSACTION;
UPDATE users SET npi = '1234567893' WHERE username = 'admin' AND (npi IS NULL OR npi = '');
SET @acl := (SELECT id FROM gacl_acl_seq) + 1;
INSERT INTO gacl_acl (id, section_value, allow, enabled, return_value, note, updated_date)
  VALUES (@acl, 'system', 1, 1, 'view', 'Dashboard demo: grader may read users (Care Team names) [seed:dashboard]', UNIX_TIMESTAMP());
INSERT INTO gacl_aco_map (acl_id, section_value, value) VALUES (@acl, 'admin', 'users');
INSERT INTO gacl_aro_map (acl_id, section_value, value) VALUES (@acl, 'users', 'grader');
UPDATE gacl_acl_seq SET id = @acl;
COMMIT;
SELECT @acl AS new_acl_id, (SELECT npi FROM users WHERE username='admin') AS admin_npi;
