-- Officer workbooks encode semester outcomes as presentation: a green fill
-- means requirements met even when activities carry no numeric points, red
-- means not met, yellow marks an exception that usually carries a note. The
-- interpreter (AI, server-side) turns that into per-row outcomes; this RPC is
-- the only way those outcomes reach a preview row.
--
-- Fail-closed boundaries:
--   * service_role only; browser roles cannot settle rows;
--   * only rows whose every error is the activity-points reconciliation
--     message may settle -- any other blocker keeps blocking;
--   * presentation evidence must exist on the row (persisted annotations or an
--     already-parsed All Reqs Met value); an unannotated row cannot be settled
--     by a model that never saw officer signal;
--   * settlement is recorded as a resolution with actor and reason, so the
--     audit trail names who accepted the interpretation and why.

CREATE OR REPLACE FUNCTION plugin_data.csf_apply_import_annotation_interpretation(
  p_organization_id uuid,
  p_row_id uuid,
  p_outcome text,
  p_reason text,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows;
  v_blocking_error text;
  v_has_evidence boolean;
  v_met boolean;
BEGIN
  IF p_outcome NOT IN ('met', 'exception_met', 'not_met') THEN
    RAISE EXCEPTION 'Annotation settlement outcome must be met, exception_met, or not_met.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 4 THEN
    RAISE EXCEPTION 'A settlement reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A settlement actor is required.';
  END IF;

  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows
  WHERE id = p_row_id
    AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import row not found.';
  END IF;

  IF v_row.resolution_status <> 'pending' THEN
    RETURN jsonb_build_object(
      'status', 'already_settled',
      'rowNumber', v_row.row_number
    );
  END IF;
  IF v_row.import_status NOT IN ('pending', 'error')
    OR v_row.commit_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'This row is no longer settleable.';
  END IF;

  -- Any error that is not the activity-points reconciliation message is a real
  -- blocker this settlement has no authority over.
  SELECT err INTO v_blocking_error
  FROM unnest(COALESCE(v_row.errors, ARRAY[]::text[])) AS err
  WHERE err NOT LIKE 'Activity values without explicit numeric points%'
  LIMIT 1;
  IF v_blocking_error IS NOT NULL THEN
    RAISE EXCEPTION 'Row % keeps a non-annotation blocker: %',
      v_row.row_number, v_blocking_error;
  END IF;

  v_has_evidence := coalesce(
    (
      jsonb_typeof(v_row.normalized_data -> 'annotations') = 'object'
        AND v_row.normalized_data -> 'annotations' <> '{}'::jsonb
    ),
    false
  ) OR coalesce(
    jsonb_typeof(
      v_row.normalized_data -> 'commitPayload' -> 'allRequirementsMet'
    ) = 'boolean',
    false
  );
  IF NOT v_has_evidence THEN
    RAISE EXCEPTION 'Row % carries no presentation evidence to settle from.',
      v_row.row_number;
  END IF;

  v_met := p_outcome IN ('met', 'exception_met');

  -- normalized_data is immutable evidence (csf_preserve_import_row_snapshot),
  -- so the outcome rides the mutable resolution columns; the commit path reads
  -- the annotation_* reason codes as the completion override.
  UPDATE plugin_data.csf_sheet_import_rows
  SET
    errors = ARRAY[]::text[],
    import_status = 'pending',
    resolution_status = 'resolved',
    resolution_reason_code = CASE p_outcome
      WHEN 'met' THEN 'annotation_met'
      WHEN 'exception_met' THEN 'annotation_exception_met'
      ELSE 'annotation_not_met'
    END,
    resolution_notes = btrim(p_reason),
    resolved_by = p_actor_user_id,
    resolved_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'status', 'settled',
    'rowNumber', v_row.row_number,
    'outcome', p_outcome,
    'allRequirementsMet', v_met
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(
  uuid, uuid, text, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(
  uuid, uuid, text, text, uuid
) FROM anon;
REVOKE ALL ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(
  uuid, uuid, text, text, uuid
) FROM authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(
  uuid, uuid, text, text, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(
  uuid, uuid, text, text, uuid
) IS
'Settle one CSF import preview row from officer presentation evidence (sheet fills and notes as interpreted server-side): records a resolved annotation_interpretation resolution with actor and reason, clears only the activity-points reconciliation error, and writes the met/not-met outcome into the commit payload. Service-role only; refuses rows with any other blocker, rows without persisted presentation evidence, and rows already settled or frozen by a commit attempt.';

-- The commit path honors an annotation settlement's outcome when the
-- immutable payload recorded no requirements boolean at preview time.
CREATE OR REPLACE FUNCTION plugin_data.csf_commit_import_row_for_attempt_identity_base(p_organization_id uuid, p_attempt_id uuid, p_import_row_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  c_payload_version constant text := 'csf-commit-payload/v1';
  c_allowed_keys constant text[] := ARRAY[
    'version', 'sourceType', 'identity', 'canonicalEmails',
    'applicationData', 'activities', 'meetings', 'allRequirementsMet'
  ];
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_payload jsonb;
  v_identity jsonb;
  v_emails jsonb;
  v_key text;
  v_result jsonb;
  v_source_type text;
  v_school text;
  v_personal text;
  v_norm_school text;
  v_norm_personal text;
  v_prior_correlation uuid;
  v_target uuid;
  v_basis text;
BEGIN
  v_attempt := plugin_data.csf_assert_active_import_commit_attempt(
    p_organization_id, p_attempt_id
  );

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;
  v_source_type := v_commit.source_type;

  SELECT * INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND import_row.job_id = v_commit.preview_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found for this commit.' USING ERRCODE = '23503';
  END IF;

  -- A lost response, not work to redo. The committed attempt and its correlation
  -- are reported separately from this observer's, so the two are never conflated.
  IF v_row.commit_attempt_id IS NOT NULL THEN
    SELECT prior.correlation_id INTO v_prior_correlation
    FROM plugin_data.csf_sheet_import_commit_attempts AS prior
    WHERE prior.id = v_row.commit_attempt_id;
    RETURN jsonb_build_object(
      'replayed', true,
      'importStatus', v_row.import_status,
      'profileId', v_row.matched_profile_id,
      'outcomeState', v_row.commit_outcome_state,
      'committedByAttemptId', v_row.commit_attempt_id,
      'committedByCorrelationId', v_prior_correlation,
      'observerAttemptId', p_attempt_id,
      'observerCorrelationId', v_attempt.correlation_id
    );
  END IF;

  IF v_row.import_status <> 'pending' THEN
    RAISE EXCEPTION 'This CSF import row is no longer ready to commit.' USING ERRCODE = '55000';
  END IF;
  IF v_row.commit_outcome_unresolved THEN
    RAISE EXCEPTION 'This CSF import row has an unresolved outcome and must be reconciled first.'
      USING ERRCODE = '23514';
  END IF;

  -- A live begin-intent belonging to *this* attempt is required. Committing without
  -- one would leave no durable trace that a write was attempted, which is precisely
  -- the state that cannot be recovered from.
  IF v_row.commit_outcome_state <> 'in_flight'
    OR v_row.commit_intent_attempt_id IS DISTINCT FROM p_attempt_id
    OR v_row.commit_intent_correlation_id IS DISTINCT FROM v_attempt.correlation_id
  THEN
    RAISE EXCEPTION
      'This CSF import row has no live write intent for this attempt; begin the row before committing it.'
      USING ERRCODE = '55000';
  END IF;

  -- The frozen decision must still describe this row. The freeze trigger already
  -- makes these columns write-once, so a mismatch here means the row's own evidence
  -- changed underneath an approved decision, not that the freeze was edited.
  IF v_row.commit_frozen_at IS NULL
    OR v_row.commit_frozen_by_job_id IS DISTINCT FROM v_commit.id
  THEN
    RAISE EXCEPTION
      'This CSF import row was not frozen by the commit this attempt belongs to.'
      USING ERRCODE = '23514';
  END IF;
  IF v_row.commit_frozen_row_hash IS DISTINCT FROM v_row.row_hash THEN
    RAISE EXCEPTION
      'This CSF import row no longer matches the digest that was reviewed. Run a fresh preview.'
      USING ERRCODE = '23514';
  END IF;
  IF v_row.commit_frozen_source_id IS DISTINCT FROM v_row.source_id THEN
    RAISE EXCEPTION
      'This CSF import row no longer names the source that was reviewed.'
      USING ERRCODE = '23514';
  END IF;
  IF v_row.commit_frozen_source_revision IS NOT NULL
    AND v_commit.source_content_hash IS DISTINCT FROM v_row.commit_frozen_source_revision
  THEN
    RAISE EXCEPTION
      'The source revision behind this import changed after it was reviewed. Run a fresh preview.'
      USING ERRCODE = '23514';
  END IF;

  -- Everything authoritative comes from the immutable preview row. The caller
  -- supplied only identifiers, so there is nothing here for it to forge; the
  -- payload itself lives inside `normalized_data`, which
  -- csf_preserve_import_row_snapshot already makes immutable.
  v_payload := v_row.normalized_data -> 'commitPayload';
  IF v_payload IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION
      'This preview row carries no commit payload. Run a fresh preview before importing.'
      USING ERRCODE = '23514';
  END IF;
  IF v_payload->>'version' IS DISTINCT FROM c_payload_version THEN
    RAISE EXCEPTION
      'This preview row uses an unsupported commit payload version. Run a fresh preview.'
      USING ERRCODE = '23514';
  END IF;
  IF v_payload->>'sourceType' IS DISTINCT FROM v_source_type THEN
    RAISE EXCEPTION
      'The commit payload disagrees with the source type of the import it belongs to.'
      USING ERRCODE = '23514';
  END IF;
  -- Closed shape: an unreviewed field cannot arrive by being added upstream.
  FOR v_key IN SELECT jsonb_object_keys(v_payload)
  LOOP
    IF NOT (v_key = ANY (c_allowed_keys)) THEN
      RAISE EXCEPTION 'The commit payload carries an unsupported field "%".', v_key
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- The exact allowlisted payload that was frozen, proved by digest rather than
  -- assumed. `normalized_data` is already immutable, so this is the belt to that
  -- brace: if either the immutability trigger or the freeze were ever weakened, this
  -- comparison is what still refuses to write a payload nobody reviewed.
  IF encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex')
    IS DISTINCT FROM v_row.commit_frozen_payload_hash
  THEN
    RAISE EXCEPTION
      'The commit payload for this row differs from the one that was reviewed. Run a fresh preview.'
      USING ERRCODE = '23514';
  END IF;

  v_identity := coalesce(v_payload -> 'identity', '{}'::jsonb);
  v_emails := coalesce(v_payload -> 'canonicalEmails', '{}'::jsonb);
  IF nullif(btrim(coalesce(v_identity->>'firstName', '')), '') IS NULL
    OR nullif(btrim(coalesce(v_identity->>'lastName', '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'The commit payload is missing a first or last name.' USING ERRCODE = '23514';
  END IF;
  IF v_row.source_id IS NULL OR v_row.cohort_id IS NULL THEN
    RAISE EXCEPTION 'The import row is missing its source or class.' USING ERRCODE = '23514';
  END IF;

  -- The frozen target is the only profile this row may touch.
  v_target := v_row.commit_target_profile_id;
  v_basis := coalesce(v_row.commit_resolution_snapshot->>'basis', 'unmatched');

  -- Canonical email safety, enforced here rather than trusted from the payload.
  -- An application's response and preferred-contact addresses are unverified form
  -- evidence: the legacy RPC matches profiles on the normalized pair and seeds new
  -- profiles from the plain pair, so passing them would make a typed-in address
  -- canonical identity for a student who never proved it.
  IF v_source_type = 'application_responses' THEN
    v_school := NULL;
    v_personal := NULL;
    v_norm_school := NULL;
    v_norm_personal := NULL;
  ELSE
    v_school := nullif(btrim(coalesce(v_emails->>'schoolEmail', '')), '');
    v_personal := nullif(btrim(coalesce(v_emails->>'personalEmail', '')), '');
    v_norm_school := nullif(btrim(coalesce(v_emails->>'normalizedSchoolEmail', '')), '');
    v_norm_personal := nullif(btrim(coalesce(v_emails->>'normalizedPersonalEmail', '')), '');
  END IF;

  IF v_source_type = 'application_responses' THEN
    IF v_row.term_id IS NULL THEN
      RAISE EXCEPTION 'The application row is missing its semester.' USING ERRCODE = '23514';
    END IF;

    -- An application never brings a member into being.
    --
    -- The legacy row RPC below still contains a name-only fallback that seeds a new
    -- profile when it is handed a null profile id, and reaching that branch is how an
    -- unverified form response could become canonical identity for a student who
    -- never proved it. It is unreachable from here by construction: a targetless
    -- application row is refused before the call, so the RPC is only ever entered
    -- with a nonnull, frozen, officer-approved target and takes its update path.
    --
    -- Roster and class-history imports are the two sources that may create a member,
    -- and they are deliberately left alone.
    IF v_target IS NULL THEN
      RAISE EXCEPTION
        'This application row has no reviewed CSF member to attach to. Resolve it to an existing member before importing.'
        USING ERRCODE = '23514';
    END IF;
    IF v_basis NOT IN ('officer_resolved', 'preview_exact_match') THEN
      RAISE EXCEPTION
        'This application row was not resolved to a reviewed CSF member.'
        USING ERRCODE = '23514';
    END IF;
    -- The frozen target must still be a live member of this organization. Locked,
    -- because the write below depends on it existing for the whole transaction.
    PERFORM 1
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = v_target
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'The CSF member this application was resolved to no longer exists.'
        USING ERRCODE = '23503';
    END IF;

    v_result := plugin_data.csf_import_application_response_row(
      p_organization_id, v_target,
      btrim(v_identity->>'firstName'), btrim(v_identity->>'lastName'),
      v_school, v_personal,
      btrim(coalesce(v_identity->>'normalizedFirstName', '')),
      btrim(coalesce(v_identity->>'normalizedLastName', '')),
      v_norm_school, v_norm_personal,
      v_row.cohort_id, v_row.term_id, v_row.source_id, p_import_row_id,
      v_row.commit_frozen_row_hash,
      coalesce(v_payload -> 'applicationData', '{}'::jsonb),
      v_row.commit_frozen_actor_user_id
    );
  ELSIF v_source_type = 'student_roster' THEN
    v_result := plugin_data.csf_import_student_roster_row(
      p_organization_id, v_target,
      btrim(v_identity->>'firstName'), btrim(v_identity->>'lastName'),
      v_school, v_personal,
      btrim(coalesce(v_identity->>'normalizedFirstName', '')),
      btrim(coalesce(v_identity->>'normalizedLastName', '')),
      v_norm_school, v_norm_personal,
      v_row.cohort_id, v_row.source_id, p_import_row_id,
      v_row.commit_frozen_row_hash, v_row.commit_frozen_actor_user_id
    );
  ELSIF v_source_type = 'class_history' THEN
    IF v_row.term_id IS NULL THEN
      RAISE EXCEPTION 'The class-history row is missing its semester.' USING ERRCODE = '23514';
    END IF;
    -- The requirements flag must be a JSON boolean, absent, or JSON null. Anything else
    -- is a malformed payload and is refused here rather than being coerced to "unknown"
    -- -- silently turning a garbled value into NULL would import a row whose
    -- requirements state nobody actually reviewed.
    IF v_payload ? 'allRequirementsMet'
      AND jsonb_typeof(v_payload -> 'allRequirementsMet') NOT IN ('boolean', 'null')
    THEN
      RAISE EXCEPTION
        'This preview row records a malformed requirements flag. Run a fresh preview.'
        USING ERRCODE = '23514';
    END IF;
    v_result := plugin_data.csf_import_class_history_row_v2(
      p_organization_id, v_target,
      btrim(v_identity->>'firstName'), btrim(v_identity->>'lastName'),
      v_school, v_personal,
      btrim(coalesce(v_identity->>'normalizedFirstName', '')),
      btrim(coalesce(v_identity->>'normalizedLastName', '')),
      v_norm_school, v_norm_personal,
      v_row.cohort_id, v_row.term_id, v_row.source_id, p_import_row_id,
      v_row.commit_frozen_row_hash,
      coalesce(v_payload -> 'activities', '[]'::jsonb),
      coalesce(v_payload -> 'meetings', '[]'::jsonb),
      -- Cast only what has already been proved to be a JSON boolean. Testing for
      -- `NULL`/`'null'` left every other shape -- a string, a number, an object -- going
      -- straight into `::boolean`, which raises invalid_text_representation from the
      -- middle of an authoritative write instead of refusing the payload.
      -- An annotation settlement (service-role RPC, evidence-gated) records
      -- its outcome in the mutable resolution columns because the payload is
      -- immutable. The settled outcome overrides the payload's null; a payload
      -- boolean set at preview time still wins over nothing.
      CASE
        WHEN v_row.resolution_reason_code = 'annotation_met'
          OR v_row.resolution_reason_code = 'annotation_exception_met'
          THEN true
        WHEN v_row.resolution_reason_code = 'annotation_not_met'
          THEN false
        WHEN jsonb_typeof(v_payload -> 'allRequirementsMet') = 'boolean'
          THEN (v_payload ->> 'allRequirementsMet')::boolean
        ELSE NULL
      END,
      v_row.commit_frozen_actor_user_id
    );
  ELSE
    RAISE EXCEPTION
      'This CSF source type is committed from its contextual workflow, not through a commit attempt.'
      USING ERRCODE = '23514';
  END IF;

  -- Same transaction as the authoritative write above. The intent that authorized
  -- this write is settled here, so the row can never be left recorded in flight
  -- after a successful commit.
  UPDATE plugin_data.csf_sheet_import_rows
  SET commit_attempt_id = p_attempt_id,
      commit_outcome_state = 'succeeded',
      commit_outcome_code = NULL,
      commit_outcome_note = NULL
  WHERE organization_id = p_organization_id
    AND id = p_import_row_id;

  -- Shared correlation in the real indexed column, not only in after_data, and the
  -- frozen logical actor rather than whoever happened to run this attempt.
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    term_id, correlation_id, source_type, source_id, after_data
  ) VALUES (
    p_organization_id, v_row.commit_frozen_actor_user_id, 'sheet_import.row_committed',
    'csf_sheet_import_rows', p_import_row_id, v_row.term_id,
    v_attempt.correlation_id, 'sheet_import', v_row.source_id::text,
    jsonb_build_object(
      'commitJobId', v_commit.id,
      'commitAttemptId', p_attempt_id,
      'attemptNumber', v_attempt.attempt_number,
      'sourceType', v_source_type,
      'resolutionBasis', v_basis,
      'targetProfileId', v_target,
      'importStatus', coalesce(v_result->>'importStatus', 'updated')
    )
  );

  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'replayed', false,
    'outcomeState', 'succeeded',
    'resolutionBasis', v_basis,
    'commitAttemptId', p_attempt_id,
    'correlationId', v_attempt.correlation_id
  );
END;
$function$


;
