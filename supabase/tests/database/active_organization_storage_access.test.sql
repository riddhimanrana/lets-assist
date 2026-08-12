-- Inactive organization membership must never retain staff Storage or
-- project-management authority. Creator/uploader ownership and service-role
-- server paths remain independent.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(31);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('ae000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'storage-active-staff@local.test', now(), '{}', '{}', now(), now()),
  ('ae000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'storage-inactive-staff@local.test', now(), '{}', '{}', now(), now()),
  ('ae000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'storage-cross-org-staff@local.test', now(), '{}', '{}', now(), now()),
  ('ae000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'storage-project-creator@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ae100000-0000-4000-8000-000000000001', 'Storage Contract One',
   'storage_contract_one', 'nonprofit', '913101'),
  ('ae100000-0000-4000-8000-000000000002', 'Storage Contract Two',
   'storage_contract_two', 'nonprofit', '913102');

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
)
VALUES
  ('ae100000-0000-4000-8000-000000000001',
   'ae000000-0000-4000-8000-000000000001', 'staff', 'active'),
  ('ae100000-0000-4000-8000-000000000001',
   'ae000000-0000-4000-8000-000000000002', 'staff', 'inactive'),
  ('ae100000-0000-4000-8000-000000000002',
   'ae000000-0000-4000-8000-000000000003', 'staff', 'active');

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, organization_id,
  can_be_managed_by_staff
)
VALUES (
  'ae200000-0000-4000-8000-000000000001',
  'ae000000-0000-4000-8000-000000000004',
  'Active membership Storage contract',
  'Local',
  'Synthetic Storage authority fixture',
  'single',
  'manual',
  '{}'::jsonb,
  true,
  'ae100000-0000-4000-8000-000000000001',
  true
);

INSERT INTO public.project_paper_scan_batches (
  id, project_id, schedule_id, created_by, status
)
VALUES (
  'ae300000-0000-4000-8000-000000000001',
  'ae200000-0000-4000-8000-000000000001',
  'contract-slot',
  'ae000000-0000-4000-8000-000000000004',
  'review'
);

INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
VALUES
  (
    'ae400000-0000-4000-8000-000000000001',
    'plugin_form_uploads',
    'ae100000-0000-4000-8000-000000000001/example/ae000000-0000-4000-8000-000000000004/form.pdf',
    'ae000000-0000-4000-8000-000000000004',
    '{"mimetype":"application/pdf"}'::jsonb
  ),
  (
    'ae400000-0000-4000-8000-000000000002',
    'paper-signup-scans',
    'paper_signups/ae200000-0000-4000-8000-000000000001/scan.jpg',
    'ae000000-0000-4000-8000-000000000004',
    '{"mimetype":"image/jpeg"}'::jsonb
  );

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.ok(
  public.is_project_organizer(
    'ae200000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000001'
  ),
  'active organization staff retain project asset authority'
);
SELECT extensions.ok(
  app_private.can_manage_project(
    'ae200000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000001'
  ),
  'active organization staff retain paper-scan authority'
);
SELECT extensions.is(
  (SELECT count(*) FROM storage.objects
   WHERE id = 'ae400000-0000-4000-8000-000000000001'),
  1::bigint,
  'active organization staff can read private plugin-form objects'
);
SELECT extensions.is(
  (SELECT count(*) FROM storage.objects
   WHERE id = 'ae400000-0000-4000-8000-000000000002'),
  1::bigint,
  'active organization staff can read private paper-scan objects'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_paper_scan_batches
   WHERE id = 'ae300000-0000-4000-8000-000000000001'),
  1::bigint,
  'active organization staff can read paper-scan rows'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ae400000-0000-4000-8000-000000000003',
      'organization-logos',
      'ae100000-0000-4000-8000-000000000001.png',
      'ae000000-0000-4000-8000-000000000001',
      '{"mimetype":"image/png"}'::jsonb
    )
  $$,
  'active organization staff can create the organization logo object'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ae400000-0000-4000-8000-000000000006',
      'project-images',
      'project_ae200000-0000-4000-8000-000000000001_active.png',
      'ae000000-0000-4000-8000-000000000001',
      '{"mimetype":"image/png"}'::jsonb
    )
  $$,
  'active organization staff can create project asset objects'
);

SET LOCAL request.jwt.claims =
  '{"sub":"ae000000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT extensions.ok(
  NOT public.is_project_organizer(
    'ae200000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000002'
  ),
  'inactive organization staff lose project asset authority'
);
SELECT extensions.ok(
  NOT app_private.can_manage_project(
    'ae200000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000002'
  ),
  'inactive organization staff lose paper-scan authority'
);
SELECT extensions.is(
  (SELECT count(*) FROM storage.objects
   WHERE id IN (
     'ae400000-0000-4000-8000-000000000001',
     'ae400000-0000-4000-8000-000000000002'
   )),
  0::bigint,
  'inactive organization staff cannot read private plugin-form or paper-scan objects'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_paper_scan_batches
   WHERE id = 'ae300000-0000-4000-8000-000000000001'),
  0::bigint,
  'inactive organization staff cannot read paper-scan rows'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ae400000-0000-4000-8000-000000000004',
      'organization-logos',
      'ae100000-0000-4000-8000-000000000001.webp',
      'ae000000-0000-4000-8000-000000000002',
      '{"mimetype":"image/webp"}'::jsonb
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'inactive organization staff cannot create organization logo objects'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ae400000-0000-4000-8000-000000000007',
      'project-images',
      'project_ae200000-0000-4000-8000-000000000001_inactive.png',
      'ae000000-0000-4000-8000-000000000002',
      '{"mimetype":"image/png"}'::jsonb
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'inactive organization staff cannot create project asset objects'
);

SET LOCAL request.jwt.claims =
  '{"sub":"ae000000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT extensions.ok(
  NOT public.is_project_organizer(
    'ae200000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000003'
  ),
  'cross-organization staff have no project asset authority'
);
SELECT extensions.ok(
  NOT app_private.can_manage_project(
    'ae200000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000003'
  ),
  'cross-organization staff have no paper-scan authority'
);
SELECT extensions.is(
  (SELECT count(*) FROM storage.objects
   WHERE id IN (
     'ae400000-0000-4000-8000-000000000001',
     'ae400000-0000-4000-8000-000000000002'
   )),
  0::bigint,
  'cross-organization staff cannot read another organization private Storage'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_paper_scan_batches
   WHERE id = 'ae300000-0000-4000-8000-000000000001'),
  0::bigint,
  'cross-organization staff cannot read another organization paper-scan rows'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ae400000-0000-4000-8000-000000000005',
      'organization-logos',
      'ae100000-0000-4000-8000-000000000001.jpg',
      'ae000000-0000-4000-8000-000000000003',
      '{"mimetype":"image/jpeg"}'::jsonb
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'cross-organization staff cannot create another organization logo object'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ae400000-0000-4000-8000-000000000008',
      'project-images',
      'project_ae200000-0000-4000-8000-000000000001_cross.png',
      'ae000000-0000-4000-8000-000000000003',
      '{"mimetype":"image/png"}'::jsonb
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'cross-organization staff cannot create another organization project asset'
);

SET LOCAL request.jwt.claims =
  '{"sub":"ae000000-0000-4000-8000-000000000004","role":"authenticated"}';

SELECT extensions.ok(
  public.is_project_organizer(
    'ae200000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000004'
  ),
  'the project creator retains project asset authority without membership'
);
SELECT extensions.ok(
  app_private.can_manage_project(
    'ae200000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000004'
  ),
  'the project creator retains paper-scan authority without membership'
);
SELECT extensions.is(
  (SELECT count(*) FROM storage.objects
   WHERE id = 'ae400000-0000-4000-8000-000000000001'),
  1::bigint,
  'the plugin-form uploader retains own-object read access without membership'
);
SELECT extensions.is(
  (SELECT count(*) FROM storage.objects
   WHERE id = 'ae400000-0000-4000-8000-000000000002'),
  1::bigint,
  'the project creator retains paper-scan Storage read access'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_paper_scan_batches
   WHERE id = 'ae300000-0000-4000-8000-000000000001'),
  1::bigint,
  'the project creator retains paper-scan row read access'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ae400000-0000-4000-8000-000000000009',
      'project-images',
      'project_ae200000-0000-4000-8000-000000000001_creator.png',
      'ae000000-0000-4000-8000-000000000004',
      '{"mimetype":"image/png"}'::jsonb
    )
  $$,
  'the project creator retains project asset mutation access'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT role.rolbypassrls
    FROM pg_roles AS role
    WHERE role.rolname = 'service_role'
  )
  AND has_function_privilege(
    'service_role', 'app_private.is_project_organizer(uuid,uuid)', 'EXECUTE'
  )
  AND has_function_privilege(
    'service_role', 'app_private.can_manage_project(uuid,uuid)', 'EXECUTE'
  ),
  'service_role retains RLS bypass and project helper execution'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated', 'public.account_data_export_audit_logs', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.account_data_export_audit_logs', 'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.account_data_export_audit_logs', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.account_data_export_audit_logs', 'DELETE'
  ),
  'authenticated has no direct audit-log DML capability'
);
SELECT extensions.ok(
  has_table_privilege(
    'authenticated', 'public.account_data_export_jobs', 'SELECT'
  )
  AND has_table_privilege(
    'authenticated', 'public.account_data_export_jobs', 'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.account_data_export_jobs', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.account_data_export_jobs', 'DELETE'
  ),
  'authenticated retains only browser-used export-job grants'
);
SELECT extensions.ok(
  has_table_privilege(
    'service_role', 'public.account_data_export_audit_logs', 'SELECT'
  )
  AND has_table_privilege(
    'service_role', 'public.account_data_export_audit_logs', 'INSERT'
  )
  AND has_table_privilege(
    'service_role', 'public.account_data_export_audit_logs', 'UPDATE'
  )
  AND has_table_privilege(
    'service_role', 'public.account_data_export_audit_logs', 'DELETE'
  ),
  'service_role retains server-side audit-log DML capability'
);
SELECT extensions.is(
  (
    SELECT count(*)
    FROM app_private.client_relation_grant_catalog()
    WHERE relation_name = 'account_data_export_audit_logs'
      AND role_name = 'authenticated'
  ),
  0::bigint,
  'the effective ACL catalog exposes no authenticated audit-log grants'
);
SELECT extensions.results_eq(
  $$
    SELECT privilege
    FROM app_private.client_relation_grant_catalog()
    WHERE relation_name = 'account_data_export_jobs'
      AND role_name = 'authenticated'
    ORDER BY privilege
  $$,
  $$ VALUES ('INSERT'::text), ('SELECT'::text) $$,
  'the effective ACL catalog retains exact browser export-job capabilities'
);

SELECT * FROM extensions.finish();

ROLLBACK;
