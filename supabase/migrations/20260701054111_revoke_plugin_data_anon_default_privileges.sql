-- Prevent future plugin_data objects from inheriting anonymous privileges.
--
-- Earlier migrations removed current anon table/schema access, but the default
-- privileges still allowed future plugin_data tables created by postgres to
-- grant SELECT to anon. This closes that footgun while preserving the current
-- authenticated RLS-backed server/client transition state.

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA plugin_data
  REVOKE ALL ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA plugin_data
  REVOKE ALL ON SEQUENCES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA plugin_data
  REVOKE ALL ON FUNCTIONS FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE service_role IN SCHEMA plugin_data
  REVOKE ALL ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE service_role IN SCHEMA plugin_data
  REVOKE ALL ON SEQUENCES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE service_role IN SCHEMA plugin_data
  REVOKE ALL ON FUNCTIONS FROM anon;

COMMIT;
