-- The application review campaign's verdict becomes THE application decision.
--
-- Officers now review the imported Google Form row directly in the review
-- workspace; the six-check system, dues verification, and the decision
-- preflight no longer gate approval. Approving or rejecting in the campaign
-- atomically updates csf_term_applications, runs the membership transition,
-- and queues a write-back of the decision (row color + comment) to the source
-- sheet. The checks/dues tables and the readiness projection stay in place,
-- unused by the decision path.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Sheet write-back ledger
--
-- One row per application, overwritten and re-queued on re-decision. The
-- dispatcher (application code) drains 'queued' rows when the environment
-- allows external writes, so a preview environment records intent without
-- ever calling Google.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_sheet_writeback_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES plugin_data.csf_term_applications(id) ON DELETE CASCADE,
  -- Drive file id of the source spreadsheet, plus the tab and 1-based row the
  -- import recorded. Copied here at decision time so a later re-import cannot
  -- silently retarget a pending write.
  spreadsheet_file_id text NOT NULL,
  sheet_tab text,
  row_number integer NOT NULL CHECK (row_number > 0),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (organization_id, application_id)
);

CREATE INDEX csf_sheet_writeback_ledger_pending_idx
  ON plugin_data.csf_sheet_writeback_ledger (organization_id, status)
  WHERE status IN ('queued', 'failed');

ALTER TABLE plugin_data.csf_sheet_writeback_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_sheet_writeback_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_sheet_writeback_ledger TO service_role;

-- ---------------------------------------------------------------------------
-- B. Relax the decision base
--
-- Same body as the foundation's atomic decision, minus the accepted-path
-- gates (mandatory check count, eligibility status, dues status). Membership
-- transitions, status events, audit rows, and the rejected-membership guard
-- are unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_decide_term_application_policy_base(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_review_notes text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_previous_status text;
  v_membership_status text;
  v_linked_user_id uuid;
  v_dues plugin_data.csf_dues_records%ROWTYPE;
  v_checks jsonb := '{}'::jsonb;
  v_reason_code plugin_data.csf_application_reason_code;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  IF p_decision NOT IN ('accepted', 'rejected', 'needs_action') THEN
    RAISE EXCEPTION 'Unsupported CSF application decision: %', p_decision;
  END IF;

  IF p_decision IN ('rejected', 'needs_action')
    AND nullif(btrim(coalesce(p_review_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Review notes are required for this decision.';
  END IF;

  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF application not found.';
  END IF;

  v_previous_status := v_application.status;

  -- Recorded for the audit trail and eligibility snapshot only; no longer a
  -- gate on the decision.
  SELECT coalesce(jsonb_object_agg(check_type::text, status::text), '{}'::jsonb)
  INTO v_checks
  FROM plugin_data.csf_application_checks
  WHERE organization_id = p_organization_id
    AND application_id = p_application_id;

  SELECT dues.*
  INTO v_dues
  FROM plugin_data.csf_dues_records AS dues
  WHERE dues.organization_id = p_organization_id
    AND dues.application_id = p_application_id
  FOR UPDATE;

  IF p_decision = 'rejected' AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = v_application.profile_id
      AND membership.term_id = v_application.term_id
      AND membership.status IN ('active', 'completed', 'not_completed')
  ) THEN
    RAISE EXCEPTION 'An active or closed term membership cannot be rejected.';
  END IF;

  v_reason_code := CASE
    WHEN p_decision = 'accepted' AND v_application.eligibility_status = 'adviser_override'
      THEN 'approved_adviser_override'::plugin_data.csf_application_reason_code
    WHEN p_decision = 'accepted'
      THEN 'approved_standard'::plugin_data.csf_application_reason_code
    WHEN p_decision = 'needs_action'
      THEN 'missing_information'::plugin_data.csf_application_reason_code
    ELSE coalesce(v_application.decision_reason_code, 'other'::plugin_data.csf_application_reason_code)
  END;

  UPDATE plugin_data.csf_term_applications
  SET
    status = p_decision,
    submission_status = CASE p_decision
      WHEN 'accepted' THEN 'decided'::plugin_data.csf_application_submission_status
      WHEN 'rejected' THEN 'decided'::plugin_data.csf_application_submission_status
      ELSE 'missing_information'::plugin_data.csf_application_submission_status
    END,
    decision_status = CASE p_decision
      WHEN 'accepted' THEN 'approved'::plugin_data.csf_application_decision_status
      WHEN 'rejected' THEN 'rejected'::plugin_data.csf_application_decision_status
      ELSE 'pending'::plugin_data.csf_application_decision_status
    END,
    decision_reason_code = v_reason_code,
    decision_reason = nullif(btrim(coalesce(p_review_notes, '')), ''),
    decision_correlation_id = v_correlation_id,
    reviewed_by = p_actor_user_id,
    reviewed_at = v_now,
    review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_application_id;

  IF p_decision = 'accepted' THEN
    INSERT INTO plugin_data.csf_term_memberships (
      organization_id,
      profile_id,
      term_id,
      cohort_id,
      application_id,
      status,
      status_reason,
      eligibility_snapshot,
      accepted_at,
      updated_at
    )
    VALUES (
      p_organization_id,
      v_application.profile_id,
      v_application.term_id,
      v_application.cohort_id,
      v_application.id,
      'accepted',
      nullif(btrim(coalesce(p_review_notes, '')), ''),
      jsonb_build_object(
        'applicationDecision', 'approved',
        'eligibilityStatus', v_application.eligibility_status,
        'checks', v_checks,
        'duesStatus', v_dues.status,
        'currentGradeLevel', v_application.current_grade_level,
        'returningStatus', v_application.returning_status,
        'listIPoints', v_application.list_i_points,
        'listIAndIIPoints', v_application.list_i_ii_points,
        'grandTotalPoints', v_application.grand_total_points,
        'correlationId', v_correlation_id,
        'capturedAt', v_now
      ),
      v_now,
      v_now
    )
    ON CONFLICT (organization_id, profile_id, term_id) DO UPDATE
    SET
      cohort_id = EXCLUDED.cohort_id,
      application_id = EXCLUDED.application_id,
      status = CASE
        WHEN plugin_data.csf_term_memberships.status IN ('active', 'completed', 'not_completed')
          THEN plugin_data.csf_term_memberships.status
        ELSE 'accepted'
      END,
      status_reason = EXCLUDED.status_reason,
      eligibility_snapshot = EXCLUDED.eligibility_snapshot,
      accepted_at = coalesce(plugin_data.csf_term_memberships.accepted_at, EXCLUDED.accepted_at),
      updated_at = EXCLUDED.updated_at;

    SELECT account.user_id
    INTO v_linked_user_id
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_application.profile_id
      AND account.status = 'verified'
    ORDER BY account.is_primary DESC, account.linked_at DESC
    LIMIT 1;

    IF v_linked_user_id IS NOT NULL THEN
      INSERT INTO public.organization_members (
        organization_id,
        user_id,
        role,
        status,
        is_visible,
        joined_at
      )
      VALUES (
        p_organization_id,
        v_linked_user_id,
        'member',
        'active',
        false,
        v_now
      )
      ON CONFLICT (organization_id, user_id) DO UPDATE
      SET status = 'active';
    END IF;
  ELSIF p_decision = 'rejected' THEN
    UPDATE plugin_data.csf_term_memberships
    SET
      status = 'revoked',
      status_reason = btrim(p_review_notes),
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND profile_id = v_application.profile_id
      AND term_id = v_application.term_id
      AND status IN ('pending', 'accepted');
  ELSE
    UPDATE plugin_data.csf_term_memberships
    SET
      status = 'pending',
      status_reason = btrim(p_review_notes),
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND profile_id = v_application.profile_id
      AND term_id = v_application.term_id
      AND status IN ('pending', 'accepted');
  END IF;

  SELECT membership.status
  INTO v_membership_status
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_application.profile_id
    AND membership.term_id = v_application.term_id;

  INSERT INTO plugin_data.csf_application_status_events (
    organization_id,
    application_id,
    actor_user_id,
    previous_status,
    next_status,
    reason,
    reason_code,
    correlation_id,
    details
  )
  VALUES (
    p_organization_id,
    p_application_id,
    p_actor_user_id,
    v_previous_status,
    p_decision,
    nullif(btrim(coalesce(p_review_notes, '')), ''),
    v_reason_code,
    v_correlation_id,
    jsonb_build_object(
      'eligibilityStatus', v_application.eligibility_status,
      'checks', v_checks,
      'duesStatus', v_dues.status,
      'termMembershipStatus', v_membership_status
    )
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
  )
  VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.' || p_decision,
    'csf_term_applications',
    p_application_id,
    v_application.term_id,
    jsonb_build_object(
      'legacyStatus', v_previous_status,
      'submissionStatus', v_application.submission_status,
      'decisionStatus', v_application.decision_status
    ),
    jsonb_build_object(
      'legacyStatus', p_decision,
      'submissionStatus', CASE WHEN p_decision = 'needs_action' THEN 'missing_information' ELSE 'decided' END,
      'decisionStatus', CASE p_decision WHEN 'accepted' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END,
      'eligibilityStatus', v_application.eligibility_status,
      'checks', v_checks,
      'duesStatus', v_dues.status,
      'reviewNotes', nullif(btrim(coalesce(p_review_notes, '')), ''),
      'termMembershipStatus', v_membership_status,
      'platformMemberUserId', v_linked_user_id
    ),
    v_correlation_id,
    'application_review',
    p_application_id::text,
    v_reason_code::text
  );

  RETURN jsonb_build_object(
    'applicationId', p_application_id,
    'applicationStatus', p_decision,
    'decisionStatus', CASE p_decision WHEN 'accepted' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END,
    'eligibilityStatus', v_application.eligibility_status,
    'duesStatus', v_dues.status,
    'termMembershipStatus', v_membership_status,
    'platformMemberUserId', v_linked_user_id,
    'correlationId', v_correlation_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- C. The public decide delegates straight to the relaxed base
--
-- The preflight and policy-freshness wrappers are retired: approval no longer
-- requires the six checks, verified dues, or a current-policy eligibility
-- recalculation. The idempotent 6-arg overload calls this 5-arg function, so
-- both entry points relax together.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_decide_term_application(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_review_notes text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'decide_applications'
  ) THEN
    RAISE EXCEPTION 'Not authorized to decide CSF applications.';
  END IF;

  RETURN plugin_data.csf_decide_term_application_policy_base(
    p_organization_id,
    p_application_id,
    p_decision,
    p_review_notes,
    p_actor_user_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- D. Queue the sheet write-back for a decided application
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_application_sheet_writeback(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_comment text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
BEGIN
  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id;

  -- A manually created application has no sheet row to color; that is not an
  -- error, there is simply nothing to write back.
  IF NOT FOUND
    OR v_application.source_file_id IS NULL
    OR v_application.source_row_number IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO plugin_data.csf_sheet_writeback_ledger (
    organization_id, application_id, spreadsheet_file_id, sheet_tab,
    row_number, decision, comment
  )
  VALUES (
    p_organization_id, p_application_id, v_application.source_file_id,
    v_application.source_sheet_tab, v_application.source_row_number,
    p_decision, nullif(btrim(coalesce(p_comment, '')), '')
  )
  ON CONFLICT (organization_id, application_id) DO UPDATE SET
    spreadsheet_file_id = EXCLUDED.spreadsheet_file_id,
    sheet_tab = EXCLUDED.sheet_tab,
    row_number = EXCLUDED.row_number,
    decision = EXCLUDED.decision,
    comment = EXCLUDED.comment,
    status = 'queued',
    attempts = 0,
    last_error = NULL,
    sent_at = NULL,
    updated_at = now();
END;
$$;

-- ---------------------------------------------------------------------------
-- E. The campaign verdict drives the application decision
--
-- Same body as the 20260803010500 version, plus: a non-pending verdict on an
-- application subject atomically applies the application decision (membership
-- transition, status event, audit) and queues the sheet write-back. The
-- reviewing officer holds verify_submissions; the application decision is
-- applied through the internal base directly so the campaign does not also
-- demand decide_applications from every reviewer.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_record_review_decision(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_period_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_row plugin_data.csf_review_decisions%ROWTYPE;
  v_kind plugin_data.csf_review_subject_kind := p_subject_kind::plugin_data.csf_review_subject_kind;
  v_decision plugin_data.csf_review_decision_state := p_decision::plugin_data.csf_review_decision_state;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_expected plugin_data.csf_review_subject_kind;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'verify_submissions') THEN
    RAISE EXCEPTION 'Not authorized to record CSF review decisions.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_period
  FROM plugin_data.csf_review_periods
  WHERE organization_id = p_organization_id AND id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review period not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_period.status <> 'open' THEN
    RAISE EXCEPTION 'This review period is not open.' USING ERRCODE = 'check_violation';
  END IF;

  v_expected := plugin_data.csf_review_subject_kind_for(v_period.kind);
  IF v_kind <> v_expected THEN
    RAISE EXCEPTION 'A % period reviews % subjects, not %.', v_period.kind, v_expected, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_decision = 'rejected' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A rejection needs a reason.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO plugin_data.csf_review_decisions (
    organization_id, period_id, subject_kind, subject_id, decision, reason,
    decided_by, decided_at
  )
  VALUES (
    p_organization_id, p_period_id, v_kind, p_subject_id, v_decision, v_reason,
    CASE WHEN v_decision = 'pending' THEN NULL ELSE p_actor_user_id END,
    CASE WHEN v_decision = 'pending' THEN NULL ELSE v_now END
  )
  ON CONFLICT (organization_id, period_id, subject_kind, subject_id)
  DO UPDATE SET
    decision = EXCLUDED.decision,
    reason = EXCLUDED.reason,
    decided_by = EXCLUDED.decided_by,
    decided_at = EXCLUDED.decided_at,
    updated_at = v_now
  RETURNING * INTO v_row;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id, after_data, reason_code
  )
  VALUES (
    p_organization_id, p_actor_user_id, 'review_decision.' || v_decision::text,
    'csf_review_decision', v_row.id, v_period.term_id, pg_catalog.to_jsonb(v_row), v_reason
  );

  -- The campaign verdict IS the application decision. Applying it here keeps
  -- verdict, application state, membership, and the write-back queue in one
  -- transaction; a failure in any of them rolls the verdict back too.
  IF v_kind = 'application' AND v_decision <> 'pending' THEN
    PERFORM plugin_data.csf_decide_term_application_policy_base(
      p_organization_id,
      p_subject_id,
      CASE v_decision WHEN 'approved' THEN 'accepted' ELSE 'rejected' END,
      coalesce(v_reason, CASE WHEN v_decision = 'approved' THEN 'Approved in application review.' ELSE NULL END),
      p_actor_user_id
    );

    PERFORM plugin_data.csf_queue_application_sheet_writeback(
      p_organization_id,
      p_subject_id,
      v_decision::text,
      v_reason
    );
  END IF;

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- F. The dispatcher records each attempt's outcome
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_mark_sheet_writeback_result(
  p_organization_id uuid,
  p_ledger_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_writeback_ledger%ROWTYPE;
BEGIN
  UPDATE plugin_data.csf_sheet_writeback_ledger
  SET
    status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
    attempts = attempts + 1,
    last_error = CASE WHEN p_success THEN NULL ELSE nullif(pg_catalog.btrim(coalesce(p_error, '')), '') END,
    sent_at = CASE WHEN p_success THEN pg_catalog.now() ELSE sent_at END,
    updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_ledger_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sheet write-back ledger row not found.' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- G. Grants and comments
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application_policy_base(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
-- The 5-arg signature stays internal: server code must keep using the
-- request-aware 6-arg overload so a lost response can never double-decide.
REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_application_sheet_writeback(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_record_review_decision(uuid, uuid, uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_review_decision(uuid, uuid, uuid, text, uuid, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_mark_sheet_writeback_result(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_mark_sheet_writeback_result(uuid, uuid, boolean, text)
  TO service_role;

COMMENT ON TABLE plugin_data.csf_sheet_writeback_ledger IS
  'Queued decisions to color and annotate the source application sheet row. Drained by the application dispatcher only where external writes are enabled.';
COMMENT ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid) IS
  'Atomic application decision. Checks, dues, and the decision preflight no longer gate approval; the officer decides from the imported row.';
COMMENT ON FUNCTION plugin_data.csf_record_review_decision(uuid, uuid, uuid, text, uuid, text, text) IS
  'Records a campaign verdict. For an application campaign, a non-pending verdict also applies the application decision and queues the sheet write-back atomically.';

COMMIT;
