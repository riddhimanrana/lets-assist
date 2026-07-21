-- Keep the documented chapter roster as explicit seat capacity rather than an
-- informal UI convention. Custom roles remain unlimited unless configured.

BEGIN;

ALTER TABLE plugin_data.csf_roles
  ADD COLUMN max_active_seats integer CHECK (max_active_seats IS NULL OR max_active_seats > 0);

UPDATE plugin_data.csf_roles
SET max_active_seats = CASE key
  WHEN 'owner' THEN 1
  WHEN 'advisor' THEN 1
  WHEN 'co-president' THEN 2
  WHEN 'vice-president-membership' THEN 1
  WHEN 'vice-president-publicity' THEN 1
  WHEN 'vice-president-clubs' THEN 1
  WHEN 'treasurer' THEN 1
  WHEN 'secretary' THEN 1
  WHEN 'web-master' THEN 1
  WHEN 'activity-coordinator' THEN 5
  WHEN 'data-management' THEN 1
  ELSE max_active_seats
END
WHERE is_system = true;

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_staff_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer;
  v_active_count integer;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;

  SELECT role.max_active_seats INTO v_limit
  FROM plugin_data.csf_roles AS role
  WHERE role.organization_id = NEW.organization_id
    AND role.id = NEW.role_id;
  IF v_limit IS NULL THEN RETURN NEW; END IF;

  SELECT count(*)::integer INTO v_active_count
  FROM plugin_data.csf_staff_positions AS position
  WHERE position.organization_id = NEW.organization_id
    AND position.role_id = NEW.role_id
    AND position.school_year = NEW.school_year
    AND position.status = 'active'
    AND position.id <> NEW.id;

  IF v_active_count >= v_limit THEN
    RAISE EXCEPTION 'All % seat(s) for this CSF position are already filled for %.', v_limit, NEW.school_year;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_staff_positions_seat_limit_trigger
  ON plugin_data.csf_staff_positions;
CREATE TRIGGER csf_staff_positions_seat_limit_trigger
BEFORE INSERT OR UPDATE OF role_id, school_year, status
ON plugin_data.csf_staff_positions
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_staff_seat_limit();

ALTER FUNCTION plugin_data.csf_install_default_roles(uuid)
  RENAME TO csf_install_default_roles_seat_limit_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_install_default_roles(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := plugin_data.csf_install_default_roles_seat_limit_base(p_organization_id);

  UPDATE plugin_data.csf_roles
  SET max_active_seats = CASE key
    WHEN 'owner' THEN 1
    WHEN 'advisor' THEN 1
    WHEN 'co-president' THEN 2
    WHEN 'vice-president-membership' THEN 1
    WHEN 'vice-president-publicity' THEN 1
    WHEN 'vice-president-clubs' THEN 1
    WHEN 'treasurer' THEN 1
    WHEN 'secretary' THEN 1
    WHEN 'web-master' THEN 1
    WHEN 'activity-coordinator' THEN 5
    WHEN 'data-management' THEN 1
    ELSE max_active_seats
  END,
  updated_at = now()
  WHERE organization_id = p_organization_id
    AND is_system = true;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_staff_seat_limit()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_install_default_roles_seat_limit_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_install_default_roles(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_install_default_roles(uuid)
  TO service_role;

COMMENT ON COLUMN plugin_data.csf_roles.max_active_seats IS
  'Maximum simultaneous assignments for one school year. NULL means no configured limit.';

COMMIT;
