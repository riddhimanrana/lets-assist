-- Officer-managed semester deadlines are server-only operations. Each write
-- validates tenant ownership and active staff assignment, then records the
-- corresponding immutable audit event in the same transaction.

CREATE OR REPLACE FUNCTION plugin_data.csf_upsert_term_deadline(
  p_organization_id uuid,
  p_deadline_id uuid,
  p_term_id uuid,
  p_deadline jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_term_deadlines%ROWTYPE;
  v_after plugin_data.csf_term_deadlines%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_deadline_type text := nullif(btrim(p_deadline->>'deadlineType'), '');
  v_title text := nullif(btrim(p_deadline->>'title'), '');
  v_description text := nullif(btrim(p_deadline->>'description'), '');
  v_due_at timestamptz;
  v_audience text := coalesce(nullif(btrim(p_deadline->>'audience'), ''), 'officers');
  v_owner_user_id uuid := nullif(p_deadline->>'ownerUserId', '')::uuid;
  v_related_route text;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_action text;
BEGIN
  IF jsonb_typeof(p_deadline) <> 'object' THEN
    RAISE EXCEPTION 'Deadline payload must be an object.';
  END IF;
  IF v_deadline_type NOT IN (
    'application_open', 'application_close', 'dues', 'meeting',
    'points', 'semester_close', 'other'
  ) THEN
    RAISE EXCEPTION 'Choose a supported deadline type.';
  END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Deadline title is required.'; END IF;
  IF nullif(p_deadline->>'dueAt', '') IS NULL THEN RAISE EXCEPTION 'Deadline date is required.'; END IF;
  BEGIN
    v_due_at := (p_deadline->>'dueAt')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Deadline date is invalid.';
  END;
  IF v_audience NOT IN ('officers', 'members', 'applicants', 'all') THEN
    RAISE EXCEPTION 'Choose a supported deadline audience.';
  END IF;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester not found.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Deadlines cannot be changed after a semester is closed.';
  END IF;

  IF v_owner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_staff_positions AS position
    WHERE position.organization_id = p_organization_id
      AND position.user_id = v_owner_user_id
      AND position.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Deadline owner must be an active CSF staff member.';
  END IF;

  v_related_route := CASE v_deadline_type
    WHEN 'application_open' THEN 'applications'
    WHEN 'application_close' THEN 'applications'
    WHEN 'dues' THEN 'applications'
    WHEN 'meeting' THEN 'meetings'
    WHEN 'points' THEN 'points'
    ELSE 'cohorts'
  END;

  IF p_deadline_id IS NULL THEN
    INSERT INTO plugin_data.csf_term_deadlines (
      organization_id, term_id, deadline_type, title, description, due_at,
      status, audience, related_route, owner_user_id, source, source_ref,
      created_at, updated_at
    ) VALUES (
      p_organization_id, p_term_id,
      v_deadline_type::plugin_data.csf_term_deadline_type,
      v_title, v_description, v_due_at, 'planned',
      v_audience, v_related_route, v_owner_user_id, 'manual', '{}'::jsonb,
      v_now, v_now
    ) RETURNING * INTO v_after;
    v_action := 'term_deadline.create';
  ELSE
    SELECT deadline.* INTO v_before
    FROM plugin_data.csf_term_deadlines AS deadline
    WHERE deadline.organization_id = p_organization_id
      AND deadline.id = p_deadline_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CSF deadline not found.'; END IF;
    IF v_before.term_id <> p_term_id THEN
      RAISE EXCEPTION 'A deadline cannot be moved to another semester.';
    END IF;
    IF v_before.status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Reopen this deadline before editing it.';
    END IF;

    UPDATE plugin_data.csf_term_deadlines
    SET deadline_type = v_deadline_type::plugin_data.csf_term_deadline_type,
        title = v_title,
        description = v_description,
        due_at = v_due_at,
        audience = v_audience,
        related_route = v_related_route,
        owner_user_id = v_owner_user_id,
        updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = p_deadline_id
    RETURNING * INTO v_after;
    v_action := 'term_deadline.update';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_action,
    'csf_term_deadlines', v_after.id, v_after.term_id,
    CASE WHEN p_deadline_id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    to_jsonb(v_after), v_correlation_id, 'manual', v_after.id::text,
    CASE WHEN p_deadline_id IS NULL THEN 'deadline_created' ELSE 'deadline_updated' END
  );

  RETURN jsonb_build_object(
    'deadlineId', v_after.id,
    'status', v_after.status,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_term_deadline_status(
  p_organization_id uuid,
  p_deadline_id uuid,
  p_status text,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_term_deadlines%ROWTYPE;
  v_after plugin_data.csf_term_deadlines%ROWTYPE;
  v_reason text := nullif(btrim(p_reason), '');
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  IF p_status NOT IN ('planned', 'open', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Choose a supported deadline status.';
  END IF;

  SELECT deadline.* INTO v_before
  FROM plugin_data.csf_term_deadlines AS deadline
  JOIN plugin_data.csf_terms AS term
    ON term.id = deadline.term_id
   AND term.organization_id = deadline.organization_id
  WHERE deadline.organization_id = p_organization_id
    AND deadline.id = p_deadline_id
    AND term.lifecycle_status NOT IN ('closed', 'archived')
  FOR UPDATE OF deadline;
  IF NOT FOUND THEN RAISE EXCEPTION 'Open-semester CSF deadline not found.'; END IF;
  IF v_before.status::text = p_status THEN RAISE EXCEPTION 'Deadline already has that status.'; END IF;

  IF NOT (
    (v_before.status = 'planned' AND p_status IN ('open', 'cancelled'))
    OR (v_before.status = 'open' AND p_status IN ('planned', 'completed', 'cancelled'))
    OR (v_before.status = 'completed' AND p_status = 'open')
    OR (v_before.status = 'cancelled' AND p_status = 'planned')
  ) THEN
    RAISE EXCEPTION 'That deadline status change is not allowed.';
  END IF;
  IF (p_status = 'cancelled' OR v_before.status IN ('completed', 'cancelled') OR (v_before.status = 'open' AND p_status = 'planned'))
    AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this status change.';
  END IF;

  UPDATE plugin_data.csf_term_deadlines
  SET status = p_status::plugin_data.csf_term_deadline_status,
      completed_by = CASE WHEN p_status = 'completed' THEN p_actor_user_id ELSE NULL END,
      completed_at = CASE WHEN p_status = 'completed' THEN v_now ELSE NULL END,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_deadline_id
  RETURNING * INTO v_after;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'term_deadline.status_change',
    'csf_term_deadlines', v_after.id, v_after.term_id,
    jsonb_build_object('status', v_before.status, 'completedAt', v_before.completed_at),
    jsonb_build_object('status', v_after.status, 'completedAt', v_after.completed_at, 'reason', v_reason),
    v_correlation_id, 'manual', v_after.id::text,
    CASE p_status
      WHEN 'completed' THEN 'deadline_completed'
      WHEN 'cancelled' THEN 'deadline_cancelled'
      WHEN 'open' THEN 'deadline_opened'
      ELSE 'deadline_planned'
    END
  );

  RETURN jsonb_build_object(
    'deadlineId', v_after.id,
    'status', v_after.status,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_term_deadline(uuid, uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_term_deadline(uuid, uuid, uuid, jsonb, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_set_term_deadline_status(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_term_deadline_status(uuid, uuid, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_upsert_term_deadline(uuid, uuid, uuid, jsonb, uuid)
  IS 'Creates or updates one tenant-scoped open-semester deadline with active-staff ownership and immutable same-transaction audit history.';
COMMENT ON FUNCTION plugin_data.csf_set_term_deadline_status(uuid, uuid, text, text, uuid)
  IS 'Moves one tenant-scoped deadline through explicit lifecycle transitions and records immutable same-transaction audit history.';
