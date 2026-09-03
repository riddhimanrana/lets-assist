BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(11);

SELECT extensions.has_function(
  'public',
  'set_csf_staff_view_mode',
  ARRAY['uuid', 'text'],
  'the caller-scoped staff view preference function exists'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.set_csf_staff_view_mode(uuid,text)',
    'EXECUTE'
  ),
  'authenticated callers may execute the reviewed function'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.set_csf_staff_view_mode(uuid,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot execute the function'
);

SELECT extensions.is(
  (
    SELECT prosecdef
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.set_csf_staff_view_mode(uuid,text)'::regprocedure
  ),
  true,
  'the function owns the protected preference write'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'fd000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'view-officer@local.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    'fd000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'view-member@local.test', now(),
    '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'fd100000-0000-4000-8000-000000000001',
  'View Mode RPC Test',
  'view-mode-rpc-test',
  'school',
  '983401'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  (
    'fd100000-0000-4000-8000-000000000001',
    'fd000000-0000-4000-8000-000000000001',
    'staff',
    'active'
  ),
  (
    'fd100000-0000-4000-8000-000000000001',
    'fd000000-0000-4000-8000-000000000002',
    'member',
    'active'
  );

SELECT set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT extensions.lives_ok(
  $$SELECT public.set_csf_staff_view_mode(
    'fd100000-0000-4000-8000-000000000001',
    'officer'
  )$$,
  'active staff may store officer view'
);

RESET ROLE;
SELECT extensions.is(
  (
    SELECT view_mode
    FROM plugin_data.csf_staff_view_preferences
    WHERE organization_id = 'fd100000-0000-4000-8000-000000000001'
      AND user_id = 'fd000000-0000-4000-8000-000000000001'
  ),
  'officer',
  'the preference is stored for auth.uid()'
);

SET LOCAL ROLE authenticated;
SELECT extensions.lives_ok(
  $$SELECT public.set_csf_staff_view_mode(
    'fd100000-0000-4000-8000-000000000001',
    'member'
  )$$,
  'active staff may switch back to member view'
);
RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_staff_view_preferences
    WHERE organization_id = 'fd100000-0000-4000-8000-000000000001'
      AND user_id = 'fd000000-0000-4000-8000-000000000001'
  ),
  1,
  'switching updates the one preference row'
);

SELECT extensions.is(
  (
    SELECT view_mode
    FROM plugin_data.csf_staff_view_preferences
    WHERE organization_id = 'fd100000-0000-4000-8000-000000000001'
      AND user_id = 'fd000000-0000-4000-8000-000000000001'
  ),
  'member',
  'the second choice replaces the first'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'fd000000-0000-4000-8000-000000000002',
  true
);
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$SELECT public.set_csf_staff_view_mode(
    'fd100000-0000-4000-8000-000000000001',
    'officer'
  )$$,
  '42501',
  'Active organization staff access is required.',
  'an active member cannot store a staff view preference'
);

SELECT extensions.throws_ok(
  $$SELECT public.set_csf_staff_view_mode(
    'fd100000-0000-4000-8000-000000000001',
    'unknown'
  )$$,
  '22023',
  'Unknown view mode.',
  'the function rejects an unknown presentation mode'
);

RESET ROLE;
SELECT extensions.finish();
ROLLBACK;
