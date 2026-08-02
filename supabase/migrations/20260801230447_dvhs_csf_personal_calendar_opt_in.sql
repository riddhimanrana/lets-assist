-- Durable, user-owned CSF personal Google Calendar bindings.
--
-- Clients never provide Google calendar or event identifiers. A Server Action
-- resolves an authorized CSF source, derives the deterministic event identity,
-- and calls these service-role-only functions. Every provider attempt has an
-- idempotent receipt, and ambiguous outcomes remain reviewable rather than
-- being retried automatically.

BEGIN;

CREATE TABLE plugin_data.csf_personal_calendar_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_kind text NOT NULL
    CHECK (source_kind IN ('csf_opportunity', 'csf_meeting_session', 'csf_deadline')),
  source_id uuid NOT NULL,
  occurrence_key text NOT NULL DEFAULT 'primary'
    CHECK (occurrence_key ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'),
  provider_calendar_id text,
  provider_event_id text NOT NULL
    CHECK (provider_event_id ~ '^csf[0-9a-f]{48}$'),
  confirmed_content_digest text
    CHECK (confirmed_content_digest IS NULL OR confirmed_content_digest ~ '^[0-9a-f]{64}$'),
  pending_content_digest text
    CHECK (pending_content_digest IS NULL OR pending_content_digest ~ '^[0-9a-f]{64}$'),
  desired_state text NOT NULL DEFAULT 'active'
    CHECK (desired_state IN ('active', 'removed')),
  sync_state text NOT NULL DEFAULT 'pending_create'
    CHECK (sync_state IN (
      'pending_create', 'pending_update', 'pending_delete', 'reconciling',
      'synced', 'removed', 'unknown_outcome', 'connection_required', 'error'
    )),
  inflight_operation_id uuid,
  last_error_code text
    CHECK (last_error_code IS NULL OR (
      length(last_error_code) BETWEEN 1 AND 80
      AND last_error_code ~ '^[a-z0-9_:-]+$'
    )),
  provider_confirmed_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, source_kind, source_id, occurrence_key)
);

CREATE TABLE plugin_data.csf_personal_calendar_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL REFERENCES plugin_data.csf_personal_calendar_bindings(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert', 'withdraw', 'reconcile')),
  provider_action text NOT NULL CHECK (provider_action IN ('create', 'update', 'delete', 'lookup', 'none')),
  source_kind text NOT NULL
    CHECK (source_kind IN ('csf_opportunity', 'csf_meeting_session', 'csf_deadline')),
  source_id uuid NOT NULL,
  occurrence_key text NOT NULL
    CHECK (occurrence_key ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'),
  requested_content_digest text
    CHECK (requested_content_digest IS NULL OR requested_content_digest ~ '^[0-9a-f]{64}$'),
  provider_event_id text NOT NULL
    CHECK (provider_event_id ~ '^csf[0-9a-f]{48}$'),
  state text NOT NULL DEFAULT 'started'
    CHECK (state IN ('started', 'confirmed', 'confirmed_deleted', 'connection_required', 'unknown_outcome', 'rejected')),
  outcome_code text
    CHECK (outcome_code IS NULL OR (
      length(outcome_code) BETWEEN 1 AND 80
      AND outcome_code ~ '^[a-z0-9_:-]+$'
    )),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, request_id),
  CONSTRAINT csf_personal_calendar_operation_coordinate_fkey
    FOREIGN KEY (organization_id, user_id, source_kind, source_id, occurrence_key)
    REFERENCES plugin_data.csf_personal_calendar_bindings (
      organization_id, user_id, source_kind, source_id, occurrence_key
    ) ON DELETE CASCADE,
  CONSTRAINT csf_personal_calendar_operation_completion_check CHECK (
    (state = 'started' AND completed_at IS NULL)
    OR (state <> 'started' AND completed_at IS NOT NULL)
  )
);

ALTER TABLE plugin_data.csf_personal_calendar_bindings
  ADD CONSTRAINT csf_personal_calendar_bindings_inflight_fkey
  FOREIGN KEY (inflight_operation_id)
  REFERENCES plugin_data.csf_personal_calendar_operations(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX csf_personal_calendar_bindings_user_state_idx
  ON plugin_data.csf_personal_calendar_bindings (
    organization_id, user_id, sync_state, updated_at DESC
  );

CREATE INDEX csf_personal_calendar_operations_binding_started_idx
  ON plugin_data.csf_personal_calendar_operations (binding_id, started_at DESC);

ALTER TABLE plugin_data.csf_personal_calendar_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_personal_calendar_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_personal_calendar_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_personal_calendar_operations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE plugin_data.csf_personal_calendar_bindings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE plugin_data.csf_personal_calendar_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_personal_calendar_bindings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_personal_calendar_operations TO service_role;

COMMENT ON TABLE plugin_data.csf_personal_calendar_bindings IS
  'Server-only ownership and truth state for one user opting one authorized CSF source into the app-created personal Google calendar. Provider identifiers never cross the client boundary.';
COMMENT ON TABLE plugin_data.csf_personal_calendar_operations IS
  'Idempotent provider-operation receipts for CSF personal calendar opt-in. Unknown outcomes are durable and require an explicit reconciliation request.';

CREATE OR REPLACE FUNCTION plugin_data.csf_personal_calendar_source_is_authorized(
  p_organization_id uuid,
  p_user_id uuid,
  p_source_kind text,
  p_source_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_term_id uuid;
  v_audience text;
  v_is_member boolean := false;
  v_is_applicant boolean := false;
BEGIN
  SELECT account.profile_id
  INTO v_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.status = 'verified'
  ORDER BY account.is_primary DESC, account.linked_at DESC
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_source_kind = 'csf_opportunity' THEN
    SELECT opportunity.term_id
    INTO v_term_id
    FROM plugin_data.csf_opportunities AS opportunity
    JOIN plugin_data.csf_terms AS term
      ON term.organization_id = opportunity.organization_id
     AND term.id = opportunity.term_id
     AND term.lifecycle_status IN ('planned', 'open')
    WHERE opportunity.organization_id = p_organization_id
      AND opportunity.id = p_source_id
      AND opportunity.status = 'published'
      AND opportunity.starts_at IS NOT NULL;
  ELSIF p_source_kind = 'csf_meeting_session' THEN
    SELECT meeting.term_id
    INTO v_term_id
    FROM plugin_data.csf_meeting_sessions AS session
    JOIN plugin_data.csf_meetings AS meeting
      ON meeting.organization_id = session.organization_id
     AND meeting.id = session.meeting_id
     AND meeting.status = 'active'
    JOIN plugin_data.csf_terms AS term
      ON term.organization_id = meeting.organization_id
     AND term.id = meeting.term_id
     AND term.lifecycle_status IN ('planned', 'open')
    WHERE session.organization_id = p_organization_id
      AND session.id = p_source_id
      AND session.status IN ('scheduled', 'open')
      AND (session.starts_at IS NOT NULL OR session.session_date IS NOT NULL);
  ELSIF p_source_kind = 'csf_deadline' THEN
    SELECT deadline.term_id, deadline.audience
    INTO v_term_id, v_audience
    FROM plugin_data.csf_term_deadlines AS deadline
    JOIN plugin_data.csf_terms AS term
      ON term.organization_id = deadline.organization_id
     AND term.id = deadline.term_id
     AND term.lifecycle_status IN ('planned', 'open')
    WHERE deadline.organization_id = p_organization_id
      AND deadline.id = p_source_id
      AND deadline.status IN ('planned', 'open')
      AND deadline.audience IN ('members', 'applicants', 'all');
  ELSE
    RETURN false;
  END IF;

  IF v_term_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = v_profile_id
      AND membership.term_id = v_term_id
      AND membership.status IN ('accepted', 'active', 'completed')
  ) INTO v_is_member;

  IF p_source_kind IN ('csf_opportunity', 'csf_meeting_session') THEN
    RETURN v_is_member;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.profile_id = v_profile_id
      AND application.term_id = v_term_id
      AND application.submission_status IN ('missing_information', 'ready', 'under_review', 'decided')
      AND application.decision_status NOT IN ('rejected', 'withdrawn')
  ) INTO v_is_applicant;

  RETURN CASE v_audience
    WHEN 'members' THEN v_is_member
    WHEN 'applicants' THEN v_is_applicant
    WHEN 'all' THEN v_is_member OR v_is_applicant
    ELSE false
  END;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_personal_calendar_source_is_authorized(uuid,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_personal_calendar_operation(
  p_organization_id uuid,
  p_user_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_occurrence_key text,
  p_operation text,
  p_request_id uuid,
  p_content_digest text,
  p_provider_event_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding plugin_data.csf_personal_calendar_bindings%ROWTYPE;
  v_existing_operation plugin_data.csf_personal_calendar_operations%ROWTYPE;
  v_operation_id uuid := gen_random_uuid();
  v_provider_action text;
  v_terminal_state text;
BEGIN
  IF p_organization_id IS NULL OR p_user_id IS NULL OR p_source_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'A complete personal calendar source coordinate is required.';
  END IF;
  IF p_source_kind NOT IN ('csf_opportunity', 'csf_meeting_session', 'csf_deadline')
    OR p_occurrence_key IS NULL
    OR p_occurrence_key !~ '^[a-z0-9][a-z0-9._:-]{0,127}$' THEN
    RAISE EXCEPTION 'That personal calendar source coordinate is invalid.';
  END IF;
  IF p_operation NOT IN ('upsert', 'withdraw', 'reconcile') THEN
    RAISE EXCEPTION 'That personal calendar operation is invalid.';
  END IF;
  IF p_provider_event_id IS NULL OR p_provider_event_id !~ '^csf[0-9a-f]{48}$' THEN
    RAISE EXCEPTION 'The server-derived personal calendar event identity is invalid.';
  END IF;
  IF p_operation = 'upsert'
    AND (p_content_digest IS NULL OR p_content_digest !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'The canonical personal calendar content digest is required.';
  END IF;
  IF p_operation = 'withdraw' AND p_content_digest IS NOT NULL THEN
    RAISE EXCEPTION 'A withdrawal does not carry calendar content.';
  END IF;
  IF p_operation = 'reconcile'
    AND p_content_digest IS NOT NULL
    AND p_content_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'The canonical reconciliation content digest is invalid.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_personal_calendar:' || p_organization_id::text || ':'
        || p_user_id::text || ':' || p_source_kind || ':' || p_source_id::text
        || ':' || p_occurrence_key,
      0
    )
  );

  SELECT operation.*
  INTO v_existing_operation
  FROM plugin_data.csf_personal_calendar_operations AS operation
  WHERE operation.user_id = p_user_id
    AND operation.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing_operation.organization_id <> p_organization_id
      OR v_existing_operation.source_kind <> p_source_kind
      OR v_existing_operation.source_id <> p_source_id
      OR v_existing_operation.occurrence_key <> p_occurrence_key
      OR v_existing_operation.operation <> p_operation
      OR v_existing_operation.requested_content_digest IS DISTINCT FROM p_content_digest
      OR v_existing_operation.provider_event_id <> p_provider_event_id THEN
      RAISE EXCEPTION 'That personal calendar request identifier is already bound to another operation.';
    END IF;

    SELECT binding.*
    INTO STRICT v_binding
    FROM plugin_data.csf_personal_calendar_bindings AS binding
    WHERE binding.id = v_existing_operation.binding_id;

    RETURN jsonb_build_object(
      'operationId', v_existing_operation.id,
      'bindingId', v_binding.id,
      'providerAction', v_existing_operation.provider_action,
      'operationState', v_existing_operation.state,
      'syncState', v_binding.sync_state,
      'desiredState', v_binding.desired_state,
      'providerCalendarId', v_binding.provider_calendar_id,
      'providerEventId', v_binding.provider_event_id,
      'shouldCallProvider', false,
      'idempotent', true
    );
  END IF;

  SELECT binding.*
  INTO v_binding
  FROM plugin_data.csf_personal_calendar_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.user_id = p_user_id
    AND binding.source_kind = p_source_kind
    AND binding.source_id = p_source_id
    AND binding.occurrence_key = p_occurrence_key
  FOR UPDATE;

  IF p_operation = 'upsert' THEN
    IF NOT plugin_data.csf_personal_calendar_source_is_authorized(
      p_organization_id, p_user_id, p_source_kind, p_source_id
    ) THEN
      RAISE EXCEPTION 'That CSF calendar item is not available to this account.';
    END IF;

    IF FOUND AND v_binding.provider_event_id <> p_provider_event_id THEN
      RAISE EXCEPTION 'The personal calendar binding has an unexpected event identity.';
    END IF;

    IF NOT FOUND THEN
      INSERT INTO plugin_data.csf_personal_calendar_bindings (
        organization_id, user_id, source_kind, source_id, occurrence_key,
        provider_event_id, pending_content_digest, desired_state, sync_state
      ) VALUES (
        p_organization_id, p_user_id, p_source_kind, p_source_id, p_occurrence_key,
        p_provider_event_id, p_content_digest, 'active', 'pending_create'
      )
      RETURNING * INTO v_binding;
      v_provider_action := 'create';
    ELSE
      IF v_binding.sync_state IN ('pending_create', 'pending_update', 'pending_delete', 'reconciling') THEN
        RAISE EXCEPTION 'A personal calendar operation is already underway. Check its status before trying again.';
      END IF;
      IF v_binding.sync_state = 'unknown_outcome' THEN
        RAISE EXCEPTION 'This calendar item needs a status check before another add or update.';
      END IF;
      IF v_binding.sync_state = 'synced'
        AND v_binding.confirmed_content_digest = p_content_digest
        AND v_binding.desired_state = 'active' THEN
        v_provider_action := 'none';
        v_terminal_state := 'confirmed';
      ELSE
        v_provider_action := CASE
          WHEN v_binding.provider_calendar_id IS NULL OR v_binding.sync_state = 'removed'
            THEN 'create'
          ELSE 'update'
        END;
        UPDATE plugin_data.csf_personal_calendar_bindings
        SET pending_content_digest = p_content_digest,
            desired_state = 'active',
            sync_state = CASE v_provider_action WHEN 'create' THEN 'pending_create' ELSE 'pending_update' END,
            last_error_code = NULL,
            updated_at = now()
        WHERE id = v_binding.id
        RETURNING * INTO v_binding;
      END IF;
    END IF;
  ELSIF p_operation = 'withdraw' THEN
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No owned personal calendar binding exists for that CSF item.';
    END IF;
    IF v_binding.provider_event_id <> p_provider_event_id THEN
      RAISE EXCEPTION 'The personal calendar binding has an unexpected event identity.';
    END IF;
    IF v_binding.sync_state IN ('pending_create', 'pending_update', 'pending_delete', 'reconciling') THEN
      RAISE EXCEPTION 'A personal calendar operation is already underway. Check its status before trying again.';
    END IF;
    IF v_binding.sync_state = 'removed' THEN
      v_provider_action := 'none';
      v_terminal_state := 'confirmed_deleted';
    ELSE
      v_provider_action := 'delete';
      UPDATE plugin_data.csf_personal_calendar_bindings
      SET desired_state = 'removed',
          sync_state = 'pending_delete',
          last_error_code = NULL,
          updated_at = now()
      WHERE id = v_binding.id
      RETURNING * INTO v_binding;
    END IF;
  ELSE
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No owned personal calendar binding exists for that CSF item.';
    END IF;
    IF v_binding.provider_event_id <> p_provider_event_id THEN
      RAISE EXCEPTION 'The personal calendar binding has an unexpected event identity.';
    END IF;
    IF v_binding.sync_state IN ('pending_create', 'pending_update', 'pending_delete', 'reconciling') THEN
      IF v_binding.inflight_operation_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_personal_calendar_operations AS inflight
        WHERE inflight.id = v_binding.inflight_operation_id
          AND inflight.state = 'started'
          AND inflight.started_at <= now() - interval '5 minutes'
      ) THEN
        UPDATE plugin_data.csf_personal_calendar_operations
        SET state = 'unknown_outcome',
            outcome_code = 'process_interrupted',
            completed_at = now()
        WHERE id = v_binding.inflight_operation_id
          AND state = 'started';
      ELSE
        RAISE EXCEPTION 'A personal calendar operation is still underway. Check again in a moment.';
      END IF;
    END IF;
    v_provider_action := 'lookup';
    UPDATE plugin_data.csf_personal_calendar_bindings
    SET sync_state = 'reconciling',
        pending_content_digest = CASE
          WHEN desired_state = 'active' THEN coalesce(p_content_digest, pending_content_digest, confirmed_content_digest)
          ELSE pending_content_digest
        END,
        last_error_code = NULL,
        updated_at = now()
    WHERE id = v_binding.id
    RETURNING * INTO v_binding;
  END IF;

  INSERT INTO plugin_data.csf_personal_calendar_operations (
    id, organization_id, user_id, binding_id, request_id, operation,
    provider_action, source_kind, source_id, occurrence_key,
    requested_content_digest, provider_event_id, state, outcome_code, completed_at
  ) VALUES (
    v_operation_id, p_organization_id, p_user_id, v_binding.id, p_request_id,
    p_operation, v_provider_action, p_source_kind, p_source_id, p_occurrence_key,
    p_content_digest, p_provider_event_id,
    coalesce(v_terminal_state, 'started'),
    CASE WHEN v_terminal_state IS NOT NULL THEN 'no_change' ELSE NULL END,
    CASE WHEN v_terminal_state IS NOT NULL THEN now() ELSE NULL END
  );

  UPDATE plugin_data.csf_personal_calendar_bindings
  SET inflight_operation_id = CASE WHEN v_terminal_state IS NULL THEN v_operation_id ELSE NULL END,
      updated_at = now()
  WHERE id = v_binding.id
  RETURNING * INTO v_binding;

  RETURN jsonb_build_object(
    'operationId', v_operation_id,
    'bindingId', v_binding.id,
    'providerAction', v_provider_action,
    'operationState', coalesce(v_terminal_state, 'started'),
    'syncState', v_binding.sync_state,
    'desiredState', v_binding.desired_state,
    'providerCalendarId', v_binding.provider_calendar_id,
    'providerEventId', v_binding.provider_event_id,
    'shouldCallProvider', v_terminal_state IS NULL,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_complete_personal_calendar_operation(
  p_operation_id uuid,
  p_user_id uuid,
  p_outcome text,
  p_provider_calendar_id text,
  p_provider_event_id text,
  p_outcome_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation plugin_data.csf_personal_calendar_operations%ROWTYPE;
  v_binding plugin_data.csf_personal_calendar_bindings%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('confirmed', 'confirmed_deleted', 'connection_required', 'unknown_outcome', 'rejected') THEN
    RAISE EXCEPTION 'That personal calendar provider outcome is invalid.';
  END IF;
  IF p_outcome_code IS NOT NULL AND (
    length(p_outcome_code) NOT BETWEEN 1 AND 80 OR p_outcome_code !~ '^[a-z0-9_:-]+$'
  ) THEN
    RAISE EXCEPTION 'That personal calendar outcome code is invalid.';
  END IF;
  IF p_provider_calendar_id IS NOT NULL AND length(p_provider_calendar_id) NOT BETWEEN 1 AND 1024 THEN
    RAISE EXCEPTION 'That personal calendar identity is invalid.';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM plugin_data.csf_personal_calendar_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That personal calendar operation is not available to this account.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_personal_calendar:' || v_operation.organization_id::text || ':'
        || v_operation.user_id::text || ':' || v_operation.source_kind || ':'
        || v_operation.source_id::text || ':' || v_operation.occurrence_key,
      0
    )
  );

  -- Begin/reconcile takes the coordinate advisory lock before touching either
  -- the binding or operation row. Follow that same global order here so a
  -- stale-operation reconciliation cannot deadlock a late provider completion.
  SELECT operation.*
  INTO v_operation
  FROM plugin_data.csf_personal_calendar_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That personal calendar operation is not available to this account.';
  END IF;

  SELECT binding.*
  INTO STRICT v_binding
  FROM plugin_data.csf_personal_calendar_bindings AS binding
  WHERE binding.id = v_operation.binding_id
  FOR UPDATE;

  IF p_provider_event_id IS DISTINCT FROM v_binding.provider_event_id
    OR p_provider_event_id IS DISTINCT FROM v_operation.provider_event_id THEN
    RAISE EXCEPTION 'The provider result does not match the owned personal calendar event.';
  END IF;

  IF v_operation.state <> 'started' THEN
    IF v_operation.state <> p_outcome
      OR v_operation.outcome_code IS DISTINCT FROM p_outcome_code THEN
      RAISE EXCEPTION 'That personal calendar operation already has a different outcome.';
    END IF;
    RETURN jsonb_build_object(
      'operationId', v_operation.id,
      'bindingId', v_binding.id,
      'operationState', v_operation.state,
      'syncState', v_binding.sync_state,
      'idempotent', true
    );
  END IF;

  IF p_outcome = 'confirmed' AND v_operation.operation = 'withdraw' THEN
    RAISE EXCEPTION 'A withdrawal requires a confirmed deletion outcome.';
  END IF;
  IF p_outcome = 'confirmed_deleted' AND v_binding.desired_state <> 'removed' THEN
    RAISE EXCEPTION 'A confirmed deletion cannot complete an active personal calendar binding.';
  END IF;
  IF p_outcome = 'confirmed'
    AND (p_provider_calendar_id IS NULL OR v_binding.pending_content_digest IS NULL) THEN
    RAISE EXCEPTION 'A confirmed personal calendar event requires its server-owned calendar and content identity.';
  END IF;

  UPDATE plugin_data.csf_personal_calendar_operations
  SET state = p_outcome,
      outcome_code = p_outcome_code,
      completed_at = now()
  WHERE id = v_operation.id;

  UPDATE plugin_data.csf_personal_calendar_bindings
  SET provider_calendar_id = CASE
        WHEN p_outcome = 'confirmed_deleted' THEN NULL
        WHEN p_provider_calendar_id IS NOT NULL THEN p_provider_calendar_id
        ELSE provider_calendar_id
      END,
      confirmed_content_digest = CASE
        WHEN p_outcome = 'confirmed' THEN pending_content_digest
        ELSE confirmed_content_digest
      END,
      pending_content_digest = CASE
        WHEN p_outcome IN ('confirmed', 'confirmed_deleted') THEN NULL
        ELSE pending_content_digest
      END,
      sync_state = CASE p_outcome
        WHEN 'confirmed' THEN 'synced'
        WHEN 'confirmed_deleted' THEN 'removed'
        WHEN 'connection_required' THEN 'connection_required'
        WHEN 'unknown_outcome' THEN 'unknown_outcome'
        ELSE 'error'
      END,
      last_error_code = CASE
        WHEN p_outcome IN ('confirmed', 'confirmed_deleted') THEN NULL
        ELSE coalesce(p_outcome_code, p_outcome)
      END,
      provider_confirmed_at = CASE
        WHEN p_outcome IN ('confirmed', 'confirmed_deleted') THEN now()
        ELSE provider_confirmed_at
      END,
      reconciled_at = CASE
        WHEN v_operation.operation = 'reconcile' THEN now()
        ELSE reconciled_at
      END,
      inflight_operation_id = NULL,
      updated_at = now()
  WHERE id = v_binding.id
  RETURNING * INTO v_binding;

  RETURN jsonb_build_object(
    'operationId', v_operation.id,
    'bindingId', v_binding.id,
    'operationState', p_outcome,
    'syncState', v_binding.sync_state,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_personal_calendar_operation(uuid,uuid,text,uuid,text,text,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_complete_personal_calendar_operation(uuid,uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_personal_calendar_operation(uuid,uuid,text,uuid,text,text,uuid,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_complete_personal_calendar_operation(uuid,uuid,text,text,text,text)
  TO service_role;

COMMIT;
