-- Officers could correct attendance and decide point submissions from a
-- member's profile, but the activity ledger itself was read-only. A row that
-- arrived from a class workbook with the wrong title, the wrong points or the
-- wrong date could not be fixed anywhere in the product, which is most of what
-- an officer needs to do to a past semester.
--
-- These two entrypoints make the ledger editable under officer authority, with
-- a reason and a receipt on every write. What they deliberately do not do:
--
--   * They never touch a credit record that a point submission owns. That
--     ledger belongs to the submission review, and rewriting it here would
--     leave the submission and its award disagreeing. The officer is pointed
--     at the review instead.
--   * They do not silently reach past the closed-semester guard. Editing a
--     closed semester takes an explicit acknowledgement from the officer,
--     which is recorded on the receipt, and the guard refuses without it.

BEGIN;

CREATE UNIQUE INDEX csf_admin_audit_events_profile_activity_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND action IN ('profile.activity_saved', 'profile.activity_deleted');

CREATE OR REPLACE FUNCTION plugin_data.csf_officer_save_profile_activity(
  p_organization_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_activity_event_id uuid,
  p_title text,
  p_point_type text,
  p_points numeric,
  p_event_at timestamptz,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_acknowledge_closed_semester boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_title text := nullif(pg_catalog.btrim(coalesce(p_title, '')), '');
  v_closed boolean := false;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_points numeric(6,2);
  v_event plugin_data.csf_profile_activity_events%ROWTYPE;
  v_before jsonb := '{}'::jsonb;
  v_credit_id uuid;
  v_credit plugin_data.csf_credit_records%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'manage_profiles'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to edit CSF member records.'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable activity-edit request identifier is required.';
  END IF;
  IF v_title IS NULL OR pg_catalog.length(v_title) > 160 THEN
    RAISE EXCEPTION 'Enter an activity name of 1 to 160 characters.';
  END IF;
  IF v_reason IS NULL
    OR pg_catalog.length(v_reason) < 8
    OR pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Explain the correction in 8 to 500 characters.';
  END IF;
  IF p_point_type IS NULL
    OR p_point_type <> ALL (ARRAY['non_drive', 'drive']) THEN
    RAISE EXCEPTION 'Choose whether these are drive or non-drive points.';
  END IF;
  IF p_points IS NULL OR p_points < 0 OR p_points > 9999.99 THEN
    RAISE EXCEPTION 'Enter a point value between 0 and 9999.99.';
  END IF;
  v_points := pg_catalog.round(p_points, 2);

  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action IN ('profile.activity_saved', 'profile.activity_deleted')
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'profile.activity_saved'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION
        'That request identifier is already bound to a different change.';
    END IF;
    RETURN v_receipt.after_data -> 'result';
  END IF;

  PERFORM 1 FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
    AND profile.record_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an active CSF member record in this organization.';
  END IF;
  SELECT term.lifecycle_status IN ('closed', 'archived') INTO v_closed
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose a semester in this organization.';
  END IF;
  IF v_closed THEN
    IF p_acknowledge_closed_semester IS NOT true THEN
      RAISE EXCEPTION 'This semester is closed. Confirm that you are correcting closed evidence before saving.'
        USING HINT = 'CSF_CLOSED_SEMESTER_ACKNOWLEDGEMENT_REQUIRED=true';
    END IF;
    PERFORM pg_catalog.set_config(
      'plugin_data.csf_closed_term_edit_attested', 'on', true
    );
  END IF;

  IF p_activity_event_id IS NOT NULL THEN
    SELECT event.* INTO v_event
    FROM plugin_data.csf_profile_activity_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.id = p_activity_event_id
      AND event.profile_id = p_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That activity record no longer exists. Reload the member.'
        USING DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
              HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
    v_before := pg_catalog.to_jsonb(v_event);
    v_credit_id := v_event.credit_record_id;
  END IF;

  IF v_credit_id IS NOT NULL THEN
    SELECT credit.* INTO v_credit
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.organization_id = p_organization_id AND credit.id = v_credit_id
    FOR UPDATE;
    -- A submission owns its own award. Editing it here would leave the
    -- reviewed submission and the points it granted describing different
    -- things, so the officer is sent to the review that owns it.
    IF FOUND AND v_credit.submission_id IS NOT NULL THEN
      RAISE EXCEPTION 'These points came from a point submission. Correct them in the submission review.';
    END IF;
  END IF;

  IF v_credit_id IS NULL THEN
    INSERT INTO plugin_data.csf_credit_records (
      organization_id, profile_id, term_id, source, points, point_type,
      status, verified_by, verified_at, evidence
    ) VALUES (
      p_organization_id, p_profile_id, p_term_id, 'manual', v_points,
      p_point_type, 'verified', p_actor_user_id, pg_catalog.now(),
      pg_catalog.jsonb_build_object('officerCorrection', true)
    )
    RETURNING id INTO v_credit_id;
  ELSE
    UPDATE plugin_data.csf_credit_records
    SET term_id = p_term_id, points = v_points, point_type = p_point_type,
      status = 'verified', verified_by = p_actor_user_id,
      verified_at = pg_catalog.now(), updated_at = pg_catalog.now(),
      evidence = evidence
        || pg_catalog.jsonb_build_object('officerCorrection', true)
    WHERE organization_id = p_organization_id AND id = v_credit_id;
  END IF;

  IF p_activity_event_id IS NULL THEN
    INSERT INTO plugin_data.csf_profile_activity_events (
      organization_id, profile_id, term_id, credit_record_id, event_type,
      title, event_at, point_type, raw_points, counted_points, status, source,
      source_ref
    ) VALUES (
      p_organization_id, p_profile_id, p_term_id, v_credit_id,
      'manual_adjustment', v_title, coalesce(p_event_at, pg_catalog.now()),
      p_point_type, v_points, v_points, 'recorded', 'manual',
      pg_catalog.jsonb_build_object('officerCorrection', true)
    )
    RETURNING * INTO v_event;
  ELSE
    UPDATE plugin_data.csf_profile_activity_events
    SET term_id = p_term_id, credit_record_id = v_credit_id, title = v_title,
      event_at = coalesce(p_event_at, event_at), point_type = p_point_type,
      raw_points = v_points, counted_points = v_points,
      updated_at = pg_catalog.now(),
      source_ref = source_ref
        || pg_catalog.jsonb_build_object('officerCorrection', true)
    WHERE organization_id = p_organization_id AND id = p_activity_event_id
    RETURNING * INTO v_event;
  END IF;

  -- The acknowledgement covers this one edit. Clear it so a later write in
  -- the same transaction has to carry its own.
  PERFORM pg_catalog.set_config(
    'plugin_data.csf_closed_term_edit_attested', 'off', true
  );

  v_result := pg_catalog.jsonb_build_object(
    'activityEventId', v_event.id,
    'creditRecordId', v_credit_id,
    'created', p_activity_event_id IS NULL
  );
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'profile.activity_saved',
    'csf_profile_activity_events', v_event.id, p_term_id, v_before,
    pg_catalog.jsonb_build_object(
      'profileId', p_profile_id,
      'reason', v_reason,
      'closedSemesterAcknowledged', v_closed,
      'event', pg_catalog.to_jsonb(v_event),
      'result', v_result
    ),
    p_request_id, 'officer_record_correction'
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_officer_delete_profile_activity(
  p_organization_id uuid,
  p_profile_id uuid,
  p_activity_event_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_acknowledge_closed_semester boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_closed boolean := false;
  v_event plugin_data.csf_profile_activity_events%ROWTYPE;
  v_credit plugin_data.csf_credit_records%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'manage_profiles'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to edit CSF member records.'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable activity-edit request identifier is required.';
  END IF;
  IF v_reason IS NULL
    OR pg_catalog.length(v_reason) < 8
    OR pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Explain the correction in 8 to 500 characters.';
  END IF;

  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action IN ('profile.activity_saved', 'profile.activity_deleted')
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'profile.activity_deleted'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION
        'That request identifier is already bound to a different change.';
    END IF;
    RETURN v_receipt.after_data -> 'result';
  END IF;

  PERFORM 1 FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
    AND profile.record_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an active CSF member record in this organization.';
  END IF;

  SELECT event.* INTO v_event
  FROM plugin_data.csf_profile_activity_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_activity_event_id
    AND event.profile_id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That activity record no longer exists. Reload the member.'
      USING DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
            HINT = 'CSF_RELOAD_REQUIRED=true';
  END IF;

  IF v_event.credit_record_id IS NOT NULL THEN
    SELECT credit.* INTO v_credit
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.organization_id = p_organization_id
      AND credit.id = v_event.credit_record_id
    FOR UPDATE;
    IF FOUND AND v_credit.submission_id IS NOT NULL THEN
      RAISE EXCEPTION 'These points came from a point submission. Correct them in the submission review.';
    END IF;
  END IF;

  SELECT coalesce(
    (SELECT term.lifecycle_status IN ('closed', 'archived')
     FROM plugin_data.csf_terms AS term
     WHERE term.organization_id = p_organization_id
       AND term.id = v_event.term_id),
    false
  ) INTO v_closed;
  IF v_closed THEN
    IF p_acknowledge_closed_semester IS NOT true THEN
      RAISE EXCEPTION 'This semester is closed. Confirm that you are correcting closed evidence before removing this row.'
        USING HINT = 'CSF_CLOSED_SEMESTER_ACKNOWLEDGEMENT_REQUIRED=true';
    END IF;
    PERFORM pg_catalog.set_config(
      'plugin_data.csf_closed_term_edit_attested', 'on', true
    );
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'activityEventId', v_event.id,
    'creditRecordId', v_event.credit_record_id
  );
  -- The receipt carries the whole removed row, so the officer can see exactly
  -- what was taken out and put it back by hand if the call was wrong.
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'profile.activity_deleted',
    'csf_profile_activity_events', v_event.id, v_event.term_id,
    pg_catalog.jsonb_build_object(
      'event', pg_catalog.to_jsonb(v_event),
      'credit', coalesce(pg_catalog.to_jsonb(v_credit), 'null'::jsonb)
    ),
    pg_catalog.jsonb_build_object(
      'profileId', p_profile_id, 'reason', v_reason,
      'closedSemesterAcknowledged', v_closed, 'result', v_result
    ),
    p_request_id, 'officer_record_correction'
  );

  DELETE FROM plugin_data.csf_profile_activity_events
  WHERE organization_id = p_organization_id AND id = v_event.id;
  IF v_credit.id IS NOT NULL THEN
    DELETE FROM plugin_data.csf_credit_records
    WHERE organization_id = p_organization_id AND id = v_credit.id;
  END IF;
  -- The acknowledgement covers this one edit. Clear it so a later write in
  -- the same transaction has to carry its own.
  PERFORM pg_catalog.set_config(
    'plugin_data.csf_closed_term_edit_attested', 'off', true
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_officer_save_profile_activity(
  uuid, uuid, uuid, uuid, text, text, numeric, timestamptz, text, uuid, uuid,
  boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_officer_save_profile_activity(
  uuid, uuid, uuid, uuid, text, text, numeric, timestamptz, text, uuid, uuid,
  boolean
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_officer_delete_profile_activity(
  uuid, uuid, uuid, text, uuid, uuid, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_officer_delete_profile_activity(
  uuid, uuid, uuid, text, uuid, uuid, boolean
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_officer_save_profile_activity(
  uuid, uuid, uuid, uuid, text, text, numeric, timestamptz, text, uuid, uuid,
  boolean
) IS
  'Officer edit of one profile activity row and the points it carries, replayable by request id; refuses a submission-owned award, and edits closed evidence only with an acknowledgement it records.';
COMMENT ON FUNCTION plugin_data.csf_officer_delete_profile_activity(
  uuid, uuid, uuid, text, uuid, uuid, boolean
) IS
  'Officer removal of one profile activity row and its officer-owned award, with the whole removed row kept in the receipt.';

NOTIFY pgrst, 'reload schema';

COMMIT;
