BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(22);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_list_applications_page(uuid,text,text,text,text,text,text,text,uuid,uuid,text,text,text,uuid,integer,boolean)',
    'EXECUTE'
  ),
  'anonymous clients cannot read the application list projection'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_list_applications_page(uuid,text,text,text,text,text,text,text,uuid,uuid,text,text,text,uuid,integer,boolean)',
    'EXECUTE'
  ),
  'authenticated clients cannot read the application list projection directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_list_applications_page(uuid,text,text,text,text,text,text,text,uuid,uuid,text,text,text,uuid,integer,boolean)',
    'EXECUTE'
  ),
  'the server role can read the application list projection'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'anonymous clients cannot read the member list projection'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot read the member list projection directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'the server role can read the member list projection'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_install_default_roles_projection_base(uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass scoped import and report defaults'
);
SELECT extensions.has_column(
  'plugin_data',
  'csf_sheet_sources',
  'source_type',
  'Sheet sources store their operational import domain explicitly'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_sheet_sources'::regclass
      AND conname = 'csf_sheet_sources_source_type_check'
  ),
  'Sheet source domains are constrained to the supported importer catalog'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('cd100000-0000-4000-8000-000000000001', 'CSF Projection A', 'csf-projection-a', 'school', '982001'),
  ('cd100000-0000-4000-8000-000000000002', 'CSF Projection B', 'csf-projection-b', 'school', '982002');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('cd200000-0000-4000-8000-000000000001', 'cd100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true),
  ('cd200000-0000-4000-8000-000000000002', 'cd100000-0000-4000-8000-000000000002', 'F30', 'Fall 2030', '2030-2031', 'fall', true);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  ('cd300000-0000-4000-8000-000000000001', 'cd100000-0000-4000-8000-000000000001', 2031, 'Class of 2031'),
  ('cd300000-0000-4000-8000-000000000002', 'cd100000-0000-4000-8000-000000000002', 2031, 'Class of 2031');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email
) VALUES
  ('cd400000-0000-4000-8000-000000000001', 'cd100000-0000-4000-8000-000000000001', 'Aster', 'Able', 'aster', 'able', 'aster@students.local.test', 'aster@students.local.test'),
  ('cd400000-0000-4000-8000-000000000002', 'cd100000-0000-4000-8000-000000000001', 'Birch', 'Baker', 'birch', 'baker', 'birch@students.local.test', 'birch@students.local.test'),
  ('cd400000-0000-4000-8000-000000000003', 'cd100000-0000-4000-8000-000000000001', 'Cedar', 'Clark', 'cedar', 'clark', 'cedar@students.local.test', 'cedar@students.local.test'),
  ('cd400000-0000-4000-8000-000000000004', 'cd100000-0000-4000-8000-000000000002', 'Private', 'Tenant', 'private', 'tenant', 'private@students.local.test', 'private@students.local.test');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id
) VALUES
  ('cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000001', 'cd300000-0000-4000-8000-000000000001'),
  ('cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000002', 'cd300000-0000-4000-8000-000000000001'),
  ('cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000003', 'cd300000-0000-4000-8000-000000000001'),
  ('cd100000-0000-4000-8000-000000000002', 'cd400000-0000-4000-8000-000000000004', 'cd300000-0000-4000-8000-000000000002');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id,
  source, status, submission_status, submitted_at
) VALUES
  ('cd500000-0000-4000-8000-000000000001', 'cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000001', 'cd300000-0000-4000-8000-000000000001', 'cd200000-0000-4000-8000-000000000001', 'manual', 'submitted', 'ready', '2030-08-01T17:00:00Z'),
  ('cd500000-0000-4000-8000-000000000002', 'cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000002', 'cd300000-0000-4000-8000-000000000001', 'cd200000-0000-4000-8000-000000000001', 'manual', 'submitted', 'ready', '2030-08-02T17:00:00Z'),
  ('cd500000-0000-4000-8000-000000000003', 'cd100000-0000-4000-8000-000000000002', 'cd400000-0000-4000-8000-000000000004', 'cd300000-0000-4000-8000-000000000002', 'cd200000-0000-4000-8000-000000000002', 'manual', 'submitted', 'ready', '2030-08-03T17:00:00Z');

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_install_default_roles('cd100000-0000-4000-8000-000000000001') $$,
  'scoped role templates install successfully'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_role_permissions
    WHERE organization_id = 'cd100000-0000-4000-8000-000000000001'
  ),
  418,
  'a fresh organization receives one eleven-by-thirty-eight permission matrix'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_role_permissions
    WHERE organization_id = 'cd100000-0000-4000-8000-000000000001'
      AND permission_key IN ('manage_sheet_sync', 'resolve_imports', 'export_reports')
      AND enabled
  ),
  'broad pre-cutover import and report permissions remain disabled on system roles'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_roles AS role
    JOIN plugin_data.csf_role_permissions AS club_import
      ON club_import.role_id = role.id
     AND club_import.permission_key = 'import_partner_clubs'
     AND club_import.enabled
    LEFT JOIN plugin_data.csf_role_permissions AS application_import
      ON application_import.role_id = role.id
     AND application_import.permission_key = 'import_applications'
     AND application_import.enabled
    WHERE role.organization_id = 'cd100000-0000-4000-8000-000000000001'
      AND role.key = 'vice-president-clubs'
      AND application_import.id IS NULL
  ),
  'VP Clubs receives only the related import domain'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_profiles_page(
      'cd100000-0000-4000-8000-000000000001',
      'directory', NULL, NULL, NULL, NULL, 'name', NULL, NULL, 2
    )
    WHERE profile_id IS NOT NULL
  ),
  2,
  'member projection returns only the requested keyset page'
);
SELECT extensions.is(
  (
    SELECT max(total_count)::integer
    FROM plugin_data.csf_list_profiles_page(
      'cd100000-0000-4000-8000-000000000001',
      'directory', NULL, NULL, NULL, NULL, 'name', NULL, NULL, 2
    )
  ),
  3,
  'member projection reports the filtered total independently of page size'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_profiles_page(
      'cd100000-0000-4000-8000-000000000001',
      'directory', 'Birch', NULL, NULL, NULL, 'name', NULL, NULL, 50
    )
    WHERE profile_id = 'cd400000-0000-4000-8000-000000000002'
  ),
  1,
  'member search is applied on the server'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_profiles_page(
      'cd100000-0000-4000-8000-000000000001',
      'directory', NULL, NULL, NULL, NULL, 'name', NULL, NULL, 50
    )
    WHERE profile_id = 'cd400000-0000-4000-8000-000000000004'
  ),
  0,
  'member projection never crosses the organization boundary'
);
SELECT extensions.is(
  (
    WITH first_page AS (
      SELECT *
      FROM plugin_data.csf_list_profiles_page(
        'cd100000-0000-4000-8000-000000000001',
        'directory', NULL, NULL, NULL, NULL, 'name', NULL, NULL, 2
      )
      WHERE profile_id IS NOT NULL
      ORDER BY cursor_primary, cursor_id
    ), second_page AS (
      SELECT *
      FROM plugin_data.csf_list_profiles_page(
        'cd100000-0000-4000-8000-000000000001',
        'directory', NULL, NULL, NULL, NULL, 'name',
        (SELECT cursor_primary FROM first_page ORDER BY cursor_primary DESC, cursor_id DESC LIMIT 1),
        (SELECT cursor_id FROM first_page ORDER BY cursor_primary DESC, cursor_id DESC LIMIT 1),
        2
      )
      WHERE profile_id IS NOT NULL
    )
    SELECT count(*)::integer FROM second_page
  ),
  1,
  'member cursor returns the next unique page'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_applications_page(
      'cd100000-0000-4000-8000-000000000001',
      'review', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 1, false
    )
  ),
  1,
  'application projection returns only the requested keyset page'
);
SELECT extensions.is(
  (
    SELECT max(total_count)::integer
    FROM plugin_data.csf_list_applications_page(
      'cd100000-0000-4000-8000-000000000001',
      'review', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 1, false
    )
  ),
  2,
  'application projection reports the filtered total independently of page size'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_applications_page(
      'cd100000-0000-4000-8000-000000000001',
      'review', 'Birch', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false
    )
    WHERE item ->> 'id' = 'cd500000-0000-4000-8000-000000000002'
  ),
  1,
  'application search is applied on the server'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_applications_page(
      'cd100000-0000-4000-8000-000000000001',
      'all', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false
    )
    WHERE item ->> 'id' = 'cd500000-0000-4000-8000-000000000003'
  ),
  0,
  'application projection never crosses the organization boundary'
);

SELECT * FROM extensions.finish();

ROLLBACK;
