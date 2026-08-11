-- Serialize creation of the one app-owned personal Google Calendar per user.
--
-- Google assigns calendar identifiers and does not provide an idempotency key
-- for calendar creation. A durable claim therefore has to be recorded before
-- the provider call. Ambiguous outcomes remain blocked for manual review;
-- neither a framework retry nor a later event reconciliation may create a
-- second calendar.

BEGIN;

CREATE TABLE plugin_data.csf_personal_calendar_destinations (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.user_calendar_connections(id) ON DELETE SET NULL,
  state text NOT NULL
    CHECK (state IN ('provisioning', 'ready', 'unknown_outcome', 'rejected')),
  calendar_id text
    CHECK (calendar_id IS NULL OR length(calendar_id) BETWEEN 1 AND 1024),
  inflight_operation_id uuid,
  last_outcome_code text
    CHECK (last_outcome_code IS NULL OR (
      length(last_outcome_code) BETWEEN 1 AND 80
      AND last_outcome_code ~ '^[a-z0-9_:-]+$'
    )),
  provision_started_at timestamptz,
  provider_confirmed_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_personal_calendar_destination_state_check CHECK (
    (state = 'ready' AND calendar_id IS NOT NULL AND inflight_operation_id IS NULL)
    OR (state = 'provisioning' AND calendar_id IS NULL AND inflight_operation_id IS NOT NULL)
    OR (state IN ('unknown_outcome', 'rejected') AND calendar_id IS NULL AND inflight_operation_id IS NULL)
  )
);

CREATE TABLE plugin_data.csf_personal_calendar_destination_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.user_calendar_connections(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  replace_calendar_id text
    CHECK (replace_calendar_id IS NULL OR length(replace_calendar_id) BETWEEN 1 AND 1024),
  state text NOT NULL DEFAULT 'started'
    CHECK (state IN ('started', 'confirmed', 'unknown_outcome', 'rejected')),
  provider_calendar_id text
    CHECK (provider_calendar_id IS NULL OR length(provider_calendar_id) BETWEEN 1 AND 1024),
  outcome_code text
    CHECK (outcome_code IS NULL OR (
      length(outcome_code) BETWEEN 1 AND 80
      AND outcome_code ~ '^[a-z0-9_:-]+$'
    )),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, request_id),
  CONSTRAINT csf_personal_calendar_destination_operation_completion_check CHECK (
    (state = 'started' AND completed_at IS NULL)
    OR (state <> 'started' AND completed_at IS NOT NULL)
  )
);

ALTER TABLE plugin_data.csf_personal_calendar_destinations
  ADD CONSTRAINT csf_personal_calendar_destinations_inflight_fkey
  FOREIGN KEY (inflight_operation_id)
  REFERENCES plugin_data.csf_personal_calendar_destination_operations(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX csf_personal_calendar_destination_operations_user_started_idx
  ON plugin_data.csf_personal_calendar_destination_operations (user_id, started_at DESC);

ALTER TABLE plugin_data.csf_personal_calendar_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_personal_calendar_destinations FORCE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_personal_calendar_destination_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_personal_calendar_destination_operations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE plugin_data.csf_personal_calendar_destinations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE plugin_data.csf_personal_calendar_destination_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_personal_calendar_destinations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_personal_calendar_destination_operations TO service_role;

COMMENT ON TABLE plugin_data.csf_personal_calendar_destinations IS
  'Server-only durable claim for the one app-created personal Google Calendar per user. Unknown provisioning outcomes block all replacement attempts until manual review.';
COMMENT ON TABLE plugin_data.csf_personal_calendar_destination_operations IS
  'Idempotent receipts for provider calendar creation. A receipt is reserved before any Google calendar create call.';

-- Backfill only from server-owned event bindings. The legacy connection
-- preferences JSON is user-editable and is never accepted as destination
-- authority on its own.
WITH canonical_binding AS (
  SELECT
    binding.user_id,
    min(binding.provider_calendar_id) AS calendar_id
  FROM plugin_data.csf_personal_calendar_bindings AS binding
  WHERE binding.provider_calendar_id IS NOT NULL
  GROUP BY binding.user_id
  HAVING count(DISTINCT binding.provider_calendar_id) = 1
), personal_connection AS (
  SELECT oauth_binding.user_id, oauth_binding.connection_id
  FROM public.user_google_oauth_connection_bindings AS oauth_binding
  WHERE oauth_binding.provider = 'google'
    AND oauth_binding.purpose = 'personal_calendar'
    AND oauth_binding.organization_id IS NULL
    AND oauth_binding.plugin_key IS NULL
)
INSERT INTO plugin_data.csf_personal_calendar_destinations (
  user_id,
  connection_id,
  state,
  calendar_id,
  provider_confirmed_at,
  created_at,
  updated_at
)
SELECT
  canonical_binding.user_id,
  personal_connection.connection_id,
  'ready',
  canonical_binding.calendar_id,
  now(),
  now(),
  now()
FROM canonical_binding
LEFT JOIN personal_connection USING (user_id)
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_personal_calendar_destination_provision(
  p_user_id uuid,
  p_connection_id uuid,
  p_request_id uuid,
  p_replace_calendar_id text DEFAULT NULL,
  p_allow_create boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_destination plugin_data.csf_personal_calendar_destinations%ROWTYPE;
  v_existing_operation plugin_data.csf_personal_calendar_destination_operations%ROWTYPE;
  v_operation_id uuid := gen_random_uuid();
BEGIN
  IF p_user_id IS NULL OR p_connection_id IS NULL OR p_request_id IS NULL
    OR p_allow_create IS NULL THEN
    RAISE EXCEPTION 'A complete personal calendar destination claim is required.';
  END IF;
  IF p_replace_calendar_id IS NOT NULL
    AND length(p_replace_calendar_id) NOT BETWEEN 1 AND 1024 THEN
    RAISE EXCEPTION 'That personal calendar replacement identity is invalid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_calendar_connections AS connection
    JOIN public.user_google_oauth_connection_bindings AS binding
      ON binding.connection_id = connection.id
     AND binding.user_id = connection.user_id
     AND binding.provider = connection.provider
    WHERE connection.id = p_connection_id
      AND connection.user_id = p_user_id
      AND connection.provider = 'google'
      AND connection.is_active
      AND binding.purpose = 'personal_calendar'
      AND binding.organization_id IS NULL
      AND binding.plugin_key IS NULL
  ) THEN
    RAISE EXCEPTION 'That personal Google Calendar connection is not available to this account.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_personal_calendar_destination:' || p_user_id::text,
      0
    )
  );

  SELECT operation.*
  INTO v_existing_operation
  FROM plugin_data.csf_personal_calendar_destination_operations AS operation
  WHERE operation.user_id = p_user_id
    AND operation.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing_operation.connection_id IS DISTINCT FROM p_connection_id
      OR v_existing_operation.replace_calendar_id IS DISTINCT FROM p_replace_calendar_id THEN
      RAISE EXCEPTION 'That personal calendar destination request identifier is already bound to another attempt.';
    END IF;

    SELECT destination.*
    INTO STRICT v_destination
    FROM plugin_data.csf_personal_calendar_destinations AS destination
    WHERE destination.user_id = p_user_id
    FOR UPDATE;

    -- The provider call runs after the claim transaction commits. If its
    -- process disappears, an exact replay must eventually settle to an
    -- ambiguous outcome too; otherwise a client faithfully replaying its
    -- stable request id would leave the destination in provisioning forever.
    IF v_existing_operation.state = 'started'
      AND v_existing_operation.started_at <= now() - interval '5 minutes' THEN
      UPDATE plugin_data.csf_personal_calendar_destination_operations
      SET state = 'unknown_outcome',
          outcome_code = 'process_interrupted',
          completed_at = now()
      WHERE id = v_existing_operation.id
        AND state = 'started'
      RETURNING * INTO v_existing_operation;

      UPDATE plugin_data.csf_personal_calendar_destinations
      SET state = 'unknown_outcome',
          inflight_operation_id = NULL,
          last_outcome_code = 'process_interrupted',
          updated_at = now()
      WHERE user_id = p_user_id
        AND inflight_operation_id = v_existing_operation.id
      RETURNING * INTO v_destination;
    END IF;

    RETURN jsonb_build_object(
      'operationId', v_existing_operation.id,
      'operationState', v_existing_operation.state,
      'destinationState', v_destination.state,
      'calendarId', coalesce(v_existing_operation.provider_calendar_id, v_destination.calendar_id),
      'outcomeCode', v_existing_operation.outcome_code,
      'shouldCallProvider', false,
      'idempotent', true
    );
  END IF;

  SELECT destination.*
  INTO v_destination
  FROM plugin_data.csf_personal_calendar_destinations AS destination
  WHERE destination.user_id = p_user_id
  FOR UPDATE;

  IF FOUND AND v_destination.state = 'provisioning' THEN
    IF v_destination.inflight_operation_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_personal_calendar_destination_operations AS inflight
      WHERE inflight.id = v_destination.inflight_operation_id
        AND inflight.state = 'started'
        AND inflight.started_at <= now() - interval '5 minutes'
    ) THEN
      UPDATE plugin_data.csf_personal_calendar_destination_operations
      SET state = 'unknown_outcome',
          outcome_code = 'process_interrupted',
          completed_at = now()
      WHERE id = v_destination.inflight_operation_id
        AND state = 'started';

      UPDATE plugin_data.csf_personal_calendar_destinations
      SET state = 'unknown_outcome',
          inflight_operation_id = NULL,
          last_outcome_code = 'process_interrupted',
          updated_at = now()
      WHERE user_id = p_user_id
      RETURNING * INTO v_destination;
    ELSE
      RETURN jsonb_build_object(
        'operationId', v_destination.inflight_operation_id,
        'operationState', 'started',
        'destinationState', 'provisioning',
        'calendarId', NULL,
        'outcomeCode', NULL,
        'shouldCallProvider', false,
        'idempotent', false
      );
    END IF;
  END IF;

  IF FOUND AND v_destination.state = 'unknown_outcome' THEN
    RETURN jsonb_build_object(
      'operationId', NULL,
      'operationState', 'unknown_outcome',
      'destinationState', 'unknown_outcome',
      'calendarId', NULL,
      'outcomeCode', v_destination.last_outcome_code,
      'shouldCallProvider', false,
      'idempotent', false
    );
  END IF;

  IF FOUND AND v_destination.state = 'ready' THEN
    IF p_replace_calendar_id IS NULL THEN
      RETURN jsonb_build_object(
        'operationId', NULL,
        'operationState', 'confirmed',
        'destinationState', 'ready',
        'calendarId', v_destination.calendar_id,
        'outcomeCode', NULL,
        'shouldCallProvider', false,
        'idempotent', false
      );
    END IF;
    IF v_destination.calendar_id IS DISTINCT FROM p_replace_calendar_id THEN
      RAISE EXCEPTION 'The personal calendar replacement no longer matches the confirmed destination.';
    END IF;
  ELSIF p_replace_calendar_id IS NOT NULL THEN
    RAISE EXCEPTION 'No confirmed personal calendar destination exists for replacement.';
  END IF;

  -- Status checks and removals must be able to settle a stale provisioning
  -- claim without ever gaining authority to create a calendar. Enforce that
  -- at the serialized database boundary rather than relying on a caller flag
  -- after the claim has been returned.
  IF NOT p_allow_create THEN
    RETURN jsonb_build_object(
      'operationId', NULL,
      'operationState', 'rejected',
      'destinationState', 'missing',
      'calendarId', NULL,
      'outcomeCode', 'destination_missing',
      'shouldCallProvider', false,
      'idempotent', false
    );
  END IF;

  INSERT INTO plugin_data.csf_personal_calendar_destination_operations (
    id,
    user_id,
    connection_id,
    request_id,
    replace_calendar_id,
    state
  ) VALUES (
    v_operation_id,
    p_user_id,
    p_connection_id,
    p_request_id,
    p_replace_calendar_id,
    'started'
  );

  INSERT INTO plugin_data.csf_personal_calendar_destinations (
    user_id,
    connection_id,
    state,
    calendar_id,
    inflight_operation_id,
    last_outcome_code,
    provision_started_at,
    provider_confirmed_at,
    reviewed_at,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    p_connection_id,
    'provisioning',
    NULL,
    v_operation_id,
    NULL,
    now(),
    NULL,
    CASE WHEN v_destination.state IN ('unknown_outcome', 'rejected') THEN now() ELSE NULL END,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET connection_id = EXCLUDED.connection_id,
      state = EXCLUDED.state,
      calendar_id = NULL,
      inflight_operation_id = EXCLUDED.inflight_operation_id,
      last_outcome_code = NULL,
      provision_started_at = EXCLUDED.provision_started_at,
      provider_confirmed_at = NULL,
      reviewed_at = EXCLUDED.reviewed_at,
      updated_at = now()
  RETURNING * INTO v_destination;

  RETURN jsonb_build_object(
    'operationId', v_operation_id,
    'operationState', 'started',
    'destinationState', v_destination.state,
    'calendarId', NULL,
    'outcomeCode', NULL,
    'shouldCallProvider', true,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_complete_personal_calendar_destination_provision(
  p_operation_id uuid,
  p_user_id uuid,
  p_outcome text,
  p_calendar_id text,
  p_outcome_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation plugin_data.csf_personal_calendar_destination_operations%ROWTYPE;
  v_destination plugin_data.csf_personal_calendar_destinations%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('confirmed', 'unknown_outcome', 'rejected') THEN
    RAISE EXCEPTION 'That personal calendar destination outcome is invalid.';
  END IF;
  IF (p_outcome = 'confirmed') <> (p_calendar_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A confirmed personal calendar destination requires exactly one provider identity.';
  END IF;
  IF p_calendar_id IS NOT NULL AND length(p_calendar_id) NOT BETWEEN 1 AND 1024 THEN
    RAISE EXCEPTION 'That personal calendar destination identity is invalid.';
  END IF;
  IF p_outcome_code IS NOT NULL AND (
    length(p_outcome_code) NOT BETWEEN 1 AND 80
    OR p_outcome_code !~ '^[a-z0-9_:-]+$'
  ) THEN
    RAISE EXCEPTION 'That personal calendar destination outcome code is invalid.';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM plugin_data.csf_personal_calendar_destination_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That personal calendar destination operation is not available to this account.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_personal_calendar_destination:' || p_user_id::text,
      0
    )
  );

  SELECT operation.*
  INTO v_operation
  FROM plugin_data.csf_personal_calendar_destination_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That personal calendar destination operation is not available to this account.';
  END IF;

  SELECT destination.*
  INTO STRICT v_destination
  FROM plugin_data.csf_personal_calendar_destinations AS destination
  WHERE destination.user_id = p_user_id
  FOR UPDATE;

  IF v_operation.state <> 'started' THEN
    IF v_operation.state <> p_outcome
      OR v_operation.provider_calendar_id IS DISTINCT FROM p_calendar_id
      OR v_operation.outcome_code IS DISTINCT FROM p_outcome_code THEN
      RAISE EXCEPTION 'That personal calendar destination operation already has a different outcome.';
    END IF;
    RETURN jsonb_build_object(
      'operationId', v_operation.id,
      'operationState', v_operation.state,
      'destinationState', v_destination.state,
      'calendarId', v_destination.calendar_id,
      'idempotent', true
    );
  END IF;

  IF v_destination.inflight_operation_id IS DISTINCT FROM v_operation.id THEN
    RAISE EXCEPTION 'That personal calendar destination operation is no longer current.';
  END IF;

  UPDATE plugin_data.csf_personal_calendar_destination_operations
  SET state = p_outcome,
      provider_calendar_id = p_calendar_id,
      outcome_code = p_outcome_code,
      completed_at = now()
  WHERE id = v_operation.id;

  UPDATE plugin_data.csf_personal_calendar_destinations
  SET connection_id = v_operation.connection_id,
      state = CASE p_outcome
        WHEN 'confirmed' THEN 'ready'
        WHEN 'unknown_outcome' THEN 'unknown_outcome'
        ELSE 'rejected'
      END,
      calendar_id = CASE WHEN p_outcome = 'confirmed' THEN p_calendar_id ELSE NULL END,
      inflight_operation_id = NULL,
      last_outcome_code = CASE WHEN p_outcome = 'confirmed' THEN NULL ELSE p_outcome_code END,
      provider_confirmed_at = CASE WHEN p_outcome = 'confirmed' THEN now() ELSE provider_confirmed_at END,
      reviewed_at = CASE WHEN p_outcome = 'rejected' THEN now() ELSE reviewed_at END,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING * INTO v_destination;

  -- Compatibility only: destination truth lives in the server-only table. The
  -- JSON merge is performed in this transaction so another preference update
  -- is not overwritten by a stale application-side object spread.
  IF p_outcome = 'confirmed' AND v_operation.connection_id IS NOT NULL THEN
    UPDATE public.user_calendar_connections
    SET preferences = pg_catalog.jsonb_set(
          coalesce(preferences, '{}'::jsonb),
          '{volunteering_calendar_id}',
          pg_catalog.to_jsonb(p_calendar_id),
          true
        ),
        updated_at = now()
    WHERE id = v_operation.connection_id
      AND user_id = p_user_id
      AND provider = 'google';
  END IF;

  RETURN jsonb_build_object(
    'operationId', v_operation.id,
    'operationState', p_outcome,
    'destinationState', v_destination.state,
    'calendarId', v_destination.calendar_id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_personal_calendar_destination_provision(uuid,uuid,uuid,text,boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_complete_personal_calendar_destination_provision(uuid,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_personal_calendar_destination_provision(uuid,uuid,uuid,text,boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_complete_personal_calendar_destination_provision(uuid,uuid,text,text,text)
  TO service_role;

COMMIT;
