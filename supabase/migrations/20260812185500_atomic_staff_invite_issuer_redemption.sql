-- Bind staff invite capabilities to the exact active administrator who issued
-- them, and redeem them through one service-only transaction. Legacy tokens
-- intentionally retain a NULL issuer and therefore fail closed.

ALTER TABLE public.organizations
  ADD COLUMN staff_join_token_issued_by uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.organizations.staff_join_token_issued_by IS
  'Exact organization administrator who issued the current staff join token. NULL legacy tokens cannot be redeemed.';

CREATE OR REPLACE FUNCTION public.redeem_staff_join_token(
  p_user_id uuid,
  p_staff_token uuid,
  p_org_username text,
  p_redeemed_at timestamptz
)
RETURNS TABLE (
  status text,
  org_username text,
  org_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_organization public.organizations%ROWTYPE;
  v_issuer_role text;
  v_issuer_status text;
  v_target_role text;
  v_target_status text;
BEGIN
  IF p_user_id IS NULL OR p_staff_token IS NULL OR p_org_username IS NULL THEN
    RETURN QUERY
      SELECT 'error'::text, p_org_username, NULL::text;
    RETURN;
  END IF;

  SELECT organizations.*
    INTO v_organization
  FROM public.organizations AS organizations
  WHERE organizations.username = p_org_username
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT 'org_not_found'::text, p_org_username, NULL::text;
    RETURN;
  END IF;

  IF v_organization.staff_join_token IS DISTINCT FROM p_staff_token
     OR v_organization.staff_join_token_issued_by IS NULL THEN
    RETURN QUERY
      SELECT
        'invalid_token'::text,
        v_organization.username::text,
        v_organization.name::text;
    RETURN;
  END IF;

  IF v_organization.staff_join_token_expires_at IS NULL
     OR v_organization.staff_join_token_expires_at
        < COALESCE(p_redeemed_at, pg_catalog.now()) THEN
    RETURN QUERY
      SELECT
        'expired_token'::text,
        v_organization.username::text,
        v_organization.name::text;
    RETURN;
  END IF;

  -- Lock the exact issuer row. If a concurrent deactivation acquired the row
  -- first, READ COMMITTED rechecks the row after waiting and this transaction
  -- observes the inactive status before any target membership write.
  SELECT members.role::text, members.status::text
    INTO v_issuer_role, v_issuer_status
  FROM public.organization_members AS members
  WHERE members.organization_id = v_organization.id
    AND members.user_id = v_organization.staff_join_token_issued_by
  FOR UPDATE;

  IF NOT FOUND
     OR v_issuer_role <> 'admin'
     OR v_issuer_status <> 'active' THEN
    RETURN QUERY
      SELECT
        'error'::text,
        v_organization.username::text,
        v_organization.name::text;
    RETURN;
  END IF;

  SELECT members.role::text, members.status::text
    INTO v_target_role, v_target_status
  FROM public.organization_members AS members
  WHERE members.organization_id = v_organization.id
    AND members.user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_target_status <> 'active' THEN
      RETURN QUERY
        SELECT
          'error'::text,
          v_organization.username::text,
          v_organization.name::text;
      RETURN;
    END IF;

    IF v_target_role = 'member' THEN
      UPDATE public.organization_members AS members
      SET role = 'staff'
      WHERE members.organization_id = v_organization.id
        AND members.user_id = p_user_id
        AND members.role = 'member'
        AND members.status = 'active';
    END IF;
  ELSE
    INSERT INTO public.organization_members (
      organization_id,
      user_id,
      role,
      status,
      joined_at
    )
    VALUES (
      v_organization.id,
      p_user_id,
      'staff',
      'active',
      COALESCE(p_redeemed_at, pg_catalog.now())
    )
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    IF NOT FOUND THEN
      -- A separate membership writer won the race. Lock and evaluate the
      -- resulting row instead of reviving or overwriting it.
      SELECT members.role::text, members.status::text
        INTO v_target_role, v_target_status
      FROM public.organization_members AS members
      WHERE members.organization_id = v_organization.id
        AND members.user_id = p_user_id
      FOR UPDATE;

      IF NOT FOUND OR v_target_status <> 'active' THEN
        RETURN QUERY
          SELECT
            'error'::text,
            v_organization.username::text,
            v_organization.name::text;
        RETURN;
      END IF;

      IF v_target_role = 'member' THEN
        UPDATE public.organization_members AS members
        SET role = 'staff'
        WHERE members.organization_id = v_organization.id
          AND members.user_id = p_user_id
          AND members.role = 'member'
          AND members.status = 'active';
      END IF;
    END IF;
  END IF;

  RETURN QUERY
    SELECT
      'success'::text,
      v_organization.username::text,
      v_organization.name::text;
END;
$$;

ALTER FUNCTION public.redeem_staff_join_token(uuid, uuid, text, timestamptz)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION
  public.redeem_staff_join_token(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.redeem_staff_join_token(uuid, uuid, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION
  public.redeem_staff_join_token(uuid, uuid, text, timestamptz) IS
  'Service-only atomic staff invite redemption bound to the exact active token issuer; legacy issuerless tokens fail closed.';
