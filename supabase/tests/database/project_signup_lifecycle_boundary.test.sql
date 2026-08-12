BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(10);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'lifecycle-owner@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'lifecycle-volunteer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login
)
VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'Default status fixture', 'Local', 'Synthetic lifecycle fixture',
  'oneTime', 'manual',
  '{"oneTime":{"date":"2030-08-11","startTime":"09:00","endTime":"12:00","volunteers":10}}',
  true
);

SELECT extensions.is(
  (SELECT status FROM public.projects
   WHERE id = 'fa100000-0000-4000-8000-000000000001'),
  'upcoming',
  'omitting project status produces the real upcoming value'
);

UPDATE public.projects
SET status = 'in-progress'
WHERE id = 'fa100000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$INSERT INTO public.project_signups (
      id, project_id, user_id, schedule_id, status
    ) VALUES (
      'fa200000-0000-4000-8000-000000000001',
      'fa100000-0000-4000-8000-000000000001',
      'fa000000-0000-4000-8000-000000000002',
      'oneTime', 'approved'
    )$$,
  'an in-progress project can approve a signup for an active slot'
);

SELECT extensions.is(
  (SELECT status FROM public.project_signups
   WHERE id = 'fa200000-0000-4000-8000-000000000001'),
  'approved',
  'the in-progress approval persists'
);

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status
)
VALUES (
  'fa200000-0000-4000-8000-000000000002',
  'fa100000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000002',
  'later-slot', 'pending'
);

UPDATE public.projects
SET status = 'cancelled'
WHERE id = 'fa100000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'fa200000-0000-4000-8000-000000000002'$$,
  '55000',
  'signups can only be approved for active projects',
  'a cancelled project cannot approve a pending signup'
);

SELECT extensions.is(
  (SELECT status FROM public.project_signups
   WHERE id = 'fa200000-0000-4000-8000-000000000002'),
  'pending',
  'cancelled-project denial preserves the pending state'
);

UPDATE public.projects
SET status = 'completed'
WHERE id = 'fa100000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$INSERT INTO public.project_signups (
      id, project_id, user_id, schedule_id, status
    ) VALUES (
      'fa200000-0000-4000-8000-000000000003',
      'fa100000-0000-4000-8000-000000000001',
      'fa000000-0000-4000-8000-000000000002',
      'closed-slot', 'approved'
    )$$,
  '55000',
  'signups can only be approved for active projects',
  'a completed project cannot accept a new approved signup'
);

UPDATE public.projects
SET status = NULL
WHERE id = 'fa100000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$INSERT INTO public.project_signups (
      id, project_id, user_id, schedule_id, status
    ) VALUES (
      'fa200000-0000-4000-8000-000000000004',
      'fa100000-0000-4000-8000-000000000001',
      'fa000000-0000-4000-8000-000000000002',
      'unknown-slot', 'approved'
    )$$,
  '55000',
  'signups can only be approved for active projects',
  'an unknown project status fails closed'
);

UPDATE public.projects
SET status = 'in-progress'
WHERE id = 'fa100000-0000-4000-8000-000000000001';

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"fa000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT public.cancel_project_transactional(
    'fa100000-0000-4000-8000-000000000001', 'Too late'
  )$$,
  '55000',
  'only an upcoming project can be cancelled',
  'permitting in-progress approval does not weaken cancellation eligibility'
);
RESET ROLE;

SELECT extensions.is(
  (SELECT status FROM public.projects
   WHERE id = 'fa100000-0000-4000-8000-000000000001'),
  'in-progress',
  'denied in-progress cancellation leaves project state unchanged'
);

SELECT extensions.is(
  (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'status'
  ),
  '''upcoming''::text',
  'the catalog stores a real upcoming default rather than a quoted SQL fragment'
);

SELECT * FROM extensions.finish();

ROLLBACK;
