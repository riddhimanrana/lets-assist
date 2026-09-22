-- PostgREST hoists this setting before executing the reviewed term release.
-- A whole chapter release includes immutable exports and deferred notices.
ALTER FUNCTION plugin_data.csf_release_reviewed_sheet_decisions(uuid,uuid,uuid,uuid,text)
  SET statement_timeout = '60s';
REVOKE ALL ON FUNCTION plugin_data.csf_release_reviewed_sheet_decisions(uuid,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_release_reviewed_sheet_decisions(uuid,uuid,uuid,uuid,text)
  TO service_role;
NOTIFY pgrst, 'reload schema';
