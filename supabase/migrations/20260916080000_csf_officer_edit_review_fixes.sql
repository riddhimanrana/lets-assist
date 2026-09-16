-- Fixes from the independent review of this stack. Each is named by its
-- finding id so the review and the code stay tied together.
--
--   C4  A row leaving a closed semester is a change to closed evidence even
--       when it lands in an open one. Only the destination term was read, so
--       an event with no credit record moved out of a closed semester
--       silently, and the guarded case was a dead end because ticking the
--       acknowledgement changed nothing.
--   C5  An attested merge could not replay. It re-read the live preview
--       before looking for a receipt, and after a successful merge the source
--       is 'merged', so a retry of the same request raised rather than
--       returning what the first call did.
--   C7  The save and delete receipts compared only the action and the actor,
--       so a reused request identifier replayed a different correction and
--       reported success having written nothing.
--   C8  Meeting rows carry no credit record, so the editor's create branch
--       minted a fresh award and credited the member twice for a meeting
--       csf_meeting_attendance already records.
--   C9  Removing a shared award silently detached the other activity rows and
--       point appeals that referenced it, both being ON DELETE SET NULL.
--   C11 The event was scoped to the member but the award it points at was
--       not, so one member's page could rewrite another member's award.
--   H1  The attestation flags are transaction-local and unreachable through
--       the PostgREST boundary, which is what actually protects them. The
--       earlier comments claimed no role could set them, which is not true of
--       a placeholder GUC; the claim is corrected where it is made.
--   H2  btrim strips spaces only, while JavaScript trim also strips tabs,
--       newlines, NBSP and BOM, so the two attendance normalizers disagreed
--       for any writer that did not pre-trim.
--
-- Append-only: every function below is replaced in full, and no earlier
-- migration is edited.

BEGIN;

-- H1: a placeholder GUC in an unreserved prefix can be SET by any role. What
-- protects these flags is that they are transaction-local and that no client
-- reaches a SET through PostgREST, which is a property of the deployment
-- rather than of the flag. The reopen path pairs its GUC with a
-- txid_current()-keyed authorization row; these do not, and the comments now
-- say so rather than claiming more.
COMMENT ON FUNCTION plugin_data.csf_merge_identity_attested() IS
  'True only inside a transaction where the attested merge entrypoint set it after authorizing. Transaction-local and unreachable through the PostgREST boundary; not protected by a SET privilege.';
COMMENT ON FUNCTION plugin_data.csf_closed_term_edit_attested() IS
  'True only inside a transaction where an officer entrypoint recorded an explicit acknowledgement. Transaction-local and unreachable through the PostgREST boundary; not protected by a SET privilege.';

CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_attested_conflicts text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attested text[];
  v_pending text[];
  v_result jsonb;
BEGIN
  -- A service-role call is not actor authority, and this entrypoint is the one
  -- that can relax a finding. Recheck before anything else.
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'manage_profiles'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to merge CSF profiles.';
  END IF;

  SELECT coalesce(
    pg_catalog.array_agg(DISTINCT pg_catalog.btrim(entry)
      ORDER BY pg_catalog.btrim(entry)),
    ARRAY[]::text[]
  )
  INTO v_attested
  FROM pg_catalog.unnest(coalesce(p_attested_conflicts, ARRAY[]::text[]))
    AS entry
  WHERE pg_catalog.btrim(entry) <> '';

  IF pg_catalog.cardinality(v_attested) = 0 THEN
    RETURN plugin_data.csf_merge_profiles(
      p_organization_id, p_source_profile_id, p_target_profile_id,
      p_reason, p_actor_user_id, p_request_id
    );
  END IF;

  IF NOT (v_attested <@ plugin_data.csf_attestable_merge_conflict_types()) THEN
    RAISE EXCEPTION
      'That merge finding is not one an officer may attest past.';
  END IF;

  -- C5: an attested merge has to replay like an ordinary one. After a
  -- successful merge the source is 'merged', so re-reading the live preview
  -- first meant a retry of the same request raised either saved_stale or the
  -- already-merged error instead of returning the receipt. Answer from the
  -- attestation receipt when this exact request already carried one, and let
  -- the request-aware merge underneath replay its own.
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS attestation
    WHERE attestation.organization_id = p_organization_id
      AND attestation.correlation_id = p_request_id
      AND attestation.action = 'profile.merge_identity_attested'
      AND attestation.actor_user_id = p_actor_user_id
      AND attestation.target_id = p_target_profile_id
      AND attestation.after_data ->> 'sourceProfileId'
        = p_source_profile_id::text
      AND attestation.after_data -> 'attestedConflicts'
        = pg_catalog.to_jsonb(v_attested)
  ) THEN
    RETURN plugin_data.csf_merge_profiles(
      p_organization_id, p_source_profile_id, p_target_profile_id,
      p_reason, p_actor_user_id, p_request_id
    ) || pg_catalog.jsonb_build_object(
      'attestedConflicts', pg_catalog.to_jsonb(v_attested)
    );
  END IF;

  -- Read the live findings under the identity lock the merge itself takes, so
  -- the attestation describes the state the merge is about to act on.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT coalesce(
    pg_catalog.array_agg(DISTINCT entry.conflict ->> 'type'
      ORDER BY entry.conflict ->> 'type'),
    ARRAY[]::text[]
  )
  INTO v_pending
  FROM pg_catalog.jsonb_array_elements(
    plugin_data.csf_profile_merge_preview(
      p_organization_id, p_source_profile_id, p_target_profile_id
    ) -> 'attestableConflicts'
  ) AS entry(conflict);

  IF v_attested IS DISTINCT FROM v_pending THEN
    RAISE EXCEPTION USING
      MESSAGE = 'The identity findings changed since this merge was previewed. Preview these records again before merging.',
      DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
      HINT = 'CSF_RELOAD_REQUIRED=true';
  END IF;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_merge_identity_attested', 'on', true
  );
  v_result := plugin_data.csf_merge_profiles(
    p_organization_id, p_source_profile_id, p_target_profile_id,
    p_reason, p_actor_user_id, p_request_id
  );
  PERFORM pg_catalog.set_config(
    'plugin_data.csf_merge_identity_attested', 'off', true
  );

  -- The request-aware merge replays from its own receipt, so the attestation
  -- receipt is written once for the same request identifier.
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = p_organization_id
      AND audit.correlation_id = p_request_id
      AND audit.action = 'profile.merge_identity_attested'
  ) THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      before_data, after_data, correlation_id, source_type, source_id,
      reason_code
    ) VALUES (
      p_organization_id, p_actor_user_id, 'profile.merge_identity_attested',
      'csf_profiles', p_target_profile_id, '{}'::jsonb,
      pg_catalog.jsonb_build_object(
        'sourceProfileId', p_source_profile_id,
        'attestedConflicts', pg_catalog.to_jsonb(v_attested),
        'reason', nullif(pg_catalog.btrim(coalesce(p_reason, '')), '')
      ),
      p_request_id, 'profile_merge_request', p_source_profile_id::text,
      'officer_attested_identity'
    );
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'attestedConflicts', pg_catalog.to_jsonb(v_attested)
  );
END;
$$;

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
  v_request_fingerprint text;
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

  -- C7: the receipt has to describe THIS edit. Comparing only the action and
  -- the actor let a reused identifier replay someone else's correction and
  -- report success having written nothing.
  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'profileId', p_profile_id,
          'termId', p_term_id,
          'activityEventId', p_activity_event_id,
          'title', v_title,
          'pointType', p_point_type,
          'points', v_points,
          'eventAt', p_event_at,
          'reason', v_reason
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action IN ('profile.activity_saved', 'profile.activity_deleted')
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'profile.activity_saved'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
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

  -- C4: a row leaving a closed semester is a change to closed evidence even
  -- when it lands in an open one. Reading only the destination term let an
  -- event with no credit record move out of a closed semester silently, and
  -- made the guarded case a dead end because ticking the box changed nothing.
  IF p_activity_event_id IS NOT NULL THEN
    SELECT v_closed OR coalesce(
      (SELECT term.lifecycle_status IN ('closed', 'archived')
       FROM plugin_data.csf_profile_activity_events AS event
       JOIN plugin_data.csf_terms AS term
         ON term.organization_id = event.organization_id
        AND term.id = event.term_id
       WHERE event.organization_id = p_organization_id
         AND event.id = p_activity_event_id
         AND event.profile_id = p_profile_id),
      false
    ) INTO v_closed;
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
    -- C8: meeting rows carry zero points and no credit record, so the
    -- create branch below would mint a fresh award and credit the member
    -- twice for a meeting that csf_meeting_attendance already records.
    IF v_event.point_type = 'meeting'
      OR v_event.event_type <> ALL (
        ARRAY['manual_adjustment', 'legacy_import', 'opportunity']
      ) THEN
      RAISE EXCEPTION 'That record is not an activity the ledger editor owns. Correct it where it is recorded.';
    END IF;
    v_before := pg_catalog.to_jsonb(v_event);
    v_credit_id := v_event.credit_record_id;
  END IF;

  IF v_credit_id IS NOT NULL THEN
    SELECT credit.* INTO v_credit
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.organization_id = p_organization_id
      AND credit.id = v_credit_id
      AND credit.profile_id = p_profile_id
    FOR UPDATE;
    -- C11: the event is scoped to this member but the credit it points at was
    -- not, so a cross-profile credit_record_id let one member's page rewrite
    -- another member's award. Refuse rather than quietly minting a new one.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That award belongs to a different member record. Reload the member.'
        USING DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
              HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
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
    WHERE organization_id = p_organization_id
      AND id = v_credit_id
      AND profile_id = p_profile_id;
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
      'requestFingerprint', v_request_fingerprint,
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
  v_request_fingerprint text;
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

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'profileId', p_profile_id,
          'activityEventId', p_activity_event_id,
          'reason', v_reason
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action IN ('profile.activity_saved', 'profile.activity_deleted')
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'profile.activity_deleted'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
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
      AND credit.profile_id = p_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That award belongs to a different member record. Reload the member.'
        USING DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
              HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
    IF v_credit.submission_id IS NOT NULL THEN
      RAISE EXCEPTION 'These points came from a point submission. Correct them in the submission review.';
    END IF;
    -- C9: csf_profile_activity_events.credit_record_id and
    -- csf_point_appeals.credit_record_id are both ON DELETE SET NULL, so
    -- removing a shared award silently detached the other referents and left
    -- a second activity row showing points with no award behind it.
    IF EXISTS (
      SELECT 1 FROM plugin_data.csf_profile_activity_events AS sibling
      WHERE sibling.organization_id = p_organization_id
        AND sibling.credit_record_id = v_credit.id
        AND sibling.id <> v_event.id
    ) THEN
      RAISE EXCEPTION 'Another activity row shares these points. Remove that row first.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM plugin_data.csf_point_appeals AS appeal
      WHERE appeal.organization_id = p_organization_id
        AND appeal.credit_record_id = v_credit.id
    ) THEN
      RAISE EXCEPTION 'A point appeal refers to these points. Resolve the appeal first.';
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
      'requestFingerprint', v_request_fingerprint,
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

-- H2: mirror JavaScript's trim, which strips more than spaces. The parser
-- pre-trims, so this is not reachable through it, but any other writer of
-- meetings[].state reached a different verdict on the two sides.
CREATE OR REPLACE FUNCTION plugin_data.csf_meeting_attendance_value(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  WITH trimmed(value) AS (
    SELECT pg_catalog.lower(
      pg_catalog.btrim(
        coalesce(p_value, ''),
        E' \t\n\r\f\v\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'
      )
    )
  )
  SELECT CASE
    WHEN nullif((SELECT value FROM trimmed), '') IS NULL THEN 'unknown'
    WHEN (SELECT value FROM trimmed) = ANY (ARRAY[
      'x', 'yes', 'y', 'true', 'attended', 'present', 'complete', 'completed'
    ]) THEN 'attended'
    WHEN (SELECT value FROM trimmed) = ANY (ARRAY['excused', 'e'])
      THEN 'excused'
    WHEN (SELECT value FROM trimmed) = ANY (ARRAY[
      'missed', 'absent', 'no', 'n', 'false'
    ]) THEN 'missed'
    WHEN (SELECT value FROM trimmed) = ANY (ARRAY[
      'not required', 'not_required', 'n/a', 'na'
    ]) THEN 'not_required'
    -- An unrecognised mark is unknown, never attended.
    ELSE 'unknown'
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_meeting_attendance_value(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_meeting_attendance_value(text)
  TO postgres;

REVOKE ALL ON FUNCTION
  plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid, text[])
  TO service_role;
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

COMMENT ON FUNCTION plugin_data.csf_meeting_attendance_value(text) IS
  'Mirrors normalizeCsfMeetingAttendanceValue exactly, including its trim and that an unrecognised mark is unknown rather than attended.';

NOTIFY pgrst, 'reload schema';

COMMIT;
