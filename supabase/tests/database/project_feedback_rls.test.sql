-- Project feedback privacy: attendees write their own rating once, project
-- managers read all of a project's feedback, staff respect the
-- can_be_managed_by_staff opt-out, nobody deletes, and the guard trigger
-- pins immutable columns and moderation state.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('c7000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'fb-creator@local.test', now(), '{}', '{"username":"fb_creator"}', now(), now()),
  ('c7000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'fb-attendee@local.test', now(), '{}', '{"username":"fb_attendee"}', now(), now()),
  ('c7000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'fb-approved-only@local.test', now(), '{}', '{"username":"fb_approved"}', now(), now()),
  ('c7000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'fb-staff@local.test', now(), '{}', '{"username":"fb_staff"}', now(), now()),
  ('c7000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'fb-admin@local.test', now(), '{}', '{"username":"fb_admin"}', now(), now()),
  ('c7000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
   'fb-outsider@local.test', now(), '{}', '{"username":"fb_outsider"}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('c7300000-0000-4000-8000-000000000001', 'Feedback Org',
        'feedback_org', 'nonprofit', '824135');

INSERT INTO public.organization_members (organization_id, user_id, role)
VALUES
  ('c7300000-0000-4000-8000-000000000001',
   'c7000000-0000-4000-8000-000000000004', 'staff'),
  ('c7300000-0000-4000-8000-000000000001',
   'c7000000-0000-4000-8000-000000000005', 'admin');

-- Completed org project that opted OUT of staff management.
INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status,
  organization_id, can_be_managed_by_staff
)
VALUES
  ('c7100000-0000-4000-8000-000000000001',
   'c7000000-0000-4000-8000-000000000001',
   'Feedback fixture', 'Local', 'Feedback fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '2 day', 'YYYY-MM-DD'),
     'startTime', '10:00', 'endTime', '12:00', 'volunteers', 5)),
   true, 'completed',
   'c7300000-0000-4000-8000-000000000001', false),
-- Still-upcoming project: feedback window closed.
  ('c7100000-0000-4000-8000-000000000002',
   'c7000000-0000-4000-8000-000000000001',
   'Upcoming fixture', 'Local', 'Feedback fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') + interval '7 day', 'YYYY-MM-DD'),
     'startTime', '10:00', 'endTime', '12:00', 'volunteers', 5)),
   true, 'upcoming', NULL, NULL);

INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES
  -- Attended: eligible.
  ('c7200000-0000-4000-8000-000000000001',
   'c7100000-0000-4000-8000-000000000001',
   'c7000000-0000-4000-8000-000000000002', 'oneTime', 'attended'),
  -- Approved but never attended: not eligible.
  ('c7200000-0000-4000-8000-000000000002',
   'c7100000-0000-4000-8000-000000000001',
   'c7000000-0000-4000-8000-000000000003', 'oneTime', 'approved'),
  -- Attended signup on the upcoming project (window test).
  ('c7200000-0000-4000-8000-000000000003',
   'c7100000-0000-4000-8000-000000000002',
   'c7000000-0000-4000-8000-000000000002', 'oneTime', 'attended');

-- ---------------------------------------------------------------------------
-- Attendee inserts own feedback
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"c7000000-0000-4000-8000-000000000002","role":"authenticated"}';

INSERT INTO public.project_feedback (
  project_id, user_id, signup_id, rating, comment, comment_moderation_status
)
VALUES ('c7100000-0000-4000-8000-000000000001',
        'c7000000-0000-4000-8000-000000000002',
        'c7200000-0000-4000-8000-000000000001',
        4, 'Great event, well organized.', 'pending');

SELECT extensions.is(
  (SELECT count(*) FROM public.project_feedback
   WHERE user_id = 'c7000000-0000-4000-8000-000000000002'),
  1::bigint,
  'an attended volunteer can submit feedback on a completed project'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.project_feedback (project_id, user_id, signup_id, rating)
    VALUES ('c7100000-0000-4000-8000-000000000001',
            'c7000000-0000-4000-8000-000000000002',
            'c7200000-0000-4000-8000-000000000001', 5)
  $$,
  '23505',
  NULL,
  'one rating per attendee per project'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.project_feedback (project_id, user_id, signup_id, rating)
    VALUES ('c7100000-0000-4000-8000-000000000002',
            'c7000000-0000-4000-8000-000000000002',
            'c7200000-0000-4000-8000-000000000003', 5)
  $$,
  '42501',
  NULL,
  'feedback is closed while the project is not completed'
);

-- Guard trigger: edits cannot move the row or settle moderation.
UPDATE public.project_feedback
SET rating = 5,
    project_id = 'c7100000-0000-4000-8000-000000000002',
    submitted_via = 'email_link',
    comment_moderation_status = 'allowed'
WHERE user_id = 'c7000000-0000-4000-8000-000000000002';

SELECT extensions.is(
  (SELECT rating::int FROM public.project_feedback
   WHERE user_id = 'c7000000-0000-4000-8000-000000000002'),
  5,
  'the author can update their rating'
);
SELECT extensions.is(
  (SELECT project_id::text || '|' || submitted_via
   FROM public.project_feedback
   WHERE user_id = 'c7000000-0000-4000-8000-000000000002'),
  'c7100000-0000-4000-8000-000000000001|app',
  'the guard trigger pins project_id and submitted_via'
);
SELECT extensions.is(
  (SELECT comment_moderation_status FROM public.project_feedback
   WHERE user_id = 'c7000000-0000-4000-8000-000000000002'),
  'pending',
  'an unchanged comment keeps its moderation state and a client cannot settle it'
);

-- Changing the comment re-enters review even from a settled verdict.
RESET ROLE;
UPDATE public.project_feedback
SET comment_moderation_status = 'allowed'
WHERE user_id = 'c7000000-0000-4000-8000-000000000002';

-- Regression guard: with a SECURITY DEFINER trigger this settlement was
-- silently reverted for every writer, including the moderation pipeline.
SELECT extensions.is(
  (SELECT comment_moderation_status FROM public.project_feedback
   WHERE user_id = 'c7000000-0000-4000-8000-000000000002'),
  'allowed',
  'privileged writers can settle a moderation verdict'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"c7000000-0000-4000-8000-000000000002","role":"authenticated"}';
UPDATE public.project_feedback
SET comment = 'Actually, the check-in line was long.'
WHERE user_id = 'c7000000-0000-4000-8000-000000000002';

SELECT extensions.is(
  (SELECT comment_moderation_status FROM public.project_feedback
   WHERE user_id = 'c7000000-0000-4000-8000-000000000002'),
  'pending',
  'editing the comment text re-enters moderation review'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.project_feedback
    WHERE user_id = 'c7000000-0000-4000-8000-000000000002'
  $$,
  '42501',
  NULL,
  'not even the author can delete feedback'
);

-- ---------------------------------------------------------------------------
-- Ineligible authors
-- ---------------------------------------------------------------------------

SET LOCAL "request.jwt.claims" =
  '{"sub":"c7000000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.project_feedback (project_id, user_id, signup_id, rating)
    VALUES ('c7100000-0000-4000-8000-000000000001',
            'c7000000-0000-4000-8000-000000000003',
            'c7200000-0000-4000-8000-000000000002', 5)
  $$,
  '42501',
  NULL,
  'an approved-but-absent volunteer cannot rate'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.project_feedback (project_id, user_id, signup_id, rating)
    VALUES ('c7100000-0000-4000-8000-000000000001',
            'c7000000-0000-4000-8000-000000000002',
            'c7200000-0000-4000-8000-000000000001', 5)
  $$,
  '42501',
  NULL,
  'nobody can submit feedback as another user'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_feedback),
  0::bigint,
  'volunteer B cannot read volunteer A''s feedback'
);

-- ---------------------------------------------------------------------------
-- Manager visibility
-- ---------------------------------------------------------------------------

SET LOCAL "request.jwt.claims" =
  '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT extensions.is(
  (SELECT count(*) FROM public.project_feedback
   WHERE project_id = 'c7100000-0000-4000-8000-000000000001'),
  1::bigint,
  'the project creator reads all feedback for their project'
);
SELECT extensions.throws_ok(
  $$
    DELETE FROM public.project_feedback
    WHERE project_id = 'c7100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  NULL,
  'the organizer cannot erase feedback they dislike'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"c7000000-0000-4000-8000-000000000005","role":"authenticated"}';
SELECT extensions.is(
  (SELECT count(*) FROM public.project_feedback
   WHERE project_id = 'c7100000-0000-4000-8000-000000000001'),
  1::bigint,
  'an org admin reads project feedback'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"c7000000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT extensions.is(
  (SELECT count(*) FROM public.project_feedback
   WHERE project_id = 'c7100000-0000-4000-8000-000000000001'),
  0::bigint,
  'org staff cannot read feedback when the project opted out of staff management'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"c7000000-0000-4000-8000-000000000006","role":"authenticated"}';
SELECT extensions.is(
  (SELECT count(*) FROM public.project_feedback),
  0::bigint,
  'unrelated users see nothing'
);

RESET ROLE;

-- Staff visibility flips with the project's own opt-in.
UPDATE public.projects
SET can_be_managed_by_staff = true
WHERE id = 'c7100000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"c7000000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT extensions.is(
  (SELECT count(*) FROM public.project_feedback
   WHERE project_id = 'c7100000-0000-4000-8000-000000000001'),
  1::bigint,
  'org staff read feedback once the project opts into staff management'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Privileges and anon
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.project_feedback', 'SELECT'),
  'anonymous clients cannot read feedback at all'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.project_feedback', 'DELETE'),
  'authenticated clients hold no DELETE privilege'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon', 'app_private.project_feedback_window_open(uuid)', 'EXECUTE'),
  'anon cannot probe the feedback window helper'
);
SELECT extensions.ok(
  has_table_privilege('service_role', 'public.project_feedback', 'DELETE'),
  'the service role retains full access for admin enforcement'
);

SELECT * FROM extensions.finish();

ROLLBACK;
