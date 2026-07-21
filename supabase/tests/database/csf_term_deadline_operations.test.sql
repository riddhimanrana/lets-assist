BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(34);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_upsert_term_deadline(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot write CSF deadlines'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_upsert_term_deadline(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot write CSF deadlines'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_upsert_term_deadline(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'the server role can write CSF deadlines'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_set_term_deadline_status(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot change CSF deadline status'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_set_term_deadline_status(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot change CSF deadline status'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_set_term_deadline_status(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'the server role can change CSF deadline status'
);
SELECT extensions.ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'plugin_data.csf_term_deadlines'::regclass
  )
  AND NOT has_table_privilege('authenticated', 'plugin_data.csf_term_deadlines', 'SELECT'),
  'CSF deadlines keep the server-only RLS and grant boundary'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'cd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'deadline-officer-a@local.test', now(), '{}', '{}', now(), now()
  ),
  (
    'cd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'deadline-officer-b@local.test', now(), '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'cd100000-0000-4000-8000-000000000001',
    'CSF Deadline A', 'csf-deadline-a', 'school', '986001'
  ),
  (
    'cd100000-0000-4000-8000-000000000002',
    'CSF Deadline B', 'csf-deadline-b', 'school', '986002'
  );

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  starts_at, ends_at, lifecycle_status
) VALUES
  (
    'cd200000-0000-4000-8000-000000000001',
    'cd100000-0000-4000-8000-000000000001',
    'S29', 'Spring 2029', '2028-2029', 'spring',
    '2029-01-10', '2029-06-01', 'open'
  ),
  (
    'cd200000-0000-4000-8000-000000000002',
    'cd100000-0000-4000-8000-000000000002',
    'S29', 'Spring 2029', '2028-2029', 'spring',
    '2029-01-10', '2029-06-01', 'open'
  );

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type, is_system, sort_order
) VALUES
  (
    'cd300000-0000-4000-8000-000000000001',
    'cd100000-0000-4000-8000-000000000001',
    'deadline-officer', 'Deadline Officer', 'custom', false, 1
  ),
  (
    'cd300000-0000-4000-8000-000000000002',
    'cd100000-0000-4000-8000-000000000002',
    'deadline-officer', 'Deadline Officer', 'custom', false, 1
  );

INSERT INTO plugin_data.csf_staff_positions (
  id, organization_id, user_id, role_id, school_year, display_title, status
) VALUES
  (
    'cd400000-0000-4000-8000-000000000001',
    'cd100000-0000-4000-8000-000000000001',
    'cd000000-0000-4000-8000-000000000001',
    'cd300000-0000-4000-8000-000000000001',
    '2028-2029', 'Secretary', 'active'
  ),
  (
    'cd400000-0000-4000-8000-000000000002',
    'cd100000-0000-4000-8000-000000000002',
    'cd000000-0000-4000-8000-000000000002',
    'cd300000-0000-4000-8000-000000000002',
    '2028-2029', 'Secretary', 'active'
  );

CREATE TEMP TABLE csf_deadline_results (
  kind text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_deadline_results (kind, payload)
    SELECT 'created', plugin_data.csf_upsert_term_deadline(
      'cd100000-0000-4000-8000-000000000001',
      NULL,
      'cd200000-0000-4000-8000-000000000001',
      '{
        "deadlineType":"application_close",
        "title":"Spring application deadline",
        "description":"Submit the application and transcript.",
        "dueAt":"2029-02-01T23:59:00-08:00",
        "audience":"applicants",
        "ownerUserId":"cd000000-0000-4000-8000-000000000001"
      }'::jsonb,
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'an officer can create a semester deadline atomically'
);
SELECT extensions.ok(
  (
    SELECT deadline.status = 'planned'
      AND deadline.deadline_type = 'application_close'
      AND deadline.title = 'Spring application deadline'
      AND deadline.audience = 'applicants'
      AND deadline.owner_user_id = 'cd000000-0000-4000-8000-000000000001'
      AND deadline.related_route = 'applications'
    FROM plugin_data.csf_term_deadlines AS deadline
    WHERE deadline.id = (
      SELECT (payload->>'deadlineId')::uuid
      FROM csf_deadline_results
      WHERE kind = 'created'
    )
  ),
  'the deadline stores normalized schedule, audience, owner, and route data'
);
SELECT extensions.ok(
  (
    SELECT event.action = 'term_deadline.create'
      AND event.before_data IS NULL
      AND event.after_data->>'title' = 'Spring application deadline'
      AND event.reason_code = 'deadline_created'
      AND event.correlation_id::text = result.payload->>'correlationId'
    FROM csf_deadline_results AS result
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = (result.payload->>'deadlineId')::uuid
     AND event.action = 'term_deadline.create'
    WHERE result.kind = 'created'
  ),
  'deadline creation and its immutable audit share a correlation ID'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_upsert_term_deadline(
      'cd100000-0000-4000-8000-000000000001', NULL,
      'cd200000-0000-4000-8000-000000000002',
      '{"deadlineType":"dues","title":"Dues","dueAt":"2029-02-01T20:00:00Z","audience":"members"}'::jsonb,
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF semester not found.',
  'deadline creation cannot address another organization semester'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_upsert_term_deadline(
      'cd100000-0000-4000-8000-000000000001', NULL,
      'cd200000-0000-4000-8000-000000000001',
      '{"deadlineType":"dues","title":"Dues","dueAt":"2029-02-01T20:00:00Z","audience":"members","ownerUserId":"cd000000-0000-4000-8000-000000000002"}'::jsonb,
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Deadline owner must be an active CSF staff member.',
  'a deadline cannot be assigned to another organization staff member'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_deadline_results (kind, payload)
    SELECT 'updated', plugin_data.csf_upsert_term_deadline(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'cd200000-0000-4000-8000-000000000001',
      '{
        "deadlineType":"dues",
        "title":"Dues verification deadline",
        "description":"Verify receipt or waiver.",
        "dueAt":"2029-02-05T17:00:00-08:00",
        "audience":"members",
        "ownerUserId":"cd000000-0000-4000-8000-000000000001"
      }'::jsonb,
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'an officer can update a planned deadline atomically'
);
SELECT extensions.ok(
  (
    SELECT deadline.deadline_type = 'dues'
      AND deadline.title = 'Dues verification deadline'
      AND deadline.audience = 'members'
      AND deadline.related_route = 'applications'
    FROM plugin_data.csf_term_deadlines AS deadline
    WHERE deadline.id = (
      SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'
    )
  ),
  'deadline edits replace the officer-managed fields'
);
SELECT extensions.ok(
  (
    SELECT event.before_data->>'title' = 'Spring application deadline'
      AND event.after_data->>'title' = 'Dues verification deadline'
      AND event.reason_code = 'deadline_updated'
      AND event.correlation_id::text = result.payload->>'correlationId'
    FROM csf_deadline_results AS result
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = (result.payload->>'deadlineId')::uuid
     AND event.action = 'term_deadline.update'
    WHERE result.kind = 'updated'
  ),
  'deadline updates retain exact before and after audit snapshots'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_deadline_results (kind, payload)
    SELECT 'opened', plugin_data.csf_set_term_deadline_status(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'open', NULL, 'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'a planned deadline can be opened'
);
SELECT extensions.ok(
  (
    SELECT deadline.status = 'open'
      AND event.before_data->>'status' = 'planned'
      AND event.after_data->>'status' = 'open'
      AND event.correlation_id::text = result.payload->>'correlationId'
    FROM csf_deadline_results AS result
    JOIN plugin_data.csf_term_deadlines AS deadline
      ON deadline.id = (result.payload->>'deadlineId')::uuid
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = deadline.id
     AND event.action = 'term_deadline.status_change'
     AND event.reason_code = 'deadline_opened'
    WHERE result.kind = 'opened'
  ),
  'opening a deadline records a correlated status audit'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_deadline_results (kind, payload)
    SELECT 'completed', plugin_data.csf_set_term_deadline_status(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'completed', NULL, 'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'an open deadline can be completed'
);
SELECT extensions.ok(
  (
    SELECT status = 'completed'
      AND completed_by = 'cd000000-0000-4000-8000-000000000001'
      AND completed_at IS NOT NULL
    FROM plugin_data.csf_term_deadlines
    WHERE id = (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created')
  ),
  'completion records the responsible officer and timestamp'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_upsert_term_deadline(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'cd200000-0000-4000-8000-000000000001',
      '{"deadlineType":"dues","title":"Changed after completion","dueAt":"2029-02-06T20:00:00Z","audience":"members"}'::jsonb,
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Reopen this deadline before editing it.',
  'completed deadlines cannot be silently edited'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_term_deadline_status(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'open', NULL, 'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'A reason is required for this status change.',
  'reopening a completed deadline requires a reason'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_deadline_results (kind, payload)
    SELECT 'reopened', plugin_data.csf_set_term_deadline_status(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'open', 'Receipt reconciliation is still in progress.',
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'a completed deadline can be reopened with an audit reason'
);
SELECT extensions.ok(
  (
    SELECT deadline.status = 'open'
      AND deadline.completed_by IS NULL
      AND deadline.completed_at IS NULL
      AND event.after_data->>'reason' = 'Receipt reconciliation is still in progress.'
    FROM plugin_data.csf_term_deadlines AS deadline
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = deadline.id
     AND event.correlation_id = (
       SELECT (payload->>'correlationId')::uuid FROM csf_deadline_results WHERE kind = 'reopened'
     )
    WHERE deadline.id = (
      SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'
    )
  ),
  'reopening clears completion metadata and retains the correction reason'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_term_deadline_status(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'cancelled', NULL, 'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'A reason is required for this status change.',
  'deadline cancellation requires a reason'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_deadline_results (kind, payload)
    SELECT 'cancelled', plugin_data.csf_set_term_deadline_status(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'cancelled', 'Dues were waived for this semester.',
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'an open deadline can be cancelled with a reason'
);
SELECT extensions.ok(
  (
    SELECT deadline.status = 'cancelled'
      AND event.after_data->>'reason' = 'Dues were waived for this semester.'
      AND event.reason_code = 'deadline_cancelled'
    FROM plugin_data.csf_term_deadlines AS deadline
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = deadline.id
     AND event.correlation_id = (
       SELECT (payload->>'correlationId')::uuid FROM csf_deadline_results WHERE kind = 'cancelled'
     )
    WHERE deadline.id = (
      SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'
    )
  ),
  'cancelled status and its officer reason are audited together'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_term_deadline_status(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'planned', NULL, 'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'A reason is required for this status change.',
  'restoring a cancelled deadline requires a reason'
);
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_deadline_results (kind, payload)
    SELECT 'restored', plugin_data.csf_set_term_deadline_status(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'planned', 'Waiver decision was reversed.',
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'a cancelled deadline can be restored with a reason'
);
SELECT extensions.ok(
  (
    SELECT deadline.status = 'planned'
      AND event.reason_code = 'deadline_planned'
      AND event.after_data->>'reason' = 'Waiver decision was reversed.'
    FROM plugin_data.csf_term_deadlines AS deadline
    JOIN plugin_data.csf_admin_audit_events AS event
      ON event.target_id = deadline.id
     AND event.correlation_id = (
       SELECT (payload->>'correlationId')::uuid FROM csf_deadline_results WHERE kind = 'restored'
     )
    WHERE deadline.id = (
      SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'
    )
  ),
  'restoration returns the deadline to planned and audits the correction'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_term_deadline_status(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'completed', NULL, 'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'That deadline status change is not allowed.',
  'a planned deadline cannot skip directly to completed'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_upsert_term_deadline(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'cd200000-0000-4000-8000-000000000001',
      '{"deadlineType":"dues","title":"Bad audience","dueAt":"2029-02-06T20:00:00Z","audience":"public"}'::jsonb,
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Choose a supported deadline audience.',
  'unsupported deadline audiences are rejected'
);

INSERT INTO plugin_data.csf_term_closures (
  id, organization_id, term_id, policy_version, summary, decisions,
  closed_by, revision, correlation_id
) VALUES (
  'cd900000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000001',
  1,
  '{"fixture":"closed-semester deadline guards"}'::jsonb,
  '[]'::jsonb,
  'cd000000-0000-4000-8000-000000000001',
  1,
  'cd900000-0000-4000-8000-000000000002'
);

UPDATE plugin_data.csf_terms
SET
  lifecycle_status = 'closed',
  is_current = false,
  closed_at = now(),
  closed_by = 'cd000000-0000-4000-8000-000000000001',
  closure_policy_version = 1,
  closure_revision = 1,
  latest_closure_id = 'cd900000-0000-4000-8000-000000000001',
  active_closure_id = 'cd900000-0000-4000-8000-000000000001'
WHERE id = 'cd200000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_upsert_term_deadline(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'cd200000-0000-4000-8000-000000000001',
      '{"deadlineType":"dues","title":"Late edit","dueAt":"2029-02-06T20:00:00Z","audience":"members"}'::jsonb,
      'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Deadlines cannot be changed after a semester is closed.',
  'closed-semester deadlines cannot be edited'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_term_deadline_status(
      'cd100000-0000-4000-8000-000000000001',
      (SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'),
      'open', NULL, 'cd000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Open-semester CSF deadline not found.',
  'closed-semester deadline status cannot be changed'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_admin_audit_events
    SET reason_code = 'tampered'
    WHERE target_id = (
      SELECT (payload->>'deadlineId')::uuid FROM csf_deadline_results WHERE kind = 'created'
    )
  $$,
  'P0001',
  'CSF audit events are immutable.',
  'deadline audit history remains immutable'
);

SELECT extensions.finish();
ROLLBACK;
