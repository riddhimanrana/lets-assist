-- Give each closed CSF helper an explicit reviewed owner grant.

BEGIN;

REVOKE ALL ON FUNCTION plugin_data.csf_normalized_record_schema(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_normalized_record_schema(text)
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_derive_row_commit_payload(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_derive_row_commit_payload(text, jsonb)
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_sheet_source_settings_schema()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_source_settings_schema()
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_sheet_source_attachment_keys()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_source_attachment_keys()
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_sheet_source_settings(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_sheet_source_settings(jsonb)
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_set_import_created_profile_resolution()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_import_created_profile_resolution()
  TO postgres;

COMMIT;
