BEGIN;

ALTER TABLE plugin_data.csf_roles
  ADD COLUMN IF NOT EXISTS public_title text,
  ADD COLUMN IF NOT EXISTS responsibility_label text;

UPDATE plugin_data.csf_roles
SET public_title = display_name
WHERE public_title IS NULL;

ALTER TABLE plugin_data.csf_staff_positions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revocation_reason text,
  ADD COLUMN IF NOT EXISTS host_membership_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS host_membership_previous_role text;

UPDATE plugin_data.csf_staff_positions
SET
  revoked_at = coalesce(revoked_at, updated_at, created_at),
  revocation_reason = coalesce(nullif(btrim(revocation_reason), ''), 'Legacy ended position')
WHERE status = 'ended';

ALTER TABLE plugin_data.csf_staff_positions
  DROP CONSTRAINT IF EXISTS csf_staff_positions_effective_window_check,
  ADD CONSTRAINT csf_staff_positions_effective_window_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at),
  DROP CONSTRAINT IF EXISTS csf_staff_positions_revocation_check,
  ADD CONSTRAINT csf_staff_positions_revocation_check
    CHECK (
      (status = 'ended' AND revoked_at IS NOT NULL AND nullif(btrim(revocation_reason), '') IS NOT NULL)
      OR
      (status <> 'ended' AND revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
    ),
  DROP CONSTRAINT IF EXISTS csf_staff_positions_previous_host_role_check,
  ADD CONSTRAINT csf_staff_positions_previous_host_role_check
    CHECK (host_membership_previous_role IS NULL OR host_membership_previous_role IN ('member', 'staff', 'admin'));

ALTER TABLE plugin_data.csf_staff_position_history
  ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS reason_code text;

CREATE INDEX IF NOT EXISTS csf_staff_positions_org_user_effective_idx
  ON plugin_data.csf_staff_positions (organization_id, user_id, status, starts_at, ends_at)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS csf_staff_position_history_correlation_idx
  ON plugin_data.csf_staff_position_history (organization_id, correlation_id, created_at);

CREATE OR REPLACE FUNCTION plugin_data.csf_reject_staff_position_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'CSF staff position history is immutable.';
END;
$$;

DROP TRIGGER IF EXISTS csf_staff_position_history_immutable
  ON plugin_data.csf_staff_position_history;
CREATE TRIGGER csf_staff_position_history_immutable
BEFORE UPDATE OR DELETE ON plugin_data.csf_staff_position_history
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_reject_staff_position_history_mutation();

CREATE OR REPLACE FUNCTION plugin_data.csf_actor_can_manage_staff(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_actor_user_id
        AND member.role = 'admin'
        AND coalesce(member.status, 'active') = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM auth.users AS actor
      WHERE actor.id = p_actor_user_id
        AND lower(actor.email) = 'dvhighcsf@gmail.com'
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      JOIN plugin_data.csf_role_permissions AS permission
        ON permission.organization_id = position.organization_id
       AND permission.role_id = position.role_id
       AND permission.permission_key = 'manage_roles'
       AND permission.enabled = true
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_actor_user_id
        AND position.status = 'active'
        AND (position.starts_at IS NULL OR position.starts_at <= (now() AT TIME ZONE 'America/Los_Angeles')::date)
        AND (position.ends_at IS NULL OR position.ends_at >= (now() AT TIME ZONE 'America/Los_Angeles')::date)
    );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_install_default_roles(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role_count integer := 0;
  v_permission_count integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;

  INSERT INTO plugin_data.csf_roles (
    organization_id,
    key,
    display_name,
    public_title,
    responsibility_label,
    description,
    role_type,
    is_system,
    sort_order,
    updated_at
  )
  SELECT
    p_organization_id,
    template.key,
    template.display_name,
    template.public_title,
    template.responsibility_label,
    template.description,
    template.role_type,
    true,
    template.sort_order,
    now()
  FROM (
    VALUES
      ('owner', 'CSF Owner', 'CSF Owner', 'Platform administration', 'Root CSF plugin owner identity for dvhighcsf@gmail.com and approved successors.', 'owner', 0),
      ('advisor', 'Adviser', 'Adviser', 'Chapter oversight', 'Adviser oversight, academic exceptions, sensitive exports, staff access, and semester close or reopen.', 'officer_template', 10),
      ('co-president', 'Co-President', 'Co-President', NULL, 'General CSF operations and final decisions, excluding owner transfer, adviser academic override, and semester close or reopen.', 'officer_template', 20),
      ('vice-president-membership', 'Vice President — Membership', 'Vice President', 'Membership', 'Applications, member records, meetings, points, imports, and operational reports.', 'officer_template', 30),
      ('vice-president-publicity', 'Vice President — Publicity', 'Vice President', 'Publicity', 'Activities and CSF public content.', 'officer_template', 40),
      ('vice-president-clubs', 'Vice President — Clubs', 'Vice President', 'Clubs', 'Partner clubs, club imports, point verification, and reports.', 'officer_template', 50),
      ('treasurer', 'Treasurer', 'Treasurer', 'Dues', 'Dues verification, reasoned waivers, and dues reports. This role cannot decide applications.', 'officer_template', 60),
      ('secretary', 'Secretary', 'Secretary', 'Meetings and records', 'Schedule, meetings, attendance, member directory, imports, and reports.', 'officer_template', 70),
      ('web-master', 'Web Master', 'Web Master', 'Public content', 'Activity and public-page content without private application or audit access.', 'officer_template', 80),
      ('activity-coordinator', 'Activity Coordinator', 'Activity Coordinator', 'Service activities', 'Create and edit activities and verify participation without final point processing.', 'officer_template', 90),
      ('data-management', 'Data Management', 'Data Management', 'Records and imports', 'Imports, reconciliation, profiles, point processing, reports, and domain-scoped history.', 'officer_template', 100)
  ) AS template(key, display_name, public_title, responsibility_label, description, role_type, sort_order)
  ON CONFLICT (organization_id, key) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    public_title = EXCLUDED.public_title,
    responsibility_label = EXCLUDED.responsibility_label,
    description = EXCLUDED.description,
    role_type = EXCLUDED.role_type,
    is_system = true,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

  GET DIAGNOSTICS v_role_count = ROW_COUNT;

  WITH permission_catalog(permission_key) AS (
    VALUES
      ('manage_roles'),
      ('manage_cohorts_terms'),
      ('manage_profiles'),
      ('review_applications'),
      ('view_applications'),
      ('review_application_checks'),
      ('decide_applications'),
      ('assign_applications'),
      ('write_application_notes'),
      ('manage_restrictions'),
      ('manage_opportunities'),
      ('manage_partner_clubs'),
      ('verify_participation'),
      ('process_points'),
      ('verify_submissions'),
      ('manage_meetings'),
      ('close_term'),
      ('reopen_term'),
      ('edit_point_rules'),
      ('manage_payment_review'),
      ('manage_sheet_sync'),
      ('resolve_imports'),
      ('manage_settings'),
      ('export_reports'),
      ('export_sensitive_reports'),
      ('view_audit_history')
  ),
  role_permission_matrix(role_key, permission_key) AS (
    SELECT role_key, permission_key
    FROM (
      VALUES
        ('owner', ARRAY(SELECT permission_key FROM permission_catalog)),
        ('advisor', ARRAY(SELECT permission_key FROM permission_catalog)),
        ('co-president', ARRAY(SELECT permission_key FROM permission_catalog WHERE permission_key NOT IN ('manage_roles', 'close_term', 'reopen_term'))),
        ('vice-president-membership', ARRAY['manage_profiles','review_applications','view_applications','review_application_checks','decide_applications','assign_applications','write_application_notes','manage_payment_review','manage_meetings','process_points','verify_submissions','manage_sheet_sync','resolve_imports','export_reports']),
        ('vice-president-publicity', ARRAY['manage_opportunities']),
        ('vice-president-clubs', ARRAY['manage_partner_clubs','verify_participation','process_points','verify_submissions','manage_sheet_sync','resolve_imports','export_reports']),
        ('treasurer', ARRAY['view_applications','manage_payment_review','export_reports']),
        ('secretary', ARRAY['manage_cohorts_terms','manage_profiles','manage_meetings','manage_sheet_sync','resolve_imports','export_reports']),
        ('web-master', ARRAY['manage_opportunities']),
        ('activity-coordinator', ARRAY['manage_opportunities','verify_participation']),
        ('data-management', ARRAY['manage_profiles','view_applications','process_points','verify_submissions','manage_sheet_sync','resolve_imports','export_reports','view_audit_history'])
    ) AS role_permissions(role_key, permissions)
    CROSS JOIN LATERAL unnest(role_permissions.permissions) AS permission_key
  )
  INSERT INTO plugin_data.csf_role_permissions (
    organization_id,
    role_id,
    permission_key,
    enabled,
    updated_at
  )
  SELECT
    p_organization_id,
    role.id,
    catalog.permission_key,
    EXISTS (
      SELECT 1
      FROM role_permission_matrix AS allowed
      WHERE allowed.role_key = role.key
        AND allowed.permission_key = catalog.permission_key
    ),
    now()
  FROM plugin_data.csf_roles AS role
  CROSS JOIN permission_catalog AS catalog
  WHERE role.organization_id = p_organization_id
    AND role.key IN (
      'owner', 'advisor', 'co-president', 'vice-president-membership',
      'vice-president-publicity', 'vice-president-clubs', 'treasurer',
      'secretary', 'web-master', 'activity-coordinator', 'data-management'
    )
  ON CONFLICT (role_id, permission_key) DO UPDATE
  SET
    organization_id = EXCLUDED.organization_id,
    enabled = EXCLUDED.enabled,
    updated_at = now();

  GET DIAGNOSTICS v_permission_count = ROW_COUNT;

  UPDATE plugin_data.csf_roles
  SET
    display_name = 'Legacy Vice President',
    public_title = coalesce(public_title, 'Vice President'),
    responsibility_label = coalesce(responsibility_label, 'Legacy custom access'),
    role_type = 'custom',
    is_system = false,
    sort_order = 900,
    updated_at = now()
  WHERE organization_id = p_organization_id
    AND key = 'vice-president';

  RETURN jsonb_build_object(
    'roleCount', v_role_count,
    'permissionCount', v_permission_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_custom_role(
  p_organization_id uuid,
  p_public_title text,
  p_responsibility_label text,
  p_description text,
  p_permission_keys text[],
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_public_title text := nullif(btrim(coalesce(p_public_title, '')), '');
  v_responsibility_label text := nullif(btrim(coalesce(p_responsibility_label, '')), '');
  v_display_name text;
  v_key text;
  v_permissions text[] := coalesce(p_permission_keys, ARRAY[]::text[]);
  v_catalog constant text[] := ARRAY[
    'manage_roles','manage_cohorts_terms','manage_profiles','review_applications',
    'view_applications','review_application_checks','decide_applications',
    'assign_applications','write_application_notes','manage_restrictions',
    'manage_opportunities','manage_partner_clubs','verify_participation',
    'process_points','verify_submissions','manage_meetings','close_term','reopen_term',
    'edit_point_rules','manage_payment_review','manage_sheet_sync','resolve_imports',
    'manage_settings','export_reports','export_sensitive_reports','view_audit_history'
  ];
BEGIN
  IF NOT plugin_data.csf_actor_can_manage_staff(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;
  IF v_public_title IS NULL THEN
    RAISE EXCEPTION 'Public title is required.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_permissions) AS requested(permission_key)
    WHERE NOT (requested.permission_key = ANY(v_catalog))
  ) THEN
    RAISE EXCEPTION 'One or more CSF permissions are invalid.';
  END IF;

  v_display_name := concat_ws(' — ', v_public_title, v_responsibility_label);
  v_key := left(trim(both '-' FROM regexp_replace(lower(v_display_name), '[^a-z0-9]+', '-', 'g')), 64);
  IF v_key = '' THEN
    RAISE EXCEPTION 'Use letters or numbers in the position name.';
  END IF;

  INSERT INTO plugin_data.csf_roles (
    id, organization_id, key, display_name, public_title,
    responsibility_label, description, role_type, is_system, sort_order
  ) VALUES (
    v_role_id, p_organization_id, v_key, v_display_name, v_public_title,
    v_responsibility_label, nullif(btrim(coalesce(p_description, '')), ''),
    'custom', false, 500
  );

  INSERT INTO plugin_data.csf_role_permissions (
    organization_id, role_id, permission_key, enabled
  )
  SELECT p_organization_id, v_role_id, permission_key, true
  FROM unnest(ARRAY(SELECT DISTINCT unnest(v_permissions))) AS permission_key;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'role.create', 'csf_roles', v_role_id,
    jsonb_build_object(
      'publicTitle', v_public_title,
      'responsibilityLabel', v_responsibility_label,
      'permissions', to_jsonb(v_permissions)
    ),
    v_correlation_id, 'staff_access', v_role_id::text, 'custom_role_created'
  );

  RETURN jsonb_build_object(
    'roleId', v_role_id,
    'correlationId', v_correlation_id,
    'displayName', v_display_name
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A CSF position with this title and responsibility already exists.';
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assign_staff_position(
  p_organization_id uuid,
  p_profile_id uuid,
  p_role_id uuid,
  p_school_year text,
  p_display_title text,
  p_starts_at date,
  p_ends_at date,
  p_notes text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role plugin_data.csf_roles%ROWTYPE;
  v_position_id uuid := gen_random_uuid();
  v_user_id uuid;
  v_existing_host_role text;
  v_previous_host_role text;
  v_membership_managed boolean := false;
  v_correlation_id uuid := gen_random_uuid();
  v_display_title text;
  v_school_year text := nullif(btrim(coalesce(p_school_year, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
BEGIN
  IF NOT plugin_data.csf_actor_can_manage_staff(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;
  IF v_school_year IS NULL OR v_school_year !~ '^20[0-9]{2}-20[0-9]{2}$' THEN
    RAISE EXCEPTION 'School year must use YYYY-YYYY.';
  END IF;
  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL AND p_ends_at < p_starts_at THEN
    RAISE EXCEPTION 'Position end date cannot be before its start date.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
      AND profile.record_status = 'active'
  ) THEN
    RAISE EXCEPTION 'CSF member record not found.';
  END IF;

  SELECT role.*
  INTO v_role
  FROM plugin_data.csf_roles AS role
  WHERE role.organization_id = p_organization_id
    AND role.id = p_role_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF position template not found.';
  END IF;

  SELECT account.user_id
  INTO v_user_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.profile_id = p_profile_id
    AND account.status = 'verified'
  ORDER BY account.is_primary DESC, account.linked_at DESC, account.id
  LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Connect a verified Let''s Assist account before assigning staff access.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_staff_positions AS position
    WHERE position.organization_id = p_organization_id
      AND position.profile_id = p_profile_id
      AND position.role_id = p_role_id
      AND position.school_year = v_school_year
      AND position.status = 'active'
  ) THEN
    RAISE EXCEPTION 'This member already has that active position for the selected school year.';
  END IF;

  SELECT member.role
  INTO v_existing_host_role
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = v_user_id
  FOR UPDATE;

  SELECT position.host_membership_previous_role
  INTO v_previous_host_role
  FROM plugin_data.csf_staff_positions AS position
  WHERE position.organization_id = p_organization_id
    AND position.user_id = v_user_id
    AND position.host_membership_managed = true
  ORDER BY position.created_at, position.id
  LIMIT 1;

  IF FOUND THEN
    v_membership_managed := true;
  ELSIF v_existing_host_role IS NULL OR v_existing_host_role = 'member' THEN
    v_previous_host_role := v_existing_host_role;
    v_membership_managed := true;
  END IF;

  INSERT INTO public.organization_members (
    organization_id, user_id, role, joined_at, status
  ) VALUES (
    p_organization_id, v_user_id, 'staff', now(), 'active'
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET
    role = CASE
      WHEN public.organization_members.role = 'admin' THEN 'admin'
      ELSE 'staff'
    END,
    status = 'active';

  v_display_title := coalesce(
    nullif(btrim(coalesce(p_display_title, '')), ''),
    nullif(btrim(coalesce(v_role.public_title, '')), ''),
    v_role.display_name
  );

  INSERT INTO plugin_data.csf_staff_positions (
    id, organization_id, profile_id, user_id, role_id, school_year,
    display_title, status, starts_at, ends_at, appointed_by, notes,
    host_membership_managed, host_membership_previous_role
  ) VALUES (
    v_position_id, p_organization_id, p_profile_id, v_user_id, p_role_id,
    v_school_year, v_display_title, 'active', p_starts_at, p_ends_at,
    p_actor_user_id, v_notes, v_membership_managed, v_previous_host_role
  );

  INSERT INTO plugin_data.csf_staff_position_history (
    organization_id, staff_position_id, actor_user_id, action,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, v_position_id, p_actor_user_id, 'assign', NULL,
    jsonb_build_object(
      'profileId', p_profile_id,
      'userId', v_user_id,
      'roleId', p_role_id,
      'publicTitle', v_display_title,
      'responsibilityLabel', v_role.responsibility_label,
      'schoolYear', v_school_year,
      'startsAt', p_starts_at,
      'endsAt', p_ends_at,
      'hostRole', CASE WHEN v_existing_host_role = 'admin' THEN 'admin' ELSE 'staff' END
    ),
    v_correlation_id, 'position_assigned'
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'staff_position.assign',
    'csf_staff_positions', v_position_id,
    jsonb_build_object(
      'profileId', p_profile_id,
      'userId', v_user_id,
      'roleId', p_role_id,
      'publicTitle', v_display_title,
      'responsibilityLabel', v_role.responsibility_label,
      'schoolYear', v_school_year,
      'startsAt', p_starts_at,
      'endsAt', p_ends_at
    ),
    v_correlation_id, 'staff_access', v_position_id::text, 'position_assigned'
  );

  RETURN jsonb_build_object(
    'positionId', v_position_id,
    'userId', v_user_id,
    'hostRole', CASE WHEN v_existing_host_role = 'admin' THEN 'admin' ELSE 'staff' END,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_revoke_staff_position(
  p_organization_id uuid,
  p_staff_position_id uuid,
  p_effective_end_date date,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_position plugin_data.csf_staff_positions%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_effective_end_date date := coalesce(p_effective_end_date, (now() AT TIME ZONE 'America/Los_Angeles')::date);
  v_correlation_id uuid := gen_random_uuid();
  v_restored_host_role text;
BEGIN
  IF NOT plugin_data.csf_actor_can_manage_staff(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Explain the revocation in at least 8 characters.';
  END IF;

  SELECT position.*
  INTO v_position
  FROM plugin_data.csf_staff_positions AS position
  WHERE position.organization_id = p_organization_id
    AND position.id = p_staff_position_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF staff position not found.';
  END IF;
  IF v_position.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active CSF staff position can be revoked.';
  END IF;
  IF v_position.starts_at IS NOT NULL AND v_effective_end_date < v_position.starts_at THEN
    RAISE EXCEPTION 'Revocation date cannot be before the position start date.';
  END IF;

  UPDATE plugin_data.csf_staff_positions
  SET
    status = 'ended',
    ends_at = v_effective_end_date,
    revoked_at = now(),
    revoked_by = p_actor_user_id,
    revocation_reason = v_reason,
    updated_at = now()
  WHERE id = v_position.id;

  IF v_position.user_id IS NOT NULL
     AND v_position.host_membership_managed
     AND NOT EXISTS (
       SELECT 1
       FROM plugin_data.csf_staff_positions AS remaining
       WHERE remaining.organization_id = p_organization_id
         AND remaining.user_id = v_position.user_id
         AND remaining.id <> v_position.id
         AND remaining.status = 'active'
     ) THEN
    v_restored_host_role := coalesce(v_position.host_membership_previous_role, 'member');
    UPDATE public.organization_members
    SET role = CASE WHEN role = 'admin' THEN 'admin' ELSE v_restored_host_role END
    WHERE organization_id = p_organization_id
      AND user_id = v_position.user_id;
  END IF;

  INSERT INTO plugin_data.csf_staff_position_history (
    organization_id, staff_position_id, actor_user_id, action,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, v_position.id, p_actor_user_id, 'revoke',
    jsonb_build_object(
      'status', v_position.status,
      'endsAt', v_position.ends_at
    ),
    jsonb_build_object(
      'status', 'ended',
      'endsAt', v_effective_end_date,
      'reason', v_reason,
      'restoredHostRole', v_restored_host_role
    ),
    v_correlation_id, 'position_revoked'
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'staff_position.revoke',
    'csf_staff_positions', v_position.id,
    jsonb_build_object('status', v_position.status, 'endsAt', v_position.ends_at),
    jsonb_build_object(
      'status', 'ended',
      'endsAt', v_effective_end_date,
      'reason', v_reason,
      'restoredHostRole', v_restored_host_role
    ),
    v_correlation_id, 'staff_access', v_position.id::text, 'position_revoked'
  );

  RETURN jsonb_build_object(
    'positionId', v_position.id,
    'correlationId', v_correlation_id,
    'hostRole', v_restored_host_role
  );
END;
$$;

DO $$
DECLARE
  v_organization_id uuid;
BEGIN
  FOR v_organization_id IN
    SELECT DISTINCT organization_id
    FROM plugin_data.csf_roles
  LOOP
    PERFORM plugin_data.csf_install_default_roles(v_organization_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_reject_staff_position_history_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_actor_can_manage_staff(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_install_default_roles(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_create_custom_role(uuid, text, text, text, text[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_assign_staff_position(uuid, uuid, uuid, text, text, date, date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_revoke_staff_position(uuid, uuid, date, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_install_default_roles(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_custom_role(uuid, text, text, text, text[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assign_staff_position(uuid, uuid, uuid, text, text, date, date, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_revoke_staff_position(uuid, uuid, date, text, uuid) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_assign_staff_position(uuid, uuid, uuid, text, text, date, date, text, uuid) IS
  'Atomically assigns a CSF position, ensures the verified account has host staff membership without downgrading admins, and writes immutable history plus audit.';
COMMENT ON FUNCTION plugin_data.csf_revoke_staff_position(uuid, uuid, date, text, uuid) IS
  'Atomically revokes a CSF position with a reason, restores CSF-managed host membership when safe, and writes immutable history plus audit.';

COMMIT;
