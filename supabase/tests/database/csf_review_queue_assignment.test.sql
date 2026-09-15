-- Application review queue assignment.
--
-- The split an officer asks for is the pending, unassigned applications in
-- the semester and class they are looking at. These assertions prove the
-- function assigns exactly that set by stable record, refuses any record whose
-- scope, decision, or assignment has moved since the officer loaded the
-- roster, writes nothing when it refuses, and leaves every other assignment
-- and the positional band table alone.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(36);

-- ---------------------------------------------------------------------------
-- A. Execution grants
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_assign_review_queue(uuid,uuid,uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot assign the review queue'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_assign_review_queue(uuid,uuid,uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot assign the review queue'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_assign_review_queue(uuid,uuid,uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'the server role can assign the review queue'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_review_application_counts(uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot read per-term application counts'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_review_application_counts(uuid)',
    'EXECUTE'
  ),
  'the server role can read per-term application counts'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures
--
-- Two officers are organization admins; the bystander is an ordinary member.
-- Four applications sit in the reviewed semester: two pending and unassigned
-- (one per class), one that will be decided, one already assigned. A fifth
-- application in another semester exists only for the grouped count.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('cf900000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-queue-officer@local.test', now(), '{}', '{}', now(), now()),
  ('cf900000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-queue-bystander@local.test', now(), '{}', '{}', now(), now()),
  ('cf900000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'csf-queue-reviewer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cf910000-0000-4000-8000-000000000001',
  'CSF Review Queue',
  'csf-review-queue',
  'school',
  '750001'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('cf910000-0000-4000-8000-000000000001', 'cf900000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('cf910000-0000-4000-8000-000000000001', 'cf900000-0000-4000-8000-000000000002', 'member', 'active'),
  ('cf910000-0000-4000-8000-000000000001', 'cf900000-0000-4000-8000-000000000003', 'admin', 'active');

-- Native applications only insert into the current open semester, and an
-- organization has exactly one current term, so the reviewed semester is
-- current and the other semester is not.
INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  is_current, lifecycle_status, accepts_new_applications
)
VALUES
  ('cf920000-0000-4000-8000-000000000001', 'cf910000-0000-4000-8000-000000000001',
   'F28', 'Fall 2028', '2028-2029', 'fall', true, 'open', true),
  ('cf920000-0000-4000-8000-000000000002', 'cf910000-0000-4000-8000-000000000001',
   'S29', 'Spring 2029', '2028-2029', 'spring', false, 'open', true);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES
  ('cf950000-0000-4000-8000-000000000001', 'cf910000-0000-4000-8000-000000000001',
   2032, 'c/o 2032', 'active'),
  ('cf950000-0000-4000-8000-000000000002', 'cf910000-0000-4000-8000-000000000001',
   2031, 'c/o 2031', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('cf930000-0000-4000-8000-000000000001', 'cf910000-0000-4000-8000-000000000001',
   'Ada', 'Aguirre', 'ada', 'aguirre'),
  ('cf930000-0000-4000-8000-000000000002', 'cf910000-0000-4000-8000-000000000001',
   'Bo', 'Bhola', 'bo', 'bhola'),
  ('cf930000-0000-4000-8000-000000000003', 'cf910000-0000-4000-8000-000000000001',
   'Cy', 'Chen', 'cy', 'chen'),
  ('cf930000-0000-4000-8000-000000000004', 'cf910000-0000-4000-8000-000000000001',
   'Di', 'Desai', 'di', 'desai');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES
  -- A1: pending, unassigned, class of 2032
  ('cf940000-0000-4000-8000-000000000001', 'cf910000-0000-4000-8000-000000000001',
   'cf930000-0000-4000-8000-000000000001', 'cf950000-0000-4000-8000-000000000001',
   'cf920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  -- A2: pending, unassigned, class of 2031
  ('cf940000-0000-4000-8000-000000000002', 'cf910000-0000-4000-8000-000000000001',
   'cf930000-0000-4000-8000-000000000002', 'cf950000-0000-4000-8000-000000000002',
   'cf920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  -- A3: will be decided before the split
  ('cf940000-0000-4000-8000-000000000003', 'cf910000-0000-4000-8000-000000000001',
   'cf930000-0000-4000-8000-000000000003', 'cf950000-0000-4000-8000-000000000001',
   'cf920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  -- A4: will already be assigned before the split
  ('cf940000-0000-4000-8000-000000000004', 'cf910000-0000-4000-8000-000000000001',
   'cf930000-0000-4000-8000-000000000004', 'cf950000-0000-4000-8000-000000000001',
   'cf920000-0000-4000-8000-000000000001', 'native', 'submitted'),
  -- A5: another semester, counted only. That semester is not current, so the
  -- native intake guard would refuse it; it arrives as an import instead.
  ('cf940000-0000-4000-8000-000000000005', 'cf910000-0000-4000-8000-000000000001',
   'cf930000-0000-4000-8000-000000000001', 'cf950000-0000-4000-8000-000000000001',
   'cf920000-0000-4000-8000-000000000002', 'legacy_import', 'submitted');

SELECT plugin_data.csf_set_review_period(
  'cf910000-0000-4000-8000-000000000001',
  'cf900000-0000-4000-8000-000000000001',
  'cf920000-0000-4000-8000-000000000001',
  'membership_applications', 'open', 'Fall 2028 application review'
);

SELECT plugin_data.csf_set_review_period(
  'cf910000-0000-4000-8000-000000000001',
  'cf900000-0000-4000-8000-000000000001',
  'cf920000-0000-4000-8000-000000000001',
  'member_points', 'open', 'Fall 2028 point verification'
);

-- A3 is decided through the canonical decision path.
SELECT plugin_data.csf_record_review_decision(
  'cf910000-0000-4000-8000-000000000001',
  'cf900000-0000-4000-8000-000000000001',
  (SELECT id FROM plugin_data.csf_review_periods
    WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
      AND kind = 'membership_applications'),
  'application', 'cf940000-0000-4000-8000-000000000003', 'approved'
);

-- A4 is assigned through the canonical per-application path.
SELECT plugin_data.csf_assign_application(
  'cf910000-0000-4000-8000-000000000001',
  'cf940000-0000-4000-8000-000000000004',
  'cf900000-0000-4000-8000-000000000003',
  'cf900000-0000-4000-8000-000000000001'
);

-- ---------------------------------------------------------------------------
-- C. Authority and period gates
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000002',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '42501',
  'Not authorized to assign CSF review work.',
  'a member without manage_review_periods cannot assign the queue'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'member_points')
  ),
  '23514',
  'Only an application review period assigns applications.',
  'a point verification period cannot assign applications'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, NULL, NULL, '[]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'Nothing to assign.',
  'an empty split is refused before any scope check'
);

-- ---------------------------------------------------------------------------
-- D. Stale scopes are refused and write nothing
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, 'cf920000-0000-4000-8000-000000000002', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'The review scope changed. Reload the roster and split again.',
  'a split for a different semester than the period is refused'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"},
          {"applicationId":"cf940000-0000-4000-8000-000000000003","reviewerUserId":"cf900000-0000-4000-8000-000000000003"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'A selected application already has a decision. Reload the roster and split again.',
  'a decided application in the selection fails the whole split'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"},
          {"applicationId":"cf940000-0000-4000-8000-000000000004","reviewerUserId":"cf900000-0000-4000-8000-000000000001"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'A selected application is already assigned. Reload the roster and split again.',
  'an already-assigned application in the selection fails the whole split'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, 'cf920000-0000-4000-8000-000000000001', 'cf950000-0000-4000-8000-000000000001',
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"},
          {"applicationId":"cf940000-0000-4000-8000-000000000002","reviewerUserId":"cf900000-0000-4000-8000-000000000003"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'A selected application is outside the selected semester or class. Reload the roster and split again.',
  'a class-scoped split cannot quietly widen to another class'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"},
          {"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000003"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'An application can only be assigned once per split.',
  'one application cannot be handed to two reviewers in one split'
);

SELECT extensions.ok(
  (SELECT assigned_to IS NULL AND assigned_at IS NULL
     FROM plugin_data.csf_term_applications
    WHERE id = 'cf940000-0000-4000-8000-000000000001'),
  'every refused split left the valid pending application untouched'
);

-- ---------------------------------------------------------------------------
-- E. A valid split assigns exactly the selected records
--
-- The split carries a stable request identifier so the replay cases in F can
-- prove the receipt is returned rather than the work repeated.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"},
          {"applicationId":"cf940000-0000-4000-8000-000000000002","reviewerUserId":"cf900000-0000-4000-8000-000000000003"}]'::jsonb,
        'cf960000-0000-4000-8000-000000000001'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  'the pending unassigned queue across every class is assigned'
);

SELECT extensions.is(
  (SELECT assigned_to FROM plugin_data.csf_term_applications
    WHERE id = 'cf940000-0000-4000-8000-000000000001'),
  'cf900000-0000-4000-8000-000000000001'::uuid,
  'the first pending application went to its selected reviewer'
);
SELECT extensions.is(
  (SELECT assigned_to FROM plugin_data.csf_term_applications
    WHERE id = 'cf940000-0000-4000-8000-000000000002'),
  'cf900000-0000-4000-8000-000000000003'::uuid,
  'the second pending application went to its selected reviewer'
);
SELECT extensions.ok(
  (SELECT bool_and(assigned_by = 'cf900000-0000-4000-8000-000000000001' AND assigned_at IS NOT NULL)
     FROM plugin_data.csf_term_applications
    WHERE id IN ('cf940000-0000-4000-8000-000000000001', 'cf940000-0000-4000-8000-000000000002')),
  'each assignment records the acting officer and when it happened'
);
SELECT extensions.is(
  (SELECT assigned_to FROM plugin_data.csf_term_applications
    WHERE id = 'cf940000-0000-4000-8000-000000000004'),
  'cf900000-0000-4000-8000-000000000003'::uuid,
  'the previously assigned application keeps its reviewer'
);
SELECT extensions.ok(
  (SELECT assigned_to IS NULL FROM plugin_data.csf_term_applications
    WHERE id = 'cf940000-0000-4000-8000-000000000003'),
  'the decided application stays unassigned'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_review_assignments
    WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'),
  0,
  'a queue split writes no positional band'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
      AND action = 'review_period.assign_queue'
      AND (after_data->>'assigned')::integer = 2
      AND (after_data->>'reviewers')::integer = 2),
  1,
  'the split records one summary audit event with its counts'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
      AND action = 'application.assign'
      AND target_id IN ('cf940000-0000-4000-8000-000000000001', 'cf940000-0000-4000-8000-000000000002')),
  2,
  'each assigned application carries its own audit row'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000003"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'A selected application is already assigned. Reload the roster and split again.',
  'a fresh split against records that are now assigned is refused rather than reassigning'
);

-- ---------------------------------------------------------------------------
-- F. Request receipts
--
-- The summary audit event is the receipt. An exact replay by the same actor
-- returns it without touching a row; a reused identifier with another payload
-- or actor is refused.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT (plugin_data.csf_assign_review_queue(
      'cf910000-0000-4000-8000-000000000001',
      'cf900000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_review_periods
        WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
          AND kind = 'membership_applications'),
      'cf920000-0000-4000-8000-000000000001', NULL,
      '[{"applicationId":"cf940000-0000-4000-8000-000000000002","reviewerUserId":"cf900000-0000-4000-8000-000000000003"},
        {"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"}]'::jsonb,
      'cf960000-0000-4000-8000-000000000001'
    ) ->> 'idempotent')
  ),
  'true',
  'replaying the same request with the same payload, in any order, returns the recorded receipt'
);

SELECT extensions.is(
  (
    SELECT (plugin_data.csf_assign_review_queue(
      'cf910000-0000-4000-8000-000000000001',
      'cf900000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_review_periods
        WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
          AND kind = 'membership_applications'),
      'cf920000-0000-4000-8000-000000000001', NULL,
      '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"},
        {"applicationId":"cf940000-0000-4000-8000-000000000002","reviewerUserId":"cf900000-0000-4000-8000-000000000003"}]'::jsonb,
      'cf960000-0000-4000-8000-000000000001'
    ) ->> 'assigned')::integer
  ),
  2,
  'the replayed receipt carries the original counts'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
      AND action = 'review_period.assign_queue'),
  1,
  'a replay writes no second summary event'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
      AND action = 'application.assign'
      AND target_id IN ('cf940000-0000-4000-8000-000000000001', 'cf940000-0000-4000-8000-000000000002')),
  2,
  'a replay writes no second per-application assignment'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000003"}]'::jsonb,
        'cf960000-0000-4000-8000-000000000001'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'That split request identifier is already bound to a different split.',
  'reusing the identifier with a different payload is refused'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000003',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"},
          {"applicationId":"cf940000-0000-4000-8000-000000000002","reviewerUserId":"cf900000-0000-4000-8000-000000000003"}]'::jsonb,
        'cf960000-0000-4000-8000-000000000001'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'That split request identifier is already bound to a different split.',
  'another officer cannot replay someone else''s request identifier'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000002',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"},
          {"applicationId":"cf940000-0000-4000-8000-000000000002","reviewerUserId":"cf900000-0000-4000-8000-000000000003"}]'::jsonb,
        'cf960000-0000-4000-8000-000000000001'
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '42501',
  'Not authorized to assign CSF review work.',
  'current authority is checked before any receipt is consulted'
);

-- ---------------------------------------------------------------------------
-- G. Grouped counts
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT application_count::integer
     FROM plugin_data.csf_review_application_counts('cf910000-0000-4000-8000-000000000001')
    WHERE term_id = 'cf920000-0000-4000-8000-000000000001'),
  4,
  'the reviewed semester counts every application regardless of decision or assignment'
);
SELECT extensions.is(
  (SELECT application_count::integer
     FROM plugin_data.csf_review_application_counts('cf910000-0000-4000-8000-000000000001')
    WHERE term_id = 'cf920000-0000-4000-8000-000000000002'),
  1,
  'the other semester counts its own application'
);
SELECT extensions.is(
  (SELECT count(*)::integer
     FROM plugin_data.csf_review_application_counts('cf910000-0000-4000-8000-000000000001')),
  2,
  'the grouped read returns one row per term with applications'
);

-- ---------------------------------------------------------------------------
-- H. Closed periods
-- ---------------------------------------------------------------------------

SELECT plugin_data.csf_set_review_period(
  'cf910000-0000-4000-8000-000000000001',
  'cf900000-0000-4000-8000-000000000001',
  'cf920000-0000-4000-8000-000000000001',
  'membership_applications', 'closed', 'Fall 2028 application review'
);

SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_assign_review_queue(
        'cf910000-0000-4000-8000-000000000001',
        'cf900000-0000-4000-8000-000000000001',
        %L, 'cf920000-0000-4000-8000-000000000001', NULL,
        '[{"applicationId":"cf940000-0000-4000-8000-000000000003","reviewerUserId":"cf900000-0000-4000-8000-000000000001"}]'::jsonb
      )
    $$,
    (SELECT id FROM plugin_data.csf_review_periods
      WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
        AND kind = 'membership_applications')
  ),
  '23514',
  'This review period is closed.',
  'the queue cannot be assigned after the campaign closes'
);

SELECT extensions.is(
  (
    SELECT (plugin_data.csf_assign_review_queue(
      'cf910000-0000-4000-8000-000000000001',
      'cf900000-0000-4000-8000-000000000001',
      (SELECT id FROM plugin_data.csf_review_periods
        WHERE organization_id = 'cf910000-0000-4000-8000-000000000001'
          AND kind = 'membership_applications'),
      'cf920000-0000-4000-8000-000000000001', NULL,
      '[{"applicationId":"cf940000-0000-4000-8000-000000000001","reviewerUserId":"cf900000-0000-4000-8000-000000000001"},
        {"applicationId":"cf940000-0000-4000-8000-000000000002","reviewerUserId":"cf900000-0000-4000-8000-000000000003"}]'::jsonb,
      'cf960000-0000-4000-8000-000000000001'
    ) ->> 'idempotent')
  ),
  'true',
  'a receipt still answers an exact replay after the campaign closes, because nothing is written'
);

SELECT extensions.finish();

ROLLBACK;
