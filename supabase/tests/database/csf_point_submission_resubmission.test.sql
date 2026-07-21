BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(25);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_resubmit_point_submission(uuid,uuid,numeric,text,date,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute point-submission resubmission'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_resubmit_point_submission(uuid,uuid,numeric,text,date,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the member resubmission action'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_resubmit_point_submission(uuid,uuid,numeric,text,date,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can execute the atomic resubmission workflow'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('f8000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'resubmit-owner@local.test', now(), '{}', '{}', now(), now()),
  ('f8000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'resubmit-other@local.test', now(), '{}', '{}', now(), now()),
  ('f8000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'resubmit-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('f8100000-0000-4000-8000-000000000001', 'CSF Resubmission', 'csf-resubmission', 'school', '998101');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('f8100000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('f8100000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('f8100000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000003', 'staff', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current, lifecycle_status
) VALUES
  ('f8200000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'F31', 'Fall 2031', '2031-2032', 'fall', true, 'open'),
  ('f8200000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000001', 'S31', 'Spring 2031', '2030-2031', 'spring', false, 'open');

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity, outside_volunteering_allowed
) VALUES
  ('f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 3, false),
  ('f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 3, false);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES (
  'f8300000-0000-4000-8000-000000000001',
  'f8100000-0000-4000-8000-000000000001',
  'Resubmit', 'Member', 'resubmit', 'member'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'f8100000-0000-4000-8000-000000000001',
  'f8300000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000001',
  'verified', true
);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, status
) VALUES
  ('f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'active'),
  ('f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 'active');

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, point_value, point_type,
  requires_point_submission, evidence_policy, status
) VALUES
  ('f8400000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Claimable activity', 'Fixture', 3, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Roster activity', 'Fixture', 3, 'non_drive', false, 'optional', 'published'),
  ('f8400000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Draft activity', 'Fixture', 3, 'non_drive', true, 'optional', 'draft'),
  ('f8400000-0000-4000-8000-000000000004', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 'Past activity', 'Fixture', 3, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000005', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Submitted activity', 'Fixture', 3, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000006', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Policy activity', 'Fixture', 5, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000007', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Type activity', 'Fixture', 3, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000008', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Missing proof activity', 'Fixture', 3, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000009', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Pending proof activity', 'Fixture', 3, 'non_drive', true, 'required', 'published');

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, opportunity_id, source, description,
  claimed_points, point_type, activity_date, status, submitted_by,
  reviewed_by, reviewed_at, review_notes
) VALUES
  ('f8500000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000001', 'student', 'Original description', 2.5, 'non_drive', '2031-09-01', 'needs_action', 'f8000000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000003', now(), 'Clarify the activity and points.'),
  ('f8500000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000005', 'student', 'Submitted fixture', 2, 'non_drive', '2031-09-02', 'submitted', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 'f8400000-0000-4000-8000-000000000004', 'student', 'Prior term fixture', 2, 'non_drive', '2031-03-02', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000004', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000002', 'student', 'Roster fixture', 2, 'non_drive', '2031-09-03', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000005', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000003', 'student', 'Draft fixture', 2, 'non_drive', '2031-09-04', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000006', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000006', 'student', 'Policy fixture', 2, 'non_drive', '2031-09-05', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000007', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000007', 'student', 'Type fixture', 2, 'non_drive', '2031-09-06', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000008', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000008', 'student', 'Missing proof fixture', 2, 'non_drive', '2031-09-07', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000009', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000009', 'student', 'Pending proof fixture', 2, 'non_drive', '2031-09-08', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL);

INSERT INTO plugin_data.csf_submission_files (
  id, organization_id, submission_id, profile_id, term_id, bucket, object_path,
  original_filename, mime_type, size_bytes, uploaded_by, upload_status,
  upload_token, finalized_at
) VALUES
  ('f8600000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'csf-private', 'resubmit/valid.pdf', 'valid.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000003', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 'csf-private', 'resubmit/prior.pdf', 'prior.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000006', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'csf-private', 'resubmit/policy.pdf', 'policy.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000004', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000007', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'csf-private', 'resubmit/type.pdf', 'type.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000005', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000009', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'csf-private', 'resubmit/pending.pdf', 'pending.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'pending', 'f8700000-0000-4000-8000-000000000001', NULL);

INSERT INTO plugin_data.csf_submission_reviews (
  organization_id, submission_id, actor_user_id, action, previous_status,
  next_status, notes, details
) VALUES (
  'f8100000-0000-4000-8000-000000000001',
  'f8500000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000003',
  'needs_action', 'submitted', 'needs_action',
  'Clarify the activity and points.',
  '{"correlationId":"f8800000-0000-4000-8000-000000000001"}'::jsonb
);

INSERT INTO plugin_data.csf_admin_audit_events (
  organization_id, actor_user_id, actor_profile_id, action, target_type,
  target_id, term_id, before_data, after_data, correlation_id,
  source_type, source_id, reason_code
) VALUES (
  'f8100000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000003',
  'f8300000-0000-4000-8000-000000000001',
  'point_submission.review', 'csf_point_submissions',
  'f8500000-0000-4000-8000-000000000001',
  'f8200000-0000-4000-8000-000000000001',
  '{"status":"submitted"}'::jsonb,
  '{"status":"needs_action"}'::jsonb,
  'f8800000-0000-4000-8000-000000000001',
  'point_submission',
  'f8500000-0000-4000-8000-000000000001',
  'point_submission_correction_requested'
);

CREATE TEMP TABLE csf_resubmission_results (
  label text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_resubmission_results (label, payload)
    SELECT 'valid', plugin_data.csf_resubmit_point_submission(
      'f8100000-0000-4000-8000-000000000001',
      'f8500000-0000-4000-8000-000000000001',
      2,
      'non_drive',
      '2031-09-01',
      'Corrected activity description',
      'f8000000-0000-4000-8000-000000000001',
      'f8800000-0000-4000-8000-000000000002'
    )
  $$,
  'the connected member can correct and atomically resubmit a needs-action claim'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'f8500000-0000-4000-8000-000000000001'),
  'submitted',
  'the corrected claim returns to the officer review queue'
);
SELECT extensions.is(
  (SELECT claimed_points::text FROM plugin_data.csf_point_submissions WHERE id = 'f8500000-0000-4000-8000-000000000001'),
  '2.00',
  'the corrected numeric claim replaces the prior value'
);
SELECT extensions.is(
  (SELECT description FROM plugin_data.csf_point_submissions WHERE id = 'f8500000-0000-4000-8000-000000000001'),
  'Corrected activity description',
  'the corrected description replaces the prior summary value'
);
SELECT extensions.ok(
  (
    SELECT reviewed_by IS NULL AND reviewed_at IS NULL AND review_notes IS NULL
    FROM plugin_data.csf_point_submissions
    WHERE id = 'f8500000-0000-4000-8000-000000000001'
  ),
  'resubmission clears only the mutable review summary'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_submission_reviews WHERE submission_id = 'f8500000-0000-4000-8000-000000000001'),
  2,
  'resubmission appends review history instead of replacing the correction request'
);
SELECT extensions.is(
  (
    SELECT notes FROM plugin_data.csf_submission_reviews
    WHERE submission_id = 'f8500000-0000-4000-8000-000000000001'
      AND action = 'needs_action'
  ),
  'Clarify the activity and points.',
  'the original officer correction request remains unchanged'
);
SELECT extensions.ok(
  (
    SELECT previous_status = 'needs_action'
      AND next_status = 'submitted'
      AND details->>'correlationId' = 'f8800000-0000-4000-8000-000000000002'
      AND (details->>'previousClaimedPoints')::numeric = 2.5
      AND (details->>'claimedPoints')::numeric = 2
    FROM plugin_data.csf_submission_reviews
    WHERE submission_id = 'f8500000-0000-4000-8000-000000000001'
      AND action = 'resubmitted'
  ),
  'the appended review records the correction delta and correlation'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE target_id = 'f8500000-0000-4000-8000-000000000001'),
  2,
  'resubmission appends one audit event without replacing the officer event'
);
SELECT extensions.ok(
  (
    SELECT actor_user_id = 'f8000000-0000-4000-8000-000000000001'
      AND actor_profile_id = 'f8300000-0000-4000-8000-000000000001'
      AND before_data->>'status' = 'needs_action'
      AND after_data->>'status' = 'submitted'
      AND correlation_id = 'f8800000-0000-4000-8000-000000000002'
      AND reason_code = 'point_submission_corrected_by_member'
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'f8500000-0000-4000-8000-000000000001'
      AND action = 'point_submission.resubmit'
  ),
  'the resubmission audit retains owner, state, correlation, and reason provenance'
);
SELECT extensions.is(
  (
    SELECT after_data->>'status'
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'f8800000-0000-4000-8000-000000000001'
  ),
  'needs_action',
  'the original officer audit event remains unchanged'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission(
    'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000002',
    2, 'non_drive', '2031-09-02', 'Wrong owner correction',
    'f8000000-0000-4000-8000-000000000002', 'f8800000-0000-4000-8000-000000000003'
  ) $$,
  'P0001', 'Only the connected member may correct and resubmit this point submission.',
  'another organization member cannot resubmit the claim'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission(
    'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000002',
    2, 'non_drive', '2031-09-02', 'Wrong state correction',
    'f8000000-0000-4000-8000-000000000001', 'f8800000-0000-4000-8000-000000000004'
  ) $$,
  'P0001', 'Only a correction-requested point submission can be resubmitted.',
  'an untouched submitted claim cannot enter the correction workflow'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission(
    'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000003',
    2, 'non_drive', '2031-03-02', 'Past term correction',
    'f8000000-0000-4000-8000-000000000001', 'f8800000-0000-4000-8000-000000000005'
  ) $$,
  'P0001', 'Point corrections are only available for the current open semester.',
  'a prior-semester claim cannot be resubmitted'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission(
    'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000004',
    2, 'non_drive', '2031-09-03', 'Roster activity correction',
    'f8000000-0000-4000-8000-000000000001', 'f8800000-0000-4000-8000-000000000006'
  ) $$,
  'P0001', 'Credit for this activity is recorded by an officer; member resubmission is not allowed.',
  'an officer-recorded activity cannot be converted into a member claim'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission(
    'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000005',
    2, 'non_drive', '2031-09-04', 'Draft activity correction',
    'f8000000-0000-4000-8000-000000000001', 'f8800000-0000-4000-8000-000000000007'
  ) $$,
  'P0001', 'This CSF activity is not open for member point submissions.',
  'an unpublished activity cannot receive a corrected member claim'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission(
    'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000006',
    4, 'non_drive', '2031-09-05', 'Over-policy correction',
    'f8000000-0000-4000-8000-000000000001', 'f8800000-0000-4000-8000-000000000008'
  ) $$,
  'P0001', 'Claimed points must be between 0 and 3.00.',
  'corrected points cannot exceed the published semester policy'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission(
    'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000007',
    2, 'drive', '2031-09-06', 'Wrong point type correction',
    'f8000000-0000-4000-8000-000000000001', 'f8800000-0000-4000-8000-000000000009'
  ) $$,
  'P0001', 'Point type does not match the selected activity.',
  'the corrected point type must match the selected activity'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission(
    'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000008',
    2, 'non_drive', '2031-09-07', 'Missing proof correction',
    'f8000000-0000-4000-8000-000000000001', 'f8800000-0000-4000-8000-00000000000a'
  ) $$,
  'P0001', 'A finalized proof file is required before resubmission.',
  'a proof-required activity cannot be resubmitted without finalized proof'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission(
    'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000009',
    2, 'non_drive', '2031-09-08', 'Pending proof correction',
    'f8000000-0000-4000-8000-000000000001', 'f8800000-0000-4000-8000-00000000000b'
  ) $$,
  'P0001', 'Point-submission proof must be finalized before resubmission.',
  'a pending proof upload cannot enter officer review'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_submission_reviews
    WHERE action = 'resubmitted'
      AND submission_id <> 'f8500000-0000-4000-8000-000000000001'
  ),
  0,
  'failed resubmissions never append review history'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE action = 'point_submission.resubmit'
      AND target_id <> 'f8500000-0000-4000-8000-000000000001'
  ),
  0,
  'failed resubmissions never append audit history'
);

SELECT extensions.finish();
ROLLBACK;
