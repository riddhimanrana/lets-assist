BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(31);

SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_create_direct_invitation(uuid,uuid,uuid,text,text,timestamptz,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot create direct invitations without the server permission boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_accept_direct_invitation(uuid,text,uuid,text)', 'EXECUTE'),
  'authenticated clients cannot bypass the invitation acceptance action'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_submit_application_correction(uuid,uuid,plugin_data.csf_application_check_type,text,jsonb,uuid)', 'EXECUTE'),
  'authenticated clients cannot submit a correction for another user directly'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_review_application_correction(uuid,uuid,text,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot review corrections directly'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_accept_direct_invitation(uuid,text,uuid,text)', 'EXECUTE'),
  'the server role can invoke atomic direct invitation acceptance'
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
  ('d1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'invitation-officer@local.test', now(), '{}', '{}', now(), now()),
  ('d1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'invited-student@local.test', now(), '{}', '{}', now(), now()),
  ('d1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'different-student@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('d1100000-0000-4000-8000-000000000001', 'CSF Invitation A', 'csf-invitation-a', 'school', '991101'),
  ('d1100000-0000-4000-8000-000000000002', 'CSF Invitation B', 'csf-invitation-b', 'school', '991102');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('d1100000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('d1200000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true),
  ('d1200000-0000-4000-8000-000000000002', 'd1100000-0000-4000-8000-000000000002', 'F30', 'Fall 2030', '2030-2031', 'fall', true);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('d1300000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 2031, 'Class of 2031'),
  ('d1300000-0000-4000-8000-000000000002', 'd1100000-0000-4000-8000-000000000002', 2031, 'Class of 2031');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('d1400000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'Ivy', 'Invite', 'ivy', 'invite', 'invited-student@local.test', 'invited-student@local.test'),
  ('d1400000-0000-4000-8000-000000000002', 'd1100000-0000-4000-8000-000000000002', 'Other', 'Tenant', 'other', 'tenant', 'other-tenant@local.test', 'other-tenant@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('d1100000-0000-4000-8000-000000000001', 'd1400000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001', 'active'),
  ('d1100000-0000-4000-8000-000000000002', 'd1400000-0000-4000-8000-000000000002', 'd1300000-0000-4000-8000-000000000002', 'active');

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
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000002',
      'd1200000-0000-4000-8000-000000000001',
      'invited-student@local.test', 'Cross tenant', now() + interval '14 days',
      'cross-tenant-token-that-is-long-enough-0001',
      'd1000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Student record not found.',
  'direct invitation creation rejects a profile from another organization'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'invited-student@local.test', 'Fall 2030 invitation', now() + interval '14 days',
      'direct-invitation-token-that-is-long-enough-0001',
      'd1000000-0000-4000-8000-000000000001'
    )
  $$,
  'a direct invitation and its audit record commit together'
);

SELECT extensions.is(
  (SELECT invitation_scope FROM plugin_data.csf_onboarding_links WHERE code = 'direct-invitation-token-that-is-long-enough-0001'),
  'direct',
  'student invitations are explicitly distinct from cohort links'
);
SELECT extensions.is(
  (SELECT delivery_status FROM plugin_data.csf_onboarding_links WHERE code = 'direct-invitation-token-that-is-long-enough-0001'),
  'link_ready',
  'new student invitations begin in link-ready state'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND action = 'onboarding.direct_invitation_created'
  ),
  1,
  'direct invitation creation writes one immutable audit event'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_accept_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'direct-invitation-token-that-is-long-enough-0001',
      'd1000000-0000-4000-8000-000000000002',
      'wrong-email@local.test'
    )
  $$,
  'P0001',
  'Sign in with the email address this invitation was created for.',
  'a direct invitation cannot be accepted from a different verified email'
);

SELECT extensions.is(
  (SELECT delivery_status FROM plugin_data.csf_onboarding_links WHERE code = 'direct-invitation-token-that-is-long-enough-0001'),
  'link_ready',
  'a failed acceptance leaves the invitation unchanged'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_accept_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'direct-invitation-token-that-is-long-enough-0001',
      'd1000000-0000-4000-8000-000000000002',
      'invited-student@local.test'
    )
  $$,
  'the correct verified account accepts the direct invitation atomically'
);

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND profile_id = 'd1400000-0000-4000-8000-000000000001'
      AND user_id = 'd1000000-0000-4000-8000-000000000002'
  ),
  'verified',
  'acceptance connects the invited account to the intended profile'
);
SELECT extensions.is(
  (
    SELECT role::text
    FROM public.organization_members
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND user_id = 'd1000000-0000-4000-8000-000000000002'
  ),
  'member',
  'acceptance creates the host organization membership'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND profile_id = 'd1400000-0000-4000-8000-000000000001'
      AND term_id = 'd1200000-0000-4000-8000-000000000001'
  ),
  'active',
  'an already-approved application activates term membership during acceptance'
);
SELECT extensions.is(
  (SELECT delivery_status FROM plugin_data.csf_onboarding_links WHERE code = 'direct-invitation-token-that-is-long-enough-0001'),
  'accepted',
  'acceptance consumes the direct invitation'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND action = 'onboarding.direct_invitation_accepted'
  ),
  1,
  'direct acceptance writes one correlated audit event'
);
SELECT extensions.is(
  (
    SELECT match_status
    FROM plugin_data.csf_profile_link_requests
    WHERE onboarding_link_id = (
      SELECT id FROM plugin_data.csf_onboarding_links
      WHERE code = 'direct-invitation-token-that-is-long-enough-0001'
    )
  ),
  'auto_linked',
  'direct acceptance preserves a resolved connection request record'
);

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
