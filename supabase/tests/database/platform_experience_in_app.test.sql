-- In-app platform rating prompts: organizer, signup and hours contexts are
-- written only through the service-role entry point, which rechecks ownership.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('f7000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'rate-creator@local.test', now(), '{}', '{"username":"rate_creator"}', now(), now()),
  ('f7000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'rate-admin@local.test', now(), '{}', '{"username":"rate_admin"}', now(), now()),
  ('f7000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'rate-volunteer@local.test', now(), '{}', '{"username":"rate_volunteer"}', now(), now()),
  ('f7000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'rate-stranger@local.test', now(), '{}', '{"username":"rate_stranger"}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code, verified)
VALUES ('f7100000-0000-4000-8000-000000000001', 'Synthetic Rating Org',
        'synthetic-rating-org', 'nonprofit', '860977', true);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('f7100000-0000-4000-8000-000000000001',
        'f7000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status, organization_id
)
SELECT id, 'f7000000-0000-4000-8000-000000000001', title, 'Local', title, 'oneTime', 'manual',
  jsonb_build_object('oneTime', jsonb_build_object(
    'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '3 day', 'YYYY-MM-DD'),
    'startTime', '10:00', 'endTime', '12:00', 'volunteers', 10)),
  true, 'upcoming', 'f7100000-0000-4000-8000-000000000001'
FROM (VALUES
  ('f7200000-0000-4000-8000-000000000001'::uuid, 'Rating fixture one'),
  ('f7200000-0000-4000-8000-000000000002'::uuid, 'Rating fixture still upcoming'),
  ('f7200000-0000-4000-8000-000000000003'::uuid, 'Rating fixture three')
) AS fixture(id, title);

INSERT INTO public.project_signups (id, project_id, user_id, anonymous_id, schedule_id, status)
VALUES ('f7300000-0000-4000-8000-000000000001', 'f7200000-0000-4000-8000-000000000001',
        'f7000000-0000-4000-8000-000000000003', NULL, 'oneTime', 'attended');

UPDATE public.projects SET status = 'completed'
WHERE id IN ('f7200000-0000-4000-8000-000000000001', 'f7200000-0000-4000-8000-000000000003');

CREATE FUNCTION pg_temp.rate(p_user int, p_kind text, p_context uuid, p_rating int,
  p_comment text DEFAULT NULL, p_update boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.save_platform_experience_for_user(
    ('f7000000-0000-4000-8000-00000000000' || p_user)::uuid, p_kind, p_context,
    p_rating::smallint, p_comment, p_update);
$$;

SELECT extensions.ok(NOT has_function_privilege('anon',
  'public.save_platform_experience_for_user(uuid,text,uuid,smallint,text,boolean)', 'execute'),
  'anon cannot execute the in-app entry point');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'public.save_platform_experience_for_user(uuid,text,uuid,smallint,text,boolean)', 'execute'),
  'authenticated cannot execute the in-app entry point');
SELECT extensions.ok(has_function_privilege('service_role',
  'public.save_platform_experience_for_user(uuid,text,uuid,smallint,text,boolean)', 'execute'),
  'service_role can execute the in-app entry point');
SELECT extensions.ok(NOT has_function_privilege('service_role',
  'app_private.save_platform_experience_feedback(uuid,uuid,text,uuid,smallint,text,boolean)', 'execute')
  AND NOT has_function_privilege('authenticated',
  'app_private.save_platform_experience_feedback(uuid,uuid,text,uuid,smallint,text,boolean)', 'execute'),
  'the private writer keeps its postgres-only ACL');
SELECT extensions.is(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc
    WHERE oid = 'public.save_platform_experience_for_user(uuid,text,uuid,smallint,text,boolean)'::regprocedure),
  true, 'the entry point is a definer with an empty search path');

SET LOCAL ROLE anon;
SELECT extensions.throws_ok(
  $q$SELECT public.save_platform_experience_for_user('f7000000-0000-4000-8000-000000000003', 'volunteer_hours',
    'f7000000-0000-4000-8000-000000000003', 5::smallint, NULL, false)$q$,
  '42501', NULL, 'an anon call is denied');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"role":"authenticated","sub":"f7000000-0000-4000-8000-000000000003"}';
SELECT extensions.throws_ok(
  $q$SELECT public.save_platform_experience_for_user('f7000000-0000-4000-8000-000000000003', 'volunteer_hours',
    'f7000000-0000-4000-8000-000000000003', 5::smallint, NULL, false)$q$,
  '42501', NULL, 'an authenticated call is denied');
SELECT extensions.throws_ok(
  $q$INSERT INTO public.feedback(user_id, purpose, rating, context_kind, context_id, section, email, title, feedback)
     VALUES('f7000000-0000-4000-8000-000000000003', 'platform_experience', 5, 'volunteer_hours',
       'f7000000-0000-4000-8000-000000000003', 'other', 'rate-volunteer@local.test', 'Using Let''s Assist', '')$q$,
  '42501', NULL, 'the browser role still cannot insert a platform rating');
RESET ROLE;

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claims" = '{"role":"service_role"}';

SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(3, 'volunteer_signup', 'f7300000-0000-4000-8000-000000000001', NULL, 'Too early', true)$q$,
  '22023', 'Choose a rating before sending a comment.', 'a comment still needs a saved rating');
SELECT extensions.is(pg_temp.rate(3, 'volunteer_signup', 'f7300000-0000-4000-8000-000000000001', 4)->>'rating',
  '4', 'a volunteer rates after their own signup');
SELECT extensions.is(pg_temp.rate(3, 'volunteer_hours', 'f7000000-0000-4000-8000-000000000003', 5)->>'rating',
  '5', 'a volunteer rates from their hours');
SELECT extensions.is(pg_temp.rate(1, 'organizer_project', 'f7200000-0000-4000-8000-000000000001', 3)->>'rating',
  '3', 'the creator rates a completed project');
SELECT extensions.is(
  pg_temp.rate(3, 'volunteer_hours', 'f7000000-0000-4000-8000-000000000003', NULL, '  Easy to follow  ', true)->>'comment',
  'Easy to follow', 'a comment saves on the existing rating');
SELECT extensions.is(pg_temp.rate(3, 'volunteer_hours', 'f7000000-0000-4000-8000-000000000003', 2)->>'comment',
  'Easy to follow', 'changing the rating keeps the comment');
SELECT extensions.is(pg_temp.rate(2, 'organizer_project', 'f7200000-0000-4000-8000-000000000003', 5)->>'rating',
  '5', 'an organization admin rates a completed project they manage');

SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(4, 'volunteer_signup', 'f7300000-0000-4000-8000-000000000001', 1)$q$,
  '42501', 'Experience prompt is not available.', 'another user cannot rate on someone else''s signup');
SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(4, 'volunteer_hours', 'f7000000-0000-4000-8000-000000000003', 1)$q$,
  '42501', 'Experience prompt is not available.', 'the hours context must be the caller''s own id');
SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(4, 'organizer_project', 'f7200000-0000-4000-8000-000000000001', 1)$q$,
  '42501', 'Experience prompt is not available.', 'a non-manager cannot rate as organizer');
SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(3, 'organizer_project', 'f7200000-0000-4000-8000-000000000001', 1)$q$,
  '42501', 'Experience prompt is not available.', 'an attendee is not a manager');
SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(1, 'organizer_project', 'f7200000-0000-4000-8000-000000000002', 1)$q$,
  '42501', 'Experience prompt is not available.', 'a project that is not completed is refused');
SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(2, 'organizer_project', 'f7200000-0000-4000-8000-000000000001', 1)$q$,
  '42501', 'Feedback belongs to a different attendee.', 'a second manager cannot overwrite the first rating');
SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(1, 'organizer_project', 'f7200000-0000-4000-8000-000000000003', 1)$q$,
  '42501', 'Feedback belongs to a different attendee.', 'the creator cannot overwrite an admin''s earlier rating');
SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(3, 'csf_term', 'f7300000-0000-4000-8000-000000000001', 4)$q$,
  '22023', 'Invalid experience feedback.', 'the entry point refuses the csf_term kind');
SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(3, 'project', 'f7300000-0000-4000-8000-000000000001', 4)$q$,
  '22023', 'Invalid experience feedback.', 'the entry point refuses the email request kind');
SELECT extensions.throws_ok(
  $q$SELECT pg_temp.rate(3, 'volunteer_hours', 'f7000000-0000-4000-8000-000000000003', 6)$q$,
  '22023', 'Invalid experience feedback.', 'invalid stars are rejected');

-- The email request path is unchanged.
SELECT extensions.is(public.enqueue_project_feedback_requests(
  'f7200000-0000-4000-8000-000000000001', now() + interval '1 second'), 1, 'the attendee still gets one email request');
SELECT extensions.is(public.save_platform_experience_from_request(
  (SELECT id FROM public.project_feedback_requests WHERE project_id = 'f7200000-0000-4000-8000-000000000001'),
  5::smallint, NULL, false)->>'rating', '5', 'the email request path still saves');
RESET ROLE;

SELECT extensions.is(
  (SELECT rating::int FROM public.feedback WHERE context_kind = 'organizer_project'
    AND context_id = 'f7200000-0000-4000-8000-000000000001'), 3, 'the first manager''s rating is unchanged');
SELECT extensions.is(
  (SELECT array_agg(context_kind ORDER BY context_kind) FROM public.feedback
    WHERE purpose = 'platform_experience' AND user_id::text LIKE 'f7000000-%'),
  ARRAY['organizer_project', 'organizer_project', 'project', 'volunteer_hours', 'volunteer_signup'],
  'each context holds exactly one response');

-- The private writer still accepts csf_term and enforces the new identity rules.
SELECT extensions.is(app_private.save_platform_experience_feedback(
  'f7000000-0000-4000-8000-000000000003', NULL, 'csf_term',
  'f7400000-0000-4000-8000-000000000001', 4::smallint, NULL, false)->>'rating', '4', 'the csf_term path still saves');
SELECT extensions.throws_ok(
  $q$SELECT app_private.save_platform_experience_feedback('f7000000-0000-4000-8000-000000000004', NULL,
    'volunteer_hours', 'f7000000-0000-4000-8000-000000000003', 4::smallint, NULL, false)$q$,
  '22023', 'Invalid experience feedback.', 'the writer refuses an hours context for another user');
SELECT extensions.throws_ok(
  $q$INSERT INTO public.feedback(user_id, purpose, rating, context_kind, context_id, section, email, title, feedback)
     VALUES('f7000000-0000-4000-8000-000000000004', 'platform_experience', 5, 'volunteer_hours',
       'f7000000-0000-4000-8000-000000000003', 'other', '', 'Using Let''s Assist', '')$q$,
  '23514', NULL, 'the table refuses an hours row keyed to another user');
SELECT extensions.throws_ok(
  $q$INSERT INTO public.feedback(user_id, purpose, rating, context_kind, context_id, project_request_id,
       section, email, title, feedback)
     SELECT 'f7000000-0000-4000-8000-000000000004', 'platform_experience', 5, 'volunteer_signup',
       gen_random_uuid(), id, 'other', '', 'Using Let''s Assist', ''
     FROM public.project_feedback_requests WHERE project_id = 'f7200000-0000-4000-8000-000000000001'$q$,
  '23514', NULL, 'the new kinds cannot carry an email request id');
SELECT extensions.throws_ok(
  $q$INSERT INTO public.feedback(user_id, purpose, rating, context_kind, context_id, section, email, title, feedback)
     VALUES('f7000000-0000-4000-8000-000000000004', 'platform_experience', 5, 'unknown_kind',
       gen_random_uuid(), 'other', '', 'Using Let''s Assist', '')$q$,
  '23514', NULL, 'unknown context kinds stay rejected');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"role":"authenticated","sub":"f7000000-0000-4000-8000-000000000001"}';
SELECT extensions.is((SELECT count(*)::int FROM public.feedback WHERE context_kind = 'volunteer_signup'),
  0, 'an organizer cannot read a volunteer''s platform rating');
RESET ROLE;

SELECT * FROM extensions.finish();
ROLLBACK;
