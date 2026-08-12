BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(19);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('f9000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'review-creator@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'review-inactive-admin@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'review-suspended-staff@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'review-active-admin@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'review-volunteer-one@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
   'review-volunteer-two@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated',
   'review-volunteer-three@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated',
   'review-active-staff@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'f9100000-0000-4000-8000-000000000001',
  'Lifecycle Review Findings',
  'lifecycle-review-findings',
  'nonprofit',
  '785001'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('f9100000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000002', 'admin', 'inactive'),
  ('f9100000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000003', 'staff', 'suspended'),
  ('f9100000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000004', 'admin', 'active'),
  ('f9100000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000008', 'staff', 'active');

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES
  ('f9200000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000001',
   'f9100000-0000-4000-8000-000000000001',
   'Organizer authority', 'Local', 'Review fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2031-08-12","startTime":"10:00","endTime":"12:00","volunteers":10}}',
   true, 'upcoming'),
  ('f9200000-0000-4000-8000-000000000002',
   'f9000000-0000-4000-8000-000000000001',
   'f9100000-0000-4000-8000-000000000001',
   'Transactional cancellation', 'Local', 'Review fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2031-08-13","startTime":"10:00","endTime":"12:00","volunteers":10}}',
   true, 'upcoming'),
  ('f9200000-0000-4000-8000-000000000003',
   'f9000000-0000-4000-8000-000000000001',
   'f9100000-0000-4000-8000-000000000001',
   'Cancelled attendance', 'Local', 'Review fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2031-08-14","startTime":"10:00","endTime":"12:00","volunteers":10}}',
   true, 'upcoming'),
  ('f9200000-0000-4000-8000-000000000004',
   'f9000000-0000-4000-8000-000000000001',
   'f9100000-0000-4000-8000-000000000001',
   'Inactive attendance', 'Local', 'Review fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2031-08-15","startTime":"10:00","endTime":"12:00","volunteers":10}}',
   true, 'upcoming');

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status
)
VALUES
  ('f9300000-0000-4000-8000-000000000001',
   'f9200000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000005', 'oneTime', 'pending'),
  ('f9300000-0000-4000-8000-000000000002',
   'f9200000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000006', 'oneTime', 'rejected'),
  ('f9300000-0000-4000-8000-000000000003',
   'f9200000-0000-4000-8000-000000000003',
   'f9000000-0000-4000-8000-000000000006', 'oneTime', 'approved'),
  ('f9300000-0000-4000-8000-000000000004',
   'f9200000-0000-4000-8000-000000000004',
   'f9000000-0000-4000-8000-000000000007', 'oneTime', 'approved');

UPDATE public.projects
SET status = CASE id
  WHEN 'f9200000-0000-4000-8000-000000000003'::uuid THEN 'cancelled'
  ELSE 'inactive'
END
WHERE id IN (
  'f9200000-0000-4000-8000-000000000003',
  'f9200000-0000-4000-8000-000000000004'
);

UPDATE public.projects
SET can_be_managed_by_staff = false
WHERE id = 'f9200000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT extensions.is(
  public.is_project_organizer(
    'f9200000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000002'
  ),
  false,
  'inactive organization administrators have no project organizer authority'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT extensions.is(
  public.is_project_organizer(
    'f9200000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000003'
  ),
  false,
  'suspended organization staff have no project organizer authority'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.is(
  public.is_project_organizer(
    'f9200000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000001'
  ),
  true,
  'project creators retain organizer authority independently of membership'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT extensions.is(
  public.is_project_organizer(
    'f9200000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000004'
  ),
  true,
  'active organization administrators retain organizer authority'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000008","role":"authenticated"}';
SELECT extensions.is(
  public.is_project_organizer(
    'f9200000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000008'
  ),
  false,
  'active staff cannot manage a project whose creator disabled staff management'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET status = 'cancelled'
    WHERE id = 'f9200000-0000-4000-8000-000000000002'$$,
  '42501',
  'project cancellation requires cancel_project_transactional',
  'authenticated Data API updates cannot bypass the cancellation transaction'
);
RESET ROLE;

SELECT extensions.is(
  (SELECT status FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000002'),
  'upcoming',
  'a rejected direct cancellation leaves the project upcoming'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_jobs
   WHERE project_id = 'f9200000-0000-4000-8000-000000000002'),
  0::bigint,
  'a rejected direct cancellation cannot create partial outbox state'
);

SET LOCAL ROLE authenticated;
SELECT extensions.is(
  public.cancel_project_transactional(
    'f9200000-0000-4000-8000-000000000002',
    'Canonical cancellation'
  )->>'outcome',
  'cancelled',
  'the reviewed cancellation RPC still performs the transition'
);
RESET ROLE;
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_jobs
   WHERE project_id = 'f9200000-0000-4000-8000-000000000002'),
  1::bigint,
  'the reviewed cancellation RPC still writes one outbox job'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'f9300000-0000-4000-8000-000000000001'$$,
  '42501',
  'signup approval requires a capacity-safe transactional RPC',
  'authenticated managers cannot directly approve pending signups'
);
SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'f9300000-0000-4000-8000-000000000002'$$,
  '42501',
  'signup approval requires a capacity-safe transactional RPC',
  'authenticated managers cannot directly reapprove rejected signups'
);
RESET ROLE;

SELECT extensions.results_eq(
  $$
    SELECT id, status
    FROM public.project_signups
    WHERE id IN (
      'f9300000-0000-4000-8000-000000000001',
      'f9300000-0000-4000-8000-000000000002'
    )
    ORDER BY id
  $$,
  $$ VALUES
    ('f9300000-0000-4000-8000-000000000001'::uuid, 'pending'::text),
    ('f9300000-0000-4000-8000-000000000002'::uuid, 'rejected'::text)
  $$,
  'denied direct approvals preserve both signup states'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT extensions.is(
  (SELECT outcome FROM public.unreject_project_signup_with_capacity(
    'f9300000-0000-4000-8000-000000000002'
  )),
  'approved',
  'the capacity-safe unreject RPC remains available to active managers'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT extensions.lives_ok(
  $$UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'f9300000-0000-4000-8000-000000000001'$$,
  'service-role signup transitions remain available to reviewed server paths'
);
SELECT extensions.is(
  (SELECT status FROM public.project_signups
   WHERE id = 'f9300000-0000-4000-8000-000000000001'),
  'approved',
  'the reviewed service-role transition persists approved state'
);

SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET status = 'attended'
    WHERE id = 'f9300000-0000-4000-8000-000000000003'$$,
  '55000',
  'attendance requires an active project',
  'approved signups cannot become attended after project cancellation'
);
SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET status = 'attended'
    WHERE id = 'f9300000-0000-4000-8000-000000000004'$$,
  '55000',
  'attendance requires an active project',
  'approved signups cannot become attended on an inactive project'
);
RESET ROLE;

SELECT extensions.results_eq(
  $$
    SELECT id, status
    FROM public.project_signups
    WHERE id IN (
      'f9300000-0000-4000-8000-000000000003',
      'f9300000-0000-4000-8000-000000000004'
    )
    ORDER BY id
  $$,
  $$ VALUES
    ('f9300000-0000-4000-8000-000000000003'::uuid, 'approved'::text),
    ('f9300000-0000-4000-8000-000000000004'::uuid, 'approved'::text)
  $$,
  'denied attendance transitions preserve approved state'
);

SELECT * FROM extensions.finish();

ROLLBACK;
