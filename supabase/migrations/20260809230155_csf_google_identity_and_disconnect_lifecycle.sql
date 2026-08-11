-- A CSF Google connection is useful only when Google has verified the exact
-- chapter identity. `calendar_email` predates that contract and records only a
-- display address, so it cannot distinguish a verified callback from legacy
-- data. Keep explicit callback evidence on the server-only purpose binding.

BEGIN;

ALTER TABLE public.user_google_oauth_connection_bindings
  ADD COLUMN identity_email text,
  ADD COLUMN identity_verified_at timestamptz;

ALTER TABLE public.user_google_oauth_connection_bindings
  ADD CONSTRAINT user_google_oauth_connection_bindings_identity_evidence_check
  CHECK (
    (
      identity_email IS NULL
      AND identity_verified_at IS NULL
    )
    OR (
      identity_email = 'dvhighcsf@gmail.com'
      AND identity_verified_at IS NOT NULL
      AND purpose = 'csf_import'
      AND plugin_key = 'dvhs-csf'
      AND organization_id IS NOT NULL
    )
  );

COMMENT ON COLUMN public.user_google_oauth_connection_bindings.identity_email IS
  'Exact normalized provider identity asserted by a verified Google userinfo callback. Null on legacy and non-CSF bindings; never inferred from calendar_email.';

COMMENT ON COLUMN public.user_google_oauth_connection_bindings.identity_verified_at IS
  'Server timestamp for the verified Google identity assertion. Both identity evidence columns are populated only for an exact DVHS CSF import callback.';

-- The predecessor has no verified-identity parameters. Remove its callable
-- surface rather than allowing a server caller to mint another CSF binding
-- whose provenance is indistinguishable from legacy data.
DROP FUNCTION public.save_google_oauth_connection_for_binding(
  uuid, text, text, text, timestamptz, text, text, text, text, uuid, text, text
);

CREATE FUNCTION public.save_google_oauth_connection_for_binding(
  p_user_id uuid,
  p_provider text,
  p_access_token text,
  p_refresh_token text,
  p_token_expires_at timestamptz,
  p_calendar_email text,
  p_granted_scopes text,
  p_connection_type text,
  p_purpose text,
  p_organization_id uuid,
  p_plugin_key text,
  p_requested_capability text,
  p_identity_email text,
  p_identity_verified_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_connection_id uuid;
BEGIN
  IF p_provider <> 'google' THEN
    RAISE EXCEPTION 'Unsupported OAuth provider';
  END IF;

  IF p_connection_type NOT IN ('calendar', 'sheets', 'both') THEN
    RAISE EXCEPTION 'Unsupported Google connection type';
  END IF;

  IF p_purpose NOT IN (
    'personal_calendar',
    'personal_sheets',
    'organization_calendar',
    'organization_sheets',
    'csf_import'
  ) THEN
    RAISE EXCEPTION 'Unsupported Google OAuth connection purpose';
  END IF;

  IF p_purpose IN ('personal_calendar', 'personal_sheets') AND (
    p_organization_id IS NOT NULL
    OR p_plugin_key IS NOT NULL
    OR p_requested_capability IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Personal Google OAuth connections cannot have organization or plugin bindings';
  END IF;

  IF p_purpose IN ('organization_calendar', 'organization_sheets') AND (
    p_organization_id IS NULL
    OR p_plugin_key IS NOT NULL
    OR p_requested_capability IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Organization Google OAuth connections require exactly one organization binding';
  END IF;

  IF p_purpose = 'csf_import' AND (
    p_organization_id IS NULL
    OR p_plugin_key IS DISTINCT FROM 'dvhs-csf'
    OR p_requested_capability NOT IN (
      'import_applications',
      'import_members',
      'import_meetings',
      'import_partner_clubs'
    )
  ) THEN
    RAISE EXCEPTION 'CSF Google OAuth connections require a valid organization, plugin, and capability';
  END IF;

  IF p_purpose = 'csf_import' AND (
    p_identity_email IS DISTINCT FROM 'dvhighcsf@gmail.com'
    OR p_identity_verified_at IS NULL
    OR lower(btrim(p_calendar_email)) IS DISTINCT FROM p_identity_email
  ) THEN
    RAISE EXCEPTION 'CSF Google OAuth connections require the verified chapter identity';
  END IF;

  IF p_purpose <> 'csf_import' AND (
    p_identity_email IS NOT NULL
    OR p_identity_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Verified CSF identity evidence cannot be attached to another Google purpose';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        ':',
        p_user_id::text,
        p_provider,
        p_purpose,
        coalesce(p_organization_id::text, ''),
        coalesce(p_plugin_key, '')
      ),
      0
    )
  );

  SELECT binding.connection_id
  INTO v_connection_id
  FROM public.user_google_oauth_connection_bindings binding
  WHERE binding.user_id = p_user_id
    AND binding.provider = p_provider
    AND binding.purpose = p_purpose
    AND binding.organization_id IS NOT DISTINCT FROM p_organization_id
    AND binding.plugin_key IS NOT DISTINCT FROM p_plugin_key
  FOR UPDATE;

  IF v_connection_id IS NULL THEN
    INSERT INTO public.user_calendar_connections (
      user_id,
      provider,
      access_token,
      refresh_token,
      token_expires_at,
      calendar_email,
      connected_at,
      is_active,
      preferences,
      granted_scopes,
      granted_scopes_updated_at,
      connection_type
    )
    VALUES (
      p_user_id,
      p_provider,
      p_access_token,
      p_refresh_token,
      p_token_expires_at,
      p_calendar_email,
      now(),
      false,
      jsonb_build_object(
        'reminder_minutes', 15,
        'auto_sync_new_projects', false,
        'auto_sync_signups', false
      ),
      p_granted_scopes,
      CASE WHEN p_granted_scopes IS NULL THEN NULL ELSE now() END,
      p_connection_type
    )
    RETURNING id INTO v_connection_id;

    INSERT INTO public.user_google_oauth_connection_bindings (
      connection_id,
      user_id,
      provider,
      purpose,
      organization_id,
      plugin_key,
      requested_capability,
      identity_email,
      identity_verified_at
    )
    VALUES (
      v_connection_id,
      p_user_id,
      p_provider,
      p_purpose,
      p_organization_id,
      p_plugin_key,
      p_requested_capability,
      p_identity_email,
      p_identity_verified_at
    );
  ELSE
    UPDATE public.user_google_oauth_connection_bindings
    SET requested_capability = p_requested_capability,
        identity_email = p_identity_email,
        identity_verified_at = p_identity_verified_at,
        updated_at = now()
    WHERE connection_id = v_connection_id;
  END IF;

  UPDATE public.user_calendar_connections
  SET access_token = p_access_token,
      refresh_token = p_refresh_token,
      token_expires_at = p_token_expires_at,
      calendar_email = p_calendar_email,
      connected_at = now(),
      is_active = true,
      preferences = coalesce(preferences, '{}'::jsonb) - 'google_oauth_binding',
      granted_scopes = p_granted_scopes,
      granted_scopes_updated_at = CASE
        WHEN p_granted_scopes IS NULL THEN NULL
        ELSE now()
      END,
      connection_type = p_connection_type,
      updated_at = now()
  WHERE id = v_connection_id
    AND user_id = p_user_id
    AND provider = p_provider;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Google OAuth connection binding is inconsistent';
  END IF;

  RETURN v_connection_id;
END;
$$;

-- Keep non-CSF callbacks from an older application bundle working during a
-- rolling deployment. CSF imports deliberately fail closed through the
-- canonical function because this compatibility signature cannot carry
-- verified Google identity evidence.
CREATE FUNCTION public.save_google_oauth_connection_for_binding(
  p_user_id uuid,
  p_provider text,
  p_access_token text,
  p_refresh_token text,
  p_token_expires_at timestamptz,
  p_calendar_email text,
  p_granted_scopes text,
  p_connection_type text,
  p_purpose text,
  p_organization_id uuid,
  p_plugin_key text,
  p_requested_capability text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.save_google_oauth_connection_for_binding(
    p_user_id,
    p_provider,
    p_access_token,
    p_refresh_token,
    p_token_expires_at,
    p_calendar_email,
    p_granted_scopes,
    p_connection_type,
    p_purpose,
    p_organization_id,
    p_plugin_key,
    p_requested_capability,
    NULL::text,
    NULL::timestamptz
  );
$$;

REVOKE ALL ON FUNCTION public.save_google_oauth_connection_for_binding(
  uuid, text, text, text, timestamptz, text, text, text, text, uuid, text, text,
  text, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_google_oauth_connection_for_binding(
  uuid, text, text, text, timestamptz, text, text, text, text, uuid, text, text,
  text, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.save_google_oauth_connection_for_binding(
  uuid, text, text, text, timestamptz, text, text, text, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_google_oauth_connection_for_binding(
  uuid, text, text, text, timestamptz, text, text, text, text, uuid, text, text
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
