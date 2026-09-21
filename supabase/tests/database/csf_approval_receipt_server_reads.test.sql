BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);

SELECT extensions.ok(has_table_privilege('service_role', 'plugin_data.csf_automatic_import_approvals', 'SELECT'), 'retry service can read approval receipts');
SELECT extensions.ok(has_table_privilege('service_role', 'plugin_data.csf_automatic_import_approval_rows', 'SELECT'), 'retry service can read exact approved rows');
SELECT extensions.ok(NOT has_table_privilege('service_role', 'plugin_data.csf_automatic_import_approvals', 'INSERT,UPDATE,DELETE'), 'retry service cannot manufacture or change approvals');
SELECT extensions.ok(NOT has_table_privilege('service_role', 'plugin_data.csf_automatic_import_approval_rows', 'INSERT,UPDATE,DELETE'), 'retry service cannot change frozen selections');
SELECT extensions.ok(NOT has_table_privilege('anon', 'plugin_data.csf_automatic_import_approvals', 'SELECT'), 'anonymous clients cannot read approvals');
SELECT extensions.ok(NOT has_table_privilege('authenticated', 'plugin_data.csf_automatic_import_approval_rows', 'SELECT'), 'signed-in clients cannot read selected rows');

SET LOCAL ROLE service_role;
SELECT extensions.lives_ok('SELECT preview_job_id,row_count FROM plugin_data.csf_automatic_import_approvals WHERE organization_id=''00000000-0000-4000-8000-000000000000''', 'service approval query executes');
SELECT extensions.lives_ok('SELECT import_row_id FROM plugin_data.csf_automatic_import_approval_rows WHERE organization_id=''00000000-0000-4000-8000-000000000000''', 'service selection query executes');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok('SELECT * FROM plugin_data.csf_automatic_import_approvals', '42501', NULL, 'browser cannot query approval receipts');
SELECT extensions.throws_ok('SELECT * FROM plugin_data.csf_automatic_import_approval_rows', '42501', NULL, 'browser cannot query selected rows');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT extensions.throws_ok('SELECT * FROM plugin_data.csf_automatic_import_approvals', '42501', NULL, 'anonymous query is denied');
SELECT extensions.throws_ok('SELECT * FROM plugin_data.csf_automatic_import_approval_rows', '42501', NULL, 'anonymous selection query is denied');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
