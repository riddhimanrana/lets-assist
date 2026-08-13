BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(21);

SELECT extensions.has_column(
  'public',
  'organizations',
  'staff_join_token_issued_by',
  'staff invite tokens record their issuing administrator'
);

SELECT extensions.col_is_null(
  'public',
  'organizations',
  'staff_join_token_issued_by',
  'legacy staff invite tokens remain representable and fail closed'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.redeem_staff_join_token(uuid,uuid,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'service_role can execute atomic staff invite redemption'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.redeem_staff_join_token(uuid,uuid,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'anon cannot execute staff invite redemption'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.redeem_staff_join_token(uuid,uuid,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'authenticated cannot execute staff invite redemption'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'public',
    'public.redeem_staff_join_token(uuid,uuid,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'PUBLIC cannot execute staff invite redemption'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  id,
  'authenticated',
  'authenticated',
  email,
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
FROM (
  VALUES
    ('fa000000-0000-4000-8000-000000000001'::uuid, 'issuer-a@local.test'),
    ('fa000000-0000-4000-8000-000000000002'::uuid, 'issuer-b@local.test'),
    ('fa000000-0000-4000-8000-000000000011'::uuid, 'target-new@local.test'),
    ('fa000000-0000-4000-8000-000000000012'::uuid, 'target-member@local.test'),
    ('fa000000-0000-4000-8000-000000000013'::uuid, 'target-inactive@local.test'),
    ('fa000000-0000-4000-8000-000000000014'::uuid, 'target-denied@local.test'),
    ('fa000000-0000-4000-8000-000000000015'::uuid, 'target-mismatch@local.test')
) AS fixture(id, email);

INSERT INTO public.organizations (
  id, name, username, type, join_code, created_by,
  staff_join_token, staff_join_token_created_at,
  staff_join_token_expires_at, staff_join_token_issued_by
)
VALUES
  (
    'fa100000-0000-4000-8000-000000000001',
    'Staff Invite One',
    'staff-invite-one',
    'school',
    '910001',
    'fa000000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    '2026-08-12T00:00:00Z',
    '2026-09-12T00:00:00Z',
    'fa000000-0000-4000-8000-000000000001'
  ),
  (
    'fa100000-0000-4000-8000-000000000002',
    'Staff Invite Two',
    'staff-invite-two',
    'school',
    '910002',
    'fa000000-0000-4000-8000-000000000002',
    'fa200000-0000-4000-8000-000000000002',
    '2026-08-12T00:00:00Z',
    '2026-09-12T00:00:00Z',
    'fa000000-0000-4000-8000-000000000001'
  );

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
)
VALUES
  (
    'fa100000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000001',
    'admin',
    'active'
  ),
  (
    'fa100000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000002',
    'admin',
    'active'
  ),
  (
    'fa100000-0000-4000-8000-000000000002',
    'fa000000-0000-4000-8000-000000000002',
    'admin',
    'active'
  ),
  (
    'fa100000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000012',
    'member',
    'active'
  ),
  (
    'fa100000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000013',
    'member',
    'inactive'
  );

SET LOCAL ROLE service_role;

SELECT extensions.is(
  (
    SELECT status
    FROM public.redeem_staff_join_token(
      'fa000000-0000-4000-8000-000000000011',
      'fa200000-0000-4000-8000-000000000001',
      'staff-invite-one',
      '2026-08-12T12:00:00Z'
    )
  ),
  'success',
  'an active exact issuer can redeem a current token'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND user_id = 'fa000000-0000-4000-8000-000000000011'
      AND role = 'staff'
      AND status = 'active'
  ),
  'active issuer redemption creates active staff membership'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.redeem_staff_join_token(
      'fa000000-0000-4000-8000-000000000011',
      'fa200000-0000-4000-8000-000000000001',
      'staff-invite-one',
      '2026-08-12T12:01:00Z'
    )
  ),
  'success',
  'replaying redemption for existing active staff succeeds'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.organization_members
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND user_id = 'fa000000-0000-4000-8000-000000000011'
  ),
  1,
  'replay never duplicates membership'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.redeem_staff_join_token(
      'fa000000-0000-4000-8000-000000000012',
      'fa200000-0000-4000-8000-000000000001',
      'staff-invite-one',
      '2026-08-12T12:02:00Z'
    )
  ),
  'success',
  'an active member can redeem the staff token'
);

SELECT extensions.is(
  (
    SELECT role::text
    FROM public.organization_members
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND user_id = 'fa000000-0000-4000-8000-000000000012'
  ),
  'staff',
  'active member redemption upgrades only the role'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.redeem_staff_join_token(
      'fa000000-0000-4000-8000-000000000013',
      'fa200000-0000-4000-8000-000000000001',
      'staff-invite-one',
      '2026-08-12T12:03:00Z'
    )
  ),
  'error',
  'inactive existing membership is denied'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND user_id = 'fa000000-0000-4000-8000-000000000013'
      AND role = 'member'
      AND status = 'inactive'
  ),
  'inactive target remains inactive and is not upgraded'
);

RESET ROLE;
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND user_id = 'fa000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;

SELECT extensions.is(
  (
    SELECT status
    FROM public.redeem_staff_join_token(
      'fa000000-0000-4000-8000-000000000014',
      'fa200000-0000-4000-8000-000000000001',
      'staff-invite-one',
      '2026-08-12T12:04:00Z'
    )
  ),
  'error',
  'inactive exact issuer is denied even when another admin remains active'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND user_id = 'fa000000-0000-4000-8000-000000000014'
  ),
  'inactive issuer denial creates no target membership'
);

RESET ROLE;
UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND user_id = 'fa000000-0000-4000-8000-000000000001';
UPDATE public.organizations
SET staff_join_token_issued_by = NULL
WHERE id = 'fa100000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;

SELECT extensions.is(
  (
    SELECT status
    FROM public.redeem_staff_join_token(
      'fa000000-0000-4000-8000-000000000014',
      'fa200000-0000-4000-8000-000000000001',
      'staff-invite-one',
      '2026-08-12T12:05:00Z'
    )
  ),
  'invalid_token',
  'legacy token without issuer fails closed'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.redeem_staff_join_token(
      'fa000000-0000-4000-8000-000000000014',
      'fa200000-0000-4000-8000-000000000002',
      'staff-invite-two',
      '2026-08-12T12:06:00Z'
    )
  ),
  'error',
  'issuer membership from another tenant cannot authorize redemption'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000002'
      AND user_id = 'fa000000-0000-4000-8000-000000000014'
  ),
  'tenant-mismatched issuer creates no target membership'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.redeem_staff_join_token(
      'fa000000-0000-4000-8000-000000000015',
      'fa200000-0000-4000-8000-000000000099',
      'staff-invite-two',
      '2026-08-12T12:07:00Z'
    )
  ),
  'invalid_token',
  'token mismatch is denied'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000002'
      AND user_id = 'fa000000-0000-4000-8000-000000000015'
  ),
  'token mismatch creates no membership'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
