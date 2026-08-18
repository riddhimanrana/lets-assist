-- Record the remaining owner-internal execution boundary explicitly. These
-- helpers are reached only from postgres-owned functions/triggers; browser and
-- service roles must continue through the reviewed request-aware entrypoints.

REVOKE ALL ON FUNCTION plugin_data.csf_consume_sheet_source_evidence(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_consume_sheet_source_evidence(uuid, uuid, uuid, uuid, uuid)
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_lock_identity_mutation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_lock_identity_mutation(uuid)
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_import_row_disposition(
  timestamptz, uuid, uuid, uuid, integer, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_import_row_disposition(
  timestamptz, uuid, uuid, uuid, integer, text, text, text
) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_import_target_conflicts(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_import_target_conflicts(uuid, uuid)
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_lock_active_import_profiles(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_lock_active_import_profiles(uuid, uuid[])
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage()
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_actor(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_import_actor(uuid, uuid, text)
  TO postgres;
