BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

-- Every new public table needs the statement guard even when only definers write it.
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid = relation::regclass
    AND tgname = 'account_deletion_write_fence' AND tgtype = 30
    AND tgfoid = 'app_private.guard_account_deletion_write()'::regprocedure
), relation || ' has the statement write fence')
FROM unnest(ARRAY['public.project_attendance_intervals',
  'public.project_attendance_print_sheets', 'public.project_attendance_print_rows']) relation;

SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid = relation::regclass
    AND tgname = 'account_deletion_reference_fence' AND tgtype = 23
    AND tgfoid = 'app_private.guard_account_deletion_reference()'::regprocedure
    AND encode(tgargs, 'escape') = column_name || '\000'
), relation || ' fences new account references')
FROM (VALUES
  ('private.project_attendance_changes', 'actor_id'),
  ('private.paper_attendance_review_operations', 'actor_id'),
  ('private.paper_attendance_commit_receipts', 'actor_id'),
  ('public.project_attendance_print_sheets', 'created_by'),
  ('private.attendance_print_requests', 'actor_id'),
  ('private.anonymous_account_links', 'user_id')
) references_to_accounts(relation, column_name);
SELECT extensions.ok(NOT has_function_privilege(role_name,
  'private.lock_paper_attendance_account(uuid)', 'EXECUTE'), role_name || ' cannot call the internal lock helper')
FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) role_name;

INSERT INTO auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT ('ef100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'paper-deletion-' || n || '@local.test', now(), '{}',
  jsonb_build_object('username', 'paper_deletion_' || n), now(), now()
FROM generate_series(1, 3) n;
INSERT INTO public.projects(id, creator_id, title, location, description, event_type, verification_method, schedule, status, project_timezone)
SELECT ('ef200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'ef100000-0000-4000-8000-000000000001', 'Deletion fence fixture ' || n, 'Local', 'Synthetic paper deletion fixture',
  'oneTime', 'manual', '{"oneTime":{"date":"2020-09-01","startTime":"09:00","endTime":"17:00","volunteers":10}}', 'upcoming', 'UTC'
FROM generate_series(1, 2) n;
INSERT INTO public.project_signups(id, project_id, user_id, schedule_id, status)
VALUES ('ef300000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000003', 'oneTime', 'approved');
INSERT INTO public.anonymous_signups(id, project_id, email, name, token, confirmed_at)
SELECT ('ef400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'ef200000-0000-4000-8000-000000000002', 'deletion-guest-' || n || '@local.test', 'Synthetic guest ' || n,
  ('ef500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, now()
FROM generate_series(1, 2) n;

SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($$SELECT public.create_manual_attendance_batch(
  'ef200000-0000-4000-8000-000000000001', 'oneTime',
  'ef100000-0000-4000-8000-000000000001', 'ef600000-0000-4000-8000-000000000001')$$,
  'active service actor can create a manual batch without auth.uid');
SELECT extensions.lives_ok($$SELECT public.create_attendance_print_sheets(
  'ef200000-0000-4000-8000-000000000001', ARRAY['oneTime'],
  'ef100000-0000-4000-8000-000000000001', 0, 0, 'ef600000-0000-4000-8000-000000000002')$$,
  'active service actor can prepare a print receipt');
SELECT extensions.is(public.link_guest_attendance_account(
  'ef400000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000003',
  'ef500000-0000-4000-8000-000000000001')->>'outcome', 'accepted', 'active destination can link guest history');
RESET ROLE;

-- Reference guards cover privileged writes with no JWT, including UUID receipt fields without FKs.
CREATE TEMP TABLE paper_reference_cases(relation text, column_name text, insert_sql text);
INSERT INTO paper_reference_cases VALUES
('private.project_attendance_changes', 'actor_id', $$INSERT INTO private.project_attendance_changes
(signup_id, project_id, actor_id, request_id, request_payload, reason, old_intervals, new_intervals, new_credited_minutes, old_revision, new_revision, result)
VALUES ('ef300000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', ':user', gen_random_uuid(), '{}', 'Synthetic', '[]', '[]', 60, 0, 1, '{}')$$),
('private.paper_attendance_review_operations', 'actor_id', $$INSERT INTO private.paper_attendance_review_operations
(request_id, project_id, batch_id, actor_id, operation, payload)
SELECT gen_random_uuid(), project_id, id, ':user', 'test', '{}' FROM public.project_paper_scan_batches
WHERE creation_request_id = 'ef600000-0000-4000-8000-000000000001'$$),
('private.paper_attendance_commit_receipts', 'actor_id', $$INSERT INTO private.paper_attendance_commit_receipts
(request_id, batch_id, actor_id, row_ids, allow_over_capacity, results)
SELECT gen_random_uuid(), id, ':user', ARRAY[]::uuid[], false, '[]' FROM public.project_paper_scan_batches
WHERE creation_request_id = 'ef600000-0000-4000-8000-000000000001'$$),
('public.project_attendance_print_sheets', 'created_by', $$INSERT INTO public.project_attendance_print_sheets
(project_id, schedule_id, created_by, project_title, project_timezone, starts_at, ends_at)
VALUES ('ef200000-0000-4000-8000-000000000001', 'oneTime', ':user', 'Synthetic', 'UTC', '2020-09-01T09:00Z', '2020-09-01T17:00Z')$$),
('private.attendance_print_requests', 'actor_id', $$INSERT INTO private.attendance_print_requests
(request_id, project_id, actor_id, request_payload, sheets)
VALUES (gen_random_uuid(), 'ef200000-0000-4000-8000-000000000001', ':user', '{}', '[]')$$),
('private.anonymous_account_links', 'user_id', $$INSERT INTO private.anonymous_account_links(anonymous_id, user_id, signup_ids)
VALUES ('ef400000-0000-4000-8000-000000000002', ':user', ARRAY[]::uuid[])$$);
SELECT extensions.lives_ok(replace(insert_sql, ':user', 'ef100000-0000-4000-8000-000000000001'),
  relation || ' accepts an active reference') FROM paper_reference_cases;
INSERT INTO app_private.account_deletion_operations(target_user_id, requested_by, mode, phase)
VALUES ('ef100000-0000-4000-8000-000000000002', 'ef100000-0000-4000-8000-000000000002', 'self_delete', 'external_pending');
SELECT extensions.throws_ok(replace(insert_sql, ':user', 'ef100000-0000-4000-8000-000000000002'),
  '42501', 'Cannot create a reference to an account being deleted.', relation || ' refuses a pending insert')
FROM paper_reference_cases;
SELECT extensions.throws_ok(format('UPDATE %s SET %I = %L WHERE %I = %L', relation, column_name,
  'ef100000-0000-4000-8000-000000000002', column_name, 'ef100000-0000-4000-8000-000000000001'),
  '42501', 'Cannot create a reference to an account being deleted.', relation || ' refuses a changed reference to a pending account')
FROM paper_reference_cases;
UPDATE app_private.account_deletion_operations SET phase = 'completed', completed_at = now();
SELECT extensions.throws_ok(replace(insert_sql, ':user', 'ef100000-0000-4000-8000-000000000002'),
  '42501', 'Cannot create a reference to an account being deleted.', relation || ' refuses a completed account insert')
FROM paper_reference_cases;
UPDATE app_private.account_deletion_operations SET phase = 'blocked';
SELECT extensions.lives_ok(format('UPDATE %s SET %I = %L WHERE %I = %L', relation, column_name,
  'ef100000-0000-4000-8000-000000000002', column_name, 'ef100000-0000-4000-8000-000000000001'),
  relation || ' accepts a reference after refused deletion') FROM paper_reference_cases;
UPDATE app_private.account_deletion_operations SET phase = 'external_pending';
SELECT extensions.lives_ok(format('UPDATE %s SET %I = NULL WHERE %I = %L', relation, column_name, column_name,
  'ef100000-0000-4000-8000-000000000002'), relation || ' permits cleanup to null a retained actor')
FROM paper_reference_cases WHERE relation IN ('private.project_attendance_changes',
  'private.paper_attendance_review_operations', 'public.project_attendance_print_sheets');

UPDATE private.attendance_print_requests SET actor_id = 'ef100000-0000-4000-8000-000000000001'
WHERE request_id = 'ef600000-0000-4000-8000-000000000002';

-- A service caller's supplied actor must be fenced before any lookup or replay.
INSERT INTO app_private.account_deletion_operations(target_user_id, requested_by, mode, phase)
SELECT id, id, 'self_delete', 'external_pending' FROM auth.users
WHERE id IN ('ef100000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000003');

SET LOCAL ROLE service_role;
SELECT extensions.is(auth.uid(), NULL::uuid, 'service fixture has no JWT actor');
SELECT extensions.throws_ok($$SELECT public.publish_volunteer_hours_transactional(
  'ef100000-0000-4000-8000-000000000001', NULL, 'oneTime', '[]', 'hours-publication:v1:' || repeat('a', 64))$$,
  '42501', 'Account deletion is pending or complete.', 'publish_volunteer_hours_transactional rejects a pending actor before project lookup');
SELECT extensions.throws_ok($$SELECT public.publish_volunteer_hours_transactional_automatic(
  'ef100000-0000-4000-8000-000000000001', NULL, 'oneTime', '[]', 'hours-publication:v1:' || repeat('a', 64))$$,
  '42501', 'Account deletion is pending or complete.', 'publish_volunteer_hours_transactional_automatic rejects a pending actor before project lookup');
SELECT extensions.throws_ok($$SELECT public.correct_project_attendance(NULL,0,'Synthetic','[]',gen_random_uuid(),'ef100000-0000-4000-8000-000000000001')$$,
  '42501', 'Account deletion is pending or complete.', 'correct_project_attendance rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.update_paper_scan_review_row(NULL,NULL,NULL,'ef100000-0000-4000-8000-000000000001','{}')$$,
  '42501', 'Account deletion is pending or complete.', 'update_paper_scan_review_row rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.discard_paper_scan_batch(NULL,NULL,'ef100000-0000-4000-8000-000000000001')$$,
  '42501', 'Account deletion is pending or complete.', 'discard_paper_scan_batch rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.create_manual_attendance_batch('ef200000-0000-4000-8000-000000000001','oneTime','ef100000-0000-4000-8000-000000000001','ef600000-0000-4000-8000-000000000001')$$,
  '42501', 'Account deletion is pending or complete.', 'create_manual_attendance_batch rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.add_paper_attendance_row(NULL,NULL,'ef100000-0000-4000-8000-000000000001',gen_random_uuid())$$,
  '42501', 'Account deletion is pending or complete.', 'add_paper_attendance_row rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.combine_paper_attendance_rows(NULL,NULL,'ef100000-0000-4000-8000-000000000001',NULL,ARRAY[]::uuid[],gen_random_uuid())$$,
  '42501', 'Account deletion is pending or complete.', 'combine_paper_attendance_rows rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.commit_paper_signup_batch(NULL,'ef100000-0000-4000-8000-000000000001',ARRAY[]::uuid[],false,gen_random_uuid())$$,
  '42501', 'Account deletion is pending or complete.', 'commit_paper_signup_batch rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.record_project_attendance(NULL,0,'Synthetic','[]',gen_random_uuid(),'ef100000-0000-4000-8000-000000000001')$$,
  '42501', 'Account deletion is pending or complete.', 'record_project_attendance rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.issue_supplemental_verified_certificates(NULL,'oneTime',ARRAY[]::uuid[],'ef100000-0000-4000-8000-000000000001')$$,
  '42501', 'Account deletion is pending or complete.', 'issue_supplemental_verified_certificates rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheet(NULL,'oneTime','ef100000-0000-4000-8000-000000000001')$$,
  '42501', 'Account deletion is pending or complete.', 'create_attendance_print_sheet rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('ef200000-0000-4000-8000-000000000001',ARRAY['oneTime'],'ef100000-0000-4000-8000-000000000001',0,0,'ef600000-0000-4000-8000-000000000002')$$,
  '42501', 'Account deletion is pending or complete.', 'create_attendance_print_sheets rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.request_corrected_certificate_delivery(NULL,NULL,1,gen_random_uuid(),'ef100000-0000-4000-8000-000000000001')$$,
  '42501', 'Account deletion is pending or complete.', 'request_corrected_certificate_delivery rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.project_corrected_certificate_ids(NULL,'ef100000-0000-4000-8000-000000000001')$$,
  '42501', 'Account deletion is pending or complete.', 'project_corrected_certificate_ids rejects a pending service actor or destination before lookup or replay');
SELECT extensions.throws_ok($$SELECT public.link_guest_attendance_account('ef400000-0000-4000-8000-000000000001','ef100000-0000-4000-8000-000000000003','ef500000-0000-4000-8000-000000000001')$$,
  '42501', 'Account deletion is pending or complete.', 'link_guest_attendance_account rejects a pending service actor or destination before lookup or replay');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', 'ef100000-0000-4000-8000-000000000001', true);
SELECT extensions.throws_ok(format('UPDATE %s SET project_id = project_id WHERE false', relation),
  '42501', 'Account deletion is pending or complete.', relation || ' rejects even zero-row JWT writes')
FROM unnest(ARRAY['public.project_attendance_intervals',
  'public.project_attendance_print_sheets', 'public.project_attendance_print_rows']) relation;
SELECT set_config('request.jwt.claim.sub', '', true);
UPDATE app_private.account_deletion_operations SET phase = 'completed', completed_at = now()
WHERE target_user_id IN ('ef100000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000003');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets(
  'ef200000-0000-4000-8000-000000000001', ARRAY['oneTime'],
  'ef100000-0000-4000-8000-000000000001', 0, 0, 'ef600000-0000-4000-8000-000000000002')$$,
  '42501', 'Account deletion is pending or complete.', 'completed actor cannot replay an existing print receipt');
SELECT extensions.throws_ok($$SELECT public.link_guest_attendance_account(
  'ef400000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000003',
  'ef500000-0000-4000-8000-000000000001')$$,
  '42501', 'Account deletion is pending or complete.', 'completed destination cannot replay an existing guest link');
RESET ROLE;
UPDATE app_private.account_deletion_operations SET phase = 'blocked'
WHERE target_user_id IN ('ef100000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000003');
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($$SELECT public.create_manual_attendance_batch(
  'ef200000-0000-4000-8000-000000000001', 'oneTime',
  'ef100000-0000-4000-8000-000000000001', 'ef600000-0000-4000-8000-000000000001')$$,
  'refused deletion leaves manual batch replay available');
SELECT extensions.lives_ok($$SELECT public.create_attendance_print_sheets(
  'ef200000-0000-4000-8000-000000000001', ARRAY['oneTime'],
  'ef100000-0000-4000-8000-000000000001', 0, 0, 'ef600000-0000-4000-8000-000000000002')$$,
  'refused deletion leaves print receipt replay available');
SELECT extensions.is(public.link_guest_attendance_account(
  'ef400000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000003',
  'ef500000-0000-4000-8000-000000000001')->>'outcome', 'replayed', 'refused destination deletion leaves guest replay available');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM public.project_paper_scan_batches
  WHERE creation_request_id = 'ef600000-0000-4000-8000-000000000001'), 1::bigint, 'denials preserve the original batch');
SELECT extensions.is((SELECT count(*) FROM private.attendance_print_requests
  WHERE request_id = 'ef600000-0000-4000-8000-000000000002'), 1::bigint, 'denials preserve the original print receipt');
SELECT extensions.is((SELECT count(*) FROM private.anonymous_account_links
  WHERE anonymous_id = 'ef400000-0000-4000-8000-000000000001'), 1::bigint, 'denials preserve the original guest receipt');
SELECT * FROM extensions.finish();
ROLLBACK;
