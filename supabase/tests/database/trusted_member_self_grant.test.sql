-- public.trusted_member must never let an applicant approve themselves (AUD-001).
--
-- The INSERT policy accepted any `status` from the row owner while the sibling
-- UPDATE policy required `status IS NULL`. Because trg_tm_sync_profiles fires
-- AFTER INSERT OR UPDATE OF status and writes profiles.trusted_member through
-- the app.allow_trusted_sync bypass, an applicant could self-approve and unlock
-- organization and project creation.
--
-- Both guards are asserted separately on purpose. The trigger raises before RLS
-- is reached, so a behavioural test alone would still pass if the policy
-- silently regressed -- hence the catalog assertions.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(18);

-- ---------------------------------------------------------------------------
-- Fixtures: an applicant and a super admin, created the way handle_new_user
-- expects so the profiles rows come into existence with them.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'aafedcba-1234-4abc-8def-000000000001',
    'authenticated', 'authenticated', 'tm-applicant@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now()
  ),
  (
    'aafedcba-1234-4abc-8def-000000000002',
    'authenticated', 'authenticated', 'tm-superadmin@local.test', now(),
    '{"provider":"email","providers":["email"],"is_super_admin":true}'::jsonb,
    '{}'::jsonb,
    now(), now()
  );

-- ---------------------------------------------------------------------------
-- Catalog: the policy guard
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.trusted_member'::regclass),
  'trusted_member enforces row level security'
);

SELECT extensions.ok(
  (
    SELECT pg_get_expr(polwithcheck, polrelid) LIKE '%status IS NULL%'
    FROM pg_policy
    WHERE polrelid = 'public.trusted_member'::regclass
      AND polname = 'trusted_member_insert_authenticated'
  ),
  'the INSERT policy constrains status'
);

SELECT extensions.ok(
  (
    SELECT pg_get_expr(polwithcheck, polrelid) LIKE '%status IS NULL%'
    FROM pg_policy
    WHERE polrelid = 'public.trusted_member'::regclass
      AND polname = 'trusted_member_update_authenticated'
  ),
  'the UPDATE policy still constrains status'
);

SELECT extensions.policy_roles_are(
  'public', 'trusted_member', 'trusted_member_insert_authenticated',
  ARRAY['authenticated'],
  'only authenticated clients are addressed by the INSERT policy'
);

-- ---------------------------------------------------------------------------
-- Catalog: the trigger guard
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (
    SELECT proconfig IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM unnest(proconfig) AS c(v) WHERE c.v LIKE 'search_path=%'
       )
    FROM pg_proc
    WHERE oid = 'public.trusted_member_set_user_id()'::regprocedure
  ),
  'trusted_member_set_user_id pins its search_path'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated', 'public.trusted_member_set_user_id()', 'EXECUTE'
  ),
  'authenticated cannot execute the identity trigger function directly'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon', 'public.trusted_member_set_user_id()', 'EXECUTE'
  ),
  'anon cannot execute the identity trigger function directly'
);

-- ---------------------------------------------------------------------------
-- Behaviour: as the applicant
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims = '{"sub":"aafedcba-1234-4abc-8def-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$INSERT INTO public.trusted_member (user_id, status, name, email, reason)
    VALUES ('aafedcba-1234-4abc-8def-000000000001', true, 'A', 'a@local.test', 'r')$$,
  '42501',
  'trusted member approval state is server-managed',
  'an applicant cannot insert an approved row'
);

SELECT extensions.throws_ok(
  $$INSERT INTO public.trusted_member (user_id, status, name, email, reason)
    VALUES ('aafedcba-1234-4abc-8def-000000000001', false, 'A', 'a@local.test', 'r')$$,
  '42501',
  'trusted member approval state is server-managed',
  'approval state is server-managed regardless of the value supplied'
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.trusted_member (user_id, status, name, email, reason)
    VALUES ('aafedcba-1234-4abc-8def-000000000001', NULL, 'A', 'a@local.test', 'r')$$,
  'the real application path still works'
);

SELECT extensions.is(
  (SELECT status FROM public.trusted_member
    WHERE user_id = 'aafedcba-1234-4abc-8def-000000000001'),
  NULL::boolean,
  'a submitted application is pending'
);

SELECT extensions.throws_ok(
  $$UPDATE public.trusted_member SET status = true
     WHERE user_id = 'aafedcba-1234-4abc-8def-000000000001'$$,
  '42501',
  NULL,
  'an applicant cannot approve their own pending application'
);

SELECT extensions.is(
  (SELECT trusted_member FROM public.profiles
    WHERE id = 'aafedcba-1234-4abc-8def-000000000001'),
  NULL::boolean,
  'the profile flag was never flipped'
);

SELECT extensions.is(
  public.is_trusted_member('aafedcba-1234-4abc-8def-000000000001'),
  false,
  'the attempt conferred no trusted status'
);

-- The reachable consequence, not just the table: organization creation.
SELECT extensions.throws_ok(
  $$INSERT INTO public.organizations (name, username, description, type, created_by)
    VALUES ('Escalated', 'escalated-org', 'd', 'other',
            'aafedcba-1234-4abc-8def-000000000001')$$,
  '42501',
  NULL,
  'the escalation does not unlock organization creation'
);

-- ---------------------------------------------------------------------------
-- Behaviour: the legitimate approval path still works
-- ---------------------------------------------------------------------------

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT extensions.lives_ok(
  $$UPDATE public.trusted_member SET status = true
     WHERE user_id = 'aafedcba-1234-4abc-8def-000000000001'$$,
  'the service-role approval path is unaffected'
);

SELECT extensions.is(
  (SELECT trusted_member FROM public.profiles
    WHERE id = 'aafedcba-1234-4abc-8def-000000000001'),
  true,
  'trg_tm_sync_profiles still propagates a genuine approval'
);

SELECT extensions.is(
  public.is_trusted_member('aafedcba-1234-4abc-8def-000000000001'),
  true,
  'an approved applicant is trusted'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
