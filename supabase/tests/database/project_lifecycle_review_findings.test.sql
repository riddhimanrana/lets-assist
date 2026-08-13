BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(76);

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
   true, 'upcoming'),
  ('f9200000-0000-4000-8000-000000000008',
   'f9000000-0000-4000-8000-000000000001',
   'f9100000-0000-4000-8000-000000000001',
   'Status transition boundary', 'Local', 'Review fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2031-08-18","startTime":"10:00","endTime":"12:00","volunteers":10}}',
   true, 'upcoming'),
  ('f9200000-0000-4000-8000-000000000009',
   'f9000000-0000-4000-8000-000000000001',
   'f9100000-0000-4000-8000-000000000001',
   'Nullable status boundary', 'Local', 'Review fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2031-08-19","startTime":"10:00","endTime":"12:00","volunteers":10}}',
   true, NULL);

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
   'f9000000-0000-4000-8000-000000000009', 'oneTime', 'pending'),
  ('f9300000-0000-4000-8000-000000000007',
   'f9200000-0000-4000-8000-000000000001',
   'f9000000-0000-4000-8000-000000000007', 'oneTime', 'rejected');

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
  ),
  (
    'f9200000-0000-4000-8000-000000000010',
    'f9000000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'Zero-child recurring parent', 'Local', 'Review fixture', 'oneTime', 'manual',
    '{"oneTime":{"date":"2031-08-20","startTime":"10:00","endTime":"12:00","volunteers":10}}',
    true, 'upcoming',
    '{"frequency":"weekly","interval":1,"end_type":"never"}',
    NULL, NULL, NULL
  );

SET LOCAL session_replication_role = replica;
INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status, recurrence_rule,
  recurrence_parent_id, recurrence_sequence, recurrence_occurrence_date
)
VALUES
  (
    'f9200000-0000-4000-8000-000000000011',
    'f9000000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'Legacy ended parent', 'Local', 'Review fixture', 'oneTime', 'manual',
    '{"oneTime":{"date":"2031-08-21","startTime":"10:00","endTime":"12:00","volunteers":10}}',
    true, 'upcoming', NULL,
    NULL, NULL, NULL
  ),
  (
    'f9200000-0000-4000-8000-000000000012',
    'f9000000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    'Legacy cancelled child', 'Local', 'Review fixture', 'oneTime', 'manual',
    '{"oneTime":{"date":"2031-08-28","startTime":"10:00","endTime":"12:00","volunteers":10}}',
    true, 'cancelled', NULL,
    'f9200000-0000-4000-8000-000000000011', 1, '2031-08-28'
  );
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE zero_child_series_generation AS
SELECT recurrence_generation_id AS generation_id
FROM public.projects
WHERE id = 'f9200000-0000-4000-8000-000000000010';
GRANT SELECT ON zero_child_series_generation TO authenticated;

CREATE TEMP TABLE recurring_parent_generation AS
SELECT recurrence_generation_id AS generation_id
FROM public.projects
WHERE id = 'f9200000-0000-4000-8000-000000000005';
GRANT SELECT ON recurring_parent_generation TO authenticated;

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
SELECT extensions.throws_ok(
  $$SELECT public.cancel_project_transactional(
    'f9200000-0000-4000-8000-000000000002',
    'Null-status attempt'
  )$$,
  '42501',
  'project cancellation permission denied',
  'a null-status administrator cannot cancel a project'
);
SELECT extensions.is(
  (SELECT outcome FROM public.unreject_project_signup_with_capacity(
    'f9300000-0000-4000-8000-000000000007'
  )),
  'refused',
  'a null-status administrator cannot unreject a signup'
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
    SET status = 'in-progress'
    WHERE id = 'f9200000-0000-4000-8000-000000000008'$$,
  '42501',
  'project status transitions require a reviewed lifecycle RPC',
  'authenticated creators cannot change an ordinary project status directly'
);
SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET recurrence_rule = NULL
    WHERE id = 'f9200000-0000-4000-8000-000000000005'$$,
  '42501',
  'ending project recurrence requires a generation-bound lifecycle RPC',
  'authenticated creators cannot bypass the generation-bound series transaction'
);
SELECT extensions.throws_ok(
  $$SELECT public.transition_project_status_transactional(
    'f9200000-0000-4000-8000-000000000008',
    NULL::text
  )$$,
  '22023',
  'transition_project_status_transactional: invalid input',
  'the status RPC rejects a null target instead of bypassing the finite graph'
);
SELECT extensions.throws_ok(
  $$SELECT public.transition_project_status_transactional(
    'f9200000-0000-4000-8000-000000000009',
    'completed'
  )$$,
  '55000',
  'project status transition is not allowed',
  'the status RPC rejects a nullable current state instead of bypassing the finite graph'
);
SELECT extensions.is(
  public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000009'
  ),
  jsonb_build_object(
    'outcome', 'unchanged',
    'endedRecurringSeries', false,
    'cancelledOccurrences', 0,
    'calendarCleanupProjectIds', '[]'::jsonb
  ),
  'a never-recurring project returns an exact unchanged receipt'
);
SELECT extensions.is(
  public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000011'
  ),
  jsonb_build_object(
    'outcome', 'replayed',
    'endedRecurringSeries', true,
    'cancelledOccurrences', 0,
    'calendarCleanupProjectIds',
      jsonb_build_array('f9200000-0000-4000-8000-000000000012'::uuid)
  ),
  'the compatibility wrapper preserves cleanup replay for a legacy ended series'
);
SELECT extensions.is(
  public.transition_project_status_transactional(
    'f9200000-0000-4000-8000-000000000008',
    'in-progress'
  ),
  jsonb_build_object(
    'outcome', 'transitioned',
    'projectId', 'f9200000-0000-4000-8000-000000000008'::uuid,
    'previousStatus', 'upcoming',
    'status', 'in-progress'
  ),
  'the status RPC returns the exact committed transition receipt'
);
SELECT extensions.is(
  public.transition_project_status_transactional(
    'f9200000-0000-4000-8000-000000000008',
    'completed'
  )->>'outcome',
  'transitioned',
  'the status RPC permits the reviewed in-progress to completed transition'
);
SELECT extensions.is(
  (SELECT status FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000008'),
  'completed',
  'the status RPC persists the locked transition'
);
SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET status = 'cancelled'
    WHERE id = 'f9200000-0000-4000-8000-000000000002'$$,
  '42501',
  'project status transitions require a reviewed lifecycle RPC',
  'authenticated Data API updates cannot bypass the cancellation transaction'
);
RESET ROLE;

UPDATE public.projects
SET visibility = 'unlisted'
WHERE id = 'f9200000-0000-4000-8000-000000000005';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$SELECT public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000005',
    jsonb_build_object(
      'recurrence_rule', NULL,
      'visibility', 'public',
      'series_end_generation', (
        SELECT recurrence_generation_id::text
        FROM public.projects
        WHERE id = 'f9200000-0000-4000-8000-000000000005'
      )
    )
  )$$,
  '42501',
  'trusted membership is required for public visibility',
  'the definer series edit cannot bypass trusted-member visibility policy'
);
RESET ROLE;
SELECT extensions.is(
  (SELECT visibility FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000005'),
  'unlisted',
  'a rejected public-visibility escalation leaves the parent unlisted'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET status = 'upcoming'
    WHERE id = 'f9200000-0000-4000-8000-000000000003'$$,
  '42501',
  'project status transitions require a reviewed lifecycle RPC',
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
SELECT extensions.throws_ok(
  $$SELECT public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000005',
    jsonb_build_object(
      'recurrence_rule', NULL,
      'visibility', 'forbidden',
      'series_end_generation', (
        SELECT recurrence_generation_id::text
        FROM public.projects
        WHERE id = 'f9200000-0000-4000-8000-000000000005'
      )
    )
  )$$,
  '23514',
  NULL,
  'an invalid ordinary edit aborts the whole series transaction'
);
RESET ROLE;
SELECT extensions.is(
  (SELECT recurrence_rule FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000005'),
  '{"frequency":"weekly","interval":1,"end_type":"never"}'::jsonb,
  'a rejected ordinary edit leaves the parent recurrence rule intact'
);
SELECT extensions.is(
  (SELECT status FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000006'),
  'upcoming',
  'a rejected ordinary edit leaves the eligible child upcoming'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_jobs
   WHERE project_id = 'f9200000-0000-4000-8000-000000000006'),
  0::bigint,
  'a rejected ordinary edit creates no child cancellation receipt'
);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$SELECT public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000010'
  )$$,
  '40001',
  'series end generation required; refresh required',
  'the compatibility wrapper cannot adopt and end an active generation'
);
SELECT extensions.is(
  public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'recurrence_rule', NULL,
      'series_end_generation', (
        SELECT generation_id::text
        FROM zero_child_series_generation
      )
    )
  )->>'outcome',
  'ended',
  'the generation-bound transaction records a zero-child series ending'
);
SELECT extensions.is(
  public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000010'
  )->>'outcome',
  'replayed',
  'a zero-child recurring series replays from its durable marker'
);
RESET ROLE;
UPDATE public.projects
SET recurrence_rule =
  '{"frequency":"weekly","interval":1,"end_type":"never"}'::jsonb
WHERE id = 'f9200000-0000-4000-8000-000000000010';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$SELECT public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'recurrence_rule', NULL,
      'series_end_generation', (
        SELECT generation_id::text
        FROM zero_child_series_generation
      )
    )
  )$$,
  '40001',
  'project recurrence generation changed; refresh required',
  'a delayed retry cannot end a replacement recurrence generation'
);
RESET ROLE;
SELECT extensions.is(
  (SELECT recurrence_rule FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000010'),
  '{"frequency":"weekly","interval":1,"end_type":"never"}'::jsonb,
  'a stale generation retry leaves the replacement recurrence active'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
CREATE TEMP TABLE recurring_series_receipt AS
SELECT public.end_recurring_project_series_transactional(
  'f9200000-0000-4000-8000-000000000005',
  jsonb_build_object(
    'recurrence_rule', NULL,
    'title', 'Committed series title',
    'series_end_generation', (
      SELECT generation_id::text
      FROM recurring_parent_generation
    )
  )
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
  (SELECT title FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000005'),
  'Committed series title',
  'series ending commits its ordinary parent edit'
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
SELECT extensions.is(
  (SELECT receipt->'calendarCleanupProjectIds' FROM recurring_series_receipt),
  jsonb_build_array('f9200000-0000-4000-8000-000000000006'::uuid),
  'series ending returns cleanup IDs only for locked eligible children'
);
SELECT extensions.is(
  (SELECT receipt->>'cancelledOccurrences' FROM recurring_series_receipt),
  '1',
  'series ending reports the exact number of children it cancelled'
);
SELECT extensions.ok(
  (
    SELECT update_fingerprint ~ '^[0-9a-f]{64}$'
    FROM private.project_series_end_receipts
    WHERE project_id = 'f9200000-0000-4000-8000-000000000005'
  ),
  'the generation receipt stores a canonical edit fingerprint'
);
SELECT extensions.throws_ok(
  $$UPDATE private.project_series_end_receipts
    SET ended_at = pg_catalog.clock_timestamp()
    WHERE project_id = 'f9200000-0000-4000-8000-000000000005'$$,
  '55000',
  'project series end receipts are immutable',
  'the committed generation receipt cannot be rewritten'
);
UPDATE public.projects
SET title = 'Intervening series title'
WHERE id = 'f9200000-0000-4000-8000-000000000005';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.is(
  public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000005',
    jsonb_build_object(
      'recurrence_rule', NULL,
      'title', 'Committed series title',
      'series_end_generation', (
        SELECT generation_id::text
        FROM recurring_parent_generation
      )
    )
  )->>'outcome',
  'replayed',
  'an exact series retry replays its immutable receipt'
);
RESET ROLE;
SELECT extensions.is(
  (SELECT title FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000005'),
  'Intervening series title',
  'an exact retry cannot overwrite an intervening ordinary edit'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$SELECT public.end_recurring_project_series_transactional(
    'f9200000-0000-4000-8000-000000000005',
    jsonb_build_object(
      'recurrence_rule', NULL,
      'title', 'Mismatched retry title',
      'series_end_generation', (
        SELECT generation_id::text
        FROM recurring_parent_generation
      )
    )
  )$$,
  '40001',
  'project series end request does not match committed edit',
  'a generation receipt cannot be rebound to different ordinary edits'
);
RESET ROLE;
SELECT extensions.is(
  (SELECT title FROM public.projects
   WHERE id = 'f9200000-0000-4000-8000-000000000005'),
  'Intervening series title',
  'a mismatched retry leaves the intervening edit intact'
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
