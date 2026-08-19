BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(12);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.set_anonymous_feedback_email_opt_out(uuid,boolean)',
    'EXECUTE'
  ),
  'anonymous clients cannot mutate address-level feedback preferences'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.set_anonymous_feedback_email_opt_out(uuid,boolean)',
    'EXECUTE'
  ),
  'authenticated clients cannot mutate anonymous address preferences'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.set_anonymous_feedback_email_opt_out(uuid,boolean)',
    'EXECUTE'
  ),
  'the verified feedback route can mutate anonymous address preferences'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'private.anonymous_feedback_email_preferences',
    'SELECT'
  ),
  'the service role cannot read the durable normalized-address suppression table'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'efa00000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'feedback-owner@local.test', now(),
  '{}', '{"username":"feedback_owner"}', now(), now()
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
) VALUES
  (
    'efa00000-0000-4000-8000-000000000002',
    'efa00000-0000-4000-8000-000000000001',
    'Feedback one', 'Local', 'Fixture', 'oneTime', 'manual',
    '{"oneTime":{"date":"2026-08-01","startTime":"10:00","endTime":"11:00","volunteers":5}}',
    false, 'upcoming'
  ),
  (
    'efa00000-0000-4000-8000-000000000003',
    'efa00000-0000-4000-8000-000000000001',
    'Feedback two', 'Local', 'Fixture', 'oneTime', 'manual',
    '{"oneTime":{"date":"2026-08-02","startTime":"10:00","endTime":"11:00","volunteers":5}}',
    false, 'upcoming'
  ),
  (
    'efa00000-0000-4000-8000-000000000006',
    'efa00000-0000-4000-8000-000000000001',
    'Feedback three', 'Local', 'Fixture', 'oneTime', 'manual',
    '{"oneTime":{"date":"2026-08-03","startTime":"10:00","endTime":"11:00","volunteers":5}}',
    false, 'upcoming'
  ),
  (
    'efa00000-0000-4000-8000-000000000008',
    'efa00000-0000-4000-8000-000000000001',
    'Feedback four', 'Local', 'Fixture', 'oneTime', 'manual',
    '{"oneTime":{"date":"2026-08-04","startTime":"10:00","endTime":"11:00","volunteers":5}}',
    false, 'upcoming'
  );

INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at)
VALUES
  (
    'efa00000-0000-4000-8000-000000000004',
    'efa00000-0000-4000-8000-000000000002',
    'Shared.Person@local.test', 'Shared One', now()
  ),
  (
    'efa00000-0000-4000-8000-000000000005',
    'efa00000-0000-4000-8000-000000000003',
    'SHARED.PERSON@local.test', 'Shared Two', now()
  );

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claims" =
  '{"sub":"efa00000-0000-4000-8000-000000000001","role":"service_role"}';

SELECT extensions.is(
  public.set_anonymous_feedback_email_opt_out(
    'efa00000-0000-4000-8000-000000000004', true
  ),
  2,
  'unsubscribe propagates to every identity for the normalized address'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.anonymous_signups
   WHERE id IN (
     'efa00000-0000-4000-8000-000000000004',
     'efa00000-0000-4000-8000-000000000005'
   ) AND email_opt_out_at IS NOT NULL),
  2::bigint,
  'every matching project-scoped identity is opted out'
);

RESET ROLE;

SELECT extensions.is(
  (SELECT count(*)
   FROM private.anonymous_feedback_email_preferences
   WHERE normalized_email = 'shared.person@local.test'),
  1::bigint,
  'unsubscribe persists one private normalized-address suppression record'
);

INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at)
VALUES (
  'efa00000-0000-4000-8000-000000000007',
  'efa00000-0000-4000-8000-000000000006',
  'shared.person@local.test', 'Shared Three', now()
);

SELECT extensions.ok(
  (SELECT email_opt_out_at IS NOT NULL
   FROM public.anonymous_signups
   WHERE id = 'efa00000-0000-4000-8000-000000000007'),
  'a future project-scoped identity inherits the durable opt-out'
);

SET LOCAL ROLE service_role;
SELECT extensions.is(
  public.set_anonymous_feedback_email_opt_out(
    'efa00000-0000-4000-8000-000000000005', false
  ),
  3,
  'resubscribe propagates from any matching identity'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.anonymous_signups
   WHERE id IN (
     'efa00000-0000-4000-8000-000000000004',
     'efa00000-0000-4000-8000-000000000005',
     'efa00000-0000-4000-8000-000000000007'
   ) AND email_opt_out_at IS NULL),
  3::bigint,
  'every matching project-scoped identity is resubscribed'
);

RESET ROLE;

SELECT extensions.is(
  (SELECT count(*)
   FROM private.anonymous_feedback_email_preferences
   WHERE normalized_email = 'shared.person@local.test'),
  0::bigint,
  'resubscribe removes the durable normalized-address suppression record'
);

INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at)
VALUES (
  'efa00000-0000-4000-8000-000000000009',
  'efa00000-0000-4000-8000-000000000008',
  'Shared.Person@local.test', 'Shared Four', now()
);

SELECT extensions.ok(
  (SELECT email_opt_out_at IS NULL
   FROM public.anonymous_signups
   WHERE id = 'efa00000-0000-4000-8000-000000000009'),
  'a future identity stays subscribed after the durable preference is removed'
);

SELECT * FROM extensions.finish();
ROLLBACK;
