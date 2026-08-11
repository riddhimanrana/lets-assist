-- Make every partner-representative capability change and its immutable
-- lifecycle receipt one transaction. The RPCs are service-role entry points,
-- but they still re-authorize the human actor from database truth.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_assign_partner_representative(
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
  v_club_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_existing_assignment plugin_data.csf_partner_club_representatives%ROWTYPE;
  v_existing_event plugin_data.csf_partner_club_term_events%ROWTYPE;
  v_assignment_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_effective_start date := coalesce(
    p_effective_start,
    (now() AT TIME ZONE 'America/Los_Angeles')::date
  );
  v_idempotency_key text := 'representative:assignment-request:' || p_request_id::text;
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;
  IF v_display_name IS NULL OR length(v_display_name) < 2 OR length(v_display_name) > 160 THEN
    RAISE EXCEPTION 'Enter a representative name between 2 and 160 characters.';
  END IF;
  IF v_email IS NULL OR length(v_email) > 320 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid representative email address.';
  END IF;
  IF p_role NOT IN ('primary_contact', 'president', 'adviser', 'coordinator', 'other') THEN
    RAISE EXCEPTION 'Choose a valid representative role.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'An assignment request identifier is required.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_assign_partner_representative:'
        || p_organization_id::text || ':' || p_partner_club_term_id::text,
      0
    )
  );

  SELECT club_term.*
  INTO v_club_term
  FROM plugin_data.csf_partner_club_terms AS club_term
  JOIN plugin_data.csf_partner_clubs AS club
    ON club.organization_id = club_term.organization_id
   AND club.id = club_term.partner_club_id
  WHERE club_term.organization_id = p_organization_id
    AND club_term.id = p_partner_club_term_id
    AND club.status = 'active'
    AND club_term.workflow_status NOT IN ('rejected', 'archived')
  FOR UPDATE OF club_term;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That active club semester is not available in this organization.';
  END IF;

  SELECT event.*
  INTO v_existing_event
  FROM plugin_data.csf_partner_club_term_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.idempotency_key = v_idempotency_key;
  IF FOUND THEN
    SELECT representative.*
    INTO v_existing_assignment
    FROM plugin_data.csf_partner_club_representatives AS representative
    WHERE representative.organization_id = p_organization_id
      AND representative.partner_club_term_id = p_partner_club_term_id
      AND representative.id::text = (v_existing_event.metadata ->> 'representativeId');
    IF NOT FOUND
      OR v_existing_event.partner_club_term_id <> p_partner_club_term_id
      OR v_existing_event.event_type <> 'decision_recorded'
      OR v_existing_event.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR (v_existing_event.metadata ->> 'representativeAction') IS DISTINCT FROM 'assigned'
      OR (v_existing_event.metadata ->> 'requestId') IS DISTINCT FROM p_request_id::text
      OR v_existing_assignment.created_by IS DISTINCT FROM p_actor_user_id
      OR v_existing_assignment.display_name IS DISTINCT FROM v_display_name
      OR v_existing_assignment.normalized_email IS DISTINCT FROM v_email
      OR v_existing_assignment.role IS DISTINCT FROM p_role
      OR v_existing_assignment.effective_start IS DISTINCT FROM v_effective_start
      OR v_existing_assignment.is_primary IS DISTINCT FROM coalesce(p_is_primary, false) THEN
      RAISE EXCEPTION 'That assignment request identifier is already bound to different access.';
    END IF;
    RETURN jsonb_build_object(
      'assignmentId', v_existing_assignment.id,
      'correlationId', v_existing_event.correlation_id,
      'status', v_existing_assignment.status,
      'idempotent', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_representatives AS representative
    WHERE representative.organization_id = p_organization_id
      AND representative.partner_club_term_id = p_partner_club_term_id
      AND representative.normalized_email = v_email
      AND representative.status IN ('invited', 'active')
  ) THEN
    RAISE EXCEPTION 'That email already has live representative access for this club semester.';
  END IF;
  IF coalesce(p_is_primary, false) AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_representatives AS representative
    WHERE representative.organization_id = p_organization_id
      AND representative.partner_club_term_id = p_partner_club_term_id
      AND representative.is_primary = true
      AND representative.status IN ('invited', 'active')
  ) THEN
    RAISE EXCEPTION 'This club semester already has a primary representative.';
  END IF;

  INSERT INTO plugin_data.csf_partner_club_representatives (
    id,
    organization_id,
    partner_club_term_id,
    role,
    display_name,
    email,
    status,
    effective_start,
    is_primary,
    created_by,
    metadata
  ) VALUES (
    v_assignment_id,
    p_organization_id,
    p_partner_club_term_id,
    p_role,
    v_display_name,
    v_email,
    'invited',
    v_effective_start,
    coalesce(p_is_primary, false),
    p_actor_user_id,
    jsonb_build_object(
      'source', 'staff_assignment',
      'capabilityScope', 'partner_club_term',
      'requestId', p_request_id,
      'correlationId', v_correlation_id
    )
  );

  INSERT INTO plugin_data.csf_partner_club_term_events (
    organization_id,
    partner_club_term_id,
    event_type,
    previous_workflow_status,
    next_workflow_status,
    actor_user_id,
    reason,
    metadata,
    idempotency_key,
    correlation_id
  ) VALUES (
    p_organization_id,
    p_partner_club_term_id,
    'decision_recorded',
    v_club_term.workflow_status,
    v_club_term.workflow_status,
    p_actor_user_id,
    'CSF assigned representative access for this club semester.',
    jsonb_build_object(
      'representativeVisible', true,
      'representativeId', v_assignment_id,
      'representativeAction', 'assigned',
      'requestId', p_request_id,
      'role', p_role,
      'isPrimary', coalesce(p_is_primary, false),
      'effectiveStart', v_effective_start
    ),
    v_idempotency_key,
    v_correlation_id
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'partner_representative.assign',
    'csf_partner_club_representatives',
    v_assignment_id,
    v_club_term.term_id,
    jsonb_build_object(
      'partnerClubTermId', p_partner_club_term_id,
      'role', p_role,
      'isPrimary', coalesce(p_is_primary, false),
      'effectiveStart', v_effective_start,
      'status', 'invited'
    ),
    v_correlation_id,
    'staff_action',
    v_assignment_id::text,
    'partner_representative_assigned'
  );

  RETURN jsonb_build_object(
    'assignmentId', v_assignment_id,
    'correlationId', v_correlation_id,
    'status', 'invited',
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_acknowledge_partner_representative(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_partner_club_term_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assignment plugin_data.csf_partner_club_representatives%ROWTYPE;
  v_club_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_verified_email text;
  v_event_id uuid;
  v_event_term_id uuid;
  v_event_type text;
  v_event_actor_user_id uuid;
  v_event_representative_id text;
  v_correlation_id uuid := gen_random_uuid();
  v_today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_idempotency_key text := 'representative:' || p_assignment_id::text || ':acknowledgment:v1';
BEGIN
  SELECT lower(btrim(account.email))
  INTO v_verified_email
  FROM auth.users AS account
  WHERE account.id = p_actor_user_id
    AND account.email IS NOT NULL
    AND (account.email_confirmed_at IS NOT NULL OR account.confirmed_at IS NOT NULL);
  IF v_verified_email IS NULL THEN
    RAISE EXCEPTION 'A signed-in account with a verified email is required.';
  END IF;

  SELECT representative.*
  INTO v_assignment
  FROM plugin_data.csf_partner_club_representatives AS representative
  WHERE representative.organization_id = p_organization_id
    AND representative.id = p_assignment_id
    AND representative.partner_club_term_id = p_partner_club_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This representative assignment is not available to your account.';
  END IF;
  IF v_assignment.status NOT IN ('invited', 'active')
    OR v_assignment.effective_start > v_today
    OR (v_assignment.effective_end IS NOT NULL AND v_assignment.effective_end < v_today) THEN
    RAISE EXCEPTION 'This representative assignment is not active for today.';
  END IF;
  IF v_assignment.user_id IS NOT NULL AND v_assignment.user_id <> p_actor_user_id THEN
    RAISE EXCEPTION 'This representative assignment belongs to another account.';
  END IF;
  IF v_assignment.user_id IS NULL AND v_assignment.normalized_email <> v_verified_email THEN
    RAISE EXCEPTION 'Use the verified email address that received this representative assignment.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_representatives AS representative
    WHERE representative.organization_id = p_organization_id
      AND representative.partner_club_term_id = p_partner_club_term_id
      AND representative.user_id = p_actor_user_id
      AND representative.id <> p_assignment_id
      AND representative.status IN ('invited', 'active')
  ) THEN
    RAISE EXCEPTION 'This account already has different live access for the club semester.';
  END IF;

  SELECT club_term.*
  INTO v_club_term
  FROM plugin_data.csf_partner_club_terms AS club_term
  WHERE club_term.organization_id = p_organization_id
    AND club_term.id = p_partner_club_term_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That club semester is no longer available.';
  END IF;

  SELECT
    event.id,
    event.partner_club_term_id,
    event.event_type,
    event.actor_user_id,
    event.metadata ->> 'representativeId'
  INTO
    v_event_id,
    v_event_term_id,
    v_event_type,
    v_event_actor_user_id,
    v_event_representative_id
  FROM plugin_data.csf_partner_club_term_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.idempotency_key = v_idempotency_key;
  IF v_event_id IS NOT NULL AND (
    v_event_term_id <> p_partner_club_term_id
    OR v_event_type <> 'acknowledgment_recorded'
    OR v_event_actor_user_id IS DISTINCT FROM p_actor_user_id
    OR v_event_representative_id IS DISTINCT FROM v_assignment.id::text
  ) THEN
    RAISE EXCEPTION 'The acknowledgment receipt key is already bound to unrelated history.';
  END IF;

  IF v_assignment.status = 'active'
    AND v_assignment.user_id = p_actor_user_id
    AND v_event_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'assignmentId', v_assignment.id,
      'eventId', v_event_id,
      'status', 'active',
      'idempotent', true
    );
  END IF;

  UPDATE plugin_data.csf_partner_club_representatives
  SET user_id = p_actor_user_id,
      status = 'active',
      updated_at = now()
  WHERE organization_id = p_organization_id
    AND id = p_assignment_id
    AND partner_club_term_id = p_partner_club_term_id;

  IF v_event_id IS NULL THEN
    v_event_id := gen_random_uuid();
    INSERT INTO plugin_data.csf_partner_club_term_events (
      id,
      organization_id,
      partner_club_term_id,
      event_type,
      previous_workflow_status,
      next_workflow_status,
      actor_user_id,
      reason,
      metadata,
      idempotency_key,
      correlation_id
    ) VALUES (
      v_event_id,
      p_organization_id,
      p_partner_club_term_id,
      'acknowledgment_recorded',
      v_club_term.workflow_status,
      v_club_term.workflow_status,
      p_actor_user_id,
      'Representative acknowledged the current club standing and point policy.',
      jsonb_build_object(
        'representativeVisible', true,
        'representativeId', v_assignment.id,
        'acknowledgmentKind', 'assignment_and_current_policy',
        'policySnapshot', jsonb_build_object(
          'approvedPointTypes', v_club_term.approved_point_types,
          'nonDrivePoints', v_club_term.non_drive_points,
          'drivePoints', v_club_term.drive_points,
          'proofRequired', v_club_term.proof_required,
          'allocationSatisfied', v_club_term.allocation_satisfied
        )
      ),
      v_idempotency_key,
      v_correlation_id
    );
  END IF;

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
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'partner_representative.acknowledge',
    'csf_partner_club_representatives',
    v_assignment.id,
    v_club_term.term_id,
    jsonb_build_object('status', v_assignment.status, 'userId', v_assignment.user_id),
    jsonb_build_object('status', 'active', 'userId', p_actor_user_id, 'eventId', v_event_id),
    v_correlation_id,
    'representative_action',
    v_assignment.id::text,
    'partner_representative_acknowledged'
  );

  RETURN jsonb_build_object(
    'assignmentId', v_assignment.id,
    'eventId', v_event_id,
    'correlationId', v_correlation_id,
    'status', 'active',
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_request_partner_representative_correction(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_partner_club_term_id uuid,
  p_category text,
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
  v_assignment plugin_data.csf_partner_club_representatives%ROWTYPE;
  v_club_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_event_id uuid;
  v_event_term_id uuid;
  v_event_type text;
  v_event_actor_user_id uuid;
  v_event_representative_id text;
  v_event_category text;
  v_event_request_id text;
  v_event_reason text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_correlation_id uuid := gen_random_uuid();
  v_today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_idempotency_key text := 'representative:' || p_assignment_id::text
    || ':correction:' || p_request_id::text;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A correction request identifier is required.';
  END IF;
  IF p_category NOT IN ('standing', 'point_policy', 'audit_status', 'club_details', 'other') THEN
    RAISE EXCEPTION 'Choose what needs correction.';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 10 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Explain the requested correction in 10 to 1000 characters.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_actor_user_id) THEN
    RAISE EXCEPTION 'A signed-in account is required.';
  END IF;

  SELECT representative.*
  INTO v_assignment
  FROM plugin_data.csf_partner_club_representatives AS representative
  WHERE representative.organization_id = p_organization_id
    AND representative.id = p_assignment_id
    AND representative.partner_club_term_id = p_partner_club_term_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_assignment.status <> 'active'
    OR v_assignment.user_id IS DISTINCT FROM p_actor_user_id
    OR v_assignment.effective_start > v_today
    OR (v_assignment.effective_end IS NOT NULL AND v_assignment.effective_end < v_today) THEN
    RAISE EXCEPTION 'Active representative access is required to request a correction.';
  END IF;

  SELECT club_term.*
  INTO v_club_term
  FROM plugin_data.csf_partner_club_terms AS club_term
  WHERE club_term.organization_id = p_organization_id
    AND club_term.id = p_partner_club_term_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That club semester is no longer available.';
  END IF;

  SELECT
    event.id,
    event.partner_club_term_id,
    event.event_type,
    event.actor_user_id,
    event.metadata ->> 'representativeId',
    event.metadata ->> 'correctionCategory',
    event.metadata ->> 'requestId',
    event.reason
  INTO
    v_event_id,
    v_event_term_id,
    v_event_type,
    v_event_actor_user_id,
    v_event_representative_id,
    v_event_category,
    v_event_request_id,
    v_event_reason
  FROM plugin_data.csf_partner_club_term_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.idempotency_key = v_idempotency_key;
  IF v_event_id IS NOT NULL THEN
    IF v_event_term_id <> p_partner_club_term_id
      OR v_event_type <> 'audit_submitted'
      OR v_event_actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_event_representative_id IS DISTINCT FROM v_assignment.id::text
      OR v_event_category IS DISTINCT FROM p_category
      OR v_event_request_id IS DISTINCT FROM p_request_id::text
      OR v_event_reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'The correction request key is already bound to unrelated history.';
    END IF;
    RETURN jsonb_build_object(
      'assignmentId', v_assignment.id,
      'eventId', v_event_id,
      'idempotent', true
    );
  END IF;

  v_event_id := gen_random_uuid();
  INSERT INTO plugin_data.csf_partner_club_term_events (
    id,
    organization_id,
    partner_club_term_id,
    event_type,
    previous_workflow_status,
    next_workflow_status,
    actor_user_id,
    reason,
    metadata,
    idempotency_key,
    correlation_id
  ) VALUES (
    v_event_id,
    p_organization_id,
    p_partner_club_term_id,
    'audit_submitted',
    v_club_term.workflow_status,
    v_club_term.workflow_status,
    p_actor_user_id,
    v_reason,
    jsonb_build_object(
      'representativeVisible', true,
      'representativeId', v_assignment.id,
      'submissionKind', 'representative_correction_request',
      'correctionCategory', p_category,
      'requestId', p_request_id
    ),
    v_idempotency_key,
    v_correlation_id
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'partner_representative.request_correction',
    'csf_partner_club_representatives',
    v_assignment.id,
    v_club_term.term_id,
    jsonb_build_object(
      'partnerClubTermId', p_partner_club_term_id,
      'category', p_category,
      'eventId', v_event_id,
      'requestId', p_request_id
    ),
    v_correlation_id,
    'representative_action',
    v_assignment.id::text,
    'partner_representative_correction_requested'
  );

  RETURN jsonb_build_object(
    'assignmentId', v_assignment.id,
    'eventId', v_event_id,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_revoke_partner_representative(
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
  v_assignment plugin_data.csf_partner_club_representatives%ROWTYPE;
  v_club_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_existing_event plugin_data.csf_partner_club_term_events%ROWTYPE;
  v_event_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_correlation_id uuid := p_request_id;
  v_today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_idempotency_key text := 'representative:revocation-request:' || p_request_id::text;
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 8 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Explain the revocation in 8 to 1000 characters.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A revocation request identifier is required.';
  END IF;

  SELECT representative.*
  INTO v_assignment
  FROM plugin_data.csf_partner_club_representatives AS representative
  WHERE representative.organization_id = p_organization_id
    AND representative.id = p_assignment_id
    AND representative.partner_club_term_id = p_partner_club_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Representative access was not found in this organization and club semester.';
  END IF;

  SELECT club_term.*
  INTO v_club_term
  FROM plugin_data.csf_partner_club_terms AS club_term
  WHERE club_term.organization_id = p_organization_id
    AND club_term.id = p_partner_club_term_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That club semester is no longer available.';
  END IF;

  SELECT event.*
  INTO v_existing_event
  FROM plugin_data.csf_partner_club_term_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.idempotency_key = v_idempotency_key;
  IF v_existing_event.id IS NOT NULL AND (
    v_existing_event.partner_club_term_id <> p_partner_club_term_id
    OR v_existing_event.event_type <> 'decision_recorded'
    OR v_existing_event.actor_user_id IS DISTINCT FROM p_actor_user_id
    OR v_existing_event.reason IS DISTINCT FROM v_reason
    OR (v_existing_event.metadata ->> 'representativeId') IS DISTINCT FROM v_assignment.id::text
    OR (v_existing_event.metadata ->> 'representativeAction') IS DISTINCT FROM 'revoked'
    OR (v_existing_event.metadata ->> 'requestId') IS DISTINCT FROM p_request_id::text
  ) THEN
    RAISE EXCEPTION 'That revocation request identifier is already bound to a different change.';
  END IF;
  IF v_assignment.status = 'revoked' AND v_existing_event.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'assignmentId', v_assignment.id,
      'eventId', v_existing_event.id,
      'correlationId', v_existing_event.correlation_id,
      'status', 'revoked',
      'idempotent', true
    );
  END IF;
  IF v_assignment.status NOT IN ('invited', 'active') THEN
    RAISE EXCEPTION 'Only live representative access can be revoked.';
  END IF;

  UPDATE plugin_data.csf_partner_club_representatives
  SET status = 'revoked',
      effective_end = greatest(v_today, v_assignment.effective_start),
      updated_at = now(),
      metadata = v_assignment.metadata || jsonb_build_object(
        'revokedBy', p_actor_user_id,
        'revokedAt', now(),
        'revocationCorrelationId', v_correlation_id
      )
  WHERE organization_id = p_organization_id
    AND id = p_assignment_id
    AND partner_club_term_id = p_partner_club_term_id;

  v_event_id := gen_random_uuid();
  INSERT INTO plugin_data.csf_partner_club_term_events (
    id,
    organization_id,
    partner_club_term_id,
    event_type,
    previous_workflow_status,
    next_workflow_status,
    actor_user_id,
    reason,
    metadata,
    idempotency_key,
    correlation_id
  ) VALUES (
    v_event_id,
    p_organization_id,
    p_partner_club_term_id,
    'decision_recorded',
    v_club_term.workflow_status,
    v_club_term.workflow_status,
    p_actor_user_id,
    v_reason,
    jsonb_build_object(
      'representativeVisible', true,
      'representativeId', v_assignment.id,
      'representativeAction', 'revoked',
      'requestId', p_request_id,
      'previousStatus', v_assignment.status,
      'nextStatus', 'revoked'
    ),
    v_idempotency_key,
    v_correlation_id
  );

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
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'partner_representative.revoke',
    'csf_partner_club_representatives',
    v_assignment.id,
    v_club_term.term_id,
    jsonb_build_object(
      'status', v_assignment.status,
      'effectiveEnd', v_assignment.effective_end
    ),
    jsonb_build_object(
      'status', 'revoked',
      'effectiveEnd', greatest(v_today, v_assignment.effective_start),
      'reason', v_reason,
      'eventId', v_event_id
    ),
    v_correlation_id,
    'staff_action',
    v_assignment.id::text,
    'partner_representative_revoked'
  );

  RETURN jsonb_build_object(
    'assignmentId', v_assignment.id,
    'eventId', v_event_id,
    'correlationId', v_correlation_id,
    'status', 'revoked',
    'idempotent', false
  );
END;
$$;

-- Older active rows predate the atomic acknowledgment operation. Preserve the
-- distinction in metadata while giving every such row an immutable receipt,
-- so future readers never infer evidence that was not actually captured.
INSERT INTO plugin_data.csf_partner_club_term_events (
  organization_id,
  partner_club_term_id,
  event_type,
  previous_workflow_status,
  next_workflow_status,
  actor_user_id,
  reason,
  metadata,
  idempotency_key
)
SELECT
  representative.organization_id,
  representative.partner_club_term_id,
  'acknowledgment_recorded',
  club_term.workflow_status,
  club_term.workflow_status,
  representative.user_id,
  'Active representative access existed before atomic acknowledgment receipts were enforced.',
  jsonb_build_object(
    'representativeVisible', true,
    'representativeId', representative.id,
    'acknowledgmentKind', 'legacy_active_state_backfill',
    'evidenceCaptured', false
  ),
  'representative:' || representative.id::text || ':acknowledgment:v1'
FROM plugin_data.csf_partner_club_representatives AS representative
JOIN plugin_data.csf_partner_club_terms AS club_term
  ON club_term.organization_id = representative.organization_id
 AND club_term.id = representative.partner_club_term_id
WHERE representative.status = 'active'
ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

REVOKE ALL ON FUNCTION plugin_data.csf_assign_partner_representative(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_acknowledge_partner_representative(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_request_partner_representative_correction(
  uuid, uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_revoke_partner_representative(
  uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_assign_partner_representative(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_acknowledge_partner_representative(
  uuid, uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_request_partner_representative_correction(
  uuid, uuid, uuid, text, text, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_revoke_partner_representative(
  uuid, uuid, uuid, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_assign_partner_representative(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
) IS 'Service-role-only atomic partner representative assignment with database permission recheck, lifecycle event, and admin audit receipt.';
COMMENT ON FUNCTION plugin_data.csf_acknowledge_partner_representative(
  uuid, uuid, uuid, uuid
) IS 'Service-role-only atomic representative account binding and acknowledgment receipt, authorized from verified auth email or the already-bound account.';
COMMENT ON FUNCTION plugin_data.csf_request_partner_representative_correction(
  uuid, uuid, uuid, text, text, uuid, uuid
) IS 'Service-role-only idempotent representative correction request, scoped to one active account-bound club-semester assignment.';
COMMENT ON FUNCTION plugin_data.csf_revoke_partner_representative(
  uuid, uuid, uuid, text, uuid, uuid
) IS 'Service-role-only replay-safe representative revocation with database permission recheck, immutable lifecycle event, and admin audit receipt.';

COMMIT;
