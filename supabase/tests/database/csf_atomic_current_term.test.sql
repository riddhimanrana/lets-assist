BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(25);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_set_current_term(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot select the current CSF semester'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_set_current_term(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot select the current CSF semester'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_set_current_term(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can invoke the atomic current-semester operation'
);
SELECT extensions.ok(
  (
    SELECT proc.prosecdef
      AND proc.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_proc AS proc
    WHERE proc.oid = 'plugin_data.csf_set_current_term(uuid,uuid,uuid)'::regprocedure
  ),
  'the privileged operation pins an empty search path'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_set_current_term(uuid,uuid,uuid)'::regprocedure)
    LIKE '%pg_advisory_xact_lock%p_organization_id::text%',
  'current-semester changes serialize on an organization-scoped transaction lock'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'a8000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'term-current-admin@local.test',
    now(), '{}', '{}', now(), now()
  ),
  (
    'a8000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'term-current-outsider@local.test',
    now(), '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'a8100000-0000-4000-8000-000000000001',
    'CSF Atomic Current Term A', 'csf-atomic-current-term-a', 'school', '998101'
  ),
  (
    'a8100000-0000-4000-8000-000000000002',
    'CSF Atomic Current Term B', 'csf-atomic-current-term-b', 'school', '998102'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'a8100000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES
  (
    'a8200000-0000-4000-8000-000000000001',
    'a8100000-0000-4000-8000-000000000001',
    'F36', 'Fall 2036', '2036-2037', 'fall', 'open', true
  ),
  (
    'a8200000-0000-4000-8000-000000000002',
    'a8100000-0000-4000-8000-000000000001',
    'S37', 'Spring 2037', '2036-2037', 'spring', 'planned', false
  ),
  (
    'a8200000-0000-4000-8000-000000000003',
    'a8100000-0000-4000-8000-000000000001',
    'F35', 'Fall 2035', '2035-2036', 'fall', 'open', false
  ),
  (
    'a8200000-0000-4000-8000-000000000004',
    'a8100000-0000-4000-8000-000000000002',
    'S37', 'Spring 2037', '2036-2037', 'spring', 'open', true
  ),
  (
    'a8200000-0000-4000-8000-000000000005',
    'a8100000-0000-4000-8000-000000000001',
    'S35', 'Spring 2035', '2034-2035', 'spring', 'open', false
  );

INSERT INTO plugin_data.csf_term_closures (
  id, organization_id, term_id, policy_version, summary, decisions,
  closed_by, revision, correlation_id
) VALUES (
  'a8900000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'a8200000-0000-4000-8000-000000000005',
  1,
  '{"fixture":"atomic current-term closed target"}'::jsonb,
  '[]'::jsonb,
  'a8000000-0000-4000-8000-000000000001',
  1,
  'a8900000-0000-4000-8000-000000000002'
);

INSERT INTO plugin_data.csf_term_close_authorizations (
  transaction_id, organization_id, term_id, closure_id,
  closure_revision, actor_user_id, correlation_id
) VALUES (
  pg_catalog.txid_current(),
  'a8100000-0000-4000-8000-000000000001',
  'a8200000-0000-4000-8000-000000000005',
  'a8900000-0000-4000-8000-000000000001',
  1,
  'a8000000-0000-4000-8000-000000000001',
  'a8900000-0000-4000-8000-000000000002'
);

UPDATE plugin_data.csf_terms
SET lifecycle_status = 'closed',
    is_current = false,
    closed_at = now(),
    closed_by = 'a8000000-0000-4000-8000-000000000001',
    closure_policy_version = 1,
    closure_revision = 1,
    latest_closure_id = 'a8900000-0000-4000-8000-000000000001',
    active_closure_id = 'a8900000-0000-4000-8000-000000000001'
WHERE id = 'a8200000-0000-4000-8000-000000000005';

DELETE FROM plugin_data.csf_term_close_authorizations
WHERE transaction_id = pg_catalog.txid_current()
  AND organization_id = 'a8100000-0000-4000-8000-000000000001'
  AND term_id = 'a8200000-0000-4000-8000-000000000005';

-- An archived historical fixture must be constructed without exposing a
-- direct runtime path around the audited lifecycle operations.
SET LOCAL session_replication_role = replica;
UPDATE plugin_data.csf_terms
SET lifecycle_status = 'archived'
WHERE id = 'a8200000-0000-4000-8000-000000000003';
SET LOCAL session_replication_role = origin;

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_current_term(
      'a8100000-0000-4000-8000-000000000001',
      'a8200000-0000-4000-8000-000000000002',
      'a8000000-0000-4000-8000-000000000001'
    )
  $$,
  'an authorized officer can atomically select an open or planned semester'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_terms
    WHERE organization_id = 'a8100000-0000-4000-8000-000000000001'
      AND is_current = true
  ),
  1,
  'the organization still has exactly one current semester'
);
SELECT extensions.ok(
  (
    SELECT is_current
    FROM plugin_data.csf_terms
    WHERE id = 'a8200000-0000-4000-8000-000000000002'
  ),
  'the requested semester becomes current'
);
SELECT extensions.ok(
  NOT (
    SELECT is_current
    FROM plugin_data.csf_terms
    WHERE id = 'a8200000-0000-4000-8000-000000000001'
  ),
  'the previous semester is cleared inside the same operation'
);
SELECT extensions.ok(
  (
    SELECT is_current
    FROM plugin_data.csf_terms
    WHERE id = 'a8200000-0000-4000-8000-000000000004'
  ),
  'selecting a semester does not change another organization'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'a8100000-0000-4000-8000-000000000001'
      AND action = 'term.set_current'
  ),
  1,
  'the successful swap writes exactly one audit event'
);
SELECT extensions.ok(
  (
    SELECT actor_user_id = 'a8000000-0000-4000-8000-000000000001'
      AND term_id = 'a8200000-0000-4000-8000-000000000002'
      AND before_data->>'previousCurrentTermId' = 'a8200000-0000-4000-8000-000000000001'
      AND after_data->>'currentTermId' = 'a8200000-0000-4000-8000-000000000002'
      AND (after_data->>'isCurrent')::boolean = true
      AND correlation_id IS NOT NULL
      AND reason_code = 'current_term_selected'
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'a8100000-0000-4000-8000-000000000001'
      AND action = 'term.set_current'
  ),
  'the audit event binds the actor, prior selection, new selection, and correlation'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_admin_audit_events
    SET after_data = '{}'::jsonb
    WHERE organization_id = 'a8100000-0000-4000-8000-000000000001'
      AND action = 'term.set_current'
  $$,
  'P0001',
  'CSF audit events are immutable.',
  'the current-semester audit receipt cannot be rewritten'
);
SELECT extensions.is(
  (
    SELECT plugin_data.csf_set_current_term(
      'a8100000-0000-4000-8000-000000000001',
      'a8200000-0000-4000-8000-000000000002',
      'a8000000-0000-4000-8000-000000000001'
    )->>'idempotent'
  ),
  'true',
  'reselecting the already-current semester is an idempotent success'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'a8100000-0000-4000-8000-000000000001'
      AND action = 'term.set_current'
  ),
  1,
  'an idempotent replay does not manufacture another audit mutation'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_current_term(
      'a8100000-0000-4000-8000-000000000001',
      'a8200000-0000-4000-8000-000000000004',
      'a8000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF semester not found in this organization.',
  'a semester from another organization is rejected'
);
SELECT extensions.ok(
  (
    SELECT is_current
    FROM plugin_data.csf_terms
    WHERE id = 'a8200000-0000-4000-8000-000000000002'
  ),
  'a cross-organization failure leaves the prior current semester intact'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_current_term(
      'a8100000-0000-4000-8000-000000000001',
      'a82fffff-ffff-4fff-8fff-ffffffffffff',
      'a8000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF semester not found in this organization.',
  'a missing semester is rejected'
);
SELECT extensions.ok(
  (
    SELECT is_current
    FROM plugin_data.csf_terms
    WHERE id = 'a8200000-0000-4000-8000-000000000002'
  ),
  'a missing-target failure leaves the prior current semester intact'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_current_term(
      'a8100000-0000-4000-8000-000000000001',
      'a8200000-0000-4000-8000-000000000003',
      'a8000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Closed or archived CSF semesters cannot become current.',
  'an archived semester cannot become current'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_current_term(
      'a8100000-0000-4000-8000-000000000001',
      'a8200000-0000-4000-8000-000000000005',
      'a8000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Closed or archived CSF semesters cannot become current.',
  'a closed semester cannot become current'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_current_term(
      'a8100000-0000-4000-8000-000000000001',
      'a8200000-0000-4000-8000-000000000001',
      'a8000000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'Not authorized to manage CSF semesters.',
  'an actor without tenant semester permission is rejected'
);
SELECT extensions.ok(
  (
    SELECT is_current
    FROM plugin_data.csf_terms
    WHERE id = 'a8200000-0000-4000-8000-000000000002'
  ),
  'every rejected transition leaves the valid current semester intact'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'a8100000-0000-4000-8000-000000000001'
      AND action = 'term.set_current'
  ),
  1,
  'rejected transitions write no audit event'
);
SELECT extensions.ok(
  (
    SELECT is_current
    FROM plugin_data.csf_terms
    WHERE id = 'a8200000-0000-4000-8000-000000000004'
  ),
  'all failed attempts leave the other organization unchanged'
);

SELECT * FROM extensions.finish();

ROLLBACK;
