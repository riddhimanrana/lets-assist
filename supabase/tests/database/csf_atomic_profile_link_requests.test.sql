-- Officer resolution of CSF profile link requests. Students now arrive only
-- through csf_join_class_by_code; ambiguous joins land in
-- csf_profile_link_requests and are settled by
-- csf_resolve_profile_link_request. The onboarding-link submission and claim
-- flows this file once exercised were dropped by 20260823211000; the
-- reactivation and closed-term safeguards proved here were ported from the
-- retired claim suite because they are properties of the resolver, not of the
-- retired submission path.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(22);

SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_actor_has_permission(uuid,uuid,text)', 'EXECUTE'),
  'authenticated clients cannot probe CSF staff permissions directly'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot resolve profile connections directly'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)', 'EXECUTE'),
  'the server can resolve a connection transactionally'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'claim-admin@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'declined-claim@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'claim-outsider@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('e1100000-0000-4000-8000-000000000001', 'CSF Claim Test', 'csf-claim-test', 'school', '992201');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'e1200000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'F31', 'Fall 2031', '2031-2032', 'fall', true
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('e1300000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 2032, 'Class of 2032');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('e1400000-0000-4000-8000-000000000004', 'e1100000-0000-4000-8000-000000000001', 'Declined', 'Suggestion', 'declined', 'suggestion', 'former-declined@local.test', 'former-declined@local.test'),
  ('e1400000-0000-4000-8000-000000000005', 'e1100000-0000-4000-8000-000000000001', 'Declined', 'Match', 'declined', 'match', 'declined-claim@local.test', 'declined-claim@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000004', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000005', 'e1300000-0000-4000-8000-000000000001', 'active');

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'plugin_data'
      AND tablename = 'csf_profile_accounts'
      AND indexname = 'csf_profile_accounts_one_verified_user_per_org_idx'
      AND indexdef LIKE '%(organization_id, user_id)%WHERE (status = %verified%'
  ),
  'one verified CSF profile per organization and user is enforced by a database unique index'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE conname IN (
      'csf_profile_cohort_memberships_profile_organization_fkey',
      'csf_profile_cohort_memberships_cohort_organization_fkey',
      'csf_profile_link_requests_term_organization_fkey',
      'csf_profile_link_requests_cohort_organization_fkey',
      'csf_profile_link_requests_profile_organization_fkey'
    )
      AND contype = 'f'
      AND convalidated
  ),
  5,
  'link-request and cohort relationships have validated tenant-scoped foreign keys'
);

-- A pending review created by an ambiguous class-code join: the officer
-- confirms the roster row whose exact name, unique confirmed email, and single
-- requested class satisfy the hardened resolver.
INSERT INTO plugin_data.csf_profile_link_requests (
  id, organization_id, term_id, cohort_id, user_id, signed_in_email,
  first_name, last_name, normalized_first_name, normalized_last_name,
  matched_profile_id, candidate_profile_ids, match_status, resolution_notes
) VALUES (
  'e1900000-0000-4000-8000-000000000004',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001',
  'e1300000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000004',
  'declined-claim@local.test', 'Declined', 'Match', 'declined', 'match',
  NULL, ARRAY['e1400000-0000-4000-8000-000000000005'::uuid],
  'needs_review', 'Fixture: officer review required.'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_resolve_profile_link_request(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000004',
      'e1400000-0000-4000-8000-000000000005',
      'connect', 'Confirmed against the source roster.',
      'e1000000-0000-4000-8000-000000000005'
    )
  $$,
  'P0001',
  'Not authorized to resolve CSF profile connections.',
  'an ordinary user cannot resolve a connection request'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_resolve_profile_link_request(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000004',
      'e1400000-0000-4000-8000-000000000005',
      'connect', 'Confirmed against the source roster.',
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'an organization admin can resolve the request atomically'
);
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
   WHERE id = 'e1900000-0000-4000-8000-000000000004'),
  'resolved',
  'the resolved request has one final state'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND profile_id = 'e1400000-0000-4000-8000-000000000005'
     AND user_id = 'e1000000-0000-4000-8000-000000000004'),
  'verified',
  'officer resolution links the selected record'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND action = 'profile.link_request_resolved'),
  1,
  'officer resolution writes one correlated audit event'
);

-- Reactivation safeguards use separate records so each path proves that the
-- resolver either preserves an intentional inactive/revoked/finalized state or
-- rolls back every write.
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e1000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'inactive-officer@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'revoked-officer@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'revoked-term-officer@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'finalized-term-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('e1400000-0000-4000-8000-000000000011', 'e1100000-0000-4000-8000-000000000001', 'Inactive', 'Officer', 'inactive', 'officer', 'inactive-officer@local.test', 'inactive-officer@local.test'),
  ('e1400000-0000-4000-8000-000000000012', 'e1100000-0000-4000-8000-000000000001', 'Revoked', 'Officer', 'revoked', 'officer', 'revoked-officer@local.test', 'revoked-officer@local.test'),
  ('e1400000-0000-4000-8000-000000000013', 'e1100000-0000-4000-8000-000000000001', 'Revoked Term', 'Officer', 'revoked term', 'officer', 'revoked-term-officer@local.test', 'revoked-term-officer@local.test'),
  ('e1400000-0000-4000-8000-000000000014', 'e1100000-0000-4000-8000-000000000001', 'Finalized Term', 'Officer', 'finalized term', 'officer', 'finalized-term-officer@local.test', 'finalized-term-officer@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000011', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000012', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000013', 'e1300000-0000-4000-8000-000000000001', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000014', 'e1300000-0000-4000-8000-000000000001', 'active');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000011', 'staff', 'inactive'),
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000013', 'staff', 'active');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary, revoked_at, notes
) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000012', 'e1000000-0000-4000-8000-000000000012', 'revoked', false, now(), 'Fixture: previously revoked officer connection.');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES
  ('e1600000-0000-4000-8000-000000000013', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000013', 'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'manual', 'accepted'),
  ('e1600000-0000-4000-8000-000000000014', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000014', 'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'manual', 'accepted');

INSERT INTO plugin_data.csf_term_closures (
  id, organization_id, term_id, policy_version, summary, decisions,
  closed_by, revision, correlation_id, reopenable
) VALUES (
  'e1700000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001',
  1, '{}'::jsonb, '[]'::jsonb,
  'e1000000-0000-4000-8000-000000000001',
  1, 'e1710000-0000-4000-8000-000000000001', false
);

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, application_id,
  status, status_reason, completed_at, finalized_closure_id,
  finalized_revision, finalized_correlation_id
) VALUES
  ('e1800000-0000-4000-8000-000000000013', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000013', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1600000-0000-4000-8000-000000000013', 'revoked', 'Fixture: membership revoked.', NULL, NULL, NULL, NULL),
  ('e1800000-0000-4000-8000-000000000014', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000014', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1600000-0000-4000-8000-000000000014', 'completed', 'Fixture: membership finalized.', now(), 'e1700000-0000-4000-8000-000000000001', 1, 'e1810000-0000-4000-8000-000000000014');

INSERT INTO plugin_data.csf_profile_link_requests (
  id, organization_id, term_id, cohort_id, user_id, signed_in_email,
  first_name, last_name, normalized_first_name, normalized_last_name,
  matched_profile_id, candidate_profile_ids, match_status, resolution_notes
) VALUES
  ('e1900000-0000-4000-8000-000000000011', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000011', 'inactive-officer@local.test', 'Inactive', 'Officer', 'inactive', 'officer', NULL, ARRAY['e1400000-0000-4000-8000-000000000011'::uuid], 'needs_review', 'Fixture: officer review required.'),
  ('e1900000-0000-4000-8000-000000000012', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000012', 'revoked-officer@local.test', 'Revoked', 'Officer', 'revoked', 'officer', NULL, ARRAY['e1400000-0000-4000-8000-000000000012'::uuid], 'needs_review', 'Fixture: officer review required.'),
  ('e1900000-0000-4000-8000-000000000013', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000013', 'revoked-term-officer@local.test', 'Revoked Term', 'Officer', 'revoked term', 'officer', NULL, ARRAY['e1400000-0000-4000-8000-000000000013'::uuid], 'needs_review', 'Fixture: officer review required.'),
  ('e1900000-0000-4000-8000-000000000014', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000014', 'finalized-term-officer@local.test', 'Finalized Term', 'Officer', 'finalized term', 'officer', NULL, ARRAY['e1400000-0000-4000-8000-000000000014'::uuid], 'needs_review', 'Fixture: officer review required.');

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_resolve_profile_link_request(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000011',
      'e1400000-0000-4000-8000-000000000011',
      'connect', 'Confirmed against the source roster.',
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'This CSF account connection is not supported by corroborating identity evidence.',
  'officer resolution cannot reactivate inactive host organization access'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000011'
      AND role = 'staff' AND status = 'inactive'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_link_requests
    WHERE id = 'e1900000-0000-4000-8000-000000000011'
      AND match_status = 'needs_review'
  ),
  'failed officer resolution preserves inactive staff access and the unresolved request'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_resolve_profile_link_request(
      'e1100000-0000-4000-8000-000000000001',
      'e1900000-0000-4000-8000-000000000012',
      'e1400000-0000-4000-8000-000000000012',
      'connect', 'Confirmed against the source roster.',
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'This CSF account connection was revoked; use the explicit relink workflow.',
  'officer resolution cannot reactivate a revoked CSF account connection'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND profile_id = 'e1400000-0000-4000-8000-000000000012'
      AND user_id = 'e1000000-0000-4000-8000-000000000012'
      AND status = 'revoked' AND revoked_at IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000012'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_link_requests
    WHERE id = 'e1900000-0000-4000-8000-000000000012'
      AND match_status = 'needs_review'
  ),
  'failed officer resolution leaves the revoked link intact and rolls back every other write'
);

SELECT extensions.is(
  (plugin_data.csf_resolve_profile_link_request(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000013',
    'e1400000-0000-4000-8000-000000000013',
    'connect', 'Confirmed against the source roster.',
    'e1000000-0000-4000-8000-000000000001'
  )->>'membershipGranted')::boolean,
  false,
  'officer resolution reports that a revoked term membership was not granted'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_term_memberships
    WHERE id = 'e1800000-0000-4000-8000-000000000013'
      AND status = 'revoked'
  ) AND EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND user_id = 'e1000000-0000-4000-8000-000000000013'
      AND role = 'staff' AND status = 'active'
  ),
  'officer resolution preserves a revoked term membership and existing staff role'
);
SELECT extensions.is(
  (SELECT (after_data->>'membershipGranted')::boolean
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
     AND target_id = 'e1900000-0000-4000-8000-000000000013'
     AND action = 'profile.link_request_resolved'),
  false,
  'officer audit records no revoked term membership grant'
);

SELECT extensions.is(
  (plugin_data.csf_resolve_profile_link_request(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000014',
    'e1400000-0000-4000-8000-000000000014',
    'connect', 'Confirmed against the source roster.',
    'e1000000-0000-4000-8000-000000000001'
  )->>'membershipGranted')::boolean,
  false,
  'officer resolution reports that a finalized term membership was not granted'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_term_memberships
    WHERE id = 'e1800000-0000-4000-8000-000000000014'
      AND status = 'completed'
      AND finalized_closure_id = 'e1700000-0000-4000-8000-000000000001'
      AND finalized_revision = 1
  ),
  'officer resolution leaves finalized membership evidence unchanged'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_link_requests
    WHERE id = 'e1900000-0000-4000-8000-000000000014'
      AND match_status = 'resolved'
      AND matched_profile_id = 'e1400000-0000-4000-8000-000000000014'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND profile_id = 'e1400000-0000-4000-8000-000000000014'
      AND user_id = 'e1000000-0000-4000-8000-000000000014'
      AND status = 'verified'
  ),
  'officer resolution can connect identity without changing the finalized semester outcome'
);

-- A genuinely closed term exercises the later evidence-write trigger. Identity
-- connection must still succeed, but officer resolution may not issue the
-- membership INSERT that the closed-term guard rejects.
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e1000000-0000-4000-8000-000000000016', 'authenticated', 'authenticated', 'closed-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES (
  'e1200000-0000-4000-8000-000000000002',
  'e1100000-0000-4000-8000-000000000001',
  'S32', 'Spring 2032', '2031-2032', 'spring', 'open', false
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES
  ('e1400000-0000-4000-8000-000000000016', 'e1100000-0000-4000-8000-000000000001', 'Closed', 'Officer', 'closed', 'officer', 'closed-officer@local.test', 'closed-officer@local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000016', 'e1300000-0000-4000-8000-000000000001', 'active');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES
  ('e1600000-0000-4000-8000-000000000016', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000016', 'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000002', 'manual', 'accepted');

INSERT INTO plugin_data.csf_term_closures (
  id, organization_id, term_id, policy_version, summary, decisions,
  closed_by, revision, correlation_id, reopenable
) VALUES (
  'e1700000-0000-4000-8000-000000000002',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000002',
  1, '{}'::jsonb, '[]'::jsonb,
  'e1000000-0000-4000-8000-000000000001',
  1, 'e1710000-0000-4000-8000-000000000002', false
);

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, application_id,
  status, status_reason, completed_at, finalized_closure_id,
  finalized_revision, finalized_correlation_id, updated_at
) VALUES
  ('e1800000-0000-4000-8000-000000000016', 'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000016', 'e1200000-0000-4000-8000-000000000002', 'e1300000-0000-4000-8000-000000000001', 'e1600000-0000-4000-8000-000000000016', 'completed', 'Closed fixture outcome.', '2032-05-01T12:00:00Z', 'e1700000-0000-4000-8000-000000000002', 1, 'e1810000-0000-4000-8000-000000000016', '2032-05-01T12:00:00Z');

INSERT INTO plugin_data.csf_profile_link_requests (
  id, organization_id, term_id, cohort_id, user_id, signed_in_email,
  first_name, last_name, normalized_first_name, normalized_last_name,
  matched_profile_id, candidate_profile_ids, match_status, resolution_notes
) VALUES (
  'e1900000-0000-4000-8000-000000000016',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000002',
  'e1300000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000016',
  'closed-officer@local.test', 'Closed', 'Officer', 'closed', 'officer',
  NULL, ARRAY['e1400000-0000-4000-8000-000000000016'::uuid],
  'needs_review', 'Fixture: resolve identity after close.'
);

INSERT INTO plugin_data.csf_term_close_authorizations (
  transaction_id, organization_id, term_id, closure_id,
  closure_revision, actor_user_id, correlation_id
) VALUES (
  pg_catalog.txid_current(),
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000002',
  'e1700000-0000-4000-8000-000000000002',
  1,
  'e1000000-0000-4000-8000-000000000001',
  'e1710000-0000-4000-8000-000000000002'
);

UPDATE plugin_data.csf_terms
SET lifecycle_status = 'closed', is_current = false,
    closed_at = '2032-05-01T12:00:00Z',
    closed_by = 'e1000000-0000-4000-8000-000000000001',
    closure_policy_version = 1, closure_revision = 1,
    latest_closure_id = 'e1700000-0000-4000-8000-000000000002',
    active_closure_id = 'e1700000-0000-4000-8000-000000000002'
WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
  AND id = 'e1200000-0000-4000-8000-000000000002';

DELETE FROM plugin_data.csf_term_close_authorizations
WHERE transaction_id = pg_catalog.txid_current()
  AND organization_id = 'e1100000-0000-4000-8000-000000000001'
  AND term_id = 'e1200000-0000-4000-8000-000000000002';

SELECT extensions.is(
  (plugin_data.csf_resolve_profile_link_request(
    'e1100000-0000-4000-8000-000000000001',
    'e1900000-0000-4000-8000-000000000016',
    'e1400000-0000-4000-8000-000000000016',
    'connect', 'Confirmed against the closed-term source roster.',
    'e1000000-0000-4000-8000-000000000001'
  )->>'membershipGranted')::boolean,
  false,
  'officer resolution connects identity after close without attempting term activation'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_link_requests
    WHERE id = 'e1900000-0000-4000-8000-000000000016'
      AND match_status = 'resolved'
      AND matched_profile_id = 'e1400000-0000-4000-8000-000000000016'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE organization_id = 'e1100000-0000-4000-8000-000000000001'
      AND profile_id = 'e1400000-0000-4000-8000-000000000016'
      AND user_id = 'e1000000-0000-4000-8000-000000000016'
      AND status = 'verified'
  ) AND EXISTS (
    SELECT 1 FROM plugin_data.csf_term_memberships
    WHERE id = 'e1800000-0000-4000-8000-000000000016'
      AND status = 'completed'
      AND finalized_closure_id = 'e1700000-0000-4000-8000-000000000002'
      AND updated_at = '2032-05-01T12:00:00Z'::timestamptz
  ),
  'closed-term officer resolution records the identity decision without changing frozen membership'
);

SELECT * FROM extensions.finish();
ROLLBACK;
