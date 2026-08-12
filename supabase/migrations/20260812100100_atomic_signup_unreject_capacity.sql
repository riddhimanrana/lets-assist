-- Re-approving a rejected signup consumes capacity just like a new approved
-- signup. Keep authorization, the rejected-only state transition, and the
-- slot-capacity decision in one transaction on the canonical slot lock.

CREATE OR REPLACE FUNCTION public.unreject_project_signup_with_capacity(
  p_signup_id uuid
)
RETURNS TABLE (
  outcome text,
  project_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_signup_snapshot record;
  v_signup record;
  v_project record;
  v_window record;
  v_active_count bigint := 0;
BEGIN
  outcome := 'refused';
  project_id := NULL;

  IF p_signup_id IS NULL OR v_actor_id IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Read only the lock coordinates first. The row is deliberately not locked
  -- yet: cancellation owns the project row before it freezes signup-backed
  -- deliveries, so holding a signup lock while waiting for the project would
  -- invert that order and could deadlock on the delivery foreign-key check.
  SELECT
    signups.id,
    signups.project_id,
    signups.schedule_id,
    signups.status
  INTO v_signup_snapshot
  FROM public.project_signups AS signups
  WHERE signups.id = p_signup_id;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Take the canonical slot lock before locking the project row. Existing
  -- capacity consumers use this order, so a queued project-status writer
  -- cannot turn a capacity race into an advisory-lock/row-lock deadlock.
  -- A blank schedule has no capacity key; it is reported only after the
  -- permission check below so unauthorized callers learn nothing about it.
  IF NULLIF(BTRIM(v_signup_snapshot.schedule_id), '') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'lets-assist-project-signup:'
          || v_signup_snapshot.project_id::text
          || ':'
          || v_signup_snapshot.schedule_id,
        0
      )
    );
  END IF;

  -- Lock the project before the signup. Cancellation takes this same project
  -- lock before it reads the audience, while every capacity consumer takes the
  -- advisory slot lock first. This common order prevents both overbooking and
  -- the cancellation/unreject project-signup lock inversion.
  SELECT
    projects.creator_id,
    projects.organization_id,
    projects.can_be_managed_by_staff,
    projects.status,
    projects.pause_signups
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = v_signup_snapshot.project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'refused';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Lock and refresh the exact signup only after the project lock. If its slot
  -- coordinates changed after the initial read, fail closed rather than using
  -- an advisory lock for stale capacity coordinates.
  SELECT
    signups.id,
    signups.project_id,
    signups.schedule_id,
    signups.status
  INTO v_signup
  FROM public.project_signups AS signups
  WHERE signups.id = p_signup_id
    AND signups.project_id = v_signup_snapshot.project_id
    AND signups.schedule_id IS NOT DISTINCT FROM v_signup_snapshot.schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'refused';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_project.creator_id IS DISTINCT FROM v_actor_id THEN
    PERFORM members.user_id
    FROM public.organization_members AS members
    WHERE members.organization_id = v_project.organization_id
      AND members.user_id = v_actor_id
      AND COALESCE(members.status, 'active') = 'active'
      AND (
        members.role = 'admin'
        OR (
          members.role = 'staff'
          AND v_project.can_be_managed_by_staff IS TRUE
        )
      )
    FOR SHARE OF members;

    IF NOT FOUND THEN
      outcome := 'refused';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Do not reveal the signup's project until the current database state has
  -- authorized the caller. The row locks above also keep project ownership and
  -- any matching membership from changing before this transaction finishes.
  project_id := v_signup.project_id;

  IF v_signup.status <> 'rejected' THEN
    outcome := 'invalid_state';
    RETURN NEXT;
    RETURN;
  END IF;

  IF NULLIF(BTRIM(v_signup.schedule_id), '') IS NULL THEN
    outcome := 'invalid_slot';
    RETURN NEXT;
    RETURN;
  END IF;

  IF COALESCE(v_project.pause_signups, false)
    OR v_project.status IN ('cancelled', 'completed')
  THEN
    outcome := 'project_closed';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT slot.capacity, slot.starts_at, slot.ends_at
  INTO v_window
  FROM private.resolve_project_schedule_slot(
    v_signup.project_id,
    v_signup.schedule_id
  ) AS slot;

  IF NOT FOUND THEN
    outcome := 'invalid_slot';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_active_count
  FROM public.project_signups AS signups
  WHERE signups.project_id = v_signup.project_id
    AND signups.schedule_id = v_signup.schedule_id
    AND signups.status IN ('approved', 'attended');

  IF v_active_count >= v_window.capacity THEN
    outcome := 'slot_full';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.project_signups AS signups
  SET status = 'approved'
  WHERE signups.id = p_signup_id
    AND signups.status = 'rejected';

  IF NOT FOUND THEN
    outcome := 'invalid_state';
    RETURN NEXT;
    RETURN;
  END IF;

  outcome := 'approved';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.unreject_project_signup_with_capacity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unreject_project_signup_with_capacity(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.unreject_project_signup_with_capacity(uuid) IS
  'Authenticated, permission-rechecked rejected-to-approved transition serialized with every signup-capacity consumer for the same project slot.';
