-- Global public landing-page display mode. Off on installation; no business data changes.
CREATE TABLE app_private.landing_demo_setting (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE app_private.landing_demo_setting ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.landing_demo_setting FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO app_private.landing_demo_setting(singleton, enabled) VALUES (true, false);

CREATE TABLE app_private.landing_demo_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_enabled boolean NOT NULL,
  to_enabled boolean NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE app_private.landing_demo_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.landing_demo_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE app_private.landing_demo_events_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_landing_demo_mode()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT enabled FROM app_private.landing_demo_setting WHERE singleton = true;
$$;

CREATE FUNCTION public.set_landing_demo_mode(
  p_enabled boolean, p_expected boolean, p_actor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_enabled IS NULL OR p_expected IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Invalid landing page mode.' USING ERRCODE = '22023';
  END IF;
  -- Service-only caller plus a fresh authoritative actor check. User metadata
  -- and cached JWT claims never authorize this sitewide change.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u WHERE u.id = p_actor_id AND (
      u.raw_app_meta_data->'is_super_admin' = 'true'::jsonb OR
      lower(btrim(u.raw_app_meta_data->>'role')) = 'super_admin'
    )
  ) THEN
    RAISE EXCEPTION 'Super admin access required.' USING ERRCODE = '42501';
  END IF;
  UPDATE app_private.landing_demo_setting
  SET enabled = p_enabled, updated_at = now(), updated_by = p_actor_id
  WHERE singleton = true AND enabled = p_expected;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_enabled IS DISTINCT FROM p_expected THEN
    INSERT INTO app_private.landing_demo_events(from_enabled, to_enabled, changed_by)
    VALUES (p_expected, p_enabled, p_actor_id);
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_landing_demo_mode() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_landing_demo_mode(boolean, boolean, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_landing_demo_mode() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_landing_demo_mode(boolean, boolean, uuid) TO service_role;
