BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('cf000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'recovery-officer@local.test', now(), '{}', '{}', now(), now());
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('cf100000-0000-4000-8000-000000000001', 'Recovery fixture', 'recovery-fixture', 'school', '985391');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('cf100000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'admin', 'active');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES ('cf200000-0000-4000-8000-000000000001', 'cf100000-0000-4000-8000-000000000001', 2034, 'Class of 2034');

SELECT plugin_data.csf_queue_class_workbook_preparation(
  'cf100000-0000-4000-8000-000000000001', 'cf200000-0000-4000-8000-000000000001',
  'synthetic-recovery-workbook', 'cf000000-0000-4000-8000-000000000001', '501',
  '2026-09-01T00:00:00Z', '["F33","S34"]');
UPDATE plugin_data.csf_class_workbooks SET last_prepared_version = '501'
WHERE organization_id = 'cf100000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_class_workbook_refresh_jobs SET status = 'completed'
WHERE organization_id = 'cf100000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_sheet_sources
  (id, organization_id, cohort_id, source_type, title, provider, spreadsheet_id)
VALUES ('cf400000-0000-4000-8000-000000000001', 'cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001', 'class_history', 'Recovery workbook', 'google_sheets', 'synthetic-recovery-workbook');
INSERT INTO plugin_data.csf_sheet_import_jobs
  (id, organization_id, source_id, mode, status, source_type, source_file_id)
SELECT ('cf500000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'cf100000-0000-4000-8000-000000000001', 'cf400000-0000-4000-8000-000000000001',
  'preview', 'completed', 'class_history', 'synthetic-recovery-workbook'
FROM generate_series(1,3) n;
INSERT INTO plugin_data.csf_import_commit_queue
  (id, organization_id, preview_job_id, actor_user_id, status, attempt_count, error_code)
SELECT ('cf600000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'cf100000-0000-4000-8000-000000000001',
  ('cf500000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'cf000000-0000-4000-8000-000000000001',
  CASE WHEN n=3 THEN 'blocked' ELSE 'queued' END,
  CASE WHEN n=3 THEN 1 ELSE 0 END,
  CASE WHEN n=3 THEN 'import_partially_completed' ELSE NULL END
FROM generate_series(1,3) n;
INSERT INTO plugin_data.csf_sheet_import_rows
  (id, organization_id, job_id, sheet_tab_name, row_number, import_status)
VALUES ('cf700000-0000-4000-8000-000000000001', 'cf100000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000003', 'F33', 2, 'error');
CREATE TEMP TABLE recovery_original_rows AS
SELECT to_jsonb(r) AS value FROM plugin_data.csf_sheet_import_rows r
WHERE organization_id = 'cf100000-0000-4000-8000-000000000001';
CREATE TEMP TABLE recovery_original_failed_queue AS
SELECT to_jsonb(q) AS value FROM plugin_data.csf_import_commit_queue q
WHERE id = 'cf600000-0000-4000-8000-000000000003';

SELECT extensions.ok(NOT has_function_privilege('anon', 'plugin_data.csf_request_class_workbook_import_recovery(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), 'anonymous recovery is denied');
SELECT extensions.ok(NOT has_function_privilege('authenticated', 'plugin_data.csf_request_class_workbook_import_recovery(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), 'browser recovery is denied');
SELECT extensions.ok(has_function_privilege('service_role', 'plugin_data.csf_request_class_workbook_import_recovery(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), 'server recovery is granted');
SELECT extensions.is(plugin_data.csf_request_class_workbook_import_recovery('cf100000-0000-4000-8000-000000000001', 'cf200000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'cf300000-0000-4000-8000-000000000002', 'another-file') ->> 'reasonCode', 'workbook_changed_or_unavailable', 'stale workbook refuses recovery');

UPDATE plugin_data.csf_import_commit_queue SET attempt_count = 1
WHERE id = 'cf600000-0000-4000-8000-000000000002';
SELECT extensions.is(plugin_data.csf_request_class_workbook_import_recovery('cf100000-0000-4000-8000-000000000001', 'cf200000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'cf300000-0000-4000-8000-000000000003', 'synthetic-recovery-workbook') ->> 'reasonCode', 'workbook_processing', 'previously attempted queue refuses recovery');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_import_commit_queue WHERE organization_id='cf100000-0000-4000-8000-000000000001' AND status='queued'), 2, 'refusal preserves both unstarted queues');
UPDATE plugin_data.csf_import_commit_queue SET attempt_count = 0
WHERE id = 'cf600000-0000-4000-8000-000000000002';

CREATE TEMP TABLE recovery_receipts (key text PRIMARY KEY, value jsonb);
INSERT INTO recovery_receipts VALUES ('first', plugin_data.csf_request_class_workbook_import_recovery('cf100000-0000-4000-8000-000000000001', 'cf200000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'cf300000-0000-4000-8000-000000000001', 'synthetic-recovery-workbook'));
SELECT extensions.is((SELECT value->>'status' FROM recovery_receipts WHERE key='first'), 'queued', 'recovery queues a fresh review');
SELECT extensions.is((SELECT (value->>'stoppedCount')::int FROM recovery_receipts WHERE key='first'), 2, 'only the two unstarted imports stop');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_import_commit_queue WHERE organization_id='cf100000-0000-4000-8000-000000000001' AND status='blocked' AND error_code='officer_review_requested' AND attempt_count=0), 2, 'stopped imports retain zero attempts and an explicit reason');
SELECT extensions.is((SELECT to_jsonb(q) FROM plugin_data.csf_import_commit_queue q WHERE id='cf600000-0000-4000-8000-000000000003'), (SELECT value FROM recovery_original_failed_queue), 'original failed queue remains unchanged');
SELECT extensions.is((SELECT to_jsonb(r) FROM plugin_data.csf_sheet_import_rows r WHERE id='cf700000-0000-4000-8000-000000000001'), (SELECT value FROM recovery_original_rows), 'row evidence and outcome remain unchanged');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events WHERE organization_id='cf100000-0000-4000-8000-000000000001' AND action='sheets.class_workbook_import_recovery_requested'), 1, 'one audited recovery receipt is saved');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_class_workbook_refresh_jobs WHERE organization_id='cf100000-0000-4000-8000-000000000001'), 1, 'refresh reuses the provider generation');

UPDATE plugin_data.csf_class_workbook_refresh_jobs SET status='completed'
WHERE organization_id='cf100000-0000-4000-8000-000000000001';
INSERT INTO recovery_receipts VALUES ('replay', plugin_data.csf_request_class_workbook_import_recovery('cf100000-0000-4000-8000-000000000001', 'cf200000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'cf300000-0000-4000-8000-000000000001', 'synthetic-recovery-workbook'));
SELECT extensions.is((SELECT value-'replayed' FROM recovery_receipts WHERE key='replay'), (SELECT value FROM recovery_receipts WHERE key='first'), 'lost response returns the same receipt');
SELECT extensions.is((SELECT status FROM plugin_data.csf_class_workbook_refresh_jobs WHERE organization_id='cf100000-0000-4000-8000-000000000001'), 'completed', 'replay does not restart preparation');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_request_class_workbook_import_recovery('cf100000-0000-4000-8000-000000000001', 'cf200000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'cf300000-0000-4000-8000-000000000001', 'another-file')$test$, '22023', 'This request identifier belongs to a different workbook request.', 'request intent cannot change');
UPDATE plugin_data.csf_sheet_import_rows
SET commit_outcome_state='historical_unknown', commit_outcome_unresolved=true,
  commit_outcome_note='Synthetic historical receipt needs review.'
WHERE id='cf700000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_request_class_workbook_import_recovery('cf100000-0000-4000-8000-000000000001', 'cf200000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'cf300000-0000-4000-8000-000000000004', 'synthetic-recovery-workbook') ->> 'reasonCode', 'import_outcome_unresolved', 'unknown historical outcome cannot be retried');
SELECT extensions.is((SELECT status FROM plugin_data.csf_class_workbook_refresh_jobs WHERE organization_id='cf100000-0000-4000-8000-000000000001'), 'completed', 'unknown outcome does not restart preparation');
UPDATE public.organization_members SET status='inactive'
WHERE organization_id='cf100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_request_class_workbook_import_recovery('cf100000-0000-4000-8000-000000000001', 'cf200000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'cf300000-0000-4000-8000-000000000001', 'synthetic-recovery-workbook')$test$, '42501', 'This officer is not an active member of the organization whose CSF import they are acting on.', 'revoked officer cannot replay recovery');
SELECT * FROM extensions.finish();
ROLLBACK;
