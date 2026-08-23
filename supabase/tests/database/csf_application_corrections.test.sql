-- Member-scoped application corrections and their officer review. This
-- coverage moved out of the retired direct-invitation suite when
-- 20260823211000 dropped the invitation flow: the connected member is now a
-- fixture profile account instead of an accepted invitation.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(14);

SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_submit_application_correction(uuid,uuid,plugin_data.csf_application_check_type,text,jsonb,uuid)', 'EXECUTE'),
  'authenticated clients cannot submit a correction for another user directly'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_review_application_correction(uuid,uuid,text,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot review corrections directly'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_submit_application_correction(uuid,uuid,plugin_data.csf_application_check_type,text,jsonb,uuid)', 'EXECUTE'),
  'the server role can invoke atomic member corrections'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_application_correction_requests', 'SELECT'),
  'student corrections remain behind server projections'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'correction-officer@local.test', now(), '{}', '{}', now(), now()),
  ('d1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'connected-student@local.test', now(), '{}', '{}', now(), now()),
  ('d1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'different-student@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('d1100000-0000-4000-8000-000000000001', 'CSF Correction Test', 'csf-correction-test', 'school', '991101');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('d1100000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('d1100000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('d1100000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 'member', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('d1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('d1300000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 2031, 'Class of 2031');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('d1400000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'Ivy', 'Invite', 'ivy', 'invite', 'connected-student@local.test', 'connected-student@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('d1100000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001', 'active');

-- The connected member: the account link a class-code join produces.
INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary, linked_by
) VALUES (
  'd1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'verified', true, 'd1000000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  submission_status, eligibility_status, decision_status, submitted_at, reviewed_at
) VALUES (
  'd1500000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'manual', 'accepted', 'decided', 'eligible', 'approved', now(), now()
);

INSERT INTO plugin_data.csf_application_checks (
  organization_id, application_id, check_type, status, mandatory, summary
) VALUES
  ('d1100000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-000000000001', 'required_information', 'failed', true, 'A corrected course title is required.'),
  ('d1100000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-000000000001', 'course_data', 'pending', true, 'Course data needs review.')
ON CONFLICT (organization_id, application_id, check_type)
DO UPDATE SET
  status = excluded.status,
  mandatory = excluded.mandatory,
  summary = excluded.summary;

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_submit_application_correction(
      'd1100000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'required_information',
      'A different user must not edit this application.',
      '{}'::jsonb,
      'd1000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'You can only correct your connected CSF application.',
  'a member cannot submit a correction for another profile'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_submit_application_correction(
      'd1100000-0000-4000-8000-000000000001',
      'd1500000-0000-4000-8000-000000000001',
      'required_information',
      'The corrected course title is Advanced Algebra II.',
      '{"source":"member_workspace"}'::jsonb,
      'd1000000-0000-4000-8000-000000000002'
    )
  $$,
  'the connected member can submit a scoped correction'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_application_correction_requests
    WHERE application_id = 'd1500000-0000-4000-8000-000000000001'
      AND check_type = 'required_information'
  ),
  'submitted',
  'the correction awaits an officer decision without changing the reviewed application'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_application_status_events
    WHERE application_id = 'd1500000-0000-4000-8000-000000000001'
      AND reason_code = 'missing_information'
      AND details->>'checkType' = 'required_information'
  ),
  1,
  'the application history links to the student correction'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events AS audit
    JOIN plugin_data.csf_application_correction_requests AS correction
      ON correction.correlation_id = audit.correlation_id
    WHERE correction.application_id = 'd1500000-0000-4000-8000-000000000001'
      AND audit.action = 'application.correction_submitted'
  ),
  1,
  'correction submission and audit use the same correlation ID'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_review_application_correction(
      'd1100000-0000-4000-8000-000000000001',
      (
        SELECT id
        FROM plugin_data.csf_application_correction_requests
        WHERE application_id = 'd1500000-0000-4000-8000-000000000001'
          AND check_type = 'required_information'
      ),
      'reviewed',
      'Verified against the updated course evidence.',
      'd1000000-0000-4000-8000-000000000001'
    )
  $$,
  'an authorized server action can record the officer review atomically'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_application_correction_requests
    WHERE application_id = 'd1500000-0000-4000-8000-000000000001'
      AND check_type = 'required_information'
  ),
  'reviewed',
  'the reviewed correction leaves the original check for explicit officer verification'
);
SELECT extensions.is(
  (
    SELECT review_reason
    FROM plugin_data.csf_application_correction_requests
    WHERE application_id = 'd1500000-0000-4000-8000-000000000001'
      AND check_type = 'required_information'
  ),
  'Verified against the updated course evidence.',
  'the officer decision requires and retains a reason'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events AS audit
    JOIN plugin_data.csf_application_correction_requests AS correction
      ON correction.correlation_id = audit.correlation_id
    WHERE correction.application_id = 'd1500000-0000-4000-8000-000000000001'
      AND audit.action = 'application.correction_reviewed'
  ),
  1,
  'officer correction review joins the original correction correlation chain'
);
SELECT extensions.is(
  (
    SELECT status::text
    FROM plugin_data.csf_application_checks
    WHERE application_id = 'd1500000-0000-4000-8000-000000000001'
      AND check_type = 'required_information'
  ),
  'failed',
  'reviewing a correction does not silently overwrite the application check'
);

SELECT extensions.finish();
ROLLBACK;
