-- Complete the explicit owner-only execution ACLs for plugin release helpers
-- introduced or replaced after the prior function ACL restoration.

BEGIN;

ALTER FUNCTION private.require_plugin_release_identity() OWNER TO postgres;
ALTER FUNCTION private.enforce_plugin_release_immutability() OWNER TO postgres;
ALTER FUNCTION private.plugin_stable_semver_key(text) OWNER TO postgres;
ALTER FUNCTION private.plugin_host_api_version() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.require_plugin_release_identity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.enforce_plugin_release_immutability() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.plugin_stable_semver_key(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.plugin_host_api_version() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.require_plugin_release_identity() TO postgres;
GRANT EXECUTE ON FUNCTION private.enforce_plugin_release_immutability() TO postgres;
GRANT EXECUTE ON FUNCTION private.plugin_stable_semver_key(text) TO postgres;
GRANT EXECUTE ON FUNCTION private.plugin_host_api_version() TO postgres;

COMMIT;
