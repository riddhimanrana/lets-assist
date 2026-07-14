BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(12);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES (
  'd1000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'waiver-storage-owner@local.test',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO public.projects (
  id,
  creator_id,
  title,
  location,
  description,
  event_type,
  verification_method,
  schedule,
  require_login
)
VALUES (
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Source Retention Project',
  'Local',
  'Source retention fixture',
  'single',
  'manual',
  '{}'::jsonb,
  true
);

INSERT INTO public.waiver_definitions (
  id,
  scope,
  project_id,
  title,
  source,
  created_by,
  pdf_storage_path
)
VALUES (
  'd3000000-0000-4000-8000-000000000001',
  'project',
  'd2000000-0000-4000-8000-000000000001',
  'Retained Definition',
  'project_pdf',
  'd1000000-0000-4000-8000-000000000001',
  'project_waivers/d2000000-0000-4000-8000-000000000001/definition.pdf'
);

INSERT INTO public.project_signups (
  id,
  project_id,
  schedule_id,
  status,
  user_id
)
VALUES (
  'd4000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'source-retention-slot',
  'approved',
  'd1000000-0000-4000-8000-000000000001'
);

INSERT INTO public.waiver_signatures (
  id,
  project_id,
  signup_id,
  user_id,
  signer_name,
  signer_email,
  signature_type,
  signature_text,
  waiver_definition_id,
  waiver_pdf_storage_path
)
VALUES (
  'd5000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Storage Signer',
  'waiver-storage-owner@local.test',
  'typed',
  'Storage Signer',
  'd3000000-0000-4000-8000-000000000001',
  'project_waivers/d2000000-0000-4000-8000-000000000001/signature.pdf'
);

SELECT extensions.ok(
  private.waiver_source_storage_object_is_referenced(
    'project_waivers/d2000000-0000-4000-8000-000000000001/definition.pdf'
  ),
  'definition source objects are retained'
);

SELECT extensions.ok(
  private.waiver_source_storage_object_is_referenced(
    'project_waivers/d2000000-0000-4000-8000-000000000001/signature.pdf'
  ),
  'signature source snapshots are retained'
);

SELECT extensions.ok(
  NOT private.waiver_source_storage_object_is_referenced(
    'project_waivers/d2000000-0000-4000-8000-000000000001/unreferenced.pdf'
  ),
  'unreferenced source objects remain removable'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Project managers can delete project waiver files'
      AND qual LIKE '%waiver_source_storage_object_is_referenced%'
  ),
  'Storage DELETE policy checks historical waiver references'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'private.waiver_source_storage_object_is_referenced(text)',
    'EXECUTE'
  ),
  'anon cannot call the Storage retention helper'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'private.waiver_source_storage_object_is_referenced(text)',
    'EXECUTE'
  ),
  'authenticated role can evaluate the Storage deletion policy'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'private.waiver_source_storage_object_is_referenced(text)',
    'EXECUTE'
  ),
  'service role can evaluate the Storage retention helper'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.projects'::regclass
      AND conname = 'projects_waiver_pdf_storage_path_project_scope_check'
      AND convalidated
  ),
  'project source paths are constrained to their project namespace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.waiver_definitions'::regclass
      AND conname = 'waiver_definitions_pdf_storage_path_project_scope_check'
      AND convalidated
  ),
  'definition source paths are constrained to their project namespace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.waiver_signatures'::regclass
      AND conname = 'waiver_signatures_pdf_storage_path_project_scope_check'
      AND convalidated
  ),
  'signature source paths are constrained to their project namespace'
);

INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
VALUES
  (
    'd6000000-0000-4000-8000-000000000001',
    'waiver-uploads',
    'project_waivers/d2000000-0000-4000-8000-000000000001/definition.pdf',
    'd1000000-0000-4000-8000-000000000001',
    '{"mimetype":"application/pdf"}'::jsonb
  ),
  (
    'd6000000-0000-4000-8000-000000000002',
    'waiver-uploads',
    'project_waivers/d2000000-0000-4000-8000-000000000001/unreferenced.pdf',
    'd1000000-0000-4000-8000-000000000001',
    '{"mimetype":"application/pdf"}'::jsonb
  );

SET LOCAL request.jwt.claims =
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL storage.allow_delete_query = 'true';
SET LOCAL ROLE authenticated;

DELETE FROM storage.objects;

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)
    FROM storage.objects
    WHERE id = 'd6000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'authenticated manager cannot delete a referenced source object'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM storage.objects
    WHERE id = 'd6000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'authenticated manager can delete an unreferenced source object'
);

SELECT * FROM extensions.finish();

ROLLBACK;
