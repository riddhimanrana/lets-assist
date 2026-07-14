BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(27);

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), table_privileges(privilege_name) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    role_name,
    'public.organization_autojoin_suppressions',
    privilege_name
  ),
  format('%s cannot %s organization auto-join suppressions', role_name, privilege_name)
)
FROM client_roles
CROSS JOIN table_privileges;

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.remove_organization_member_with_autojoin_suppression(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anon cannot call the service-only member-removal RPC'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.remove_organization_member_with_autojoin_suppression(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot bypass the authorized member-removal action'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.remove_organization_member_with_autojoin_suppression(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role can perform atomic member removal and suppression'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.apply_verified_domain_affiliation(uuid,text)',
    'EXECUTE'
  ),
  'anon cannot apply verified-domain affiliation'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.apply_verified_domain_affiliation(uuid,text)',
    'EXECUTE'
  ),
  'authenticated cannot bypass the server-side affiliation boundary'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.apply_verified_domain_affiliation(uuid,text)',
    'EXECUTE'
  ),
  'service_role can atomically apply verified-domain affiliation'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'fb000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'autojoin-admin@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'fb000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'autojoin-member@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'fb000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'autojoin-member-two@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'fb000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'autojoin-member-three@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.organizations (
  id, name, username, type, join_code, created_by, auto_join_domain, verified
)
VALUES (
  'fb100000-0000-4000-8000-000000000001',
  'Autojoin Test Organization',
  'autojoin-test-organization',
  'school',
  '720001',
  'fb000000-0000-4000-8000-000000000001',
  'local.test',
  true
);

INSERT INTO public.organization_members (
  id, organization_id, user_id, role
)
VALUES
  (
    'fb200000-0000-4000-8000-000000000001',
    'fb100000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000001',
    'admin'
  ),
  (
    'fb200000-0000-4000-8000-000000000002',
    'fb100000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000002',
    'member'
  ),
  (
    'fb200000-0000-4000-8000-000000000003',
    'fb100000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000003',
    'member'
  );

SET LOCAL request.jwt.claims =
  '{"sub":"fb000000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.organization_members
    WHERE id = 'fb200000-0000-4000-8000-000000000002'
  $$,
  '42501',
  'permission denied for table organization_members',
  'authenticated users cannot bypass suppression through a direct member delete'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.organization_members
    WHERE id = 'fb200000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'the rejected direct delete leaves membership intact'
);

SELECT extensions.ok(
  public.remove_organization_member_with_autojoin_suppression(
    'fb100000-0000-4000-8000-000000000001',
    'fb200000-0000-4000-8000-000000000003',
    'fb000000-0000-4000-8000-000000000001'
  ),
  'the service RPC removes another member atomically'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.organization_members
    WHERE id = 'fb200000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'the service RPC deletes the requested membership'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.organization_autojoin_suppressions
    WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND user_id = 'fb000000-0000-4000-8000-000000000003'
      AND removed_by = 'fb000000-0000-4000-8000-000000000001'
  ),
  'the service RPC preserves the acting user in its suppression tombstone'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.apply_verified_domain_affiliation(
      'fb000000-0000-4000-8000-000000000003',
      'local.test'
    )
  ),
  'suppressed'::text,
  'a login cannot race around an explicit membership removal'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.organization_members
    WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND user_id = 'fb000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'suppressed affiliation leaves the removed membership absent'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.apply_verified_domain_affiliation(
      'fb000000-0000-4000-8000-000000000004',
      'LOCAL.TEST'
    )
  ),
  'joined'::text,
  'a verified unsuppressed domain joins atomically'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.organization_members
    WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND user_id = 'fb000000-0000-4000-8000-000000000004'
      AND role = 'member'
  ),
  1::bigint,
  'atomic affiliation creates exactly one member row'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.remove_organization_member_with_autojoin_suppression(
      'fb100000-0000-4000-8000-000000000001',
      'fb200000-0000-4000-8000-000000000001',
      'fb000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'not authorized to remove this organization member',
  'a regular member cannot remove an administrator'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.remove_organization_member_with_autojoin_suppression(
      'fb100000-0000-4000-8000-000000000001',
      'fb200000-0000-4000-8000-000000000001',
      'fb000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'cannot remove the final organization admin',
  'the transaction-level invariant prevents removing the final admin'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.organization_members
    WHERE id = 'fb200000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a failed final-admin removal rolls back without changing membership'
);

SELECT extensions.ok(
  position(
    'INSERT INTO public.organization_members'
    IN pg_get_functiondef('public.handle_auto_join_on_signup()'::regprocedure)
  ) = 0,
  'the legacy pre-verification auto-join trigger helper is a no-op'
);

SELECT * FROM extensions.finish();

ROLLBACK;
