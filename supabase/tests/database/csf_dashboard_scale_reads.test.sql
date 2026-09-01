BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(27);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'ce000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'scale-officer@local.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    'ce000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'scale-member@local.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    'ce000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'scale-outsider@local.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    'ce000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'scale-pending@local.test', now(),
    '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'ce100000-0000-4000-8000-000000000001',
    'Dashboard Scale One', 'dashboard-scale-one', 'school', '976501'
  ),
  (
    'ce100000-0000-4000-8000-000000000002',
    'Dashboard Scale Two', 'dashboard-scale-two', 'school', '976502'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001', 'admin', 'active'
  ),
  (
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000002', 'member', 'active'
  );

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'ce200000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  2033,
  'Class of 2033'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  starts_at, ends_at, is_current
) VALUES (
  'ce300000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'fall-2032', 'Fall 2032', '2032-2033', 'fall',
  '2032-08-01', '2032-12-31', true
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email
) VALUES (
  'ce400000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'Synthetic', 'Member', 'synthetic', 'member',
  'synthetic.member@local.test', 'synthetic.member@local.test'
), (
  'ce400000-0000-4000-8000-000000000002',
  'ce100000-0000-4000-8000-000000000001',
  'Pending', 'Member', 'pending', 'member',
  'pending.member@local.test', 'pending.member@local.test'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'ce400000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000002',
  'verified', true
), (
  'ce100000-0000-4000-8000-000000000001',
  'ce400000-0000-4000-8000-000000000002',
  'ce000000-0000-4000-8000-000000000004',
  'pending', false
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, initiated_by, mode, status, source_type
) VALUES (
  'ce500000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster'
);

SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_officer_home_snapshot(uuid,uuid)') IS NOT NULL,
  'the grouped officer Home snapshot exists'
);
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_member_profile_snapshot(uuid,uuid)') IS NOT NULL,
  'the grouped member profile snapshot exists'
);
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_search_profiles(uuid,uuid,text,uuid)') IS NOT NULL,
  'the bounded profile search exists'
);
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_post_reply_previews(uuid,uuid[],integer)') IS NOT NULL,
  'the grouped reply preview exists'
);
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_import_preview_readiness_batch(uuid,uuid[])') IS NOT NULL,
  'the grouped readiness projection exists'
);

SELECT extensions.is(
  (plugin_data.csf_officer_home_snapshot(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001'
  ) -> 'dashboard' ->> 'cohortCount')::integer,
  1,
  'officer Home returns the tenant cohort count'
);
SELECT extensions.is(
  plugin_data.csf_officer_home_snapshot(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001'
  ) -> 'applications' ->> 'currentTermId',
  'ce300000-0000-4000-8000-000000000001',
  'officer Home resolves the current term in the grouped read'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_officer_home_snapshot(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  'CSF officer dashboard access denied.',
  'ordinary members cannot read the officer snapshot'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_officer_home_snapshot(
    'ce100000-0000-4000-8000-000000000002',
    'ce000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'CSF officer dashboard access denied.',
  'an officer cannot cross the tenant boundary'
);

SELECT extensions.is(
  plugin_data.csf_member_profile_snapshot(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000002'
  ) -> 'profile' ->> 'id',
  'ce400000-0000-4000-8000-000000000001',
  'a member reads only the linked profile snapshot'
);
SELECT extensions.is(
  plugin_data.csf_member_profile_snapshot(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000002'
  ) ->> 'accountStatus',
  'verified',
  'the member snapshot includes the verified account state'
);
SELECT extensions.is(
  plugin_data.csf_member_profile_snapshot(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000004'
  ) ->> 'accountStatus',
  'pending',
  'a pending linked profile can read its status before organization membership activates'
);
SELECT extensions.is(
  (
    SELECT array_agg(key ORDER BY key)
    FROM jsonb_object_keys(
      plugin_data.csf_member_profile_snapshot(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000004'
      )
    ) AS key
  ),
  ARRAY['accountStatus', 'currentTermId', 'profile']::text[],
  'a pending link receives status fields only, without student profile data'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_member_profile_snapshot(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000003'
  )$$,
  '42501',
  'CSF member dashboard access denied.',
  'an outsider cannot read a member snapshot'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_search_profiles(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    's', NULL
  )),
  0,
  'profile search waits for two characters'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_search_profiles(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'sy', NULL
  )),
  1,
  'profile search returns a matching normalized name prefix'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_search_profiles(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    '', 'ce400000-0000-4000-8000-000000000001'
  )),
  1,
  'profile search hydrates one explicitly selected profile'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM plugin_data.csf_search_profiles(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000002',
    'sy', NULL
  )$$,
  '42501',
  'CSF officer dashboard access denied.',
  'profile search refuses an ordinary member'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_import_preview_readiness_batch(
    'ce100000-0000-4000-8000-000000000001',
    ARRAY['ce500000-0000-4000-8000-000000000001']::uuid[]
  )),
  1,
  'readiness returns one result for one tenant-owned preview'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_import_preview_readiness_batch(
    'ce100000-0000-4000-8000-000000000002',
    ARRAY['ce500000-0000-4000-8000-000000000001']::uuid[]
  )),
  0,
  'readiness does not return a preview from another tenant'
);

SELECT extensions.ok(
  to_regclass('plugin_data.csf_point_submissions_unresolved_queue_idx') IS NOT NULL,
  'the unresolved point submission partial index exists'
);
SELECT extensions.ok(
  to_regclass('plugin_data.csf_point_appeals_unresolved_queue_idx') IS NOT NULL,
  'the unresolved appeal partial index exists'
);
SELECT extensions.ok(
  to_regclass('plugin_data.csf_profiles_name_prefix_idx') IS NOT NULL,
  'the active profile name prefix index exists'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role', 'plugin_data.csf_officer_home_snapshot(uuid,uuid)', 'EXECUTE'
  ),
  'service_role can execute the officer snapshot'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated', 'plugin_data.csf_officer_home_snapshot(uuid,uuid)', 'EXECUTE'
  ),
  'authenticated clients cannot execute the officer snapshot'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated', 'plugin_data.csf_member_profile_snapshot(uuid,uuid)', 'EXECUTE'
  ),
  'authenticated clients cannot execute the member snapshot'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated', 'plugin_data.csf_search_profiles(uuid,uuid,text,uuid)', 'EXECUTE'
  ),
  'authenticated clients cannot execute the profile search'
);

SELECT * FROM extensions.finish();
ROLLBACK;
