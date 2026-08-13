-- Signup rejection is one authenticated, tenant-authorized transaction that also
-- owns the volunteer's notification. All fixtures are synthetic and roll back
-- with this test.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(56);

SELECT extensions.has_function(
  'public',
  'reject_project_signup',
  ARRAY['uuid'],
  'the client-callable rejection boundary exposes only the signup identifier'
);
SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.reject_project_signup(uuid)',
    'EXECUTE'
  ),
  'authenticated managers can enter the permission-rechecked rejection RPC'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.reject_project_signup(uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot reject a signup'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'public.reject_project_signup(uuid)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'service_role',
    'private.reject_project_signup(uuid)',
    'EXECUTE'
  ),
  'rejection is a client-session operation, so service_role is not an executor'
);
SELECT extensions.results_eq(
  $$
    SELECT COALESCE(roles.rolname, 'PUBLIC')::text COLLATE "C"
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        proc.proacl,
        pg_catalog.acldefault('f', proc.proowner)
      )
    ) AS privilege
    LEFT JOIN pg_catalog.pg_roles AS roles ON roles.oid = privilege.grantee
    WHERE proc.oid = 'public.reject_project_signup(uuid)'::regprocedure
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> proc.proowner
    ORDER BY 1
  $$,
  $$ VALUES ('authenticated'::text COLLATE "C") $$,
  'authenticated is the exact non-owner executor of the public wrapper'
);
SELECT extensions.ok(
  (
    SELECT NOT proc.prosecdef
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
  'the exposed rejection RPC is a SECURITY INVOKER wrapper with a fixed search_path'
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
    WHERE namespace.nspname = 'private'
      AND proc.proname = 'reject_project_signup'
  ),
  'the privileged transaction is SECURITY DEFINER, in private, with an empty fixed search_path'
);
SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'private.reject_project_signup(uuid)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'anon',
    'private.reject_project_signup(uuid)',
    'EXECUTE'
  ),
  'only the client role the wrapper runs as reaches the private transaction'
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
   'rejection-statusless-admin@local.test', now(), '{}', '{}', now(), now()),
  ('af000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated',
   'rejection-super-admin@local.test', now(),
   '{"is_super_admin":true}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code, created_by)
VALUES
  (
    'af100000-0000-4000-8000-000000000001',
    'Rejection Boundary Organization',
    'rejection-boundary-organization',
    'school',
    '740101',
    'af000000-0000-4000-8000-000000000001'
  ),
  (
    'af100000-0000-4000-8000-000000000002',
    'Cross Tenant Rejection Organization',
    'rejection-boundary-two',
    'nonprofit',
    '740102',
    'af000000-0000-4000-8000-000000000006'
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
  ),
  (
    'af200000-0000-4000-8000-000000000003',
    'af000000-0000-4000-8000-000000000006',
    'Cross-tenant rejection fixture', 'Local', 'Rejection fixture',
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
    'af100000-0000-4000-8000-000000000002',
    true
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
   'af000000-0000-4000-8000-000000000004', NULL, 'inactive-admin-slot',
   'pending'),
  ('af300000-0000-4000-8000-000000000013',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'inactive-staff-slot',
   'approved'),
  ('af300000-0000-4000-8000-000000000014',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'statusless-admin-slot',
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
   'pending'),
  ('af300000-0000-4000-8000-000000000020',
   'af200000-0000-4000-8000-000000000003',
   'af000000-0000-4000-8000-000000000004', NULL, 'cross-tenant-slot',
   'pending'),
  ('af300000-0000-4000-8000-000000000021',
   'af200000-0000-4000-8000-000000000001',
   'af000000-0000-4000-8000-000000000004', NULL, 'super-admin-slot',
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
-- Source state, unknown signups, and cross-tenant identifiers
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
SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000002', true
);

SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-000000000020')$$,
  '42501',
  'not authorized to reject this signup',
  'an admin cannot forge a signup identifier from another tenant'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000020'
  ),
  'pending',
  'the cross-tenant rejection attempt has no side effect'
);
SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.notifications AS notifications
    WHERE notifications.data ->> 'signupId' =
      'af300000-0000-4000-8000-000000000020'
  ),
  0::bigint,
  'the cross-tenant rejection attempt cannot address a notification'
);

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000001', true
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

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.project_signups', 'UPDATE'),
  'an anonymous client has no signup UPDATE privilege to reach the rejected state with'
);

-- ---------------------------------------------------------------------------
-- A membership that is no longer active cannot reject
--
-- The rejection transaction re-derives this under the project lock rather than
-- trusting app_private.can_manage_project, so it needs its own proof.
-- ---------------------------------------------------------------------------

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000007', true
);

SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-000000000011')$$,
  '42501',
  'not authorized to reject this signup',
  'a deactivated organization admin cannot reject a signup'
);

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000008', true
);

SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-000000000013')$$,
  '42501',
  'not authorized to reject this signup',
  'deactivated staff cannot reject even where staff management is allowed'
);

-- status is nullable, so the unset case has to be provable rather than assumed
-- unreachable: it must fail closed instead of being read as active.
SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000009', true
);

SELECT extensions.throws_ok(
  $$SELECT public.reject_project_signup('af300000-0000-4000-8000-000000000014')$$,
  '42501',
  'not authorized to reject this signup',
  'an admin membership with no status fails closed instead of being read as active'
);

SELECT extensions.is(
  (
    SELECT array_agg(signups.status ORDER BY signups.id)
    FROM public.project_signups AS signups
    WHERE signups.id IN (
      'af300000-0000-4000-8000-000000000011',
      'af300000-0000-4000-8000-000000000013',
      'af300000-0000-4000-8000-000000000014'
    )
  ),
  ARRAY['pending', 'approved', 'pending'],
  'no refused rejection changed a signup'
);

-- The organization-members UPDATE policy delegates to private organization
-- helpers. Those helpers must not let a deactivated actor use their own stale
-- role to reactivate the row that restores moderation authority.
SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000007', true
);
SET LOCAL ROLE authenticated;

SELECT extensions.results_eq(
  $$
    UPDATE public.organization_members
    SET status = 'active'
    WHERE organization_id = 'af100000-0000-4000-8000-000000000001'
      AND user_id = 'af000000-0000-4000-8000-000000000007'
    RETURNING status::text
  $$,
  $$ SELECT NULL::text WHERE false $$,
  'an inactive admin cannot self-reactivate through status-blind helpers'
);

RESET ROLE;
SELECT extensions.is(
  (
    SELECT members.status
    FROM public.organization_members AS members
    WHERE members.organization_id = 'af100000-0000-4000-8000-000000000001'
      AND members.user_id = 'af000000-0000-4000-8000-000000000007'
  ),
  'inactive',
  'the denied self-reactivation leaves inactive membership unchanged'
);

SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000009', true
);
SET LOCAL ROLE authenticated;

SELECT extensions.results_eq(
  $$
    UPDATE public.organization_members
    SET status = 'active'
    WHERE organization_id = 'af100000-0000-4000-8000-000000000001'
      AND user_id = 'af000000-0000-4000-8000-000000000009'
    RETURNING status::text
  $$,
  $$ SELECT NULL::text WHERE false $$,
  'a NULL-status admin cannot self-activate through status-blind helpers'
);

RESET ROLE;
SELECT extensions.ok(
  (
    SELECT members.status IS NULL
    FROM public.organization_members AS members
    WHERE members.organization_id = 'af100000-0000-4000-8000-000000000001'
      AND members.user_id = 'af000000-0000-4000-8000-000000000009'
  ),
  'the denied self-activation leaves NULL membership status unchanged'
);

-- Super administrators retain their pre-existing moderation authority through
-- the only path that may now enter rejected. The uppercase UUID spelling also
-- proves the direct RPC returns PostgreSQL's lowercase canonical UUID.
SELECT set_config(
  'request.jwt.claim.sub', 'af000000-0000-4000-8000-000000000010', true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"af000000-0000-4000-8000-000000000010","role":"authenticated","app_metadata":{"is_super_admin":true}}',
  true
);

CREATE TEMP TABLE super_admin_rejection AS
SELECT public.reject_project_signup(
  'AF300000-0000-4000-8000-000000000021'::uuid
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'outcome' FROM super_admin_rejection),
  'accepted',
  'a super admin rejects without project ownership or organization membership'
);
SELECT extensions.is(
  (SELECT result ->> 'signupId' FROM super_admin_rejection),
  'af300000-0000-4000-8000-000000000021',
  'the direct RPC canonicalizes uppercase UUID input in its committed result'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'af300000-0000-4000-8000-000000000021'
  ),
  'rejected',
  'the super-admin rejection commits'
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
