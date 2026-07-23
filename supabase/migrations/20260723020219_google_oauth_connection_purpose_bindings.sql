-- Google OAuth credentials are reusable only inside the exact product purpose
-- that authorized them. The legacy preferences JSON remains user-editable and
-- therefore must never be treated as an authorization boundary.

ALTER TABLE public.user_calendar_connections
  ADD CONSTRAINT user_calendar_connections_id_user_provider_key
  UNIQUE (id, user_id, provider);

CREATE TABLE public.user_google_oauth_connection_bindings (
  connection_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'google',
  purpose text NOT NULL,
  organization_id uuid,
  plugin_key text,
  requested_capability text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_google_oauth_connection_bindings_connection_fkey
    FOREIGN KEY (connection_id, user_id, provider)
    REFERENCES public.user_calendar_connections (id, user_id, provider)
    ON DELETE CASCADE,
  CONSTRAINT user_google_oauth_connection_bindings_organization_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id)
    ON DELETE CASCADE,
  CONSTRAINT user_google_oauth_connection_bindings_provider_check
    CHECK (provider = 'google'),
  CONSTRAINT user_google_oauth_connection_bindings_purpose_check
    CHECK (
      purpose IN (
        'personal_calendar',
        'personal_sheets',
        'organization_calendar',
        'organization_sheets',
        'csf_import'
      )
    ),
  CONSTRAINT user_google_oauth_connection_bindings_shape_check
    CHECK (
      (
        purpose IN ('personal_calendar', 'personal_sheets')
        AND organization_id IS NULL
        AND plugin_key IS NULL
        AND requested_capability IS NULL
      )
      OR (
        purpose IN ('organization_calendar', 'organization_sheets')
        AND organization_id IS NOT NULL
        AND plugin_key IS NULL
        AND requested_capability IS NULL
      )
      OR (
        purpose = 'csf_import'
        AND organization_id IS NOT NULL
        AND plugin_key = 'dvhs-csf'
        AND requested_capability IN (
          'import_applications',
          'import_members',
          'import_meetings',
          'import_partner_clubs'
        )
      )
    ),
  CONSTRAINT user_google_oauth_connection_bindings_identity_key
    UNIQUE NULLS NOT DISTINCT (
      user_id,
      provider,
      purpose,
      organization_id,
      plugin_key
    )
);

COMMENT ON TABLE public.user_google_oauth_connection_bindings IS
  'Server-managed purpose and tenant bindings for Google OAuth credentials. Client-editable connection preferences are not authoritative.';

COMMENT ON COLUMN public.user_google_oauth_connection_bindings.requested_capability IS
  'Last CSF Google capability authorized at callback time. This is audit metadata, not credential identity; each consuming action rechecks its current permission.';

ALTER TABLE public.user_google_oauth_connection_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_google_oauth_connection_bindings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_google_oauth_connection_bindings FROM PUBLIC;
REVOKE ALL ON TABLE public.user_google_oauth_connection_bindings FROM anon;
REVOKE ALL ON TABLE public.user_google_oauth_connection_bindings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_google_oauth_connection_bindings TO service_role;

-- A binding owns its credential row. Remove organization-bound credential rows
-- before the organization cascade removes their bindings, so encrypted tokens
-- cannot survive as unreachable legacy rows. Normal per-purpose disconnects
-- delete the connection row directly and rely on the binding FK cascade.
CREATE OR REPLACE FUNCTION public.cleanup_google_oauth_connections_before_organization_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.user_calendar_connections connection
  WHERE connection.id IN (
    SELECT binding.connection_id
    FROM public.user_google_oauth_connection_bindings binding
    WHERE binding.organization_id = OLD.id
  );

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_google_oauth_connections_before_organization_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_google_oauth_connections_before_organization_delete() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_google_oauth_connections_before_organization_delete() FROM authenticated;

CREATE TRIGGER cleanup_google_oauth_connections_before_organization_delete
BEFORE DELETE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_google_oauth_connections_before_organization_delete();

DROP INDEX IF EXISTS public.idx_user_calendar_unique_active;

CREATE UNIQUE INDEX idx_user_calendar_unique_active_non_google
ON public.user_calendar_connections (user_id, provider)
WHERE is_active AND provider <> 'google';

CREATE OR REPLACE FUNCTION public.enforce_google_oauth_unbound_active_uniqueness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.provider <> 'google' OR NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  -- Serialize activation for this user's provider. Bound rows are isolated by
  -- the server-only binding key; legacy rows retain their former single-active
  -- behavior without preventing additional purpose-bound connections.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.user_id::text || ':' || NEW.provider, 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_google_oauth_connection_bindings binding
    WHERE binding.connection_id = NEW.id
  ) AND EXISTS (
    SELECT 1
    FROM public.user_calendar_connections candidate
    WHERE candidate.user_id = NEW.user_id
      AND candidate.provider = NEW.provider
      AND candidate.is_active
      AND candidate.id <> NEW.id
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_google_oauth_connection_bindings candidate_binding
        WHERE candidate_binding.connection_id = candidate.id
      )
  ) THEN
    RAISE EXCEPTION 'Only one unbound active Google connection is allowed per user'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_google_oauth_unbound_active_uniqueness() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_google_oauth_unbound_active_uniqueness() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_google_oauth_unbound_active_uniqueness() FROM authenticated;

CREATE TRIGGER enforce_google_oauth_unbound_active_uniqueness
BEFORE INSERT OR UPDATE OF user_id, provider, is_active
ON public.user_calendar_connections
FOR EACH ROW
EXECUTE FUNCTION public.enforce_google_oauth_unbound_active_uniqueness();

-- Existing preference JSON is user-editable and cannot be trusted as a tenant
-- or purpose boundary. This migration-only helper binds only legacy rows with
-- exactly one trusted organization sync target, an active admin owner, a single
-- active unbound Google credential, and matching recorded scopes. Everything
-- else remains intentionally unbound and must reconnect.
CREATE OR REPLACE FUNCTION public.backfill_unambiguous_google_oauth_organization_bindings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH trusted_targets AS (
    SELECT
      sync.created_by AS user_id,
      sync.organization_id,
      'organization_calendar'::text AS purpose
    FROM public.organization_calendar_syncs sync
    JOIN public.organization_members membership
      ON membership.organization_id = sync.organization_id
     AND membership.user_id = sync.created_by
     AND membership.role = 'admin'
     AND membership.status = 'active'
    WHERE sync.created_by IS NOT NULL

    UNION ALL

    SELECT
      sync.created_by AS user_id,
      sync.organization_id,
      'organization_sheets'::text AS purpose
    FROM public.organization_sheet_syncs sync
    JOIN public.organization_members membership
      ON membership.organization_id = sync.organization_id
     AND membership.user_id = sync.created_by
     AND membership.role = 'admin'
     AND membership.status = 'active'
  ), target_counts AS (
    SELECT user_id, count(*) AS target_count
    FROM trusted_targets
    GROUP BY user_id
  ), candidates AS (
    SELECT
      connection.id AS connection_id,
      connection.user_id,
      connection.provider,
      target.purpose,
      target.organization_id
    FROM trusted_targets target
    JOIN target_counts counts
      ON counts.user_id = target.user_id
     AND counts.target_count = 1
    JOIN public.user_calendar_connections connection
      ON connection.user_id = target.user_id
     AND connection.provider = 'google'
     AND connection.is_active
     AND (
       (
         target.purpose = 'organization_calendar'
         AND connection.connection_type IN ('calendar', 'both')
         AND coalesce(connection.granted_scopes, '') LIKE '%https://www.googleapis.com/auth/calendar%'
       )
       OR (
         target.purpose = 'organization_sheets'
         AND connection.connection_type IN ('sheets', 'both')
         AND coalesce(connection.granted_scopes, '') LIKE '%https://www.googleapis.com/auth/drive.file%'
       )
     )
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.user_google_oauth_connection_bindings existing
      WHERE existing.connection_id = connection.id
    )
      AND 1 = (
        SELECT count(*)
        FROM public.user_calendar_connections unbound
        WHERE unbound.user_id = target.user_id
          AND unbound.provider = 'google'
          AND unbound.is_active
          AND NOT EXISTS (
            SELECT 1
            FROM public.user_google_oauth_connection_bindings bound
            WHERE bound.connection_id = unbound.id
          )
      )
  )
  INSERT INTO public.user_google_oauth_connection_bindings (
    connection_id,
    user_id,
    provider,
    purpose,
    organization_id,
    plugin_key,
    requested_capability
  )
  SELECT
    candidate.connection_id,
    candidate.user_id,
    candidate.provider,
    candidate.purpose,
    candidate.organization_id,
    NULL,
    NULL
  FROM candidates candidate
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_unambiguous_google_oauth_organization_bindings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_unambiguous_google_oauth_organization_bindings() FROM anon;
REVOKE ALL ON FUNCTION public.backfill_unambiguous_google_oauth_organization_bindings() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_unambiguous_google_oauth_organization_bindings() TO service_role;

SELECT public.backfill_unambiguous_google_oauth_organization_bindings();

-- The backfill is intentionally one-shot. No runtime role may invoke it after
-- migration application, including service_role.
REVOKE ALL ON FUNCTION public.backfill_unambiguous_google_oauth_organization_bindings() FROM service_role;

CREATE OR REPLACE FUNCTION public.save_google_oauth_connection_for_binding(
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

  -- The table check remains the canonical shape validation. This lock makes
  -- concurrent callbacks for one binding converge on a single row.
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
      requested_capability
    )
    VALUES (
      v_connection_id,
      p_user_id,
      p_provider,
      p_purpose,
      p_organization_id,
      p_plugin_key,
      p_requested_capability
    );
  ELSE
    UPDATE public.user_google_oauth_connection_bindings
    SET requested_capability = p_requested_capability,
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

REVOKE ALL ON FUNCTION public.save_google_oauth_connection_for_binding(
  uuid, text, text, text, timestamptz, text, text, text, text, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_google_oauth_connection_for_binding(
  uuid, text, text, text, timestamptz, text, text, text, text, uuid, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.save_google_oauth_connection_for_binding(
  uuid, text, text, text, timestamptz, text, text, text, text, uuid, text, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_google_oauth_connection_for_binding(
  uuid, text, text, text, timestamptz, text, text, text, text, uuid, text, text
) TO service_role;
