-- Signup rejection is one authenticated, tenant-authorized transaction that also
-- owns the volunteer's notification. All fixtures are synthetic and roll back
-- with this test.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(54);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.reject_project_signup(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated managers can enter the permission-rechecked rejection RPC'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.reject_project_signup(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot reject a signup'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.reject_project_signup(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the reviewed server role can execute the rejection RPC'
);
SELECT extensions.ok(
  (
    SELECT proc.prosecdef
      AND EXISTS (
        SELECT 1
        FROM unnest(coalesce(proc.proconfig, ARRAY[]::text[])) AS config(value)
        WHERE config.value = 'search_path=""'
      )
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'reject_project_signup'
  ),
  'the rejection RPC is SECURITY DEFINER with an empty fixed search_path'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'private.project_signup_rejection_result(uuid,uuid,text,text,text)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'anon',
    'private.project_signup_rejection_result(uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'the outcome envelope helper stays out of reach of client roles'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('af000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'rejection-creator@local.test', now(), '{}', '{}', now(), now()),
  ('af000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'rejection-admin@local.test', now(), '{}', '{}', now(), now()),
  ('af000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'rejection-staff@local.test', now(), '{}', '{}', now(), now()),
  ('af000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'rejection-volunteer@local.test', now(), '{}', '{}', now(), now()),
  ('af000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'rejection-optout@local.test', now(), '{}', '{}', now(), now()),
  ('af000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
   'rejection-outsider@local.test', now(), '{}', '{}', now(), now()),
  ('af000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated',
   'rejection-inactive-admin@local.test', now(), '{}', '{}', now(), now()),
  ('af000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated',
   'rejection-inactive-staff@local.test', now(), '{}', '{}', now(), now()),
  ('af000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated',
   'rejection-statusless-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code, created_by)
VALUES (
  'af100000-0000-4000-8000-000000000001',
  'Rejection Boundary Organization',
  'rejection-boundary-organization',
  'school',
  '740101',
  'af000000-0000-4000-8000-000000000001'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('af100000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('af100000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000003', 'staff', 'active'),
  ('af100000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000007', 'admin', 'inactive'),
  ('af100000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000008', 'staff', 'inactive'),
  -- status is nullable, so the unset case has to be provable rather than
  -- assumed unreachable.
  ('af100000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000009', 'admin', NULL);

-- The opted-out recipient. A missing row means "notify", so only an explicit
-- false may suppress delivery.
INSERT INTO public.notification_settings (user_id, project_updates)
VALUES ('af000000-0000-4000-8000-000000000005', false)
ON CONFLICT (user_id) DO UPDATE SET project_updates = false;

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login,
  organization_id, can_be_managed_by_staff
)
VALUES
  (
    'af200000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'Staff-managed rejection fixture', 'Local', 'Rejection fixture',
    'oneTime', 'manual',
    jsonb_build_object('oneTime', jsonb_build_object(
      'date', to_char(
        (clock_timestamp() AT TIME ZONE 'America/Los_Angeles') + interval '1 day',
        'YYYY-MM-DD'
      ),
      'startTime', '10:00',
      'endTime', '12:00',
      'volunteers', 10
    )),
    true,
    'af100000-0000-4000-8000-000000000001',
    true
  ),
  (
    'af200000-0000-4000-8000-000000000002',
    'af000000-0000-4000-8000-000000000001',
    'Creator-only rejection fixture', 'Local', 'Rejection fixture',
    'oneTime', 'manual',
    jsonb_build_object('oneTime', jsonb_build_object(
      'date', to_char(
        (clock_timestamp() AT TIME ZONE 'America/Los_Angeles') + interval '1 day',
        'YYYY-MM-DD'
      ),
      'startTime', '10:00',
      'endTime', '12:00',
      'volunteers', 10
    )),
    true,
    'af100000-0000-4000-8000-000000000001',
    false
  );

INSERT INTO public.anonymous_signups (id, project_id, email, name, token)
VALUES (
  'af400000-0000-4000-8000-000000000001',
  'af200000-0000-4000-8000-000000000001',
  'rejection-anonymous@local.test',
  'Anonymous Volunteer',
  'af500000-0000-4000-8000-000000000001'
);

INSERT INTO public.project_signups (
  id, project_id, user_id, anonymous_id, schedule_id, status
)
VALUES
  ('af300000-0000-4000-8000-000000000001',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'oneTime', 'pending'),
  ('af300000-0000-4000-8000-000000000002',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000005', NULL, 'optout-slot', 'approved'),
  ('af300000-0000-4000-8000-000000000003',
   'af200000-0000-4000-8000-000000000001',
   NULL, 'af400000-0000-4000-8000-000000000001', 'anonymous-slot', 'pending'),
  ('af300000-0000-4000-8000-000000000005',
   'af200000-0000-4000-8000-000000000002',
   'af000000-0000-4000-8000-000000000004', NULL, 'oneTime', 'pending'),
  ('af300000-0000-4000-8000-000000000007',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'cancelled-slot', 'cancelled'),
  ('af300000-0000-4000-8000-000000000008',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'outage-slot', 'pending'),
  ('af300000-0000-4000-8000-000000000009',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'assertion-slot', 'approved'),
  ('af300000-0000-4000-8000-000000000010',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'direct-update-slot', 'pending'),
  ('af300000-0000-4000-8000-000000000011',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'inactive-approve-slot',
   'pending'),
  ('af300000-0000-4000-8000-000000000012',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'inactive-unreject-slot',
   'rejected'),
  ('af300000-0000-4000-8000-000000000013',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'inactive-cancel-slot',
   'approved'),
  ('af300000-0000-4000-8000-000000000014',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'statusless-approve-slot',
   'pending'),
  ('af300000-0000-4000-8000-000000000015',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'active-approve-slot',
   'pending'),
  ('af300000-0000-4000-8000-000000000016',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'active-unreject-slot',
   'rejected'),
  ('af300000-0000-4000-8000-000000000017',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'active-staff-cancel-slot',
   'approved'),
  ('af300000-0000-4000-8000-000000000018',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'self-cancel-slot', 'pending'),
  ('af300000-0000-4000-8000-000000000019',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'admin-direct-reject-slot',
   'pending');

-- ---------------------------------------------------------------------------
-- The creator's first rejection: transition and notification together
--
-- The behavioural section carries only a session identity. Notification reads
-- are self-scoped by RLS, so asserting on delivery from inside a client role
-- would prove nothing about what was written; the client-role boundary is
-- covered by the ACL assertions above and by the direct-update section below.
-- ---------------------------------------------------------------------------

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000001', true
);

CREATE TEMP TABLE creator_rejection AS
SELECT public.reject_project_signup(
  'af300000-0000-4000-8000-000000000001'
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'outcome' FROM creator_rejection),
  'accepted',
  'the project creator rejects a pending signup'
);
SELECT extensions.is(
  (SELECT result ->> 'notification' FROM creator_rejection),
  'delivered',
  'a registered recipient is notified inside the same transaction'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000001'
  ),
  'rejected',
  'the rejection persists'
);
SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.notifications AS notifications
    WHERE notifications.user_id = 'af000000-0000-4000-8000-000000000004'
      AND notifications.type = 'project_updates'
  ),
  1::bigint,
  'exactly one rejection notification reaches the volunteer'
);
SELECT extensions.is(
  (
    SELECT notifications.body
    FROM public.notifications AS notifications
    WHERE notifications.user_id = 'af000000-0000-4000-8000-000000000004'
  ),
  'Your signup to volunteer for "Staff-managed rejection fixture" has been rejected',
  'the notification body is derived from the locked project, not from the caller'
);
SELECT extensions.is(
  (
    SELECT notifications.data ->> 'signupId'
    FROM public.notifications AS notifications
    WHERE notifications.user_id = 'af000000-0000-4000-8000-000000000004'
  ),
  'af300000-0000-4000-8000-000000000001',
  'the notification addresses the signup the database itself locked'
);

CREATE TEMP TABLE replayed_rejection AS
SELECT public.reject_project_signup(
  'af300000-0000-4000-8000-000000000001'
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'outcome' FROM replayed_rejection),
  'replayed',
  'a retry of a committed rejection is replay-safe'
);
SELECT extensions.is(
  (SELECT result ->> 'notificationReason' FROM replayed_rejection),
  'already_rejected',
  'the replay reports why it sent nothing'
);
SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.notifications AS notifications
    WHERE notifications.user_id = 'af000000-0000-4000-8000-000000000004'
  ),
  1::bigint,
  'a replay does not notify the volunteer twice'
);

-- ---------------------------------------------------------------------------
-- Preference opt-out and anonymous recipients still reject successfully
-- ---------------------------------------------------------------------------

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000002', true
);

CREATE TEMP TABLE optout_rejection AS
SELECT public.reject_project_signup(
  'af300000-0000-4000-8000-000000000002'
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'outcome' FROM optout_rejection),
  'accepted',
  'an organization admin rejects an approved signup'
);
SELECT extensions.is(
  (SELECT result ->> 'notificationReason' FROM optout_rejection),
  'notification_preference_disabled',
  'an opted-out recipient is reported as skipped rather than notified'
);
SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.notifications AS notifications
    WHERE notifications.user_id = 'af000000-0000-4000-8000-000000000005'
  ),
  0::bigint,
  'the project_updates opt-out is honoured'
);

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000003', true
);

CREATE TEMP TABLE anonymous_rejection AS
SELECT public.reject_project_signup(
  'af300000-0000-4000-8000-000000000003'
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'outcome' FROM anonymous_rejection),
  'accepted',
  'organization staff reject a signup while the project allows staff management'
);
SELECT extensions.is(
  (SELECT result ->> 'notificationReason' FROM anonymous_rejection),
  'anonymous_signup',
  'an anonymous signup has no in-app recipient and says so'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000003'
  ),
  'rejected',
  'the anonymous rejection still commits'
);

-- ---------------------------------------------------------------------------
-- Authorization denials
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-000000000005')$$,
  '42501',
  'not authorized to reject this signup',
  'staff cannot reject inside a project that withheld staff management'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000005'
  ),
  'pending',
  'the denied staff rejection left the signup untouched'
);

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000004', true
);

SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-000000000009')$$,
  '42501',
  'not authorized to reject this signup',
  'a volunteer cannot reject their own signup through the manager path'
);

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000006', true
);

SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-000000000009')$$,
  '42501',
  'not authorized to reject this signup',
  'an unrelated user cannot reject somebody else''s signup'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);

SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-000000000009')$$,
  '42501',
  'authentication required',
  'an unauthenticated caller is refused before anything is read'
);

-- ---------------------------------------------------------------------------
-- Source state, unknown signups, and the compatibility assertions
-- ---------------------------------------------------------------------------

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000001', true
);

SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-0000000000ff')$$,
  'P0002',
  'signup not found',
  'an unknown signup is refused without leaking whether it exists elsewhere'
);
SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-000000000007')$$,
  '22023',
  'only a pending or approved signup can be rejected',
  'a cancelled signup is not a legitimate rejection source'
);
SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup(
    'af300000-0000-4000-8000-000000000009',
    'af000000-0000-4000-8000-000000000006'
  )$$,
  '22023',
  'signup does not match the supplied volunteer',
  'a forged recipient cannot be attached to a real signup'
);
SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup(
    'af300000-0000-4000-8000-000000000009',
    'af000000-0000-4000-8000-000000000004',
    'af200000-0000-4000-8000-000000000002'
  )$$,
  '22023',
  'signup does not match the supplied project',
  'a forged project cannot be attached to a real signup'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000009'
  ),
  'approved',
  'the mismatched assertions had no side effect'
);
SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.notifications AS notifications
    WHERE notifications.user_id = 'af000000-0000-4000-8000-000000000006'
  ),
  0::bigint,
  'the forged recipient was never notified'
);
SELECT extensions.is(
  (
    SELECT result ->> 'outcome'
    FROM public.reject_project_signup(
      'af300000-0000-4000-8000-000000000009',
      'af000000-0000-4000-8000-000000000004',
      'af200000-0000-4000-8000-000000000001'
    ) AS result
  ),
  'accepted',
  'identifiers that do match the locked signup proceed'
);

-- ---------------------------------------------------------------------------
-- A failed notification must take the rejection with it
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.fail_rejection_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'synthetic notification outage';
END;
$$;

CREATE TRIGGER fail_rejection_notification
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_rejection_notification();

SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-000000000008')$$,
  'P0001',
  'synthetic notification outage',
  'a failed notification aborts instead of reporting a bare rejection'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000008'
  ),
  'pending',
  'the rejection rolls back with the notification it could not deliver'
);

DROP TRIGGER fail_rejection_notification ON public.notifications;

SELECT extensions.is(
  (
    SELECT result ->> 'notification'
    FROM public.reject_project_signup(
      'af300000-0000-4000-8000-000000000008'
    ) AS result
  ),
  'delivered',
  'once notifications recover the same signup rejects and notifies'
);

-- ---------------------------------------------------------------------------
-- The RPC is the only client path into the rejected state
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET status = 'rejected'
    WHERE id = 'af300000-0000-4000-8000-000000000010'
  $$,
  '42501',
  'signup rejection requires the server-authorized operation',
  'the project creator cannot reject through a direct Data API update'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000010'
  ),
  'pending',
  'the refused direct update changed nothing'
);

RESET ROLE;

-- anon keeps UPDATE on project_signups so an anonymous volunteer can cancel
-- their own signup, so the invariant worth asserting for that role is that no
-- such update can land on 'rejected'.
SET LOCAL ROLE anon;

UPDATE public.project_signups
SET status = 'rejected'
WHERE id = 'af300000-0000-4000-8000-000000000010';

RESET ROLE;

SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000010'
  ),
  'pending',
  'an anonymous client cannot reach the rejected state through a direct update'
);

-- ---------------------------------------------------------------------------
-- The moderation the guard still allows also requires an active membership
--
-- public.project_signups' UPDATE policy admits any admin or flag-enabled staff
-- through app_private.is_project_organizer, which ignores membership status, so
-- these updates do reach the trigger. Each denial below is therefore raised by
-- private.protect_project_signup_client_mutation rather than filtered out by
-- RLS, which is what makes it defence in depth for the Server Action gate.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'app_private.can_moderate_project_signup(uuid,uuid)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'anon',
    'app_private.can_moderate_project_signup(uuid,uuid)',
    'EXECUTE'
  ),
  'the guard predicate is reachable by the client role that runs the guard, and by no other'
);
SELECT extensions.ok(
  (
    SELECT proc.prosecdef
      AND EXISTS (
        SELECT 1
        FROM unnest(coalesce(proc.proconfig, ARRAY[]::text[])) AS config(value)
        WHERE config.value = 'search_path=""'
      )
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'app_private'
      AND proc.proname = 'can_moderate_project_signup'
  ),
  'the guard predicate decides independently of the client role''s own row visibility'
);

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000007', true
);
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'af300000-0000-4000-8000-000000000011'
  $$,
  '42501',
  'participants may only cancel their own signup',
  'a deactivated organization admin cannot approve somebody else''s signup'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET status = 'cancelled'
    WHERE id = 'af300000-0000-4000-8000-000000000013'
  $$,
  '42501',
  'participants may only cancel their own signup',
  'a deactivated organization admin cannot cancel somebody else''s signup'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000011'
  ),
  'pending',
  'the refused approval changed nothing'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000013'
  ),
  'approved',
  'the refused cancellation changed nothing'
);

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000008', true
);
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'af300000-0000-4000-8000-000000000012'
  $$,
  '42501',
  'participants may only cancel their own signup',
  'deactivated staff cannot unreject a signup even where staff management is allowed'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000012'
  ),
  'rejected',
  'the refused unrejection left the rejection standing'
);

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000009', true
);
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'af300000-0000-4000-8000-000000000014'
  $$,
  '42501',
  'participants may only cancel their own signup',
  'an admin membership with no status fails closed instead of being read as active'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000014'
  ),
  'pending',
  'the status-less membership changed nothing'
);

-- ---------------------------------------------------------------------------
-- Active managers keep every moderation they had except rejection
-- ---------------------------------------------------------------------------

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000002', true
);
SET LOCAL ROLE authenticated;

SELECT extensions.lives_ok(
  $$
    UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'af300000-0000-4000-8000-000000000015'
  $$,
  'an active organization admin still approves a pending signup'
);
SELECT extensions.lives_ok(
  $$
    UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'af300000-0000-4000-8000-000000000016'
  $$,
  'an active organization admin still unrejects a signup'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET status = 'rejected'
    WHERE id = 'af300000-0000-4000-8000-000000000019'
  $$,
  '42501',
  'signup rejection requires the server-authorized operation',
  'an active organization admin still cannot reject through a direct update'
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000003', true
);
SET LOCAL ROLE authenticated;

SELECT extensions.lives_ok(
  $$
    UPDATE public.project_signups
    SET status = 'cancelled'
    WHERE id = 'af300000-0000-4000-8000-000000000017'
  $$,
  'active staff still moderate a signup while the project allows staff management'
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000004', true
);
SET LOCAL ROLE authenticated;

SELECT extensions.lives_ok(
  $$
    UPDATE public.project_signups
    SET status = 'cancelled'
    WHERE id = 'af300000-0000-4000-8000-000000000018'
  $$,
  'a participant still cancels their own signup'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT array_agg(signups.status ORDER BY signups.id)
    FROM public.project_signups AS signups
    WHERE signups.id IN (
      'af300000-0000-4000-8000-000000000015',
      'af300000-0000-4000-8000-000000000016',
      'af300000-0000-4000-8000-000000000017',
      'af300000-0000-4000-8000-000000000018',
      'af300000-0000-4000-8000-000000000019'
    )
  ),
  ARRAY['approved', 'approved', 'cancelled', 'cancelled', 'pending'],
  'the allowed moderation persisted and the refused rejection did not'
);

SELECT * FROM extensions.finish();

ROLLBACK;
