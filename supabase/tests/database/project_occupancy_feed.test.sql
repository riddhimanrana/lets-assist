BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(31);

SELECT extensions.ok(has_function_privilege('service_role',
 'public.project_occupancy_for_visible_projects(uuid[],uuid,uuid)', 'EXECUTE'),
 'the service role can request exact project occupancy');
SELECT extensions.ok(NOT has_function_privilege('anon',
 'public.project_occupancy_for_visible_projects(uuid[],uuid,uuid)', 'EXECUTE')
 AND NOT has_function_privilege('authenticated',
 'public.project_occupancy_for_visible_projects(uuid[],uuid,uuid)', 'EXECUTE'),
 'browser roles cannot supply a viewer identity to the aggregate');
SELECT extensions.ok((SELECT NOT prosecdef AND provolatile = 's'
 AND proconfig @> ARRAY['search_path=""']
 FROM pg_proc WHERE oid = 'public.project_occupancy_for_visible_projects(uuid[],uuid,uuid)'::regprocedure),
 'the read-only projection is an invoker with a fixed search path');

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at,
 raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT ('fb000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
 'authenticated', 'authenticated', 'occupancy-' || n || '@local.test', now(), '{}', '{}', now(), now()
FROM generate_series(1, 5) n;
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('fb100000-0000-4000-8000-000000000001', 'Occupancy A', 'occupancy-a', 'school', '839711'),
 ('fb100000-0000-4000-8000-000000000002', 'Occupancy B', 'occupancy-b', 'school', '839712');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'admin', 'active'),
 ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002', 'member', 'active'),
 ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000003', 'staff', 'active'),
 ('fb100000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000004', 'admin', 'active');
INSERT INTO public.projects (id, creator_id, organization_id, title, location, description,
 event_type, verification_method, schedule, require_login, status, visibility, workflow_status)
SELECT ('fb200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
 CASE WHEN n IN (6,7) THEN 'fb000000-0000-4000-8000-000000000004'::uuid
 ELSE 'fb000000-0000-4000-8000-000000000001'::uuid END,
 CASE WHEN n IN (6,7) THEN 'fb100000-0000-4000-8000-000000000002'::uuid
 WHEN n = 8 THEN NULL ELSE 'fb100000-0000-4000-8000-000000000001'::uuid END,
 'Occupancy fixture', 'Local', 'Synthetic', 'oneTime', 'manual',
 '{"oneTime":{"date":"2030-10-10","startTime":"10:00","endTime":"12:00","volunteers":2000}}',
 true, 'upcoming', visibility, workflow_status
FROM (VALUES (1, 'public', 'published'), (2, 'unlisted', 'published'),
 (3, 'organization_only', 'published'), (4, 'public', 'draft'), (5, 'public', NULL),
 (6, 'organization_only', 'published'), (7, 'public', 'published'), (8, 'public', 'published'))
 fixture(n, visibility, workflow_status);

-- More active rows than the default PostgREST row cap. Every row occupies a
-- slot, including a legacy empty schedule ID. Inactive rows occupy none.
INSERT INTO public.project_signups (project_id, user_id, schedule_id, status)
SELECT 'fb200000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002',
 CASE WHEN n <= 1100 THEN 'first' WHEN n <= 1200 THEN 'second' ELSE '' END,
 CASE WHEN n % 3 = 0 THEN 'pending' WHEN n % 3 = 1 THEN 'approved' ELSE 'attended' END
FROM generate_series(1,1205) n;
INSERT INTO public.project_signups (project_id, user_id, schedule_id, status)
SELECT 'fb200000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002',
 'first', CASE WHEN n % 2 = 0 THEN 'rejected' ELSE 'cancelled' END
FROM generate_series(1,30) n;

SET LOCAL ROLE service_role;
SELECT extensions.is((SELECT slots_filled FROM public.project_occupancy_for_visible_projects(
 ARRAY['fb200000-0000-4000-8000-000000000001']::uuid[])), 1205::bigint,
 'the total remains exact above the Data API row cap and excludes inactive statuses');
SELECT extensions.is((SELECT slots_filled_by_schedule FROM public.project_occupancy_for_visible_projects(
 ARRAY['fb200000-0000-4000-8000-000000000001']::uuid[])), '{"first":1100,"second":100}'::jsonb,
 'per-schedule counts are exact while an empty schedule contributes only to the total');
SELECT extensions.is((SELECT slots_filled FROM public.project_occupancy_for_visible_projects(
 ARRAY['fb200000-0000-4000-8000-000000000008']::uuid[])), 0::bigint,
 'a readable empty project returns zero');
SELECT extensions.is((SELECT slots_filled_by_schedule FROM public.project_occupancy_for_visible_projects(
 ARRAY['fb200000-0000-4000-8000-000000000008']::uuid[])), '{}'::jsonb,
 'a readable empty project returns an empty schedule map');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 ARRAY['fb200000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001']::uuid[])),
 1::bigint, 'duplicate IDs do not duplicate occupancy');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects('{}'::uuid[])),
 0::bigint, 'an empty page returns no rows');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 ARRAY['fb200000-0000-4000-8000-000000000099']::uuid[])), 0::bigint,
 'a nonexistent project returns no row');
SELECT extensions.throws_ok($$SELECT * FROM public.project_occupancy_for_visible_projects(NULL)$$,
 '22023', NULL, 'a null ID array is refused');
SELECT extensions.throws_ok($$SELECT * FROM public.project_occupancy_for_visible_projects(ARRAY[NULL]::uuid[])$$,
 '22023', NULL, 'a null ID element is refused');
SELECT extensions.throws_ok($$SELECT * FROM public.project_occupancy_for_visible_projects(
 array_fill('fb200000-0000-4000-8000-000000000001'::uuid, ARRAY[101]))$$,
 '22023', NULL, 'more than 100 input IDs are refused');
SELECT extensions.throws_ok($$SELECT * FROM public.project_occupancy_for_visible_projects(
 array_fill('fb200000-0000-4000-8000-000000000001'::uuid, ARRAY[2,2]))$$,
 '22023', NULL, 'multidimensional input is refused');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 array_fill('fb200000-0000-4000-8000-000000000001'::uuid, ARRAY[100]))), 1::bigint,
 'the maximum bounded request is accepted');
RESET ROLE;

CREATE TEMP TABLE occupancy_page AS
SELECT array_agg(id ORDER BY id) AS ids FROM public.projects WHERE id::text LIKE 'fb200000-%';
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects((SELECT ids FROM occupancy_page))),
 4::bigint, 'public discovery omits unlisted, private, and draft projects');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 (SELECT ids FROM occupancy_page), 'fb000000-0000-4000-8000-000000000001')),
 4::bigint, 'a viewer does not broaden public discovery');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 (SELECT ids FROM occupancy_page), NULL, 'fb100000-0000-4000-8000-000000000001')),
 3::bigint, 'anonymous organization discovery includes published public and unlisted projects only');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 (SELECT ids FROM occupancy_page), 'fb000000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001')),
 3::bigint, 'ordinary membership does not confer project staff visibility');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 (SELECT ids FROM occupancy_page), 'fb000000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001')),
 5::bigint, 'the creator can read their organization projects including drafts');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 (SELECT ids FROM occupancy_page), 'fb000000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000001')),
 5::bigint, 'organization staff see projects allowed by the current SELECT policy');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 (SELECT ids FROM occupancy_page), 'fb000000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000002')),
 1::bigint, 'staff authority does not cross organizations');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 (SELECT ids FROM occupancy_page), 'fb000000-0000-4000-8000-000000000005', 'fb100000-0000-4000-8000-000000000001')),
 3::bigint, 'an unrelated viewer receives no private or draft counts');
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 ARRAY['fb200000-0000-4000-8000-000000000001']::uuid[], 'fb000000-0000-4000-8000-000000000001',
 'fb100000-0000-4000-8000-000000000002')), 0::bigint,
 'the requested organization fences even a project creator');

-- Compare the projection against real RLS rather than only repeated literals.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'fb000000-0000-4000-8000-000000000003', true);
SELECT set_config('test.occupancy_staff_visible', (SELECT jsonb_agg(id ORDER BY id)::text
 FROM public.projects WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'), true);
SELECT extensions.throws_ok($$SELECT * FROM public.project_occupancy_for_visible_projects('{}'::uuid[],
 'fb000000-0000-4000-8000-000000000001')$$, '42501', NULL,
 'a browser cannot invoke the aggregate with a forged creator identity');
RESET ROLE;
SELECT extensions.is((SELECT jsonb_agg(project_id ORDER BY project_id)::text
 FROM public.project_occupancy_for_visible_projects((SELECT ids FROM occupancy_page),
 'fb000000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000001')),
 current_setting('test.occupancy_staff_visible'), 'staff projection agrees with the actual project RLS policy');
SET LOCAL ROLE anon;
SELECT set_config('test.occupancy_anon_visible', (SELECT jsonb_agg(id ORDER BY id)::text
 FROM public.projects WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'), true);
SELECT extensions.throws_ok($$SELECT * FROM public.project_occupancy_for_visible_projects('{}'::uuid[])$$,
 '42501', NULL, 'an anonymous browser cannot invoke the service projection');
RESET ROLE;
SELECT extensions.is((SELECT jsonb_agg(project_id ORDER BY project_id)::text
 FROM public.project_occupancy_for_visible_projects((SELECT ids FROM occupancy_page), NULL,
 'fb100000-0000-4000-8000-000000000001')), current_setting('test.occupancy_anon_visible'),
 'anonymous organization projection agrees with the actual project RLS policy');

DELETE FROM public.organization_members WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
 AND user_id = 'fb000000-0000-4000-8000-000000000003';
SELECT extensions.is((SELECT count(*) FROM public.project_occupancy_for_visible_projects(
 (SELECT ids FROM occupancy_page), 'fb000000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000001')),
 3::bigint, 'removed staff authority is rechecked on every aggregate request');
SELECT extensions.is((SELECT count(*) FROM public.project_signups
 WHERE project_id = 'fb200000-0000-4000-8000-000000000001'), 1235::bigint,
 'the projection does not mutate signup rows');
SELECT extensions.is((SELECT count(*) FROM jsonb_object_keys((SELECT to_jsonb(result)
 FROM public.project_occupancy_for_visible_projects(ARRAY['fb200000-0000-4000-8000-000000000001']::uuid[]) result))),
 3::bigint, 'the projection returns only project ID and aggregate fields');
SELECT * FROM extensions.finish();
ROLLBACK;
