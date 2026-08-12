-- Make signup rejection one authenticated, tenant-authorized transaction that
-- also owns the volunteer's in-app notification.
--
-- Before this migration the browser wrote `status = 'rejected'` directly and
-- then asked the browser notification service to notify the volunteer, so the
-- state transition and the notification could succeed independently and a
-- failed notification was still reported as a successful rejection. Beside that
-- path, the `createRejectionNotification` Server Action accepted a caller
-- supplied user, project, and signup and delivered a service-role notification
-- from them, so forged arguments could address any recipient.
--
-- public.reject_project_signup is now the only way a client role can move a
-- signup into 'rejected'. It derives the actor from auth.uid(), locks the
-- project before the signup -- the same order
-- public.publish_volunteer_hours_transactional uses, so the two cannot deadlock
-- against each other -- re-authorizes the actor against the locked project,
-- performs the transition, and writes the notification in the same transaction.
--
-- Authorization is encoded here rather than delegated to
-- app_private.is_project_organizer. That helper matches on creator, admin, and
-- staff-with-flag, but it ignores organization_members.status and cannot take a
-- membership row lock. This function requires an active membership and locks it,
-- matching public.publish_volunteer_hours_transactional, so a membership being
-- revoked concurrently serializes against the rejection instead of racing it.
-- The narrowing is deliberate: an inactive member may still read the signup
-- through RLS, but may no longer reject it. `status` is compared for equality
-- rather than through COALESCE, so a membership whose status is unset fails
-- closed exactly as lib/projects/management-access.ts does.
--
-- private.protect_project_signup_client_mutation below applies the same active
-- membership rule to the moderation it still allows, so revoking a membership
-- also revokes approving, cancelling, and unrejecting somebody else's signup.

CREATE OR REPLACE FUNCTION private.project_signup_rejection_result(
  p_signup_id uuid,
  p_project_id uuid,
  p_outcome text,
  p_notification text,
  p_notification_reason text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'outcome', p_outcome,
    'success', true,
    'signupId', p_signup_id,
    'projectId', p_project_id,
    'notification', p_notification,
    'notificationReason', p_notification_reason
  );
$$;

REVOKE ALL ON FUNCTION private.project_signup_rejection_result(
  uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.project_signup_rejection_result(
  uuid, uuid, text, text, text
) TO service_role;

COMMENT ON FUNCTION private.project_signup_rejection_result(
  uuid, uuid, text, text, text
) IS
  'Bounded rejection outcome envelope. Returns no signup, project, or recipient data beyond the identifiers the caller already supplied.';

-- p_expected_user_id and p_expected_project_id exist only for the preserved
-- createRejectionNotification(userId, projectId, signupId) compatibility
-- signature. They are assertions, never inputs: nothing is derived from them,
-- and a mismatch aborts before any write.
CREATE OR REPLACE FUNCTION public.reject_project_signup(
  p_signup_id uuid,
  p_expected_user_id uuid DEFAULT NULL,
  p_expected_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_project public.projects%ROWTYPE;
  v_signup public.project_signups%ROWTYPE;
  v_project_id uuid;
  v_notification text := 'skipped';
  v_notification_reason text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  IF p_signup_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'a signup identifier is required';
  END IF;

  -- Resolve the tenant first so the project lock is taken before the signup
  -- lock. The signup itself is re-read under its own lock below.
  SELECT signups.project_id
  INTO v_project_id
  FROM public.project_signups AS signups
  WHERE signups.id = p_signup_id;

  IF NOT FOUND OR v_project_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'signup not found';
  END IF;

  SELECT projects.*
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = v_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'signup not found';
  END IF;

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
    FOR UPDATE OF members;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized to reject this signup';
    END IF;
  END IF;

  SELECT signups.*
  INTO v_signup
  FROM public.project_signups AS signups
  WHERE signups.id = p_signup_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'signup not found';
  END IF;

  -- Only the project locked above authorized this actor. A signup that moved
  -- while this transaction waited for its row lock is no longer covered by that
  -- authorization, so the caller must retry against the current tenant.
  IF v_signup.project_id IS DISTINCT FROM v_project.id THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signup changed projects during rejection';
  END IF;

  IF p_expected_project_id IS NOT NULL
    AND p_expected_project_id IS DISTINCT FROM v_signup.project_id
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signup does not match the supplied project';
  END IF;

  IF p_expected_user_id IS NOT NULL
    AND p_expected_user_id IS DISTINCT FROM v_signup.user_id
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signup does not match the supplied volunteer';
  END IF;

  -- The committed transition is the idempotency token. A retry therefore never
  -- writes a second notification, while a legitimate reject after an unreject
  -- is a new transition and does notify again.
  IF v_signup.status = 'rejected' THEN
    RETURN private.project_signup_rejection_result(
      v_signup.id,
      v_signup.project_id,
      'replayed',
      'skipped',
      'already_rejected'
    );
  END IF;

  IF v_signup.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'only a pending or approved signup can be rejected';
  END IF;

  UPDATE public.project_signups AS signups
  SET status = 'rejected'
  WHERE signups.id = v_signup.id;

  IF v_signup.user_id IS NULL THEN
    -- An anonymous signup has no in-app recipient. The rejection still commits.
    v_notification_reason := 'anonymous_signup';
  ELSIF EXISTS (
    SELECT 1
    FROM public.notification_settings AS settings
    WHERE settings.user_id = v_signup.user_id
      AND settings.project_updates IS FALSE
  ) THEN
    -- A missing settings row has opted out of nothing, matching
    -- services/notifications-server.ts.
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

  RETURN private.project_signup_rejection_result(
    v_signup.id,
    v_signup.project_id,
    'accepted',
    v_notification,
    v_notification_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_project_signup(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_project_signup(uuid, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_project_signup(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.reject_project_signup(uuid, uuid, uuid) IS
  'Authenticated, permission-rechecked, replay-safe signup rejection that commits the status transition and the volunteer notification together. The only client-reachable path into the rejected state.';

-- The reviewed client-callable public catalog now contains one more signature.
-- scripts/audit-supabase-architecture.sh and
-- supabase/tests/database/public_function_acl_allowlist.test.sql are updated in
-- the same change, so an unreviewed grant still fails the architecture gate.
REVOKE ALL ON FUNCTION public.can_insert_project(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_insert_project(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_keep_or_set_public_visibility(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_attendees(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_organizer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_trusted_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_volunteer_hours_transactional(
  uuid, text, jsonb, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_insert_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_insert_project(uuid, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_keep_or_set_public_visibility(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_attendees(uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_organizer(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trusted_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_volunteer_hours_transactional(
  uuid, text, jsonb, text
) TO authenticated;

-- The moderation predicate for the client mutation guard below. It is
-- app_private.can_manage_project plus the active membership requirement
-- public.reject_project_signup enforces, so a revoked membership loses the
-- moderation the guard still allows instead of keeping it through a direct Data
-- API update. SECURITY DEFINER because the guard runs as the client role and its
-- decision must not depend on that role's RLS view of projects or memberships;
-- `status` is compared for equality so an unset status fails closed.
CREATE OR REPLACE FUNCTION app_private.can_moderate_project_signup(
  p_project_id uuid,
  p_user uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_user IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.projects AS projects
      WHERE projects.id = p_project_id
        AND (
          projects.creator_id = p_user
          OR EXISTS (
            SELECT 1
            FROM public.organization_members AS members
            WHERE members.organization_id = projects.organization_id
              AND members.user_id = p_user
              AND members.status = 'active'
              AND (
                members.role = 'admin'
                OR (
                  members.role = 'staff'
                  AND projects.can_be_managed_by_staff IS TRUE
                )
              )
          )
        )
    ),
    false
  );
$$;

-- The guard runs as the invoking client role, so that role needs EXECUTE here.
-- anon is refused, exactly as it already is on public.is_project_organizer.
REVOKE ALL ON FUNCTION app_private.can_moderate_project_signup(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_moderate_project_signup(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.can_moderate_project_signup(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION app_private.can_moderate_project_signup(uuid, uuid) IS
  'Project-signup moderation predicate: the creator, an active organization admin, or active organization staff while the project allows staff management. Returns no project or membership data.';

-- Forward-replace the client mutation guard so no browser or Data API update can
-- enter the rejected state, including an otherwise authorized manager's, and so
-- the moderation it still allows requires an active membership rather than a
-- role name. Every other clause is unchanged: participants may still cancel
-- their own pending or approved signup, and managers keep the rest of their
-- status moderation, including unrejecting a signup back to approved.
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

  v_is_manager := app_private.can_moderate_project_signup(
    OLD.project_id,
    v_actor_id
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

  -- Browser-visible signup updates are intentionally narrow. Managers retain
  -- status moderation; participants may only cancel themselves. Calendar sync
  -- metadata remains writable for the participant's own integration flow.
  IF NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.volunteer_comment IS DISTINCT FROM OLD.volunteer_comment
    OR NEW.response_data IS DISTINCT FROM OLD.response_data
  THEN
    RAISE EXCEPTION 'client signup updates are limited to status and calendar metadata'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Rejection also owes the volunteer a notification, so it belongs to
    -- public.reject_project_signup and to nothing else.
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
  'Client-role signup update guard. Identity and attendance fields stay immutable, participants may only cancel their own signup, moderating somebody else''s signup requires an active management membership, and the rejected state is reachable only through public.reject_project_signup.';
