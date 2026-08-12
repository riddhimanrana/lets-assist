-- Make signup rejection one authenticated, tenant-bound transaction that owns
-- both the status transition and the intentional in-app notification.
--
-- The browser previously updated project_signups and then attempted a separate
-- notification. A notification failure therefore left a committed rejection,
-- and the compatibility notification action trusted caller-supplied recipient
-- and project identifiers. The public boundary now accepts only the signup ID;
-- every other coordinate and the acting user come from locked database state.

BEGIN;

CREATE OR REPLACE FUNCTION private.reject_project_signup(
  p_signup_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_signup_snapshot record;
  v_project record;
  v_signup record;
  v_project_updates_enabled boolean;
  v_notification text := 'skipped';
  v_notification_reason text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'authentication required';
  END IF;

  IF p_signup_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'a signup identifier is required';
  END IF;

  -- Read only lock coordinates. This snapshot authorizes nothing; the project
  -- and signup are both re-read under the canonical project-then-signup locks.
  SELECT
    signups.project_id,
    signups.organization_id
  INTO v_signup_snapshot
  FROM public.project_signups AS signups
  WHERE signups.id = p_signup_id;

  IF NOT FOUND OR v_signup_snapshot.project_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'signup not found';
  END IF;

  SELECT
    projects.id,
    projects.title,
    projects.creator_id,
    projects.organization_id,
    projects.can_be_managed_by_staff
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = v_signup_snapshot.project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'signup not found';
  END IF;

  SELECT
    signups.id,
    signups.project_id,
    signups.organization_id,
    signups.user_id,
    signups.status
  INTO v_signup
  FROM public.project_signups AS signups
  WHERE signups.id = p_signup_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'signup not found';
  END IF;

  -- The locked signup must still belong to the exact project and tenant whose
  -- row was locked first. A privileged concurrent repair that moved either
  -- coordinate cannot inherit authorization from stale lock coordinates.
  IF v_signup.project_id IS DISTINCT FROM v_project.id
    OR v_signup.organization_id IS DISTINCT FROM v_project.organization_id
    OR v_signup.organization_id IS DISTINCT FROM v_signup_snapshot.organization_id
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'signup changed projects during rejection';
  END IF;

  -- Project ownership is stable under the project lock. For organization
  -- managers, lock and re-read the exact membership after both domain rows are
  -- locked so deactivation or role changes serialize with this decision.
  IF v_project.creator_id IS DISTINCT FROM v_actor_id THEN
    PERFORM members.user_id
    FROM public.organization_members AS members
    WHERE members.organization_id = v_project.organization_id
      AND members.user_id = v_actor_id
      AND members.status = 'active'
      AND (
        members.role = 'admin'
        OR (
          members.role = 'staff'
          AND v_project.can_be_managed_by_staff IS TRUE
        )
      )
    FOR SHARE OF members;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'not authorized to reject this signup';
    END IF;
  END IF;

  -- The committed rejected state is the replay token. A later legitimate
  -- rejection after an unreject is a new transition and intentionally creates
  -- a new notification.
  IF v_signup.status = 'rejected' THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'replayed',
      'success', true,
      'signupId', v_signup.id,
      'projectId', v_signup.project_id,
      'notification', 'skipped',
      'notificationReason', 'already_rejected'
    );
  END IF;

  IF v_signup.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'only a pending or approved signup can be rejected';
  END IF;

  UPDATE public.project_signups AS signups
  SET status = 'rejected'
  WHERE signups.id = v_signup.id
    AND signups.status IN ('pending', 'approved');

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'signup changed while it was being rejected';
  END IF;

  IF v_signup.user_id IS NULL THEN
    v_notification_reason := 'anonymous_signup';
  ELSE
    SELECT settings.project_updates
    INTO v_project_updates_enabled
    FROM public.notification_settings AS settings
    WHERE settings.user_id = v_signup.user_id
    FOR SHARE OF settings;

    -- A missing settings row has opted out of nothing, matching the server
    -- notification service. Only an explicit false suppresses this event.
    IF FOUND AND v_project_updates_enabled IS FALSE THEN
      v_notification_reason := 'notification_preference_disabled';
    ELSE
      INSERT INTO public.notifications (
        user_id,
        title,
        body,
        type,
        severity,
        action_url,
        data,
        displayed,
        read
      ) VALUES (
        v_signup.user_id,
        'Project Status Update',
        pg_catalog.format(
          'Your signup to volunteer for "%s" has been rejected',
          v_project.title
        ),
        'project_updates',
        'warning',
        '/projects/' || v_project.id::text,
        pg_catalog.jsonb_build_object(
          'projectId', v_project.id,
          'signupId', v_signup.id
        ),
        false,
        false
      );
      v_notification := 'delivered';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'accepted',
    'success', true,
    'signupId', v_signup.id,
    'projectId', v_signup.project_id,
    'notification', v_notification,
    'notificationReason', v_notification_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION private.reject_project_signup(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.reject_project_signup(uuid)
  TO authenticated;

COMMENT ON FUNCTION private.reject_project_signup(uuid) IS
  'Private SECURITY DEFINER signup rejection transaction. Derives the actor and tenant from locked state, rechecks active management authority under lock, and atomically writes the rejection and intentional notification.';

CREATE OR REPLACE FUNCTION public.reject_project_signup(
  p_signup_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.reject_project_signup(p_signup_id);
$$;

REVOKE ALL ON FUNCTION public.reject_project_signup(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_project_signup(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.reject_project_signup(uuid) IS
  'Authenticated SECURITY INVOKER wrapper for the permission-rechecked private signup rejection transaction.';

-- No direct browser/Data API update may enter rejected: that transition owes
-- the volunteer a notification and therefore belongs only to the transaction
-- above. Every other existing client mutation rule remains unchanged.
CREATE OR REPLACE FUNCTION private.protect_project_signup_client_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_is_manager boolean := false;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  v_is_manager := COALESCE(
    public.is_project_organizer(OLD.project_id, v_actor_id),
    false
  ) OR COALESCE(public.is_super_admin(), false);

  IF NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.anonymous_id IS DISTINCT FROM OLD.anonymous_id
  THEN
    RAISE EXCEPTION 'project signup identity fields are immutable for client roles'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.check_in_time IS DISTINCT FROM OLD.check_in_time
    OR NEW.check_out_time IS DISTINCT FROM OLD.check_out_time
  THEN
    RAISE EXCEPTION 'attendance timestamps require a server-authorized operation'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.volunteer_comment IS DISTINCT FROM OLD.volunteer_comment
    OR NEW.response_data IS DISTINCT FROM OLD.response_data
  THEN
    RAISE EXCEPTION 'client signup updates are limited to status and calendar metadata'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'rejected' THEN
      RAISE EXCEPTION 'signup rejection requires the server-authorized operation'
        USING ERRCODE = '42501';
    END IF;

    IF NOT v_is_manager
      AND NOT (
        OLD.user_id IS NOT DISTINCT FROM v_actor_id
        AND OLD.status IN ('pending', 'approved')
        AND NEW.status = 'cancelled'
      )
    THEN
      RAISE EXCEPTION 'participants may only cancel their own signup'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT v_is_manager
    AND OLD.user_id IS DISTINCT FROM v_actor_id
  THEN
    RAISE EXCEPTION 'signup update access denied'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_project_signup_client_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.protect_project_signup_client_mutation()
  TO service_role;

COMMENT ON FUNCTION private.protect_project_signup_client_mutation() IS
  'Client-role signup update guard. Identity and attendance fields stay immutable, participants may only cancel their own signup, and rejected is reachable only through public.reject_project_signup.';

COMMIT;
