BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(22);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_term_closure_readiness(uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot inspect private CSF closure readiness'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_term_closure_readiness(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot inspect private CSF closure readiness directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_term_closure_readiness(uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can inspect CSF closure readiness'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_close_term(uuid,uuid,integer,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot close CSF semesters'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_close_term(uuid,uuid,integer,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot close CSF semesters directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_close_term(uuid,uuid,integer,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'the server role cannot call the disabled legacy semester-close RPC'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'cc000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'term-closure-officer@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'cc100000-0000-4000-8000-000000000001',
    'CSF Term Closure A',
    'csf-term-closure-a',
    'school',
    '986001'
  ),
  (
    'cc100000-0000-4000-8000-000000000002',
    'CSF Term Closure B',
    'csf-term-closure-b',
    'school',
    '986002'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'cc100000-0000-4000-8000-000000000001',
  'cc000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES
  (
    'cc200000-0000-4000-8000-000000000001',
    'cc100000-0000-4000-8000-000000000001',
    'S29', 'Spring 2029', '2028-2029', 'spring', 'open', true
  ),
  (
    'cc200000-0000-4000-8000-000000000002',
    'cc100000-0000-4000-8000-000000000002',
    'S29', 'Spring 2029', '2028-2029', 'spring', 'open', true
  );

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, dues_required,
  dues_amount, dues_currency
) VALUES
  (
    'cc100000-0000-4000-8000-000000000001',
    'cc200000-0000-4000-8000-000000000001',
    3, true, 5, 'USD'
  ),
  (
    'cc100000-0000-4000-8000-000000000002',
    'cc200000-0000-4000-8000-000000000002',
    1, true, 5, 'USD'
  );

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  (
    'cc300000-0000-4000-8000-000000000001',
    'cc100000-0000-4000-8000-000000000001',
    2030, 'Class of 2030'
  ),
  (
    'cc300000-0000-4000-8000-000000000002',
    'cc100000-0000-4000-8000-000000000002',
    2030, 'Class of 2030'
  );

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  (
    'cc400000-0000-4000-8000-000000000001',
    'cc100000-0000-4000-8000-000000000001',
    'Blocked', 'Member', 'blocked', 'member'
  ),
  (
    'cc400000-0000-4000-8000-000000000002',
    'cc100000-0000-4000-8000-000000000001',
    'Ready', 'Member', 'ready', 'member'
  ),
  (
    'cc400000-0000-4000-8000-000000000003',
    'cc100000-0000-4000-8000-000000000002',
    'Other', 'Tenant', 'other', 'tenant'
  );

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id,
  source, status, current_grade_level, submitted_at
) VALUES
  (
    'cc500000-0000-4000-8000-000000000001',
    'cc100000-0000-4000-8000-000000000001',
    'cc400000-0000-4000-8000-000000000001',
    'cc300000-0000-4000-8000-000000000001',
    'cc200000-0000-4000-8000-000000000001',
    'manual', 'submitted', 11, now()
  ),
  (
    'cc500000-0000-4000-8000-000000000002',
    'cc100000-0000-4000-8000-000000000001',
    'cc400000-0000-4000-8000-000000000002',
    'cc300000-0000-4000-8000-000000000001',
    'cc200000-0000-4000-8000-000000000001',
    'legacy_import', 'accepted', 11, now()
  ),
  (
    'cc500000-0000-4000-8000-000000000003',
    'cc100000-0000-4000-8000-000000000002',
    'cc400000-0000-4000-8000-000000000003',
    'cc300000-0000-4000-8000-000000000002',
    'cc200000-0000-4000-8000-000000000002',
    'manual', 'submitted', 11, now()
  );

UPDATE plugin_data.csf_term_applications
SET submission_status = 'decided',
    eligibility_status = 'eligible',
    decision_status = 'approved',
    decision_reason_code = 'approved_standard',
    decision_reason = 'Legacy accepted membership.'
WHERE id = 'cc500000-0000-4000-8000-000000000002';

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id,
  application_id, status
) VALUES
  (
    'cc600000-0000-4000-8000-000000000001',
    'cc100000-0000-4000-8000-000000000001',
    'cc400000-0000-4000-8000-000000000001',
    'cc200000-0000-4000-8000-000000000001',
    'cc300000-0000-4000-8000-000000000001',
    'cc500000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    'cc600000-0000-4000-8000-000000000002',
    'cc100000-0000-4000-8000-000000000001',
    'cc400000-0000-4000-8000-000000000002',
    'cc200000-0000-4000-8000-000000000001',
    'cc300000-0000-4000-8000-000000000001',
    'cc500000-0000-4000-8000-000000000002',
    'active'
  );

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, source,
  description, claimed_points, point_type, status, submitted_by
) VALUES (
  'cc700000-0000-4000-8000-000000000001',
  'cc100000-0000-4000-8000-000000000001',
  'cc400000-0000-4000-8000-000000000001',
  'cc200000-0000-4000-8000-000000000001',
  'student', 'Service claim', 2, 'non_drive', 'submitted',
  'cc000000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_point_appeals (
  id, organization_id, profile_id, term_id, submission_id,
  reason, requested_points, status, submitted_by
) VALUES (
  'cc800000-0000-4000-8000-000000000001',
  'cc100000-0000-4000-8000-000000000001',
  'cc400000-0000-4000-8000-000000000001',
  'cc200000-0000-4000-8000-000000000001',
  'cc700000-0000-4000-8000-000000000001',
  'Please review the awarded points.', 2, 'submitted',
  'cc000000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_meeting_attendance (
  id, organization_id, profile_id, term_id, meeting_key,
  meeting_label, status, source, match_status, submitted_name
) VALUES (
  'cc900000-0000-4000-8000-000000000001',
  'cc100000-0000-4000-8000-000000000001',
  'cc400000-0000-4000-8000-000000000001',
  'cc200000-0000-4000-8000-000000000001',
  'march-general', 'March general meeting', 'unknown', 'sheet',
  'ambiguous', 'Blocked Member'
);

SELECT extensions.is(
  plugin_data.csf_term_closure_readiness(
    'cc100000-0000-4000-8000-000000000001',
    'cc200000-0000-4000-8000-000000000001'
  )->'counts',
  '{"applications":1,"pointSubmissions":1,"pointAppeals":1,"attendance":1,"dues":1,"imports":0}'::jsonb,
  'closure readiness counts every unresolved workflow for only the requested tenant and semester'
);
SELECT extensions.ok(
  NOT (
    plugin_data.csf_term_closure_readiness(
      'cc100000-0000-4000-8000-000000000001',
      'cc200000-0000-4000-8000-000000000001'
    )->>'ready'
  )::boolean
  AND (
    plugin_data.csf_term_closure_readiness(
      'cc100000-0000-4000-8000-000000000001',
      'cc200000-0000-4000-8000-000000000001'
    )->>'totalBlockers'
  )::integer = 5,
  'a semester with operational work is explicitly not ready to close'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'cc100000-0000-4000-8000-000000000001',
      'cc200000-0000-4000-8000-000000000001',
      3,
      plugin_data.csf_term_closure_readiness(
        'cc100000-0000-4000-8000-000000000001',
        'cc200000-0000-4000-8000-000000000001'
      )->>'evidenceHash',
      'cc000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF semester cannot be closed while operational work remains.',
  'the atomic close boundary rejects unresolved operational work'
);
SELECT extensions.is(
  (SELECT lifecycle_status FROM plugin_data.csf_terms WHERE id = 'cc200000-0000-4000-8000-000000000001'),
  'open',
  'a rejected close leaves the semester open'
);
SELECT extensions.is(
  (
    SELECT string_agg(status, ',' ORDER BY id)
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'cc100000-0000-4000-8000-000000000001'
      AND term_id = 'cc200000-0000-4000-8000-000000000001'
  ),
  'active,active',
  'a rejected close changes no membership outcome'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_closures
    WHERE organization_id = 'cc100000-0000-4000-8000-000000000001'
      AND term_id = 'cc200000-0000-4000-8000-000000000001'
  ),
  0,
  'a rejected close writes no closure record'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'cc100000-0000-4000-8000-000000000001'
      AND term_id = 'cc200000-0000-4000-8000-000000000001'
      AND action = 'term.close'
  ),
  0,
  'a rejected close writes no misleading audit event'
);

UPDATE plugin_data.csf_term_applications
SET submission_status = 'decided',
    eligibility_status = 'eligible',
    decision_status = 'approved',
    decision_reason_code = 'approved_standard',
    decision_reason = 'Reviewed for closure.'
WHERE id = 'cc500000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_dues_records
SET status = 'verified', paid_amount = required_amount,
    verified_by = 'cc000000-0000-4000-8000-000000000001',
    verified_at = now(), updated_at = now()
WHERE application_id = 'cc500000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_point_submissions
SET status = 'approved',
    reviewed_by = 'cc000000-0000-4000-8000-000000000001',
    reviewed_at = now(), updated_at = now()
WHERE id = 'cc700000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_point_appeals
SET status = 'approved',
    reviewed_by = 'cc000000-0000-4000-8000-000000000001',
    reviewed_at = now(), updated_at = now()
WHERE id = 'cc800000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_meeting_attendance
SET status = 'attended', match_status = 'confirmed', updated_at = now()
WHERE id = 'cc900000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  (
    plugin_data.csf_term_closure_readiness(
      'cc100000-0000-4000-8000-000000000001',
      'cc200000-0000-4000-8000-000000000001'
    )->>'ready'
  )::boolean
  AND (
    plugin_data.csf_term_closure_readiness(
      'cc100000-0000-4000-8000-000000000001',
      'cc200000-0000-4000-8000-000000000001'
    )->>'totalBlockers'
  )::integer = 0,
  'the same readiness contract becomes ready after every blocker is resolved'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_close_term(
      'cc100000-0000-4000-8000-000000000001',
      'cc200000-0000-4000-8000-000000000001',
      3,
      '[{"profileId":"cc400000-0000-4000-8000-000000000001","status":"completed","reason":"Requirements complete."}]'::jsonb,
      '{"membershipCount":1}'::jsonb,
      'cc000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Legacy CSF semester close is disabled; use the evidence-bound close operation.',
  'the legacy caller-authored decision path fails closed'
);
SELECT extensions.is(
  (SELECT lifecycle_status FROM plugin_data.csf_terms WHERE id = 'cc200000-0000-4000-8000-000000000001'),
  'open',
  'an incomplete decision set rolls back the close'
);

CREATE TEMP TABLE csf_term_closure_result (
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_term_closure_result (payload)
    SELECT plugin_data.csf_close_term_v2(
      'cc100000-0000-4000-8000-000000000001',
      'cc200000-0000-4000-8000-000000000001',
      3,
      plugin_data.csf_term_closure_readiness(
        'cc100000-0000-4000-8000-000000000001',
        'cc200000-0000-4000-8000-000000000001'
      )->>'evidenceHash',
      'cc000000-0000-4000-8000-000000000001'
    )
  $$,
  'a ready semester closes atomically'
);
SELECT extensions.ok(
  (
    SELECT lifecycle_status = 'closed'
      AND NOT is_current
      AND closed_at IS NOT NULL
      AND closed_by = 'cc000000-0000-4000-8000-000000000001'
      AND closure_policy_version = 3
    FROM plugin_data.csf_terms
    WHERE id = 'cc200000-0000-4000-8000-000000000001'
  ),
  'the term lifecycle stores the actor, timestamp, and exact policy version'
);
SELECT extensions.is(
  (
    SELECT string_agg(status, ',' ORDER BY id)
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'cc100000-0000-4000-8000-000000000001'
      AND term_id = 'cc200000-0000-4000-8000-000000000001'
  ),
  'not_completed,not_completed',
  'every active membership receives its database-derived final outcome'
);
SELECT extensions.ok(
  (
    SELECT result.payload->>'correlationId' = closure.summary->>'correlationId'
      AND closure.summary->'readiness'->>'ready' = 'true'
      AND event.correlation_id::text = result.payload->>'correlationId'
      AND event.reason_code = 'semester_closed'
      AND event.after_data->>'membershipCount' = '2'
    FROM csf_term_closure_result AS result
    JOIN plugin_data.csf_term_closures AS closure
      ON closure.organization_id = 'cc100000-0000-4000-8000-000000000001'
      AND closure.term_id = 'cc200000-0000-4000-8000-000000000001'
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.organization_id = closure.organization_id
      AND event.term_id = closure.term_id
      AND event.action = 'term.close'
  ),
  'the result, readiness snapshot, closure record, and immutable audit share one correlation ID'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_admin_audit_events
    SET reason_code = 'tampered'
    WHERE organization_id = 'cc100000-0000-4000-8000-000000000001'
      AND term_id = 'cc200000-0000-4000-8000-000000000001'
      AND action = 'term.close'
  $$,
  'P0001',
  'CSF audit events are immutable.',
  'the term-close audit event cannot be changed'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'cc100000-0000-4000-8000-000000000001',
      'cc200000-0000-4000-8000-000000000001',
      3,
      repeat('0', 64),
      'cc000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF semester is missing, closed, or archived.',
  'a closed semester cannot be closed a second time'
);

SELECT * FROM extensions.finish();

ROLLBACK;
