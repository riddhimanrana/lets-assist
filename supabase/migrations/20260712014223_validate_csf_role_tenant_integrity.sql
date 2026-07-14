-- Validation scans existing rows without taking the stronger lock required to
-- create the constraints from scratch. The old single-column foreign keys stay
-- in place until both tenant-aware constraints are proven valid.
ALTER TABLE plugin_data.csf_staff_positions
  VALIDATE CONSTRAINT csf_staff_positions_role_organization_fkey;

ALTER TABLE plugin_data.csf_role_permissions
  VALIDATE CONSTRAINT csf_role_permissions_role_organization_fkey;

ALTER TABLE plugin_data.csf_staff_positions
  DROP CONSTRAINT csf_staff_positions_role_id_fkey;

ALTER TABLE plugin_data.csf_role_permissions
  DROP CONSTRAINT csf_role_permissions_role_id_fkey;
