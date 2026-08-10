BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(86);

SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_create_direct_invitation(uuid,uuid,uuid,text,text,timestamptz,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot create direct invitations without the server permission boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_create_direct_invitation(uuid,uuid,uuid,text,text,integer,text,uuid,uuid)', 'EXECUTE'),
  'authenticated clients cannot call the request-aware direct invitation create boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_update_direct_invitation(uuid,uuid,text,text,integer,uuid,uuid)', 'EXECUTE'),
  'authenticated clients cannot call the request-aware direct invitation lifecycle boundary'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_create_direct_invitation(uuid,uuid,uuid,text,text,integer,text,uuid,uuid)', 'EXECUTE'),
  'the server role can call the request-aware direct invitation create boundary'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_update_direct_invitation(uuid,uuid,text,text,integer,uuid,uuid)', 'EXECUTE'),
  'the server role can call the request-aware direct invitation lifecycle boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_update_direct_invitation(uuid,uuid,text,text,timestamptz,uuid)', 'EXECUTE'),
  'the retry-unsafe legacy update signature is not a service API'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_create_direct_invitation_engine(uuid,uuid,uuid,text,text,timestamptz,text,text,uuid,uuid)', 'EXECUTE'),
  'the direct invitation create engine is internal'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_update_direct_invitation_engine(uuid,uuid,text,text,timestamptz,text,uuid,uuid)', 'EXECUTE'),
  'the direct invitation lifecycle engine is internal'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_accept_direct_invitation(uuid,text,uuid,text)', 'EXECUTE'),
  'authenticated clients cannot bypass the invitation acceptance action'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_accept_direct_invitation(uuid,text,uuid,text)', 'EXECUTE'),
  'anonymous clients cannot invoke direct invitation acceptance'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_accept_direct_invitation_base(uuid,text,uuid,text)', 'EXECUTE'),
  'the historical acceptance engine is revoked even from the service role'
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
  ('d1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'different-student@local.test', now(), '{}', '{}', now(), now()),
  ('d1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'drift-student@local.test', now(), '{}', '{}', now(), now());

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
  school_email, normalized_school_email,
  personal_email, normalized_personal_email
) VALUES
  ('d1400000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001', 'Ivy', 'Invite', 'ivy', 'invite', NULL, NULL, 'invited-student@local.test', 'invited-student@local.test'),
  ('d1400000-0000-4000-8000-000000000002', 'd1100000-0000-4000-8000-000000000002', 'Other', 'Tenant', 'other', 'tenant', NULL, NULL, 'other-tenant@local.test', 'other-tenant@local.test'),
  ('d1400000-0000-4000-8000-000000000003', 'd1100000-0000-4000-8000-000000000001', 'Sky', 'School', 'sky', 'school', 'school-student@local.test', 'school-student@local.test', NULL, NULL),
  ('d1400000-0000-4000-8000-000000000004', 'd1100000-0000-4000-8000-000000000001', 'Drew', 'Drift', 'drew', 'drift', NULL, NULL, 'drift-student@local.test', 'drift-student@local.test'),
  ('d1400000-0000-4000-8000-000000000005', 'd1100000-0000-4000-8000-000000000001', 'Pia', 'Personal', 'pia', 'personal', NULL, NULL, 'ambiguous@local.test', 'ambiguous@local.test'),
  ('d1400000-0000-4000-8000-000000000006', 'd1100000-0000-4000-8000-000000000001', 'Sam', 'School', 'sam', 'school', 'ambiguous@local.test', 'ambiguous@local.test', NULL, NULL),
  ('d1400000-0000-4000-8000-000000000007', 'd1100000-0000-4000-8000-000000000001', 'Eli', 'Expired', 'eli', 'expired', NULL, NULL, 'expired-student@local.test', 'expired-student@local.test');

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

INSERT INTO plugin_data.csf_onboarding_links (
  organization_id, term_id, cohort_id, code, title, link_type,
  invitation_scope, recipient_profile_id, recipient_email, delivery_status,
  expires_at, is_active, renewal_count, resend_count, created_by
) VALUES (
  'd1100000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'expired-legacy-direct-token-that-is-long-enough-0001',
  'Expired legacy invitation', 'profile_connect', 'direct',
  'd1400000-0000-4000-8000-000000000007',
  'expired-student@local.test', 'link_ready', now() - interval '1 day',
  true, 0, 0, 'd1000000-0000-4000-8000-000000000001'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'invited-student@local.test', 'Unauthorized invitation', 14,
      'unauthorized-token-that-is-long-enough-0001',
      'd1000000-0000-4000-8000-000000000003',
      'd1600000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Not authorized to create CSF student invitations.',
  'a trusted service call revalidates the invitation creator before private roster evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000002',
      'd1200000-0000-4000-8000-000000000001',
      'invited-student@local.test', 'Cross tenant', 14,
      'cross-tenant-token-that-is-long-enough-0001',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'Student record not found.',
  'direct invitation creation rejects a profile from another organization'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'school-student@local.test', 'Wrong profile email', 14,
      'wrong-profile-email-token-that-is-long-enough-0011',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000011'
    )
  $$,
  'P0001',
  'That email is not uniquely recorded on the selected active student profile. Correct the student record first, then create the link.',
  'direct invitation creation refuses an otherwise valid email owned by another profile'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND recipient_profile_id = 'd1400000-0000-4000-8000-000000000001'
      AND lower(btrim(recipient_email)) = 'school-student@local.test'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND correlation_id = 'd1600000-0000-4000-8000-000000000011'
  ),
  'a wrong-profile email refusal creates neither a link nor an audit receipt'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000006',
      'd1200000-0000-4000-8000-000000000001',
      ' AMBIGUOUS@LOCAL.TEST ', 'Ambiguous profile email', 14,
      'ambiguous-profile-email-token-long-enough-0012',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000012'
    )
  $$,
  'P0001',
  'That email is not uniquely recorded on the selected active student profile. Correct the student record first, then create the link.',
  'cross-profile cross-field email ambiguity cannot bind a direct invitation'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND lower(btrim(recipient_email)) = 'ambiguous@local.test'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND correlation_id = 'd1600000-0000-4000-8000-000000000012'
  ),
  'an ambiguous-email refusal creates neither a link nor an audit receipt'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000003',
      'd1200000-0000-4000-8000-000000000001',
      ' SCHOOL-STUDENT@LOCAL.TEST ', 'School email invitation', 14,
      'school-email-direct-token-that-is-long-enough-0013',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000013'
    )
  $$,
  'a current unique school email accepts case and surrounding whitespace normalization'
);
SELECT extensions.is(
  (
    SELECT recipient_email
    FROM plugin_data.csf_onboarding_links
    WHERE code = 'school-email-direct-token-that-is-long-enough-0013'
  ),
  'school-student@local.test',
  'the school-email invitation stores its canonical normalized address'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000007',
      'd1200000-0000-4000-8000-000000000001',
      'expired-student@local.test', 'Replacement for expired legacy link', 14,
      'fresh-after-expired-token-that-is-long-enough-0002',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000009'
    )
  $$,
  'an expired legacy active flag does not permanently block a new valid link'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND recipient_profile_id = 'd1400000-0000-4000-8000-000000000007'
      AND term_id = 'd1200000-0000-4000-8000-000000000001'
      AND lower(btrim(recipient_email)) = 'expired-student@local.test'
      AND invitation_scope = 'direct'
      AND is_active
      AND delivery_status = 'link_ready'
      AND expires_at > now()
  ),
  1,
  'only one currently valid token exists beside expired legacy history'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_onboarding_links WHERE code = 'expired-legacy-direct-token-that-is-long-enough-0001'),
      'renew',
      'must-not-revive-old-token-that-is-long-enough-0003',
      14,
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000010'
    )
  $$,
  'P0001',
  'Another active student-specific link already exists. Copy or manage that link instead.',
  'renew cannot revive an older record beside its valid replacement'
);
SELECT extensions.ok(
  (
    SELECT code = 'expired-legacy-direct-token-that-is-long-enough-0001'
      AND renewal_count = 0
      AND delivery_status = 'link_ready'
      AND expires_at < now()
    FROM plugin_data.csf_onboarding_links
    WHERE code = 'expired-legacy-direct-token-that-is-long-enough-0001'
  ),
  'a refused old-link renew leaves its token, counter, status, and expiration unchanged'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND correlation_id = 'd1600000-0000-4000-8000-000000000010'
  ),
  0,
  'a refused old-link renew writes no lifecycle receipt'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      ' INVITED-STUDENT@LOCAL.TEST ', 'Fall 2030 invitation', 14,
      'direct-invitation-token-that-is-long-enough-0001',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000003'
    )
  $$,
  'a direct invitation and its audit record commit together'
);
SELECT extensions.is(
  (
    SELECT recipient_email
    FROM plugin_data.csf_onboarding_links
    WHERE code = 'direct-invitation-token-that-is-long-enough-0001'
  ),
  'invited-student@local.test',
  'the personal-email invitation stores its canonical normalized address'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      ' INVITED-STUDENT@LOCAL.TEST ', 'Fall 2030 invitation', 14,
      'ignored-replay-token-that-is-long-enough-0002',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000003'
    )
  $$,
  'an exact create replay returns the committed invitation despite a newly generated effect token'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND recipient_profile_id = 'd1400000-0000-4000-8000-000000000001'
      AND term_id = 'd1200000-0000-4000-8000-000000000001'
      AND lower(btrim(recipient_email)) = 'invited-student@local.test'
      AND invitation_scope = 'direct'
      AND is_active
  ),
  1,
  'an exact create replay leaves only one active direct token'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND correlation_id = 'd1600000-0000-4000-8000-000000000003'
      AND action = 'onboarding.direct_invitation_created'
  ),
  1,
  'an exact create replay keeps one immutable receipt'
);
SELECT extensions.ok(
  (
    SELECT NOT (after_data ? 'request')
      AND NOT (after_data ? 'recipientEmail')
      AND char_length(after_data ->> 'tokenFingerprint') = 64
      AND after_data ->> 'tokenFingerprint'
        <> 'direct-invitation-token-that-is-long-enough-0001'
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND correlation_id = 'd1600000-0000-4000-8000-000000000003'
  ),
  'the immutable create receipt stores a hash and domain rather than the recipient address or token'
);

UPDATE plugin_data.csf_profiles
SET personal_email = 'temporarily-corrected@local.test',
    normalized_personal_email = 'temporarily-corrected@local.test'
WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
  AND id = 'd1400000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'invited-student@local.test', 'Fall 2030 invitation', 14,
      'ignored-profile-drift-replay-token-long-enough-0014',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'That email is not uniquely recorded on the selected active student profile. Correct the student record first, then create the link.',
  'a create receipt replay refuses to report a ready link after profile email drift'
);
SELECT extensions.ok(
  (
    SELECT code = 'direct-invitation-token-that-is-long-enough-0001'
      AND delivery_status = 'link_ready'
      AND renewal_count = 0
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND recipient_profile_id = 'd1400000-0000-4000-8000-000000000001'
      AND lower(btrim(recipient_email)) = 'invited-student@local.test'
  )
  AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND correlation_id = 'd1600000-0000-4000-8000-000000000003'
  ),
  'a refused drifted create replay leaves the original link and immutable receipt unchanged'
);
UPDATE plugin_data.csf_profiles
SET personal_email = 'invited-student@local.test',
    normalized_personal_email = 'invited-student@local.test'
WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
  AND id = 'd1400000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'invited-student@local.test', 'Changed invitation title', 14,
      'conflicting-replay-token-that-is-long-enough-0003',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'That direct-invitation request identifier is already bound to different content.',
  'a create request identifier cannot be reused for different intent'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'invited-student@local.test', 'Second active invitation', 14,
      'second-active-token-that-is-long-enough-0004',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000004'
    )
  $$,
  'P0001',
  'An active student-specific link already exists. Copy it or use Renew link instead.',
  'a different request cannot create a second active token for the same student identity'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_onboarding_links
       WHERE code = 'direct-invitation-token-that-is-long-enough-0001'),
      'cancel', 'unused-direct-invitation-token', NULL,
      'd1000000-0000-4000-8000-000000000003',
      'd1600000-0000-4000-8000-000000000005'
    )
  $$,
  'P0001',
  'Not authorized to manage CSF student invitations.',
  'a trusted service call revalidates the invitation manager before private link evidence'
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
SELECT extensions.ok(
  (SELECT last_sent_at IS NULL FROM plugin_data.csf_onboarding_links WHERE code = 'direct-invitation-token-that-is-long-enough-0001'),
  'creating a secure invitation link does not fabricate an email sent time'
);
SELECT extensions.is(
  (SELECT resend_count FROM plugin_data.csf_onboarding_links WHERE code = 'direct-invitation-token-that-is-long-enough-0001'),
  0,
  'creating a secure invitation link does not count an email resend'
);
SELECT extensions.is(
  (SELECT renewal_count FROM plugin_data.csf_onboarding_links WHERE code = 'direct-invitation-token-that-is-long-enough-0001'),
  0,
  'a newly created secure invitation link has not been renewed'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND action = 'onboarding.direct_invitation_created'
      AND correlation_id = 'd1600000-0000-4000-8000-000000000003'
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
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000004',
      'd1200000-0000-4000-8000-000000000001',
      'drift-student@local.test', 'Drift acceptance link', 14,
      'profile-drift-acceptance-token-long-enough-0015',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000015'
    )
  $$,
  'an officer can initially bind a link to the profile current email'
);
UPDATE plugin_data.csf_profiles
SET personal_email = 'drift-corrected@local.test',
    normalized_personal_email = 'drift-corrected@local.test'
WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
  AND id = 'd1400000-0000-4000-8000-000000000004';
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_accept_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'profile-drift-acceptance-token-long-enough-0015',
      'd1000000-0000-4000-8000-000000000004',
      ' DRIFT-STUDENT@LOCAL.TEST '
    )
  $$,
  'P0001',
  'This invitation email is no longer uniquely recorded on the invited active student profile. Ask a CSF officer to correct the student record first.',
  'first acceptance refuses when the invitation email has drifted off the active profile'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND profile_id = 'd1400000-0000-4000-8000-000000000004'
      AND user_id = 'd1000000-0000-4000-8000-000000000004'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND user_id = 'd1000000-0000-4000-8000-000000000004'
  )
  AND (
    SELECT is_active AND delivery_status = 'link_ready' AND accepted_at IS NULL
    FROM plugin_data.csf_onboarding_links
    WHERE code = 'profile-drift-acceptance-token-long-enough-0015'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    JOIN plugin_data.csf_onboarding_links AS invitation
      ON invitation.id = audit.target_id
    WHERE invitation.code = 'profile-drift-acceptance-token-long-enough-0015'
      AND audit.action = 'onboarding.direct_invitation_accepted'
  ),
  'a drift refusal leaves account, membership, link, and acceptance audit state untouched'
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
UPDATE plugin_data.csf_profiles
SET personal_email = 'accepted-profile-corrected@local.test',
    normalized_personal_email = 'accepted-profile-corrected@local.test'
WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
  AND id = 'd1400000-0000-4000-8000-000000000001';
SELECT extensions.is(
  (
    plugin_data.csf_accept_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'direct-invitation-token-that-is-long-enough-0001',
      'd1000000-0000-4000-8000-000000000002',
      'invited-student@local.test'
    ) ->> 'alreadyAccepted'
  ),
  'true',
  'accepted-by-the-same-user replay remains idempotent after a later profile email correction'
);
UPDATE plugin_data.csf_profiles
SET personal_email = 'invited-student@local.test',
    normalized_personal_email = 'invited-student@local.test'
WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
  AND id = 'd1400000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'invited-student@local.test', 'Fall 2030 invitation', 14,
      'ignored-after-accept-token-that-is-long-enough-0005',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'The committed invitation has changed or is no longer ready. Reload Members for its current status.',
  'an old create receipt cannot claim that an accepted link is ready'
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

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      'd1400000-0000-4000-8000-000000000001',
      'd1200000-0000-4000-8000-000000000001',
      'invited-student@local.test', 'Renewable Fall 2030 link', 14,
      'renewable-direct-link-that-is-long-enough-0001',
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000006'
    )
  $$,
  'an officer can create a new secure link after the prior invitation was accepted'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_update_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_onboarding_links WHERE code = 'renewable-direct-link-that-is-long-enough-0001'),
      'renew',
      'renewed-direct-link-that-is-long-enough-0002',
      21,
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000007'
    )
  $$,
  'renewing a secure invitation link commits independently from email delivery'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_update_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_onboarding_links WHERE code = 'renewed-direct-link-that-is-long-enough-0002'),
      'renew',
      'ignored-renew-replay-token-that-is-long-enough-0003',
      21,
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000007'
    )
  $$,
  'an exact renew replay returns the committed result without rotating the token again'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND correlation_id = 'd1600000-0000-4000-8000-000000000007'
      AND action = 'onboarding.direct_invitation_renew'
  ),
  1,
  'an exact renew replay keeps one immutable lifecycle receipt'
);
UPDATE plugin_data.csf_profiles
SET personal_email = 'renew-drifted@local.test',
    normalized_personal_email = 'renew-drifted@local.test'
WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
  AND id = 'd1400000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_onboarding_links WHERE code = 'renewed-direct-link-that-is-long-enough-0002'),
      'renew',
      'ignored-drifted-renew-replay-token-long-enough-0016',
      21,
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000007'
    )
  $$,
  'P0001',
  'This invitation email is no longer uniquely recorded on the invited active student profile. Correct the student record first, then renew the link.',
  'an exact renew replay refuses to report success after profile email drift'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_onboarding_links WHERE code = 'renewed-direct-link-that-is-long-enough-0002'),
      'renew',
      'must-not-renew-after-profile-drift-long-enough-0017',
      21,
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000017'
    )
  $$,
  'P0001',
  'This invitation email is no longer uniquely recorded on the invited active student profile. Correct the student record first, then renew the link.',
  'a new renew request refuses when the invitation email has drifted off the profile'
);
SELECT extensions.ok(
  (
    SELECT code = 'renewed-direct-link-that-is-long-enough-0002'
      AND renewal_count = 1
      AND delivery_status = 'link_ready'
      AND is_active
    FROM plugin_data.csf_onboarding_links
    WHERE code = 'renewed-direct-link-that-is-long-enough-0002'
  )
  AND (
    SELECT count(*) = 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND correlation_id = 'd1600000-0000-4000-8000-000000000007'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND correlation_id = 'd1600000-0000-4000-8000-000000000017'
  ),
  'drifted renew refusals leave the token, counter, state, and receipts unchanged'
);
UPDATE plugin_data.csf_profiles
SET personal_email = 'invited-student@local.test',
    normalized_personal_email = 'invited-student@local.test'
WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
  AND id = 'd1400000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_onboarding_links WHERE code = 'renewed-direct-link-that-is-long-enough-0002'),
      'cancel',
      'unused-direct-invitation-token',
      NULL,
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000007'
    )
  $$,
  'P0001',
  'That direct-invitation request identifier is already bound to different content.',
  'a renew request identifier cannot be reused for another lifecycle operation'
);
SELECT extensions.is(
  (SELECT delivery_status FROM plugin_data.csf_onboarding_links WHERE code = 'renewed-direct-link-that-is-long-enough-0002'),
  'link_ready',
  'a renewed secure invitation remains link-ready until an email is durably queued'
);
SELECT extensions.ok(
  (SELECT last_sent_at IS NULL FROM plugin_data.csf_onboarding_links WHERE code = 'renewed-direct-link-that-is-long-enough-0002'),
  'renewing a secure invitation link does not fabricate an email sent time'
);
SELECT extensions.is(
  (SELECT resend_count FROM plugin_data.csf_onboarding_links WHERE code = 'renewed-direct-link-that-is-long-enough-0002'),
  0,
  'renewing a secure invitation link does not count an email resend'
);
SELECT extensions.is(
  (SELECT renewal_count FROM plugin_data.csf_onboarding_links WHERE code = 'renewed-direct-link-that-is-long-enough-0002'),
  1,
  'secure link renewal has its own lifecycle counter'
);
SELECT extensions.is(
  (
    SELECT after_data->>'renewalCount'
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND action = 'onboarding.direct_invitation_renew'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  '1',
  'the renewal audit event reports link renewal rather than email resend'
);
SELECT extensions.is(
  (
    SELECT after_data->>'emailResendCount'
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'd1100000-0000-4000-8000-000000000001'
      AND action = 'onboarding.direct_invitation_renew'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  '0',
  'the renewal audit event preserves truthful email resend telemetry'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_update_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_onboarding_links WHERE code = 'renewed-direct-link-that-is-long-enough-0002'),
      'cancel',
      'unused-direct-invitation-token',
      NULL,
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000008'
    )
  $$,
  'a later lifecycle request can cancel the renewed link'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_direct_invitation(
      'd1100000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_onboarding_links WHERE code = 'renewed-direct-link-that-is-long-enough-0002'),
      'renew',
      'ignored-stale-renew-token-that-is-long-enough-0004',
      21,
      'd1000000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000007'
    )
  $$,
  'P0001',
  'The committed invitation operation is no longer current. Reload Members before trying again.',
  'an old renew receipt cannot report success after a later lifecycle change'
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
