BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(8);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_list_class_profiles_page(uuid,uuid,uuid,text,text,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'anonymous clients cannot read a class roster projection'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_list_class_profiles_page(uuid,uuid,uuid,text,text,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot read a class roster projection directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_list_class_profiles_page(uuid,uuid,uuid,text,text,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'the server role can read a class roster projection'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ce100000-0000-4000-8000-000000000001', 'Class Projection A', 'class-projection-a', 'school', '983001'),
  ('ce100000-0000-4000-8000-000000000002', 'Class Projection B', 'class-projection-b', 'school', '983002');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('ce200000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true),
  ('ce200000-0000-4000-8000-000000000002', 'ce100000-0000-4000-8000-000000000001', 'S30', 'Spring 2030', '2029-2030', 'spring', false),
  ('ce200000-0000-4000-8000-000000000003', 'ce100000-0000-4000-8000-000000000002', 'F30', 'Fall 2030', '2030-2031', 'fall', true);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  ('ce300000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001', 2031, 'Class of 2031'),
  ('ce300000-0000-4000-8000-000000000002', 'ce100000-0000-4000-8000-000000000002', 2031, 'Class of 2031');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, middle_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email
) VALUES
  ('ce400000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001', 'Current', 'Display', 'Member', 'current', 'member', 'current@students.local.test', 'current@students.local.test'),
  ('ce400000-0000-4000-8000-000000000002', 'ce100000-0000-4000-8000-000000000001', 'Current', 'Display', 'Member', 'current', 'member', 'historical@students.local.test', 'historical@students.local.test'),
  ('ce400000-0000-4000-8000-000000000003', 'ce100000-0000-4000-8000-000000000001', 'Stable', NULL, 'Only', 'stable', 'only', 'stable@students.local.test', 'stable@students.local.test'),
  ('ce400000-0000-4000-8000-000000000004', 'ce100000-0000-4000-8000-000000000002', 'Current', 'Display', 'Member', 'current', 'member', 'other@students.local.test', 'other@students.local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id
) VALUES
  ('ce100000-0000-4000-8000-000000000001', 'ce400000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000001'),
  ('ce100000-0000-4000-8000-000000000001', 'ce400000-0000-4000-8000-000000000002', 'ce300000-0000-4000-8000-000000000001'),
  ('ce100000-0000-4000-8000-000000000001', 'ce400000-0000-4000-8000-000000000003', 'ce300000-0000-4000-8000-000000000001'),
  ('ce100000-0000-4000-8000-000000000002', 'ce400000-0000-4000-8000-000000000004', 'ce300000-0000-4000-8000-000000000002');

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, cohort_id, term_id, status
) VALUES
  ('ce100000-0000-4000-8000-000000000001', 'ce400000-0000-4000-8000-000000000001', 'ce300000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001', 'active'),
  ('ce100000-0000-4000-8000-000000000001', 'ce400000-0000-4000-8000-000000000002', 'ce300000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000002', 'completed'),
  ('ce100000-0000-4000-8000-000000000002', 'ce400000-0000-4000-8000-000000000004', 'ce300000-0000-4000-8000-000000000002', 'ce200000-0000-4000-8000-000000000003', 'active');

SELECT extensions.results_eq(
  $$
    SELECT profile_id
    FROM plugin_data.csf_list_class_profiles_page(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000001',
      NULL, NULL, NULL, 'name', NULL, NULL, 50
    )
    WHERE profile_id IS NOT NULL
  $$,
  $$ VALUES ('ce400000-0000-4000-8000-000000000001'::uuid) $$,
  'the current semester returns only its participating class member'
);

SELECT extensions.results_eq(
  $$
    SELECT profile_id
    FROM plugin_data.csf_list_class_profiles_page(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000002',
      'ce300000-0000-4000-8000-000000000001',
      NULL, NULL, NULL, 'name', NULL, NULL, 50
    )
    WHERE profile_id IS NOT NULL
  $$,
  $$ VALUES ('ce400000-0000-4000-8000-000000000002'::uuid) $$,
  'a historical semester returns its independent class roster'
);

SELECT extensions.is(
  (
    SELECT max(current_count)::integer
    FROM plugin_data.csf_list_class_profiles_page(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000001',
      NULL, NULL, NULL, 'name', NULL, NULL, 50
    )
  ),
  1,
  'stable class-only profiles do not inflate semester member counts'
);

SELECT extensions.results_eq(
  $$
    SELECT profile_id
    FROM plugin_data.csf_list_class_profiles_page(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000001',
      'Current Display Member', NULL, 'attention', 'name', NULL, NULL, 50
    )
    WHERE profile_id IS NOT NULL
  $$,
  $$ VALUES ('ce400000-0000-4000-8000-000000000001'::uuid) $$,
  'class attention search matches the exact displayed middle name without crossing semester or tenant scope'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_class_profiles_page(
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000001',
      'Other', NULL, NULL, 'name', NULL, NULL, 50
    )
    WHERE profile_id IS NOT NULL
  ),
  0,
  'class-term projection never crosses the organization boundary'
);

SELECT * FROM extensions.finish();
ROLLBACK;
