BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(17);

SELECT extensions.has_function(
  'plugin_data',
  'csf_create_profile_for_class_history_import_row',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'class-history review exposes the unclaimed-profile creation RPC'
);

SELECT extensions.ok(
  (
    SELECT procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'plugin_data.csf_create_profile_for_class_history_import_row(uuid,uuid,uuid,uuid,text)'::regprocedure
  ),
  'class-history profile creation rechecks authority inside a fixed-path security definer'
);

SELECT extensions.function_privs_are(
  'plugin_data',
  'csf_create_profile_for_class_history_import_row',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'anon',
  ARRAY[]::text[],
  'anonymous clients cannot create a profile from class history'
);

SELECT extensions.function_privs_are(
  'plugin_data',
  'csf_create_profile_for_class_history_import_row',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'authenticated',
  ARRAY[]::text[],
  'browser-authenticated clients cannot create a profile from class history'
);

SELECT extensions.function_privs_are(
  'plugin_data',
  'csf_create_profile_for_class_history_import_row',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'service_role',
  ARRAY['EXECUTE'],
  'only the server boundary may invoke class-history profile creation'
);

SELECT extensions.has_index(
  'plugin_data',
  'csf_admin_audit_events',
  'csf_class_history_profile_create_request_idx',
  'class-history profile-create receipts have a unique request binding'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ca000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'history-admin@local.test', now(), '{}', '{}', now(), now()),
  ('ca000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'history-member@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ca100000-0000-4000-8000-000000000001',
  'Class History Review Profiles',
  'class-history-review-profiles',
  'school',
  '881207'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'member', 'active');

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES (
  'ca200000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  2042,
  'Class of 2042',
  'active'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, mode, status, source_type, source_sheet_tab,
  mapping_version
) VALUES (
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'preview',
  'needs_resolution',
  'class_history',
  'F40',
  1
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, cohort_id, sheet_tab_name, row_number,
  import_status, resolution_status, normalized_data
) VALUES
  (
    'ca400000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001',
    'F40', 2, 'ambiguous', 'pending',
    '{"record":{"identity":{"firstName":"Avery","lastName":"Sample","normalizedFirstName":"avery","normalizedLastName":"sample","sourceStudentKey":"differentstudent"}}}'::jsonb
  ),
  (
    'ca400000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001',
    'F40', 3, 'ambiguous', 'pending',
    '{"record":{"identity":{"firstName":"Avery","lastName":"Sample","normalizedFirstName":"avery","normalizedLastName":"sample","sourceStudentKey":"anotherstudent"}}}'::jsonb
  ),
  (
    'ca400000-0000-4000-8000-000000000003',
    'ca100000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001',
    'F40', 4, 'ambiguous', 'pending',
    '{"record":{"identity":{"firstName":"Rowan","lastName":"Other","normalizedFirstName":"rowan","normalizedLastName":"other","sourceStudentKey":"wrongstudent"}}}'::jsonb
  ),
  (
    'ca400000-0000-4000-8000-000000000004',
    'ca100000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001',
    'F40', 5, 'ambiguous', 'pending',
    '{"record":{"identity":{"firstName":"Valid","lastName":"Key","normalizedFirstName":"valid","normalizedLastName":"key","sourceStudentKey":"validkey"}}}'::jsonb
  );

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_create_profile_for_class_history_import_row(
    'ca100000-0000-4000-8000-000000000001',
    'ca400000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'ca500000-0000-4000-8000-000000000001',
    'Officer verified this is a new class record.'
  )$$,
  'an authorized officer can create an unclaimed profile from an invalid-key review row'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id = 'ca100000-0000-4000-8000-000000000001'),
  1,
  'class-history review creates exactly one profile'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_cohort_memberships WHERE organization_id = 'ca100000-0000-4000-8000-000000000001' AND status = 'active'),
  1,
  'the new profile belongs to the reviewed graduating class'
);

SELECT extensions.results_eq(
  $$SELECT import_status, resolution_status, matched_profile_id IS NOT NULL
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'ca400000-0000-4000-8000-000000000001'$$,
  $$VALUES ('pending'::text, 'resolved'::text, true)$$,
  'profile creation atomically makes the reviewed row ready to commit'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'ca100000-0000-4000-8000-000000000001' AND correlation_id = 'ca500000-0000-4000-8000-000000000001'),
  2,
  'profile creation and the bound request receipt share the stable request identifier'
);

SELECT extensions.is(
  (plugin_data.csf_create_profile_for_class_history_import_row(
    'ca100000-0000-4000-8000-000000000001',
    'ca400000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'ca500000-0000-4000-8000-000000000001',
    'Officer verified this is a new class record.'
  ) ->> 'idempotent'),
  'true',
  'an exact request replay returns the durable result'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id = 'ca100000-0000-4000-8000-000000000001'),
  1,
  'an exact replay does not duplicate the profile'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_profile_for_class_history_import_row(
    'ca100000-0000-4000-8000-000000000001',
    'ca400000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'ca500000-0000-4000-8000-000000000001',
    'A different review reason.'
  )$$,
  'P0001',
  'That profile-create request identifier is already bound to a different class-history row or review.',
  'a request identifier cannot be rebound to a different review'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_profile_for_class_history_import_row(
    'ca100000-0000-4000-8000-000000000001',
    'ca400000-0000-4000-8000-000000000002',
    'ca000000-0000-4000-8000-000000000001',
    'ca500000-0000-4000-8000-000000000002',
    'Officer reviewed a second row.'
  )$$,
  'P0001',
  'An active member with this exact name already exists in the class. Match that profile instead.',
  'an officer cannot create a duplicate exact-name profile in the class'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_profile_for_class_history_import_row(
    'ca100000-0000-4000-8000-000000000001',
    'ca400000-0000-4000-8000-000000000003',
    'ca000000-0000-4000-8000-000000000002',
    'ca500000-0000-4000-8000-000000000003',
    'Ordinary member attempt.'
  )$$,
  '42501',
  'This officer does not hold the import_members capability for CSF class_history imports in this organization.',
  'an ordinary member cannot create a profile from an import row'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_profile_for_class_history_import_row(
    'ca100000-0000-4000-8000-000000000001',
    'ca400000-0000-4000-8000-000000000004',
    'ca000000-0000-4000-8000-000000000001',
    'ca500000-0000-4000-8000-000000000004',
    'The workbook key is already valid.'
  )$$,
  'P0001',
  'This class-history row has a valid workbook key and must use the normal import path.',
  'a valid-key row cannot bypass the normal import path'
);

SELECT * FROM extensions.finish();

ROLLBACK;
