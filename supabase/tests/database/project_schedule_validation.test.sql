-- Direct browser writes cannot bypass timezone or recurrence validation, while
-- unrelated updates to legacy rows remain upgrade-safe.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(13);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'ee000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'schedule-owner@local.test', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(), now()
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated', 'private.project_timezone_is_valid(text)', 'EXECUTE'
  ),
  'authenticated cannot call the private timezone validator'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated', 'private.project_recurrence_rule_is_valid(jsonb)', 'EXECUTE'
  ),
  'authenticated cannot call the private recurrence validator'
);

SET LOCAL request.jwt.claims =
  '{"sub":"ee000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.lives_ok(
  $$
    INSERT INTO public.projects (
      id, creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility,
      project_timezone, recurrence_rule
    ) VALUES (
      'ee100000-0000-4000-8000-000000000001',
      'ee000000-0000-4000-8000-000000000001',
      'Valid recurring project', 'Local', 'Synthetic', 'oneTime',
      'manual',
      '{"oneTime":{"date":"2026-09-01","startTime":"09:00","endTime":"10:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles',
      '{"frequency":"weekly","interval":1,"end_type":"on_date","end_date":"2026-12-31","weekdays":["monday"]}'::jsonb
    )
  $$,
  'a direct authenticated insert with valid schedule metadata succeeds'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.projects (
      creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'ee000000-0000-4000-8000-000000000001',
      'Bad timezone', 'Local', 'Synthetic', 'oneTime', 'manual', '{}'::jsonb,
      true, 'unlisted', 'Mars/Olympus_Mons'
    )
  $$,
  '22023',
  'projects.project_timezone must be a valid IANA timezone',
  'an authenticated insert cannot store an invented timezone'
);

SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET project_timezone = NULL
    WHERE id = 'ee100000-0000-4000-8000-000000000001'$$,
  '22023',
  'projects.project_timezone must be a valid IANA timezone',
  'an authenticated update cannot clear the timezone'
);

SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET recurrence_rule = '{"frequency":"daily","interval":1,"end_type":"never","extra":true}'::jsonb
    WHERE id = 'ee100000-0000-4000-8000-000000000001'$$,
  '22023',
  'projects.recurrence_rule violates the recurrence contract',
  'unknown recurrence keys are denied at the database boundary'
);

SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET recurrence_rule = '{"frequency":"daily","interval":1,"end_type":"never","end_date":"2026-02-30"}'::jsonb
    WHERE id = 'ee100000-0000-4000-8000-000000000001'$$,
  '22023',
  'projects.recurrence_rule violates the recurrence contract',
  'an invalid supplied end_date is denied even for end_type never'
);

SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET recurrence_rule = '{"frequency":"daily","interval":1,"end_type":"after_occurrences","end_occurrences":53}'::jsonb
    WHERE id = 'ee100000-0000-4000-8000-000000000001'$$,
  '22023',
  'projects.recurrence_rule violates the recurrence contract',
  'the database enforces the 52-occurrence ceiling'
);

SELECT extensions.lives_ok(
  $$UPDATE public.projects
    SET recurrence_rule = '{"frequency":"daily","interval":2,"end_type":"after_occurrences","end_occurrences":52}'::jsonb,
        project_timezone = 'UTC'
    WHERE id = 'ee100000-0000-4000-8000-000000000001'$$,
  'valid recurrence and timezone updates remain available to the owner'
);

SELECT extensions.is(
  (
    SELECT recurrence_rule->>'end_occurrences'
    FROM public.projects
    WHERE id = 'ee100000-0000-4000-8000-000000000001'
  ),
  '52',
  'the valid direct update is persisted'
);

RESET ROLE;

-- Simulate a pre-migration row without rewriting the migration ledger. The new
-- trigger must not make an unrelated edit impossible merely because legacy
-- schedule metadata was already invalid.
ALTER TABLE public.projects DISABLE TRIGGER enforce_project_schedule_validation;
INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, visibility,
  project_timezone, recurrence_rule
) VALUES (
  'ee100000-0000-4000-8000-000000000002',
  'ee000000-0000-4000-8000-000000000001',
  'Legacy invalid project', 'Local', 'Synthetic', 'oneTime',
  'manual', '{}'::jsonb, true, 'unlisted', 'Legacy/Invalid',
  '{"frequency":"daily","interval":0,"end_type":"never"}'::jsonb
);
ALTER TABLE public.projects ENABLE TRIGGER enforce_project_schedule_validation;

SET LOCAL ROLE authenticated;

SELECT extensions.lives_ok(
  $$UPDATE public.projects
    SET title = 'Legacy invalid project renamed'
    WHERE id = 'ee100000-0000-4000-8000-000000000002'$$,
  'unrelated updates to existing invalid rows remain upgrade-safe'
);

SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET recurrence_rule = '{"frequency":"daily","interval":-1,"end_type":"never"}'::jsonb
    WHERE id = 'ee100000-0000-4000-8000-000000000002'$$,
  '22023',
  'projects.recurrence_rule violates the recurrence contract',
  'changing legacy recurrence metadata requires repairing it'
);

SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET project_timezone = 'Legacy/Still_Invalid'
    WHERE id = 'ee100000-0000-4000-8000-000000000002'$$,
  '22023',
  'projects.project_timezone must be a valid IANA timezone',
  'touching a legacy timezone requires repairing it'
);

SELECT * FROM extensions.finish();

ROLLBACK;
