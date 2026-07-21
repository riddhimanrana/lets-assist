-- Enforce assignment idempotency at the database boundary so two concurrent
-- requests cannot create duplicate active seats for the same member.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS csf_staff_positions_active_assignment_uidx
  ON plugin_data.csf_staff_positions (
    organization_id,
    profile_id,
    role_id,
    school_year
  )
  WHERE status = 'active' AND profile_id IS NOT NULL;

COMMENT ON INDEX plugin_data.csf_staff_positions_active_assignment_uidx IS
  'Prevents concurrent duplicate active CSF position assignments for one member, role, and school year.';
