BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(45);

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
   'review-active-staff@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated',
   'review-null-status-admin@local.test', now(), '{}', '{}', now(), now()),
  ('f9000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated',
   'review-cross-tenant-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'f9100000-0000-4000-8000-000000000001',
    'Lifecycle Review Findings',
    'lifecycle-review-findings',
    'nonprofit',
    '785001'
  ),
  (
    'f9100000-0000-4000-8000-000000000002',
    'Lifecycle Cross Tenant',
    'lifecycle-cross-tenant',
    'nonprofit',
    '785002'
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
   'f9000000-0000-4000-8000-000000000008', 'staff', 'active'),
  ('f9100000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000009', 'admin', NULL),
  ('f9100000-0000-4000-8000-000000000002',
   'f9000000-0000-4000-8000-000000000010', 'admin', 'active');

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
   'f9000000-0000-4000-8000-000000000007', 'oneTime', 'approved'),
  ('f9300000-0000-4000-8000-000000000005',
   'f9200000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000007', 'oneTime', 'cancelled'),
  ('f9300000-0000-4000-8000-000000000006',
   'f9200000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000009', 'oneTime', 'pending');

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

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status, recurrence_rule,
  recurrence_parent_id, recurrence_sequence, recurrence_occurrence_date
)
VALUES
  (
    'f9200000-0000-4000-8000-000000000005',
    'f9000000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'Recurring parent', 'Local', 'Review fixture', 'oneTime', 'manual',
    '{"oneTime":{"date":"2031-08-16","startTime":"10:00","endTime":"12:00","volunteers":10}}',
    true, 'upcoming',
    '{"frequency":"weekly","interval":1,"end_type":"never"}',
    NULL, NULL, NULL
  ),
  (
    'f9200000-0000-4000-8000-000000000006',
    'f9000000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'Recurring child', 'Local', 'Review fixture', 'oneTime', 'manual',
    '{"oneTime":{"date":"2031-08-23","startTime":"10:00","endTime":"12:00","volunteers":10}}',
    true, 'upcoming', NULL,
    'f9200000-0000-4000-8000-000000000005', 1, '2031-08-23'
  );

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
SELECT extensions.is(
  private.is_org_admin('f9100000-0000-4000-8000-000000000001'),
  false,
  'inactive organization administrators have no shared admin authority'
);
SELECT extensions.lives_ok(
  $$UPDATE public.organization_members
    SET status = 'active'
    WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
      AND user_id = 'f9000000-0000-4000-8000-000000000002'$$,
  'an inactive administrator self-reactivation attempt is denied without disclosure'
);
RESET ROLE;
SELECT extensions.is(
  (SELECT status FROM public.organization_members
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND user_id = 'f9000000-0000-4000-8000-000000000002'),
  'inactive',
  'denied administrator self-reactivation preserves inactive status'
);

SET LOCAL ROLE authenticated;
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
SELECT extensions.is(
  private.is_org_staff_or_admin('f9100000-0000-4000-8000-000000000001'),
  false,
  'inactive staff have no shared staff authority'
);

SET LOCAL ROLE authenticated;
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
SELECT extensions.is(
  private.is_org_admin('f9100000-0000-4000-8000-000000000001'),
  true,
  'active organization administrators retain shared admin authority'
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
SELECT extensions.is(
  private.is_org_staff_or_admin('f9100000-0000-4000-8000-000000000001'),
  true,
  'active organization staff retain shared staff authority'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000010","role":"authenticated"}';
SELECT extensions.is(
  private.is_org_member('f9100000-0000-4000-8000-000000000001'),
  false,
  'an active administrator from another tenant has no membership authority here'
);
SELECT extensions.lives_ok(
  $$UPDATE public.organization_members
    SET status = 'active'
    WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
      AND user_id = 'f9000000-0000-4000-8000-000000000002'$$,
  'cross-tenant administrator updates are denied without tenant disclosure'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000009","role":"authenticated"}';
SELECT extensions.is(
  public.is_project_organizer(
    'f9200000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000009'
  ),
  false,
  'a null membership status grants no project authority'
);

UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
  AND user_id = 'f9000000-0000-4000-8000-000000000009';
RESET ROLE;
SELECT extensions.is(
  (SELECT status FROM public.organization_members
   WHERE organization_id = 'f9100000-0000-4000-8000-000000000001'
     AND user_id = 'f9000000-0000-4000-8000-000000000009'),
  NULL::text,
  'an inactive actor cannot reactivate their own tenant authority'
);

SET LOCAL ROLE authenticated;
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

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET status = 'upcoming'
    WHERE id = 'f9200000-0000-4000-8000-000000000003'$$,
  '42501',
  'cancelled projects cannot be reopened directly',
  'authenticated organizers cannot revive a cancelled project outside a reviewed recovery flow'
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
SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'f9300000-0000-4000-8000-000000000005'$$,
  '42501',
  'signup approval requires a capacity-safe transactional RPC',
  'authenticated managers cannot directly revive cancelled signups as approved'
);
SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET status = 'attended'
    WHERE id = 'f9300000-0000-4000-8000-000000000006'$$,
  '42501',
  'attendance requires a server-authorized operation',
  'authenticated managers cannot directly mark a pending signup attended'
);
SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET status = 'rejected'
    WHERE id = 'f9300000-0000-4000-8000-000000000001'$$,
  '42501',
  'signup rejection requires the server-authorized operation',
  'authenticated managers cannot directly reject a signup'
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
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$UPDATE public.project_signups
    SET status = 'attended'
    WHERE id = 'f9300000-0000-4000-8000-000000000001'$$,
  '42501',
  'attendance requires a server-authorized operation',
  'authenticated managers cannot directly mark approved signups attended'
);
RESET ROLE;

SET LOCAL ROLE service_role;
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

SELECT extensions.ok(
  (
    SELECT proc.prosecdef
      AND proc.proconfig = ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'private.end_recurring_project_series_transactional()'::regprocedure
  ),
  'the private series-end trigger helper is fixed-path SECURITY DEFINER'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'private.end_recurring_project_series_transactional()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.end_recurring_project_series_transactional()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.end_recurring_project_series_transactional()',
    'EXECUTE'
  ),
  'the private series-end trigger helper has no role execute grants'
);
SELECT extensions.ok(
  (
    SELECT NOT proc.prosecdef
      AND proc.proconfig = ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'public.end_recurring_project_series_transactional(uuid)'::regprocedure
  ),
  'the public series-end wrapper is fixed-path SECURITY INVOKER'
);
SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.end_recurring_project_series_transactional(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.end_recurring_project_series_transactional(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.end_recurring_project_series_transactional(uuid)',
    'EXECUTE'
  ),
  'only authenticated can execute the public series-end wrapper'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.projects'::regclass
      AND trigger.tgname = 'projects_end_recurring_series_transactional'
      AND trigger.tgfoid =
        'private.end_recurring_project_series_transactional()'::regprocedure
      AND NOT trigger.tgisinternal
  ),
  'the project recurrence transition invokes the ungranted private helper'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
CREATE TEMP TABLE recurring_series_receipt AS
SELECT public.end_recurring_project_series_transactional(
  'f9200000-0000-4000-8000-000000000005'
) AS receipt;
RESET ROLE;

SELECT extensions.is(
  (SELECT receipt->>'outcome' FROM recurring_series_receipt),
  'ended',
  'series ending returns the exact committed outcome'
);
SELECT extensions.is(
  (SELECT recurrence_rule FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000005'),
  NULL::jsonb,
  'series ending clears the parent recurrence rule'
);
SELECT extensions.is(
  (SELECT status FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000006'),
  'cancelled',
  'series ending cancels the upcoming child in the same transaction'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_jobs
   WHERE project_id = 'f9200000-0000-4000-8000-000000000006'),
  1::bigint,
  'series ending records one durable cancellation job for the child'
);
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      id, creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, status,
      recurrence_parent_id, recurrence_sequence, recurrence_occurrence_date
    ) VALUES (
      'f9200000-0000-4000-8000-000000000007',
      'f9000000-0000-4000-8000-000000000001',
      'Stale generated child', 'Local', 'Review fixture', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-08-30","startTime":"10:00","endTime":"12:00","volunteers":10}}',
      true, 'upcoming',
      'f9200000-0000-4000-8000-000000000005', 2, '2031-08-30'
    )$$,
  '55000',
  'recurrence parent is no longer active',
  'a stale generator cannot insert a child after the parent rule is cleared'
);
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.is(
  public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000005'
  )->>'outcome',
  'replayed',
  'a retry after a lost response is replay-safe for calendar cleanup'
);
RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
