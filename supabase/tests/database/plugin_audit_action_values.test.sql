-- Every plugin audit action the control plane emits must be storable (AUD-004).
--
-- plugin_audit_logs_action_check permitted 22 values while lib/plugins emits
-- 28. The six missing ones raised 23514 on every insert, and logPluginAudit
-- swallows that error, so configuration updates, version updates, plugin data
-- deletion, project create/clone, and signup lifecycle events left no audit
-- trail at all. lifecycle.data_delete is the one that matters most: purging a
-- tenant's plugin data was unauditable.
--
-- The six are asserted individually rather than only in bulk, so a future
-- constraint edit that drops one produces a named failure.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

SET LOCAL ROLE service_role;

-- ---------------------------------------------------------------------------
-- The six that the original constraint rejected
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$INSERT INTO public.plugin_audit_logs (action, actor_type)
    VALUES ('lifecycle.config_update', 'system')$$,
  'lifecycle.config_update is auditable'
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.plugin_audit_logs (action, actor_type)
    VALUES ('lifecycle.version_update', 'system')$$,
  'lifecycle.version_update is auditable'
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.plugin_audit_logs (action, actor_type)
    VALUES ('lifecycle.data_delete', 'system')$$,
  'lifecycle.data_delete is auditable'
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.plugin_audit_logs (action, actor_type)
    VALUES ('lifecycle.project_create', 'system')$$,
  'lifecycle.project_create is auditable'
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.plugin_audit_logs (action, actor_type)
    VALUES ('lifecycle.project_clone', 'system')$$,
  'lifecycle.project_clone is auditable'
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.plugin_audit_logs (action, actor_type)
    VALUES ('lifecycle.signup', 'system')$$,
  'lifecycle.signup is auditable'
);

-- ---------------------------------------------------------------------------
-- The full emitted vocabulary, and the boundary that still holds
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$INSERT INTO public.plugin_audit_logs (action, actor_type)
    SELECT unnest(ARRAY[
      'plugin.created','plugin.updated','plugin.activated','plugin.deactivated',
      'entitlement.granted','entitlement.revoked','entitlement.updated',
      'install.created','install.enabled','install.disabled','install.updated',
      'install.config_changed','install.version_updated','install.removed',
      'lifecycle.install','lifecycle.uninstall','lifecycle.enable',
      'lifecycle.disable','lifecycle.config_update','lifecycle.version_update',
      'lifecycle.data_delete','lifecycle.project_create','lifecycle.project_clone',
      'lifecycle.signup','execution.surface','execution.behavior',
      'execution.api','execution.error'
    ]), 'system'$$,
  'every action emitted by lib/plugins is storable'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.plugin_audit_logs
    WHERE actor_type = 'system'
      AND action LIKE 'lifecycle.%'
  ),
  16::bigint,
  'the lifecycle rows written above are all present (6 individual + 10 in bulk)'
);

SELECT extensions.throws_ok(
  $$INSERT INTO public.plugin_audit_logs (action, actor_type)
    VALUES ('lifecycle.not_a_real_action', 'system')$$,
  '23514',
  NULL,
  'the constraint still rejects an unknown action'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
