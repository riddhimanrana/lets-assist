-- Store the authenticated staff presentation preference in one bounded call.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_csf_staff_view_mode(
  p_organization_id uuid,
  p_view_mode text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, plugin_data, pg_temp
SET row_security = off
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_view_mode NOT IN ('member', 'officer') THEN
    RAISE EXCEPTION 'Unknown view mode.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = v_actor_user_id
      AND membership.status = 'active'
      AND membership.role IN ('admin', 'staff')
  ) THEN
    RAISE EXCEPTION 'Active organization staff access is required.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO plugin_data.csf_staff_view_preferences (
    organization_id,
    user_id,
    view_mode,
    updated_at
  )
  VALUES (
    p_organization_id,
    v_actor_user_id,
    p_view_mode,
    clock_timestamp()
  )
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET
    view_mode = EXCLUDED.view_mode,
    updated_at = EXCLUDED.updated_at;
END;
$$;

ALTER FUNCTION public.set_csf_staff_view_mode(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_csf_staff_view_mode(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_csf_staff_view_mode(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.set_csf_staff_view_mode(uuid, text) IS
  'Stores the authenticated active organization staff member''s presentation-only CSF view preference in one caller-scoped transaction. The preference never grants staff authority.';

COMMIT;
