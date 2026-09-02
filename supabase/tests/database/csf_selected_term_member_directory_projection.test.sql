BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(20);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'anonymous clients cannot read the selected-term class directory'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot read the selected-term class directory'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'the server role can read the selected-term class directory'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_count_cohort_term_members(uuid,uuid[],uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot read grouped class counts'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_count_cohort_term_members(uuid,uuid[],uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot read grouped class counts'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_count_cohort_term_members(uuid,uuid[],uuid)',
    'EXECUTE'
  ),
  'the server role can read grouped class counts'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  (
  'fa000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'current-directory@local.test', now(),
  '{}', '{}', now(), now()
  ),
  (
  'fa000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'withdrawn-directory@local.test', now(),
  '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fa100000-0000-4000-8000-000000000001', 'Selected Directory A', 'selected-directory-a', 'school', '984001'),
  ('fa100000-0000-4000-8000-000000000002', 'Selected Directory B', 'selected-directory-b', 'school', '984002');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('fa200000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true),
  ('fa200000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000002', 'F30', 'Fall 2030', '2030-2031', 'fall', true);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, total_points_required, required_meetings,
  dues_required
) VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  7, 2, true
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  ('fa300000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 2031, 'Class of 2031'),
  ('fa300000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 2032, 'Class of 2032'),
  ('fa300000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000002', 2031, 'Class of 2031');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, middle_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email
) VALUES
  ('fa400000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'NoTerm', NULL, 'Alpha', 'noterm', 'alpha', 'noterm@local.test', 'noterm@local.test'),
  ('fa400000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'Pending', 'Juniper', 'Bravo', 'pending', 'bravo', 'pending@local.test', 'pending@local.test'),
  ('fa400000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'Withdrawn', NULL, 'Charlie', 'withdrawn', 'charlie', 'withdrawn@local.test', 'withdrawn@local.test'),
  ('fa400000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'Current', NULL, 'Delta', 'current', 'delta', 'current@local.test', 'current@local.test'),
  ('fa400000-0000-4000-8000-000000000005', 'fa100000-0000-4000-8000-000000000001', 'Historical', NULL, 'Echo', 'historical', 'echo', 'historical@local.test', 'historical@local.test'),
  ('fa400000-0000-4000-8000-000000000006', 'fa100000-0000-4000-8000-000000000001', 'Archived', NULL, 'Foxtrot', 'archived', 'foxtrot', 'archived@local.test', 'archived@local.test'),
  ('fa400000-0000-4000-8000-000000000007', 'fa100000-0000-4000-8000-000000000001', 'OtherClass', NULL, 'Golf', 'otherclass', 'golf', 'other-class@local.test', 'other-class@local.test'),
  ('fa400000-0000-4000-8000-000000000008', 'fa100000-0000-4000-8000-000000000002', 'OtherTenant', NULL, 'Hotel', 'othertenant', 'hotel', 'other-tenant@local.test', 'other-tenant@local.test');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email
)
SELECT
  (
    'fb' || lpad(series_number::text, 6, '0') ||
    '-0000-4000-8000-' || lpad(series_number::text, 12, '0')
  )::uuid,
  'fa100000-0000-4000-8000-000000000001'::uuid,
  'Filler ' || series_number,
  'Aardvark ' || lpad(series_number::text, 2, '0'),
  'filler ' || series_number,
  'aardvark ' || lpad(series_number::text, 2, '0'),
  'filler-' || series_number || '@local.test',
  'filler-' || series_number || '@local.test'
FROM generate_series(1, 50) AS filler(series_number);

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  id, organization_id, profile_id, cohort_id, status
) VALUES
  ('fa800000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'active'),
  ('fa800000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002', 'fa300000-0000-4000-8000-000000000001', 'active'),
  ('fa800000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000003', 'fa300000-0000-4000-8000-000000000001', 'active'),
  ('fa800000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000004', 'fa300000-0000-4000-8000-000000000001', 'active'),
  ('fa800000-0000-4000-8000-000000000005', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000005', 'fa300000-0000-4000-8000-000000000001', 'transferred'),
  ('fa800000-0000-4000-8000-000000000006', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000006', 'fa300000-0000-4000-8000-000000000001', 'archived'),
  ('fa800000-0000-4000-8000-000000000007', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000007', 'fa300000-0000-4000-8000-000000000002', 'active'),
  ('fa800000-0000-4000-8000-000000000008', 'fa100000-0000-4000-8000-000000000002', 'fa400000-0000-4000-8000-000000000008', 'fa300000-0000-4000-8000-000000000003', 'active');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  id, organization_id, profile_id, cohort_id, status
)
SELECT
  (
    'fc' || lpad(series_number::text, 6, '0') ||
    '-0000-4000-8000-' || lpad(series_number::text, 12, '0')
  )::uuid,
  'fa100000-0000-4000-8000-000000000001'::uuid,
  (
    'fb' || lpad(series_number::text, 6, '0') ||
    '-0000-4000-8000-' || lpad(series_number::text, 12, '0')
  )::uuid,
  'fa300000-0000-4000-8000-000000000001'::uuid,
  'active'
FROM generate_series(1, 50) AS filler(series_number);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  submission_status, eligibility_status, decision_status, submitted_at
) VALUES
  ('fa600000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002', 'fa300000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'manual', 'submitted', 'ready', 'pending', 'pending', now()),
  ('fa600000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000003', 'fa300000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'manual', 'accepted', 'decided', 'eligible', 'approved', now()),
  ('fa600000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000004', 'fa300000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'manual', 'accepted', 'decided', 'eligible', 'approved', now());

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, cohort_id, term_id, application_id, status
) VALUES
  ('fa700000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002', 'fa300000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'fa600000-0000-4000-8000-000000000002', 'pending'),
  ('fa700000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000003', 'fa300000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'fa600000-0000-4000-8000-000000000003', 'withdrawn'),
  ('fa700000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000004', 'fa300000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'fa600000-0000-4000-8000-000000000004', 'completed'),
  ('fa700000-0000-4000-8000-000000000007', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000007', 'fa300000-0000-4000-8000-000000000002', 'fa200000-0000-4000-8000-000000000001', NULL, 'active'),
  ('fa700000-0000-4000-8000-000000000008', 'fa100000-0000-4000-8000-000000000002', 'fa400000-0000-4000-8000-000000000008', 'fa300000-0000-4000-8000-000000000003', 'fa200000-0000-4000-8000-000000000002', NULL, 'active');

INSERT INTO plugin_data.csf_profile_accounts (
  id, organization_id, profile_id, user_id, status, is_primary
) VALUES
  (
  'fa500000-0000-4000-8000-000000000004',
  'fa100000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000004',
  'fa000000-0000-4000-8000-000000000001',
  'verified', true
  ),
  (
  'fa500000-0000-4000-8000-000000000003',
  'fa100000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000003',
  'fa000000-0000-4000-8000-000000000002',
  'verified', true
  );

INSERT INTO plugin_data.csf_dues_records (
  id, organization_id, application_id, profile_id, term_id, status,
  verified_at
) VALUES
  (
  'fab00000-0000-4000-8000-000000000004',
  'fa100000-0000-4000-8000-000000000001',
  'fa600000-0000-4000-8000-000000000004',
  'fa400000-0000-4000-8000-000000000004',
  'fa200000-0000-4000-8000-000000000001',
  'verified', now()
  ),
  (
  'fab00000-0000-4000-8000-000000000003',
  'fa100000-0000-4000-8000-000000000001',
  'fa600000-0000-4000-8000-000000000003',
  'fa400000-0000-4000-8000-000000000003',
  'fa200000-0000-4000-8000-000000000001',
  'verified', now()
  )
ON CONFLICT (organization_id, application_id) DO UPDATE
SET status = EXCLUDED.status,
    verified_at = EXCLUDED.verified_at;

INSERT INTO plugin_data.csf_credit_records (
  id, organization_id, profile_id, term_id, source, points, point_type, status
) VALUES
  ('fa900000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002', 'fa200000-0000-4000-8000-000000000001', 'manual', 2, 'non_drive', 'pending'),
  ('fa900000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000004', 'fa200000-0000-4000-8000-000000000001', 'manual', 5, 'non_drive', 'verified');

INSERT INTO plugin_data.csf_meeting_attendance (
  id, organization_id, profile_id, term_id, meeting_key, meeting_label,
  status, source
) VALUES (
  'faa00000-0000-4000-8000-000000000004',
  'fa100000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000004',
  'fa200000-0000-4000-8000-000000000001',
  'fall-general', 'Fall general meeting', 'attended', 'manual'
);

SELECT extensions.results_eq(
  $$
    SELECT profile_id
    FROM plugin_data.csf_list_class_directory_page(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000001',
      'directory', NULL, NULL, NULL, 'name', NULL, NULL, 101
    )
    WHERE profile_id::text LIKE 'fa400000-%'
  $$,
  $$ VALUES
    ('fa400000-0000-4000-8000-000000000001'::uuid),
    ('fa400000-0000-4000-8000-000000000002'::uuid),
    ('fa400000-0000-4000-8000-000000000003'::uuid),
    ('fa400000-0000-4000-8000-000000000004'::uuid),
    ('fa400000-0000-4000-8000-000000000005'::uuid)
  $$,
  'Directory keeps no-membership, pending, withdrawn, and transferred history while excluding archived rows'
);

SELECT extensions.results_eq(
  $$
    SELECT
      max(directory_count), max(current_count), max(senior_count),
      max(connected_count), max(attention_count)
    FROM plugin_data.csf_list_class_directory_page(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000001',
      'directory', NULL, NULL, NULL, 'name', NULL, NULL, 50
    )
  $$,
  $$ VALUES (55::bigint, 1::bigint, 55::bigint, 2::bigint, 53::bigint) $$,
  'one projection reports durable Directory and selected-semester counts'
);

SELECT extensions.results_eq(
  $$
    SELECT profile_id
    FROM plugin_data.csf_list_class_directory_page(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000001',
      'current', NULL, NULL, NULL, 'name', NULL, NULL, 50
    )
    WHERE profile_id::text LIKE 'fa400000-%'
  $$,
  $$ VALUES ('fa400000-0000-4000-8000-000000000004'::uuid) $$,
  'Current semester includes only accepted participation states'
);

SELECT extensions.results_eq(
  $$
    SELECT profile_id
    FROM plugin_data.csf_list_class_directory_page(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000001',
      'directory', NULL, NULL, 'application', 'name', NULL, NULL, 101
    )
    WHERE profile_id::text LIKE 'fa400000-%'
  $$,
  $$ VALUES
    ('fa400000-0000-4000-8000-000000000001'::uuid),
    ('fa400000-0000-4000-8000-000000000002'::uuid),
    ('fa400000-0000-4000-8000-000000000005'::uuid)
  $$,
  'application filter evaluates selected-term state across the full Directory'
);

SELECT extensions.results_eq(
  $$
    SELECT profile_id
    FROM plugin_data.csf_list_class_directory_page(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000001',
      'directory', NULL, NULL, 'attention', 'name', NULL, NULL, 101
    )
    WHERE profile_id::text LIKE 'fa400000-%'
  $$,
  $$ VALUES
    ('fa400000-0000-4000-8000-000000000001'::uuid),
    ('fa400000-0000-4000-8000-000000000002'::uuid),
    ('fa400000-0000-4000-8000-000000000005'::uuid)
  $$,
  'attention resolves withdrawn membership but keeps pending and missing selected-term state'
);

SELECT extensions.results_eq(
  $$
    SELECT profile_id
    FROM plugin_data.csf_list_class_directory_page(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000001',
      'directory', NULL, NULL, 'pending_points', 'name', NULL, NULL, 50
    )
    WHERE profile_id IS NOT NULL
  $$,
  $$ VALUES ('fa400000-0000-4000-8000-000000000002'::uuid) $$,
  'pending-point filters keep a pending selected-semester member visible'
);

SELECT extensions.results_eq(
  $$
    SELECT profile_id
    FROM plugin_data.csf_list_class_directory_page(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000001',
      'directory', NULL, NULL, 'membership_complete', 'name', NULL, NULL, 50
    )
    WHERE profile_id IS NOT NULL
  $$,
  $$ VALUES ('fa400000-0000-4000-8000-000000000004'::uuid) $$,
  'membership-complete filter uses the selected semester'
);

SELECT extensions.results_eq(
  $$
    WITH unfiltered_page AS (
      SELECT profile_id
      FROM plugin_data.csf_list_class_directory_page(
        'fa100000-0000-4000-8000-000000000001',
        'fa200000-0000-4000-8000-000000000001',
        'fa300000-0000-4000-8000-000000000001',
        'directory', NULL, NULL, NULL, 'name', NULL, NULL, 50
      )
      WHERE profile_id IS NOT NULL
    ), searched AS (
      SELECT *
      FROM plugin_data.csf_list_class_directory_page(
        'fa100000-0000-4000-8000-000000000001',
        'fa200000-0000-4000-8000-000000000001',
        'fa300000-0000-4000-8000-000000000001',
        'directory', 'Pending Juniper Bravo', NULL, NULL,
        'name', NULL, NULL, 50
      )
    )
    SELECT
      NOT EXISTS (
        SELECT 1 FROM unfiltered_page
        WHERE profile_id = 'fa400000-0000-4000-8000-000000000002'
      ),
      (
        SELECT count(*) = 1
        FROM searched
        WHERE profile_id = 'fa400000-0000-4000-8000-000000000002'
      ),
      max(total_count), max(directory_count), max(current_count)
    FROM searched
  $$,
  $$ VALUES (true, true, 1::bigint, 55::bigint, 1::bigint) $$,
  'search finds a middle-name match beyond the unfiltered first page and preserves class counts'
);

SELECT extensions.results_eq(
  $$
    SELECT verified_points, pending_points, meetings_attended,
      required_points, required_meetings
    FROM plugin_data.csf_list_class_directory_page(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000001',
      'directory', 'Current Delta', NULL, NULL,
      'name', NULL, NULL, 50
    )
    WHERE profile_id IS NOT NULL
  $$,
  $$ VALUES (5::numeric, 0::numeric, 1::bigint, 7::numeric, 2::integer) $$,
  'progress and policy values come from the selected semester'
);

SELECT extensions.ok(
  (
    WITH first_page AS (
      SELECT *
      FROM plugin_data.csf_list_class_directory_page(
        'fa100000-0000-4000-8000-000000000001',
        'fa200000-0000-4000-8000-000000000001',
        'fa300000-0000-4000-8000-000000000001',
        'directory', NULL, NULL, NULL, 'name', NULL, NULL, 2
      )
      WHERE profile_id IS NOT NULL
    ), cursor_row AS (
      SELECT cursor_primary, cursor_id
      FROM first_page
      ORDER BY cursor_primary DESC, cursor_id DESC
      LIMIT 1
    ), second_page AS (
      SELECT *
      FROM plugin_data.csf_list_class_directory_page(
        'fa100000-0000-4000-8000-000000000001',
        'fa200000-0000-4000-8000-000000000001',
        'fa300000-0000-4000-8000-000000000001',
        'directory', NULL, NULL, NULL, 'name',
        (SELECT cursor_primary FROM cursor_row),
        (SELECT cursor_id FROM cursor_row), 2
      )
      WHERE profile_id IS NOT NULL
    )
    SELECT
      (SELECT count(*) FROM second_page) = 2
      AND NOT EXISTS (
        SELECT 1 FROM first_page
        JOIN second_page USING (profile_id)
      )
  ),
  'the keyset cursor returns a distinct next page'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_class_directory_page(
      'fa100000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000003',
      'directory', NULL, NULL, NULL, 'name', NULL, NULL, 50
    )
    WHERE profile_id IS NOT NULL
  ),
  0,
  'the selected-term directory rejects a class from another tenant'
);

SELECT extensions.results_eq(
  $$
    SELECT cohort_id, member_count
    FROM plugin_data.csf_count_cohort_term_members(
      'fa100000-0000-4000-8000-000000000001',
      ARRAY[
        'fa300000-0000-4000-8000-000000000001'::uuid,
        'fa300000-0000-4000-8000-000000000002'::uuid
      ],
      'fa200000-0000-4000-8000-000000000001'
    )
  $$,
  $$ VALUES
    ('fa300000-0000-4000-8000-000000000001'::uuid, 1::bigint),
    ('fa300000-0000-4000-8000-000000000002'::uuid, 1::bigint)
  $$,
  'one grouped read returns selected-semester member counts for every requested class'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_count_cohort_term_members(
      'fa100000-0000-4000-8000-000000000001',
      ARRAY['fa300000-0000-4000-8000-000000000003'::uuid],
      'fa200000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'grouped class counts omit another tenant'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM plugin_data.csf_count_cohort_term_members(
      'fa100000-0000-4000-8000-000000000001',
      ARRAY(
        SELECT gen_random_uuid()
        FROM generate_series(1, 101)
      ),
      'fa200000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  'CSF cohort count scope exceeds 100 classes.',
  'grouped class counts reject unbounded arrays'
);

SELECT * FROM extensions.finish();
ROLLBACK;
