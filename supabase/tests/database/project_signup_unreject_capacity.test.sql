BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(24);

SELECT extensions.has_function(
  'public',
  'unreject_project_signup_with_capacity',
  ARRAY['uuid'],
  'the atomic rejected-signup transition exists'
);
SELECT extensions.ok(
  (
    SELECT proc.prosecdef
      AND proc.proconfig = ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'public.unreject_project_signup_with_capacity(uuid)'::regprocedure
  ),
  'the transition is SECURITY DEFINER with an empty search path'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.unreject_project_signup_with_capacity(uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot invoke the organizer transition'
);
SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.unreject_project_signup_with_capacity(uuid)',
    'EXECUTE'
  ),
  'authenticated organizers can invoke the self-authorizing transition'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'public.unreject_project_signup_with_capacity(uuid)',
    'EXECUTE'
  ),
  'the service role cannot substitute a caller identity for unrejection'
);
SELECT extensions.results_eq(
  $$
    SELECT COALESCE(roles.rolname, 'PUBLIC')::text
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        proc.proacl,
        pg_catalog.acldefault('f', proc.proowner)
      )
    ) AS privilege
    LEFT JOIN pg_catalog.pg_roles AS roles ON roles.oid = privilege.grantee
    WHERE proc.oid =
      'public.unreject_project_signup_with_capacity(uuid)'::regprocedure
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> proc.proowner
    ORDER BY 1
  $$,
  $$ VALUES ('authenticated'::text) $$,
  'authenticated is the exact non-owner EXECUTE ACL'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('ec000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'unreject-creator@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unreject-admin@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'unreject-staff@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'unreject-outsider@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'unreject-volunteer-one@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'unreject-volunteer-two@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ec100000-0000-4000-8000-000000000001',
  'Atomic Unreject Organization',
  'atomic-unreject-organization',
  'nonprofit',
  'URJ001'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
)
VALUES
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', 'staff', 'active');

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status,
  can_be_managed_by_staff
)
VALUES (
  'ec200000-0000-4000-8000-000000000001',
  'ec000000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
  'Atomic unreject fixture',
  'Local',
  'Capacity and authorization fixture',
  'oneTime',
  'manual',
  jsonb_build_object(
    'oneTime',
    jsonb_build_object(
      'date', to_char(
        (clock_timestamp() AT TIME ZONE 'America/Los_Angeles') + interval '2 day',
        'YYYY-MM-DD'
      ),
      'startTime', '10:00',
      'endTime', '12:00',
      'volunteers', 1
    )
  ),
  true,
  'upcoming',
  false
);

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status
)
VALUES
  ('ec300000-0000-4000-8000-000000000001', 'ec200000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000005', 'oneTime', 'rejected'),
  ('ec300000-0000-4000-8000-000000000002', 'ec200000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000006', 'oneTime', 'rejected');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{}';

SELECT extensions.results_eq(
  $$
    SELECT transition.outcome, transition.project_id
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000001'
    ) AS transition
  $$,
  $$ VALUES ('refused'::text, NULL::uuid) $$,
  'a missing caller identity is refused without leaking the project'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"ec000000-0000-4000-8000-000000000004","role":"authenticated"}';

SELECT extensions.results_eq(
  $$
    SELECT transition.outcome, transition.project_id
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000001'
    ) AS transition
  $$,
  $$ VALUES ('refused'::text, NULL::uuid) $$,
  'an outsider receives a generic refusal without project disclosure'
);

SELECT extensions.results_eq(
  $$
    SELECT transition.outcome, transition.project_id
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000099'
    ) AS transition
  $$,
  $$ VALUES ('refused'::text, NULL::uuid) $$,
  'a missing signup returns one explicit zero-row refusal'
);

RESET ROLE;
SELECT extensions.is(
  (
    SELECT status FROM public.project_signups
    WHERE id = 'ec300000-0000-4000-8000-000000000001'
  ),
  'rejected',
  'an authorization refusal has no signup side effect'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ec000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.results_eq(
  $$
    SELECT transition.outcome, transition.project_id
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000001'
    ) AS transition
  $$,
  $$
    VALUES (
      'approved'::text,
      'ec200000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  'the project creator receives the exact approved transition row'
);
SELECT extensions.is(
  (
    SELECT status FROM public.project_signups
    WHERE id = 'ec300000-0000-4000-8000-000000000001'
  ),
  'approved',
  'the creator transition persists approved status'
);

RESET ROLE;
UPDATE public.project_signups
SET status = 'rejected'
WHERE id = 'ec300000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ec000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT extensions.is(
  (
    SELECT transition.outcome
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000001'
    ) AS transition
  ),
  'approved',
  'an organization admin can approve regardless of the staff flag'
);

RESET ROLE;
UPDATE public.project_signups
SET status = 'rejected'
WHERE id = 'ec300000-0000-4000-8000-000000000001';
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'ec100000-0000-4000-8000-000000000001'
  AND user_id = 'ec000000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ec000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT extensions.is(
  (
    SELECT transition.outcome
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000001'
    ) AS transition
  ),
  'refused',
  'an inactive organization admin is denied by the database recheck'
);
RESET ROLE;
SELECT extensions.is(
  (
    SELECT status FROM public.project_signups
    WHERE id = 'ec300000-0000-4000-8000-000000000001'
  ),
  'rejected',
  'inactive membership denial leaves the signup unchanged'
);

UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'ec100000-0000-4000-8000-000000000001'
  AND user_id = 'ec000000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ec000000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT extensions.is(
  (
    SELECT transition.outcome
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000001'
    ) AS transition
  ),
  'refused',
  'staff are refused when can_be_managed_by_staff is false'
);

RESET ROLE;
UPDATE public.projects
SET can_be_managed_by_staff = true
WHERE id = 'ec200000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ec000000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT extensions.is(
  (
    SELECT transition.outcome
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000001'
    ) AS transition
  ),
  'approved',
  'staff can approve when the project explicitly enables management'
);

RESET ROLE;
UPDATE public.project_signups
SET schedule_id = 'missing-slot'
WHERE id = 'ec300000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ec000000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT extensions.is(
  (
    SELECT transition.outcome
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000002'
    ) AS transition
  ),
  'invalid_slot',
  'an unresolvable slot is refused without a write'
);
RESET ROLE;
SELECT extensions.is(
  (
    SELECT status FROM public.project_signups
    WHERE id = 'ec300000-0000-4000-8000-000000000002'
  ),
  'rejected',
  'the invalid-slot fault path leaves the signup unchanged'
);

UPDATE public.project_signups
SET schedule_id = 'oneTime'
WHERE id = 'ec300000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ec000000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT extensions.is(
  (
    SELECT transition.outcome
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000002'
    ) AS transition
  ),
  'slot_full',
  'a full slot refuses the next rejected signup'
);
SELECT extensions.is(
  (
    SELECT status FROM public.project_signups
    WHERE id = 'ec300000-0000-4000-8000-000000000002'
  ),
  'rejected',
  'capacity refusal leaves the rejected signup unchanged'
);

SELECT extensions.is(
  (
    SELECT transition.outcome
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000001'
    ) AS transition
  ),
  'invalid_state',
  'an approved signup cannot be rewritten as another approval transition'
);

RESET ROLE;
UPDATE public.project_signups
SET status = 'rejected'
WHERE id = 'ec300000-0000-4000-8000-000000000001';
UPDATE public.projects
SET status = 'cancelled'
WHERE id = 'ec200000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ec000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.is(
  (
    SELECT transition.outcome
    FROM public.unreject_project_signup_with_capacity(
      'ec300000-0000-4000-8000-000000000001'
    ) AS transition
  ),
  'project_closed',
  'a cancelled project cannot regain approved capacity'
);
SELECT extensions.is(
  (
    SELECT status FROM public.project_signups
    WHERE id = 'ec300000-0000-4000-8000-000000000001'
  ),
  'rejected',
  'project closure refusal leaves the signup unchanged'
);

SELECT * FROM extensions.finish();

ROLLBACK;
