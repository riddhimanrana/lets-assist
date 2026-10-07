-- Public project visibility never grants access to staff review columns.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(57);

SELECT extensions.ok((SELECT relrowsecurity FROM pg_class
  WHERE oid = 'public.projects'::regclass), 'project row security stays enabled');
SELECT extensions.results_eq(
  $$SELECT role_name, columns FROM app_private.client_relation_grant_catalog()
    WHERE relation_name = 'projects' AND privilege = 'SELECT' ORDER BY role_name$$,
  $$SELECT role_name, ARRAY(SELECT attname::text FROM pg_attribute
      WHERE attrelid = 'public.projects'::regclass AND attnum > 0 AND NOT attisdropped
        AND attname NOT IN ('review_notes', 'reviewed_by', 'reviewed_at') ORDER BY attname)
    FROM (VALUES ('anon'::text), ('authenticated'::text)) client(role_name) ORDER BY role_name$$,
  'both browser roles receive every existing project column except the three review fields');

SELECT extensions.ok(NOT has_table_privilege(role_name, 'public.projects', 'SELECT'),
  role_name || ' has no whole-table project read grant')
FROM (VALUES ('anon'), ('authenticated')) client(role_name);
SELECT extensions.ok(NOT has_column_privilege(role_name, 'public.projects', column_name, 'SELECT'),
  role_name || ' has no effective read grant for ' || column_name)
FROM (VALUES ('anon'), ('authenticated')) client(role_name)
CROSS JOIN unnest(ARRAY['review_notes', 'reviewed_by', 'reviewed_at']) field(column_name);
SELECT extensions.is((SELECT count(*) FROM pg_attribute a
  CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE a.attrelid = 'public.projects'::regclass
    AND a.attname IN ('review_notes', 'reviewed_by', 'reviewed_at')
    AND acl.privilege_type = 'SELECT'
    AND (acl.grantee = 0 OR acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))),
  0::bigint, 'no independent PUBLIC or browser column read ACL remains');
SELECT extensions.ok((SELECT bool_and(has_table_privilege('service_role', 'public.projects', privilege))
  FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege), 'service project CRUD remains available');
SELECT extensions.ok((SELECT bool_and(has_table_privilege('authenticated', 'public.projects', privilege))
  FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) privilege), 'authenticated project write grants are unchanged');
SELECT extensions.ok(NOT has_table_privilege(role_name, 'public.projects_with_creator', 'SELECT'),
  role_name || ' cannot read the legacy full-project view')
FROM (VALUES ('anon'), ('authenticated')) client(role_name);
SELECT extensions.ok(NOT has_any_column_privilege(role_name, 'public.projects_with_creator', 'SELECT'),
  role_name || ' has no residual legacy-view column grant')
FROM (VALUES ('anon'), ('authenticated')) client(role_name);
SELECT extensions.is((SELECT count(*) FROM app_private.client_relation_grant_catalog()
  WHERE relation_name = 'projects_with_creator'), 0::bigint, 'legacy view is absent from the browser grant catalog');
SELECT extensions.is((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prorettype IN ('public.projects'::regtype, 'public.projects[]'::regtype)
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0::bigint, 'no browser RPC returns a project composite or project array');
SELECT extensions.is((SELECT count(*) FROM pg_attribute
  WHERE attrelid = 'public.project_discovery_read_model'::regclass
    AND attname IN ('review_notes', 'reviewed_by', 'reviewed_at') AND NOT attisdropped),
  0::bigint, 'the public discovery projection has no review columns');
SELECT extensions.is((SELECT count(DISTINCT view_relation.oid)
  FROM pg_class view_relation
  JOIN pg_rewrite rewrite ON rewrite.ev_class = view_relation.oid
  JOIN pg_depend dependency ON dependency.classid = 'pg_rewrite'::regclass AND dependency.objid = rewrite.oid
  JOIN pg_attribute field ON field.attrelid = dependency.refobjid AND field.attnum = dependency.refobjsubid
  WHERE view_relation.relkind IN ('v', 'm') AND field.attrelid = 'public.projects'::regclass
    AND field.attname IN ('review_notes', 'reviewed_by', 'reviewed_at')
    AND (has_any_column_privilege('anon', view_relation.oid, 'SELECT')
      OR has_any_column_privilege('authenticated', view_relation.oid, 'SELECT'))),
  0::bigint, 'no browser-readable view depends on the project review columns');

INSERT INTO auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('db702000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'project-columns-owner@local.test', now(), '{}', '{}', now(), now()),
       ('db702000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'project-columns-other@local.test', now(), '{}', '{}', now(), now());
INSERT INTO public.projects(id, creator_id, title, location, description, event_type, verification_method,
  schedule, status, visibility, workflow_status, review_notes, reviewed_by, reviewed_at)
SELECT fixture.id::uuid, 'db702000-0000-4000-8000-000000000001', 'Column boundary fixture',
  'Fictional local room', 'Synthetic project', 'oneTime', 'manual',
  jsonb_build_object('oneTime', jsonb_build_object('date', '2027-05-01', 'startTime', '10:00', 'endTime', '12:00', 'volunteers', 5)),
  'upcoming', fixture.visibility, fixture.workflow_status, 'Synthetic staff-only review sentinel',
  'db702000-0000-4000-8000-000000000002', '2026-10-07 00:00:00'::timestamp
FROM (VALUES
  ('db702010-0000-4000-8000-000000000001', 'public', 'published'),
  ('db702010-0000-4000-8000-000000000002', 'unlisted', 'published'),
  ('db702010-0000-4000-8000-000000000003', 'public', 'draft')) fixture(id, visibility, workflow_status);

SET LOCAL ROLE service_role;
SELECT extensions.is((SELECT count(*) FROM public.projects
  WHERE id::text LIKE 'db702010-%' AND review_notes = 'Synthetic staff-only review sentinel'
    AND reviewed_by = 'db702000-0000-4000-8000-000000000002' AND reviewed_at IS NOT NULL),
  3::bigint, 'service reads all populated review fields on the synthetic projects');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT extensions.is((SELECT count(id) FROM public.projects WHERE id::text LIKE 'db702010-%'),
  2::bigint, 'anonymous readers retain public and unlisted published project visibility');
SELECT extensions.is((SELECT count(id) FROM public.projects WHERE id = 'db702010-0000-4000-8000-000000000003'),
  0::bigint, 'anonymous readers still cannot read draft projects');
SELECT extensions.throws_ok(format('SELECT %I FROM public.projects WHERE id = %L', column_name, 'db702010-0000-4000-8000-000000000001'),
  '42501', NULL, 'anonymous direct read refuses ' || column_name)
FROM unnest(ARRAY['review_notes', 'reviewed_by', 'reviewed_at']) field(column_name);
SELECT extensions.throws_ok($$SELECT * FROM public.projects WHERE id = 'db702010-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'anonymous wildcard reads cannot include review fields');
SELECT extensions.throws_ok($$SELECT review_notes FROM public.projects_with_creator WHERE id = 'db702010-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'anonymous reads cannot bypass the boundary through the legacy view');
SELECT extensions.throws_ok($$SELECT to_jsonb(p) FROM public.projects p WHERE id = 'db702010-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'anonymous whole-row JSON cannot include review fields');
SELECT extensions.throws_ok($$UPDATE public.projects SET title = 'Anonymous replacement' WHERE id = 'db702010-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'anonymous project writes remain denied');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"db702000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT extensions.is((SELECT count(id) FROM public.projects WHERE id::text LIKE 'db702010-%'),
  2::bigint, 'unrelated authenticated readers retain published project visibility');
SELECT extensions.is((SELECT count(id) FROM public.projects WHERE id = 'db702010-0000-4000-8000-000000000003'),
  0::bigint, 'unrelated authenticated readers cannot read the draft');
SELECT extensions.is((SELECT count(id) FROM public.profiles WHERE id = 'db702000-0000-4000-8000-000000000001'),
  0::bigint, 'unrelated readers cannot obtain the project creator profile through its foreign key');
SELECT extensions.throws_ok(format('SELECT %I FROM public.projects WHERE id = %L', column_name, 'db702010-0000-4000-8000-000000000001'),
  '42501', NULL, 'unrelated authenticated direct read refuses ' || column_name)
FROM unnest(ARRAY['review_notes', 'reviewed_by', 'reviewed_at']) field(column_name);
SELECT extensions.throws_ok($$SELECT * FROM public.projects WHERE id = 'db702010-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'unrelated authenticated wildcard reads are refused');
SELECT extensions.throws_ok($$SELECT review_notes FROM public.projects_with_creator WHERE id = 'db702010-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'unrelated authenticated legacy-view reads are refused');
SELECT extensions.throws_ok($$SELECT to_jsonb(p) FROM public.projects p WHERE id = 'db702010-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'unrelated authenticated whole-row JSON is refused');
SELECT extensions.is((WITH changed AS (UPDATE public.projects SET title = 'Unrelated replacement'
  WHERE id = 'db702010-0000-4000-8000-000000000001' RETURNING id) SELECT count(*) FROM changed),
  0::bigint, 'unrelated authenticated writes still change no project');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"db702000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT extensions.is((SELECT count(id) FROM public.projects WHERE id::text LIKE 'db702010-%'),
  3::bigint, 'the owner retains draft and published project reads');
SELECT extensions.throws_ok(format('SELECT %I FROM public.projects WHERE id = %L', column_name, 'db702010-0000-4000-8000-000000000001'),
  '42501', NULL, 'owner browser reads also refuse ' || column_name)
FROM unnest(ARRAY['review_notes', 'reviewed_by', 'reviewed_at']) field(column_name);
SELECT extensions.throws_ok($$SELECT * FROM public.projects WHERE id = 'db702010-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'owner wildcard reads are refused');
SELECT extensions.throws_ok($$SELECT review_notes FROM public.projects_with_creator WHERE id = 'db702010-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'owner reads cannot use the legacy view');
SELECT extensions.lives_ok($$UPDATE public.projects SET title = 'Owner replacement'
  WHERE id = 'db702010-0000-4000-8000-000000000001'$$, 'the owner retains ordinary project updates');
SELECT extensions.is((SELECT title FROM public.projects WHERE id = 'db702010-0000-4000-8000-000000000001'),
  'Owner replacement', 'the owner can read the updated public field');
SELECT extensions.is(public.transition_project_status_transactional('db702010-0000-4000-8000-000000000001', 'upcoming'),
  jsonb_build_object('outcome', 'replayed', 'projectId', 'db702010-0000-4000-8000-000000000001', 'previousStatus', 'upcoming', 'status', 'upcoming'),
  'the status RPC returns only its receipt despite reading a full project internally');
SELECT extensions.is(public.end_recurring_project_series_transactional('db702010-0000-4000-8000-000000000001', '{}'::jsonb),
  jsonb_build_object('outcome', 'unchanged', 'endedRecurringSeries', false, 'cancelledOccurrences', 0, 'calendarCleanupProjectIds', '[]'::jsonb),
  'the series RPC returns only its receipt for a non-recurring project');
SELECT extensions.is(public.cancel_project_transactional('db702010-0000-4000-8000-000000000002', 'Synthetic cancellation'),
  jsonb_build_object('outcome', 'cancelled', 'jobStatus', 'pending', 'accepted', true),
  'the cancellation RPC returns only its receipt and no review fields');
RESET ROLE;

-- has_column_privilege includes inherited PUBLIC privileges, unlike attacl alone.
GRANT SELECT (review_notes) ON public.projects TO PUBLIC;
SELECT extensions.ok(has_column_privilege('anon', 'public.projects', 'review_notes', 'SELECT')
  AND has_column_privilege('authenticated', 'public.projects', 'review_notes', 'SELECT'),
  'the effective privilege check detects a stray inherited PUBLIC column grant');
REVOKE SELECT (review_notes) ON public.projects FROM PUBLIC;
SELECT extensions.ok(NOT has_column_privilege('anon', 'public.projects', 'review_notes', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.projects', 'review_notes', 'SELECT'),
  'removing the independent inherited grant restores both browser denials');
SELECT extensions.lives_ok($$SET LOCAL ROLE service_role$$, 'service role remains usable after browser denials');
SELECT extensions.is((SELECT review_notes FROM public.projects WHERE id = 'db702010-0000-4000-8000-000000000001'),
  'Synthetic staff-only review sentinel', 'service review-field access is unchanged after client and RPC checks');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM public.projects WHERE id::text LIKE 'db702010-%'
  AND review_notes = 'Synthetic staff-only review sentinel'), 3::bigint,
  'the migration and public RPCs preserve the review data');

SELECT * FROM extensions.finish();
ROLLBACK;
