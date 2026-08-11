BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

SELECT extensions.ok(
  NOT has_function_privilege(
    'public',
    'plugin_data.csf_begin_point_submission(uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,uuid,text,text,text,text,bigint,uuid,uuid)',
    'EXECUTE'
  ),
  'PUBLIC cannot begin an interactive point submission'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_begin_point_submission(uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,uuid,text,text,text,text,bigint,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the point-submission boundary directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_begin_point_submission(uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,uuid,text,text,text,text,bigint,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role cannot bypass the request-aware point-submission boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_finalize_point_submission_proof(uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role cannot bypass the request-aware proof finalizer'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_fail_point_submission_proof(uuid,uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'service_role cannot bypass the request-aware proof failure boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_withdraw_point_submission(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role cannot bypass the request-aware withdrawal boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_resubmit_point_submission(uuid,uuid,numeric,text,date,text,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role cannot bypass the request-aware resubmission boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_review_point_submission_v2(uuid,uuid,text,numeric,text,uuid)',
    'EXECUTE'
  ),
  'service_role cannot bypass the request-aware submission-review boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_submit_point_appeal(uuid,uuid,text,numeric,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role cannot bypass the request-aware appeal-submission boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_review_point_appeal(uuid,uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role cannot bypass the request-aware appeal-review boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_review_point_submission(uuid,uuid,text,numeric,text,uuid)',
    'EXECUTE'
  ),
  'service_role cannot bypass v2 through the legacy point-review engine'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_begin_point_submission_authority_base_20260810(uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,uuid,text,text,text,text,bigint,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_finalize_point_submission_proof_authority_base_20260810(uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_withdraw_point_submission_authority_base_20260810(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_review_point_submission_v2_authority_base_20260810(uuid,uuid,text,numeric,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_submit_point_appeal_authority_base_20260810(uuid,uuid,text,numeric,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_review_point_appeal_authority_base_20260810(uuid,uuid,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'all renamed write engines are private to their security-definer wrappers'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_assert_point_actor_authority(uuid,uuid,text[])',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_assert_point_submission_eligibility(uuid,uuid,uuid,uuid,uuid,text,numeric,text,boolean,boolean,boolean)',
    'EXECUTE'
  ),
  'authority assertion helpers are not public service-role entrypoints'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'point-owner@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'point-other@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'point-verifier@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'point-processor@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'point-unprivileged@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'point-cross-tenant@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fa100000-0000-4000-8000-000000000001', 'CSF Point Authority A', 'csf-point-authority-a', 'school', '997101'),
  ('fa100000-0000-4000-8000-000000000002', 'CSF Point Authority B', 'csf-point-authority-b', 'school', '997102');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000003', 'staff', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000004', 'staff', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000005', 'staff', 'active'),
  ('fa100000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000006', 'member', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title, role_type, is_system
) VALUES
  ('fa200000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'point-verifier', 'Point verifier', 'Point verifier', 'custom', false),
  ('fa200000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'point-processor', 'Point processor', 'Point processor', 'custom', false),
  ('fa200000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'point-observer', 'Point observer', 'Point observer', 'custom', false);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  ('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'verify_submissions', true),
  ('fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000002', 'process_points', true);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title,
  status, starts_at, ends_at
) VALUES
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000003', 'fa200000-0000-4000-8000-000000000001', '2099-2100', 'Point verifier', 'active', current_date - 1, current_date + 30),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000004', 'fa200000-0000-4000-8000-000000000002', '2099-2100', 'Point processor', 'active', current_date - 1, current_date + 30),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000005', 'fa200000-0000-4000-8000-000000000003', '2099-2100', 'Point observer', 'active', current_date - 1, current_date + 30);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  is_current, lifecycle_status
) VALUES
  ('fa300000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'F99', 'Fall 2099', '2099-2100', 'fall', true, 'open'),
  ('fa300000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000002', 'F99', 'Fall 2099', '2099-2100', 'fall', true, 'open');

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES
  ('fa310000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 2100, 'Class of 2100', 'active'),
  ('fa310000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000002', 2100, 'Class of 2100', 'active'),
  ('fa310000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 2099, 'Class of 2099', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('fa400000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Point', 'Owner', 'point', 'owner'),
  ('fa400000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000002', 'Other', 'Chapter', 'other', 'chapter');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'verified',
  true
);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status, accepted_at
) VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'fa310000-0000-4000-8000-000000000001',
  'accepted',
  now()
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity,
  outside_volunteering_allowed, published_at
) VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  3,
  true,
  now()
);

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, source, description,
  claimed_points, point_type, status, submitted_by
) VALUES
  ('fa900000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'student', 'Rejected claim eligible for appeal.', 2, 'non_drive', 'rejected', 'fa000000-0000-4000-8000-000000000001'),
  ('fa900000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'student', 'Rejected claim with membership later revoked.', 1, 'non_drive', 'rejected', 'fa000000-0000-4000-8000-000000000001'),
  ('fa900000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'student', 'Correction-requested claim is not appealable.', 1, 'non_drive', 'needs_action', 'fa000000-0000-4000-8000-000000000001');

INSERT INTO plugin_data.csf_submission_files (
  id, organization_id, submission_id, profile_id, term_id, bucket,
  object_path, original_filename, mime_type, size_bytes, uploaded_by,
  upload_status, finalized_at
) VALUES (
  'fa910000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'fa900000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'csf-private',
  'organizations/point-authority/appeals/outside-proof.pdf',
  'outside-proof.pdf',
  'application/pdf',
  300,
  'fa000000-0000-4000-8000-000000000001',
  'finalized',
  now()
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000001',
    'Another member cannot appeal this rejected point decision.', 2,
    'fa000000-0000-4000-8000-000000000002',
    'faa00000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Only the connected member may appeal this point submission.',
  'another active chapter member cannot appeal the owner submission'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000003',
    'This correction request should not enter the appeal workflow.', 1,
    'fa000000-0000-4000-8000-000000000001',
    'faa00000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'Only an approved or rejected point submission may be appealed.',
  'needs-action submissions remain in correction rather than appeal workflow'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_point_appeals
    WHERE submission_id IN (
      'fa900000-0000-4000-8000-000000000001',
      'fa900000-0000-4000-8000-000000000003'
    )
  ),
  0,
  'cross-actor and invalid-status appeal attempts leave zero appeal rows'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_submit_point_appeal('fa100000-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-000000000001', 'Cross-tenant appeal attempt.', 2, 'fa000000-0000-4000-8000-000000000006', 'faa00000-0000-4000-8000-000000000008')$$,
  'P0001', 'Point-action actor is not an active organization member.',
  'an org-B member cannot appeal an org-A submission'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_submit_point_appeal('fa100000-0000-4000-8000-000000000002', 'fa900000-0000-4000-8000-000000000001', 'Mismatched organization appeal.', 2, 'fa000000-0000-4000-8000-000000000006', 'faa00000-0000-4000-8000-000000000009')$$,
  'P0001', 'Only the connected member may appeal this point submission.',
  'an org-B member cannot target an org-A submission through org B'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_appeals WHERE correlation_id IN ('faa00000-0000-4000-8000-000000000008', 'faa00000-0000-4000-8000-000000000009'))
    + (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id IN ('faa00000-0000-4000-8000-000000000008', 'faa00000-0000-4000-8000-000000000009')),
  0, 'cross-organization appeal attempts leave zero appeal rows or audit receipts'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000001',
    'The rejection did not account for the complete activity evidence.', 2,
    'fa000000-0000-4000-8000-000000000001',
    'faa00000-0000-4000-8000-000000000003'
  ) $$,
  'the verified owner with active semester membership may submit an appeal'
);

SELECT extensions.ok(
  (
    SELECT appeal.status = 'submitted'
      AND audit.action = 'point_appeal.submit'
      AND audit.actor_user_id = 'fa000000-0000-4000-8000-000000000001'
    FROM plugin_data.csf_point_appeals AS appeal
    JOIN plugin_data.csf_admin_audit_events AS audit
      ON audit.organization_id = appeal.organization_id
     AND audit.correlation_id = appeal.correlation_id
    WHERE appeal.correlation_id = 'faa00000-0000-4000-8000-000000000003'
  ),
  'appeal submission and immutable correlation audit commit together'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals
      WHERE correlation_id = 'faa00000-0000-4000-8000-000000000003'),
    'approved', 'Verifier lacks process-points authority.',
    'fa000000-0000-4000-8000-000000000003',
    'faa00000-0000-4000-8000-000000000004'
  ) $$,
  'P0001',
  'Point-action actor does not have the required permission.',
  'verify_submissions does not imply process_points appeal authority'
);

UPDATE plugin_data.csf_term_policies
SET max_points_per_activity = 1, updated_at = now()
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND term_id = 'fa300000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals
      WHERE correlation_id = 'faa00000-0000-4000-8000-000000000003'),
    'approved', 'The requested award exceeds the current policy cap.',
    'fa000000-0000-4000-8000-000000000004',
    'faa00000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'Appeal award must be between 0 and 1.00.',
  'appeal approval revalidates a policy changed after the appeal was submitted'
);

SELECT extensions.ok(
  (
    SELECT status = 'submitted' AND reviewed_at IS NULL
    FROM plugin_data.csf_point_appeals
    WHERE correlation_id = 'faa00000-0000-4000-8000-000000000003'
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_credit_records
    WHERE submission_id = 'fa900000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'faa00000-0000-4000-8000-000000000005'
  ),
  'stale-policy appeal review leaves zero appeal, credit, or audit partial writes'
);

UPDATE plugin_data.csf_term_policies
SET max_points_per_activity = 3, updated_at = now()
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND term_id = 'fa300000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals
      WHERE correlation_id = 'faa00000-0000-4000-8000-000000000003'),
    'approved', 'Current evidence supports the requested two-point award.',
    'fa000000-0000-4000-8000-000000000004',
    'faa00000-0000-4000-8000-000000000006'
  ) $$,
  'process_points authority may approve an appeal under current policy'
);

SELECT extensions.ok(
  (
    SELECT appeal.status = 'approved'
      AND submission.status = 'approved'
      AND credit.points = 2
      AND credit.status = 'verified'
    FROM plugin_data.csf_point_appeals AS appeal
    JOIN plugin_data.csf_point_submissions AS submission
      ON submission.organization_id = appeal.organization_id
     AND submission.id = appeal.submission_id
    JOIN plugin_data.csf_credit_records AS credit
      ON credit.organization_id = submission.organization_id
     AND credit.submission_id = submission.id
    WHERE appeal.correlation_id = 'faa00000-0000-4000-8000-000000000003'
  ),
  'appeal approval atomically commits appeal, submission, and credit state'
);

UPDATE plugin_data.csf_term_memberships
SET status = 'revoked', updated_at = now()
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND profile_id = 'fa400000-0000-4000-8000-000000000001'
  AND term_id = 'fa300000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    'fa900000-0000-4000-8000-000000000002',
    'Membership was revoked before this second appeal was submitted.', 1,
    'fa000000-0000-4000-8000-000000000001',
    'faa00000-0000-4000-8000-000000000007'
  ) $$,
  'P0001',
  'An accepted or active semester membership is required to appeal points.',
  'revoked semester membership closes appeal submission authority'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_point_appeals
    WHERE submission_id = 'fa900000-0000-4000-8000-000000000002'
  ),
  0,
  'revoked-membership appeal failure creates no appeal or audit state'
);

UPDATE plugin_data.csf_term_memberships
SET status = 'accepted', updated_at = now()
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND profile_id = 'fa400000-0000-4000-8000-000000000001'
  AND term_id = 'fa300000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, cohort_id, title, body, status,
  point_value, point_cap, point_type, requires_point_submission,
  evidence_policy, published_at, closed_at
) VALUES
  ('fa500000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'fa310000-0000-4000-8000-000000000001', 'Proof activity', 'Requires proof.', 'published', 2, 2.5, 'non_drive', true, 'required', now(), NULL),
  ('fa500000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'fa310000-0000-4000-8000-000000000001', 'Closed review activity', 'Closed after members served.', 'closed', 2, 2.5, 'non_drive', true, 'optional', now(), now()),
  ('fa500000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'fa310000-0000-4000-8000-000000000001', 'Optional proof activity', 'Optional proof.', 'published', 2, 2.5, 'non_drive', true, 'optional', now(), NULL),
  ('fa500000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'fa310000-0000-4000-8000-000000000003', 'Other class activity', 'Scoped to another class.', 'published', 2, 2.5, 'non_drive', true, 'optional', now(), NULL);

INSERT INTO plugin_data.csf_partner_clubs (
  id, organization_id, name, status
) VALUES (
  'fa510000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'Synthetic Service Club',
  'active'
);

INSERT INTO plugin_data.csf_partner_club_terms (
  id, organization_id, partner_club_id, term_id, relationship_status,
  workflow_status, approved_point_types, non_drive_points, drive_points,
  proof_required
) VALUES (
  'fa520000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'fa510000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'new',
  'active',
  ARRAY['non_drive']::text[],
  1,
  0,
  true
);

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, opportunity_id,
  partner_club_term_id, source, description, claimed_points,
  point_type, status, submitted_by
) VALUES
  (
    'fa900000-0000-4000-8000-000000000004',
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000003', NULL,
    'student', 'Activity appeal above its explicit cap.', 2,
    'non_drive', 'rejected', 'fa000000-0000-4000-8000-000000000001'
  ),
  (
    'fa900000-0000-4000-8000-000000000005',
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000001', NULL,
    'student', 'Required-proof activity appeal without proof.', 1,
    'non_drive', 'rejected', 'fa000000-0000-4000-8000-000000000001'
  ),
  (
    'fa900000-0000-4000-8000-000000000006',
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    NULL, 'fa520000-0000-4000-8000-000000000001',
    'student', 'Partner-club appeal above its term cap.', 1,
    'non_drive', 'rejected', 'fa000000-0000-4000-8000-000000000001'
  ),
  (
    'fa900000-0000-4000-8000-000000000007',
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000004', NULL,
    'student', 'Appeal for an activity assigned to another class.', 1,
    'non_drive', 'rejected', 'fa000000-0000-4000-8000-000000000001'
  );

SELECT plugin_data.csf_submit_point_appeal(
  'fa100000-0000-4000-8000-000000000001',
  'fa900000-0000-4000-8000-000000000004',
  'The activity evidence supports the requested three-point award.', 3,
  'fa000000-0000-4000-8000-000000000001',
  'fab00000-0000-4000-8000-000000000001'
);
SELECT plugin_data.csf_submit_point_appeal(
  'fa100000-0000-4000-8000-000000000001',
  'fa900000-0000-4000-8000-000000000005',
  'The required-proof activity should be reviewed again.', 1,
  'fa000000-0000-4000-8000-000000000001',
  'fab00000-0000-4000-8000-000000000002'
);
SELECT plugin_data.csf_submit_point_appeal(
  'fa100000-0000-4000-8000-000000000001',
  'fa900000-0000-4000-8000-000000000006',
  'The partner-club activity should receive a two-point award.', 2,
  'fa000000-0000-4000-8000-000000000001',
  'fab00000-0000-4000-8000-000000000003'
);
SELECT plugin_data.csf_submit_point_appeal(
  'fa100000-0000-4000-8000-000000000001',
  'fa900000-0000-4000-8000-000000000007',
  'The activity class assignment should be rechecked before award.', 1,
  'fa000000-0000-4000-8000-000000000001',
  'fab00000-0000-4000-8000-000000000004'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals
      WHERE correlation_id = 'fab00000-0000-4000-8000-000000000001'),
    'approved', 'The current activity cap remains authoritative.',
    'fa000000-0000-4000-8000-000000000004',
    'fac00000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Points exceed the selected activity limit of 2.50.',
  'appeal approval cannot exceed the linked activity cap'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals
      WHERE correlation_id = 'fab00000-0000-4000-8000-000000000002'),
    'approved', 'Required proof is still absent from this claim.',
    'fa000000-0000-4000-8000-000000000004',
    'fac00000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'A proof file is required for this point action.',
  'appeal approval revalidates the linked activity proof requirement'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals
      WHERE correlation_id = 'fab00000-0000-4000-8000-000000000003'),
    'approved', 'The partner-club cap remains authoritative.',
    'fa000000-0000-4000-8000-000000000004',
    'fac00000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'Points exceed the selected partner-club limit of 1.00.',
  'appeal approval cannot exceed the active partner-club term cap'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals
      WHERE correlation_id = 'fab00000-0000-4000-8000-000000000004'),
    'approved', 'The member class does not match the activity class.',
    'fa000000-0000-4000-8000-000000000004',
    'fac00000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'This CSF activity is assigned to a different class.',
  'appeal approval revalidates the linked activity class assignment'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 4
    FROM plugin_data.csf_point_appeals
    WHERE correlation_id::text LIKE 'fab00000-0000-4000-8000-%'
      AND status = 'submitted'
      AND reviewed_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_credit_records
    WHERE submission_id IN (
      'fa900000-0000-4000-8000-000000000004',
      'fa900000-0000-4000-8000-000000000005',
      'fa900000-0000-4000-8000-000000000006',
      'fa900000-0000-4000-8000-000000000007'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id::text LIKE 'fac00000-0000-4000-8000-%'
  ),
  'structured-source appeal failures leave zero appeal, credit, or decision-audit partial writes'
);

DELETE FROM plugin_data.csf_term_policies
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND term_id = 'fa300000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_appeal(
    'fa100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals
      WHERE correlation_id = 'fab00000-0000-4000-8000-000000000001'),
    'rejected', 'The appeal is denied without creating a new award.',
    'fa000000-0000-4000-8000-000000000004',
    'fac00000-0000-4000-8000-000000000004'
  ) $$,
  'a non-award appeal cleanup decision does not depend on a published policy'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_point_appeals
    WHERE correlation_id = 'fab00000-0000-4000-8000-000000000001'
  ),
  'rejected',
  'policy-independent appeal rejection still commits its audited terminal state'
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity,
  outside_volunteering_allowed, published_at
) VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  3,
  true,
  now()
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000003', NULL,
    'student', 'Another member cannot submit this claim.', 1, 'non_drive', current_date,
    'fa000000-0000-4000-8000-000000000002',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'fa700000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Only the connected member may submit this point claim.',
  'a same-organization account cannot submit against another member profile'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000002',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    NULL, NULL, 'staff', 'Unprivileged manual award.', 1, 'non_drive', current_date,
    'fa000000-0000-4000-8000-000000000005',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'fa700000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'Point-action actor does not have the required permission.',
  'staff organization membership alone cannot create a manual point claim'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000003',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000001', NULL,
    'student', 'Required proof was omitted.', 1, 'non_drive', current_date,
    'fa000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'fa700000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'A proof file is required for this point action.',
  'an activity with required evidence cannot create a proofless claim'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000010',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000003', NULL,
    'student', 'Blank object paths are not proof.', 1, 'non_drive', current_date,
    'fa000000-0000-4000-8000-000000000001',
    'fa610000-0000-4000-8000-000000000010', 'csf-private', '   ',
    'proof.pdf', 'application/pdf', 200,
    'fa620000-0000-4000-8000-000000000010',
    'fa700000-0000-4000-8000-000000000010'
  ) $$,
  'P0001',
  'Proof object path cannot be blank.',
  'blank storage metadata cannot satisfy an optional-proof source'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000004',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000003', NULL,
    'student', 'The claim exceeds the explicit activity cap.', 2.75, 'non_drive', current_date,
    'fa000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'fa700000-0000-4000-8000-000000000004'
  ) $$,
  'P0001',
  'Points exceed the selected activity limit of 2.50.',
  'an explicit activity point_cap is authoritative for partial claims'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000005',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    NULL, 'fa520000-0000-4000-8000-000000000001',
    'student', 'The partner claim exceeds its published cap.', 1.5, 'non_drive', current_date,
    'fa000000-0000-4000-8000-000000000001',
    'fa610000-0000-4000-8000-000000000005', 'csf-private',
    'organizations/point-authority/submissions/partner/proof.pdf',
    'proof.pdf', 'application/pdf', 200,
    'fa620000-0000-4000-8000-000000000005',
    'fa700000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'Points exceed the selected partner-club limit of 1.00.',
  'a partner-club claim cannot exceed its active term policy cap'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000006',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000004', NULL,
    'student', 'This activity belongs to another class.', 1, 'non_drive', current_date,
    'fa000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'fa700000-0000-4000-8000-000000000006'
  ) $$,
  'P0001',
  'This CSF activity is assigned to a different class.',
  'an activity cohort must match the member semester cohort'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000007',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    NULL, NULL, 'student', 'Outside service without proof.', 1, 'non_drive', current_date,
    'fa000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'fa700000-0000-4000-8000-000000000007'
  ) $$,
  'P0001',
  'A proof file is required for this point action.',
  'outside student volunteering always requires proof even when policy allows it'
);

SELECT extensions.is(
  (
    (SELECT count(*) FROM plugin_data.csf_point_submissions
      WHERE id::text LIKE 'fa600000-0000-4000-8000-%')
    + (SELECT count(*) FROM plugin_data.csf_submission_files
      WHERE submission_id::text LIKE 'fa600000-0000-4000-8000-%')
    + (SELECT count(*) FROM plugin_data.csf_admin_audit_events
      WHERE correlation_id::text LIKE 'fa700000-0000-4000-8000-%')
  ),
  0::bigint,
  'every rejected begin path leaves zero point, proof, and audit partial writes'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000008',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    NULL, NULL, 'staff', 'Authorized manual staff award.', 1, 'non_drive', current_date,
    'fa000000-0000-4000-8000-000000000003',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'fa700000-0000-4000-8000-000000000008'
  ) $$,
  'verify_submissions authority may create a manual staff claim without proof'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_point_submissions
    WHERE id = 'fa600000-0000-4000-8000-000000000008'
  ),
  'submitted',
  'an authorized proof-waived manual staff claim enters the review queue'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000009',
    'fa400000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    NULL, NULL, 'student', 'Outside service with private proof.', 2, 'non_drive', current_date,
    'fa000000-0000-4000-8000-000000000001',
    'fa610000-0000-4000-8000-000000000009', 'csf-private',
    'organizations/point-authority/submissions/outside/proof.pdf',
    'proof.pdf', 'application/pdf', 400,
    'fa620000-0000-4000-8000-000000000009',
    'fa700000-0000-4000-8000-000000000009'
  ) $$,
  'an allowed outside claim begins as one pending proof intent'
);

UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND user_id = 'fa000000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_finalize_point_submission_proof(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000009',
    'fa610000-0000-4000-8000-000000000009',
    'fa620000-0000-4000-8000-000000000009',
    'fa000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Point-action actor is not an active organization member.',
  'proof finalization stops closed when organization authority is revoked during upload'
);

SELECT extensions.ok(
  (
    SELECT submission.status = 'draft' AND proof.upload_status = 'pending'
    FROM plugin_data.csf_point_submissions AS submission
    JOIN plugin_data.csf_submission_files AS proof
      ON proof.organization_id = submission.organization_id
     AND proof.submission_id = submission.id
    WHERE submission.id = 'fa600000-0000-4000-8000-000000000009'
  ),
  'revoked-actor finalization leaves both submission and proof intent unchanged'
);

UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND user_id = 'fa000000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_term_policies
SET max_points_per_activity = 1, updated_at = now()
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND term_id = 'fa300000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_finalize_point_submission_proof(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000009',
    'fa610000-0000-4000-8000-000000000009',
    'fa620000-0000-4000-8000-000000000009',
    'fa000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Points exceed the semester activity limit of 1.00.',
  'proof finalization revalidates a policy cap changed after upload began'
);

SELECT extensions.ok(
  (
    SELECT submission.status = 'draft' AND proof.upload_status = 'pending'
    FROM plugin_data.csf_point_submissions AS submission
    JOIN plugin_data.csf_submission_files AS proof
      ON proof.organization_id = submission.organization_id
     AND proof.submission_id = submission.id
    WHERE submission.id = 'fa600000-0000-4000-8000-000000000009'
  ),
  'stale-policy finalization has zero partial state transition'
);

UPDATE plugin_data.csf_term_policies
SET max_points_per_activity = 3, updated_at = now()
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND term_id = 'fa300000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_finalize_point_submission_proof(
    'fa100000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000009',
    'fa610000-0000-4000-8000-000000000009',
    'fa620000-0000-4000-8000-000000000009',
    'fa000000-0000-4000-8000-000000000001'
  ) $$,
  'the same pending upload finalizes after current authority and policy recover'
);

SELECT extensions.ok(
  (
    SELECT submission.status = 'submitted'
      AND proof.upload_status = 'finalized'
      AND proof.finalized_at IS NOT NULL
    FROM plugin_data.csf_point_submissions AS submission
    JOIN plugin_data.csf_submission_files AS proof
      ON proof.organization_id = submission.organization_id
     AND proof.submission_id = submission.id
    WHERE submission.id = 'fa600000-0000-4000-8000-000000000009'
  ),
  'successful finalization commits the proof and reviewable submission together'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'fa700000-0000-4000-8000-000000000009'
  ),
  2,
  'proof begin and finalization retain one two-event correlation trail'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_withdraw_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000009',
    'fa000000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'Only the connected member may withdraw this point submission.',
  'another active chapter member cannot withdraw the owner submission'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_point_submissions
    WHERE id = 'fa600000-0000-4000-8000-000000000009'
  ),
  'submitted',
  'cross-actor withdrawal leaves the submitted claim unchanged'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_withdraw_point_submission(
    'fa100000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001',
    'fa600000-0000-4000-8000-000000000009',
    'fa000000-0000-4000-8000-000000000001'
  ) $$,
  'the verified active owner may withdraw an untouched current-term student claim'
);

SELECT extensions.ok(
  (
    SELECT status = 'withdrawn'
    FROM plugin_data.csf_point_submissions
    WHERE id = 'fa600000-0000-4000-8000-000000000009'
  )
  AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'fa600000-0000-4000-8000-000000000009'
      AND action = 'point_submission.withdraw'
  ),
  'successful withdrawal and its audit event commit atomically'
);

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, opportunity_id, source,
  description, claimed_points, point_type, status, submitted_by
) VALUES
  ('fa800000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'fa500000-0000-4000-8000-000000000002', 'student', 'Closed activity awaiting review.', 2, 'non_drive', 'submitted', 'fa000000-0000-4000-8000-000000000001'),
  ('fa800000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'fa500000-0000-4000-8000-000000000003', 'student', 'Claim awaiting a stale-policy review.', 2, 'non_drive', 'submitted', 'fa000000-0000-4000-8000-000000000001'),
  ('fa800000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', NULL, 'student', 'Claim that should be rejected without policy dependence.', 1, 'non_drive', 'submitted', 'fa000000-0000-4000-8000-000000000001'),
  ('fa800000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'fa500000-0000-4000-8000-000000000001', 'student', 'Required proof is absent at review.', 1, 'non_drive', 'submitted', 'fa000000-0000-4000-8000-000000000001'),
  ('fa800000-0000-4000-8000-000000000005', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', NULL, 'sheet', 'Imported points use reconciliation, not member review.', 1, 'non_drive', 'submitted', 'fa000000-0000-4000-8000-000000000003');

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_v2(
    'fa100000-0000-4000-8000-000000000001',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'approved', 1, NULL,
    'fa000000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'Point-action actor does not have the required permission.',
  'submission review checks canonical verify_submissions authority before target lookup'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_v2(
    'fa100000-0000-4000-8000-000000000001',
    'fa800000-0000-4000-8000-000000000001',
    'approved', 2, NULL,
    'fa000000-0000-4000-8000-000000000003'
  ) $$,
  'a normally closed activity remains awardable after service evidence was submitted'
);

SELECT extensions.ok(
  (
    SELECT status = 'approved'
    FROM plugin_data.csf_point_submissions
    WHERE id = 'fa800000-0000-4000-8000-000000000001'
  )
  AND (
    SELECT points = 2 AND status = 'verified'
    FROM plugin_data.csf_credit_records
    WHERE submission_id = 'fa800000-0000-4000-8000-000000000001'
  ),
  'closed-activity approval atomically commits submission and credit state'
);

UPDATE plugin_data.csf_term_policies
SET max_points_per_activity = 1, updated_at = now()
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND term_id = 'fa300000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_v2(
    'fa100000-0000-4000-8000-000000000001',
    'fa800000-0000-4000-8000-000000000002',
    'approved', 2, NULL,
    'fa000000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'Awarded points must be between 0 and 1.00.',
  'approval revalidates the current published policy cap under lock'
);

SELECT extensions.ok(
  (
    SELECT status = 'submitted' AND reviewed_at IS NULL
    FROM plugin_data.csf_point_submissions
    WHERE id = 'fa800000-0000-4000-8000-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_credit_records
    WHERE submission_id = 'fa800000-0000-4000-8000-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_submission_reviews
    WHERE submission_id = 'fa800000-0000-4000-8000-000000000002'
  ),
  'stale-policy approval leaves zero submission, review, or credit partial writes'
);

UPDATE plugin_data.csf_term_policies
SET max_points_per_activity = 3, updated_at = now()
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND term_id = 'fa300000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_v2(
    'fa100000-0000-4000-8000-000000000001',
    'fa800000-0000-4000-8000-000000000004',
    'approved', 1, NULL,
    'fa000000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'A proof file is required for this point action.',
  'approval rederives the selected activity proof requirement'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_credit_records
    WHERE submission_id = 'fa800000-0000-4000-8000-000000000004'
  ),
  0,
  'missing-proof approval creates no credit record'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_v2(
    'fa100000-0000-4000-8000-000000000001',
    'fa800000-0000-4000-8000-000000000005',
    'approved', 1, NULL,
    'fa000000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'This point source must use its dedicated reconciliation workflow.',
  'sheet ingestion cannot be approved through the member-submission wrapper'
);

DELETE FROM plugin_data.csf_term_policies
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND term_id = 'fa300000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_review_point_submission_v2(
    'fa100000-0000-4000-8000-000000000001',
    'fa800000-0000-4000-8000-000000000003',
    'rejected', NULL, 'Claim does not meet the documented requirements.',
    'fa000000-0000-4000-8000-000000000003'
  ) $$,
  'a rejection cleanup decision does not depend on a published award policy'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_point_submissions
    WHERE id = 'fa800000-0000-4000-8000-000000000003'
  ),
  'rejected',
  'the policy-independent rejection still commits its audited terminal state'
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity,
  outside_volunteering_allowed, published_at
) VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  3,
  true,
  now()
);

SELECT * FROM extensions.finish();

ROLLBACK;
