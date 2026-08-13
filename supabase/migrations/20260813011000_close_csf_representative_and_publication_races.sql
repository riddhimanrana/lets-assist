-- AUD-036 follow-up: close the remaining representative-authority and
-- activity-publication races without changing any public signature.
--
-- This migration is deliberately ordered after the open #174 migration tail
-- (20260812203500), the open #158 migration tail (20260812215733), and this
-- branch's original authorization fence (20260812225436). It only replaces
-- the three functions named below; it does not restate either dependency's
-- definitions.

BEGIN;

ALTER FUNCTION plugin_data.csf_assign_partner_representative(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
)
RENAME TO csf_assign_partner_representative_locked_impl;

ALTER FUNCTION plugin_data.csf_revoke_partner_representative(
  uuid, uuid, uuid, text, uuid, uuid
)
RENAME TO csf_revoke_partner_representative_locked_impl;

REVOKE ALL ON FUNCTION plugin_data.csf_assign_partner_representative_locked_impl(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_revoke_partner_representative_locked_impl(
  uuid, uuid, uuid, text, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_assign_partner_representative(
  p_organization_id uuid,
  p_partner_club_term_id uuid,
  p_display_name text,
  p_email text,
  p_role text,
  p_effective_start date,
  p_is_primary boolean,
  p_request_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_partner_clubs'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  RETURN plugin_data.csf_assign_partner_representative_locked_impl(
    p_organization_id,
    p_partner_club_term_id,
    p_display_name,
    p_email,
    p_role,
    p_effective_start,
    p_is_primary,
    p_request_id,
    p_actor_user_id
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_revoke_partner_representative(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_partner_club_term_id uuid,
  p_reason text,
  p_request_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_partner_clubs'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  RETURN plugin_data.csf_revoke_partner_representative_locked_impl(
    p_organization_id,
    p_assignment_id,
    p_partner_club_term_id,
    p_reason,
    p_request_id,
    p_actor_user_id
  );
END;
$$;

-- Keep the previous owner-only transaction body and add only the publication
-- fence. Publication discovers the exact tenant-scoped term, takes the same
-- advisory key as csf_close_term_v2, then locks and revalidates that exact term
-- after locking the activity. The request receipt remains inside this owner-
-- only implementation, preserving authorized idempotent replay.
CREATE OR REPLACE FUNCTION plugin_data.csf_set_activity_status_locked_impl(
  p_organization_id uuid,
  p_activity_id uuid,
  p_status text,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_lock_term_id uuid;
  v_request jsonb;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable activity request identifier is required.';
  END IF;
  IF p_status IS NULL
    OR p_status NOT IN ('published', 'closed', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Invalid activity status.';
  END IF;
  IF p_status = 'cancelled' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required.';
  END IF;

  IF p_status = 'published' THEN
    SELECT activity.term_id
    INTO v_lock_term_id
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.organization_id = p_organization_id
      AND activity.id = p_activity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF activity was not found in this organization.';
    END IF;
    IF v_lock_term_id IS NULL THEN
      RAISE EXCEPTION 'A semester and start date are required before publishing.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_organization_id::text || ':' || v_lock_term_id::text,
        0
      )
    );
  END IF;

  v_request := pg_catalog.jsonb_build_object(
    'activityId', p_activity_id,
    'status', p_status,
    'reason', v_reason
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_atomic_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );
  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.status_change'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR v_receipt.target_id IS DISTINCT FROM p_activity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', p_activity_id,
      'status', p_status,
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT activity.*
  INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id
    AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF activity was not found in this organization.';
  END IF;
  IF v_before.status = 'archived' THEN
    RAISE EXCEPTION 'Archived activities cannot be changed.';
  END IF;
  IF p_status = 'published' AND v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft activities can be published.';
  END IF;
  IF p_status IN ('closed', 'cancelled') AND v_before.status <> 'published' THEN
    RAISE EXCEPTION 'Only published activities can be closed or cancelled.';
  END IF;
  IF p_status = 'published'
    AND (v_before.term_id IS NULL OR v_before.starts_at IS NULL) THEN
    RAISE EXCEPTION 'A semester and start date are required before publishing.';
  END IF;

  IF p_status = 'published' THEN
    IF v_before.term_id IS DISTINCT FROM v_lock_term_id THEN
      RAISE EXCEPTION 'CSF activity semester changed; refresh and try again.';
    END IF;

    SELECT term.*
    INTO v_term
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_before.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_term.lifecycle_status <> 'open' THEN
      RAISE EXCEPTION 'Activities cannot be published in a closed or archived semester.';
    END IF;
  END IF;

  IF p_status = 'published'
    AND v_before.signup_mode = 'lets_assist_project'
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.organization_id = p_organization_id
        AND project.id = v_before.linked_project_id
    ) THEN
    RAISE EXCEPTION 'Linked project was not found in this organization.';
  END IF;

  UPDATE plugin_data.csf_opportunities
  SET status = p_status,
      published_at = CASE
        WHEN p_status = 'published' THEN coalesce(published_at, v_now)
        ELSE published_at
      END,
      closed_at = CASE
        WHEN p_status = 'closed' THEN v_now
        WHEN p_status = 'published' THEN NULL
        ELSE closed_at
      END,
      cancelled_at = CASE
        WHEN p_status = 'cancelled' THEN v_now
        ELSE cancelled_at
      END,
      cancellation_reason = CASE
        WHEN p_status = 'cancelled' THEN v_reason
        ELSE cancellation_reason
      END,
      archived_at = CASE
        WHEN p_status = 'archived' THEN v_now
        ELSE archived_at
      END,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_activity_id
  RETURNING *
  INTO v_after;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'activity.status_change',
    'csf_opportunities',
    p_activity_id,
    v_after.term_id,
    pg_catalog.jsonb_build_object('status', v_before.status),
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'status', v_after.status,
      'reason', v_reason
    ),
    p_request_id,
    CASE
      WHEN p_status = 'cancelled' THEN 'activity_cancelled'
      ELSE 'activity_status_changed'
    END
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', p_activity_id,
    'status', v_after.status,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_assign_partner_representative(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_revoke_partner_representative(
  uuid, uuid, uuid, text, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_assign_partner_representative(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
)
TO service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_revoke_partner_representative(
  uuid, uuid, uuid, text, uuid, uuid
)
TO service_role;

-- Reassert the implementation ACL after CREATE OR REPLACE. PostgreSQL retains
-- ACLs across replacement, but the explicit statement keeps the reviewed
-- service boundary local to this forward migration.
REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(
  uuid, uuid, text, text, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_assign_partner_representative(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
) IS
  'Server-only atomic partner representative assignment. Authorization is checked before input processing and rechecked after the organization staff-access lock and actor active-membership share lock.';

COMMENT ON FUNCTION plugin_data.csf_revoke_partner_representative(
  uuid, uuid, uuid, text, uuid, uuid
) IS
  'Server-only atomic partner representative revocation. Authorization is checked before input processing and rechecked after the organization staff-access lock and actor active-membership share lock.';

COMMENT ON FUNCTION plugin_data.csf_assign_partner_representative_locked_impl(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
) IS
  'Owner-only representative-assignment implementation retained behind csf_assign_partner_representative; direct client and service-role execution is revoked.';

COMMENT ON FUNCTION plugin_data.csf_revoke_partner_representative_locked_impl(
  uuid, uuid, uuid, text, uuid, uuid
) IS
  'Owner-only representative-revocation implementation retained behind csf_revoke_partner_representative; direct client and service-role execution is revoked.';

COMMENT ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(
  uuid, uuid, text, text, uuid, uuid
) IS
  'Owner-only activity-status implementation retained behind csf_set_activity_status. Publication takes the close-term advisory and row locks and revalidates the exact tenant-scoped open semester before writing.';

COMMIT;
