-- Attach the concurrently-built index without rebuilding it under an exclusive
-- table lock, then enforce organization consistency for all new role links.
ALTER TABLE plugin_data.csf_roles
  ADD CONSTRAINT csf_roles_id_organization_id_key
  UNIQUE USING INDEX csf_roles_id_organization_id_uidx;

ALTER TABLE plugin_data.csf_staff_positions
  ADD CONSTRAINT csf_staff_positions_role_organization_fkey
  FOREIGN KEY (role_id, organization_id)
  REFERENCES plugin_data.csf_roles (id, organization_id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE plugin_data.csf_role_permissions
  ADD CONSTRAINT csf_role_permissions_role_organization_fkey
  FOREIGN KEY (role_id, organization_id)
  REFERENCES plugin_data.csf_roles (id, organization_id)
  ON DELETE CASCADE
  NOT VALID;
