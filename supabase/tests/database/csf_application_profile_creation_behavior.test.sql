BEGIN;
SELECT plan(14);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('cb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'application-reviewer@local.test', now(), '{}', '{}', now(), now()),
  ('cb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'application-member@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('cb100000-0000-4000-8000-000000000001', 'Application Creation Fixture', 'application-creation-fixture', 'school', '827461');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('cb100000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('cb100000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000002', 'member', 'active');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES ('cb200000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000001', 2042, 'Class of 2042');
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, mode, status, source_type, source_sheet_tab, mapping_version
) VALUES (
  'cb300000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000001',
  'preview', 'needs_resolution', 'application_responses', 'Responses', 1
);
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, cohort_id, sheet_tab_name, row_number,
  import_status, resolution_status, normalized_data
) VALUES (
  'cb400000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000001',
  'cb300000-0000-4000-8000-000000000001', 'cb200000-0000-4000-8000-000000000001',
  'Responses', 2, 'ambiguous', 'pending',
  '{"record":{"identity":{"firstName":"Avery","lastName":"Fictional"},"contact":{"responseEmail":"unverified@local.test"}}}'::jsonb
);
CREATE TEMP TABLE original_application_snapshot AS
  SELECT id, normalized_data, raw_data, row_hash
  FROM plugin_data.csf_sheet_import_rows
  WHERE id = 'cb400000-0000-4000-8000-000000000001';

SELECT lives_ok($$SELECT plugin_data.csf_create_profile_for_application_import_row(
  'cb100000-0000-4000-8000-000000000001', 'cb400000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000001', 'cb500000-0000-4000-8000-000000000001',
  'Reviewed a new unclaimed applicant.'
)$$, 'officer creation succeeds with the immutable evidence trigger enabled');

SELECT is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id = 'cb100000-0000-4000-8000-000000000001'), 1, 'one profile is created');
SELECT results_eq(
  $$SELECT import_status, resolution_status, matched_profile_id IS NOT NULL
    FROM plugin_data.csf_sheet_import_rows WHERE id = 'cb400000-0000-4000-8000-000000000001'$$,
  $$VALUES ('pending'::text, 'resolved'::text, true)$$,
  'the application row and profile settle in one transaction'
);
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id = 'cb100000-0000-4000-8000-000000000001' AND (school_email IS NOT NULL OR personal_email IS NOT NULL)), 0, 'form addresses are not promoted to canonical identity');
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_term_memberships WHERE organization_id = 'cb100000-0000-4000-8000-000000000001'), 0, 'profile creation does not approve semester membership');
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows r JOIN original_application_snapshot s USING(id) WHERE ROW(r.normalized_data, r.raw_data, r.row_hash) IS DISTINCT FROM ROW(s.normalized_data, s.raw_data, s.row_hash)), 0, 'raw and normalized source evidence remains unchanged');
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'cb100000-0000-4000-8000-000000000001' AND action = 'sheets.row_match_resolved' AND after_data #>> '{matchMetadata,matchMethod}' = 'officer_created_unclaimed_profile'), 1, 'the audit retains reviewed creation provenance');

SELECT lives_ok($$SELECT plugin_data.csf_create_profile_for_application_import_row(
  'cb100000-0000-4000-8000-000000000001', 'cb400000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000001', 'cb500000-0000-4000-8000-000000000001',
  'Reviewed a new unclaimed applicant.'
)$$, 'the same request can replay after a lost response');
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id = 'cb100000-0000-4000-8000-000000000001'), 1, 'replay creates no duplicate profile');
SELECT throws_ok($$SELECT plugin_data.csf_create_profile_for_application_import_row(
  'cb100000-0000-4000-8000-000000000001', 'cb400000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000001', 'cb500000-0000-4000-8000-000000000001',
  'A different review reason.'
)$$, NULL, NULL, 'a changed review cannot reuse the request identifier');
SELECT throws_ok($$SELECT plugin_data.csf_create_profile_for_application_import_row(
  'cb100000-0000-4000-8000-000000000001', 'cb400000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000002', 'cb500000-0000-4000-8000-000000000002',
  'A member cannot review this row.'
)$$, NULL, NULL, 'ordinary members cannot create a profile through import review');
SELECT throws_ok($$UPDATE plugin_data.csf_sheet_import_rows
  SET normalized_data = normalized_data || '{"rewritten":true}'::jsonb
  WHERE id = 'cb400000-0000-4000-8000-000000000001'$$,
  'P0001', 'CSF import row evidence is immutable; create a retry row instead.',
  'source evidence remains immutable after profile creation');

SELECT is((SELECT resolution_metadata->>'matchMethod'
  FROM plugin_data.csf_sheet_import_rows
  WHERE id = 'cb400000-0000-4000-8000-000000000001'),
  'officer_created_unclaimed_profile', 'review metadata is stored outside the source snapshot');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('service_role')) roles(role_name)
  CROSS JOIN (VALUES
    ('plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid,jsonb)'),
    ('plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)')
  ) functions(signature)
  WHERE has_function_privilege(roles.role_name, functions.signature, 'EXECUTE')
), 'replaced internal functions remain inaccessible outside authorized wrappers');

SELECT * FROM finish();
ROLLBACK;
