-- Close the final Production review races around irreversible plugin deletion
-- and service-role feedback writes.

-- The durable lease is the long-lived mutex across plugin hooks. Pair its
-- acquisition with an xact advisory lock so entitlement writes cannot pass
-- between the lease decision and the committed lease row becoming visible.
CREATE OR REPLACE FUNCTION public.acquire_plugin_control_plane_transition_lock(
  p_organization_id uuid,
  p_plugin_key text,
  p_lock_token uuid,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;

  IF p_ttl_seconds < 30 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'lock TTL must be between 30 and 3600 seconds'
      USING errcode = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('plugin-control-plane-entitlements', 0)
  );

  INSERT INTO private.plugin_control_plane_transition_locks (
    organization_id,
    plugin_key,
    lock_token,
    acquired_at,
    expires_at
  )
  VALUES (
    p_organization_id,
    p_plugin_key,
    p_lock_token,
    now(),
    now() + make_interval(secs => p_ttl_seconds)
  )
  ON CONFLICT (organization_id, plugin_key) DO UPDATE
  SET
    lock_token = excluded.lock_token,
    acquired_at = excluded.acquired_at,
    expires_at = excluded.expires_at
  WHERE private.plugin_control_plane_transition_locks.expires_at <= now();

  RETURN found;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_plugin_control_plane_transition_lock(uuid, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_plugin_control_plane_transition_lock(uuid, text, uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION app_private.block_entitlement_write_during_plugin_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_organization_id uuid := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.organization_id END;
  v_old_plugin_key text := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.plugin_key END;
  v_new_organization_id uuid := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.organization_id END;
  v_new_plugin_key text := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.plugin_key END;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('plugin-control-plane-entitlements', 0)
  );

  IF EXISTS (
    SELECT 1
    FROM private.plugin_control_plane_transition_locks AS locks
    WHERE (
        (locks.organization_id = v_old_organization_id
          AND locks.plugin_key = v_old_plugin_key)
        OR
        (locks.organization_id = v_new_organization_id
          AND locks.plugin_key = v_new_plugin_key)
      )
      AND locks.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'plugin entitlement transition is locked'
      USING errcode = '40001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.block_entitlement_write_during_plugin_transition()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.block_entitlement_write_during_plugin_transition()
  TO postgres;

DROP TRIGGER IF EXISTS block_entitlement_write_during_plugin_transition
  ON public.organization_plugin_entitlements;
CREATE TRIGGER block_entitlement_write_during_plugin_transition
BEFORE INSERT OR UPDATE OR DELETE ON public.organization_plugin_entitlements
FOR EACH ROW
EXECUTE FUNCTION app_private.block_entitlement_write_during_plugin_transition();

CREATE OR REPLACE FUNCTION public.submit_project_feedback_from_request(
  p_request_id uuid,
  p_rating smallint,
  p_comment text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.project_feedback_requests%ROWTYPE;
  v_feedback_id uuid;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;
  IF p_request_id IS NULL OR p_rating NOT BETWEEN 1 AND 5
     OR (p_comment IS NOT NULL AND char_length(p_comment) > 2000) THEN
    RAISE EXCEPTION 'invalid feedback request' USING errcode = '22023';
  END IF;

  SELECT requests.*
  INTO v_request
  FROM public.project_feedback_requests AS requests
  WHERE requests.id = p_request_id
  FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'feedback request is not eligible' USING errcode = '42501';
  END IF;

  PERFORM 1
  FROM public.projects AS projects
  WHERE projects.id = v_request.project_id
    AND projects.status = 'completed'
    AND projects.cancelled_at IS NULL
  FOR UPDATE;
  IF NOT found THEN
    RAISE EXCEPTION 'feedback request is not eligible' USING errcode = '42501';
  END IF;

  PERFORM 1
  FROM public.project_signups AS signups
  WHERE signups.id = v_request.signup_id
    AND signups.project_id = v_request.project_id
    AND signups.status = 'attended'
    AND signups.user_id IS NOT DISTINCT FROM v_request.user_id
    AND signups.anonymous_id IS NOT DISTINCT FROM v_request.anonymous_id
  FOR UPDATE;
  IF NOT found THEN
    RAISE EXCEPTION 'feedback request is not eligible' USING errcode = '42501';
  END IF;

  SELECT feedback.id
  INTO v_feedback_id
  FROM public.project_feedback AS feedback
  WHERE feedback.project_id = v_request.project_id
    AND feedback.user_id IS NOT DISTINCT FROM v_request.user_id
    AND feedback.anonymous_id IS NOT DISTINCT FROM v_request.anonymous_id
  FOR UPDATE;

  IF v_feedback_id IS NULL THEN
    INSERT INTO public.project_feedback (
      project_id,
      user_id,
      anonymous_id,
      signup_id,
      rating,
      comment,
      submitted_via,
      comment_moderation_status,
      comment_flag_reason
    )
    VALUES (
      v_request.project_id,
      v_request.user_id,
      v_request.anonymous_id,
      v_request.signup_id,
      p_rating,
      p_comment,
      'email_link',
      CASE WHEN p_comment IS NULL THEN 'not_applicable' ELSE 'pending' END,
      NULL
    )
    RETURNING id INTO v_feedback_id;
  ELSE
    UPDATE public.project_feedback
    SET
      rating = p_rating,
      comment = p_comment,
      signup_id = v_request.signup_id,
      submitted_via = 'email_link',
      comment_moderation_status = CASE
        WHEN p_comment IS NULL THEN 'not_applicable'
        ELSE 'pending'
      END,
      comment_flag_reason = NULL,
      updated_at = now()
    WHERE id = v_feedback_id;
  END IF;

  RETURN v_feedback_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_project_feedback_from_request(uuid, smallint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_project_feedback_from_request(uuid, smallint, text)
  TO service_role;
