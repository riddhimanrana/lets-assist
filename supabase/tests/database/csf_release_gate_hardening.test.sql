BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(46);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'cf000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'restricted-officer@local.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    'cf000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'bounded-member@local.test', now(),
    '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'cf100000-0000-4000-8000-000000000001',
    'Release Gate One', 'release-gate-one', 'school', '976701'
  ),
  (
    'cf100000-0000-4000-8000-000000000002',
    'Release Gate Two', 'release-gate-two', 'school', '976702'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001', 'staff', 'active'
  ),
  (
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000002', 'member', 'active'
  );

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'cf000000-0000-4000-8000-000000000010',
    'authenticated', 'authenticated', 'reply-one@local.test', now(),
    '{}', '{"full_name":"Reply One"}', now(), now()
  ),
  (
    'cf000000-0000-4000-8000-000000000011',
    'authenticated', 'authenticated', 'reply-two@local.test', now(),
    '{}', '{"full_name":"Reply Two"}', now(), now()
  ),
  (
    'cf000000-0000-4000-8000-000000000012',
    'authenticated', 'authenticated', 'reply-three@local.test', now(),
    '{}', '{"full_name":"Reply Three"}', now(), now()
  ),
  (
    'cf000000-0000-4000-8000-000000000013',
    'authenticated', 'authenticated', 'reply-old@local.test', now(),
    '{}', '{"full_name":"Reply Old"}', now(), now()
  );

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'cf200000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'fall-2026', 'Fall 2026', '2026-2027', 'fall', true
);

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type, is_system
) VALUES (
  'cf300000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'restricted-home', 'Restricted home', 'custom', false
);

INSERT INTO plugin_data.csf_staff_positions (
  id, organization_id, user_id, role_id, school_year,
  display_title, status
) VALUES (
  'cf400000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  '2026-2027', 'Restricted officer', 'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'cf500000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'Bounded', 'Member', 'bounded', 'member'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000002',
  'verified', true
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
)
SELECT
  md5('release-gate-cohort-' || value::text)::uuid,
  'cf100000-0000-4000-8000-000000000001'::uuid,
  2040 + value,
  'Class ' || value::text
FROM generate_series(1, 55) AS value;

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
)
SELECT
  cohort.organization_id,
  'cf500000-0000-4000-8000-000000000001'::uuid,
  cohort.id,
  'active'
FROM plugin_data.csf_cohorts AS cohort
WHERE cohort.organization_id = 'cf100000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  submission_status, eligibility_status, decision_status
) VALUES (
  'cf510000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  md5('release-gate-cohort-1')::uuid,
  'cf200000-0000-4000-8000-000000000001',
  'native', 'submitted', 'ready', 'pending', 'pending'
);

INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label
) VALUES (
  'cf520000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'release-gate-meeting', 'Release gate meeting'
);

INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, session_date, starts_at
) VALUES (
  'cf520000-0000-4000-8000-000000000002',
  'cf100000-0000-4000-8000-000000000001',
  'cf520000-0000-4000-8000-000000000001',
  current_date + 1, now() + interval '1 day'
);

INSERT INTO plugin_data.csf_term_deadlines (
  id, organization_id, term_id, deadline_type, title, due_at, audience
) VALUES (
  'cf530000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'application_close', 'Release gate deadline', now() + interval '2 days',
  'members'
);

INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label
) VALUES (
  'cf540000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'release-gate-term-meeting', 'Release gate term meeting'
);

INSERT INTO plugin_data.csf_profile_restrictions (
  id, organization_id, profile_id, scope, status
) VALUES (
  'cf550000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'manual_review_required', 'active'
);

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, status
) VALUES (
  'cf560000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001', 'submitted'
);

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, status
) VALUES (
  'cf570000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'Release gate activity', 'Fictional activity', 'published'
);

INSERT INTO plugin_data.csf_profile_activity_events (
  id, organization_id, profile_id, term_id, opportunity_id,
  event_type, title
) VALUES (
  'cf580000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'cf570000-0000-4000-8000-000000000001',
  'opportunity', 'Release gate activity'
);

INSERT INTO plugin_data.csf_opportunity_signups (
  id, organization_id, opportunity_id, profile_id, term_id
) VALUES (
  'cf590000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf570000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, term_id, title, body, status, published_at, created_by
) VALUES (
  'cf5a0000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'Release gate post', 'Fictional post', 'published', now(),
  'cf000000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_announcement_replies (
  id, organization_id, announcement_id, body, created_by, created_at
) VALUES
  (
    'cf5b0000-0000-4000-8000-000000000001',
    'cf100000-0000-4000-8000-000000000001',
    'cf5a0000-0000-4000-8000-000000000001',
    'Old reply', 'cf000000-0000-4000-8000-000000000013', now() - interval '4 minutes'
  ),
  (
    'cf5b0000-0000-4000-8000-000000000002',
    'cf100000-0000-4000-8000-000000000001',
    'cf5a0000-0000-4000-8000-000000000001',
    'Reply one', 'cf000000-0000-4000-8000-000000000010', now() - interval '3 minutes'
  ),
  (
    'cf5b0000-0000-4000-8000-000000000003',
    'cf100000-0000-4000-8000-000000000001',
    'cf5a0000-0000-4000-8000-000000000001',
    'Reply two', 'cf000000-0000-4000-8000-000000000011', now() - interval '2 minutes'
  ),
  (
    'cf5b0000-0000-4000-8000-000000000004',
    'cf100000-0000-4000-8000-000000000001',
    'cf5a0000-0000-4000-8000-000000000001',
    'Reply three', 'cf000000-0000-4000-8000-000000000012', now() - interval '1 minute'
  );

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'csf_class_workbooks_cohort_organization_fk'
      AND convalidated
  ),
  'the workbook class reference is tenant-bound and validated'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'csf_class_workbook_refresh_jobs_workbook_organization_fk'
      AND convalidated
  ),
  'the refresh job workbook reference is tenant-bound and validated'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_class_workbooks (
    organization_id, cohort_id, drive_file_id, state
  ) VALUES (
    'cf100000-0000-4000-8000-000000000002',
    md5('release-gate-cohort-1')::uuid,
    'wrong-tenant-workbook', 'linked'
  )$$,
  '23503',
  NULL,
  'a workbook cannot pair an organization with another tenant class'
);

INSERT INTO plugin_data.csf_class_workbooks (
  id, organization_id, cohort_id, drive_file_id, state
) VALUES (
  'cf600000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  md5('release-gate-cohort-1')::uuid,
  'tenant-workbook', 'linked'
);

SELECT extensions.throws_ok(
  $$INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
    organization_id, workbook_id, provider_version, drive_file_id
  ) VALUES (
    'cf100000-0000-4000-8000-000000000002',
    'cf600000-0000-4000-8000-000000000001',
    '1',
    'tenant-workbook'
  )$$,
  '23503',
  NULL,
  'a refresh job cannot pair an organization with another tenant workbook'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role', 'plugin_data.csf_import_approval_batches', 'DELETE'
  ),
  'service_role cannot delete approval batch receipts'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role', 'plugin_data.csf_import_approval_batch_items', 'DELETE'
  ),
  'service_role cannot delete approval batch items'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role', 'plugin_data.csf_import_commit_queue', 'DELETE'
  ),
  'service_role cannot delete import commit receipts'
);

INSERT INTO plugin_data.csf_import_approval_batches (
  id, organization_id, actor_user_id, request_id, requested_count
) VALUES (
  'cf700000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  'cf700000-0000-4000-8000-000000000002',
  2
);

UPDATE plugin_data.csf_import_approval_batches
SET queued_count = 1, blocked_count = 1, updated_at = now()
WHERE id = 'cf700000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'cf700000-0000-4000-8000-000000000001'
      AND action = 'sheets.import_batch_approved'
  ),
  1,
  'freezing an approval batch writes one immutable audit event'
);

SELECT extensions.is(
  (
    SELECT after_data ->> 'requested'
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'cf700000-0000-4000-8000-000000000001'
      AND action = 'sheets.import_batch_approved'
  ),
  '2',
  'the approval audit stores count-only batch evidence'
);

INSERT INTO plugin_data.csf_import_approval_batches (
  id, organization_id, actor_user_id, request_id, requested_count
) VALUES (
  'cf700000-0000-4000-8000-000000000003',
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  'cf700000-0000-4000-8000-000000000004',
  1
);

UPDATE plugin_data.csf_import_approval_batches
SET blocked_count = 1, status = 'completed', updated_at = now()
WHERE id = 'cf700000-0000-4000-8000-000000000003';

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_import_approval_batches
    WHERE id = 'cf700000-0000-4000-8000-000000000003'
  ),
  'partially_completed',
  'an all-blocked approval batch settles as partially completed'
);

SELECT extensions.is(
  (
    SELECT after_data ->> 'status'
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'cf700000-0000-4000-8000-000000000003'
      AND action = 'sheets.import_batch_settled'
  ),
  'partially_completed',
  'the settlement audit records the normalized blocked status'
);

SELECT extensions.throws_ok(
  $$UPDATE plugin_data.csf_admin_audit_events
    SET action = 'changed'
    WHERE target_id = 'cf700000-0000-4000-8000-000000000001'$$,
  'P0001',
  'CSF audit events are immutable.',
  'the approval event cannot be changed after it is written'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'profileCount')::integer,
  0,
  'a restricted officer does not receive profile counts'
);

SELECT extensions.is(
  plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'applications' ->> 'currentTermId',
  NULL::text,
  'a restricted officer does not receive application term state'
);

SELECT extensions.is(
  plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'applications' -> 'recentApprovals',
  '[]'::jsonb,
  'the grouped Home projection exposes no applicant names'
);

SELECT extensions.is(
  jsonb_array_length(
    plugin_data.csf_member_home_context_snapshot(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000002',
      now() - interval '36 hours',
      now() + interval '16 days',
      current_date - 2
    ) -> 'meetingSessions'
  ),
  0,
  'a pending application does not expose the semester meeting agenda'
);

SELECT extensions.is(
  jsonb_array_length(
    plugin_data.csf_member_home_context_snapshot(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000002',
      now() - interval '36 hours',
      now() + interval '16 days',
      current_date - 2
    ) -> 'deadlines'
  ),
  0,
  'a pending application does not expose the semester deadline agenda'
);

SELECT extensions.is(
  jsonb_array_length(
    plugin_data.csf_member_home_context_snapshot(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000002',
      now() - interval '36 hours',
      now() + interval '16 days',
      current_date - 2
    ) -> 'activities'
  ),
  0,
  'a pending application does not expose current-semester activities'
);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'manage_partner_clubs'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'opportunityCount')::integer,
  0,
  'partner-club management does not reveal the activity count'
);

DELETE FROM plugin_data.csf_role_permissions
WHERE role_id = 'cf300000-0000-4000-8000-000000000001'
  AND permission_key = 'manage_partner_clubs';

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'manage_opportunities'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'opportunityCount')::integer,
  1,
  'activity managers receive the activity count'
);

DELETE FROM plugin_data.csf_role_permissions
WHERE role_id = 'cf300000-0000-4000-8000-000000000001'
  AND permission_key = 'manage_opportunities';

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'verify_submissions'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'pendingSubmissionCount')::integer,
  1,
  'submission reviewers receive the pending submission count'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'applicationCount')::integer,
  0,
  'submission review does not reveal application counts'
);

DELETE FROM plugin_data.csf_role_permissions
WHERE role_id = 'cf300000-0000-4000-8000-000000000001'
  AND permission_key = 'verify_submissions';

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'manage_restrictions'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'activeRestrictionCount')::integer,
  1,
  'restriction managers receive the active restriction count'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'profileCount')::integer,
  0,
  'restriction management does not reveal the full profile count'
);

DELETE FROM plugin_data.csf_role_permissions
WHERE role_id = 'cf300000-0000-4000-8000-000000000001'
  AND permission_key = 'manage_restrictions';

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'manage_cohorts_terms'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'termMeetingCount')::integer,
  1,
  'class and semester managers receive the term meeting count'
);

DELETE FROM plugin_data.csf_role_permissions
WHERE role_id = 'cf300000-0000-4000-8000-000000000001'
  AND permission_key = 'manage_cohorts_terms';

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'process_points'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'activityEventCount')::integer,
  1,
  'point processors receive the credited activity count'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'signupCount')::integer,
  0,
  'point processing does not reveal participation signup counts'
);

DELETE FROM plugin_data.csf_role_permissions
WHERE role_id = 'cf300000-0000-4000-8000-000000000001'
  AND permission_key = 'process_points';

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'verify_participation'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'signupCount')::integer,
  1,
  'participation reviewers receive the signup count'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'activityEventCount')::integer,
  0,
  'participation review does not reveal credited activity counts'
);

DELETE FROM plugin_data.csf_role_permissions
WHERE role_id = 'cf300000-0000-4000-8000-000000000001'
  AND permission_key = 'verify_participation';

UPDATE plugin_data.csf_term_applications
SET status = 'accepted',
    submission_status = 'decided',
    eligibility_status = 'eligible',
    decision_status = 'approved',
    reviewed_at = now()
WHERE id = 'cf510000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'view_applications'
);

SELECT extensions.is(
  jsonb_array_length(
    plugin_data.csf_officer_home_snapshot(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001'
    ) -> 'applications' -> 'recentApprovals'
  ),
  1,
  'application viewers receive the bounded recent approval list'
);

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)'::regprocedure
  ) LIKE '%blocked_count = counts.blocked_count%'
  AND pg_catalog.pg_get_functiondef(
    'plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)'::regprocedure
  ) LIKE '%stale_count = counts.stale_count%',
  'queue settlement recomputes terminal blocked and stale batch counts'
);

SELECT extensions.is(
  jsonb_array_length(
    plugin_data.csf_member_profile_snapshot(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000002'
    ) -> 'memberships'
  ),
  50,
  'member cohort history is capped at fifty rows'
);

SELECT extensions.ok(
  pg_catalog.regexp_count(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_member_profile_snapshot(uuid,uuid)'::regprocedure
    ),
    'LIMIT 50'
  ) >= 9,
  'every member snapshot list has an explicit fifty-row bound'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated', 'plugin_data.csf_officer_home_snapshot(uuid,uuid)', 'EXECUTE'
  ),
  'the corrected officer snapshot remains server-only'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated', 'plugin_data.csf_member_profile_snapshot(uuid,uuid)', 'EXECUTE'
  ),
  'the corrected member snapshot remains server-only'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role', 'plugin_data.csf_audit_import_approval_batch()', 'EXECUTE'
  ),
  'the batch audit trigger function remains owner-internal'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role', 'plugin_data.csf_officer_home_snapshot(uuid,uuid)', 'EXECUTE'
  ),
  'service_role can execute the corrected officer snapshot'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role', 'plugin_data.csf_member_profile_snapshot(uuid,uuid)', 'EXECUTE'
  ),
  'service_role can execute the corrected member snapshot'
);

SELECT extensions.is(
  plugin_data.csf_member_home_context_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000002',
    now() - interval '36 hours',
    now() + interval '16 days',
    current_date - 2
  ) -> 'viewer' ->> 'profileId',
  'cf500000-0000-4000-8000-000000000001',
  'the grouped member Home context resolves the verified profile server-side'
);

SELECT extensions.is(
  jsonb_array_length(
    plugin_data.csf_member_home_context_snapshot(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000002',
      now() - interval '36 hours',
      now() + interval '16 days',
      current_date - 2
    ) -> 'cohorts'
  ),
  50,
  'the grouped member Home context caps class metadata at fifty rows'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_member_home_context_snapshot(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000099',
    now() - interval '36 hours',
    now() + interval '16 days',
    current_date - 2
  )$$,
  '42501',
  'CSF member dashboard access denied.',
  'the grouped member Home context refuses an unaffiliated actor'
);

SELECT extensions.is(
  plugin_data.csf_member_stream_enrichment(
    'cf100000-0000-4000-8000-000000000001',
    ARRAY[]::uuid[], ARRAY[]::uuid[], ARRAY[]::uuid[]
  ) -> 'replyPreviews',
  '[]'::jsonb,
  'empty stream coordinates return an empty bounded decoration snapshot'
);

SELECT extensions.is(
  jsonb_array_length(
    plugin_data.csf_member_stream_enrichment(
      'cf100000-0000-4000-8000-000000000001',
      ARRAY['cf5a0000-0000-4000-8000-000000000001'::uuid],
      ARRAY[]::uuid[], ARRAY[]::uuid[]
    ) -> 'authors'
  ),
  4,
  'stream authors include the post author and only three previewed reply authors'
);

SELECT extensions.ok(
  NOT (
    plugin_data.csf_member_stream_enrichment(
      'cf100000-0000-4000-8000-000000000001',
      ARRAY['cf5a0000-0000-4000-8000-000000000001'::uuid],
      ARRAY[]::uuid[], ARRAY[]::uuid[]
    ) -> 'authors'
  ) @> '[{"id":"cf000000-0000-4000-8000-000000000013"}]'::jsonb,
  'an author outside the three-reply preview is not exposed'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_member_home_context_snapshot(uuid,uuid,timestamptz,timestamptz,date)',
    'EXECUTE'
  ),
  'the grouped member Home context remains server-only'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_member_stream_enrichment(uuid,uuid[],uuid[],uuid[])',
    'EXECUTE'
  ),
  'the grouped stream decoration remains server-only'
);

SELECT * FROM extensions.finish();
ROLLBACK;
