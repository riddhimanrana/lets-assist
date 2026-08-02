BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(43);

-- 1-5: privileged boundary and source-shape invariants.
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)') IS NOT NULL,
  'the atomic reusable onboarding-link mutation exists'
);
SELECT extensions.ok(
  NOT has_function_privilege('public', 'plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)', 'EXECUTE'),
  'only service_role can invoke reusable onboarding-link mutations'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
    LIKE '%SECURITY DEFINER%SET search_path TO %',
  'the privileged operation pins an empty search path'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
    LIKE '%manage_profiles%pg_advisory_xact_lock%requestFingerprint%',
  'the database rechecks permission and serializes fingerprinted requests'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
    NOT LIKE '%INSERT INTO plugin_data.csf_cohorts%'
    AND pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
      NOT LIKE '%INSERT INTO plugin_data.csf_terms%'
    AND pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
      NOT LIKE '%INSERT INTO plugin_data.csf_cohort_terms%',
  'onboarding-link mutations cannot invent class configuration'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('bf000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'link-admin@local.test', now(), '{}', '{}', now(), now()),
  ('bf000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'link-member@local.test', now(), '{}', '{}', now(), now()),
  ('bf000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other-link-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('bf100000-0000-4000-8000-000000000001', 'Atomic Onboarding Links', 'atomic-onboarding-links', 'school', '994101'),
  ('bf100000-0000-4000-8000-000000000002', 'Other Atomic Onboarding Links', 'other-atomic-onboarding-links', 'school', '994102');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('bf100000-0000-4000-8000-000000000001', 'bf000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('bf100000-0000-4000-8000-000000000001', 'bf000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('bf100000-0000-4000-8000-000000000002', 'bf000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES
  ('bf200000-0000-4000-8000-000000000001', 'bf100000-0000-4000-8000-000000000001', 2042, 'Class of 2042', 'active'),
  ('bf200000-0000-4000-8000-000000000002', 'bf100000-0000-4000-8000-000000000001', 2043, 'Class of 2043', 'active'),
  ('bf200000-0000-4000-8000-000000000003', 'bf100000-0000-4000-8000-000000000002', 2042, 'Other Class of 2042', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES
  ('bf300000-0000-4000-8000-000000000001', 'bf100000-0000-4000-8000-000000000001', 'F41', 'Fall 2041', '2041-2042', 'fall', 'open', true),
  ('bf300000-0000-4000-8000-000000000002', 'bf100000-0000-4000-8000-000000000001', 'S42', 'Spring 2042', '2041-2042', 'spring', 'open', false),
  ('bf300000-0000-4000-8000-000000000003', 'bf100000-0000-4000-8000-000000000002', 'F41', 'Other Fall 2041', '2041-2042', 'fall', 'open', true);

-- Build the smallest valid close-ready semester, then cross the lifecycle
-- boundary through the evidence-bound service contract. Direct fixture writes
-- to closed/archived are intentionally rejected by the lifecycle guard.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES (
  'bf210000-0000-4000-8000-000000000001',
  'bf100000-0000-4000-8000-000000000001',
  'Closure', 'Fixture', 'closure', 'fixture'
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, dues_required,
  total_points_required, max_drive_points, required_meetings,
  created_by, updated_by
) VALUES (
  'bf100000-0000-4000-8000-000000000001',
  'bf300000-0000-4000-8000-000000000002',
  1, false, 0, 0, 0,
  'bf000000-0000-4000-8000-000000000001',
  'bf000000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, status
) VALUES (
  'bf320000-0000-4000-8000-000000000001',
  'bf100000-0000-4000-8000-000000000001',
  'bf210000-0000-4000-8000-000000000001',
  'bf300000-0000-4000-8000-000000000002',
  'bf200000-0000-4000-8000-000000000001',
  'active'
);

DO $fixture$
DECLARE
  v_evidence_hash text;
BEGIN
  v_evidence_hash := plugin_data.csf_term_closure_readiness(
    'bf100000-0000-4000-8000-000000000001',
    'bf300000-0000-4000-8000-000000000002'
  ) ->> 'evidenceHash';
  PERFORM plugin_data.csf_close_term_v2(
    'bf100000-0000-4000-8000-000000000001',
    'bf300000-0000-4000-8000-000000000002',
    1,
    v_evidence_hash,
    'bf000000-0000-4000-8000-000000000001'
  );
END;
$fixture$;

INSERT INTO plugin_data.csf_cohort_terms (
  id, organization_id, cohort_id, term_id, grade_level, status
) VALUES
  ('bf310000-0000-4000-8000-000000000001', 'bf100000-0000-4000-8000-000000000001', 'bf200000-0000-4000-8000-000000000001', 'bf300000-0000-4000-8000-000000000001', 12, 'active'),
  ('bf310000-0000-4000-8000-000000000002', 'bf100000-0000-4000-8000-000000000002', 'bf200000-0000-4000-8000-000000000003', 'bf300000-0000-4000-8000-000000000003', 12, 'active');

-- 6-14: exact authorization/tenant/configuration checks and no side effects.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000002',
    'bf900000-0000-4000-8000-000000000001',
    jsonb_build_object('operation', 'create', 'cohortId', 'bf200000-0000-4000-8000-000000000001', 'termId', 'bf300000-0000-4000-8000-000000000001')
  )$$,
  'P0001', 'Not authorized to manage CSF class invitations.',
  'an ordinary member cannot create a reusable class link'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000002',
    jsonb_build_object('operation', 'create', 'cohortId', 'bf200000-0000-4000-8000-000000000003', 'termId', 'bf300000-0000-4000-8000-000000000001')
  )$$,
  'P0001', 'The selected class was not found or is not active in this organization.',
  'a class from another tenant is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000003',
    jsonb_build_object('operation', 'create', 'cohortId', 'bf200000-0000-4000-8000-000000000001', 'termId', 'bf300000-0000-4000-8000-000000000003')
  )$$,
  'P0001', 'The selected semester was not found or cannot accept class invitations in this organization.',
  'a semester from another tenant is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000004',
    jsonb_build_object('operation', 'create', 'cohortId', 'bf200000-0000-4000-8000-000000000002', 'termId', 'bf300000-0000-4000-8000-000000000001')
  )$$,
  'P0001', 'The selected class is not actively linked to this semester.',
  'an unlinked class and semester are rejected'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000005',
    jsonb_build_object('operation', 'create', 'cohortId', 'bf200000-0000-4000-8000-000000000001', 'termId', 'bf300000-0000-4000-8000-000000000002')
  )$$,
  'P0001', 'The selected semester was not found or cannot accept class invitations in this organization.',
  'a closed semester cannot receive a reusable class link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_onboarding_links WHERE organization_id = 'bf100000-0000-4000-8000-000000000001'),
  0,
  'rejected create attempts write no onboarding link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_cohorts WHERE organization_id = 'bf100000-0000-4000-8000-000000000001'),
  2,
  'rejected create attempts write no class'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_terms WHERE organization_id = 'bf100000-0000-4000-8000-000000000001'),
  2,
  'rejected create attempts write no semester'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_cohort_terms WHERE organization_id = 'bf100000-0000-4000-8000-000000000001'),
  1,
  'rejected create attempts write no class-semester link'
);

-- 15-26: successful create, immutable audit receipt, exact replay, conflict.
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000006',
    jsonb_build_object(
      'operation', 'create',
      'cohortId', 'bf200000-0000-4000-8000-000000000001',
      'termId', 'bf300000-0000-4000-8000-000000000001',
      'title', 'Class of 2042 reusable link',
      'linkType', 'combined',
      'googleFormUrl', 'https://docs.google.com/forms/d/example',
      'landingMessage', 'Use your verified student email.'
    )
  )$$,
  'an authorized actor atomically creates a reusable class link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_onboarding_links WHERE organization_id = 'bf100000-0000-4000-8000-000000000001'),
  1,
  'successful create writes exactly one link'
);
SELECT extensions.is(
  (SELECT invitation_scope FROM plugin_data.csf_onboarding_links WHERE organization_id = 'bf100000-0000-4000-8000-000000000001'),
  'cohort',
  'the reusable link is explicitly cohort-scoped'
);
SELECT extensions.is(
  (SELECT created_by FROM plugin_data.csf_onboarding_links WHERE organization_id = 'bf100000-0000-4000-8000-000000000001'),
  'bf000000-0000-4000-8000-000000000001'::uuid,
  'the reusable link records the exact actor'
);
SELECT extensions.is(
  (SELECT action FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'bf100000-0000-4000-8000-000000000001' AND correlation_id = 'bf900000-0000-4000-8000-000000000006'),
  'onboarding_link.create',
  'create commits its immutable audit action in the same transaction'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'bf100000-0000-4000-8000-000000000001' AND correlation_id = 'bf900000-0000-4000-8000-000000000006'),
  1,
  'create writes one request receipt'
);
SELECT extensions.is(
  (plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000006',
    jsonb_build_object(
      'operation', 'create',
      'cohortId', 'bf200000-0000-4000-8000-000000000001',
      'termId', 'bf300000-0000-4000-8000-000000000001',
      'title', 'Class of 2042 reusable link',
      'linkType', 'combined',
      'googleFormUrl', 'https://docs.google.com/forms/d/example',
      'landingMessage', 'Use your verified student email.'
    )
  ) ->> 'idempotent')::boolean,
  true,
  'an exact create retry returns its prior receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_onboarding_links WHERE organization_id = 'bf100000-0000-4000-8000-000000000001'),
  1,
  'an exact create retry writes no duplicate link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'bf100000-0000-4000-8000-000000000001' AND correlation_id = 'bf900000-0000-4000-8000-000000000006'),
  1,
  'an exact create retry writes no duplicate audit receipt'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000006',
    jsonb_build_object(
      'operation', 'create',
      'cohortId', 'bf200000-0000-4000-8000-000000000001',
      'termId', 'bf300000-0000-4000-8000-000000000001',
      'title', 'Conflicting title',
      'linkType', 'combined',
      'googleFormUrl', 'https://docs.google.com/forms/d/example',
      'landingMessage', 'Use your verified student email.'
    )
  )$$,
  'P0001', 'This class-invitation request identifier is already bound to different content.',
  'a create retry with changed content conflicts'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_onboarding_links WHERE organization_id = 'bf100000-0000-4000-8000-000000000001'),
  1,
  'a conflicting create retry changes no link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_cohort_terms WHERE organization_id = 'bf100000-0000-4000-8000-000000000001'),
  1,
  'successful create and retries never change class configuration'
);

INSERT INTO plugin_data.csf_onboarding_links (
  id, organization_id, term_id, cohort_id, code, title, link_type,
  is_active, created_by, invitation_scope, delivery_status
) VALUES
  ('bf400000-0000-4000-8000-000000000001', 'bf100000-0000-4000-8000-000000000001', 'bf300000-0000-4000-8000-000000000001', 'bf200000-0000-4000-8000-000000000001', 'toggle-link', 'Toggle link', 'combined', true, 'bf000000-0000-4000-8000-000000000001', 'cohort', 'link_ready'),
  ('bf400000-0000-4000-8000-000000000002', 'bf100000-0000-4000-8000-000000000002', 'bf300000-0000-4000-8000-000000000003', 'bf200000-0000-4000-8000-000000000003', 'other-toggle-link', 'Other toggle link', 'combined', true, 'bf000000-0000-4000-8000-000000000003', 'cohort', 'link_ready');

-- 27-43: exact toggle tenant checks, replay/conflict, and safe stale shutdown.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000002',
    'bf900000-0000-4000-8000-000000000007',
    jsonb_build_object('operation', 'set_active', 'linkId', 'bf400000-0000-4000-8000-000000000001', 'isActive', false)
  )$$,
  'P0001', 'Not authorized to manage CSF class invitations.',
  'an ordinary member cannot deactivate a class link'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000008',
    jsonb_build_object('operation', 'set_active', 'linkId', 'bf400000-0000-4000-8000-000000000002', 'isActive', false)
  )$$,
  'P0001', 'The class invitation was not found in this organization.',
  'an administrator cannot toggle another tenant class link'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000009',
    jsonb_build_object('operation', 'set_active', 'linkId', 'bf400000-0000-4000-8000-000000000001', 'isActive', false)
  )$$,
  'an authorized actor atomically deactivates a reusable class link'
);
SELECT extensions.is(
  (SELECT is_active FROM plugin_data.csf_onboarding_links WHERE id = 'bf400000-0000-4000-8000-000000000001'),
  false,
  'deactivation commits the requested state'
);
SELECT extensions.is(
  (SELECT action FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'bf100000-0000-4000-8000-000000000001' AND correlation_id = 'bf900000-0000-4000-8000-000000000009'),
  'onboarding_link.deactivate',
  'deactivation commits its audit receipt'
);
SELECT extensions.is(
  (plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000009',
    jsonb_build_object('operation', 'set_active', 'linkId', 'bf400000-0000-4000-8000-000000000001', 'isActive', false)
  ) ->> 'idempotent')::boolean,
  true,
  'an exact deactivation retry returns its prior receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'bf100000-0000-4000-8000-000000000001' AND correlation_id = 'bf900000-0000-4000-8000-000000000009'),
  1,
  'an exact deactivation retry writes no duplicate audit receipt'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000009',
    jsonb_build_object('operation', 'set_active', 'linkId', 'bf400000-0000-4000-8000-000000000001', 'isActive', true)
  )$$,
  'P0001', 'This class-invitation request identifier is already bound to different content.',
  'a toggle retry with changed state conflicts'
);
SELECT extensions.is(
  (SELECT is_active FROM plugin_data.csf_onboarding_links WHERE id = 'bf400000-0000-4000-8000-000000000001'),
  false,
  'a conflicting toggle retry changes no link'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000010',
    jsonb_build_object('operation', 'set_active', 'linkId', 'bf400000-0000-4000-8000-000000000001', 'isActive', true)
  )$$,
  'a valid reusable class link can be reactivated'
);
SELECT extensions.is(
  (SELECT is_active FROM plugin_data.csf_onboarding_links WHERE id = 'bf400000-0000-4000-8000-000000000001'),
  true,
  'reactivation commits the requested state'
);
SELECT extensions.is(
  (SELECT action FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'bf100000-0000-4000-8000-000000000001' AND correlation_id = 'bf900000-0000-4000-8000-000000000010'),
  'onboarding_link.activate',
  'reactivation commits its audit receipt'
);

UPDATE plugin_data.csf_cohort_terms
SET status = 'inactive'
WHERE id = 'bf310000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000011',
    jsonb_build_object('operation', 'set_active', 'linkId', 'bf400000-0000-4000-8000-000000000001', 'isActive', false)
  )$$,
  'an administrator can safely deactivate a link after its class configuration becomes inactive'
);
SELECT extensions.is(
  (SELECT is_active FROM plugin_data.csf_onboarding_links WHERE id = 'bf400000-0000-4000-8000-000000000001'),
  false,
  'safe stale-configuration shutdown leaves the link inactive'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'bf100000-0000-4000-8000-000000000001',
    'bf000000-0000-4000-8000-000000000001',
    'bf900000-0000-4000-8000-000000000012',
    jsonb_build_object('operation', 'set_active', 'linkId', 'bf400000-0000-4000-8000-000000000001', 'isActive', true)
  )$$,
  'P0001', 'The class invitation cannot be reactivated because its class-semester link is not active.',
  'reactivation fails when the exact class-semester link is inactive'
);
SELECT extensions.is(
  (SELECT is_active FROM plugin_data.csf_onboarding_links WHERE id = 'bf400000-0000-4000-8000-000000000001'),
  false,
  'failed stale-configuration reactivation changes no link'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'bf100000-0000-4000-8000-000000000001' AND correlation_id = 'bf900000-0000-4000-8000-000000000012'),
  0,
  'failed stale-configuration reactivation writes no audit receipt'
);

SELECT * FROM extensions.finish();
ROLLBACK;
