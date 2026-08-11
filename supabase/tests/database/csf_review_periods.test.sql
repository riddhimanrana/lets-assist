-- Officer review campaigns: period lifecycle, range assignment, decisions,
-- the submission freeze, and the per-member override.
--
-- Nothing in the application called these RPCs when this file was written, so
-- these assertions are the first thing to exercise them.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(42);

-- ---------------------------------------------------------------------------
-- A. Execution grants
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_set_review_period(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot open a review period'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_set_review_period(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients cannot open a review period'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_set_review_period(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'the server role can open a review period'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_record_review_decision(uuid,uuid,uuid,text,uuid,text,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot record a review decision'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_record_review_decision(uuid,uuid,uuid,text,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot record a review decision'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_record_review_decision(uuid,uuid,uuid,text,uuid,text,text)',
    'EXECUTE'
  ),
  'the server role can record a review decision'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures
--
-- The officer is an organization admin, which short-circuits
-- csf_actor_has_permission. The bystander is an ordinary active member with no
-- staff position, so every permission assertion below has a real negative case.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('ce000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-review-officer@local.test', now(), '{}', '{}', now(), now()),
  ('ce000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-review-bystander@local.test', now(), '{}', '{}', now(), now()),
  ('ce000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'csf-review-second-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'CSF Review Periods',
  'csf-review-periods',
  'school',
  '730001'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'ce200000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'S28',
  'Spring 2028',
  '2027-2028',
  'spring'
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity
) VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  3
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES (
  'ce500000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  2028,
  'c/o 2028',
  'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('ce300000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
   'Ada', 'Aguirre', 'ada', 'aguirre'),
  ('ce300000-0000-4000-8000-000000000002', 'ce100000-0000-4000-8000-000000000001',
   'Bo', 'Bhola', 'bo', 'bhola');

-- Both student rows are written before any period opens. Once the campaign is
-- open the freeze makes these inserts impossible, which is the point.
INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, description, claimed_points, point_type, status, source
) VALUES
  ('ce400000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
   'ce300000-0000-4000-8000-000000000001', 'ce200000-0000-4000-8000-000000000001',
   'Aguirre student claim', 2, 'non_drive', 'submitted', 'student'),
  ('ce400000-0000-4000-8000-000000000002', 'ce100000-0000-4000-8000-000000000001',
   'ce300000-0000-4000-8000-000000000002', 'ce200000-0000-4000-8000-000000000001',
   'Bhola student claim', 2, 'non_drive', 'submitted', 'student');

-- ---------------------------------------------------------------------------
-- C. Permission gates
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_review_period(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000002',
      'ce200000-0000-4000-8000-000000000001',
      'member_points', 'draft', 'Spring 2028 verification'
    )
  $$,
  '42501',
  'Not authorized to manage CSF review periods.',
  'a member without manage_review_periods cannot open a campaign'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_add_review_note(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000000',
      'profile',
      'ce300000-0000-4000-8000-000000000001',
      'should never be written'
    )
  $$,
  '42501',
  'Not authorized to write CSF review notes.',
  'a member without verify_submissions cannot write a review note'
);

-- ---------------------------------------------------------------------------
-- D. Period lifecycle
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_review_period(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'member_points', 'draft', '   '
    )
  $$,
  '23514',
  'A review period needs a title.',
  'a review period cannot be created without a title'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_review_period(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'member_points', 'draft', 'Spring 2028 verification'
    )
  $$,
  'an administrator drafts the campaign'
);

SELECT extensions.is(
  (SELECT status::text FROM plugin_data.csf_review_periods
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'),
  'draft',
  'the drafted campaign is not yet open'
);

SELECT extensions.ok(
  (SELECT opened_at IS NULL AND opened_by IS NULL FROM plugin_data.csf_review_periods
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'),
  'a draft records no opener'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'profile', 'ce300000-0000-4000-8000-000000000001', 'approved'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  '23514',
  'This review period is not open.',
  'no decision may be recorded while the campaign is still a draft'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_review_period(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'member_points', 'open', 'Spring 2028 verification'
    )
  $$,
  'the administrator opens the campaign'
);

SELECT extensions.ok(
  (SELECT status = 'open' AND opened_at IS NOT NULL AND opened_by IS NOT NULL
     FROM plugin_data.csf_review_periods
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'),
  'opening the campaign records who opened it and when'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_review_periods
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND term_id = 'ce200000-0000-4000-8000-000000000001'
      AND kind = 'member_points'),
  1,
  'one term and kind hold exactly one campaign, so opening twice cannot compete'
);

-- ---------------------------------------------------------------------------
-- E. Submission freeze
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_point_submissions (
      organization_id, profile_id, term_id, description, claimed_points, point_type, status, source
    ) VALUES (
      'ce100000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'late student claim', 1, 'non_drive', 'submitted', 'student'
    )
  $$,
  '23514',
  'Point verification is open for this term; this member''s submissions are locked.',
  'a student cannot add a claim while verification is open'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_point_submissions
       SET description = 'edited during the freeze'
     WHERE id = 'ce400000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'Point verification is open for this term; this member''s submissions are locked.',
  'a student cannot edit a claim while verification is open'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_point_submissions
     WHERE id = 'ce400000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'Point verification is open for this term; this member''s submissions are locked.',
  'a student cannot withdraw a claim while verification is open'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_point_submissions (
      id, organization_id, profile_id, term_id, description, claimed_points, point_type, status, source
    ) VALUES (
      'ce400000-0000-4000-8000-000000000003',
      'ce100000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'officer correction', 1, 'non_drive', 'approved', 'staff'
    )
  $$,
  'staff corrections still pass the freeze, because that is the campaign work'
);

-- ---------------------------------------------------------------------------
-- F. Decisions
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'profile', 'ce300000-0000-4000-8000-000000000001', 'rejected'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  '23514',
  'A rejection needs a reason.',
  'a rejection without a reason is refused'
);

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'profile', 'ce300000-0000-4000-8000-000000000002', 'rejected', 'Two activities were unverifiable.'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  'a rejection with a reason is recorded'
);

SELECT extensions.ok(
  (SELECT decision = 'rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
     FROM plugin_data.csf_review_decisions
    WHERE subject_id = 'ce300000-0000-4000-8000-000000000002'),
  'a rejection records who decided and when'
);

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_record_review_decision(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'profile', 'ce300000-0000-4000-8000-000000000001', 'approved'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  'an approval needs no reason'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_review_decisions
    WHERE subject_id = 'ce300000-0000-4000-8000-000000000001'),
  1,
  'a subject carries exactly one decision row per campaign'
);

-- ---------------------------------------------------------------------------
-- G. Per-member override
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_set_review_submission_override(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'ce300000-0000-4000-8000-000000000001', true, '  '
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  '23514',
  'Unlocking a member needs a reason.',
  'unlocking one member requires a recorded reason'
);

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_set_review_submission_override(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'ce300000-0000-4000-8000-000000000001', true, 'Missing proof upload; reopened at adviser request.'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  'an officer unlocks one member with a reason'
);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_point_submissions
       SET description = 'edited under an override'
     WHERE id = 'ce400000-0000-4000-8000-000000000001'
  $$,
  'the unlocked member may edit their own claims again'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_point_submissions
       SET description = 'neighbour edit'
     WHERE id = 'ce400000-0000-4000-8000-000000000002'
  $$,
  '23514',
  'Point verification is open for this term; this member''s submissions are locked.',
  'the override frees one member and leaves their neighbour locked'
);

-- ---------------------------------------------------------------------------
-- H. Range assignment
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_ranges(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'ce500000-0000-4000-8000-000000000001',
        '[{"reviewerUserId":"ce000000-0000-4000-8000-000000000001","startIndex":2,"endIndex":3,"fromLabel":"Bhola","toLabel":"Chen"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  '23514',
  'Review ranges must be contiguous and start at 1; expected 1 but got 2.',
  'a set of ranges that does not start at 1 is refused'
);

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_ranges(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'ce500000-0000-4000-8000-000000000001',
        '[{"reviewerUserId":"ce000000-0000-4000-8000-000000000001","startIndex":1,"endIndex":1,"fromLabel":"Aguirre","toLabel":"Aguirre"},
          {"reviewerUserId":"ce000000-0000-4000-8000-000000000003","startIndex":2,"endIndex":2,"fromLabel":"Bhola","toLabel":"Bhola"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  'a contiguous set of ranges is accepted'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_review_assignments
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'),
  2,
  'both ranges are stored'
);

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_ranges(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'ce500000-0000-4000-8000-000000000001',
        '[{"reviewerUserId":"ce000000-0000-4000-8000-000000000003","startIndex":1,"endIndex":2,"fromLabel":"Aguirre","toLabel":"Bhola"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  'the range set can be rewritten'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_review_assignments
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'),
  1,
  'rewriting replaces the previous ranges instead of appending to them'
);

-- ---------------------------------------------------------------------------
-- I. Notes
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_add_review_note(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'profile', 'ce300000-0000-4000-8000-000000000001', '   '
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  '23514',
  'A note needs a body.',
  'an empty note is refused'
);

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_add_review_note(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'profile', 'ce300000-0000-4000-8000-000000000001', 'Confirmed the drive hours with the partner club.'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  'an officer writes a note against one subject'
);

SELECT extensions.is(
  (SELECT body FROM plugin_data.csf_review_notes
    WHERE subject_id = 'ce300000-0000-4000-8000-000000000001'),
  'Confirmed the drive hours with the partner club.',
  'the note body is stored verbatim'
);

-- ---------------------------------------------------------------------------
-- J. Closing is terminal
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_review_period(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'member_points', 'closed', 'Spring 2028 verification'
    )
  $$,
  'the administrator closes the campaign'
);

SELECT extensions.ok(
  (SELECT closed_at IS NOT NULL AND closed_by IS NOT NULL
     FROM plugin_data.csf_review_periods
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'),
  'closing records who closed it and when'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_review_period(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'member_points', 'open', 'Spring 2028 verification'
    )
  $$,
  '23514',
  'This review period is already closed.',
  'a closed campaign cannot be reopened for the same term'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_ranges(
        'ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000001',
        %L, 'ce500000-0000-4000-8000-000000000001', '[]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'ce100000-0000-4000-8000-000000000001')
  ),
  '23514',
  'This review period is closed.',
  'ranges cannot be reassigned after the campaign closes'
);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_point_submissions
       SET description = 'post-campaign correction'
     WHERE id = 'ce400000-0000-4000-8000-000000000002'
  $$,
  'closing the campaign lifts the freeze for everyone'
);

SELECT extensions.finish();

ROLLBACK;
