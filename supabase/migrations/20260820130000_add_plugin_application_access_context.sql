-- Give an independently deployed plugin a caller-scoped authorization proof.
-- The child uses the caller's Supabase session and publishable key. It receives
-- no service-role credential and no direct browser path into plugin_data.

BEGIN;

CREATE OR REPLACE FUNCTION private.plugin_stable_semver_key(p_version text)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_version ~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
      THEN ARRAY[
        split_part(p_version, '.', 1)::integer,
        split_part(p_version, '.', 2)::integer,
        split_part(p_version, '.', 3)::integer
      ]
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION private.plugin_stable_semver_key(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_plugin_application_access_context(
  p_organization_id uuid,
  p_plugin_key text,
  p_runtime_version text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_membership_role text;
  v_plugin public.plugins%ROWTYPE;
  v_access record;
  v_release public.plugin_versions%ROWTYPE;
  v_installed_version text;
  v_installed_key integer[];
  v_minimum_key integer[];
  v_maximum_key integer[];
  v_force_key integer[];
  v_entitlement_active boolean := false;
  v_enabled boolean := false;
  v_reason text := 'accessible';
  v_accessible boolean := false;
BEGIN
  IF (SELECT auth.role()) <> 'authenticated' OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authenticated session is required' USING errcode = '42501';
  END IF;

  IF p_organization_id IS NULL
    OR p_plugin_key IS NULL
    OR p_plugin_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR p_runtime_version IS NULL
  THEN
    RAISE EXCEPTION 'valid plugin application coordinates are required'
      USING errcode = '22023';
  END IF;

  SELECT members.role::text
  INTO v_membership_role
  FROM public.organization_members AS members
  WHERE members.organization_id = p_organization_id
    AND members.user_id = v_actor_id
    AND members.status = 'active';

  IF NOT found THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'accessible', false,
      'reason', 'membership_required'
    );
  END IF;

  SELECT plugin.*
  INTO v_plugin
  FROM public.plugins AS plugin
  WHERE plugin.key = p_plugin_key;

  -- Reuse the same consolidated catalog, install, and entitlement read model
  -- as the embedded host gate. The active-membership check above keeps this
  -- SECURITY DEFINER read caller-scoped.
  SELECT access.*
  INTO v_access
  FROM public.organization_plugin_access AS access
  WHERE access.organization_id = p_organization_id
    AND access.plugin_key = p_plugin_key;

  SELECT releases.*
  INTO v_release
  FROM public.plugin_versions AS releases
  WHERE releases.plugin_key = p_plugin_key
    AND releases.version = p_runtime_version
    AND releases.status = 'published';

  v_entitlement_active := coalesce(v_access.entitlement_active, false);
  v_enabled := coalesce(v_access.enabled, false);
  v_installed_version := coalesce(
    v_access.installed_version,
    CASE
      WHEN coalesce(v_access.entitlement_is_forced, false)
        THEN v_plugin.latest_version
      ELSE NULL
    END
  );
  v_installed_key := private.plugin_stable_semver_key(v_installed_version);
  v_minimum_key := private.plugin_stable_semver_key(
    v_release.supported_install_contracts ->> 'minimum'
  );
  v_maximum_key := private.plugin_stable_semver_key(
    v_release.supported_install_contracts ->> 'maximum'
  );
  v_force_key := private.plugin_stable_semver_key(v_plugin.force_update_version);

  v_reason := CASE
    WHEN v_plugin.key IS NULL OR NOT coalesce(v_plugin.is_active, false)
      THEN 'plugin_inactive'
    WHEN v_release.plugin_key IS NULL
      THEN 'runtime_release_missing'
    WHEN v_release.runtime_profile <> 'application'
      THEN 'runtime_profile_mismatch'
    WHEN v_plugin.visibility = 'private' AND NOT v_entitlement_active
      THEN 'entitlement_required'
    WHEN NOT v_enabled
      THEN 'install_disabled'
    WHEN NOT coalesce(v_access.is_accessible, false)
      THEN 'control_plane_access_denied'
    WHEN v_installed_key IS NULL OR v_minimum_key IS NULL OR v_maximum_key IS NULL
      THEN 'install_contract_invalid'
    WHEN v_installed_key < v_minimum_key OR v_installed_key > v_maximum_key
      THEN 'install_contract_unsupported'
    WHEN v_plugin.force_update_version IS NOT NULL
      AND (v_force_key IS NULL OR v_installed_key < v_force_key)
      THEN 'forced_update_required'
    ELSE 'accessible'
  END;
  v_accessible := v_reason = 'accessible'
    AND coalesce(v_access.is_accessible, false);

  IF NOT v_accessible AND v_membership_role NOT IN ('admin', 'staff') THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'accessible', false,
      'reason', 'plugin_access_required'
    );
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'organizationId', p_organization_id,
    'pluginKey', p_plugin_key,
    'actorUserId', v_actor_id,
    'membershipRole', v_membership_role,
    'installedVersion', v_installed_version,
    'runtimeVersion', p_runtime_version,
    'runtimeProfile', v_release.runtime_profile,
    'entitlementActive', v_entitlement_active,
    'installEnabled', v_enabled,
    'installContractSupported', v_installed_key IS NOT NULL
      AND v_minimum_key IS NOT NULL
      AND v_maximum_key IS NOT NULL
      AND v_installed_key >= v_minimum_key
      AND v_installed_key <= v_maximum_key,
    'accessible', v_accessible,
    'reason', v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_plugin_application_access_context(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_access_context(uuid, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.get_plugin_application_access_context(uuid, text, text) IS
  'Caller-scoped application-plugin access proof. Revalidates active organization membership, the consolidated catalog/install/entitlement access model, an application-profile published runtime release, forced updates, and the signed install-contract range without exposing plugin data.';

CREATE OR REPLACE FUNCTION public.get_csf_application_role_context(
  p_organization_id uuid,
  p_runtime_version text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_access jsonb;
  v_school_year text;
  v_role record;
  v_permission record;
  v_role_keys text[] := ARRAY[]::text[];
  v_role_titles text[] := ARRAY[]::text[];
  v_permissions text[] := ARRAY[]::text[];
  v_is_owner boolean := false;
BEGIN
  v_access := public.get_plugin_application_access_context(
    p_organization_id,
    'dvhs-csf',
    p_runtime_version
  );

  IF NOT coalesce((v_access ->> 'accessible')::boolean, false) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'accessible', false,
      'reason', v_access ->> 'reason',
      'isOwner', false,
      'roleKeys', '[]'::jsonb,
      'roleTitles', '[]'::jsonb,
      'permissions', '[]'::jsonb
    );
  END IF;

  SELECT terms.school_year
  INTO v_school_year
  FROM plugin_data.csf_terms AS terms
  WHERE terms.organization_id = p_organization_id
    AND terms.is_current = true;

  IF v_school_year IS NOT NULL THEN
    FOR v_role IN
      SELECT DISTINCT roles.key, roles.role_type, positions.display_title
      FROM plugin_data.csf_staff_positions AS positions
      JOIN plugin_data.csf_roles AS roles
        ON roles.id = positions.role_id
       AND roles.organization_id = positions.organization_id
      WHERE positions.organization_id = p_organization_id
        AND positions.user_id = v_actor_id
        AND positions.school_year = v_school_year
        AND positions.status = 'active'
        AND (
          positions.starts_at IS NULL
          OR positions.starts_at <= plugin_data.csf_chapter_today()
        )
        AND (
          positions.ends_at IS NULL
          OR positions.ends_at >= plugin_data.csf_chapter_today()
        )
      ORDER BY roles.key, positions.display_title
    LOOP
      IF NOT v_role.key = ANY(v_role_keys) THEN
        v_role_keys := array_append(v_role_keys, v_role.key);
      END IF;
      IF NOT v_role.display_title = ANY(v_role_titles) THEN
        v_role_titles := array_append(v_role_titles, v_role.display_title);
      END IF;
      v_is_owner := v_is_owner
        OR v_role.role_type = 'owner'
        OR v_role.key = 'owner';
    END LOOP;

    FOR v_permission IN
      SELECT DISTINCT permissions.permission_key
      FROM plugin_data.csf_staff_positions AS positions
      JOIN plugin_data.csf_role_permissions AS permissions
        ON permissions.role_id = positions.role_id
       AND permissions.organization_id = positions.organization_id
      WHERE positions.organization_id = p_organization_id
        AND positions.user_id = v_actor_id
        AND positions.school_year = v_school_year
        AND positions.status = 'active'
        AND (
          positions.starts_at IS NULL
          OR positions.starts_at <= plugin_data.csf_chapter_today()
        )
        AND (
          positions.ends_at IS NULL
          OR positions.ends_at >= plugin_data.csf_chapter_today()
        )
        AND permissions.enabled = true
      ORDER BY permissions.permission_key
    LOOP
      v_permissions := array_append(v_permissions, v_permission.permission_key);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'accessible', true,
    'reason', 'accessible',
    'isOwner', v_is_owner,
    'roleKeys', to_jsonb(v_role_keys),
    'roleTitles', to_jsonb(v_role_titles),
    'permissions', to_jsonb(v_permissions)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_csf_application_role_context(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_csf_application_role_context(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.get_csf_application_role_context(uuid, text) IS
  'Caller-scoped CSF role proof for the independent application. Returns only the caller''s effective role keys, titles, owner flag, and enabled permission keys after the generic plugin access proof succeeds.';

NOTIFY pgrst, 'reload schema';

COMMIT;
