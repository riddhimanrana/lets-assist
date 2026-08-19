-- Complete the reviewed owner-internal ACL catalog for the remaining
-- application-decision and meeting-authorization helpers. These functions are
-- invoked only from postgres-owned functions or as triggers; service callers
-- must continue through the request-aware public entrypoints.

BEGIN;

REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application_policy_base(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_application_sheet_writeback(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_meeting_permission_under_lock(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_validate_application_check()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_meeting_source_permissions_under_lock(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_decide_term_application_policy_base(uuid, uuid, text, text, uuid)
  TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_application_sheet_writeback(uuid, uuid, text, text)
  TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_meeting_permission_under_lock(uuid, uuid, text)
  TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_validate_application_check()
  TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_meeting_source_permissions_under_lock(uuid, uuid, uuid, text, uuid)
  TO postgres;

COMMIT;
