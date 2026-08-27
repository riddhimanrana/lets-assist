-- The source-backed identity migration replaced the canonical merge preview
-- after the merge functions had already been loaded by long-lived API
-- sessions. Refresh both callers so PostgreSQL resolves the canonical preview
-- again instead of retaining a plan for the renamed base function.

ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  SET search_path = '';
ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  SET search_path = '';

REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) IS
  'Internal audited CSF profile merge. Its dependency plan is refreshed after canonical preview replacement.';
COMMENT ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid) IS
  'Retry-safe service-role CSF profile merge wrapper with a caller-supplied request id.';
