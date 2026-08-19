-- Complete the explicit owner-internal execution boundary for helpers replaced
-- during the CSF release. Browser and service callers must continue through
-- the reviewed request-aware entrypoints; triggers and postgres-owned wrapper
-- functions are the only executors of these implementation functions.

BEGIN;

ALTER FUNCTION plugin_data.csf_sanitize_profile_merge_audit()
  OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_merge_profiles_identity_base(
  uuid, uuid, uuid, text, uuid
) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_commit_import_row_for_attempt_identity_base(
  uuid, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_import_compatibility_permissions(text)
  OWNER TO postgres;
ALTER FUNCTION private.end_recurring_project_series_transactional()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_sanitize_profile_merge_audit()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_identity_base(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_for_attempt_identity_base(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_compatibility_permissions(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.end_recurring_project_series_transactional()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_sanitize_profile_merge_audit()
  TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_identity_base(
  uuid, uuid, uuid, text, uuid
) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_import_row_for_attempt_identity_base(
  uuid, uuid, uuid
) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_compatibility_permissions(text)
  TO postgres;
GRANT EXECUTE ON FUNCTION private.end_recurring_project_series_transactional()
  TO postgres;

COMMIT;
