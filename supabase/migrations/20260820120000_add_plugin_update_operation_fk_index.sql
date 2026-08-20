-- Cover both plugin_update_operations foreign keys with one left-prefix index.
-- The table's existing partial pending index starts with organization_id, so it
-- cannot support deletes or updates that begin from public.plugins(key) or the
-- composite public.plugin_versions(plugin_key, version) key.

CREATE INDEX plugin_update_operations_release_idx
  ON private.plugin_update_operations (plugin_key, target_version);
