-- Allow every plugin audit action the control plane actually emits (AUD-004).
--
-- plugin_audit_logs_action_check, created in 20260404010400, permits 22 values.
-- lib/plugins emits 28. The six missing values always violated the constraint
-- with 23514, and logPluginAudit catches the error, logs to console, and
-- returns null -- so those events produced no audit row at all:
--
--   lifecycle.config_update, lifecycle.version_update, lifecycle.data_delete,
--   lifecycle.project_create, lifecycle.project_clone, lifecycle.signup
--
-- lifecycle.data_delete is the serious one: plugin data deletion was
-- unauditable. The historical migration is left untouched; this replaces the
-- constraint forward.

BEGIN;

ALTER TABLE public.plugin_audit_logs
  DROP CONSTRAINT IF EXISTS plugin_audit_logs_action_check;

ALTER TABLE public.plugin_audit_logs
  ADD CONSTRAINT plugin_audit_logs_action_check CHECK (
    action = ANY (ARRAY[
      -- catalog
      'plugin.created',
      'plugin.updated',
      'plugin.activated',
      'plugin.deactivated',
      -- entitlements
      'entitlement.granted',
      'entitlement.revoked',
      'entitlement.updated',
      -- install records
      'install.created',
      'install.enabled',
      'install.disabled',
      'install.updated',
      'install.config_changed',
      'install.version_updated',
      'install.removed',
      -- lifecycle hooks
      'lifecycle.install',
      'lifecycle.uninstall',
      'lifecycle.enable',
      'lifecycle.disable',
      'lifecycle.config_update',
      'lifecycle.version_update',
      'lifecycle.data_delete',
      'lifecycle.project_create',
      'lifecycle.project_clone',
      'lifecycle.signup',
      -- execution telemetry
      'execution.surface',
      'execution.behavior',
      'execution.api',
      'execution.error'
    ]::text[])
  );

COMMIT;
