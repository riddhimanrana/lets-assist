-- The Sheets application-decision RPCs: stage privately, release atomically,
-- and keep a released row honest after a later sync.
--
-- Companion to 20260917010000. Every function here is SECURITY DEFINER with an
-- empty search_path, revoked from PUBLIC/anon/authenticated, and granted only
-- to `service_role` when the application server is meant to call it.
--
-- Lock order for every consequential call (V128): permission, the shared
-- organization staff-access lock, the actor's active host membership row
-- `FOR SHARE`, the permission recheck, then this request's own locks.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Shared authority gate
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_assert_sheet_decision_authority(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_permission text,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  -- Authorization precedes every look at caller-controlled input: a receipt or
  -- a staged row confirms that a private application exists.
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, p_permission
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = p_message;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  -- Hold the host membership row so it cannot be deactivated or deleted between
  -- the recheck below and this transaction's commit.
  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = p_message;
  END IF;

  -- Authorization is mutable state. Re-read it only after this request owns the
  -- shared staff-access lock and the actor's membership row.
  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, p_permission
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = p_message;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_sheet_decision_authority(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_sheet_decision_term_lock_key(
  p_organization_id uuid,
  p_term_id uuid
)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.hashtextextended(
    'plugin_data.csf_sheet_application_decisions:'
      || p_organization_id::text || ':' || p_term_id::text,
    0
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_sheet_decision_term_lock_key(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- B. Term review source
--
-- Inert by construction: it writes the term row and its audit receipt, and
-- touches no application, membership, or organization-member row. Enabling
-- Sheets review on a term that already has published outcomes and live
-- memberships leaves every one of them exactly as it was.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX csf_admin_audit_events_review_source_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND action = 'term.application_review_source_committed';

CREATE FUNCTION plugin_data.csf_set_term_application_review_source(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_term_id uuid,
  p_review_source text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_source text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_review_source, '')));
  v_fingerprint text;
  v_previous text;
  v_cancelled integer := 0;
  v_now timestamptz := pg_catalog.now();
  v_result jsonb;
BEGIN
  PERFORM plugin_data.csf_assert_sheet_decision_authority(
    p_organization_id, p_actor_user_id, 'manage_settings',
    'Not authorized to change the CSF application review source.'
  );

  IF v_source NOT IN ('app', 'sheet') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The application review source must be app or sheet.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A stable review-source request identifier is required.';
  END IF;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'termId', p_term_id, 'reviewSource', v_source
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_admin_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action = 'term.application_review_source_committed'
  LIMIT 1;

  IF FOUND THEN
    IF v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_term_id
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That review-source request identifier is already bound to a different change.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
    RETURN (v_receipt.after_data -> 'result') || pg_catalog.jsonb_build_object('replay', true);
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found', MESSAGE = 'CSF term not found.';
  END IF;

  v_previous := v_term.application_review_source;

  UPDATE plugin_data.csf_terms
  SET
    application_review_source = v_source,
    application_review_source_set_at = v_now,
    application_review_source_set_by = p_actor_user_id,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_term_id;

  -- A write-back that was queued but never sent must not reach the workbook
  -- after the chapter decided to read decisions from it. Rows already `sent`
  -- are history and stay.
  IF v_source = 'sheet' THEN
    WITH cancelled AS (
      DELETE FROM plugin_data.csf_sheet_writeback_ledger AS ledger
      USING plugin_data.csf_term_applications AS application
      WHERE ledger.organization_id = p_organization_id
        AND ledger.destination_id IS NULL
        AND ledger.status IN ('queued', 'failed')
        AND application.organization_id = ledger.organization_id
        AND application.id = ledger.application_id
        AND application.term_id = p_term_id
      RETURNING ledger.id
    )
    SELECT pg_catalog.count(*)::integer INTO v_cancelled FROM cancelled;
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'termId', p_term_id,
    'reviewSource', v_source,
    'previousReviewSource', v_previous,
    'changed', v_previous IS DISTINCT FROM v_source,
    'cancelledPendingWritebacks', v_cancelled,
    'firstReleasedAt', v_term.decisions_first_released_at,
    'lastReleasedAt', v_term.decisions_last_released_at,
    'releaseCount', v_term.decisions_release_count
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id
  )
  VALUES (
    p_organization_id, p_actor_user_id, 'term.application_review_source_committed',
    'csf_terms', p_term_id, p_term_id,
    pg_catalog.jsonb_build_object('applicationReviewSource', v_previous),
    pg_catalog.jsonb_build_object(
      'applicationReviewSource', v_source,
      'requestFingerprint', v_fingerprint,
      'result', v_result
    ),
    p_request_id, 'csf_term_settings', p_term_id::text
  );

  RETURN v_result || pg_catalog.jsonb_build_object('replay', false);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_term_application_review_source(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_term_application_review_source(uuid, uuid, uuid, text, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- B2. Per-source decision mapping
--
-- Configuring which columns carry the verdict and the explanation is a staff
-- action with a permission recheck, and every material change moves
-- `mapping_version`. Staging compares the version the sync read against the
-- stored one, so a mapping edited between the read and the commit cannot apply
-- obsolete column semantics to staged rows.
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_set_application_decision_mapping(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_decision_columns integer[],
  p_reason_columns integer[],
  p_reads_cell_note boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_decision integer[] := coalesce(p_decision_columns, ARRAY[]::integer[]);
  v_reason integer[] := coalesce(p_reason_columns, ARRAY[]::integer[]);
  v_note boolean := coalesce(p_reads_cell_note, false);
  v_existing plugin_data.csf_application_decision_mappings%ROWTYPE;
  v_changed boolean;
  v_row plugin_data.csf_application_decision_mappings%ROWTYPE;
BEGIN
  PERFORM plugin_data.csf_assert_sheet_decision_authority(
    p_organization_id, p_actor_user_id, 'manage_sheet_sync',
    'Not authorized to configure CSF application decision columns.'
  );

  IF pg_catalog.array_length(v_decision, 1) IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Choose at least one column that carries the decision.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_decision || v_reason) AS c WHERE c < 1) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Decision and reason columns are one-based positions.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.id = p_source_id
      AND source.organization_id = p_organization_id
      AND source.source_type = 'application_responses'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = 'That application response source does not exist in this chapter.';
  END IF;

  SELECT * INTO v_existing
  FROM plugin_data.csf_application_decision_mappings
  WHERE organization_id = p_organization_id AND source_id = p_source_id
  FOR UPDATE;

  v_changed := NOT FOUND
    OR v_existing.decision_columns IS DISTINCT FROM v_decision
    OR v_existing.reason_columns IS DISTINCT FROM v_reason
    OR v_existing.reads_cell_note IS DISTINCT FROM v_note;

  INSERT INTO plugin_data.csf_application_decision_mappings AS mapping (
    organization_id, source_id, decision_columns, reason_columns,
    reads_cell_note, updated_by
  )
  VALUES (
    p_organization_id, p_source_id, v_decision, v_reason, v_note, p_actor_user_id
  )
  ON CONFLICT (organization_id, source_id) DO UPDATE SET
    decision_columns = EXCLUDED.decision_columns,
    reason_columns = EXCLUDED.reason_columns,
    reads_cell_note = EXCLUDED.reads_cell_note,
    mapping_version = mapping.mapping_version + CASE WHEN v_changed THEN 1 ELSE 0 END,
    updated_by = EXCLUDED.updated_by,
    updated_at = pg_catalog.now()
  RETURNING * INTO v_row;

  IF v_changed THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      before_data, after_data, source_type, source_id
    )
    VALUES (
      p_organization_id, p_actor_user_id, 'application_decision_mapping.updated',
      'csf_sheet_sources', p_source_id,
      CASE WHEN v_existing.id IS NULL THEN NULL ELSE pg_catalog.to_jsonb(v_existing) END,
      pg_catalog.to_jsonb(v_row),
      'sheet_application_review', p_source_id::text
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'sourceId', v_row.source_id,
    'decisionColumns', pg_catalog.to_jsonb(v_row.decision_columns),
    'reasonColumns', pg_catalog.to_jsonb(v_row.reason_columns),
    'readsCellNote', v_row.reads_cell_note,
    'mappingVersion', v_row.mapping_version,
    'changed', v_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_application_decision_mapping(uuid, uuid, uuid, integer[], integer[], boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_application_decision_mapping(uuid, uuid, uuid, integer[], integer[], boolean)
  TO service_role;

CREATE FUNCTION plugin_data.csf_list_application_decision_mappings(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'manage_sheet_sync'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Not authorized to read CSF application decision columns.';
  END IF;

  RETURN coalesce((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'sourceId', source.id,
      'title', source.title,
      'spreadsheetFileId', coalesce(source.drive_file_id, source.spreadsheet_id),
      'configured', mapping.id IS NOT NULL,
      'decisionColumns', coalesce(pg_catalog.to_jsonb(mapping.decision_columns), '[]'::jsonb),
      'reasonColumns', coalesce(pg_catalog.to_jsonb(mapping.reason_columns), '[]'::jsonb),
      'readsCellNote', coalesce(mapping.reads_cell_note, false),
      'mappingVersion', mapping.mapping_version
    ) ORDER BY source.title)
    FROM plugin_data.csf_sheet_sources AS source
    LEFT JOIN plugin_data.csf_application_decision_mappings AS mapping
      ON mapping.organization_id = source.organization_id
     AND mapping.source_id = source.id
    WHERE source.organization_id = p_organization_id
      AND source.source_type = 'application_responses'
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_list_application_decision_mappings(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_application_decision_mappings(uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- C. Publishing one externally reviewed decision
--
-- Reuses `csf_decide_term_application_policy_base` for the ordinary accept and
-- reject transitions, so membership, platform activation, status events, and
-- audit keep exactly one implementation. That base carries no academic gate
-- (20260817100000 removed the six checks, dues, and the decision preflight), so
-- an officer's Sheet verdict is never refused because the app's own course
-- evidence disagrees. What the base cannot express is added here:
--
--   * revoking a membership that already reached `active`, which the base
--     refuses because an in-product rejection of a live member is a mistake;
--   * retracting a published decision back to unreviewed when the officer
--     clears the colour after release;
--   * stamping the reason code as an external Sheet review instead of
--     `approved_standard`, which would claim academic evidence that was never
--     evaluated.
--
-- A membership already in `completed` or `not_completed` is a historical
-- outcome and is never touched; the caller records the row as held.
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_publish_sheet_application_decision(
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

  IF p_decision <> 'accepted'
    AND v_membership.status IN ('completed', 'not_completed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A completed term membership keeps its published outcome.',
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
  IF v_reason_code IS NOT NULL THEN
    UPDATE plugin_data.csf_term_applications
    SET decision_reason_code = v_reason_code
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

REVOKE ALL ON FUNCTION plugin_data.csf_publish_sheet_application_decision(uuid, uuid, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
