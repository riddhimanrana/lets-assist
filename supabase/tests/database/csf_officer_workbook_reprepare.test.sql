BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('ce000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'reprepare-officer@local.test', now(), '{}', '{}', now(), now());
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('ce100000-0000-4000-8000-000000000001', 'Reprepare fixture', 'reprepare-fixture', 'school', '986391');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'admin', 'active');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES ('ce200000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001', 2034, 'Class of 2034');

SELECT plugin_data.csf_queue_class_workbook_preparation(
  'ce100000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001',
  'synthetic-reprepare-workbook', 'ce000000-0000-4000-8000-000000000001', '501',
  '2026-09-01T00:00:00Z', '["F33","S34"]');
UPDATE plugin_data.csf_class_workbooks SET last_prepared_version = '501'
WHERE cohort_id = 'ce200000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_class_workbook_refresh_jobs SET status = 'completed'
WHERE organization_id = 'ce100000-0000-4000-8000-000000000001';

CREATE TEMP TABLE reprepare_receipts (key text PRIMARY KEY, value jsonb);
INSERT INTO reprepare_receipts VALUES ('first', plugin_data.csf_request_class_workbook_reprepare(
  'ce100000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000001',
  'synthetic-reprepare-workbook'));
SELECT extensions.is((SELECT value ->> 'status' FROM reprepare_receipts WHERE key = 'first'), 'queued', 'unchanged prepared workbook queues a re-parse');
SELECT extensions.is((SELECT last_prepared_version FROM plugin_data.csf_class_workbooks WHERE cohort_id = 'ce200000-0000-4000-8000-000000000001'), NULL, 're-prepare clears only the preparation marker');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_class_workbook_refresh_jobs WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'), 1, 're-prepare reuses the exact generation queue item');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'ce100000-0000-4000-8000-000000000001' AND action = 'sheets.class_workbook_reprepare_requested'), 1, 'officer intent has one durable audit receipt');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_sheet_import_rows WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'), 0, 'request does not create or commit import rows');

UPDATE plugin_data.csf_class_workbook_refresh_jobs SET status = 'completed'
WHERE organization_id = 'ce100000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_class_workbooks SET last_prepared_version = '501'
WHERE cohort_id = 'ce200000-0000-4000-8000-000000000001';
INSERT INTO reprepare_receipts VALUES ('replay', plugin_data.csf_request_class_workbook_reprepare(
  'ce100000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000001',
  'synthetic-reprepare-workbook'));
SELECT extensions.is((SELECT value - 'replayed' FROM reprepare_receipts WHERE key = 'replay'), (SELECT value FROM reprepare_receipts WHERE key = 'first'), 'lost-response retry returns the original receipt');
SELECT extensions.is((SELECT status FROM plugin_data.csf_class_workbook_refresh_jobs WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'), 'completed', 'replay does not restart a completed worker');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_request_class_workbook_reprepare(
  'ce100000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000001', 'another-file')$$,
  '22023', 'This request identifier belongs to a different workbook request.', 'request identifiers cannot change their workbook intent');
SELECT extensions.is(plugin_data.csf_request_class_workbook_reprepare(
  'ce100000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000002', 'another-file') ->> 'status', 'blocked', 'stale workbook selection cannot queue the replacement');
UPDATE plugin_data.csf_class_workbook_refresh_jobs SET status = 'running'
WHERE organization_id = 'ce100000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_request_class_workbook_reprepare(
  'ce100000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000003', 'synthetic-reprepare-workbook') ->> 'reasonCode', 'workbook_processing', 'active refresh worker is not reset');
SELECT extensions.is((SELECT last_prepared_version FROM plugin_data.csf_class_workbooks WHERE cohort_id = 'ce200000-0000-4000-8000-000000000001'), '501', 'refused request does not clear preparation state');
SELECT extensions.ok(NOT has_function_privilege('anon', 'plugin_data.csf_request_class_workbook_reprepare(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), 'anon cannot request re-prepare');
SELECT extensions.ok(NOT has_function_privilege('authenticated', 'plugin_data.csf_request_class_workbook_reprepare(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), 'browser role cannot request re-prepare');
SELECT extensions.ok(has_function_privilege('service_role', 'plugin_data.csf_request_class_workbook_reprepare(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), 'audited server action can request re-prepare');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_request_class_workbook_reprepare(
  'ce100000-0000-4000-8000-000000000002', 'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000004', 'synthetic-reprepare-workbook')$$,
  '42501', 'This officer is not an active member of the organization whose CSF import they are acting on.',
  'another organization cannot use the class or its receipts');
UPDATE public.organization_members SET status = 'inactive'
WHERE organization_id = 'ce100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT plugin_data.csf_request_class_workbook_reprepare(
  'ce100000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000001', 'synthetic-reprepare-workbook')$$,
  '42501', 'This officer is not an active member of the organization whose CSF import they are acting on.',
  'permission revocation prevents receipt replay');
SELECT * FROM extensions.finish();
ROLLBACK;
