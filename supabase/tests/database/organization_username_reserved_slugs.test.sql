BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(14);

-- The Server Action boundary is not the only way to write
-- `organizations.username`: RLS lets a trusted member INSERT an
-- organization directly and an org admin UPDATE one directly, both through
-- the ordinary Data API. This suite proves the database itself, not just
-- the application layer, refuses every reserved-slug spelling.

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organizations'::regclass
      AND conname = 'organizations_username_not_reserved_check'
      AND contype = 'c'
      AND convalidated
  ),
  'organization usernames have a validated reserved-slug constraint'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'fe000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'org-reserved-admin@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now()
  ),
  (
    'fe000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'org-reserved-creator@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now()
  );

-- `profiles.trusted_member` is server-managed (AUD-001); grant trust through
-- the real application + service-role approval path instead of writing the
-- flag directly. The applicant insert requires an authenticated actor (the
-- identity trigger reads `auth.uid()`); the approval requires service_role.
-- User 001 owns the fixture organization used for the UPDATE tests below.
-- User 002 has no organizations of its own and is used for the direct
-- INSERT tests, so the create-organization cooldown (one per 14 days) never
-- interferes with proving the reserved-slug constraint.
SET LOCAL request.jwt.claims =
  '{"sub":"fe000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

INSERT INTO public.trusted_member (user_id, status, name, email, reason)
VALUES (
  'fe000000-0000-4000-8000-000000000001',
  NULL,
  'Org Reserved Admin',
  'org-reserved-admin@local.test',
  'Fixture for reserved-slug write-path coverage'
);

RESET ROLE;
SET LOCAL request.jwt.claims =
  '{"sub":"fe000000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

INSERT INTO public.trusted_member (user_id, status, name, email, reason)
VALUES (
  'fe000000-0000-4000-8000-000000000002',
  NULL,
  'Org Reserved Creator',
  'org-reserved-creator@local.test',
  'Fixture for reserved-slug write-path coverage'
);

RESET ROLE;
SET LOCAL ROLE service_role;

UPDATE public.trusted_member
  SET status = true
  WHERE user_id IN (
    'fe000000-0000-4000-8000-000000000001',
    'fe000000-0000-4000-8000-000000000002'
  );

RESET ROLE;

INSERT INTO public.organizations (
  id, name, username, type, join_code, created_by
)
VALUES (
  'fe100000-0000-4000-8000-000000000001',
  'Organization Reserved Slug Fixture',
  'organization-reserved-slug-fixture',
  'school',
  '801001',
  'fe000000-0000-4000-8000-000000000001'
);

INSERT INTO public.organization_members (
  id, organization_id, user_id, role
)
VALUES (
  'fe200000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000001',
  'fe000000-0000-4000-8000-000000000001',
  'admin'
);

SET LOCAL request.jwt.claims =
  '{"sub":"fe000000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

-- Direct inserts: every reserved spelling is rejected, exactly like a
-- Server Action call would be, but enforced without one.
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000002',
      'Reserved Create Attempt',
      'create',
      'school',
      '801002',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username "create"'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000003',
      'Reserved Join Attempt',
      'join',
      'school',
      '801003',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username "join"'
);

-- Case, surrounding whitespace, and Unicode compatibility variants are the
-- same reserved slug once normalized, and must not be a bypass.
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000004',
      'Reserved Create Case Attempt',
      'CREATE',
      'school',
      '801004',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via an uppercase spelling'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000005',
      'Reserved Join Whitespace Attempt',
      '  join  ',
      'school',
      '801005',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via padding whitespace'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000006',
      'Reserved Create Fullwidth Attempt',
      E'ｃｒｅａｔｅ',
      'school',
      '801006',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct insert cannot claim the reserved username via full-width Unicode compatibility characters'
);

-- Ordinary usernames, including ones that merely contain a reserved word,
-- are unaffected.
SELECT extensions.lives_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000007',
      'Creators Collective',
      'creators-collective',
      'nonprofit',
      '801007',
      'fe000000-0000-4000-8000-000000000002'
    )
  $$,
  'an ordinary username that merely contains the reserved word is accepted'
);

RESET ROLE;

-- Direct updates: the same admin-writable path RLS already allows.
SET LOCAL request.jwt.claims =
  '{"sub":"fe000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET username = 'create'
    WHERE id = 'fe100000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct update cannot rename an organization to the reserved username "create"'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.organizations
    SET username = 'Join'
    WHERE id = 'fe100000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'a direct update cannot rename an organization to the reserved username "join" in mixed case'
);

SELECT extensions.is(
  (
    SELECT username::text
    FROM public.organizations
    WHERE id = 'fe100000-0000-4000-8000-000000000001'
  ),
  'organization-reserved-slug-fixture',
  'the rejected renames leave the organization username unchanged'
);

SELECT extensions.lives_ok(
  $$
    UPDATE public.organizations
    SET username = 'organization-reserved-slug-fixture-renamed'
    WHERE id = 'fe100000-0000-4000-8000-000000000001'
  $$,
  'a direct update to a non-reserved username is accepted'
);

SELECT extensions.is(
  (
    SELECT username::text
    FROM public.organizations
    WHERE id = 'fe100000-0000-4000-8000-000000000001'
  ),
  'organization-reserved-slug-fixture-renamed',
  'the accepted rename is persisted'
);

RESET ROLE;

-- The constraint applies uniformly: even a service-role write cannot claim
-- a reserved username, so it is not only an authenticated-client boundary.
SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000008',
      'Service Role Reserved Attempt',
      'join',
      'school',
      '801008',
      'fe000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'new row for relation "organizations" violates check constraint "organizations_username_not_reserved_check"',
  'even a service-role insert cannot claim a reserved username'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO public.organizations (
      id, name, username, type, join_code, created_by
    )
    VALUES (
      'fe100000-0000-4000-8000-000000000009',
      'Service Role Ordinary Organization',
      'service-role-ordinary-organization',
      'school',
      '801009',
      'fe000000-0000-4000-8000-000000000001'
    )
  $$,
  'a service-role insert with an ordinary username is unaffected'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
