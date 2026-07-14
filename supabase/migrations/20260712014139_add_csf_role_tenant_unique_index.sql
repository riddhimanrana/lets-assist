-- Build the referenced tenant key without blocking writes while the index scans.
-- A following migration attaches this index as a unique constraint before adding
-- composite foreign keys from CSF role consumers.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS csf_roles_id_organization_id_uidx
  ON plugin_data.csf_roles (id, organization_id);
