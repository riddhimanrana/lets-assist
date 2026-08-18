BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(30);

SELECT extensions.has_column('plugin_data', 'csf_point_appeals', 'correlation_id', 'point appeals retain their submission correlation');
SELECT extensions.has_column('plugin_data', 'csf_point_appeals', 'decision_reason_code', 'appeal decisions retain a typed operational reason');
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_point_appeals'::regclass
      AND conname = 'csf_point_appeals_submission_organization_fkey'
      AND contype = 'f'
      AND convalidated
  ),
  'appealed submissions are organization scoped'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_review_point_submission(uuid,uuid,text,numeric,text,uuid)', 'EXECUTE'),
  'the server cannot bypass the validated point-review wrapper'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_review_point_submission_v2(uuid,uuid,text,numeric,text,uuid)', 'EXECUTE'),
  'the server cannot bypass request-aware point review'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_review_point_submission_request(uuid,uuid,text,numeric,text,uuid,uuid)', 'EXECUTE'),
  'the server can execute replay-safe point review'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_submit_point_appeal(uuid,uuid,text,numeric,uuid,uuid)', 'EXECUTE'),
  'authenticated users cannot bypass the member appeal action'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_submit_point_appeal(uuid,uuid,text,numeric,uuid,uuid)', 'EXECUTE'),
  'the server cannot bypass request-aware appeal submission'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_submit_point_appeal_request(uuid,uuid,text,numeric,uuid,uuid)', 'EXECUTE'),
  'the server can submit replay-safe point appeals'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_review_point_appeal(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE'),
  'authenticated users cannot resolve appeals directly'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_review_point_appeal(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE'),
  'the server cannot bypass request-aware appeal review'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_review_point_appeal_request(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE'),
  'the server can review replay-safe point appeals'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('d6000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'appeal-member@local.test', now(), '{}', '{}', now(), now()),
  ('d6000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'appeal-officer@local.test', now(), '{}', '{}', now(), now()),
  ('d6000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other-member@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('d6100000-0000-4000-8000-000000000001', 'CSF Appeals', 'csf-appeals', 'school', '996101');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('d6100000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('d6100000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000002', 'staff', 'active'),
  ('d6100000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000003', 'member', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title, role_type, is_system
) VALUES (
  'd6150000-0000-4000-8000-000000000001',
  'd6100000-0000-4000-8000-000000000001',
  'point-reviewer',
  'Point reviewer',
  'Point reviewer',
  'custom',
  false
);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  ('d6100000-0000-4000-8000-000000000001', 'd6150000-0000-4000-8000-000000000001', 'verify_submissions', true),
  ('d6100000-0000-4000-8000-000000000001', 'd6150000-0000-4000-8000-000000000001', 'process_points', true);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title,
  status, starts_at, ends_at
) VALUES (
  'd6100000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000002',
  'd6150000-0000-4000-8000-000000000001',
  '2030-2031',
  'Point reviewer',
  'active',
  current_date - 1,
  current_date + 30
);

INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester, is_current, lifecycle_status)
VALUES ('d6200000-0000-4000-8000-000000000001', 'd6100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true, 'open');

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity, outside_volunteering_allowed
) VALUES (
  'd6100000-0000-4000-8000-000000000001',
  'd6200000-0000-4000-8000-000000000001',
  3,
  true
);

INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name)
VALUES ('d6300000-0000-4000-8000-000000000001', 'd6100000-0000-4000-8000-000000000001', 'Appeal', 'Member', 'appeal', 'member');

INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary)
VALUES ('d6100000-0000-4000-8000-000000000001', 'd6300000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001', 'verified', true);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, status, accepted_at
) VALUES (
  'd6100000-0000-4000-8000-000000000001',
  'd6300000-0000-4000-8000-000000000001',
  'd6200000-0000-4000-8000-000000000001',
  'accepted',
  now()
);

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, source, description, claimed_points, point_type, status, submitted_by
) VALUES
  ('d6400000-0000-4000-8000-000000000001', 'd6100000-0000-4000-8000-000000000001', 'd6300000-0000-4000-8000-000000000001', 'd6200000-0000-4000-8000-000000000001', 'student', 'Rejected service claim', 2, 'non_drive', 'rejected', 'd6000000-0000-4000-8000-000000000001'),
  ('d6400000-0000-4000-8000-000000000002', 'd6100000-0000-4000-8000-000000000001', 'd6300000-0000-4000-8000-000000000001', 'd6200000-0000-4000-8000-000000000001', 'manual', 'Submitted service claim', 1.5, 'non_drive', 'submitted', 'd6000000-0000-4000-8000-000000000001');

INSERT INTO plugin_data.csf_submission_files (
  id, organization_id, submission_id, profile_id, term_id, bucket,
  object_path, original_filename, mime_type, size_bytes, uploaded_by,
  upload_status, finalized_at
) VALUES (
  'd6450000-0000-4000-8000-000000000001',
  'd6100000-0000-4000-8000-000000000001',
  'd6400000-0000-4000-8000-000000000001',
  'd6300000-0000-4000-8000-000000000001',
  'd6200000-0000-4000-8000-000000000001',
  'plugins',
  'organizations/atomic-appeals/rejected-claim/proof.pdf',
  'proof.pdf',
  'application/pdf',
  256,
  'd6000000-0000-4000-8000-000000000001',
  'finalized',
  now()
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal(
    'd6100000-0000-4000-8000-000000000001', 'd6400000-0000-4000-8000-000000000001',
    'The rejection missed the attached activity verification.', 2.5,
    'd6000000-0000-4000-8000-000000000001', 'd6500000-0000-4000-8000-000000000001'
  ) $$,
  'the connected member can submit an appeal against a decided claim'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_appeals WHERE correlation_id = 'd6500000-0000-4000-8000-000000000001'),
  'submitted',
  'the appeal enters the officer queue'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'd6500000-0000-4000-8000-000000000001'),
  1,
  'appeal creation and audit commit together'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal(
    'd6100000-0000-4000-8000-000000000001', 'd6400000-0000-4000-8000-000000000001',
    'A different account is trying to appeal this claim.', 2,
    'd6000000-0000-4000-8000-000000000003', 'd6500000-0000-4000-8000-000000000002'
  ) $$,
  'P0001', 'Only the connected member may appeal this point submission.',
  'another organization member cannot appeal someone else''s claim'
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'd6100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals WHERE correlation_id = 'd6500000-0000-4000-8000-000000000001'),
    'under_review', 'Officer is verifying the original activity evidence.',
    'd6000000-0000-4000-8000-000000000002', 'd6500000-0000-4000-8000-000000000003'
  ) $$,
  'an officer can place the appeal under review without changing credit'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_appeals WHERE correlation_id = 'd6500000-0000-4000-8000-000000000001'),
  'under_review',
  'holding an appeal preserves its open workflow state'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records WHERE submission_id = 'd6400000-0000-4000-8000-000000000001'),
  0,
  'under-review does not create or adjust credit'
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'd6100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals WHERE correlation_id = 'd6500000-0000-4000-8000-000000000001'),
    'approved', 'Evidence confirmed; award adjusted to two and a half points.',
    'd6000000-0000-4000-8000-000000000002', 'd6500000-0000-4000-8000-000000000004'
  ) $$,
  'approving an appeal creates missing credit and updates the rejected submission atomically'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'd6400000-0000-4000-8000-000000000001'),
  'approved',
  'an approved appeal corrects the original submission outcome'
);
SELECT extensions.is(
  (SELECT points::text FROM plugin_data.csf_credit_records WHERE submission_id = 'd6400000-0000-4000-8000-000000000001'),
  '2.50',
  'an approved appeal records the requested numeric award'
);
SELECT extensions.is(
  (SELECT decision_reason_code FROM plugin_data.csf_point_appeals WHERE correlation_id = 'd6500000-0000-4000-8000-000000000001'),
  'point_appeal_adjusted',
  'an adjusted appeal records its reason code'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'd6500000-0000-4000-8000-000000000004'),
  1,
  'the appeal decision and award share one audit correlation'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'd6100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals WHERE correlation_id = 'd6500000-0000-4000-8000-000000000001'),
    'approved', 'A second officer attempted the same final decision.',
    'd6000000-0000-4000-8000-000000000002', 'd6500000-0000-4000-8000-000000000005'
  ) $$,
  'P0001', 'Point appeal was not found or has already been decided.',
  'a concurrent or repeated final appeal decision cannot overwrite the result'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal(
    'd6100000-0000-4000-8000-000000000001', 'd6400000-0000-4000-8000-000000000001',
    'This request exceeds the configured per-activity limit.', 4,
    'd6000000-0000-4000-8000-000000000001', 'd6500000-0000-4000-8000-000000000006'
  ) $$,
  'P0001', 'Requested points must be between 0 and 3.00.',
  'an appeal cannot request more than the versioned semester policy'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_v2(
    'd6100000-0000-4000-8000-000000000001', 'd6400000-0000-4000-8000-000000000002',
    'approved', 2, NULL, 'd6000000-0000-4000-8000-000000000002'
  ) $$,
  'P0001', 'Explain why the awarded points differ from the member claim.',
  'an officer cannot silently adjust a point award'
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_v2(
    'd6100000-0000-4000-8000-000000000001', 'd6400000-0000-4000-8000-000000000002',
    'approved', 2, 'Verified an additional half-point from the activity record.',
    'd6000000-0000-4000-8000-000000000002'
  ) $$,
  'an officer can adjust an award with a documented reason'
);
SELECT extensions.is(
  (SELECT points::text FROM plugin_data.csf_credit_records WHERE submission_id = 'd6400000-0000-4000-8000-000000000002'),
  '2.00',
  'the reasoned point review records the adjusted numeric award'
);
SELECT extensions.is(
  (SELECT review_notes FROM plugin_data.csf_point_submissions WHERE id = 'd6400000-0000-4000-8000-000000000002'),
  'Verified an additional half-point from the activity record.',
  'the adjusted award preserves the officer reason on the submission'
);

SELECT extensions.finish();
ROLLBACK;
