-- Attendance-backed CSF point submissions. Fictional fixtures, rollback only.
-- Organizer publication, late paper attendance, guest claims, corrections,
-- account and membership changes, relinking, retry, and review all flow
-- through the real host and CSF transactions.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(72);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'plugin_data.csf_project_is_linkable(uuid,uuid)',
      'plugin_data.csf_certificates_attendance_projection()',
      'plugin_data.csf_project_attendance_sources(uuid,uuid,uuid[])',
      'plugin_data.csf_set_activity_attendance_submissions(uuid,uuid,text,uuid,uuid)',
      'plugin_data.csf_retry_activity_attendance_sync(uuid,uuid,uuid,uuid)',
      'plugin_data.csf_linked_project_attendance_summary(uuid,uuid)',
      'plugin_data.csf_attendance_submission_provenance(uuid,uuid)',
      'plugin_data.csf_stale_attendance_evidence_for_account()',
      'plugin_data.csf_stale_attendance_evidence_for_membership()',
      'plugin_data.csf_release_attendance_evidence_on_delete()',
      'plugin_data.csf_settle_attendance_claim(uuid,uuid)',
      'plugin_data.csf_invalidate_attendance_evidence(uuid,uuid[],text)',
      'plugin_data.csf_lock_attendance_wrapper(uuid,uuid,uuid,text[])',
      'plugin_data.csf_assert_point_submission_eligibility(uuid,uuid,uuid,uuid,uuid,text,numeric,text,boolean,boolean,boolean)',
      'plugin_data.csf_review_point_submission_v2(uuid,uuid,text,numeric,text,uuid)'
    ]) AS operation(signature)
    CROSS JOIN pg_catalog.unnest(ARRAY['anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(client.role_name::name, operation.signature, 'EXECUTE')
  ),
  'browser roles cannot execute any attendance projection function'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'plugin_data.csf_project_is_linkable(uuid,uuid)',
      'plugin_data.csf_certificates_attendance_projection()',
      'plugin_data.csf_project_attendance_sources(uuid,uuid,uuid[])',
      'plugin_data.csf_stale_attendance_evidence_for_account()',
      'plugin_data.csf_stale_attendance_evidence_for_membership()',
      'plugin_data.csf_release_attendance_evidence_on_delete()',
      'plugin_data.csf_settle_attendance_claim(uuid,uuid)',
      'plugin_data.csf_invalidate_attendance_evidence(uuid,uuid[],text)',
      'plugin_data.csf_lock_attendance_wrapper(uuid,uuid,uuid,text[])'
    ]) AS operation(signature)
    WHERE has_function_privilege('service_role', operation.signature, 'EXECUTE')
  ),
  'the service role cannot call the projection core, triggers, or owner-only helpers'
);
SELECT extensions.ok(
  (
    SELECT bool_and(has_function_privilege('service_role', operation.signature, 'EXECUTE'))
    FROM pg_catalog.unnest(ARRAY[
      'plugin_data.csf_set_activity_attendance_submissions(uuid,uuid,text,uuid,uuid)',
      'plugin_data.csf_retry_activity_attendance_sync(uuid,uuid,uuid,uuid)',
      'plugin_data.csf_linked_project_attendance_summary(uuid,uuid)',
      'plugin_data.csf_attendance_submission_provenance(uuid,uuid)'
    ]) AS operation(signature)
  ),
  'the service role can call the four server-authorized entry points'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_attendance_evidence', 'SELECT')
    AND NOT has_table_privilege('anon', 'plugin_data.csf_attendance_projection_outcomes', 'SELECT')
    AND NOT has_table_privilege('service_role', 'plugin_data.csf_attendance_evidence', 'INSERT')
    AND NOT has_table_privilege('service_role', 'plugin_data.csf_attendance_evidence', 'UPDATE'),
  'evidence and outcomes are not browser-readable and not directly writable'
);
SELECT extensions.ok(
  (SELECT count(*) FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.certificates'::regclass
     AND tgname LIKE 'csf_certificates_attendance_%'
     AND tgtype & 1 = 0) = 3,
  'three statement-level certificate triggers exist'
);
SELECT extensions.ok(
  (SELECT count(*)::integer FROM pg_catalog.pg_constraint AS c
   WHERE c.contype = 'f' AND c.confrelid = 'plugin_data.csf_profiles'::regclass
     AND c.conrelid IN ('plugin_data.csf_attendance_evidence'::regclass,
       'plugin_data.csf_attendance_projection_outcomes'::regclass)) = 0,
  'evidence and outcomes do not reference CSF profiles (V124 catalog unchanged)'
);

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
   '{"oneTime":{"date":"2041-09-20","startTime":"09:00","endTime":"12:00","volunteers":40}}', true, 'public', 'America/Los_Angeles'),
  ('a7500000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000005', 'a7100000-0000-4000-8000-000000000002',
   'Partner Food Bank Shifts', 'Warehouse', 'Fictional partner shifts', 'multiDay', 'manual',
   '{"multiDay":[{"date":"2041-10-04","slots":[{"startTime":"09:00","endTime":"11:00","volunteers":10},{"startTime":"11:00","endTime":"13:00","volunteers":10}]}]}',
   true, 'public', 'America/Los_Angeles'),
  ('a7500000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000005', 'a7100000-0000-4000-8000-000000000002',
   'Partner Library Day', 'Library', 'Fictional earlier event', 'oneTime', 'manual',
   '{"oneTime":{"date":"2041-08-30","startTime":"10:00","endTime":"12:00","volunteers":10}}', true, 'public', 'America/Los_Angeles'),
  ('a7500000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000005', 'a7100000-0000-4000-8000-000000000002',
   'Partner Staff Retreat', 'Office', 'Organization-only event', 'oneTime', 'manual',
   '{"oneTime":{"date":"2041-09-21","startTime":"09:00","endTime":"10:00","volunteers":5}}', true, 'organization_only', 'America/Los_Angeles');

INSERT INTO public.project_signups (id, project_id, user_id, anonymous_id, schedule_id, status)
VALUES
  ('a7600000-0000-4000-8000-000000000001', 'a7500000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', NULL, 'oneTime', 'approved'),
  ('a7600000-0000-4000-8000-000000000002', 'a7500000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003', NULL, 'oneTime', 'approved'),
  ('a7600000-0000-4000-8000-000000000003', 'a7500000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', NULL, 'oneTime', 'approved'),
  ('a7600000-0000-4000-8000-000000000004', 'a7500000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000009', NULL, 'oneTime', 'approved'),
  ('a7600000-0000-4000-8000-000000000011', 'a7500000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000007', NULL, '2041-10-04-0', 'approved'),
  ('a7600000-0000-4000-8000-000000000012', 'a7500000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000007', NULL, '2041-10-04-1', 'approved'),
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
   '{"version":1,"mode":"shifts","shiftPolicy":{"allowMultiple":true,"combinedMaxPoints":4},"components":[
     {"key":"morning","label":"Morning shift","category":"non_drive","kind":"shift","points":2,"startsAt":"2041-10-04T16:00:00Z","endsAt":"2041-10-04T18:00:00Z"},
     {"key":"midday","label":"Midday shift","category":"non_drive","kind":"shift","points":2,"startsAt":"2041-10-04T18:00:00Z","endsAt":"2041-10-04T20:00:00Z"}]}'::jsonb,
   NULL, now(), 'a7000000-0000-4000-8000-000000000001', now()),
  ('a7700000-0000-4000-8000-000000000004', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', NULL,
   'Library day', 'Partner library', 'published', 'lets_assist_project', 'a7500000-0000-4000-8000-000000000003',
   '/projects/a7500000-0000-4000-8000-000000000003', 1, 'non_drive', true, 'required', NULL, NULL, now(),
   'a7000000-0000-4000-8000-000000000001', now());

CREATE TEMP TABLE attendance_results (label text PRIMARY KEY, payload jsonb) ON COMMIT DROP;
GRANT ALL ON attendance_results TO service_role;

-- ---------------------------------------------------------------------------
-- Link predicate and opt-in
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  plugin_data.csf_project_is_linkable('a7100000-0000-4000-8000-000000000001', 'a7500000-0000-4000-8000-000000000001')
    AND NOT plugin_data.csf_project_is_linkable('a7100000-0000-4000-8000-000000000001', 'a7500000-0000-4000-8000-000000000004')
    AND plugin_data.csf_project_is_linkable('a7100000-0000-4000-8000-000000000002', 'a7500000-0000-4000-8000-000000000004'),
  'public partner projects and own projects are linkable; another organization''s private project is not'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_link_activity_project(
    'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004',
    'a7500000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000001',
    'a7900000-0000-4000-8000-000000000001')$$,
  'P0001', 'Linked project is not available to this organization.',
  'linking an organization-only partner project is refused with the contract message'
);
SELECT extensions.is(
  (SELECT attendance_submission_mode FROM plugin_data.csf_opportunities WHERE id = 'a7700000-0000-4000-8000-000000000001'),
  'off',
  'existing linked activities stay off until a coordinator opts in'
);

-- Before enabling, publication creates nothing.
SELECT public.publish_volunteer_hours_transactional(
  'a7000000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000003', 'oneTime',
  '[{"signupId":"a7600000-0000-4000-8000-000000000021","checkIn":"2041-08-30T17:00:00Z","checkOut":"2041-08-30T19:00:00Z"}]'::jsonb,
  'hours-publication:v1:3333333333333333333333333333333333333333333333333333333333333333'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions WHERE opportunity_id = 'a7700000-0000-4000-8000-000000000004'),
  0,
  'publication on a linked project with automatic submissions off creates no claim'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_activity_attendance_submissions(
    'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000001', 'pending_submission',
    'a7000000-0000-4000-8000-000000000008', 'a7900000-0000-4000-8000-000000000002')$$,
  '42501', 'Not authorized to manage CSF activities.',
  'another chapter''s officer cannot enable automatic submissions'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_activity_attendance_submissions(
    'a7100000-0000-4000-8000-000000000003', 'a7700000-0000-4000-8000-000000000001', 'pending_submission',
    'a7000000-0000-4000-8000-000000000008', 'a7900000-0000-4000-8000-000000000003')$$,
  'P0001', 'CSF activity was not found in this organization.',
  'an activity from another tenant is not found through a different organization id'
);

INSERT INTO attendance_results
SELECT 'enable-library', plugin_data.csf_set_activity_attendance_submissions(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004', 'pending_submission',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000004');
SELECT extensions.is(
  (SELECT payload -> 'backfill' ->> 'projected' FROM attendance_results WHERE label = 'enable-library'),
  '1',
  'enabling after publication backfills the already-published verified attendance'
);
SELECT extensions.ok(
  (SELECT source = 'attendance' AND status = 'submitted' AND submitted_by IS NULL AND claimed_points = 1
     AND suggested_points = 1 AND activity_date = '2041-08-30'
   FROM plugin_data.csf_point_submissions WHERE opportunity_id = 'a7700000-0000-4000-8000-000000000004'),
  'the backfilled claim is a pending system submission with rule-calculated points'
);
SELECT extensions.is(
  plugin_data.csf_set_activity_attendance_submissions(
    'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004', 'pending_submission',
    'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000004') ->> 'idempotent',
  'true',
  'an exact replay of the enable request returns its receipt'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_activity_attendance_submissions(
    'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004', 'off',
    'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000004')$$,
  'P0001', 'That activity request identifier is already bound to a different change.',
  'a conflicting replay of the enable request is refused'
);

INSERT INTO attendance_results
SELECT 'enable-beach', plugin_data.csf_set_activity_attendance_submissions(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000001', 'pending_submission',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000005');
INSERT INTO attendance_results
SELECT 'enable-beach-duplicate', plugin_data.csf_set_activity_attendance_submissions(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000002', 'pending_submission',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000006');
INSERT INTO attendance_results
SELECT 'enable-shifts', plugin_data.csf_set_activity_attendance_submissions(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000003', 'pending_submission',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000007');

-- ---------------------------------------------------------------------------
-- Organizer publication
-- ---------------------------------------------------------------------------

INSERT INTO attendance_results
SELECT 'publish-beach', public.publish_volunteer_hours_transactional(
  'a7000000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000001', 'oneTime',
  '[{"signupId":"a7600000-0000-4000-8000-000000000001","checkIn":"2041-09-20T16:00:00Z","checkOut":"2041-09-20T19:00:00Z"},
    {"signupId":"a7600000-0000-4000-8000-000000000002","checkIn":"2041-09-20T16:00:00Z","checkOut":"2041-09-20T18:00:00Z"},
    {"signupId":"a7600000-0000-4000-8000-000000000003","checkIn":"2041-09-20T16:00:00Z","checkOut":"2041-09-20T19:00:00Z"},
    {"signupId":"a7600000-0000-4000-8000-000000000004","checkIn":"2041-09-20T16:00:00Z","checkOut":"2041-09-20T19:00:00Z"}]'::jsonb,
  'hours-publication:v1:1111111111111111111111111111111111111111111111111111111111111111'
);
SELECT extensions.is(
  (SELECT payload ->> 'outcome' FROM attendance_results WHERE label = 'publish-beach'),
  'accepted',
  'the partner organizer''s publication commits normally'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE opportunity_id IN ('a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000002')
     AND source = 'attendance' AND status = 'submitted'),
  2,
  'the two eligible chapter members each get one pending submission'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE opportunity_id = 'a7700000-0000-4000-8000-000000000002'),
  0,
  'a second activity linked to the same project cannot claim the same certificates'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_attendance_evidence
   WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND state = 'active'
     AND project_id = 'a7500000-0000-4000-8000-000000000001'),
  2,
  'one active evidence row per eligible certificate'
);
SELECT extensions.is(
  (SELECT outcome FROM plugin_data.csf_attendance_projection_outcomes o
   JOIN public.certificates c ON c.id = o.certificate_id
   WHERE c.signup_id = 'a7600000-0000-4000-8000-000000000004'),
  'not_member',
  'a verified account without an accepted or active membership records not_member'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_attendance_projection_outcomes o
   JOIN public.certificates c ON c.id = o.certificate_id
   WHERE c.signup_id = 'a7600000-0000-4000-8000-000000000003'),
  0,
  'a stranger''s certificate on the partner project is never recorded by the chapter'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records
   WHERE organization_id = 'a7100000-0000-4000-8000-000000000001'),
  0,
  'no credit exists before staff approval'
);
SELECT extensions.is(
  public.publish_volunteer_hours_transactional(
    'a7000000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000001', 'oneTime',
    '[{"signupId":"a7600000-0000-4000-8000-000000000001","checkIn":"2041-09-20T16:00:00Z","checkOut":"2041-09-20T19:00:00Z"},
      {"signupId":"a7600000-0000-4000-8000-000000000002","checkIn":"2041-09-20T16:00:00Z","checkOut":"2041-09-20T18:00:00Z"},
      {"signupId":"a7600000-0000-4000-8000-000000000003","checkIn":"2041-09-20T16:00:00Z","checkOut":"2041-09-20T19:00:00Z"},
      {"signupId":"a7600000-0000-4000-8000-000000000004","checkIn":"2041-09-20T16:00:00Z","checkOut":"2041-09-20T19:00:00Z"}]'::jsonb,
    'hours-publication:v1:1111111111111111111111111111111111111111111111111111111111111111'
  ) ->> 'outcome',
  'replayed',
  'a duplicate publication replays the host receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND source = 'attendance'),
  3,
  'duplicate publication creates no additional claim'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_attendance_projection_outcomes
   WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND outcome = 'projected'),
  3,
  'projection outcomes are idempotent by certificate'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'a7100000-0000-4000-8000-000000000001'
     AND source_type = 'attendance_projection' AND action = 'point_submission.attendance_created'),
  3,
  'each created claim has exactly one immutable projection audit'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'a7100000-0000-4000-8000-000000000001'
      AND source_type = 'attendance_projection'
      AND (coalesce(after_data::text, '') ILIKE '%@local.test%' OR coalesce(after_data::text, '') ILIKE '%Fixture%')
  ),
  'projection audits carry identifiers and digests, not names or emails'
);

-- A member cannot open a second claim for the same activity.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_begin_point_submission_request_v2(
    'a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000002',
    'a7200000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000001', NULL,
    'student', 'Beach cleanup', 2, 'non_drive', '2041-09-20',
    'a7000000-0000-4000-8000-000000000002', 'proof.pdf', 'application/pdf', 1000,
    repeat('a', 64), 'a7900000-0000-4000-8000-000000000008', NULL)$$,
  '23505', NULL,
  'a manual claim cannot duplicate an active attendance claim for the same activity'
);

-- ---------------------------------------------------------------------------
-- Review: evidence satisfies required proof; approval awards credit once
-- ---------------------------------------------------------------------------

INSERT INTO attendance_results
SELECT 'approve-one', plugin_data.csf_review_point_submission_request(
  'a7100000-0000-4000-8000-000000000001',
  (SELECT id FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000002' AND opportunity_id = 'a7700000-0000-4000-8000-000000000001'),
  'approved', NULL, NULL, 'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000009');
SELECT extensions.is(
  (SELECT points FROM plugin_data.csf_credit_records
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000002' AND status = 'verified'),
  2.00::numeric(6,2),
  'staff approval of an evidence-backed claim with required proof awards the calculated points'
);

-- Provenance and summary
SELECT extensions.is(
  (SELECT jsonb_array_length(plugin_data.csf_attendance_submission_provenance(
    'a7100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_submissions
     WHERE profile_id = 'a7400000-0000-4000-8000-000000000002' AND opportunity_id = 'a7700000-0000-4000-8000-000000000001')
  ) -> 'evidence')),
  1,
  'provenance returns the organizer evidence for one claim'
);
SELECT extensions.is(
  (SELECT jsonb_array_length(plugin_data.csf_attendance_submission_provenance(
    'a7100000-0000-4000-8000-000000000003',
    (SELECT id FROM plugin_data.csf_point_submissions
     WHERE profile_id = 'a7400000-0000-4000-8000-000000000002' AND opportunity_id = 'a7700000-0000-4000-8000-000000000001')
  ) -> 'evidence')),
  0,
  'provenance is organization-scoped'
);
SELECT extensions.results_eq(
  $$SELECT plugin_data.csf_linked_project_attendance_summary(
    'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000001') - 'lastProjectedAt'$$,
  $$VALUES ('{"state":"enabled","verifiedMembers":2,"pendingSubmissions":1,"needsStaffAttention":0}'::jsonb)$$,
  'the summary counts only chapter members and pending attendance claims'
);

-- ---------------------------------------------------------------------------
-- Account revocation and inactive membership (C4)
-- ---------------------------------------------------------------------------

UPDATE plugin_data.csf_profile_accounts SET status = 'revoked', revoked_at = now()
WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND user_id = 'a7000000-0000-4000-8000-000000000003';
SELECT extensions.is(
  (SELECT state || ':' || invalidation_reason FROM plugin_data.csf_attendance_evidence
   WHERE user_id = 'a7000000-0000-4000-8000-000000000003' AND project_id = 'a7500000-0000-4000-8000-000000000001'),
  'stale:account_revoked',
  'revoking the account link marks its organizer evidence stale immediately'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_review_point_submission_request(
    'a7100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_point_submissions
     WHERE profile_id = 'a7400000-0000-4000-8000-000000000003' AND opportunity_id = 'a7700000-0000-4000-8000-000000000001'),
    'approved', NULL, NULL, 'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000010')$$,
  '55000', 'Organizer evidence no longer valid. Retry attendance sync or reject this claim.',
  'review refuses to approve an attendance claim without current evidence'
);
INSERT INTO attendance_results
SELECT 'retry-beach', plugin_data.csf_retry_activity_attendance_sync(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000001',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000011');
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000003' AND opportunity_id = 'a7700000-0000-4000-8000-000000000001'),
  'withdrawn',
  'retry settles the system-only claim that lost all evidence'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM plugin_data.csf_submission_reviews r
    JOIN plugin_data.csf_point_submissions s ON s.id = r.submission_id
    WHERE s.profile_id = 'a7400000-0000-4000-8000-000000000003' AND r.action = 'source_withdrawn'),
  'the withdrawal carries a system review row'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000002' AND opportunity_id = 'a7700000-0000-4000-8000-000000000001'),
  'approved',
  'an approved claim is never changed by projection'
);

-- ---------------------------------------------------------------------------
-- Multi-slot shifts: time-window matching, accumulation, caps
-- ---------------------------------------------------------------------------

SELECT public.publish_volunteer_hours_transactional(
  'a7000000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000002', '2041-10-04-0',
  '[{"signupId":"a7600000-0000-4000-8000-000000000011","checkIn":"2041-10-04T16:00:00Z","checkOut":"2041-10-04T18:00:00Z"}]'::jsonb,
  'hours-publication:v1:4444444444444444444444444444444444444444444444444444444444444444'
);
SELECT extensions.ok(
  (SELECT claimed_points = 2 AND earning_selection = '{"version":1,"items":[{"key":"morning"}]}'::jsonb
   FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000007' AND opportunity_id = 'a7700000-0000-4000-8000-000000000003'),
  'the first slot maps to the morning shift by its scheduled window'
);
SELECT public.publish_volunteer_hours_transactional(
  'a7000000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000002', '2041-10-04-1',
  '[{"signupId":"a7600000-0000-4000-8000-000000000012","checkIn":"2041-10-04T18:05:00Z","checkOut":"2041-10-04T19:55:00Z"}]'::jsonb,
  'hours-publication:v1:5555555555555555555555555555555555555555555555555555555555555555'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000007' AND opportunity_id = 'a7700000-0000-4000-8000-000000000003'),
  1,
  'the second slot accumulates into the same active claim'
);
SELECT extensions.ok(
  (SELECT claimed_points = 3 AND suggested_points = 3
     AND earning_selection = '{"version":1,"items":[{"key":"midday"},{"key":"morning"}]}'::jsonb
   FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000007' AND opportunity_id = 'a7700000-0000-4000-8000-000000000003'),
  'two shifts worth four points are capped by the semester activity limit of three'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE source_type = 'attendance_projection' AND action = 'point_submission.attendance_recomputed'
     AND target_id = (SELECT id FROM plugin_data.csf_point_submissions
       WHERE profile_id = 'a7400000-0000-4000-8000-000000000007' AND opportunity_id = 'a7700000-0000-4000-8000-000000000003')),
  1,
  'the recomputation is audited once'
);

-- ---------------------------------------------------------------------------
-- Guest claims an account after publication (C7)
-- ---------------------------------------------------------------------------

INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at)
VALUES ('a7800000-0000-4000-8000-000000000001', 'a7500000-0000-4000-8000-000000000002', 'guest-shift@local.test', 'Fixture Guest', now());
INSERT INTO public.project_signups (id, project_id, user_id, anonymous_id, schedule_id, status, check_in_time, check_out_time)
VALUES ('a7600000-0000-4000-8000-000000000013', 'a7500000-0000-4000-8000-000000000002', NULL,
  'a7800000-0000-4000-8000-000000000001', '2041-10-04-0', 'attended', '2041-10-04T16:00:00Z', '2041-10-04T18:00:00Z');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.certificates WHERE signup_id = 'a7600000-0000-4000-8000-000000000013' AND user_id IS NULL),
  1,
  'late guest attendance on a published slot receives a guest certificate'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions WHERE profile_id = 'a7400000-0000-4000-8000-000000000006'),
  0,
  'a guest certificate never produces a submission'
);
UPDATE public.anonymous_signups SET linked_user_id = 'a7000000-0000-4000-8000-000000000006'
WHERE id = 'a7800000-0000-4000-8000-000000000001';
UPDATE public.project_signups SET user_id = 'a7000000-0000-4000-8000-000000000006', anonymous_id = NULL
WHERE anonymous_id = 'a7800000-0000-4000-8000-000000000001';
UPDATE public.certificates SET user_id = 'a7000000-0000-4000-8000-000000000006'
WHERE signup_id = 'a7600000-0000-4000-8000-000000000013' AND user_id IS NULL;
SELECT extensions.is(
  (SELECT identity_origin FROM plugin_data.csf_attendance_evidence
   WHERE user_id = 'a7000000-0000-4000-8000-000000000006' AND state = 'active'),
  'guest_claim',
  'claiming the guest certificate projects it with a guest_claim identity origin'
);

-- ---------------------------------------------------------------------------
-- Late attendance after publication on an existing digital signup (a paper row
-- that matched it keeps its identity; see R9 for email-bound paper rows)
-- ---------------------------------------------------------------------------

INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status, check_in_time, check_out_time, source)
VALUES ('a7600000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000001',
  'a7000000-0000-4000-8000-000000000007', 'oneTime', 'attended', '2041-09-20T16:30:00Z', '2041-09-20T18:30:00Z', 'digital');
SELECT extensions.ok(
  (SELECT source = 'attendance' AND status = 'submitted' AND claimed_points = 2
   FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000007' AND opportunity_id = 'a7700000-0000-4000-8000-000000000001'),
  'late attendance on a published session creates the pending claim in the same transaction'
);

-- ---------------------------------------------------------------------------
-- Manual claim first, then organizer evidence attaches
-- ---------------------------------------------------------------------------

INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES ('a7600000-0000-4000-8000-000000000022', 'a7500000-0000-4000-8000-000000000003',
  'a7000000-0000-4000-8000-000000000002', 'oneTime', 'approved');
INSERT INTO attendance_results
SELECT 'manual-begin', plugin_data.csf_begin_point_submission_request_v2(
  'a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000002',
  'a7200000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004', NULL,
  'student', 'I sorted books', 1, 'non_drive', '2041-08-30',
  'a7000000-0000-4000-8000-000000000002', 'proof.pdf', 'application/pdf', 1000,
  repeat('b', 64), 'a7900000-0000-4000-8000-000000000012', NULL);
UPDATE public.project_signups
SET status = 'attended', check_in_time = '2041-08-30T17:00:00Z', check_out_time = '2041-08-30T19:00:00Z'
WHERE id = 'a7600000-0000-4000-8000-000000000022';
SELECT extensions.ok(
  (SELECT s.source = 'student' AND s.description = 'I sorted books'
     AND EXISTS (SELECT 1 FROM plugin_data.csf_attendance_evidence e WHERE e.submission_id = s.id AND e.state = 'active')
   FROM plugin_data.csf_point_submissions s
   WHERE s.profile_id = 'a7400000-0000-4000-8000-000000000002' AND s.opportunity_id = 'a7700000-0000-4000-8000-000000000004'),
  'organizer evidence attaches to the member''s own claim without changing its source or text'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000002' AND opportunity_id = 'a7700000-0000-4000-8000-000000000004'),
  1,
  'publication after a manual claim creates no duplicate claim'
);

-- ---------------------------------------------------------------------------
-- Member Unsubmit is a durable decline (C6)
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_delete_member_point_submission_request(
    'a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000007',
    (SELECT id FROM plugin_data.csf_point_submissions
     WHERE profile_id = 'a7400000-0000-4000-8000-000000000007' AND opportunity_id = 'a7700000-0000-4000-8000-000000000001'),
    'a7000000-0000-4000-8000-000000000007', 'a7900000-0000-4000-8000-000000000013')$$,
  'a member can Unsubmit an unreviewed attendance claim'
);
SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM plugin_data.csf_attendance_evidence
    WHERE signup_id = 'a7600000-0000-4000-8000-000000000005')
  AND (SELECT o.outcome FROM plugin_data.csf_attendance_projection_outcomes o
       JOIN public.certificates c ON c.id = o.certificate_id
       WHERE c.signup_id = 'a7600000-0000-4000-8000-000000000005') = 'released',
  'Unsubmit deletes the evidence with the claim and keeps an identity-free decline marker'
);
SELECT plugin_data.csf_retry_activity_attendance_sync(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000001',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000014');
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000007' AND opportunity_id = 'a7700000-0000-4000-8000-000000000001'),
  0,
  'retry never recreates a declined claim'
);

-- ---------------------------------------------------------------------------
-- Certificate removal and detach
-- ---------------------------------------------------------------------------

DELETE FROM public.certificates WHERE signup_id = 'a7600000-0000-4000-8000-000000000013';
SELECT extensions.is(
  (SELECT state || ':' || invalidation_reason FROM plugin_data.csf_attendance_evidence
   WHERE signup_id = 'a7600000-0000-4000-8000-000000000013'),
  'stale:certificate_removed',
  'deleting a certificate marks its evidence stale'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE profile_id = 'a7400000-0000-4000-8000-000000000006'),
  'withdrawn',
  'a system-only claim with no remaining evidence is withdrawn in the same transaction'
);
DELETE FROM public.project_signups WHERE id = 'a7600000-0000-4000-8000-000000000012';
SELECT extensions.is(
  (SELECT state || ':' || invalidation_reason FROM plugin_data.csf_attendance_evidence
   WHERE signup_id = 'a7600000-0000-4000-8000-000000000012'),
  'stale:certificate_removed',
  'detaching a certificate from its signup marks the evidence stale'
);
SELECT extensions.ok(
  (SELECT status = 'submitted' AND claimed_points = 2
     AND earning_selection = '{"version":1,"items":[{"key":"morning"}]}'::jsonb
   FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000007' AND opportunity_id = 'a7700000-0000-4000-8000-000000000003'),
  'the multi-slot claim is recomputed from its remaining evidence'
);

-- ---------------------------------------------------------------------------
-- Inactive membership and closed term
-- ---------------------------------------------------------------------------

UPDATE plugin_data.csf_term_memberships SET status = 'withdrawn'
WHERE profile_id = 'a7400000-0000-4000-8000-000000000007' AND term_id = 'a7200000-0000-4000-8000-000000000001';
SELECT extensions.is(
  (SELECT state || ':' || invalidation_reason FROM plugin_data.csf_attendance_evidence
   WHERE signup_id = 'a7600000-0000-4000-8000-000000000011'),
  'stale:membership_inactive',
  'an inactive membership marks the member''s evidence stale'
);
UPDATE plugin_data.csf_term_memberships SET status = 'accepted'
WHERE profile_id = 'a7400000-0000-4000-8000-000000000007' AND term_id = 'a7200000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, status, signup_mode, linked_project_id,
  signup_url, point_value, point_type, requires_point_submission, evidence_policy,
  attendance_submission_mode, published_at, created_by_user_id
) VALUES (
  'a7700000-0000-4000-8000-000000000005', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000002',
  'Next term cleanup', 'Planned term', 'published', 'lets_assist_project', 'a7500000-0000-4000-8000-000000000004',
  '/projects/a7500000-0000-4000-8000-000000000004', 1, 'non_drive', true, 'optional', 'pending_submission', now(),
  'a7000000-0000-4000-8000-000000000001'
);
UPDATE public.projects SET visibility = 'public' WHERE id = 'a7500000-0000-4000-8000-000000000004';
INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES ('a7600000-0000-4000-8000-000000000031', 'a7500000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000002', 'oneTime', 'approved');
SELECT public.publish_volunteer_hours_transactional(
  'a7000000-0000-4000-8000-000000000005', 'a7500000-0000-4000-8000-000000000004', 'oneTime',
  '[{"signupId":"a7600000-0000-4000-8000-000000000031","checkIn":"2041-09-21T16:00:00Z","checkOut":"2041-09-21T17:00:00Z"}]'::jsonb,
  'hours-publication:v1:6666666666666666666666666666666666666666666666666666666666666666'
);
SELECT extensions.is(
  (SELECT outcome FROM plugin_data.csf_attendance_projection_outcomes o JOIN public.certificates c ON c.id = o.certificate_id
   WHERE c.signup_id = 'a7600000-0000-4000-8000-000000000031'),
  'term_closed',
  'attendance for an activity outside the current open semester records term_closed'
);

-- ---------------------------------------------------------------------------
-- Partner hidden after link, unlink, relink
-- ---------------------------------------------------------------------------

UPDATE public.projects SET visibility = 'organization_only' WHERE id = 'a7500000-0000-4000-8000-000000000002';
SELECT plugin_data.csf_retry_activity_attendance_sync(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000003',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000015');
SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM plugin_data.csf_attendance_evidence
    WHERE project_id = 'a7500000-0000-4000-8000-000000000002' AND state = 'active')
  AND (SELECT outcome FROM plugin_data.csf_attendance_projection_outcomes o JOIN public.certificates c ON c.id = o.certificate_id
       WHERE c.signup_id = 'a7600000-0000-4000-8000-000000000011') = 'project_unavailable',
  'a partner project hidden after linking yields project_unavailable and no active evidence'
);
UPDATE public.projects SET visibility = 'public' WHERE id = 'a7500000-0000-4000-8000-000000000002';

SELECT plugin_data.csf_update_activity(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004',
  'a7200000-0000-4000-8000-000000000001', NULL,
  '{"title":"Library day","body":"Moved","signupMode":"lets_assist_project","linkedProjectId":"a7500000-0000-4000-8000-000000000001","pointType":"non_drive","pointValue":1,"requiresPointSubmission":true,"evidencePolicy":"required","signupUrl":""}'::jsonb,
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000016');
SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM plugin_data.csf_attendance_evidence
    WHERE opportunity_id = 'a7700000-0000-4000-8000-000000000004' AND state = 'active')
  AND EXISTS (SELECT 1 FROM plugin_data.csf_attendance_evidence
    WHERE opportunity_id = 'a7700000-0000-4000-8000-000000000004' AND invalidation_reason = 'activity_relinked'),
  'relinking an activity marks its evidence for the old project stale'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions
   WHERE profile_id = 'a7400000-0000-4000-8000-000000000003' AND opportunity_id = 'a7700000-0000-4000-8000-000000000004'),
  'withdrawn',
  'the next certificate event on that project already settled the revoked member''s claim'
);
SELECT plugin_data.csf_retry_activity_attendance_sync(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000017');
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_submission_reviews r
   JOIN plugin_data.csf_point_submissions s ON s.id = r.submission_id
   WHERE s.profile_id = 'a7400000-0000-4000-8000-000000000003'
     AND s.opportunity_id = 'a7700000-0000-4000-8000-000000000004'
     AND r.action = 'source_withdrawn'),
  1,
  'repeated settlement after a relink is idempotent'
);
SELECT plugin_data.csf_update_activity(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004',
  'a7200000-0000-4000-8000-000000000001', NULL,
  '{"title":"Library day","body":"Back","signupMode":"lets_assist_project","linkedProjectId":"a7500000-0000-4000-8000-000000000003","pointType":"non_drive","pointValue":1,"requiresPointSubmission":true,"evidencePolicy":"required","signupUrl":""}'::jsonb,
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000018');
SELECT plugin_data.csf_retry_activity_attendance_sync(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000004',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000019');
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_attendance_evidence
   WHERE opportunity_id = 'a7700000-0000-4000-8000-000000000004' AND state = 'active'),
  1,
  'relinking back reattaches fresh evidence; stale rows do not block reattachment'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE opportunity_id = 'a7700000-0000-4000-8000-000000000004' AND status NOT IN ('withdrawn', 'rejected')),
  1,
  'relink produces no duplicate active claim; the revoked account gets none'
);

-- ---------------------------------------------------------------------------
-- Forced failure: the host publication commits; retry recovers
-- ---------------------------------------------------------------------------

INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES ('a7600000-0000-4000-8000-000000000041', 'a7500000-0000-4000-8000-000000000002',
  'a7000000-0000-4000-8000-000000000003', '2041-10-04-1', 'approved');
UPDATE plugin_data.csf_profile_accounts SET status = 'verified', revoked_at = NULL
WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND user_id = 'a7000000-0000-4000-8000-000000000003';
ALTER TABLE plugin_data.csf_point_submissions
  ADD CONSTRAINT attendance_fixture_forced_failure CHECK (source <> 'attendance' OR claimed_points > 99) NOT VALID;
SELECT extensions.lives_ok(
  $$UPDATE public.project_signups
    SET status = 'attended', check_in_time = '2041-10-04T18:00:00Z', check_out_time = '2041-10-04T20:00:00Z'
    WHERE id = 'a7600000-0000-4000-8000-000000000041'$$,
  'a CSF projection failure never fails the host late-attendance write'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM public.certificates WHERE signup_id = 'a7600000-0000-4000-8000-000000000041' AND type = 'verified')
  AND (SELECT outcome || ':' || sqlstate FROM plugin_data.csf_attendance_projection_outcomes o
       JOIN public.certificates c ON c.id = o.certificate_id
       WHERE c.signup_id = 'a7600000-0000-4000-8000-000000000041') = 'failed:23514',
  'the certificate commits and the chapter records a SQLSTATE-only failure'
);
ALTER TABLE plugin_data.csf_point_submissions DROP CONSTRAINT attendance_fixture_forced_failure;
SELECT plugin_data.csf_retry_activity_attendance_sync(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000003',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000020');
SELECT extensions.is(
  (SELECT outcome FROM plugin_data.csf_attendance_projection_outcomes o JOIN public.certificates c ON c.id = o.certificate_id
   WHERE c.signup_id = 'a7600000-0000-4000-8000-000000000041'),
  'projected',
  'the staff retry replays the failed source into a pending claim'
);

-- ---------------------------------------------------------------------------
-- Disable and V132 grants
-- ---------------------------------------------------------------------------

INSERT INTO attendance_results
SELECT 'disable-shifts', plugin_data.csf_set_activity_attendance_submissions(
  'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000003', 'off',
  'a7000000-0000-4000-8000-000000000001', 'a7900000-0000-4000-8000-000000000021');
SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM plugin_data.csf_attendance_evidence
    WHERE opportunity_id = 'a7700000-0000-4000-8000-000000000003' AND state = 'active')
  AND (SELECT status FROM plugin_data.csf_point_submissions
       WHERE profile_id = 'a7400000-0000-4000-8000-000000000003' AND opportunity_id = 'a7700000-0000-4000-8000-000000000003') = 'withdrawn',
  'turning automatic submissions off stales evidence and withdraws system-only claims'
);
SELECT extensions.is(
  plugin_data.csf_linked_project_attendance_summary(
    'a7100000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000003') ->> 'state',
  'disabled',
  'the summary never reports sync for a disabled activity'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records
   WHERE organization_id = 'a7100000-0000-4000-8000-000000000001'),
  1,
  'only the one staff-approved claim holds credit'
);
SELECT extensions.throws_ok(
  $$DELETE FROM plugin_data.csf_attendance_evidence WHERE organization_id = 'a7100000-0000-4000-8000-000000000001'$$,
  '55000', 'CSF attendance evidence is retained; mark it stale instead.',
  'evidence cannot be deleted directly'
);
SELECT extensions.throws_ok(
  $$UPDATE plugin_data.csf_attendance_evidence SET event_end = event_end + interval '1 hour'
    WHERE organization_id = 'a7100000-0000-4000-8000-000000000001'$$,
  '55000', 'CSF attendance evidence snapshots are immutable.',
  'evidence snapshots are immutable'
);
SELECT extensions.throws_ok(
  $$UPDATE plugin_data.csf_attendance_evidence SET state = 'active', invalidated_at = NULL, invalidation_reason = NULL
    WHERE organization_id = 'a7100000-0000-4000-8000-000000000001' AND state = 'stale'$$,
  '55000', 'Invalidated CSF attendance evidence cannot be reactivated.',
  'stale evidence cannot be reactivated'
);

SELECT * FROM extensions.finish();
ROLLBACK;
