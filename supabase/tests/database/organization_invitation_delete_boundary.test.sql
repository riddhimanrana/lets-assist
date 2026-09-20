BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(6);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'public.organization_invitations'::regclass
      AND polcmd IN ('d', '*')
  ),
  'invitation deletion has no browser-role policy'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policy
   WHERE polrelid = 'public.organization_invitations'::regclass
     AND polname IN ('Authenticated invitation visibility',
                    'Org admins can create invitations',
                    'Org admins can update invitations')),
  3,
  'normal invitation read, create and cancellation policies remain'
);

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$DELETE FROM public.organization_invitations WHERE false$$,
  '42501', 'permission denied for table organization_invitations',
  'authenticated clients cannot delete invitation history'
);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT extensions.throws_ok(
  $$DELETE FROM public.organization_invitations WHERE false$$,
  '42501', 'permission denied for table organization_invitations',
  'anonymous clients cannot delete invitation history'
);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok(
  $$DELETE FROM public.organization_invitations WHERE false$$,
  'trusted server maintenance retains deletion access'
);
RESET ROLE;
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class
   WHERE oid = 'public.organization_invitations'::regclass),
  'invitation row-level security stays enabled'
);
SELECT * FROM extensions.finish();
ROLLBACK;
