-- Membership-application review campaigns.
--
-- Two things are proved here. First, a period only accepts decisions and notes
-- for the subject kind it actually reviews. Second, the application freeze
-- trigger is inert for every caller that exists today and bites only the
-- applicant, which is the whole claim behind adding it as defense in depth.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(16);

-- ---------------------------------------------------------------------------
-- A. Subject mapping
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  plugin_data.csf_review_subject_kind_for('member_points')::text,
  'profile',
  'a member point campaign reviews profiles'
);
SELECT extensions.is(
  plugin_data.csf_review_subject_kind_for('club_audit')::text,
  'partner_club',
  'a club audit reviews partner clubs'
);
SELECT extensions.is(
  plugin_data.csf_review_subject_kind_for('membership_applications')::text,
  'application',
  'a membership campaign reviews applications'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_review_subject_kind_for(plugin_data.csf_review_period_kind)',
    'EXECUTE'
  ),
  'authenticated clients cannot read the subject mapping'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_review_subject_kind_for(plugin_data.csf_review_period_kind)',
    'EXECUTE'
  ),
  'the server role can read the subject mapping'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('cf000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-app-officer@local.test', now(), '{}', '{}', now(), now()),
  ('cf000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-app-applicant@local.test', now(), '{}', '{}', now(), now()),
  ('cf000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'csf-app-stranger@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'CSF Application Review',
  'csf-application-review',
  'school',
  '740001'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('cf100000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester)
VALUES (
  'cf200000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'F28', 'Fall 2028', '2028-2029', 'fall'
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES (
  'cf500000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  2032, 'c/o 2032', 'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES (
  'cf300000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'Remy', 'Okafor', 'remy', 'okafor'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary, linked_at
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000002',
  'verified', true, now()
);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES (
  'cf400000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'native', 'submitted'
);

-- Both campaigns can run on one term, because the unique key is per kind.
SELECT plugin_data.csf_set_review_period(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'membership_applications', 'open', 'Fall 2028 application review'
);

SELECT plugin_data.csf_set_review_period(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'member_points', 'open', 'Fall 2028 point verification'
);

-- ---------------------------------------------------------------------------
-- C. A period only accepts the subject kind it reviews
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'cf100000-0000-4000-8000-000000000001',
        'cf000000-0000-4000-8000-000000000001',
        %L, 'profile', 'cf300000-0000-4000-8000-000000000001', 'approved'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'A membership_applications period reviews application subjects, not profile.',
  'a profile verdict cannot be filed inside an application campaign'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'cf100000-0000-4000-8000-000000000001',
        'cf000000-0000-4000-8000-000000000001',
        %L, 'application', 'cf400000-0000-4000-8000-000000000001', 'approved'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
        AND kind = 'member_points')
  ),
  '23514',
  'A member_points period reviews profile subjects, not application.',
  'an application verdict cannot be filed inside a point campaign'
);

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'cf100000-0000-4000-8000-000000000001',
        'cf000000-0000-4000-8000-000000000001',
        %L, 'application', 'cf400000-0000-4000-8000-000000000001', 'approved'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  'an application verdict is recorded in the application campaign'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_add_review_note(
        'cf100000-0000-4000-8000-000000000001',
        'cf000000-0000-4000-8000-000000000001',
        %L, 'profile', 'cf300000-0000-4000-8000-000000000001', 'wrong subject kind'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'A membership_applications period reviews application subjects, not profile.',
  'a note follows the same subject rule as a decision'
);

-- ---------------------------------------------------------------------------
-- D. The freeze trigger
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_term_applications
       SET review_notes = 'server-side staff edit'
     WHERE id = 'cf400000-0000-4000-8000-000000000001'
  $$,
  'the trigger is inert for the server role, which is every caller today'
);

-- From here on the session looks like the applicant's own browser.
SELECT set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000002', true);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_term_applications
       SET review_notes = 'applicant self-edit'
     WHERE id = 'cf400000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'Application review is open; this application is locked.',
  'the applicant cannot edit their own application while review is open'
);

-- A different signed-in person is not this application's applicant.
SELECT set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000003', true);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_term_applications
       SET review_notes = 'officer session edit'
     WHERE id = 'cf400000-0000-4000-8000-000000000001'
  $$,
  'a signed-in officer is not frozen by the applicant lock'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_set_review_submission_override(
        'cf100000-0000-4000-8000-000000000001',
        'cf000000-0000-4000-8000-000000000001',
        %L, 'cf400000-0000-4000-8000-000000000001', true, 'Transcript upload failed; reopened.'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  'the override follows the period kind and writes an application subject'
);

SELECT extensions.is(
  (SELECT subject_kind::text FROM plugin_data.csf_review_decisions
    WHERE subject_id = 'cf400000-0000-4000-8000-000000000001'),
  'application',
  'the override lands on the application subject, not a profile'
);

SELECT set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000002', true);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_term_applications
       SET review_notes = 'applicant edit under override'
     WHERE id = 'cf400000-0000-4000-8000-000000000001'
  $$,
  'the unlocked applicant may edit again'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT plugin_data.csf_set_review_period(
  'cf100000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'membership_applications', 'closed', 'Fall 2028 application review'
);

SELECT set_config('request.jwt.claim.sub', 'cf000000-0000-4000-8000-000000000002', true);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_term_applications
       SET review_notes = 'post-campaign applicant edit'
     WHERE id = 'cf400000-0000-4000-8000-000000000001'
  $$,
  'closing the campaign unfreezes the applicant'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.finish();

ROLLBACK;
