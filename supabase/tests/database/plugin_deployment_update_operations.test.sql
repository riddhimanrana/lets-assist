BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(29);

CREATE TEMP TABLE plugin_operation_test_state (
  key text PRIMARY KEY,
  value text NOT NULL
);
GRANT ALL ON plugin_operation_test_state TO service_role;

SELECT extensions.has_table(
  'private', 'plugin_deployments',
  'deployment observations have a private ledger'
);
SELECT extensions.has_table(
  'private', 'plugin_update_operations',
  'plugin update attempts have a private ledger'
);
SELECT extensions.has_column(
  'public', 'organization_plugin_installs', 'desired_version',
  'installs record an operator-selected target'
);
SELECT extensions.has_column(
  'public', 'organization_plugin_installs', 'update_policy',
  'installs record an explicit update policy'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.observe_plugin_deployment(text,text,text,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot record deployments'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.report_plugin_deployment_health(text,text,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot report deployment health'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.begin_plugin_update_operation(uuid,text,text,uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_plugin_update_operation(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'service_role owns both durable update-operation paths'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ed100000-0000-4000-8000-000000000001',
  'Plugin deployment contract',
  'plugin-deployment-contract',
  'nonprofit',
  '885401'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

INSERT INTO plugin_operation_test_state (key, value)
SELECT
  'deployment_id',
  public.observe_plugin_deployment(
    'dvhs-csf',
    '1.1.0',
    'development',
    'embedded',
    'dpl_contract_001',
    repeat('8', 40),
    '{"installContract":{"minimum":"1.1.0","maximum":"1.1.0"}}'::jsonb
  )::text;

RESET ROLE;

SELECT extensions.ok(
  (SELECT value::uuid IS NOT NULL FROM plugin_operation_test_state WHERE key = 'deployment_id'),
  'boot observation returns the durable deployment identity'
);
SELECT extensions.is(
  (
    SELECT health_status
    FROM private.plugin_deployments
    WHERE id = (
      SELECT value::uuid FROM plugin_operation_test_state WHERE key = 'deployment_id'
    )
  ),
  'pending',
  'boot records pending and never claims health'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT extensions.throws_ok(
  $$
    SELECT public.report_plugin_deployment_health(
      'dvhs-csf', 'development', 'dpl_contract_001',
      'healthy', 'deployed', '{}'::jsonb
    )
  $$,
  '22023',
  'a terminal health report and non-empty evidence are required',
  'health promotion requires evidence'
);
SELECT extensions.ok(
  public.report_plugin_deployment_health(
    'dvhs-csf',
    'development',
    'dpl_contract_001',
    'healthy',
    'promoted',
    '{"checks":["health","authorization","browser"]}'::jsonb
  ),
  'the workflow path can promote an observed deployment'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT health_status
    FROM private.plugin_deployments
    WHERE deployment_id = 'dpl_contract_001'
  ),
  'healthy',
  'accepted workflow evidence persists health'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT extensions.lives_ok(
  $$
    SELECT public.observe_plugin_deployment(
      'dvhs-csf', '1.1.0', 'development', 'embedded',
      'dpl_contract_001', repeat('8', 40), '{"refreshed":true}'::jsonb
    )
  $$,
  'a repeated boot refreshes the existing deployment observation'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT health_status
    FROM private.plugin_deployments
    WHERE deployment_id = 'dpl_contract_001'
  ),
  'healthy',
  'a repeated boot cannot downgrade accepted health'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_plugin_update_operation(
      'ed100000-0000-4000-8000-000000000001',
      'dvhs-csf', 'update-001',
      'ed200000-0000-4000-8000-000000000001',
      NULL, 'system', '1.1.0', '1.1.0', '{}'::jsonb
    )
  $$,
  '40001',
  'a live matching plugin transition lease is required',
  'an update operation cannot start without its lease'
);

SELECT extensions.ok(
  public.acquire_plugin_control_plane_transition_lock(
    'ed100000-0000-4000-8000-000000000001',
    'dvhs-csf',
    'ed200000-0000-4000-8000-000000000001',
    300
  ),
  'the test acquires the control-plane lease'
);

INSERT INTO plugin_operation_test_state (key, value)
SELECT
  'operation_id',
  public.begin_plugin_update_operation(
    'ed100000-0000-4000-8000-000000000001',
    'dvhs-csf', 'update-001',
    'ed200000-0000-4000-8000-000000000001',
    NULL, 'system', '1.1.0', '1.1.0', '{"compatible":true}'::jsonb
  ) ->> 'id';

RESET ROLE;

SELECT extensions.is(
  (
    SELECT status
    FROM private.plugin_update_operations
    WHERE id = (
      SELECT value::uuid FROM plugin_operation_test_state WHERE key = 'operation_id'
    )
  ),
  'pending',
  'begin persists a pending operation'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT extensions.is(
  public.begin_plugin_update_operation(
    'ed100000-0000-4000-8000-000000000001',
    'dvhs-csf', 'update-001',
    'ed200000-0000-4000-8000-000000000001',
    NULL, 'system', '1.1.0', '1.1.0', '{"compatible":true}'::jsonb
  ) ->> 'id',
  (SELECT value FROM plugin_operation_test_state WHERE key = 'operation_id'),
  'begin returns the existing operation on idempotent replay'
);
SELECT extensions.throws_ok(
  $$
    SELECT public.begin_plugin_update_operation(
      'ed100000-0000-4000-8000-000000000001',
      'dvhs-csf', 'update-001',
      'ed200000-0000-4000-8000-000000000001',
      NULL, 'admin', '1.1.0', '1.1.0', '{}'::jsonb
    )
  $$,
  '22023',
  'idempotency key was reused with different update inputs',
  'an idempotency key cannot be rebound to another actor'
);

SELECT extensions.is(
  public.complete_plugin_update_operation(
    (SELECT value::uuid FROM plugin_operation_test_state WHERE key = 'operation_id'),
    'ed200000-0000-4000-8000-000000000001',
    'succeeded',
    '{"activated":false,"reason":"schema-only-foundation"}'::jsonb,
    NULL
  ) ->> 'status',
  'succeeded',
  'a live leased operation can complete'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT status
    FROM private.plugin_update_operations
    WHERE id = (
      SELECT value::uuid FROM plugin_operation_test_state WHERE key = 'operation_id'
    )
  ),
  'succeeded',
  'completion persists durably'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT extensions.is(
  public.complete_plugin_update_operation(
    (SELECT value::uuid FROM plugin_operation_test_state WHERE key = 'operation_id'),
    'ed200000-0000-4000-8000-000000000001',
    'succeeded',
    '{"activated":false,"reason":"schema-only-foundation"}'::jsonb,
    NULL
  ) ->> 'id',
  (SELECT value FROM plugin_operation_test_state WHERE key = 'operation_id'),
  'completion is idempotent for identical inputs'
);
SELECT extensions.throws_ok(
  format(
    'SELECT public.complete_plugin_update_operation(%L::uuid, %L::uuid, %L, %L::jsonb, %L)',
    (SELECT value FROM plugin_operation_test_state WHERE key = 'operation_id'),
    'ed200000-0000-4000-8000-000000000001',
    'failed',
    '{"changed":true}',
    'redacted'
  ),
  '22023',
  'completed update operation cannot be changed',
  'a completed operation cannot be rewritten'
);

RESET ROLE;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_definition
    WHERE constraint_definition.conrelid =
      'public.organization_plugin_installs'::regclass
      AND constraint_definition.conname =
        'organization_plugin_installs_legacy_auto_update_false'
      AND position(
        'auto_update = false'
        IN pg_get_constraintdef(constraint_definition.oid)
      ) > 0
  ),
  'the database freezes the legacy automatic-update flag false'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_plugin_installs (
      organization_id, plugin_key, enabled, installed_version, update_policy
    ) VALUES (
      'ed100000-0000-4000-8000-000000000001', 'dvhs-csf', true, '1.1.0', 'always'
    )
  $$,
  '23514',
  NULL,
  'unknown update policies are refused'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"ed000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.throws_ok(
  $$SELECT count(*) FROM private.plugin_deployments$$,
  '42501',
  'permission denied for table plugin_deployments',
  'authenticated cannot read deployment records'
);
SELECT extensions.throws_ok(
  $$SELECT count(*) FROM private.plugin_update_operations$$,
  '42501',
  'permission denied for table plugin_update_operations',
  'authenticated cannot read update operations'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SELECT extensions.ok(
  public.release_plugin_control_plane_transition_lock(
    'ed100000-0000-4000-8000-000000000001',
    'dvhs-csf',
    'ed200000-0000-4000-8000-000000000001'
  ),
  'the test releases the control-plane lease'
);

RESET ROLE;
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.organization_plugin_installs
    WHERE auto_update = true
  ),
  'the legacy automatic-update column remains false everywhere'
);

SELECT extensions.finish();
ROLLBACK;
