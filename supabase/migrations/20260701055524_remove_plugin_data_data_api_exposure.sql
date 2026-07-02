-- Remove plugin_data from direct authenticated Data API access.
--
-- The plugin platform now treats plugin_data as an internal schema. Browser and
-- normal server-rendered plugin surfaces must go through host server actions,
-- route handlers, narrow RPCs, public read models, or service-role/internal
-- helpers. RLS remains enabled as defense in depth, but Data API grants are no
-- longer the integration contract.

BEGIN;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_data FROM authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_data FROM authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA plugin_data FROM authenticated;
REVOKE USAGE ON SCHEMA plugin_data FROM authenticated;

COMMIT;
