BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(39);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_reopen_term(uuid,uuid,uuid,integer,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot reopen CSF semesters'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_reopen_term(uuid,uuid,uuid,integer,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot reopen CSF semesters directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_reopen_term(uuid,uuid,uuid,integer,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can invoke the permission-checked semester reopen boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_reopen_term_base(uuid,uuid,uuid,integer,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass the authorized semester reopen wrapper'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_term_membership_outcomes', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'plugin_data.csf_term_reopen_events', 'SELECT'),
  'browser roles cannot read private close outcomes or reopen events directly'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'dd000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'term-reopen-adviser@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('dd100000-0000-4000-8000-000000000001', 'CSF Term Reopen A', 'csf-term-reopen-a', 'school', '987001'),
  ('dd100000-0000-4000-8000-000000000002', 'CSF Term Reopen B', 'csf-term-reopen-b', 'school', '987002');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'dd100000-0000-4000-8000-000000000001',
  'dd000000-0000-4000-8000-000000000001',
  'admin', 'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES (
  'dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000001',
  'F29', 'Fall 2029', '2029-2030', 'fall', 'open', true
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, dues_required,
  total_points_required, required_meetings
) VALUES (
  'dd100000-0000-4000-8000-000000000001',
  'dd200000-0000-4000-8000-000000000001',
  4, false, 7, 2
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'dd300000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000001',
  2031, 'Class of 2031'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('dd400000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001', 'Pending', 'Member', 'pending', 'member'),
  ('dd400000-0000-4000-8000-000000000002', 'dd100000-0000-4000-8000-000000000001', 'Accepted', 'Member', 'accepted', 'member'),
  ('dd400000-0000-4000-8000-000000000003', 'dd100000-0000-4000-8000-000000000001', 'Active', 'Member', 'active', 'member');

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, status,
  status_reason, eligibility_snapshot, override_status, override_reason,
  overridden_by, overridden_at
) VALUES
  (
    'dd600000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001',
    'dd400000-0000-4000-8000-000000000001', 'dd200000-0000-4000-8000-000000000001',
    'dd300000-0000-4000-8000-000000000001', 'pending', 'Awaiting activation.',
    '{"before":"pending"}'::jsonb, NULL, NULL, NULL, NULL
  ),
  (
    'dd600000-0000-4000-8000-000000000002', 'dd100000-0000-4000-8000-000000000001',
    'dd400000-0000-4000-8000-000000000002', 'dd200000-0000-4000-8000-000000000001',
    'dd300000-0000-4000-8000-000000000001', 'accepted', 'Accepted but not activated.',
    '{"before":"accepted"}'::jsonb, 'completed', 'Adviser approved the documented exception.',
    'dd000000-0000-4000-8000-000000000001', '2029-12-01T12:00:00Z'
  ),
  (
    'dd600000-0000-4000-8000-000000000003', 'dd100000-0000-4000-8000-000000000001',
    'dd400000-0000-4000-8000-000000000003', 'dd200000-0000-4000-8000-000000000001',
    'dd300000-0000-4000-8000-000000000001', 'active', 'Current member.',
    '{"before":"active"}'::jsonb, NULL, NULL, NULL, NULL
  );

CREATE TEMP TABLE csf_reopen_cycle_results (
  phase text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_reopen_cycle_results (phase, payload)
    SELECT 'close-1', plugin_data.csf_close_term_v2(
      'dd100000-0000-4000-8000-000000000001',
      'dd200000-0000-4000-8000-000000000001',
      4,
      plugin_data.csf_term_closure_readiness(
        'dd100000-0000-4000-8000-000000000001',
        'dd200000-0000-4000-8000-000000000001'
      )->>'evidenceHash',
      'dd000000-0000-4000-8000-000000000001'
    )
  $$,
  'the first close creates a revisioned membership snapshot'
);
SELECT extensions.ok(
  (
    SELECT term.lifecycle_status = 'closed'
      AND NOT term.is_current
      AND term.closure_revision = 1
      AND term.latest_closure_id = term.active_closure_id
      AND term.active_closure_id::text = result.payload->>'closureId'
    FROM plugin_data.csf_terms AS term
    JOIN csf_reopen_cycle_results AS result ON result.phase = 'close-1'
    WHERE term.id = 'dd200000-0000-4000-8000-000000000001'
  ),
  'the term points to its first active immutable close revision'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_membership_outcomes
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
      AND term_id = 'dd200000-0000-4000-8000-000000000001'
      AND closure_revision = 1
  ),
  3,
  'the first close stores one immutable outcome per membership'
);
SELECT extensions.is(
  (
    SELECT string_agg(prior_status, ',' ORDER BY membership_id)
    FROM plugin_data.csf_term_membership_outcomes
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
  ),
  'pending,accepted,active',
  'the close records each exact pre-close membership status'
);
SELECT extensions.is(
  (
    SELECT string_agg(final_status, ',' ORDER BY membership_id)
    FROM plugin_data.csf_term_membership_outcomes
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
  ),
  'not_completed,completed,not_completed',
  'the close records derived and adviser-overridden final outcomes'
);
SELECT extensions.ok(
  (
    SELECT closure.revision = 1
      AND closure.snapshot_version = 3
      AND closure.reopenable
      AND closure.correlation_id::text = result.payload->>'correlationId'
    FROM plugin_data.csf_term_closures AS closure
    JOIN csf_reopen_cycle_results AS result ON result.phase = 'close-1'
    WHERE closure.id::text = result.payload->>'closureId'
  ),
  'new close rows carry an explicit reopenable snapshot version and correlation'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_term_memberships
    SET
      status = 'pending',
      finalized_closure_id = NULL,
      finalized_revision = NULL,
      finalized_correlation_id = NULL
    WHERE id = 'dd600000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'Closed CSF semester evidence is immutable; reopen the semester before making changes.',
  'a restoration-shaped direct membership update cannot bypass the reopen RPC'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reopen_term(
      'dd100000-0000-4000-8000-000000000001',
      'dd200000-0000-4000-8000-000000000001',
      (SELECT (payload->>'closureId')::uuid FROM csf_reopen_cycle_results WHERE phase = 'close-1'),
      1, 'data_correction', 'too short',
      'dd000000-0000-4000-8000-000000000001',
      'dd700000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Semester reopen requires a reason of at least 10 characters.',
  'a vague reopen reason is rejected'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reopen_term(
      'dd100000-0000-4000-8000-000000000001',
      'dd200000-0000-4000-8000-000000000001',
      (SELECT (payload->>'closureId')::uuid FROM csf_reopen_cycle_results WHERE phase = 'close-1'),
      1, 'unstructured_reason', 'Correct the attendance reconciliation record.',
      'dd000000-0000-4000-8000-000000000001',
      'dd700000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'Semester reopen reason code is invalid.',
  'an unsupported reason code is rejected'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reopen_term(
      'dd100000-0000-4000-8000-000000000002',
      'dd200000-0000-4000-8000-000000000001',
      (SELECT (payload->>'closureId')::uuid FROM csf_reopen_cycle_results WHERE phase = 'close-1'),
      1, 'data_correction', 'Correct the attendance reconciliation record.',
      'dd000000-0000-4000-8000-000000000001',
      'dd700000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'Not authorized to reopen this CSF semester.',
  'tenant scoping rejects a foreign semester before disclosing its state'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reopen_term(
      'dd100000-0000-4000-8000-000000000001',
      'dd200000-0000-4000-8000-000000000001',
      'dd800000-0000-4000-8000-000000000001',
      1, 'data_correction', 'Correct the attendance reconciliation record.',
      'dd000000-0000-4000-8000-000000000001',
      'dd700000-0000-4000-8000-000000000004'
    )
  $$,
  'P0001',
  'The semester close revision changed; refresh and try again.',
  'a stale closure ID cannot reopen the semester'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_reopen_cycle_results (phase, payload)
    SELECT 'reopen-1', plugin_data.csf_reopen_term(
      'dd100000-0000-4000-8000-000000000001',
      'dd200000-0000-4000-8000-000000000001',
      (SELECT (payload->>'closureId')::uuid FROM csf_reopen_cycle_results WHERE phase = 'close-1'),
      1, 'attendance_correction', 'Correct an attendance reconciliation decision.',
      'dd000000-0000-4000-8000-000000000001',
      'dd700000-0000-4000-8000-000000000005'
    )
  $$,
  'an authorized adviser can reopen the expected close revision'
);
SELECT extensions.ok(
  (
    SELECT term.lifecycle_status = 'open'
      AND NOT term.is_current
      AND term.active_closure_id IS NULL
      AND term.latest_closure_id::text = close_result.payload->>'closureId'
      AND term.closure_revision = 1
      AND term.closed_at IS NULL
      AND term.closed_by IS NULL
      AND term.closure_policy_version IS NULL
    FROM plugin_data.csf_terms AS term
    JOIN csf_reopen_cycle_results AS close_result ON close_result.phase = 'close-1'
    WHERE term.id = 'dd200000-0000-4000-8000-000000000001'
  ),
  'reopen preserves the latest historical close but leaves the semester non-current and provisional'
);
SELECT extensions.is(
  (
    SELECT string_agg(status, ',' ORDER BY id)
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
  ),
  'pending,accepted,active',
  'reopen restores pending, accepted, and active statuses exactly'
);
SELECT extensions.is(
  (
    SELECT string_agg(status_reason, '|' ORDER BY id)
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
  ),
  'Awaiting activation.|Accepted but not activated.|Current member.',
  'reopen restores every prior status reason exactly'
);
SELECT extensions.is(
  (
    SELECT string_agg(eligibility_snapshot->>'before', ',' ORDER BY id)
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
  ),
  'pending,accepted,active',
  'reopen restores every prior eligibility snapshot exactly'
);
SELECT extensions.ok(
  (
    SELECT override_status = 'completed'
      AND override_reason = 'Adviser approved the documented exception.'
      AND overridden_by = 'dd000000-0000-4000-8000-000000000001'
      AND overridden_at = '2029-12-01T12:00:00Z'::timestamptz
    FROM plugin_data.csf_term_memberships
    WHERE id = 'dd600000-0000-4000-8000-000000000002'
  ),
  'reopen restores adviser override metadata byte-for-byte'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
      AND (
        finalized_closure_id IS NOT NULL
        OR finalized_revision IS NOT NULL
        OR finalized_correlation_id IS NOT NULL
      )
  ),
  0,
  'reopen clears every current finalization pointer'
);
SELECT extensions.ok(
  (
    SELECT event.reason_code = 'attendance_correction'
      AND event.reason = 'Correct an attendance reconciliation decision.'
      AND event.restored_membership_count = 3
      AND event.correlation_id = 'dd700000-0000-4000-8000-000000000005'
      AND event.closure_revision = 1
    FROM plugin_data.csf_term_reopen_events AS event
    WHERE event.organization_id = 'dd100000-0000-4000-8000-000000000001'
  ),
  'the immutable reopen event records reason, actor scope, revision, and restored count'
);
SELECT extensions.ok(
  (
    SELECT audit.correlation_id = event.correlation_id
      AND audit.reason_code = 'semester_reopened_attendance_correction'
      AND audit.source_id = event.closure_id::text
      AND audit.after_data->>'restoredMembershipCount' = '3'
    FROM plugin_data.csf_term_reopen_events AS event
    JOIN plugin_data.csf_admin_audit_events AS audit
      ON audit.organization_id = event.organization_id
      AND audit.term_id = event.term_id
      AND audit.action = 'term.reopen'
    WHERE event.organization_id = 'dd100000-0000-4000-8000-000000000001'
  ),
  'the reopen event and audit record share one correlation and closure source'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_reopen_term(
      'dd100000-0000-4000-8000-000000000001',
      'dd200000-0000-4000-8000-000000000001',
      (SELECT (payload->>'closureId')::uuid FROM csf_reopen_cycle_results WHERE phase = 'close-1'),
      1, 'attendance_correction', 'Correct an attendance reconciliation decision.',
      'dd000000-0000-4000-8000-000000000001',
      'dd700000-0000-4000-8000-000000000005'
    )
  $$,
  'replaying the same correlation returns the original reopen result idempotently'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_reopen_events
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
  ),
  1,
  'idempotent replay does not duplicate reopen history'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_reopen_term(
      'dd100000-0000-4000-8000-000000000001',
      'dd200000-0000-4000-8000-000000000001',
      (SELECT (payload->>'closureId')::uuid FROM csf_reopen_cycle_results WHERE phase = 'close-1'),
      1, 'other', 'Try to reopen the already open semester.',
      'dd000000-0000-4000-8000-000000000001',
      'dd700000-0000-4000-8000-000000000006'
    )
  $$,
  'P0001',
  'CSF semester is missing or is not closed.',
  'a different correlation cannot reopen the same revision twice'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_term_membership_outcomes
    SET reason = 'Tampered outcome.'
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'CSF semester history snapshots are immutable.',
  'membership outcome snapshots cannot be edited'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_term_closures
    SET decisions = '[]'::jsonb
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'CSF semester history snapshots are immutable.',
  'close snapshots cannot be edited'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_term_reopen_events
    SET reason = 'Tampered reopen event.'
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'CSF semester history snapshots are immutable.',
  'reopen events cannot be edited'
);

INSERT INTO plugin_data.csf_credit_records (
  organization_id, profile_id, term_id, source, points, point_type,
  status, verified_by, verified_at
)
SELECT
  'dd100000-0000-4000-8000-000000000001',
  profile.id,
  'dd200000-0000-4000-8000-000000000001',
  'manual', points.value, 'non_drive', 'verified',
  'dd000000-0000-4000-8000-000000000001', now()
FROM plugin_data.csf_profiles AS profile
CROSS JOIN (VALUES (3::numeric), (3::numeric), (1::numeric)) AS points(value)
WHERE profile.organization_id = 'dd100000-0000-4000-8000-000000000001';

INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label, required, status, sort_order
) VALUES
  (
    'dd800000-0000-4000-8000-000000000001',
    'dd100000-0000-4000-8000-000000000001',
    'dd200000-0000-4000-8000-000000000001',
    'corrected-meeting-1', 'Corrected meeting 1', true, 'active', 1
  ),
  (
    'dd800000-0000-4000-8000-000000000002',
    'dd100000-0000-4000-8000-000000000001',
    'dd200000-0000-4000-8000-000000000001',
    'corrected-meeting-2', 'Corrected meeting 2', true, 'active', 2
  );

INSERT INTO plugin_data.csf_meeting_attendance (
  organization_id, profile_id, term_id, meeting_key, meeting_label,
  status, source, recorded_by
)
SELECT
  'dd100000-0000-4000-8000-000000000001',
  profile.id,
  'dd200000-0000-4000-8000-000000000001',
  meeting.key,
  meeting.label,
  'attended', 'manual',
  'dd000000-0000-4000-8000-000000000001'
FROM plugin_data.csf_profiles AS profile
CROSS JOIN (
  VALUES ('corrected-meeting-1', 'Corrected meeting 1'),
         ('corrected-meeting-2', 'Corrected meeting 2')
) AS meeting(key, label)
WHERE profile.organization_id = 'dd100000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_reopen_cycle_results (phase, payload)
    SELECT 'close-2', plugin_data.csf_close_term_v2(
      'dd100000-0000-4000-8000-000000000001',
      'dd200000-0000-4000-8000-000000000001',
      4,
      plugin_data.csf_term_closure_readiness(
        'dd100000-0000-4000-8000-000000000001',
        'dd200000-0000-4000-8000-000000000001'
      )->>'evidenceHash',
      'dd000000-0000-4000-8000-000000000001'
    )
  $$,
  'the corrected semester can be closed again'
);
SELECT extensions.ok(
  (
    SELECT revision = 2
      AND supersedes_closure_id::text = first_result.payload->>'closureId'
      AND id::text = second_result.payload->>'closureId'
    FROM plugin_data.csf_term_closures AS closure
    JOIN csf_reopen_cycle_results AS first_result ON first_result.phase = 'close-1'
    JOIN csf_reopen_cycle_results AS second_result ON second_result.phase = 'close-2'
    WHERE closure.id::text = second_result.payload->>'closureId'
  ),
  'revision two points to the immutable revision-one snapshot it supersedes'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_closures
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
      AND term_id = 'dd200000-0000-4000-8000-000000000001'
  ),
  2,
  'reclose appends a second close snapshot instead of replacing the first'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_membership_outcomes
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
      AND term_id = 'dd200000-0000-4000-8000-000000000001'
  ),
  6,
  'both close revisions retain all per-membership outcomes'
);
SELECT extensions.ok(
  (
    SELECT term.lifecycle_status = 'closed'
      AND term.closure_revision = 2
      AND term.latest_closure_id = term.active_closure_id
      AND term.active_closure_id::text = result.payload->>'closureId'
    FROM plugin_data.csf_terms AS term
    JOIN csf_reopen_cycle_results AS result ON result.phase = 'close-2'
    WHERE term.id = 'dd200000-0000-4000-8000-000000000001'
  ),
  'the corrected close becomes the only active term result'
);
SELECT extensions.is(
  (
    SELECT string_agg(status, ',' ORDER BY id)
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
  ),
  'completed,completed,completed',
  'the corrected membership outcomes are frozen on revision two'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000001'
      AND term_id = 'dd200000-0000-4000-8000-000000000001'
      AND action IN ('term.close', 'term.reopen', 'term.reclose')
  ),
  3,
  'close, reopen, and reclose form one permanent audit sequence'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_closures
    WHERE organization_id = 'dd100000-0000-4000-8000-000000000002'
  ),
  0,
  'the foreign tenant remains unchanged throughout the lifecycle'
);

SELECT * FROM extensions.finish();

ROLLBACK;
