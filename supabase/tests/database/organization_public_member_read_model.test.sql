BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(3);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'f7100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'public-member-view@local.test',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO public.organizations (
  id, name, username, type, join_code, created_by, show_members_publicly
)
VALUES (
  'f7110000-0000-4000-8000-000000000001',
  'Public Member View Organization',
  'public-member-view-organization',
  'school',
  '711001',
  'f7100000-0000-4000-8000-000000000001',
  true
);

INSERT INTO public.organization_members (
  id, organization_id, user_id, role, is_visible, status
)
VALUES (
  'f7120000-0000-4000-8000-000000000001',
  'f7110000-0000-4000-8000-000000000001',
  'f7100000-0000-4000-8000-000000000001',
  'admin',
  true,
  'active'
);

SET LOCAL ROLE anon;

SELECT extensions.lives_ok(
  $$
    SELECT id, role, joined_at, user_id, organization_id
    FROM public.organization_public_member_read_model
    WHERE organization_id = 'f7110000-0000-4000-8000-000000000001'
  $$,
  'anonymous public member reads do not require profiles table access'
);

SELECT extensions.results_eq(
  $$
    SELECT user_id
    FROM public.organization_public_member_read_model
    WHERE organization_id = 'f7110000-0000-4000-8000-000000000001'
  $$,
  $$
    VALUES ('f7100000-0000-4000-8000-000000000001'::uuid)
  $$,
  'the public directory returns a visible active member'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_public_member_read_model'
  ),
  5::bigint,
  'the public member view exposes only membership fields'
);

SELECT * FROM extensions.finish();

ROLLBACK;
