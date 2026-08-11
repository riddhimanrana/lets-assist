-- public.notifications must not accept writes from unauthenticated callers
-- (AUD-002).
--
-- The single permissive INSERT policy listed role `anon` and ended in
-- `OR ((SELECT auth.uid()) IS NULL)`, which is unconditionally true without a
-- session. Anyone holding the public anon key could therefore write a
-- notification for any user, with an attacker-chosen title, body, and
-- action_url, shown in the platform's own notification UI.
--
-- The two legitimate client shapes -- notify yourself, and notify a volunteer
-- signed up to a project you created -- are asserted alongside the denial so a
-- future tightening cannot quietly remove them.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures: an organizer, a volunteer, an unrelated bystander, and a project
-- the volunteer has signed up to.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('fc000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'notify-organizer@local.test', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('fc000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'notify-volunteer@local.test', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('fc000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'notify-bystander@local.test', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.projects (
  id, title, description, location, creator_id,
  event_type, verification_method, schedule
)
VALUES (
  'fc000000-0000-4000-8000-0000000000a1',
  'Notification boundary project', 'd', 'l',
  'fc000000-0000-4000-8000-000000000001',
  'oneTime', 'manual', '{}'::jsonb
);

INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES (
  'fc000000-0000-4000-8000-0000000000b1',
  'fc000000-0000-4000-8000-0000000000a1',
  'fc000000-0000-4000-8000-000000000002',
  'oneTime',
  'approved'
);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notifications'::regclass),
  'notifications enforces row level security'
);

SELECT extensions.policy_roles_are(
  'public', 'notifications', 'Insert own or by project owner',
  ARRAY['authenticated'],
  'the INSERT policy addresses authenticated clients only'
);

SELECT extensions.ok(
  (
    SELECT pg_get_expr(polwithcheck, polrelid) NOT LIKE '%IS NULL%'
    FROM pg_policy
    WHERE polrelid = 'public.notifications'::regclass
      AND polname = 'Insert own or by project owner'
  ),
  'the INSERT policy no longer admits a null actor'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.notifications', 'INSERT'),
  'anon holds no INSERT privilege on notifications'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.notifications', 'UPDATE'),
  'anon holds no UPDATE privilege on notifications'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.notifications', 'DELETE'),
  'anon holds no DELETE privilege on notifications'
);

-- ---------------------------------------------------------------------------
-- Behaviour: unauthenticated
-- ---------------------------------------------------------------------------

SET LOCAL ROLE anon;

SELECT extensions.throws_ok(
  $$INSERT INTO public.notifications (user_id, title, body, type)
    VALUES ('fc000000-0000-4000-8000-000000000002',
            'Action required', 'Confirm your account', 'general')$$,
  '42501',
  NULL,
  'an unauthenticated caller cannot inject a notification'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Behaviour: authenticated
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims = '{"sub":"fc000000-0000-4000-8000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$INSERT INTO public.notifications (user_id, title, body, type)
    VALUES ('fc000000-0000-4000-8000-000000000002', 't', 'b', 'general')$$,
  '42501',
  NULL,
  'an unrelated user cannot notify somebody else'
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.notifications (user_id, title, body, type)
    VALUES ('fc000000-0000-4000-8000-000000000003', 't', 'b', 'general')$$,
  'a user can still notify themselves'
);

RESET ROLE;

SET LOCAL request.jwt.claims = '{"sub":"fc000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.lives_ok(
  $$INSERT INTO public.notifications (user_id, title, body, type)
    VALUES ('fc000000-0000-4000-8000-000000000002',
            'Project Status Update', 'Your signup was updated', 'project_updates')$$,
  'a project creator can still notify a signed-up volunteer'
);

-- Reads stay self-scoped: the organizer sees nothing addressed to the volunteer.
SELECT extensions.is(
  (SELECT count(*) FROM public.notifications
    WHERE user_id = 'fc000000-0000-4000-8000-000000000002'),
  0::bigint,
  'notification reads remain scoped to the recipient'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
