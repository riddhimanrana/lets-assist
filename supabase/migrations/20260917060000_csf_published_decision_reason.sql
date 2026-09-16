-- A red rejection published an explanation the chapter never wrote, and a
-- reason-only correction never reached the applicant at all.
--
-- csf_publish_sheet_application_decision has to hand
-- csf_decide_term_application_policy_base a non-empty note, because the base
-- refuses a rejection with none. It passed
-- 'Rejected in the chapter application review Sheet.', and the base writes its
-- note to decision_reason as well as review_notes. The direct active-member
-- revocation branch wrote the same sentence. The member surface renders
-- decision_reason as the chapter's explanation, so an unexplained red mark told
-- the applicant they had been given a reason they had not.
--
-- The fallback stays where it is accurate: review_notes, the membership
-- status_reason and the receipts keep describing what happened. The published
-- decision_reason is the normalized Sheet reason and nothing else, NULL when
-- the Sheet carried none.
--
-- Fixing the primitive alone would have changed nothing for the case that
-- reported it. csf_stage_sheet_application_decisions decides whether an
-- already-released row is republished, and will_apply compared only the
-- normalized decision against previous_released_decision. A yellow that loses
-- its explanation and a red that gains one both normalize to 'rejected', so
-- yellow -> red, red -> yellow and an edit to a yellow reason all planned as no
-- publish at all. The plan now carries previous_released_reason and will_apply
-- compares it, null-safe, against the staged reason.
--
-- Widening what republishes widens what must be held. The closed-term and
-- finalized-membership gates now trip on a reason-only move as well, so a
-- correction against a finished semester is reported as a conflict instead of
-- reaching a primitive that would raise. An unchanged row still plans nothing:
-- a repeated identical sync leaves outcome 'unchanged', which will_apply
-- requires not to be.
--
-- Both functions are restated verbatim from their current definitions,
-- 20260917030000 for the primitive and 20260917050000 for the sync, with only
-- those edits, and their REVOKE/GRANT and COMMENT restated unchanged. The
-- TRUNCATE resets and the qualified plan UPDATE from 20260917040000 and
-- 20260917050000 are carried through untouched, as are the authorization,
-- locking, provenance and retry paths.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_publish_sheet_application_decision(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_reason text,
  p_actor_user_id uuid,
  p_basis jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_previous_status text;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_correlation_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
  v_membership_status text;
  v_reason_code plugin_data.csf_application_reason_code;
BEGIN
  IF p_decision NOT IN ('accepted', 'rejected', 'unreviewed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = pg_catalog.format('Unsupported released Sheet decision: %s', p_decision);
  END IF;

  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found', MESSAGE = 'CSF application not found.';
  END IF;

  v_previous_status := v_application.status;

  SELECT membership.*
  INTO v_membership
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_application.profile_id
    AND membership.term_id = v_application.term_id
  FOR UPDATE;

  -- Every verdict, not only a rejection. A green mark on a student whose
  -- semester already finished would republish an acceptance over that outcome,
  -- and `not_completed` is the sharper case: someone who did not meet the
  -- requirements would be flipped back to accepted and active. A finalized
  -- outcome is the chapter's published record either way.
  IF v_membership.status IN ('completed', 'not_completed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A finalized term membership keeps its published outcome.',
      DETAIL = 'CSF_RELEASE_BLOCKER=historical_outcome';
  END IF;

  IF p_decision = 'accepted' THEN
    PERFORM plugin_data.csf_decide_term_application_policy_base(
      p_organization_id, p_application_id, 'accepted',
      coalesce(v_reason, 'Accepted in the chapter application review Sheet.'),
      p_actor_user_id
    );
    v_reason_code := 'approved_sheet_review'::plugin_data.csf_application_reason_code;

  ELSIF p_decision = 'rejected' AND v_membership.status IS DISTINCT FROM 'active' THEN
    PERFORM plugin_data.csf_decide_term_application_policy_base(
      p_organization_id, p_application_id, 'rejected',
      coalesce(v_reason, 'Rejected in the chapter application review Sheet.'),
      p_actor_user_id
    );
    v_reason_code := 'rejected_sheet_review'::plugin_data.csf_application_reason_code;

  ELSIF p_decision = 'rejected' THEN
    -- The base refuses to reject an active member. Here that is the point: the
    -- officer changed a published verdict and access has to follow. Earned
    -- points, proofs, and attendance stay untouched; only the term membership
    -- is revoked.
    UPDATE plugin_data.csf_term_applications
    SET
      status = 'rejected',
      submission_status = 'decided'::plugin_data.csf_application_submission_status,
      decision_status = 'rejected'::plugin_data.csf_application_decision_status,
      decision_reason_code = 'rejected_sheet_review'::plugin_data.csf_application_reason_code,
      decision_reason = coalesce(v_reason, 'Rejected in the chapter application review Sheet.'),
      decision_correlation_id = v_correlation_id,
      reviewed_by = p_actor_user_id,
      reviewed_at = v_now,
      review_notes = coalesce(v_reason, 'Rejected in the chapter application review Sheet.'),
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = p_application_id;

    UPDATE plugin_data.csf_term_memberships
    SET
      status = 'revoked',
      status_reason = coalesce(v_reason, 'Rejected in the chapter application review Sheet.'),
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND profile_id = v_application.profile_id
      AND term_id = v_application.term_id;

    INSERT INTO plugin_data.csf_application_status_events (
      organization_id, application_id, actor_user_id, previous_status,
      next_status, reason, reason_code, correlation_id, details
    )
    VALUES (
      p_organization_id, p_application_id, p_actor_user_id, v_previous_status,
      'rejected', v_reason, 'rejected_sheet_review'::plugin_data.csf_application_reason_code,
      v_correlation_id,
      pg_catalog.jsonb_build_object(
        'basis', 'sheet_review',
        'previousMembershipStatus', v_membership.status,
        'termMembershipStatus', 'revoked'
      )
    );
    v_reason_code := 'rejected_sheet_review'::plugin_data.csf_application_reason_code;

  ELSE
    -- Uncolored after publication. The chapter's instruction is that access
    -- follows the sheet immediately: the published outcome is retracted and the
    -- applicant presents as unreviewed again.
    UPDATE plugin_data.csf_term_applications
    SET
      status = 'needs_review',
      submission_status = 'ready'::plugin_data.csf_application_submission_status,
      decision_status = 'pending'::plugin_data.csf_application_decision_status,
      decision_reason_code = NULL,
      decision_reason = NULL,
      decision_correlation_id = v_correlation_id,
      reviewed_by = p_actor_user_id,
      reviewed_at = v_now,
      review_notes = 'The review Sheet row is no longer marked, so the published decision was withdrawn.',
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = p_application_id;

    UPDATE plugin_data.csf_term_memberships
    SET
      status = 'revoked',
      status_reason = 'The review Sheet row is no longer marked, so the published decision was withdrawn.',
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND profile_id = v_application.profile_id
      AND term_id = v_application.term_id
      AND status IN ('pending', 'accepted', 'active');

    INSERT INTO plugin_data.csf_application_status_events (
      organization_id, application_id, actor_user_id, previous_status,
      next_status, reason, correlation_id, details
    )
    VALUES (
      p_organization_id, p_application_id, p_actor_user_id, v_previous_status,
      'needs_review',
      'The review Sheet row is no longer marked, so the published decision was withdrawn.',
      v_correlation_id,
      pg_catalog.jsonb_build_object(
        'basis', 'sheet_review_retraction',
        'previousMembershipStatus', v_membership.status
      )
    );
    v_reason_code := NULL;
  END IF;

  -- The base stamps `approved_standard`/`approved_adviser_override`, which
  -- would read as "the in-product academic path cleared this applicant". It
  -- did not: an officer decided in the Sheet.
  --
  -- The published reason is settled here too. Every branch above hands the base
  -- or the direct write a fallback sentence, because the base refuses a
  -- rejection with no notes. That sentence is a workflow note: it belongs in
  -- review_notes and the receipts, not in the field the member reads as the
  -- chapter's explanation. A red mark carries no explanation, so it publishes
  -- none.
  IF v_reason_code IS NOT NULL THEN
    UPDATE plugin_data.csf_term_applications
    SET
      decision_reason_code = v_reason_code,
      decision_reason = v_reason
    WHERE organization_id = p_organization_id
      AND id = p_application_id;
  END IF;

  SELECT membership.status
  INTO v_membership_status
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_application.profile_id
    AND membership.term_id = v_application.term_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  )
  VALUES (
    p_organization_id, p_actor_user_id,
    'application.sheet_review_' || CASE p_decision
      WHEN 'accepted' THEN 'accepted'
      WHEN 'rejected' THEN 'rejected'
      ELSE 'retracted'
    END,
    'csf_term_applications', p_application_id, v_application.term_id,
    pg_catalog.jsonb_build_object(
      'legacyStatus', v_previous_status,
      'decisionStatus', v_application.decision_status,
      'termMembershipStatus', v_membership.status
    ),
    pg_catalog.jsonb_build_object(
      -- Named explicitly so no reader mistakes this for computed eligibility.
      'decisionBasis', 'officer_external_sheet_review',
      'academicPreflightEvaluated', false,
      'eligibilityStatus', v_application.eligibility_status,
      'decision', p_decision,
      'reason', v_reason,
      'termMembershipStatus', v_membership_status,
      'source', coalesce(p_basis, '{}'::jsonb)
    ),
    v_correlation_id, 'sheet_application_review', p_application_id::text,
    CASE WHEN v_reason_code IS NULL THEN NULL ELSE v_reason_code::text END
  );

  RETURN pg_catalog.jsonb_build_object(
    'applicationId', p_application_id,
    'decision', p_decision,
    'termMembershipStatus', v_membership_status,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_stage_sheet_application_decisions(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_term_id uuid,
  p_run_id uuid,
  p_evidence jsonb,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_existing plugin_data.csf_application_decision_sync_runs%ROWTYPE;
  v_run_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_term_closed boolean;
  v_plan record;
  v_published text;
  v_fingerprint text;
BEGIN
  PERFORM plugin_data.csf_assert_sheet_decision_authority(
    p_organization_id, p_actor_user_id, 'manage_sheet_sync',
    'Not authorized to sync CSF application decisions.'
  );

  IF p_run_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A stable decision-sync run identifier is required.';
  END IF;
  IF pg_catalog.jsonb_typeof(coalesce(p_evidence, 'null'::jsonb)) <> 'array'
    OR pg_catalog.jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Decision sync evidence and rows must both be JSON arrays.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_decision_sync_request:'
        || p_organization_id::text || ':' || p_run_id::text,
      0
    )
  );

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'termId', p_term_id, 'evidence', p_evidence, 'rows', p_rows
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT run.* INTO v_existing
  FROM plugin_data.csf_application_decision_sync_runs AS run
  WHERE run.organization_id = p_organization_id
    AND run.request_id = p_run_id;
  IF FOUND THEN
    -- A replay is the same request asked again. The same id pointed at another
    -- term or another payload must never hand back this receipt.
    IF v_existing.term_id IS DISTINCT FROM p_term_id
      OR v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That decision-sync run identifier is already bound to a different read.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
    RETURN plugin_data.csf_sheet_application_decision_run_receipt(
      p_organization_id, v_existing.id
    ) || pg_catalog.jsonb_build_object('replay', true);
  END IF;

  -- Serialize against a concurrent release of the same term.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_sheet_decision_term_lock_key(p_organization_id, p_term_id)
  );

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found', MESSAGE = 'CSF term not found.';
  END IF;
  IF v_term.application_review_source <> 'sheet' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This term does not review applications in a Sheet.',
      DETAIL = 'CSF_SHEET_REVIEW_MODE=not_enabled',
      HINT = 'Turn on Sheets review for the term before syncing decisions.';
  END IF;
  v_term_closed := v_term.lifecycle_status IN ('closed', 'archived');

  -- -------------------------------------------------------------------------
  -- Pass 1: resolve, verifying every claim against recorded provenance.
  -- Nothing is written until the whole plan is known, because the run receipt
  -- is immutable and must be inserted with its final counts.
  -- -------------------------------------------------------------------------

  CREATE TEMP TABLE IF NOT EXISTS csf_decision_source_plan (
    ordinal integer,
    source_id uuid,
    sheet_tab_name text,
    read_status text,
    message text,
    spreadsheet_file_id text,
    spreadsheet_title text,
    provider_version text,
    sheet_tab_id bigint,
    requested_range text,
    content_hash text,
    mapping_version text,
    decision_columns integer[],
    reason_columns integer[],
    read_at timestamptz,
    source_verified boolean,
    mapping_current boolean
  ) ON COMMIT DROP;
  TRUNCATE TABLE pg_temp.csf_decision_source_plan;

  INSERT INTO pg_temp.csf_decision_source_plan
  SELECT
    entry.ordinality::integer,
    (entry.value ->> 'sourceId')::uuid,
    entry.value ->> 'sheetTabName',
    coalesce(entry.value ->> 'readStatus', 'read'),
    nullif(pg_catalog.btrim(coalesce(entry.value ->> 'message', '')), ''),
    entry.value ->> 'spreadsheetFileId',
    entry.value ->> 'spreadsheetTitle',
    entry.value ->> 'providerVersion',
    (entry.value ->> 'sheetTabId')::bigint,
    coalesce(entry.value ->> 'requestedRange', ''),
    entry.value ->> 'contentHash',
    entry.value ->> 'mappingVersion',
    coalesce(
      (
        SELECT pg_catalog.array_agg(column_number::integer ORDER BY column_number::integer)
        FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(entry.value -> 'decisionColumns') = 'array'
            THEN entry.value -> 'decisionColumns' ELSE '[]'::jsonb END
        ) AS column_number
      ),
      ARRAY[]::integer[]
    ),
    coalesce(
      (
        SELECT pg_catalog.array_agg(column_number::integer ORDER BY column_number::integer)
        FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(entry.value -> 'reasonColumns') = 'array'
            THEN entry.value -> 'reasonColumns' ELSE '[]'::jsonb END
        ) AS column_number
      ),
      ARRAY[]::integer[]
    ),
    coalesce((entry.value ->> 'readAt')::timestamptz, v_now),
    -- The source has to be a real application-responses source in this tenant,
    -- and the file the sync says it read has to be the file that source names.
    EXISTS (
      SELECT 1
      FROM plugin_data.csf_sheet_sources AS source
      WHERE source.id = (entry.value ->> 'sourceId')::uuid
        AND source.organization_id = p_organization_id
        AND source.source_type = 'application_responses'
        AND (entry.value ->> 'spreadsheetFileId') IS NOT NULL
        AND (entry.value ->> 'spreadsheetFileId') IN (
          coalesce(source.drive_file_id, ''), coalesce(source.spreadsheet_id, '')
        )
    ),
    -- The mapping may have moved between the read and this commit. An
    -- unconfigured source has no mapping to be current against, and a source
    -- the sync could not read carries no rows either way.
    coalesce(entry.value ->> 'readStatus', 'read') <> 'read'
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_application_decision_mappings AS mapping
      WHERE mapping.organization_id = p_organization_id
        AND mapping.source_id = (entry.value ->> 'sourceId')::uuid
        AND mapping.mapping_version::text = (entry.value ->> 'mappingVersion')
    )
  FROM pg_catalog.jsonb_array_elements(p_evidence) WITH ORDINALITY AS entry(value, ordinality);

  CREATE TEMP TABLE IF NOT EXISTS csf_decision_row_plan (
    ordinal integer,
    source_ordinal integer,
    source_id uuid,
    sheet_tab_name text,
    observed_row_number integer,
    match_basis text,
    identity_digest text,
    decision_digest text,
    application_id uuid,
    import_row_id uuid,
    profile_id uuid,
    decision text,
    observed_color text,
    reason text,
    caller_block_reason text,
    provenance_verified boolean,
    mapping_current boolean,
    duplicate_in_batch boolean,
    previous_decision text,
    previous_reason text,
    previous_release_state text,
    previous_released_decision text,
    previous_released_reason text,
    previous_source_id uuid,
    membership_status text,
    outcome text,
    block_reason text,
    will_apply boolean,
    will_retract boolean,
    evidence jsonb
  ) ON COMMIT DROP;
  TRUNCATE TABLE pg_temp.csf_decision_row_plan;

  INSERT INTO pg_temp.csf_decision_row_plan (
    ordinal, source_ordinal, source_id, sheet_tab_name, observed_row_number,
    match_basis, identity_digest, decision_digest, application_id, import_row_id,
    profile_id, decision, observed_color, reason, caller_block_reason,
    provenance_verified, mapping_current, duplicate_in_batch, previous_decision,
    previous_reason, previous_release_state, previous_released_decision,
    previous_released_reason, previous_source_id, membership_status, evidence
  )
  SELECT
    parsed.ordinal,
    source_plan.ordinal,
    parsed.source_id,
    parsed.sheet_tab_name,
    parsed.observed_row_number,
    parsed.match_basis,
    parsed.identity_digest,
    parsed.decision_digest,
    CASE WHEN parsed.match_basis = 'unmatched' THEN NULL ELSE parsed.application_id END,
    CASE WHEN parsed.match_basis = 'unmatched' THEN NULL ELSE parsed.import_row_id END,
    application.profile_id,
    parsed.decision,
    parsed.observed_color,
    parsed.reason,
    parsed.caller_block_reason,
    -- `coalesce(..., false)` is the whole point. Comparing a column that is
    -- NULL yields NULL, not false, and an unknown verification used to skip the
    -- fail-closed branch below instead of tripping it: a sheet row claiming an
    -- application it has no lineage to was staged as an ordinary change.
    coalesce(CASE
      WHEN parsed.match_basis = 'unmatched' THEN false
      WHEN NOT coalesce(source_plan.source_verified, false) THEN false
      WHEN NOT coalesce(source_plan.mapping_current, false) THEN false
      WHEN application.id IS NULL OR application.term_id <> p_term_id THEN false
      WHEN parsed.match_basis = 'import_row_provenance' THEN
        import_row.id IS NOT NULL
        AND import_row.sheet_tab_name = source_plan.sheet_tab_name
        AND import_job.source_file_id = source_plan.spreadsheet_file_id
        AND (
          import_row.matched_application_id = application.id
          OR application.source_import_row_id = import_row.id
        )
      ELSE
        -- No import row, so the only acceptable fallback is the response id the
        -- import froze on this application. Workbook membership proves nothing:
        -- every applicant in the term shares the file, so accepting it would let
        -- a sheet row hand a verdict to the wrong student. When the sync also
        -- carries the original response timestamp, that has to agree too, and
        -- the response id must resolve to exactly one application in the term.
        parsed.response_id IS NOT NULL
        AND application.google_form_response_id IS NOT NULL
        AND application.google_form_response_id = parsed.response_id
        AND application.source_file_id IS NOT NULL
        AND application.source_file_id = source_plan.spreadsheet_file_id
        AND (
          parsed.response_submitted_at IS NULL
          OR application.source_submitted_at = parsed.response_submitted_at
        )
        AND NOT EXISTS (
          SELECT 1
          FROM plugin_data.csf_term_applications AS peer
          WHERE peer.organization_id = p_organization_id
            AND peer.term_id = p_term_id
            AND peer.google_form_response_id = parsed.response_id
            AND peer.id <> application.id
        )
    END, false),
    coalesce(source_plan.mapping_current, false),
    parsed.application_id IS NOT NULL AND parsed.application_claims > 1,
    stage.staged_decision,
    stage.staged_reason,
    stage.release_state,
    stage.released_decision,
    stage.released_reason,
    stage.source_id,
    membership.status,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'observedColor', parsed.observed_color,
      'sheetTabId', parsed.sheet_tab_id,
      'callerChanged', parsed.caller_changed,
      'callerBlocksRelease', parsed.caller_blocks_release
    ))
  FROM (
    SELECT
      entry.ordinality::integer AS ordinal,
      nullif(entry.value ->> 'sourceId', '')::uuid AS source_id,
      entry.value ->> 'sheetTabName' AS sheet_tab_name,
      (entry.value ->> 'observedRowNumber')::integer AS observed_row_number,
      nullif(entry.value ->> 'applicationId', '')::uuid AS application_id,
      nullif(entry.value ->> 'importRowId', '')::uuid AS import_row_id,
      CASE
        WHEN nullif(entry.value ->> 'applicationId', '') IS NULL THEN 'unmatched'
        WHEN nullif(entry.value ->> 'importRowId', '') IS NOT NULL THEN 'import_row_provenance'
        ELSE 'recorded_response_id'
      END AS match_basis,
      nullif(pg_catalog.btrim(coalesce(entry.value ->> 'responseId', '')), '') AS response_id,
      (nullif(entry.value ->> 'responseSubmittedAt', ''))::timestamptz AS response_submitted_at,
      entry.value ->> 'identityDigest' AS identity_digest,
      entry.value ->> 'decisionDigest' AS decision_digest,
      coalesce(entry.value ->> 'status', 'unreviewed') AS decision,
      nullif(entry.value ->> 'observedColor', '') AS observed_color,
      nullif(pg_catalog.btrim(coalesce(entry.value ->> 'reason', '')), '') AS reason,
      nullif(entry.value ->> 'blockReason', '') AS caller_block_reason,
      (entry.value ->> 'sheetTabId')::bigint AS sheet_tab_id,
      coalesce((entry.value ->> 'changed')::boolean, false) AS caller_changed,
      coalesce((entry.value ->> 'blocksRelease')::boolean, false) AS caller_blocks_release,
      -- Two sheet rows claiming one application is ambiguous, never a winner.
      pg_catalog.count(*) OVER (
        PARTITION BY nullif(entry.value ->> 'applicationId', '')::uuid
      ) AS application_claims
    FROM pg_catalog.jsonb_array_elements(p_rows) WITH ORDINALITY AS entry(value, ordinality)
  ) AS parsed
  LEFT JOIN pg_temp.csf_decision_source_plan AS source_plan
    ON source_plan.source_id = parsed.source_id
   AND source_plan.sheet_tab_name = parsed.sheet_tab_name
  LEFT JOIN plugin_data.csf_term_applications AS application
    ON application.id = parsed.application_id
   AND application.organization_id = p_organization_id
  LEFT JOIN plugin_data.csf_sheet_import_rows AS import_row
    ON import_row.id = parsed.import_row_id
   AND import_row.organization_id = p_organization_id
  LEFT JOIN plugin_data.csf_sheet_import_jobs AS import_job
    ON import_job.id = import_row.job_id
   AND import_job.organization_id = p_organization_id
  LEFT JOIN plugin_data.csf_application_decision_stages AS stage
    ON stage.organization_id = p_organization_id
   AND stage.application_id = application.id
  LEFT JOIN plugin_data.csf_term_memberships AS membership
    ON membership.organization_id = p_organization_id
   AND membership.profile_id = application.profile_id
   AND membership.term_id = p_term_id;

  IF EXISTS (
    SELECT 1 FROM pg_temp.csf_decision_row_plan
    WHERE decision NOT IN (
      'accepted', 'rejected', 'rejected_with_explanation', 'unreviewed', 'conflict'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Unsupported Sheet decision status in the sync payload.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.csf_decision_row_plan WHERE source_ordinal IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Every decision row must name a source and tab present in this run''s evidence.';
  END IF;

  -- Outcome and blockers, in precedence order.
  UPDATE pg_temp.csf_decision_row_plan AS plan
  SET
    outcome = resolved.outcome,
    block_reason = resolved.block_reason
  FROM (
    SELECT
      row_plan.ordinal,
      CASE
        WHEN row_plan.match_basis = 'unmatched' THEN 'unmatched'
        WHEN NOT row_plan.mapping_current THEN 'conflict'
        WHEN NOT row_plan.provenance_verified THEN 'conflict'
        WHEN row_plan.duplicate_in_batch THEN 'conflict'
        WHEN row_plan.decision = 'conflict'
          OR row_plan.caller_block_reason IN ('unmapped_color', 'mixed_colors', 'ambiguous_match')
          THEN 'conflict'
        WHEN v_term_closed
          AND row_plan.previous_release_state = 'released'
          AND (
            row_plan.decision IS DISTINCT FROM row_plan.previous_decision
            OR row_plan.reason IS DISTINCT FROM row_plan.previous_released_reason
          )
          THEN 'conflict'
        WHEN row_plan.previous_release_state = 'released'
          AND row_plan.membership_status IN ('completed', 'not_completed')
          AND (
            row_plan.decision IS DISTINCT FROM row_plan.previous_decision
            OR row_plan.reason IS DISTINCT FROM row_plan.previous_released_reason
          )
          THEN 'conflict'
        WHEN row_plan.previous_source_id IS NOT NULL
          AND row_plan.previous_source_id <> row_plan.source_id
          AND row_plan.previous_decision IN ('accepted', 'rejected', 'rejected_with_explanation')
          AND row_plan.decision IN ('accepted', 'rejected', 'rejected_with_explanation')
          AND row_plan.decision <> row_plan.previous_decision
          THEN 'conflict'
        WHEN row_plan.previous_decision IS NOT DISTINCT FROM row_plan.decision
          AND row_plan.previous_reason IS NOT DISTINCT FROM row_plan.reason
          THEN 'unchanged'
        ELSE 'changed'
      END AS outcome,
      CASE
        WHEN row_plan.match_basis = 'unmatched' THEN
          CASE row_plan.caller_block_reason
            WHEN 'ambiguous_duplicate' THEN 'ambiguous_match'
            WHEN 'application_missing' THEN 'application_missing'
            ELSE 'no_import_row'
          END
        WHEN NOT row_plan.mapping_current THEN 'mapping_version_stale'
        WHEN NOT row_plan.provenance_verified THEN 'provenance_unverified'
        WHEN row_plan.duplicate_in_batch THEN 'ambiguous_match'
        WHEN row_plan.decision = 'conflict'
          OR row_plan.caller_block_reason IN ('unmapped_color', 'mixed_colors', 'ambiguous_match')
          THEN coalesce(nullif(row_plan.caller_block_reason, ''), 'unmapped_color')
        WHEN v_term_closed
          AND row_plan.previous_release_state = 'released'
          AND (
            row_plan.decision IS DISTINCT FROM row_plan.previous_decision
            OR row_plan.reason IS DISTINCT FROM row_plan.previous_released_reason
          )
          THEN 'term_closed'
        WHEN row_plan.previous_release_state = 'released'
          AND row_plan.membership_status IN ('completed', 'not_completed')
          AND (
            row_plan.decision IS DISTINCT FROM row_plan.previous_decision
            OR row_plan.reason IS DISTINCT FROM row_plan.previous_released_reason
          )
          THEN 'historical_outcome'
        WHEN row_plan.previous_source_id IS NOT NULL
          AND row_plan.previous_source_id <> row_plan.source_id
          AND row_plan.previous_decision IN ('accepted', 'rejected', 'rejected_with_explanation')
          AND row_plan.decision IN ('accepted', 'rejected', 'rejected_with_explanation')
          AND row_plan.decision <> row_plan.previous_decision
          THEN 'cross_source_conflict'
        WHEN row_plan.decision = 'rejected_with_explanation' AND row_plan.reason IS NULL
          THEN 'missing_yellow_reason'
        ELSE NULL
      END AS block_reason
    FROM pg_temp.csf_decision_row_plan AS row_plan
  ) AS resolved
  WHERE plan.ordinal = resolved.ordinal;

  -- What will actually change for an already-published applicant.
  UPDATE pg_temp.csf_decision_row_plan
  SET
    will_apply = (
      outcome = 'changed'
      AND previous_release_state = 'released'
      AND decision IN ('accepted', 'rejected', 'rejected_with_explanation')
      AND block_reason IS NULL
      AND (
        (CASE WHEN decision = 'accepted' THEN 'accepted' ELSE 'rejected' END)
          IS DISTINCT FROM previous_released_decision
        -- A yellow that loses its explanation and a red that gains one both
        -- normalize to 'rejected', so the published decision alone cannot see a
        -- reason-only correction. Both sides hold the same normalized text.
        OR reason IS DISTINCT FROM previous_released_reason
      )
    ),
    will_retract = (
      outcome = 'changed'
      AND previous_release_state = 'released'
      AND decision = 'unreviewed'
      AND block_reason IS NULL
      AND previous_released_decision IS DISTINCT FROM 'unreviewed'
    )
  -- Every plan row is inserted with a WITH ORDINALITY ordinal, so this
  -- predicate is total over the table and no row's verdict changes. It is here
  -- because the request role's safe-update guard rejects an UPDATE that has no
  -- WHERE clause before the statement runs.
  WHERE ordinal IS NOT NULL;

  -- -------------------------------------------------------------------------
  -- Pass 2: write the immutable receipt, then the stages, then the publishes.
  -- -------------------------------------------------------------------------

  INSERT INTO plugin_data.csf_application_decision_sync_runs (
    organization_id, term_id, actor_user_id, request_id, request_fingerprint,
    status, changed_count, unchanged_count, unmatched_count, conflict_count,
    applied_count, retracted_count
  )
  SELECT
    p_organization_id, p_term_id, p_actor_user_id, p_run_id, v_fingerprint,
    'completed',
    pg_catalog.count(*) FILTER (WHERE outcome = 'changed'),
    pg_catalog.count(*) FILTER (WHERE outcome = 'unchanged'),
    pg_catalog.count(*) FILTER (WHERE outcome = 'unmatched'),
    pg_catalog.count(*) FILTER (WHERE outcome = 'conflict'),
    pg_catalog.count(*) FILTER (WHERE will_apply),
    pg_catalog.count(*) FILTER (WHERE will_retract)
  FROM pg_temp.csf_decision_row_plan
  RETURNING id INTO v_run_id;

  INSERT INTO plugin_data.csf_application_decision_sync_sources (
    organization_id, run_id, source_id, read_status, message,
    spreadsheet_file_id, spreadsheet_title, provider_version, sheet_tab_name,
    sheet_tab_id, requested_range, content_hash, mapping_version,
    decision_columns, reason_columns, read_at
  )
  SELECT
    p_organization_id, v_run_id, source_id, read_status, message,
    spreadsheet_file_id, spreadsheet_title, provider_version, sheet_tab_name,
    sheet_tab_id, requested_range, content_hash, mapping_version,
    decision_columns, reason_columns, read_at
  FROM pg_temp.csf_decision_source_plan;

  INSERT INTO plugin_data.csf_application_decision_sync_rows (
    organization_id, run_id, run_source_id, observed_row_number, match_basis,
    identity_digest, decision_digest, application_id, import_row_id, outcome,
    decision, observed_color, reason, previous_decision, previous_release_state,
    block_reason, applied_to_released, retracted_release, evidence
  )
  SELECT
    p_organization_id, v_run_id, run_source.id, plan.observed_row_number,
    plan.match_basis, plan.identity_digest, plan.decision_digest,
    CASE WHEN plan.outcome IN ('unmatched') THEN NULL ELSE plan.application_id END,
    CASE WHEN plan.outcome IN ('unmatched') THEN NULL ELSE plan.import_row_id END,
    plan.outcome, plan.decision, plan.observed_color, plan.reason,
    plan.previous_decision, plan.previous_release_state, plan.block_reason,
    coalesce(plan.will_apply, false), coalesce(plan.will_retract, false),
    plan.evidence
  FROM pg_temp.csf_decision_row_plan AS plan
  JOIN pg_temp.csf_decision_source_plan AS source_plan
    ON source_plan.ordinal = plan.source_ordinal
  JOIN plugin_data.csf_application_decision_sync_sources AS run_source
    ON run_source.run_id = v_run_id
   AND run_source.source_id = source_plan.source_id
   AND run_source.sheet_tab_name = source_plan.sheet_tab_name;

  -- Staged state. Unmatched rows stage nothing. A conflicting row records the
  -- conflict on an existing stage so it cannot be released, but never
  -- overwrites the decision the chapter last agreed on.
  INSERT INTO plugin_data.csf_application_decision_stages AS stage (
    organization_id, application_id, term_id, profile_id, source_id,
    import_row_id, observed_row_number, staged_decision, staged_reason,
    observed_color, decision_digest, identity_digest, block_reason,
    first_staged_at, last_staged_at, last_sync_run_id, updated_at
  )
  -- One stage row per application even when two sheet rows claim the same one:
  -- both are already recorded as `ambiguous_match` conflicts above, and a
  -- second upsert of the same key in one statement is a cardinality error.
  SELECT DISTINCT ON (plan.application_id)
    p_organization_id, plan.application_id, p_term_id, plan.profile_id,
    plan.source_id, plan.import_row_id, plan.observed_row_number,
    CASE WHEN plan.outcome = 'conflict' AND plan.previous_decision IS NOT NULL
      THEN plan.previous_decision ELSE plan.decision END,
    CASE WHEN plan.outcome = 'conflict' AND plan.previous_decision IS NOT NULL
      THEN plan.previous_reason ELSE plan.reason END,
    plan.observed_color, plan.decision_digest, plan.identity_digest,
    plan.block_reason, v_now, v_now, v_run_id, v_now
  FROM pg_temp.csf_decision_row_plan AS plan
  WHERE plan.outcome <> 'unmatched'
    AND plan.application_id IS NOT NULL
    AND plan.profile_id IS NOT NULL
  ORDER BY plan.application_id, plan.ordinal
  ON CONFLICT (organization_id, application_id) DO UPDATE SET
    staged_decision = EXCLUDED.staged_decision,
    staged_reason = EXCLUDED.staged_reason,
    observed_color = EXCLUDED.observed_color,
    decision_digest = EXCLUDED.decision_digest,
    identity_digest = EXCLUDED.identity_digest,
    block_reason = EXCLUDED.block_reason,
    source_id = coalesce(EXCLUDED.source_id, stage.source_id),
    import_row_id = coalesce(EXCLUDED.import_row_id, stage.import_row_id),
    observed_row_number = EXCLUDED.observed_row_number,
    last_staged_at = EXCLUDED.last_staged_at,
    last_sync_run_id = EXCLUDED.last_sync_run_id,
    updated_at = EXCLUDED.updated_at;

  -- Already-released rows follow the sheet immediately, revocation included.
  FOR v_plan IN
    SELECT * FROM pg_temp.csf_decision_row_plan
    WHERE coalesce(will_apply, false) OR coalesce(will_retract, false)
    ORDER BY ordinal
  LOOP
    v_published := CASE
      WHEN v_plan.will_retract THEN 'unreviewed'
      WHEN v_plan.decision = 'accepted' THEN 'accepted'
      ELSE 'rejected'
    END;

    PERFORM plugin_data.csf_publish_sheet_application_decision(
      p_organization_id, v_plan.application_id, v_published, v_plan.reason,
      p_actor_user_id,
      pg_catalog.jsonb_build_object(
        'runId', v_run_id, 'sourceId', v_plan.source_id,
        'sheetTabName', v_plan.sheet_tab_name,
        'observedRowNumber', v_plan.observed_row_number,
        'decisionDigest', v_plan.decision_digest,
        'trigger', 'post_release_sync'
      )
    );

    UPDATE plugin_data.csf_application_decision_stages
    SET
      released_decision = v_published,
      released_reason = v_plan.reason,
      released_at = v_now,
      released_by = p_actor_user_id,
      last_applied_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND application_id = v_plan.application_id;
  END LOOP;

  RETURN plugin_data.csf_sheet_application_decision_run_receipt(p_organization_id, v_run_id)
    || pg_catalog.jsonb_build_object('replay', false);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_publish_sheet_application_decision(uuid, uuid, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_stage_sheet_application_decisions(uuid, uuid, uuid, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_stage_sheet_application_decisions(uuid, uuid, uuid, uuid, jsonb, jsonb)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_publish_sheet_application_decision(uuid, uuid, text, text, uuid, jsonb) IS
  'Publishes one externally reviewed decision. A finalized term membership keeps its published outcome, whatever the Sheet now says.';

NOTIFY pgrst, 'reload schema';

COMMIT;
