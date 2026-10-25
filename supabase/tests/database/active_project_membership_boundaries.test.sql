-- Only an active organization membership confers project insert or read
-- authority. Creators and published public/unlisted readers keep their access.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(53);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  ('a7000000-0000-4000-8000-0000000000' || fixture.suffix)::uuid,
  'authenticated', 'authenticated',
  'membership-boundary-' || fixture.label || '@local.test', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
FROM (VALUES
  ('01', 'creator-admin'),
  ('02', 'active-admin'),
  ('03', 'active-staff'),
  ('04', 'active-member'),
  ('05', 'inactive-admin'),
  ('06', 'suspended-staff'),
  ('07', 'pending-staff'),
  ('08', 'cross-org-admin'),
  ('09', 'independent'),
  ('10', 'trusted'),
  ('11', 'rate-limited'),
  ('12', 'aged-history'),
  ('13', 'inactive-creator'),
  ('14', 'null-status-admin')
) AS fixture(suffix, label);

-- Trust is granted through the applicant insert and the service-role approval,
-- the same path the application uses.
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000010","role":"authenticated"}';
SET LOCAL ROLE authenticated;
INSERT INTO public.trusted_member (user_id, status, name, email, reason)
VALUES (
  'a7000000-0000-4000-8000-000000000010', NULL, 'Membership Boundary Trusted',
  'membership-boundary-trusted@local.test', 'Fixture for public visibility'
);
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.trusted_member
SET status = true
WHERE user_id = 'a7000000-0000-4000-8000-000000000010';
RESET ROLE;

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('a7100000-0000-4000-8000-000000000001', 'Membership Boundary Home',
   'membership-boundary-home', 'nonprofit', '786001'),
  ('a7100000-0000-4000-8000-000000000002', 'Membership Boundary Other',
   'membership-boundary-other', 'nonprofit', '786002');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('a7100000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('a7100000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('a7100000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000003', 'staff', 'active'),
  ('a7100000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000004', 'member', 'active'),
  ('a7100000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000005', 'admin', 'inactive'),
  ('a7100000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000006', 'staff', 'suspended'),
  ('a7100000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000007', 'staff', 'pending'),
  ('a7100000-0000-4000-8000-000000000002',
   'a7000000-0000-4000-8000-000000000008', 'admin', 'active'),
  ('a7100000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000013', 'staff', 'inactive'),
  ('a7100000-0000-4000-8000-000000000001',
   'a7000000-0000-4000-8000-000000000014', 'admin', NULL);

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status, visibility,
  workflow_status, can_be_managed_by_staff
)
SELECT
  ('a7200000-0000-4000-8000-0000000000' || fixture.suffix)::uuid,
  ('a7000000-0000-4000-8000-0000000000' || fixture.creator)::uuid,
  fixture.organization_id::uuid,
  'Membership boundary ' || fixture.suffix, 'Local', 'Synthetic', 'oneTime',
  'manual',
  '{"oneTime":{"date":"2031-09-10","startTime":"10:00","endTime":"12:00","volunteers":10}}'::jsonb,
  true, 'upcoming', fixture.visibility, fixture.workflow_status,
  fixture.staff_managed
FROM (VALUES
  ('01', '01', 'a7100000-0000-4000-8000-000000000001', 'organization_only', 'published', false),
  ('02', '01', 'a7100000-0000-4000-8000-000000000001', 'organization_only', 'draft', true),
  ('03', '01', 'a7100000-0000-4000-8000-000000000001', 'organization_only', 'draft', false),
  ('04', '01', 'a7100000-0000-4000-8000-000000000001', 'public', 'published', false),
  ('05', '09', NULL, 'unlisted', 'published', false),
  ('06', '09', NULL, 'unlisted', 'draft', false),
  ('07', '13', 'a7100000-0000-4000-8000-000000000001', 'organization_only', 'draft', false),
  -- Legacy rows with no workflow status read as published.
  ('08', '01', 'a7100000-0000-4000-8000-000000000001', 'organization_only', NULL, false),
  ('09', '09', NULL, 'unlisted', NULL, false)
) AS fixture(
  suffix, creator, organization_id, visibility, workflow_status, staff_managed
);

-- Fifty projects inside the window exhaust the limit; fifty older ones do not.
INSERT INTO public.projects (
  creator_id, title, location, description, event_type, verification_method,
  schedule, require_login, status, visibility, workflow_status, created_at
)
SELECT
  history.creator_id::uuid,
  'Membership boundary history ' || series.n, 'Local', 'Synthetic', 'oneTime',
  'manual',
  '{"oneTime":{"date":"2031-09-11","startTime":"10:00","endTime":"12:00","volunteers":10}}'::jsonb,
  true, 'upcoming', 'unlisted', 'draft', now() - history.age
FROM (VALUES
  ('a7000000-0000-4000-8000-000000000011', interval '1 hour'),
  ('a7000000-0000-4000-8000-000000000012', interval '25 hours')
) AS history(creator_id, age)
CROSS JOIN generate_series(1, 50) AS series(n);

SELECT extensions.ok(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'app_private.can_insert_project(uuid,text,uuid)'::regprocedure),
  'the insert eligibility implementation stays SECURITY DEFINER'
);
SELECT extensions.is(
  (SELECT proconfig FROM pg_proc
   WHERE oid = 'app_private.can_insert_project(uuid,text,uuid)'::regprocedure),
  ARRAY['search_path=""'],
  'the insert eligibility implementation pins an empty search_path'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
    WHERE p.oid = 'app_private.can_insert_project(uuid,text,uuid)'::regprocedure
      AND acl.grantee = 0
  ),
  'PUBLIC holds no execute grant on the insert eligibility implementation'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon', 'app_private.can_insert_project(uuid,text,uuid)', 'EXECUTE'
  ),
  'anon cannot execute the insert eligibility implementation'
);
SELECT extensions.ok(
  has_function_privilege(
    'authenticated', 'app_private.can_insert_project(uuid,text,uuid)', 'EXECUTE'
  ),
  'authenticated keeps the execute grant its insert policy needs'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role', 'app_private.can_insert_project(uuid,text,uuid)', 'EXECUTE'
  ),
  'service_role keeps its reviewed execute grant'
);
SELECT extensions.ok(
  (SELECT pg_get_expr(polwithcheck, polrelid)
   FROM pg_policy
   WHERE polrelid = 'public.projects'::regclass
     AND polname = 'projects insert consolidated')
    LIKE '%app_private.can_insert_project(%',
  'the insert policy still calls the private eligibility implementation'
);
SELECT extensions.is(
  (SELECT polroles::regrole[]::text[]
   FROM pg_policy
   WHERE polrelid = 'public.projects'::regclass
     AND polname = 'projects_select_authenticated'
     AND polcmd = 'r'),
  ARRAY['authenticated'],
  'the replaced read policy applies to authenticated readers only'
);

SELECT extensions.is(
  app_private.can_insert_project(NULL, 'unlisted', NULL),
  false, 'a null actor is never eligible'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000002', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  true, 'an active admin is eligible for their organization'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000003', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  true, 'active staff are eligible for their organization'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000004', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  false, 'an active plain member is not eligible'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000005', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  false, 'an inactive admin is not eligible'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000006', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  false, 'suspended staff are not eligible'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000007', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  false, 'pending staff are not eligible'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000014', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  false, 'an admin row with no status is not eligible'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000008', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  false, 'an active admin of another organization is not eligible'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000011', 'unlisted', NULL),
  false, 'fifty projects in the last 24 hours exhaust the limit'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000012', 'unlisted', NULL),
  true, 'projects older than 24 hours do not count toward the limit'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000009', 'public', NULL),
  false, 'public visibility still requires trusted status'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000009', NULL, NULL),
  false, 'a missing visibility is still treated as public'
);
SELECT extensions.is(
  app_private.can_insert_project(
    'a7000000-0000-4000-8000-000000000010', 'public', NULL),
  true, 'a trusted member remains eligible for public visibility'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000005","role":"authenticated"}';
SELECT extensions.is(
  public.can_insert_project(
    'a7000000-0000-4000-8000-000000000005', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  false, 'the public wrapper refuses an inactive admin'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT extensions.is(
  public.can_insert_project(
    'a7000000-0000-4000-8000-000000000003', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  false, 'the public wrapper stays bound to the calling actor'
);
SELECT extensions.is(
  public.can_insert_project(
    'a7000000-0000-4000-8000-000000000002', 'unlisted',
    'a7100000-0000-4000-8000-000000000001'),
  true, 'the public wrapper still accepts an active admin for themselves'
);

-- Each reader is compared with the exact set of fixture projects they may read.
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['01', '02', '03', '04', '05', '07', '08', '09'],
  'an active admin reads every project of their organization'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['01', '02', '03', '04', '05', '07', '08', '09'],
  'a creator who is an active admin reads their own and the organization projects'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['01', '02', '04', '05', '08', '09'],
  'active staff read an unpublished project only when staff may manage it'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['01', '04', '05', '08', '09'],
  'an active member reads published organization-only projects and no drafts'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000005","role":"authenticated"}';
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['04', '05', '09'],
  'an inactive admin reads only what any signed-in reader can'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000006","role":"authenticated"}';
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['04', '05', '09'],
  'suspended staff read only what any signed-in reader can'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000007","role":"authenticated"}';
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['04', '05', '09'],
  'pending staff read only published public and unlisted projects'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000014","role":"authenticated"}';
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['04', '05', '09'],
  'an admin row with no status reads only what any signed-in reader can'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000008","role":"authenticated"}';
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['04', '05', '09'],
  'an active admin of another organization gains no cross-organization read'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000009","role":"authenticated"}';
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['04', '05', '06', '09'],
  'an independent creator still reads their own unpublished project'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000013","role":"authenticated"}';
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['04', '05', '07', '09'],
  'a creator whose membership lapsed keeps their own project and nothing else'
);

RESET ROLE;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;
SELECT extensions.is(
  coalesce(
    (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.projects
     WHERE id::text LIKE 'a7200000-%'), ARRAY[]::text[]),
  ARRAY['04', '05', '09'],
  'anonymous readers keep published public and unlisted visibility'
);
RESET ROLE;

-- Direct browser-role inserts reach the same boundary through RLS.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT extensions.lives_ok(
  $$INSERT INTO public.projects (
      creator_id, organization_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000002',
      'a7100000-0000-4000-8000-000000000001',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  'an active admin inserts an organization project directly'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT extensions.lives_ok(
  $$INSERT INTO public.projects (
      creator_id, organization_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000003',
      'a7100000-0000-4000-8000-000000000001',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  'active staff insert an organization project directly'
);

SELECT extensions.throws_ok(
  format(
    $query$INSERT INTO public.projects (
      creator_id, organization_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      %L, %L, 'Membership boundary insert', 'Local', 'Synthetic', 'oneTime',
      'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$query$,
    'a7000000-0000-4000-8000-000000000002',
    'a7100000-0000-4000-8000-000000000001'
  ),
  '42501', NULL,
  'a caller cannot insert a project as another creator'
);

SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      creator_id, organization_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000004',
      'a7100000-0000-4000-8000-000000000001',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  '42501', NULL,
  'an active plain member cannot insert an organization project'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000005","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      creator_id, organization_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000005',
      'a7100000-0000-4000-8000-000000000001',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  '42501', NULL,
  'an inactive admin cannot insert an organization project'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000006","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      creator_id, organization_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000006',
      'a7100000-0000-4000-8000-000000000001',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  '42501', NULL,
  'suspended staff cannot insert an organization project'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000007","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      creator_id, organization_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000007',
      'a7100000-0000-4000-8000-000000000001',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  '42501', NULL,
  'pending staff cannot insert an organization project'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000014","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      creator_id, organization_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000014',
      'a7100000-0000-4000-8000-000000000001',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  '42501', NULL,
  'an admin row with no status cannot insert an organization project'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000008","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      creator_id, organization_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000008',
      'a7100000-0000-4000-8000-000000000001',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  '42501', NULL,
  'an active admin of another organization cannot insert across organizations'
);
SELECT extensions.lives_ok(
  $$INSERT INTO public.projects (
      creator_id, organization_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000008',
      'a7100000-0000-4000-8000-000000000002',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  'that admin still inserts into their own organization'
);

SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000009","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000009',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'public', 'America/Los_Angeles'
    )$$,
  '42501', NULL,
  'an untrusted creator cannot insert a public project'
);
SELECT extensions.lives_ok(
  $$INSERT INTO public.projects (
      creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000009',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  'an independent creator still inserts an unlisted project'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000010","role":"authenticated"}';
SELECT extensions.lives_ok(
  $$INSERT INTO public.projects (
      creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000010',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'public', 'America/Los_Angeles'
    )$$,
  'a trusted member still inserts a public project'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000011","role":"authenticated"}';
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000011',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  '42501', NULL,
  'a creator at the 24-hour limit cannot insert another project'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000012","role":"authenticated"}';
SELECT extensions.lives_ok(
  $$INSERT INTO public.projects (
      creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, visibility, project_timezone
    ) VALUES (
      'a7000000-0000-4000-8000-000000000012',
      'Membership boundary insert', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-09-12","startTime":"10:00","endTime":"12:00","volunteers":5}}'::jsonb,
      true, 'unlisted', 'America/Los_Angeles'
    )$$,
  'a creator whose history is older than 24 hours inserts normally'
);

RESET ROLE;
SELECT extensions.is(
  (SELECT array_agg(right(creator_id::text, 2) ORDER BY creator_id)
   FROM public.projects
   WHERE title = 'Membership boundary insert'
     AND organization_id = 'a7100000-0000-4000-8000-000000000001'),
  ARRAY['02', '03'],
  'only the active admin and active staff inserts reached the organization'
);

SELECT * FROM extensions.finish();

ROLLBACK;
