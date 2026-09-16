-- Fixes from the independent review of this stack. Each is named by its
-- finding id so the review and the code stay tied together.
--
--   C4  A row leaving a closed semester is a change to closed evidence even
--       when it lands in an open one. Only the destination term was read, so
--       an event with no credit record moved out of a closed semester
--       silently, and the guarded case was a dead end because ticking the
--       acknowledgement changed nothing.
--   C5  An attested merge could not replay, and its replay path bound only
--       the identifier rather than the payload. It re-read the live preview
--       before looking for a receipt, and after a successful merge the source
--       is 'merged', so a retry of the same request raised rather than
--       returning what the first call did.
--   C6  csf_resolve_profile_link_request consumes the same relaxed connect
--       evidence as the direct officer connection but never superseded the
--       competing pending claims that evidence now reports as context, so
--       resolving through the queue left rivals live and unaudited. The
--       supersede is now one function both paths call.
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
  v_attestation plugin_data.csf_admin_audit_events%ROWTYPE;
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
  SELECT attestation.* INTO v_attestation
  FROM plugin_data.csf_admin_audit_events AS attestation
  WHERE attestation.organization_id = p_organization_id
    AND attestation.correlation_id = p_request_id
    AND attestation.action = 'profile.merge_identity_attested'
  LIMIT 1;
  IF FOUND THEN
    -- The receipt has to describe THIS merge, not merely this request id.
    -- Every argument the attestation recorded is compared, the reason
    -- included: replaying a different intent under the same identifier is the
    -- defect C7 fixed on the activity editor, and it is reachable here too.
    IF v_attestation.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_attestation.target_id IS DISTINCT FROM p_target_profile_id
      OR v_attestation.after_data ->> 'sourceProfileId'
        IS DISTINCT FROM p_source_profile_id::text
      OR v_attestation.after_data -> 'attestedConflicts'
        IS DISTINCT FROM pg_catalog.to_jsonb(v_attested)
      OR v_attestation.after_data ->> 'reason'
        IS DISTINCT FROM nullif(pg_catalog.btrim(coalesce(p_reason, '')), '')
      THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That request identifier is already bound to a different change.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
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

-- C6: the supersede both officer decision paths share.
--
-- A pending row is an unreviewed claim on this account or this record, and an
-- officer decision IS that review. csf_staff_connect_profile_account closed
-- those claims and recorded each one; csf_resolve_profile_link_request, which
-- reads the same relaxed evidence, did not, so resolving through the claims
-- queue left competing claims live, unaudited and still available to be
-- verified later. Neither path touches a VERIFIED connection: both still
-- require that to be unlinked first.
CREATE OR REPLACE FUNCTION plugin_data.csf_supersede_competing_profile_claims(
  p_organization_id uuid,
  p_profile_id uuid,
  p_user_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_competing plugin_data.csf_profile_accounts%ROWTYPE;
  v_superseded_row plugin_data.csf_profile_accounts%ROWTYPE;
  v_superseded jsonb := '[]'::jsonb;
BEGIN
  IF p_user_id IS NULL OR p_profile_id IS NULL THEN
    RETURN v_superseded;
  END IF;
  FOR v_competing IN SELECT * FROM plugin_data.csf_profile_accounts
    WHERE organization_id = p_organization_id AND status = 'pending'
      AND ((user_id = p_user_id AND profile_id <> p_profile_id)
        OR (profile_id = p_profile_id AND user_id <> p_user_id))
    ORDER BY id FOR UPDATE
  LOOP
    UPDATE plugin_data.csf_profile_accounts
    SET status = 'rejected', is_primary = false,
      revoked_at = pg_catalog.now(), notes = p_reason
    WHERE organization_id = p_organization_id AND id = v_competing.id
    RETURNING * INTO v_superseded_row;
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, actor_profile_id, action, target_type,
      target_id, before_data, after_data, correlation_id, reason_code
    ) VALUES (
      p_organization_id, p_actor_user_id, NULL,
      'profile.account_connection_superseded', 'csf_profile_accounts',
      v_competing.id, pg_catalog.to_jsonb(v_competing),
      pg_catalog.to_jsonb(v_superseded_row), p_correlation_id,
      'staff_verified_identity'
    );
    v_superseded := v_superseded || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'accountConnectionId', v_competing.id,
        'profileId', v_competing.profile_id
      )
    );
  END LOOP;
  RETURN v_superseded;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_supersede_competing_profile_claims(
  uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_supersede_competing_profile_claims(
  uuid, uuid, uuid, text, uuid, uuid
) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_staff_connect_profile_account(
  p_organization_id uuid, p_profile_id uuid, p_actor_user_id uuid,
  p_account_email text, p_reason text, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_email text := plugin_data.csf_normalize_email_text(p_account_email);
  v_reason text := nullif(btrim(p_reason),'');
  v_user_id uuid;
  v_account_id uuid;
  v_cohort_id uuid;
  v_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_link_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_resolved_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_superseded jsonb := '[]'::jsonb;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles') THEN
    RAISE EXCEPTION 'Not authorized to connect CSF accounts.' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR v_email IS NULL OR v_reason IS NULL OR length(v_reason)<8 OR length(v_reason)>500 THEN
    RAISE EXCEPTION 'Enter the account email and an identity verification reason of 8 to 500 characters.';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles') THEN
    RAISE EXCEPTION 'Not authorized to connect CSF accounts.' USING ERRCODE='42501';
  END IF;
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT * INTO v_audit FROM plugin_data.csf_admin_audit_events
    WHERE organization_id=p_organization_id AND correlation_id=p_request_id
      AND action='profile.account_connected_by_staff' LIMIT 1;
  IF FOUND THEN
    IF v_audit.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_audit.after_data->>'profileId' IS DISTINCT FROM p_profile_id::text
      OR v_audit.after_data->>'emailDigest' IS DISTINCT FROM md5(v_email)
      OR v_audit.after_data->>'reason' IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'This request ID was already used for a different connection.';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_profile_accounts
      WHERE organization_id=p_organization_id AND id=v_audit.target_id AND profile_id=p_profile_id AND status='verified') THEN
      RAISE EXCEPTION 'This account connection has changed. Reload before continuing.';
    END IF;
    RETURN jsonb_build_object('accountId',v_audit.target_id,'profileId',p_profile_id,'replayed',true,
      'supersededConnections','[]'::jsonb);
  END IF;
  PERFORM 1 FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id AND id=p_profile_id AND record_status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active CSF profile in this organization.'; END IF;
  IF (SELECT count(*) FROM plugin_data.csf_profile_cohort_memberships m
    JOIN plugin_data.csf_cohorts c ON c.organization_id=m.organization_id AND c.id=m.cohort_id AND c.status='active'
    WHERE m.organization_id=p_organization_id AND m.profile_id=p_profile_id AND m.status='active')<>1 THEN
    RAISE EXCEPTION 'The CSF profile must have one active class.';
  END IF;
  SELECT m.cohort_id INTO v_cohort_id FROM plugin_data.csf_profile_cohort_memberships m
    JOIN plugin_data.csf_cohorts c ON c.organization_id=m.organization_id AND c.id=m.cohort_id AND c.status='active'
    WHERE m.organization_id=p_organization_id AND m.profile_id=p_profile_id AND m.status='active';
  IF (SELECT count(*) FROM auth.users u JOIN public.organization_members m ON m.user_id=u.id AND m.organization_id=p_organization_id AND m.status='active' WHERE lower(btrim(u.email))=v_email AND u.email_confirmed_at IS NOT NULL)<>1 THEN
    RAISE EXCEPTION 'Exactly one active organization member must have that confirmed login email.';
  END IF;
  BEGIN
  SELECT u.id INTO STRICT v_user_id FROM auth.users u
    JOIN public.organization_members m ON m.user_id=u.id AND m.organization_id=p_organization_id AND m.status='active'
    WHERE lower(btrim(u.email))=v_email AND u.email_confirmed_at IS NOT NULL
    FOR SHARE OF u,m;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'Exactly one active organization member must have that confirmed login email.';
  END;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active organization member has that confirmed login email. Ask them to join the organization first.'; END IF;
  IF EXISTS(SELECT 1 FROM plugin_data.csf_profile_accounts WHERE organization_id=p_organization_id AND user_id=v_user_id AND status='verified') THEN
    RAISE EXCEPTION 'This account is already connected. Unlink the incorrect connection before moving it.';
  END IF;
  IF EXISTS(SELECT 1 FROM plugin_data.csf_profile_accounts WHERE organization_id=p_organization_id AND profile_id=p_profile_id AND status='verified') THEN
    RAISE EXCEPTION 'This CSF profile already has a connected account. Review it before replacing it.';
  END IF;
  -- C6: one supersede, called from both decision paths. The claims path used
  -- to consume the same relaxed evidence and leave every competing pending
  -- claim live and unaudited, so the migration header's promise held for one
  -- entrypoint and not the other.
  v_superseded := plugin_data.csf_supersede_competing_profile_claims(
    p_organization_id, p_profile_id, v_user_id, v_reason, p_actor_user_id,
    p_request_id
  );
  INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status,is_primary,linked_by,linked_at,notes,connection_basis)
    VALUES(p_organization_id,p_profile_id,v_user_id,'verified',true,p_actor_user_id,now(),v_reason,'officer_decision')
    ON CONFLICT(organization_id,profile_id,user_id) DO UPDATE SET
      status='verified',is_primary=true,linked_by=excluded.linked_by,linked_at=excluded.linked_at,revoked_at=NULL,notes=excluded.notes,connection_basis='officer_decision'
    RETURNING id INTO v_account_id;
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,actor_profile_id,action,target_type,target_id,before_data,after_data,correlation_id,reason_code)
    VALUES(p_organization_id,p_actor_user_id,NULL,'profile.account_connected_by_staff','csf_profile_accounts',v_account_id,'{}',
      jsonb_build_object('profileId',p_profile_id,'userId',v_user_id,'cohortId',v_cohort_id,'emailDigest',md5(v_email),'reason',v_reason,'connectionBasis','officer_decision'),p_request_id,'staff_verified_identity');
  FOR v_link_request IN SELECT * FROM plugin_data.csf_profile_link_requests
    WHERE organization_id=p_organization_id AND user_id=v_user_id AND cohort_id=v_cohort_id
      AND match_status IN('pending','needs_review') ORDER BY id FOR UPDATE
  LOOP
    UPDATE plugin_data.csf_profile_link_requests SET match_status='resolved',matched_profile_id=p_profile_id,
      resolved_by=p_actor_user_id,resolved_at=now(),resolution_notes=v_reason
      WHERE organization_id=p_organization_id AND id=v_link_request.id
      RETURNING * INTO v_resolved_request;
    INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,actor_profile_id,
      action,target_type,target_id,before_data,after_data,correlation_id,reason_code)
      VALUES(p_organization_id,p_actor_user_id,NULL,'profile.link_request_resolved_by_staff',
        'csf_profile_link_requests',v_link_request.id,to_jsonb(v_link_request),
        to_jsonb(v_resolved_request),p_request_id,'staff_verified_identity');
  END LOOP;
  RETURN jsonb_build_object('accountId',v_account_id,'profileId',p_profile_id,'replayed',false,
    'supersededConnections',v_superseded);
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_resolve_profile_link_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_profile_id uuid,
  p_decision text,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_evidence jsonb;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_result jsonb;
  v_original_correlation_id uuid;
  v_original_membership_granted boolean := false;
  v_superseded jsonb := '[]'::jsonb;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to resolve CSF profile connections.';
  END IF;

  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  IF p_decision IS DISTINCT FROM 'connect' THEN
    RETURN plugin_data.csf_resolve_profile_link_request_corroboration_base(
      p_organization_id, p_request_id, p_profile_id, p_decision, p_reason,
      p_actor_user_id
    );
  END IF;

  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) < 4 THEN
    RAISE EXCEPTION 'A reason of at least four characters is required.';
  END IF;

  SELECT request.*
  INTO v_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This connection request has already been resolved.';
  END IF;

  IF v_request.match_status NOT IN ('pending', 'needs_review') THEN
    IF v_request.match_status = 'resolved'
      AND v_request.matched_profile_id IS NOT DISTINCT FROM p_profile_id
      AND v_request.resolved_by IS NOT DISTINCT FROM p_actor_user_id
      AND nullif(pg_catalog.btrim(v_request.resolution_notes), '') IS NOT DISTINCT FROM v_reason
      AND EXISTS (
        SELECT 1 FROM plugin_data.csf_profiles AS profile
        WHERE profile.organization_id = p_organization_id
          AND profile.id = p_profile_id AND profile.record_status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.profile_id = p_profile_id
          AND account.user_id = v_request.user_id
          AND account.status = 'verified'
      )
      AND EXISTS (
        SELECT 1 FROM public.organization_members AS member
        WHERE member.organization_id = p_organization_id
          AND member.user_id = v_request.user_id AND member.status = 'active'
      )
      AND (
        SELECT pg_catalog.count(*) = 1
          AND (pg_catalog.array_agg(membership.cohort_id ORDER BY membership.cohort_id))[1]
            IS NOT DISTINCT FROM v_request.cohort_id
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = p_profile_id
          AND membership.status = 'active'
      )
    THEN
      SELECT audit.correlation_id,
        coalesce((audit.after_data->>'membershipGranted')::boolean, false)
      INTO v_original_correlation_id, v_original_membership_granted
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.actor_user_id = p_actor_user_id
        AND audit.action = 'profile.link_request_resolved'
        AND audit.target_type = 'csf_profile_link_requests'
        AND audit.target_id = p_request_id
        AND audit.after_data->>'decision' = 'connect'
        AND audit.after_data->>'profileId' = p_profile_id::text
        AND audit.after_data->>'reason' = v_reason
      ORDER BY audit.created_at DESC
      LIMIT 1;
      IF v_original_correlation_id IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
          'requestId', p_request_id, 'decision', 'connect',
          'profileId', p_profile_id,
          'membershipGranted', v_original_membership_granted,
          'correlationId', v_original_correlation_id,
          'idempotentReplay', true
        );
      END IF;
    END IF;
    RAISE EXCEPTION 'This connection request has already been resolved.';
  END IF;

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Choose the student record to connect.';
  END IF;
  IF v_request.user_id IS NULL THEN
    RAISE EXCEPTION 'The student account is no longer available.';
  END IF;

  PERFORM 1
  FROM auth.users AS account
  WHERE account.id = v_request.user_id
  FOR SHARE;

  v_evidence := plugin_data.csf_profile_link_connect_evidence(
    p_organization_id, p_request_id, p_profile_id
  );
  IF NOT coalesce((v_evidence->>'canConnect')::boolean, false) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'This CSF account connection is not supported by corroborating identity evidence.',
      DETAIL = (v_evidence->'blockers')::text,
      HINT = 'Record the account''s confirmed email on the correct student profile, or reject this request and invite the student directly.';
  END IF;

  v_result := plugin_data.csf_resolve_profile_link_request_corroboration_base(
    p_organization_id, p_request_id, p_profile_id, p_decision, p_reason,
    p_actor_user_id
  );

  -- C6: this path reads the same relaxed connect evidence as the direct
  -- officer connection, which reports a competing pending claim as context
  -- rather than refusing. The direct path then closes those claims; this one
  -- did not, so resolving through the queue left rivals live, unaudited and
  -- available to be verified later. Superseded only once a verified
  -- connection actually exists, so a rejection closes nothing.
  IF EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts AS connected
    WHERE connected.organization_id = p_organization_id
      AND connected.profile_id = p_profile_id
      AND connected.user_id = v_request.user_id
      AND connected.status = 'verified'
  ) THEN
    v_superseded := plugin_data.csf_supersede_competing_profile_claims(
      p_organization_id, p_profile_id, v_request.user_id, v_reason,
      p_actor_user_id, (v_result->>'correlationId')::uuid
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id,
    'profile.link_request_identity_evidence', 'csf_profile_link_requests',
    p_request_id, v_request.term_id, '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'profileId', p_profile_id,
      'corroboration', v_evidence->'corroboration',
      'exactEmailOverlap', v_evidence->'evidence'->'exactEmailOverlap',
      'exactEmailUnique', v_evidence->'evidence'->'exactEmailUnique',
      'confirmedEmailMatchesRequestSnapshot',
        v_evidence->'evidence'->'confirmedEmailMatchesRequestSnapshot',
      'exactNameMatch', v_evidence->'evidence'->'exactNameMatch',
      'profileInRequestCohort', v_evidence->'evidence'->'profileInRequestCohort',
      'activeProfileCohortCount',
        v_evidence->'evidence'->'activeProfileCohortCount'
    ),
    (v_result->>'correlationId')::uuid, 'staff_action', p_request_id::text,
    'profile_connection_identity_corroborated'
  );

  RETURN v_result || pg_catalog.jsonb_build_object('idempotentReplay', false) || pg_catalog.jsonb_build_object(
    'supersededConnections', v_superseded
  );
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

REVOKE ALL ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_supersede_competing_profile_claims(uuid,uuid,uuid,text,uuid,uuid) IS
  'Closes and records the pending claims an officer decision reviews. Called by both the direct connection and the claims-queue resolution so the two cannot drift.';

NOTIFY pgrst, 'reload schema';

COMMIT;
