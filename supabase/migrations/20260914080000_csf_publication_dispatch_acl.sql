BEGIN;

REVOKE ALL ON FUNCTION plugin_data.csf_authorize_communication_dispatch(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_authorize_communication_dispatch(uuid, uuid, text, text)
  TO postgres, service_role;

COMMIT;
