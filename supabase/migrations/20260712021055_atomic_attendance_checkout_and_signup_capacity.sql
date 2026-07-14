-- Attendance completion and signup capacity are concurrency invariants. Keep
-- the schedule parser in a private schema, and expose only service-role RPCs.

CREATE OR REPLACE FUNCTION private.resolve_project_schedule_slot(
  p_project_id uuid,
  p_schedule_id text
)
RETURNS TABLE (
  capacity integer,
  starts_at timestamptz,
  ends_at timestamptz
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_project record;
  v_date text;
  v_start_time text;
  v_end_time text;
  v_capacity_text text;
  v_timezone text;
BEGIN
  IF p_project_id IS NULL OR NULLIF(BTRIM(p_schedule_id), '') IS NULL THEN
    RETURN;
  END IF;

  SELECT
    projects.event_type,
    projects.schedule,
    COALESCE(NULLIF(projects.project_timezone, ''), 'America/Los_Angeles') AS project_timezone
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_timezone := v_project.project_timezone;

  IF v_project.event_type = 'oneTime'
    AND p_schedule_id = 'oneTime'
    AND v_project.schedule ? 'oneTime'
  THEN
    v_date := NULLIF(v_project.schedule->'oneTime'->>'date', '');
    v_start_time := NULLIF(v_project.schedule->'oneTime'->>'startTime', '');
    v_end_time := NULLIF(v_project.schedule->'oneTime'->>'endTime', '');
    v_capacity_text := NULLIF(v_project.schedule->'oneTime'->>'volunteers', '');
  ELSIF v_project.event_type = 'multiDay'
    AND v_project.schedule ? 'multiDay'
    AND jsonb_typeof(v_project.schedule->'multiDay') = 'array'
  THEN
    SELECT
      day_item.value->>'date',
      slot_item.value->>'startTime',
      slot_item.value->>'endTime',
      slot_item.value->>'volunteers'
    INTO v_date, v_start_time, v_end_time, v_capacity_text
    FROM jsonb_array_elements(v_project.schedule->'multiDay')
      WITH ORDINALITY AS day_item(value, ordinal)
    CROSS JOIN LATERAL jsonb_array_elements(day_item.value->'slots')
      WITH ORDINALITY AS slot_item(value, ordinal)
    WHERE p_schedule_id = format(
      '%s-%s-%s',
      day_item.value->>'date',
      day_item.ordinal - 1,
      slot_item.ordinal - 1
    )
      OR p_schedule_id = format(
        '%s-%s',
        day_item.value->>'date',
        slot_item.ordinal - 1
      )
    ORDER BY day_item.ordinal, slot_item.ordinal
    LIMIT 1;
  ELSIF v_project.event_type = 'sameDayMultiArea'
    AND v_project.schedule ? 'sameDayMultiArea'
    AND jsonb_typeof(v_project.schedule->'sameDayMultiArea'->'roles') = 'array'
  THEN
    SELECT
      v_project.schedule->'sameDayMultiArea'->>'date',
      role_item.value->>'startTime',
      role_item.value->>'endTime',
      role_item.value->>'volunteers'
    INTO v_date, v_start_time, v_end_time, v_capacity_text
    FROM jsonb_array_elements(v_project.schedule->'sameDayMultiArea'->'roles')
      WITH ORDINALITY AS role_item(value, ordinal)
    WHERE role_item.value->>'name' = p_schedule_id
    ORDER BY role_item.ordinal
    LIMIT 1;
  END IF;

  IF v_date IS NULL
    OR v_start_time IS NULL
    OR v_end_time IS NULL
    OR v_capacity_text IS NULL
    OR v_capacity_text !~ '^\s*[0-9]+(?:\.[0-9]+)?\s*$'
  THEN
    RETURN;
  END IF;

  capacity := LEAST(FLOOR(v_capacity_text::numeric), 2147483647)::integer;
  IF capacity <= 0 THEN
    RETURN;
  END IF;

  starts_at := (v_date || ' ' || v_start_time)::timestamp without time zone
    AT TIME ZONE v_timezone;
  ends_at := (v_date || ' ' || v_end_time)::timestamp without time zone
    AT TIME ZONE v_timezone;

  -- A finish time at or before the start represents an overnight slot.
  IF ends_at <= starts_at THEN
    ends_at := ends_at + interval '1 day';
  END IF;

  RETURN NEXT;
EXCEPTION
  WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_project_schedule_slot(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.resolve_project_schedule_slot(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_participant_checkout(
  p_signup_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_anonymous_id uuid DEFAULT NULL
)
RETURNS TABLE (
  check_out_time timestamptz,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_signup record;
  v_window record;
  v_now timestamptz := clock_timestamp();
  v_checkout_time timestamptz;
BEGIN
  IF p_signup_id IS NULL
    OR ((p_user_id IS NULL) = (p_anonymous_id IS NULL))
  THEN
    check_out_time := NULL;
    outcome := 'invalid_input';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    signups.id,
    signups.project_id,
    signups.schedule_id,
    signups.user_id,
    signups.anonymous_id,
    signups.status,
    signups.check_in_time,
    signups.check_out_time
  INTO v_signup
  FROM public.project_signups AS signups
  WHERE signups.id = p_signup_id
  FOR UPDATE;

  IF NOT FOUND
    OR (p_user_id IS NOT NULL AND v_signup.user_id IS DISTINCT FROM p_user_id)
    OR (
      p_anonymous_id IS NOT NULL
      AND v_signup.anonymous_id IS DISTINCT FROM p_anonymous_id
    )
  THEN
    check_out_time := NULL;
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Idempotent replay returns the immutable first checkout rather than
  -- extending recorded hours.
  IF v_signup.check_out_time IS NOT NULL THEN
    check_out_time := v_signup.check_out_time;
    outcome := 'already_checked_out';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_signup.check_in_time IS NULL OR v_signup.status <> 'attended' THEN
    check_out_time := NULL;
    outcome := 'not_checked_in';
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
    check_out_time := NULL;
    outcome := 'invalid_schedule';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_now < v_window.starts_at THEN
    check_out_time := NULL;
    outcome := 'before_event_window';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Never let delayed requests or replay extend credit past the scheduled
  -- event end. A corrupt post-event check-in requires organizer correction.
  v_checkout_time := LEAST(v_now, v_window.ends_at);
  IF v_signup.check_in_time > v_checkout_time THEN
    check_out_time := NULL;
    outcome := 'invalid_check_in';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.project_signups AS signups
  SET check_out_time = v_checkout_time,
      status = 'attended'
  WHERE signups.id = v_signup.id
    AND signups.check_out_time IS NULL
  RETURNING signups.check_out_time INTO check_out_time;

  IF check_out_time IS NULL THEN
    -- Defensive fallback for a future trigger or competing writer. The row is
    -- locked above, so normal retries take the already_checked_out branch.
    SELECT signups.check_out_time
    INTO check_out_time
    FROM public.project_signups AS signups
    WHERE signups.id = v_signup.id;
    outcome := 'already_checked_out';
  ELSE
    outcome := 'completed';
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_participant_checkout(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_participant_checkout(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.insert_project_signup_with_capacity(
  p_project_id uuid,
  p_schedule_id text,
  p_user_id uuid,
  p_anonymous_id uuid,
  p_status text,
  p_volunteer_comment text DEFAULT NULL,
  p_response_data jsonb DEFAULT NULL
)
RETURNS TABLE (
  signup_id uuid,
  outcome text,
  slot_capacity integer,
  active_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project record;
  v_window record;
  v_existing_status text;
BEGIN
  signup_id := NULL;
  slot_capacity := NULL;
  active_count := 0;

  IF p_project_id IS NULL
    OR NULLIF(BTRIM(p_schedule_id), '') IS NULL
    OR ((p_user_id IS NULL) = (p_anonymous_id IS NULL))
    OR p_status NOT IN ('approved', 'pending')
  THEN
    outcome := 'invalid_input';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Confirmation takes the anonymous profile lock before any slot lock. Use
  -- the same ordering here so a concurrent insert cannot appear between a
  -- confirmation's capacity checks and its pending-to-approved update.
  IF p_anonymous_id IS NOT NULL THEN
    PERFORM 1
    FROM public.anonymous_signups AS anonymous
    WHERE anonymous.id = p_anonymous_id
    FOR UPDATE;

    IF NOT FOUND THEN
      outcome := 'identity_not_found';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Every capacity-aware insert for a slot uses the same transaction lock.
  -- The lock is released automatically on commit or rollback, including when
  -- later waiver persistence deletes this newly-created signup.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'lets-assist-project-signup:' || p_project_id::text || ':' || p_schedule_id,
      0
    )
  );

  SELECT projects.status, projects.pause_signups
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = p_project_id
  FOR SHARE;

  IF NOT FOUND THEN
    outcome := 'project_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_project.pause_signups
    OR v_project.status IN ('cancelled', 'completed')
  THEN
    outcome := 'project_closed';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT slot.capacity, slot.starts_at, slot.ends_at
  INTO v_window
  FROM private.resolve_project_schedule_slot(p_project_id, p_schedule_id) AS slot;

  IF NOT FOUND THEN
    outcome := 'invalid_slot';
    RETURN NEXT;
    RETURN;
  END IF;
  slot_capacity := v_window.capacity;

  SELECT signups.status
  INTO v_existing_status
  FROM public.project_signups AS signups
  WHERE signups.project_id = p_project_id
    AND signups.schedule_id = p_schedule_id
    AND signups.status <> 'cancelled'
    AND (
      (p_user_id IS NOT NULL AND signups.user_id = p_user_id)
      OR (
        p_anonymous_id IS NOT NULL
        AND signups.anonymous_id = p_anonymous_id
      )
    )
  ORDER BY signups.created_at DESC NULLS LAST, signups.id
  LIMIT 1;

  IF FOUND THEN
    outcome := CASE
      WHEN v_existing_status = 'rejected' THEN 'rejected'
      ELSE 'already_exists'
    END;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO active_count
  FROM public.project_signups AS signups
  WHERE signups.project_id = p_project_id
    AND signups.schedule_id = p_schedule_id
    AND signups.status IN ('approved', 'attended');

  -- Pending email confirmations do not consume a slot yet, matching the
  -- existing product rule. Their later promotion uses the same lock below.
  IF active_count >= slot_capacity THEN
    outcome := 'slot_full';
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.project_signups (
    project_id,
    schedule_id,
    user_id,
    anonymous_id,
    status,
    volunteer_comment,
    response_data
  )
  VALUES (
    p_project_id,
    p_schedule_id,
    p_user_id,
    p_anonymous_id,
    p_status,
    p_volunteer_comment,
    p_response_data
  )
  RETURNING project_signups.id INTO signup_id;

  outcome := 'inserted';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_project_signup_with_capacity(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_project_signup_with_capacity(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_anonymous_signup_with_capacity(
  p_anonymous_id uuid
)
RETURNS TABLE (
  outcome text,
  approved_count integer,
  blocked_project_id uuid,
  blocked_schedule_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_anonymous record;
  v_slot record;
  v_project record;
  v_window record;
  v_active_count bigint;
  v_was_confirmed boolean;
BEGIN
  outcome := NULL;
  approved_count := 0;
  blocked_project_id := NULL;
  blocked_schedule_id := NULL;

  IF p_anonymous_id IS NULL THEN
    outcome := 'invalid_input';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT signups.id, signups.confirmed_at
  INTO v_anonymous
  FROM public.anonymous_signups AS signups
  WHERE signups.id = p_anonymous_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  v_was_confirmed := v_anonymous.confirmed_at IS NOT NULL;

  -- Lock every affected slot in a deterministic order before changing any
  -- row. The confirmation is all-or-nothing across a multi-slot signup.
  FOR v_slot IN
    SELECT
      signups.project_id,
      signups.schedule_id,
      COUNT(*)::integer AS pending_count
    FROM public.project_signups AS signups
    WHERE signups.anonymous_id = p_anonymous_id
      AND signups.status = 'pending'
    GROUP BY signups.project_id, signups.schedule_id
    ORDER BY signups.project_id, signups.schedule_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'lets-assist-project-signup:'
          || v_slot.project_id::text
          || ':'
          || v_slot.schedule_id,
        0
      )
    );

    SELECT projects.status, projects.pause_signups
    INTO v_project
    FROM public.projects AS projects
    WHERE projects.id = v_slot.project_id
    FOR SHARE;

    IF NOT FOUND
      OR v_project.pause_signups
      OR v_project.status IN ('cancelled', 'completed')
    THEN
      outcome := 'project_closed';
      blocked_project_id := v_slot.project_id;
      blocked_schedule_id := v_slot.schedule_id;
      RETURN NEXT;
      RETURN;
    END IF;

    SELECT slot.capacity, slot.starts_at, slot.ends_at
    INTO v_window
    FROM private.resolve_project_schedule_slot(
      v_slot.project_id,
      v_slot.schedule_id
    ) AS slot;

    IF NOT FOUND THEN
      outcome := 'invalid_slot';
      blocked_project_id := v_slot.project_id;
      blocked_schedule_id := v_slot.schedule_id;
      RETURN NEXT;
      RETURN;
    END IF;

    SELECT COUNT(*)
    INTO v_active_count
    FROM public.project_signups AS signups
    WHERE signups.project_id = v_slot.project_id
      AND signups.schedule_id = v_slot.schedule_id
      AND signups.status IN ('approved', 'attended');

    IF v_active_count + v_slot.pending_count > v_window.capacity THEN
      outcome := 'slot_full';
      blocked_project_id := v_slot.project_id;
      blocked_schedule_id := v_slot.schedule_id;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;

  UPDATE public.anonymous_signups AS signups
  SET confirmed_at = clock_timestamp()
  WHERE signups.id = p_anonymous_id
    AND signups.confirmed_at IS NULL;

  WITH approved AS (
    UPDATE public.project_signups AS signups
    SET status = 'approved'
    WHERE signups.anonymous_id = p_anonymous_id
      AND signups.status = 'pending'
    RETURNING signups.id
  )
  SELECT COUNT(*)::integer INTO approved_count FROM approved;

  outcome := CASE
    WHEN v_was_confirmed AND approved_count = 0 THEN 'already_confirmed'
    ELSE 'confirmed'
  END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_anonymous_signup_with_capacity(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_anonymous_signup_with_capacity(uuid)
  TO service_role;

-- All application signup inserts now pass through the service-only capacity
-- function. RLS remains in place for reads, updates, and cancellation.
DROP POLICY IF EXISTS project_signups_insert_authenticated
  ON public.project_signups;
REVOKE INSERT ON TABLE public.project_signups FROM anon, authenticated;

CREATE OR REPLACE FUNCTION private.protect_participant_checkout_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role')
    AND NEW.check_out_time IS DISTINCT FROM OLD.check_out_time
  THEN
    RAISE EXCEPTION 'participant checkout requires the server-authorized operation'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_participant_checkout_time
  ON public.project_signups;
CREATE TRIGGER protect_participant_checkout_time
BEFORE UPDATE OF check_out_time ON public.project_signups
FOR EACH ROW
EXECUTE FUNCTION private.protect_participant_checkout_time();

REVOKE ALL ON FUNCTION private.protect_participant_checkout_time()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.protect_participant_checkout_time()
  TO service_role;

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

DROP TRIGGER IF EXISTS protect_project_signup_client_mutation
  ON public.project_signups;
CREATE TRIGGER protect_project_signup_client_mutation
BEFORE UPDATE ON public.project_signups
FOR EACH ROW
EXECUTE FUNCTION private.protect_project_signup_client_mutation();

REVOKE ALL ON FUNCTION private.protect_project_signup_client_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.protect_project_signup_client_mutation()
  TO service_role;

DROP POLICY IF EXISTS project_signups_delete_authenticated
  ON public.project_signups;
REVOKE DELETE ON TABLE public.project_signups FROM anon, authenticated;
