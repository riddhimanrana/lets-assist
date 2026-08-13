-- The public volunteer-hours RPC is a service-role-only invoker shim over a
-- private SECURITY DEFINER transaction. The explicit actor is useful only
-- after the Server Action authenticates it; browser roles cannot spoof it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(20);

SELECT extensions.ok(
  to_regprocedure(
    'public.publish_volunteer_hours_transactional(uuid,text,jsonb,text)'
  ) IS NULL,
  'the former authenticated four-argument publication overload is gone'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.publish_volunteer_hours_transactional(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.publish_volunteer_hours_transactional(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.publish_volunteer_hours_transactional(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'the public explicit-actor RPC is executable only by service_role'
);

SELECT extensions.ok(
  (
    SELECT NOT proc.prosecdef
      AND proc.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'public.publish_volunteer_hours_transactional(uuid,uuid,text,jsonb,text)'::regprocedure
  ),
  'the exposed service RPC is SECURITY INVOKER with an empty search_path'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'private.publish_volunteer_hours_transactional(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.publish_volunteer_hours_transactional(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.publish_volunteer_hours_transactional(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND (
    SELECT proc.prosecdef
      AND proc.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'private.publish_volunteer_hours_transactional(uuid,uuid,text,jsonb,text)'::regprocedure
  ),
  'the private transaction is fixed-path SECURITY DEFINER and service-only'
);

SELECT extensions.ok(
  (
    SELECT position('auth.uid' IN lower(pg_get_functiondef(proc.oid))) = 0
      AND position(
        'v_actor_id uuid := p_actor_id'
        IN lower(pg_get_functiondef(proc.oid))
      ) > 0
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'private.publish_volunteer_hours_transactional(uuid,uuid,text,jsonb,text)'::regprocedure
  ),
  'the private transaction consumes the explicit actor without JWT claim propagation'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('bd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'boundary-creator@local.test', now(), '{}', '{"full_name":"Boundary Creator"}', now(), now()),
  ('bd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'boundary-staff@local.test', now(), '{}', '{"full_name":"Boundary Staff"}', now(), now()),
  ('bd000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'boundary-inactive@local.test', now(), '{}', '{"full_name":"Boundary Inactive"}', now(), now()),
  ('bd000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'boundary-admin@local.test', now(), '{}', '{"full_name":"Boundary Admin"}', now(), now()),
  ('bd000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'boundary-outsider@local.test', now(), '{}', '{"full_name":"Boundary Outsider"}', now(), now()),
  ('bd000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
   'boundary-volunteer-one@local.test', now(), '{}', '{"full_name":"Boundary Volunteer One"}', now(), now()),
  ('bd000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated',
   'boundary-volunteer-two@local.test', now(), '{}', '{"full_name":"Boundary Volunteer Two"}', now(), now()),
  ('bd000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated',
   'boundary-volunteer-three@local.test', now(), '{}', '{"full_name":"Boundary Volunteer Three"}', now(), now());

UPDATE public.profiles
SET
  full_name = CASE id
    WHEN 'bd000000-0000-4000-8000-000000000001' THEN 'Boundary Creator'
    WHEN 'bd000000-0000-4000-8000-000000000002' THEN 'Boundary Staff'
    WHEN 'bd000000-0000-4000-8000-000000000003' THEN 'Boundary Inactive'
    WHEN 'bd000000-0000-4000-8000-000000000004' THEN 'Boundary Admin'
    WHEN 'bd000000-0000-4000-8000-000000000005' THEN 'Boundary Outsider'
    WHEN 'bd000000-0000-4000-8000-000000000006' THEN 'Boundary Volunteer One'
    WHEN 'bd000000-0000-4000-8000-000000000007' THEN 'Boundary Volunteer Two'
    ELSE 'Boundary Volunteer Three'
  END,
  email = CASE id
    WHEN 'bd000000-0000-4000-8000-000000000006' THEN 'boundary-volunteer-one@local.test'
    WHEN 'bd000000-0000-4000-8000-000000000007' THEN 'boundary-volunteer-two@local.test'
    WHEN 'bd000000-0000-4000-8000-000000000008' THEN 'boundary-volunteer-three@local.test'
    ELSE email
  END
WHERE id::text LIKE 'bd000000-0000-4000-8000-00000000000%';

INSERT INTO public.organizations (id, name, username, type, join_code, verified)
VALUES (
  'bd100000-0000-4000-8000-000000000001',
  'Boundary Hours Organization',
  'boundary-hours-organization',
  'school',
  '870001',
  true
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
)
VALUES
  ('bd100000-0000-4000-8000-000000000001',
   'bd000000-0000-4000-8000-000000000002', 'staff', 'active'),
  ('bd100000-0000-4000-8000-000000000001',
   'bd000000-0000-4000-8000-000000000003', 'staff', NULL),
  ('bd100000-0000-4000-8000-000000000001',
   'bd000000-0000-4000-8000-000000000004', 'admin', 'active');

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, organization_id,
  can_be_managed_by_staff
)
VALUES
  (
    'bd200000-0000-4000-8000-000000000001',
    'bd000000-0000-4000-8000-000000000001',
    'Staff Manageable Boundary Project', 'Local', 'Synthetic boundary fixture',
    'oneTime', 'manual',
    '{"oneTime":{"date":"2032-08-11","startTime":"09:00","endTime":"12:00","volunteers":20}}',
    true, 'bd100000-0000-4000-8000-000000000001', true
  ),
  (
    'bd200000-0000-4000-8000-000000000002',
    'bd000000-0000-4000-8000-000000000001',
    'Admin Only Boundary Project', 'Local', 'Synthetic boundary fixture',
    'oneTime', 'manual',
    '{"oneTime":{"date":"2032-08-12","startTime":"09:00","endTime":"12:00","volunteers":20}}',
    true, 'bd100000-0000-4000-8000-000000000001', false
  ),
  (
    'bd200000-0000-4000-8000-000000000003',
    'bd000000-0000-4000-8000-000000000001',
    'Creator Boundary Project', 'Local', 'Synthetic boundary fixture',
    'oneTime', 'manual',
    '{"oneTime":{"date":"2032-08-13","startTime":"09:00","endTime":"12:00","volunteers":20}}',
    true, 'bd100000-0000-4000-8000-000000000001', true
  );

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status
)
VALUES
  ('bd300000-0000-4000-8000-000000000001',
   'bd200000-0000-4000-8000-000000000001',
   'bd000000-0000-4000-8000-000000000006', 'oneTime', 'approved'),
  ('bd300000-0000-4000-8000-000000000002',
   'bd200000-0000-4000-8000-000000000002',
   'bd000000-0000-4000-8000-000000000007', 'oneTime', 'approved'),
  ('bd300000-0000-4000-8000-000000000003',
   'bd200000-0000-4000-8000-000000000003',
   'bd000000-0000-4000-8000-000000000008', 'oneTime', 'approved');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'bd000000-0000-4000-8000-000000000005';
SET LOCAL "request.jwt.claims" =
  '{"sub":"bd000000-0000-4000-8000-000000000005","role":"authenticated"}';

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'bd000000-0000-4000-8000-000000000001',
    'bd200000-0000-4000-8000-000000000001',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000001","checkIn":"2032-08-11T16:00:00Z","checkOut":"2032-08-11T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  '42501',
  NULL,
  'an authenticated browser cannot spoof the creator actor argument'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.hours_publication_receipts
    WHERE project_id::text LIKE 'bd200000-0000-4000-8000-00000000000%'
  ),
  0::bigint,
  'the refused browser call creates no publication receipt'
);

SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    NULL,
    'bd200000-0000-4000-8000-000000000001',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000001","checkIn":"2032-08-11T16:00:00Z","checkOut":"2032-08-11T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )$$,
  '42501',
  'authentication required',
  'the service RPC refuses a missing authenticated actor'
);

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'bd000000-0000-4000-8000-000000000005',
    'bd200000-0000-4000-8000-000000000003',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000003","checkIn":"2032-08-13T16:00:00Z","checkOut":"2032-08-13T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  )$$,
  '42501',
  'not authorized to publish project hours',
  'a service caller cannot turn an unrelated user into an authorized actor'
);

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'bd000000-0000-4000-8000-000000000003',
    'bd200000-0000-4000-8000-000000000001',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000001","checkIn":"2032-08-11T16:00:00Z","checkOut":"2032-08-11T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
  )$$,
  '42501',
  'not authorized to publish project hours',
  'null-status staff cannot publish a staff-manageable project'
);

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'bd000000-0000-4000-8000-000000000002',
    'bd200000-0000-4000-8000-000000000002',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000002","checkIn":"2032-08-12T16:00:00Z","checkOut":"2032-08-12T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  )$$,
  '42501',
  'not authorized to publish project hours',
  'active staff cannot bypass can_be_managed_by_staff false'
);

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'bd000000-0000-4000-8000-000000000001',
    'bd200000-0000-4000-8000-000000000003',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000001","checkIn":"2032-08-13T16:00:00Z","checkOut":"2032-08-13T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  )$$,
  '22023',
  'one or more signups, sessions, statuses, or time ranges are invalid',
  'a creator cannot publish a signup from another project'
);

SELECT extensions.is(
  public.publish_volunteer_hours_transactional(
    'bd000000-0000-4000-8000-000000000004',
    'bd200000-0000-4000-8000-000000000002',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000002","checkIn":"2032-08-12T16:00:00Z","checkOut":"2032-08-12T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:1111111111111111111111111111111111111111111111111111111111111111'
  ) ->> 'outcome',
  'accepted',
  'an active admin can publish even when ordinary staff management is disabled'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT requested_by
    FROM public.hours_publication_receipts
    WHERE project_id = 'bd200000-0000-4000-8000-000000000002'
  ),
  'bd000000-0000-4000-8000-000000000004'::uuid,
  'the durable receipt records the server-authenticated admin actor'
);

SET LOCAL ROLE service_role;

SELECT extensions.is(
  public.publish_volunteer_hours_transactional(
    'bd000000-0000-4000-8000-000000000002',
    'bd200000-0000-4000-8000-000000000001',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000001","checkIn":"2032-08-11T16:00:00Z","checkOut":"2032-08-11T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:2222222222222222222222222222222222222222222222222222222222222222'
  ) ->> 'outcome',
  'accepted',
  'active staff can publish a project that opts into staff management'
);

SELECT extensions.is(
  public.publish_volunteer_hours_transactional(
    'bd000000-0000-4000-8000-000000000001',
    'bd200000-0000-4000-8000-000000000003',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000003","checkIn":"2032-08-13T16:00:00Z","checkOut":"2032-08-13T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:3333333333333333333333333333333333333333333333333333333333333333'
  ) ->> 'outcome',
  'accepted',
  'the project creator remains authorized through the service boundary'
);

SELECT extensions.is(
  public.publish_volunteer_hours_transactional(
    'bd000000-0000-4000-8000-000000000001',
    'bd200000-0000-4000-8000-000000000003',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000003","checkIn":"2032-08-13T16:00:00Z","checkOut":"2032-08-13T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:3333333333333333333333333333333333333333333333333333333333333333'
  ) ->> 'outcome',
  'replayed',
  'an exact lost-response retry returns the durable receipt'
);

RESET ROLE;

SELECT extensions.results_eq(
  $$
    SELECT
      (SELECT count(*) FROM public.hours_publication_receipts
       WHERE project_id::text LIKE 'bd200000-0000-4000-8000-00000000000%'),
      (SELECT count(*) FROM public.certificates
       WHERE project_id::text LIKE 'bd200000-0000-4000-8000-00000000000%'
         AND type = 'verified'),
      (SELECT count(*) FROM public.hours_publication_email_outbox AS outbox
       JOIN public.hours_publication_receipts AS receipt
         ON receipt.id = outbox.receipt_id
       WHERE receipt.project_id::text LIKE 'bd200000-0000-4000-8000-00000000000%'),
      (SELECT count(*) FROM public.notifications
       WHERE action_url IN (
         SELECT '/certificates/' || id
         FROM public.certificates
         WHERE project_id::text LIKE 'bd200000-0000-4000-8000-00000000000%'
       ))
  $$,
  $$VALUES (3::bigint, 3::bigint, 3::bigint, 3::bigint)$$,
  'three publications and one replay create exactly three receipts, certificates, notifications, and email jobs'
);

UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
  AND user_id = 'bd000000-0000-4000-8000-000000000002';

SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$SELECT public.publish_volunteer_hours_transactional(
    'bd000000-0000-4000-8000-000000000002',
    'bd200000-0000-4000-8000-000000000001',
    'oneTime',
    '[{"signupId":"bd300000-0000-4000-8000-000000000001","checkIn":"2032-08-11T16:00:00Z","checkOut":"2032-08-11T18:00:00Z"}]'::jsonb,
    'hours-publication:v1:2222222222222222222222222222222222222222222222222222222222222222'
  )$$,
  '42501',
  'not authorized to publish project hours',
  'authorization is revalidated before a durable receipt replay'
);

RESET ROLE;

SELECT extensions.results_eq(
  $$
    SELECT
      (SELECT count(*) FROM public.hours_publication_receipts
       WHERE project_id::text LIKE 'bd200000-0000-4000-8000-00000000000%'),
      (SELECT count(*) FROM public.certificates
       WHERE project_id::text LIKE 'bd200000-0000-4000-8000-00000000000%'
         AND type = 'verified'),
      (SELECT count(*) FROM public.hours_publication_email_outbox AS outbox
       JOIN public.hours_publication_receipts AS receipt
         ON receipt.id = outbox.receipt_id
       WHERE receipt.project_id::text LIKE 'bd200000-0000-4000-8000-00000000000%')
  $$,
  $$VALUES (3::bigint, 3::bigint, 3::bigint)$$,
  'a denied replay cannot duplicate or alter durable publication work'
);

SELECT * FROM extensions.finish();

ROLLBACK;
