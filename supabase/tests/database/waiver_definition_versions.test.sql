BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(16);

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
  'e1000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'waiver-version-owner@local.test',
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
  require_login,
  waiver_pdf_storage_path,
  waiver_pdf_url
)
VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Versioned Waiver Project',
  'Local',
  'Version-on-write fixture',
  'single',
  'manual',
  '{}'::jsonb,
  true,
  'project_waivers/e2000000-0000-4000-8000-000000000001/source.pdf',
  'https://project.supabase.co/storage/v1/object/public/waiver-uploads/project_waivers/e2000000-0000-4000-8000-000000000001/source.pdf'
);

CREATE TEMP TABLE first_definition AS
SELECT public.save_project_waiver_definition_version(
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Original Waiver',
  '[{"role_key":"participant","label":"Participant","required":true,"order_index":0}]'::jsonb,
  '[{"field_key":"signature","field_type":"signature","page_index":0,"rect":{"x":10,"y":10,"width":100,"height":30},"signer_role_key":"participant"}]'::jsonb
) AS id;

SELECT extensions.ok(
  (SELECT id IS NOT NULL FROM first_definition),
  'first save creates a definition'
);

SELECT extensions.is(
  (
    SELECT pdf_storage_path
    FROM public.waiver_definitions
    WHERE id = (SELECT id FROM first_definition)
  ),
  'project_waivers/e2000000-0000-4000-8000-000000000001/source.pdf',
  'definition snapshots the project source object path'
);

SELECT extensions.is(
  (
    SELECT waiver_definition_id
    FROM public.projects
    WHERE id = 'e2000000-0000-4000-8000-000000000001'
  ),
  (SELECT id FROM first_definition),
  'first save atomically points the project at the new definition'
);

INSERT INTO public.project_signups (
  id,
  project_id,
  schedule_id,
  status,
  user_id
)
VALUES (
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'versioned-waiver-slot',
  'approved',
  'e1000000-0000-4000-8000-000000000001'
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
  'e4000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Waiver Signer',
  'waiver-version-owner@local.test',
  'typed',
  'Waiver Signer',
  (SELECT id FROM first_definition),
  'project_waivers/e2000000-0000-4000-8000-000000000001/source.pdf'
);

CREATE TEMP TABLE second_definition AS
SELECT public.save_project_waiver_definition_version(
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Revised Waiver',
  '[{"role_key":"participant","label":"Volunteer","required":true,"order_index":0}]'::jsonb,
  '[{"field_key":"signature","field_type":"signature","page_index":1,"rect":{"x":20,"y":20,"width":120,"height":40},"signer_role_key":"participant"}]'::jsonb
) AS id;

SELECT extensions.ok(
  (SELECT id FROM first_definition) <> (SELECT id FROM second_definition),
  'subsequent save creates a distinct definition row'
);

SELECT extensions.is(
  (
    SELECT version
    FROM public.waiver_definitions
    WHERE id = (SELECT id FROM second_definition)
  ),
  2,
  'subsequent save increments the project definition version'
);

SELECT extensions.is(
  (
    SELECT title
    FROM public.waiver_definitions
    WHERE id = (SELECT id FROM first_definition)
  ),
  'Original Waiver',
  'versioning preserves the referenced definition content'
);

SELECT extensions.is(
  (
    SELECT waiver_definition_id
    FROM public.projects
    WHERE id = 'e2000000-0000-4000-8000-000000000001'
  ),
  (SELECT id FROM second_definition),
  'versioning atomically repoints the project'
);

SELECT extensions.throws_ok(
  format(
    'UPDATE public.waiver_definitions SET title = %L WHERE id = %L',
    'Mutated historical waiver',
    (SELECT id FROM first_definition)
  ),
  '22023',
  'referenced waiver definitions are immutable',
  'referenced definition rendering inputs cannot be updated'
);

SELECT extensions.throws_ok(
  format(
    'DELETE FROM public.waiver_definitions WHERE id = %L',
    (SELECT id FROM first_definition)
  ),
  '22023',
  'referenced waiver definitions are immutable',
  'referenced definitions cannot be deleted'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.waiver_signatures
    SET waiver_pdf_storage_path = 'project_waivers/changed.pdf'
    WHERE id = 'e4000000-0000-4000-8000-000000000001'
  $$,
  '22023',
  'signed waiver evidence is immutable',
  'signature source path snapshots are immutable'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.save_project_waiver_definition_version(uuid,uuid,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'anon cannot version waiver definitions'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.save_project_waiver_definition_version(uuid,uuid,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'authenticated clients cannot version waiver definitions directly'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.save_project_waiver_definition_version(uuid,uuid,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'service role can execute the versioning transition'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.save_project_waiver_definition_version(
      'e2000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'Oversized Waiver',
      (
        SELECT jsonb_agg(jsonb_build_object(
          'role_key', 'signer_' || index,
          'label', 'Signer ' || index,
          'order_index', index - 1
        ))
        FROM generate_series(1, 17) AS index
      ),
      '[]'::jsonb
    )
  $$,
  '22023',
  'invalid waiver definition payload',
  'database transition rejects excessive signer counts'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.save_project_waiver_definition_version(
      'e2000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'Malformed Waiver',
      '[{"role_key":"participant","label":"Participant","order_index":0}]'::jsonb,
      '[{"field_key":"signature","field_type":"signature","page_index":0,"rect":{"x":0,"y":0,"width":-1,"height":20},"signer_role_key":"participant"}]'::jsonb
    )
  $$,
  '22023',
  'invalid waiver definition payload',
  'database transition rejects malformed field geometry'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_definitions
    WHERE project_id = 'e2000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'exactly one immutable definition row is created per save'
);

SELECT * FROM extensions.finish();

ROLLBACK;
