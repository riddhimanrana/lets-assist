BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(4);

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
  'f1000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'waiver-owner@local.test',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Waiver Owner"}'::jsonb,
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
VALUES
  (
    'f2000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001',
    'Waiver Project One',
    'Local',
    'Invariant fixture',
    'single',
    'manual',
    '{}'::jsonb,
    true
  ),
  (
    'f2000000-0000-4000-8000-000000000002',
    'f1000000-0000-4000-8000-000000000001',
    'Waiver Project Two',
    'Local',
    'Invariant fixture',
    'single',
    'manual',
    '{}'::jsonb,
    true
  );

INSERT INTO public.anonymous_signups (id, project_id, email, name)
VALUES (
  'f3000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'waiver-signer@local.test',
  'Waiver Signer'
);

INSERT INTO public.project_signups (
  id,
  project_id,
  schedule_id,
  status,
  anonymous_id
)
VALUES (
  'f4000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'waiver-invariant-slot',
  'approved',
  'f3000000-0000-4000-8000-000000000001'
);

INSERT INTO public.waiver_definitions (
  id,
  scope,
  project_id,
  title,
  source,
  created_by
)
VALUES
  (
    'f5000000-0000-4000-8000-000000000001',
    'project',
    'f2000000-0000-4000-8000-000000000001',
    'Project One Waiver',
    'project_pdf',
    'f1000000-0000-4000-8000-000000000001'
  ),
  (
    'f5000000-0000-4000-8000-000000000002',
    'project',
    'f2000000-0000-4000-8000-000000000002',
    'Project Two Waiver',
    'project_pdf',
    'f1000000-0000-4000-8000-000000000001'
  );

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.waiver_signatures (
      id,
      project_id,
      signup_id,
      anonymous_id,
      signer_name,
      signer_email,
      signature_type,
      signature_text,
      waiver_definition_id
    )
    VALUES (
      'f6000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000002',
      'f4000000-0000-4000-8000-000000000001',
      'f3000000-0000-4000-8000-000000000001',
      'Waiver Signer',
      'waiver-signer@local.test',
      'typed',
      'Waiver Signer',
      'f5000000-0000-4000-8000-000000000002'
    )
  $$,
  '23503',
  'insert or update on table "waiver_signatures" violates foreign key constraint "waiver_signatures_signup_project_fkey"',
  'a signature cannot reference a signup from another project'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.waiver_signatures (
      id,
      project_id,
      signup_id,
      anonymous_id,
      signer_name,
      signer_email,
      signature_type,
      signature_text,
      waiver_definition_id
    )
    VALUES (
      'f6000000-0000-4000-8000-000000000002',
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000001',
      'f3000000-0000-4000-8000-000000000001',
      'Waiver Signer',
      'waiver-signer@local.test',
      'typed',
      'Waiver Signer',
      'f5000000-0000-4000-8000-000000000002'
    )
  $$,
  '23503',
  'insert or update on table "waiver_signatures" violates foreign key constraint "waiver_signatures_definition_project_fkey"',
  'a signature cannot reference a definition from another project'
);

INSERT INTO public.waiver_signatures (
  id,
  project_id,
  signup_id,
  anonymous_id,
  signer_name,
  signer_email,
  signature_type,
  signature_text,
  waiver_definition_id
)
VALUES (
  'f6000000-0000-4000-8000-000000000003',
  'f2000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000001',
  'Waiver Signer',
  'waiver-signer@local.test',
  'typed',
  'Waiver Signer',
  'f5000000-0000-4000-8000-000000000001'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.waiver_signatures
    SET signer_email = 'mutated@local.test'
    WHERE id = 'f6000000-0000-4000-8000-000000000003'
  $$,
  '22023',
  'signed waiver evidence is immutable',
  'signed evidence cannot be rewritten'
);

UPDATE public.project_signups
SET user_id = 'f1000000-0000-4000-8000-000000000001',
    anonymous_id = NULL
WHERE id = 'f4000000-0000-4000-8000-000000000001';

UPDATE public.waiver_signatures
SET user_id = 'f1000000-0000-4000-8000-000000000001',
    anonymous_id = NULL
WHERE id = 'f6000000-0000-4000-8000-000000000003';

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.waiver_signatures
    WHERE id = 'f6000000-0000-4000-8000-000000000003'
      AND user_id = 'f1000000-0000-4000-8000-000000000001'
      AND anonymous_id IS NULL
  ),
  'anonymous-to-user waiver transfer remains supported'
);

SELECT * FROM extensions.finish();

ROLLBACK;
