-- Review repairs R1 to R9 and R12 for attendance-backed CSF submissions.
-- Each scenario reproduces a finding from the independent review with the
-- same fictional fixture as csf_attendance_submission_projection.test.sql.
-- R2 (host lock waits) is in csf_attendance_projection_concurrency.test.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(24);

-- Keep organizer sessions ended while preserving the local and UTC clocks.
-- These August through October dates remain in Pacific daylight time.
CREATE FUNCTION pg_temp.ended_fixture(p_text text)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT replace(
    p_text,
    '2041-',
    (extract(year FROM current_date)::integer - 1)::text || '-'
  )
$$;
REVOKE ALL ON FUNCTION pg_temp.ended_fixture(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.ended_fixture(text) TO postgres;

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('a7000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'attendance-officer@local.test', now(), '{}', '{"full_name":"Fixture Officer"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'attendance-member-one@local.test', now(), '{}', '{"full_name":"Fixture Member One"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'attendance-member-two@local.test', now(), '{}', '{"full_name":"Fixture Member Two"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'attendance-stranger@local.test', now(), '{}', '{"full_name":"Fixture Stranger"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'attendance-partner@local.test', now(), '{}', '{"full_name":"Fixture Partner"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'attendance-guest@local.test', now(), '{}', '{"full_name":"Fixture Guest"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'attendance-member-three@local.test', now(), '{}', '{"full_name":"Fixture Member Three"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'attendance-other-officer@local.test', now(), '{}', '{"full_name":"Other Officer"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'attendance-inactive@local.test', now(), '{}', '{"full_name":"Fixture Inactive"}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('a7100000-0000-4000-8000-000000000001', 'Attendance Chapter', 'attendance-chapter', 'school', '997101'),
  ('a7100000-0000-4000-8000-000000000002', 'Attendance Partner', 'attendance-partner', 'nonprofit', '997102'),
  ('a7100000-0000-4000-8000-000000000003', 'Attendance Other Chapter', 'attendance-other-chapter', 'school', '997103');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003', 'member', 'active'),
  ('a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000006', 'member', 'active'),
  ('a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000007', 'member', 'active'),
  ('a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000009', 'member', 'active'),
  ('a7100000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000005', 'admin', 'active'),
  ('a7100000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000008', 'admin', 'active');

INSERT INTO public.organization_plugin_installs (organization_id, plugin_key, installed_version, configuration, installed_by)
VALUES
  ('a7100000-0000-4000-8000-000000000001', 'dvhs-csf', '0.1.0', '{}', 'a7000000-0000-4000-8000-000000000001'),
  ('a7100000-0000-4000-8000-000000000003', 'dvhs-csf', '0.1.0', '{}', 'a7000000-0000-4000-8000-000000000008');
INSERT INTO public.organization_plugin_entitlements (organization_id, plugin_key, status, created_by)
VALUES
  ('a7100000-0000-4000-8000-000000000001', 'dvhs-csf', 'active', 'a7000000-0000-4000-8000-000000000001'),
  ('a7100000-0000-4000-8000-000000000003', 'dvhs-csf', 'active', 'a7000000-0000-4000-8000-000000000008');

INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester, lifecycle_status, is_current)
VALUES
  ('a7200000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'F41', 'Fall 2041', '2041-2042', 'fall', 'open', true),
  ('a7200000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', 'S42', 'Spring 2042', '2041-2042', 'spring', 'planned', false),
  ('a7200000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000003', 'F41', 'Fall 2041', '2041-2042', 'fall', 'open', true);
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES ('a7300000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 2043, 'Class of 2043', 'active');
INSERT INTO plugin_data.csf_term_policies (organization_id, term_id, max_points_per_activity, outside_volunteering_allowed, published_at)
VALUES ('a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', 3, true, now());

INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name, record_status)
VALUES
  ('a7400000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', 'Member', 'One', 'member', 'one', 'active'),
  ('a7400000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000001', 'Member', 'Two', 'member', 'two', 'active'),
  ('a7400000-0000-4000-8000-000000000006', 'a7100000-0000-4000-8000-000000000001', 'Member', 'Guest', 'member', 'guest', 'active'),
  ('a7400000-0000-4000-8000-000000000007', 'a7100000-0000-4000-8000-000000000001', 'Member', 'Three', 'member', 'three', 'active'),
  ('a7400000-0000-4000-8000-000000000009', 'a7100000-0000-4000-8000-000000000001', 'Member', 'Inactive', 'member', 'inactive', 'active');
INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary)
VALUES
  ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000002', 'verified', true),
  ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000003', 'verified', true),
  ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000006', 'a7000000-0000-4000-8000-000000000006', 'verified', true),
  ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000007', 'a7000000-0000-4000-8000-000000000007', 'verified', true),
  ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000009', 'a7000000-0000-4000-8000-000000000009', 'verified', true);
INSERT INTO plugin_data.csf_term_memberships (organization_id, profile_id, term_id, cohort_id, status, accepted_at)
VALUES
  ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000002', 'a7200000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'accepted', now()),
  ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000003', 'a7200000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'active', now()),
  ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000006', 'a7200000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'accepted', now()),
  ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000007', 'a7200000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'accepted', now()),
  ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000009', 'a7200000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'withdrawn', now());

-- Partner projects: a public one-time event, a public two-slot event, a
-- public event published before linking, and an organization-only event.
INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, visibility, project_timezone
) VALUES
  ('a7500000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000005', 'a7100000-0000-4000-8000-000000000002',
   'Partner Beach Cleanup', 'Coast', 'Fictional partner event', 'oneTime', 'manual',
   pg_temp.ended_fixture('{"oneTime":{"date":"2041-09-20","startTime":"09:00","endTime":"12:00","volunteers":40}}')::jsonb, true, 'public', 'America/Los_Angeles'),
  ('a7500000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000005', 'a7100000-0000-4000-8000-000000000002',
   'Partner Food Bank Shifts', 'Warehouse', 'Fictional partner shifts', 'multiDay', 'manual',
   pg_temp.ended_fixture('{"multiDay":[{"date":"2041-10-04","slots":[{"startTime":"09:00","endTime":"11:00","volunteers":10},{"startTime":"11:00","endTime":"13:00","volunteers":10}]}]}')::jsonb,
   true, 'public', 'America/Los_Angeles'),
  ('a7500000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000005', 'a7100000-0000-4000-8000-000000000002',
   'Partner Library Day', 'Library', 'Fictional earlier event', 'oneTime', 'manual',
   pg_temp.ended_fixture('{"oneTime":{"date":"2041-08-30","startTime":"10:00","endTime":"12:00","volunteers":10}}')::jsonb, true, 'public', 'America/Los_Angeles'),
  ('a7500000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000005', 'a7100000-0000-4000-8000-000000000002',
   'Partner Staff Retreat', 'Office', 'Organization-only event', 'oneTime', 'manual',
   pg_temp.ended_fixture('{"oneTime":{"date":"2041-09-21","startTime":"09:00","endTime":"10:00","volunteers":5}}')::jsonb, true, 'organization_only', 'America/Los_Angeles');

INSERT INTO public.project_signups (id, project_id, user_id, anonymous_id, schedule_id, status)
VALUES
  ('a7600000-0000-4000-8000-000000000001', 'a7500000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', NULL, 'oneTime', 'approved'),
  ('a7600000-0000-4000-8000-000000000002', 'a7500000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003', NULL, 'oneTime', 'approved'),
  ('a7600000-0000-4000-8000-000000000003', 'a7500000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', NULL, 'oneTime', 'approved'),
  ('a7600000-0000-4000-8000-000000000004', 'a7500000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000009', NULL, 'oneTime', 'approved'),
  ('a7600000-0000-4000-8000-000000000011', 'a7500000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000007', NULL, pg_temp.ended_fixture('2041-10-04-0'), 'approved'),
  ('a7600000-0000-4000-8000-000000000012', 'a7500000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000007', NULL, pg_temp.ended_fixture('2041-10-04-1'), 'approved'),
  ('a7600000-0000-4000-8000-000000000021', 'a7500000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000003', NULL, 'oneTime', 'approved');

-- Activities: fixed points on the beach cleanup (and a later duplicate link),
-- shift points on the food bank, and a fixed activity on the library day.
INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, cohort_id, title, body, status, signup_mode,
  linked_project_id, signup_url, point_value, point_type, requires_point_submission,
  evidence_policy, earning_rules, point_cap, published_at, created_by_user_id, created_at
) VALUES
  ('a7700000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', NULL,
   'Beach cleanup', 'Partner cleanup', 'published', 'lets_assist_project', 'a7500000-0000-4000-8000-000000000001',
   '/projects/a7500000-0000-4000-8000-000000000001', 2, 'non_drive', true, 'required', NULL, NULL, now(),
   'a7000000-0000-4000-8000-000000000001', now() - interval '2 days'),
  ('a7700000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', NULL,
   'Beach cleanup duplicate', 'Second link', 'published', 'lets_assist_project', 'a7500000-0000-4000-8000-000000000001',
   '/projects/a7500000-0000-4000-8000-000000000001', 1, 'non_drive', true, 'optional', NULL, NULL, now(),
   'a7000000-0000-4000-8000-000000000001', now() - interval '1 day'),
  ('a7700000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', NULL,
   'Food bank shifts', 'Partner shifts', 'published', 'lets_assist_project', 'a7500000-0000-4000-8000-000000000002',
   '/projects/a7500000-0000-4000-8000-000000000002', 0, 'non_drive', true, 'required',
   pg_temp.ended_fixture('{"version":1,"mode":"shifts","shiftPolicy":{"allowMultiple":true,"combinedMaxPoints":4},"components":[
     {"key":"morning","label":"Morning shift","category":"non_drive","kind":"shift","points":2,"startsAt":"2041-10-04T16:00:00Z","endsAt":"2041-10-04T18:00:00Z"},
     {"key":"midday","label":"Midday shift","category":"non_drive","kind":"shift","points":2,"startsAt":"2041-10-04T18:00:00Z","endsAt":"2041-10-04T20:00:00Z"}]}')::jsonb,
   NULL, now(), 'a7000000-0000-4000-8000-000000000001', now()),
  ('a7700000-0000-4000-8000-000000000004', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', NULL,
   'Library day', 'Partner library', 'published', 'lets_assist_project', 'a7500000-0000-4000-8000-000000000003',
   '/projects/a7500000-0000-4000-8000-000000000003', 1, 'non_drive', true, 'required', NULL, NULL, now(),
   'a7000000-0000-4000-8000-000000000001', now());

CREATE TEMP TABLE attendance_results (label text PRIMARY KEY, payload jsonb) ON COMMIT DROP;
GRANT ALL ON attendance_results TO service_role;

-- Helpers
CREATE FUNCTION pg_temp.claim(p_profile uuid, p_activity uuid)
RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM plugin_data.csf_point_submissions
  WHERE profile_id = p_profile AND opportunity_id = p_activity
    AND status NOT IN ('withdrawn', 'rejected')
  ORDER BY created_at DESC, id LIMIT 1
$$;
CREATE FUNCTION pg_temp.enable(p_activity uuid, p_request uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT plugin_data.csf_set_activity_attendance_submissions(
    'a7100000-0000-4000-8000-000000000001', p_activity, 'pending_submission',
    'a7000000-0000-4000-8000-000000000001', p_request)
$$;
CREATE FUNCTION pg_temp.retry(p_activity uuid, p_request uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT plugin_data.csf_retry_activity_attendance_sync(
    'a7100000-0000-4000-8000-000000000001', p_activity,
    'a7000000-0000-4000-8000-000000000001', p_request)
$$;
CREATE FUNCTION pg_temp.review(p_submission uuid, p_action text, p_request uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT plugin_data.csf_review_point_submission_request(
    'a7100000-0000-4000-8000-000000000001', p_submission, p_action, NULL,
    CASE WHEN p_action = 'approved' THEN NULL ELSE 'Fixture review note.' END,
    'a7000000-0000-4000-8000-000000000001', p_request)
$$;
CREATE FUNCTION pg_temp.outcome_for(p_signup uuid)
RETURNS text LANGUAGE sql AS $$
  SELECT o.outcome FROM plugin_data.csf_attendance_projection_outcomes o
  JOIN public.certificates c ON c.id = o.certificate_id
  WHERE o.organization_id = 'a7100000-0000-4000-8000-000000000001' AND c.signup_id = p_signup
$$;

-- ---------------------------------------------------------------------------
-- R3: draft, enable, then publish backfills; relink after publication backfills
-- ---------------------------------------------------------------------------

UPDATE plugin_data.csf_opportunities SET status = 'draft', published_at = NULL
WHERE id = 'a7700000-0000-4000-8000-000000000004';
SELECT public.publish_volunteer_hours_transactional(
  'a7000000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000003', 'oneTime',
  pg_temp.ended_fixture('[{"signupId":"a7600000-0000-4000-8000-000000000021","checkIn":"2041-08-30T17:00:00Z","checkOut":"2041-08-30T19:00:00Z"}]')::jsonb,
  'hours-publication:v1:3333333333333333333333333333333333333333333333333333333333333333'
);
SELECT pg_temp.enable('a7700000-0000-4000-8000-000000000004', 'a7900000-0000-4000-8000-000000000101');
SELECT extensions.is(
  pg_temp.claim('a7400000-0000-4000-8000-000000000003', 'a7700000-0000-4000-8000-000000000004'),
  NULL,
  'enabling a draft creates no claim yet'
);
SELECT plugin_data.csf_set_activity_status(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004', 'published', NULL,
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000102');
SELECT extensions.isnt(
  pg_temp.claim('a7400000-0000-4000-8000-000000000003', 'a7700000-0000-4000-8000-000000000004'),
  NULL,
  'R3: publishing an enabled draft backfills already-published attendance'
);

-- Relink an enabled, published activity to a project whose hours are published.
SELECT public.publish_volunteer_hours_transactional(
  'a7000000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000001', 'oneTime',
  pg_temp.ended_fixture('[{"signupId":"a7600000-0000-4000-8000-000000000001","checkIn":"2041-09-20T16:00:00Z","checkOut":"2041-09-20T19:00:00Z"},
    {"signupId":"a7600000-0000-4000-8000-000000000002","checkIn":"2041-09-20T16:00:00Z","checkOut":"2041-09-20T18:00:00Z"}]')::jsonb,
  'hours-publication:v1:1111111111111111111111111111111111111111111111111111111111111111'
);
SELECT plugin_data.csf_update_activity(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004',
  'a7200000-0000-4000-8000-000000000001', NULL,
  '{"title":"Library day","body":"Moved","signupMode":"lets_assist_project","linkedProjectId":"a7500000-0000-4000-8000-000000000001","pointType":"non_drive","pointValue":1,"requiresPointSubmission":true,"evidencePolicy":"required","signupUrl":""}'::jsonb,
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000103');
SELECT extensions.isnt(
  pg_temp.claim('a7400000-0000-4000-8000-000000000002', 'a7700000-0000-4000-8000-000000000004'),
  NULL,
  'R3: relinking an enabled activity to a published project backfills it'
);
-- Put the library activity back so later scenarios keep one link per project.
SELECT plugin_data.csf_update_activity(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004',
  'a7200000-0000-4000-8000-000000000001', NULL,
  '{"title":"Library day","body":"Back","signupMode":"lets_assist_project","linkedProjectId":"a7500000-0000-4000-8000-000000000003","pointType":"non_drive","pointValue":1,"requiresPointSubmission":true,"evidencePolicy":"required","signupUrl":""}'::jsonb,
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000104');
SELECT pg_temp.retry('a7700000-0000-4000-8000-000000000004', 'a7900000-0000-4000-8000-000000000105');

-- ---------------------------------------------------------------------------
-- R1: one certificate earns credit once across two linked activities
-- ---------------------------------------------------------------------------

SELECT pg_temp.enable('a7700000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000111');
SELECT pg_temp.review(
  pg_temp.claim('a7400000-0000-4000-8000-000000000002', 'a7700000-0000-4000-8000-000000000001'),
  'approved', 'a7900000-0000-4000-8000-000000000112');
SELECT pg_temp.enable('a7700000-0000-4000-8000-000000000002', 'a7900000-0000-4000-8000-000000000113');
SELECT plugin_data.csf_set_activity_attendance_submissions(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000001', 'off',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000114');
SELECT extensions.is(
  (SELECT state FROM plugin_data.csf_attendance_evidence
   WHERE signup_id = 'a7600000-0000-4000-8000-000000000001' AND submission_id =
     (SELECT id FROM plugin_data.csf_point_submissions
      WHERE profile_id = 'a7400000-0000-4000-8000-000000000002'
        AND opportunity_id = 'a7700000-0000-4000-8000-000000000001' AND status = 'approved')),
  'active',
  'R1: turning automatic submissions off keeps evidence on an approved claim'
);
SELECT pg_temp.retry('a7700000-0000-4000-8000-000000000002', 'a7900000-0000-4000-8000-000000000115');
SELECT plugin_data.csf_set_activity_status(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000001', 'cancelled',
  'Duplicate activity', 'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000116');
SELECT pg_temp.retry('a7700000-0000-4000-8000-000000000002', 'a7900000-0000-4000-8000-000000000117');
-- Source-side churn: an account link revoked and restored stales the
-- approved claim's evidence; the certificate still may not be claimed again.
UPDATE plugin_data.csf_profile_accounts SET status = 'revoked', revoked_at = now()
WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND user_id = 'a7000000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profile_accounts SET status = 'verified', revoked_at = NULL
WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND user_id = 'a7000000-0000-4000-8000-000000000002';
SELECT pg_temp.retry('a7700000-0000-4000-8000-000000000002', 'a7900000-0000-4000-8000-000000000118');
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000002'
     AND opportunity_id = 'a7700000-0000-4000-8000-000000000002'),
  0,
  'R1: after disable, cancel, and account churn the second activity never claims the certificate'
);
SELECT extensions.is(
  pg_temp.outcome_for('a7600000-0000-4000-8000-000000000001'),
  'prior_decision',
  'R1: the consumed certificate is recorded as a prior decision'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000002' AND status = 'verified'),
  1,
  'R1: exactly one verified credit exists for the certificate'
);

-- ---------------------------------------------------------------------------
-- R6: attendance claims cannot be sent back for changes; R5: appeal
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format($$SELECT pg_temp.review(%L, 'needs_action', 'a7900000-0000-4000-8000-000000000121')$$,
    (SELECT id FROM plugin_data.csf_point_submissions
     WHERE profile_id = 'a7400000-0000-4000-8000-000000000003' AND opportunity_id = 'a7700000-0000-4000-8000-000000000002'
       AND status = 'submitted')),
  '55000',
  'Attendance claims cannot be sent back for changes. Approve, reject, or retry attendance sync.',
  'R6: review refuses needs_action for an attendance claim'
);
SELECT pg_temp.review(
  (SELECT id FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000003' AND opportunity_id = 'a7700000-0000-4000-8000-000000000004'
     AND status = 'submitted'),
  'rejected', 'a7900000-0000-4000-8000-000000000122');
INSERT INTO attendance_results
SELECT 'appeal', plugin_data.csf_submit_point_appeal(
  'a7100000-0000-4000-8000-000000000001',
  (SELECT id FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000003' AND opportunity_id = 'a7700000-0000-4000-8000-000000000004'),
  'The organizer verified my attendance.', NULL,
  'a7000000-0000-4000-8000-000000000003', 'a7900000-0000-4000-8000-000000000123');
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_review_point_appeal(
    'a7100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_appeals
     WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND status IN ('submitted', 'under_review')
     ORDER BY created_at DESC LIMIT 1),
    'approved', 'Organizer evidence confirms attendance.',
    'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000124')$$,
  'R5: an appeal on an attendance claim can be granted on organizer evidence'
);

-- ---------------------------------------------------------------------------
-- R7: a single-shift claim does not absorb a different shift
-- ---------------------------------------------------------------------------

UPDATE plugin_data.csf_opportunities
SET earning_rules = jsonb_set(earning_rules, '{shiftPolicy}', '{"allowMultiple":false,"combinedMaxPoints":2}')
WHERE id = 'a7700000-0000-4000-8000-000000000003';
SELECT pg_temp.enable('a7700000-0000-4000-8000-000000000003', 'a7900000-0000-4000-8000-000000000131');
SELECT public.publish_volunteer_hours_transactional(
  'a7000000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000002', pg_temp.ended_fixture('2041-10-04-0'),
  pg_temp.ended_fixture('[{"signupId":"a7600000-0000-4000-8000-000000000011","checkIn":"2041-10-04T16:00:00Z","checkOut":"2041-10-04T18:00:00Z"}]')::jsonb,
  'hours-publication:v1:4444444444444444444444444444444444444444444444444444444444444444'
);
SELECT public.publish_volunteer_hours_transactional(
  'a7000000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000002', pg_temp.ended_fixture('2041-10-04-1'),
  pg_temp.ended_fixture('[{"signupId":"a7600000-0000-4000-8000-000000000012","checkIn":"2041-10-04T18:00:00Z","checkOut":"2041-10-04T20:00:00Z"}]')::jsonb,
  'hours-publication:v1:5555555555555555555555555555555555555555555555555555555555555555'
);
SELECT extensions.is(
  pg_temp.outcome_for('a7600000-0000-4000-8000-000000000012'),
  'awaiting_decision',
  'R7: the second shift waits instead of attaching to the single-shift claim'
);
SELECT pg_temp.review(
  pg_temp.claim('a7400000-0000-4000-8000-000000000007', 'a7700000-0000-4000-8000-000000000003'),
  'rejected', 'a7900000-0000-4000-8000-000000000132');
SELECT extensions.is(pg_temp.outcome_for('a7600000-0000-4000-8000-000000000012'),
  'prior_decision', 'rejection holds the waiting shift pending a successful appeal');
SELECT plugin_data.csf_submit_point_appeal(
  'a7100000-0000-4000-8000-000000000001',
  (SELECT id FROM plugin_data.csf_point_submissions WHERE profile_id='a7400000-0000-4000-8000-000000000007'
    AND opportunity_id='a7700000-0000-4000-8000-000000000003' AND status='rejected'),
  'The organizer verified this shift.', NULL,
  'a7000000-0000-4000-8000-000000000007', 'a7900000-0000-4000-8000-000000000133');
SELECT plugin_data.csf_review_point_appeal(
  'a7100000-0000-4000-8000-000000000001',
  (SELECT id FROM plugin_data.csf_point_appeals WHERE profile_id='a7400000-0000-4000-8000-000000000007' AND status='submitted'),
  'approved', 'Organizer evidence confirms this shift.',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000134');
SELECT extensions.ok(
  (SELECT status = 'submitted' AND earning_selection = '{"version":1,"items":[{"key":"midday"}]}'::jsonb
   FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000007'
     AND opportunity_id = 'a7700000-0000-4000-8000-000000000003' AND status = 'submitted'),
  'R7: appeal approval re-drives the separate waiting shift into a pending claim'
);

-- ---------------------------------------------------------------------------
-- N2: a staff "duplicate" decision is never reopened by source-side churn
-- ---------------------------------------------------------------------------

-- Member one attends the library day late; the only claim on this
-- certificate is the one staff mark duplicate.
INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status, check_in_time, check_out_time)
VALUES ('a7600000-0000-4000-8000-000000000023', 'a7500000-0000-4000-8000-000000000003',
  'a7000000-0000-4000-8000-000000000002', 'oneTime', 'attended', pg_temp.ended_fixture('2041-08-30T17:00:00Z')::timestamptz, pg_temp.ended_fixture('2041-08-30T19:00:00Z')::timestamptz);
SELECT pg_temp.review(
  pg_temp.claim('a7400000-0000-4000-8000-000000000002', 'a7700000-0000-4000-8000-000000000004'),
  'duplicate', 'a7900000-0000-4000-8000-000000000141');
UPDATE plugin_data.csf_profile_accounts SET status = 'revoked', revoked_at = now()
WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND user_id = 'a7000000-0000-4000-8000-000000000002';
UPDATE plugin_data.csf_profile_accounts SET status = 'verified', revoked_at = NULL
WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND user_id = 'a7000000-0000-4000-8000-000000000002';
SELECT pg_temp.retry('a7700000-0000-4000-8000-000000000004', 'a7900000-0000-4000-8000-000000000142');
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000002'
     AND opportunity_id = 'a7700000-0000-4000-8000-000000000004'
     AND status IN ('draft', 'submitted')),
  0,
  'N2: revoking and restoring the account does not reopen a duplicate decision'
);
SELECT extensions.is(
  pg_temp.outcome_for('a7600000-0000-4000-8000-000000000023'),
  'prior_decision',
  'N2: the certificate behind a duplicate decision is a prior decision'
);

-- ---------------------------------------------------------------------------
-- R4: guest claim in the app's statement order
-- ---------------------------------------------------------------------------

INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at)
VALUES ('a7800000-0000-4000-8000-000000000001', 'a7500000-0000-4000-8000-000000000001', 'guest-beach@local.test', 'Fixture Guest', now());
INSERT INTO public.project_signups (id, project_id, user_id, anonymous_id, schedule_id, status, check_in_time, check_out_time)
VALUES ('a7600000-0000-4000-8000-000000000013', 'a7500000-0000-4000-8000-000000000001', NULL,
  'a7800000-0000-4000-8000-000000000001', 'oneTime', 'attended', pg_temp.ended_fixture('2041-09-20T16:00:00Z')::timestamptz, pg_temp.ended_fixture('2041-09-20T18:00:00Z')::timestamptz);
-- app/anonymous/[id]/actions.ts: signups, then certificates, then the link.
UPDATE public.project_signups SET user_id = 'a7000000-0000-4000-8000-000000000006', anonymous_id = NULL
WHERE anonymous_id = 'a7800000-0000-4000-8000-000000000001' AND user_id IS NULL;
UPDATE public.certificates SET user_id = 'a7000000-0000-4000-8000-000000000006'
WHERE signup_id = 'a7600000-0000-4000-8000-000000000013' AND user_id IS NULL;
UPDATE public.anonymous_signups SET linked_user_id = 'a7000000-0000-4000-8000-000000000006'
WHERE id = 'a7800000-0000-4000-8000-000000000001';
SELECT extensions.is(
  (SELECT identity_origin FROM plugin_data.csf_attendance_evidence
   WHERE user_id = 'a7000000-0000-4000-8000-000000000006' AND state = 'active'),
  'guest_claim',
  'R4: a guest claim in app order is recorded as guest_claim'
);

-- ---------------------------------------------------------------------------
-- A removed activity keeps its existing submissions reviewable.
UPDATE plugin_data.csf_opportunities SET status='archived'
WHERE id='a7700000-0000-4000-8000-000000000001';
SELECT extensions.lives_ok($$SELECT plugin_data.csf_assert_point_submission_eligibility(
  'a7100000-0000-4000-8000-000000000001','a7400000-0000-4000-8000-000000000006',
  'a7200000-0000-4000-8000-000000000001','a7700000-0000-4000-8000-000000000001',NULL,
  'attendance',1,'non_drive',true,true,true)$$,
  'the forward draft preserves review of archived-activity submissions');
UPDATE plugin_data.csf_opportunities SET status='published'
WHERE id='a7700000-0000-4000-8000-000000000001';

-- R8: removed chapter members get no automatic claim
-- ---------------------------------------------------------------------------

UPDATE public.organization_members SET status = 'inactive'
WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND user_id = 'a7000000-0000-4000-8000-000000000003';
INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status, check_in_time, check_out_time)
VALUES ('a7600000-0000-4000-8000-000000000014', 'a7500000-0000-4000-8000-000000000002',
  'a7000000-0000-4000-8000-000000000003', pg_temp.ended_fixture('2041-10-04-0'), 'attended', pg_temp.ended_fixture('2041-10-04T16:00:00Z')::timestamptz, pg_temp.ended_fixture('2041-10-04T18:00:00Z')::timestamptz);
SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM plugin_data.csf_point_submissions
    WHERE profile_id = 'a7400000-0000-4000-8000-000000000003'
      AND opportunity_id = 'a7700000-0000-4000-8000-000000000003'),
  'R8: an inactive chapter organization member gets no automatic claim'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_attendance_evidence AS evidence
    WHERE evidence.user_id = 'a7000000-0000-4000-8000-000000000003'
      AND plugin_data.csf_attendance_evidence_is_current(evidence)
  ),
  'R8: evidence for an inactive chapter member is not current'
);

-- ---------------------------------------------------------------------------
-- R9: a paper row bound by email does not qualify
-- ---------------------------------------------------------------------------

INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status, check_in_time, check_out_time, source)
VALUES ('a7600000-0000-4000-8000-000000000015', 'a7500000-0000-4000-8000-000000000001',
  'a7000000-0000-4000-8000-000000000007', 'oneTime', 'attended', pg_temp.ended_fixture('2041-09-20T16:30:00Z')::timestamptz, pg_temp.ended_fixture('2041-09-20T18:30:00Z')::timestamptz, 'paper_scan');
SELECT extensions.is(
  pg_temp.outcome_for('a7600000-0000-4000-8000-000000000015'),
  'identity_unverified',
  'R9: a paper email match records identity_unverified'
);
SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM plugin_data.csf_point_submissions
    WHERE profile_id = 'a7400000-0000-4000-8000-000000000007'
      AND opportunity_id IN ('a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000002')),
  'R9: a paper email match creates no claim'
);

-- ---------------------------------------------------------------------------
-- R12: evidence last in the invalidation pass
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (SELECT strpos(definition, 'FROM plugin_data.csf_profiles AS profile') > 0
     AND strpos(definition, 'FROM plugin_data.csf_profiles AS profile')
       < strpos(definition, 'AND submission.id = ANY (v_affected_claims)')
     AND strpos(definition, 'FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.user_id IN')
       < strpos(definition, 'AND submission.id = ANY (v_affected_claims)')
   FROM pg_catalog.pg_get_functiondef(
     to_regprocedure('plugin_data.csf_project_attendance_run(uuid,uuid,uuid[],boolean,uuid[])')
   ) AS source(definition)),
  'R12: the invalidation pass locks profile and account before submissions and evidence'
);

-- Give every source a real, ended slot and a matching reviewed interval.
CREATE TEMP TABLE attendance_cap_sessions ON COMMIT DROP AS
WITH local_sessions AS (
  SELECT i,
    pg_temp.ended_fixture('2041-08-30')::date + time '09:00'
      + (i - 1) * interval '1 minute' AS local_start,
    pg_temp.ended_fixture('2041-08-30')::date + time '09:00'
      + i * interval '1 minute' AS local_end
  FROM generate_series(1,201) AS fixture(i)
)
SELECT i, local_start, local_end,
  local_start::date::text || '-' || (i - 1)::text AS schedule_id,
  local_start AT TIME ZONE 'America/Los_Angeles' AS event_start,
  local_end AT TIME ZONE 'America/Los_Angeles' AS event_end
FROM local_sessions;

INSERT INTO public.projects(id,creator_id,organization_id,title,location,description,event_type,verification_method,schedule,require_login,visibility,project_timezone)
SELECT 'a7500000-0000-4000-8000-000000000005',creator_id,organization_id,'Fictional cap event',location,description,'multiDay',verification_method,
  (SELECT jsonb_build_object('multiDay', jsonb_build_array(jsonb_build_object(
    'date', min(local_start)::date::text,
    'slots', jsonb_agg(jsonb_build_object(
      'startTime', to_char(local_start, 'HH24:MI'),
      'endTime', to_char(local_end, 'HH24:MI'),
      'volunteers', 1
    ) ORDER BY i)
  ))) FROM attendance_cap_sessions),
  require_login,visibility,'America/Los_Angeles'
FROM public.projects WHERE id='a7500000-0000-4000-8000-000000000003';
UPDATE plugin_data.csf_opportunities SET linked_project_id='a7500000-0000-4000-8000-000000000005'
WHERE id='a7700000-0000-4000-8000-000000000004';
-- Exactly 200 certificates run inline; the remaining source stays visible for replay.
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status,check_in_time,check_out_time)
SELECT ('a7ca0000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'a7500000-0000-4000-8000-000000000005','a7000000-0000-4000-8000-000000000006',
 schedule_id,'approved',event_start,event_end FROM attendance_cap_sessions;
INSERT INTO public.project_attendance_intervals(signup_id,project_id,check_in_time,check_out_time)
SELECT ('a7ca0000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'a7500000-0000-4000-8000-000000000005',event_start,event_end
FROM attendance_cap_sessions;
INSERT INTO public.certificates(id,project_id,signup_id,user_id,schedule_id,type,event_start,event_end,volunteer_name,project_title,organization_name,creator_name,is_certified,check_in_method)
SELECT ('a7cb0000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'a7500000-0000-4000-8000-000000000005',('a7ca0000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'a7000000-0000-4000-8000-000000000006',schedule_id,'verified',event_start,event_end,
 'Fixture Guest','Fictional cap event','Fictional partner','Fixture organizer',true,'manual'
FROM attendance_cap_sessions ORDER BY i;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_attendance_evidence
 WHERE certificate_id::text LIKE 'a7cb0000-%' AND state='active'),200,
 'inline projection processes the first 200 certificates');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_attendance_projection_outcomes
 WHERE certificate_id::text LIKE 'a7cb0000-%' AND outcome='deferred' AND sqlstate='54000'),1,
 'the 201st certificate remains a recorded deferred source');
SELECT pg_temp.retry('a7700000-0000-4000-8000-000000000004',gen_random_uuid());
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_attendance_evidence
 WHERE certificate_id::text LIKE 'a7cb0000-%' AND state='active'),201,
 'a staff replay processes the overflow without duplicating prior evidence');

SELECT * FROM extensions.finish();
ROLLBACK;
