-- The service-only readiness projection is SECURITY INVOKER. It calls these
-- two pure source-key helpers, so the same server role needs EXECUTE on them.
-- Browser roles remain denied.

BEGIN;

REVOKE ALL ON FUNCTION plugin_data.csf_class_history_source_key_value(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_class_history_has_stable_source_key(jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_class_history_source_key_value(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_history_has_stable_source_key(jsonb)
  TO service_role;

COMMIT;
