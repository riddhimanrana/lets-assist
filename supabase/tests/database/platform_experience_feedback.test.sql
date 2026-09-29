BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('d8000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'flw-creator@local.test', now(), '{}', '{"username":"flw_creator"}', now(), now()),
  ('d8000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'flw-user@local.test', now(), '{}', '{"username":"flw_user"}', now(), now());

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES
  ('d8100000-0000-4000-8000-000000000001',
   'd8000000-0000-4000-8000-000000000001',
   'Followup fixture', 'Local', 'Followup fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '3 day', 'YYYY-MM-DD'),
     'startTime', '10:00', 'endTime', '12:00', 'volunteers', 10)),
   true, 'upcoming');

INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at)
VALUES
  ('d8200000-0000-4000-8000-000000000001',
   'd8100000-0000-4000-8000-000000000001',
   'flw-anon@local.test', 'Anon Flw', now()),
-- Opted out: must never be enqueued.
  ('d8200000-0000-4000-8000-000000000002',
   'd8100000-0000-4000-8000-000000000001',
   'flw-optout@local.test', 'Optout Flw', now());

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claims" =
  '{"role":"service_role"}';

SELECT public.set_anonymous_feedback_email_opt_out(
  'd8200000-0000-4000-8000-000000000002',
  true
);

RESET ROLE;

INSERT INTO public.project_signups (id, project_id, user_id, anonymous_id, schedule_id, status)
VALUES
  ('d8300000-0000-4000-8000-000000000001',
   'd8100000-0000-4000-8000-000000000001',
   'd8000000-0000-4000-8000-000000000002', NULL, 'oneTime', 'attended'),
  ('d8300000-0000-4000-8000-000000000002',
   'd8100000-0000-4000-8000-000000000001',
   NULL, 'd8200000-0000-4000-8000-000000000001', 'oneTime', 'attended'),
  ('d8300000-0000-4000-8000-000000000003',
   'd8100000-0000-4000-8000-000000000001',
   NULL, 'd8200000-0000-4000-8000-000000000002', 'oneTime', 'attended'),
-- Approved-only: not an attendee, no email.
  ('d8300000-0000-4000-8000-000000000004',
   'd8100000-0000-4000-8000-000000000001',
   'd8000000-0000-4000-8000-000000000001', NULL, 'oneTime', 'approved');

UPDATE public.projects
SET status = 'completed'
WHERE id = 'd8100000-0000-4000-8000-000000000001';


SELECT extensions.is(public.enqueue_project_feedback_requests('d8100000-0000-4000-8000-000000000001', now() - interval '1 hour'), 0, 'no historical survey blast');
SELECT extensions.is(public.enqueue_project_feedback_requests('d8100000-0000-4000-8000-000000000001', now() + interval '1 second'), 2, 'new eligible registered and anonymous attendees each get one request');
SELECT extensions.is(public.enqueue_project_feedback_requests('d8100000-0000-4000-8000-000000000001', now() + interval '1 second'), 0, 'enqueue retry never duplicates recipients');
SELECT extensions.is((SELECT count(*)::int FROM public.project_feedback_requests WHERE project_id='d8100000-0000-4000-8000-000000000001' AND purpose='platform_experience'),2,'new requests are platform surveys');
SELECT extensions.ok(NOT has_function_privilege('authenticated','public.save_platform_experience_from_request(uuid,smallint,text,boolean)','execute'),'browser cannot impersonate token writes');
CREATE FUNCTION pg_temp.save_rating(p_user boolean, p_rating smallint, p_comment text DEFAULT NULL, p_update boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.save_platform_experience_from_request((SELECT id FROM public.project_feedback_requests WHERE project_id='d8100000-0000-4000-8000-000000000001' AND (user_id IS NOT NULL)=p_user),p_rating,p_comment,p_update);
$$;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claims" = '{"role":"service_role"}';
SELECT extensions.throws_ok($q$SELECT pg_temp.save_rating(true,NULL,'No rating yet',true)$q$,'22023','Choose a rating before sending a comment.','comments require a saved rating');
SELECT extensions.is(pg_temp.save_rating(true,4::smallint)->>'rating','4','registered attendee rating saves immediately');
SELECT extensions.is(pg_temp.save_rating(false,5::smallint)->>'rating','5','anonymous attendee rating saves');
SELECT extensions.is(pg_temp.save_rating(true,NULL,'Clear and easy',true)->>'comment','Clear and easy','comment saves independently');
SELECT extensions.is(pg_temp.save_rating(true,3::smallint)->>'comment','Clear and easy','changing rating retains comment');
SELECT extensions.is(pg_temp.save_rating(true,NULL,'Updated comment',true)->>'rating','3','changing comment retains rating');
SELECT extensions.throws_ok($q$SELECT pg_temp.save_rating(true,6::smallint)$q$,'22023','Invalid experience feedback.','invalid stars rejected');
SELECT extensions.is((SELECT count(*)::int FROM public.feedback WHERE purpose='platform_experience'),2,'retries and changes update the same response');
SELECT extensions.is((SELECT count(*)::int FROM public.project_feedback WHERE project_id='d8100000-0000-4000-8000-000000000001'),0,'platform survey never creates organizer feedback');
SELECT extensions.throws_ok($q$SELECT public.submit_project_feedback_from_request((SELECT id FROM public.project_feedback_requests WHERE user_id='d8000000-0000-4000-8000-000000000002'),3::smallint,NULL)$q$,'42501','feedback request is not eligible','legacy action refuses a platform-purpose request');
RESET ROLE;
SAVEPOINT legacy_request;
UPDATE public.project_feedback_requests SET purpose='organizer' WHERE user_id='d8000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($q$SELECT pg_temp.save_rating(true,3::smallint)$q$,'42501','Experience request is not eligible.','platform action refuses an organizer-purpose request');
ROLLBACK TO legacy_request;
SAVEPOINT lost_attendance;
UPDATE public.project_signups SET status='cancelled' WHERE id='d8300000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($q$SELECT pg_temp.save_rating(true,3::smallint)$q$,'42501','Attendance could not be verified.','attendance is rechecked at save time');
ROLLBACK TO lost_attendance;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"role":"authenticated","sub":"d8000000-0000-4000-8000-000000000001"}';
SELECT extensions.is((SELECT count(*)::int FROM public.feedback WHERE purpose='platform_experience'),0,'project organizer cannot read platform feedback');
SET LOCAL "request.jwt.claims" = '{"role":"authenticated","sub":"d8000000-0000-4000-8000-000000000002"}';
SELECT extensions.is((SELECT count(*)::int FROM public.feedback WHERE purpose='platform_experience'),1,'author can read only their response');
WITH changed AS (UPDATE public.feedback SET rating=1 WHERE purpose='platform_experience' RETURNING id) SELECT extensions.is((SELECT count(*)::int FROM changed),0,'direct browser updates cannot change a platform response');
SET LOCAL "request.jwt.claims" = '{"role":"authenticated","sub":"d8000000-0000-4000-8000-000000000001","app_metadata":{"is_super_admin":true}}';
SELECT extensions.is((SELECT count(*)::int FROM public.feedback WHERE purpose='platform_experience'),2,'platform admin can read both response identities');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
