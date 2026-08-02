-- Write paths for officer review campaigns.
--
-- Every mutation in this file is the only supported way to change its table.
-- Each one authorizes the actor, records an audit event, and returns the
-- resulting row as jsonb so the action layer never needs a second read.
--
-- Permission split:
--   manage_review_periods  opening, closing, and assigning ranges (admin/adviser)
--   verify_submissions     recording decisions, notes, and per-member overrides

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Open, update, or close a period
--
-- One period per organization/term/kind, so this upserts. Closing is terminal:
-- a closed period is not reopened here, because reopening a campaign after
-- decisions exist is a different, reasoned operation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_set_review_period(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_term_id uuid,
  p_kind text,
  p_status text,
  p_title text,
  p_instructions text DEFAULT NULL,
  p_opens_at timestamptz DEFAULT NULL,
  p_closes_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_before jsonb;
  v_kind plugin_data.csf_review_period_kind := p_kind::plugin_data.csf_review_period_kind;
  v_status plugin_data.csf_review_period_status := p_status::plugin_data.csf_review_period_status;
  v_title text := nullif(pg_catalog.btrim(coalesce(p_title, '')), '');
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_review_periods') THEN
    RAISE EXCEPTION 'Not authorized to manage CSF review periods.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'A review period needs a title.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_period
  FROM plugin_data.csf_review_periods
  WHERE organization_id = p_organization_id AND term_id = p_term_id AND kind = v_kind
  FOR UPDATE;

  v_before := pg_catalog.to_jsonb(v_period);

  IF FOUND AND v_period.status = 'closed' THEN
    RAISE EXCEPTION 'This review period is already closed.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT FOUND THEN
    INSERT INTO plugin_data.csf_review_periods (
      organization_id, term_id, kind, status, title, instructions, opens_at, closes_at,
      opened_by, opened_at, created_by
    )
    VALUES (
      p_organization_id, p_term_id, v_kind, v_status, v_title, p_instructions, p_opens_at, p_closes_at,
      CASE WHEN v_status = 'draft' THEN NULL ELSE p_actor_user_id END,
      CASE WHEN v_status = 'draft' THEN NULL ELSE v_now END,
      p_actor_user_id
    )
    RETURNING * INTO v_period;
  ELSE
    UPDATE plugin_data.csf_review_periods
       SET status = v_status,
           title = v_title,
           instructions = p_instructions,
           opens_at = p_opens_at,
           closes_at = p_closes_at,
           opened_by = CASE
             WHEN v_status = 'draft' THEN NULL
             ELSE coalesce(opened_by, p_actor_user_id)
           END,
           opened_at = CASE
             WHEN v_status = 'draft' THEN NULL
             ELSE coalesce(opened_at, v_now)
           END,
           closed_by = CASE WHEN v_status = 'closed' THEN p_actor_user_id ELSE NULL END,
           closed_at = CASE WHEN v_status = 'closed' THEN v_now ELSE NULL END,
           updated_at = v_now
     WHERE id = v_period.id
    RETURNING * INTO v_period;
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id, before_data, after_data
  )
  VALUES (
    p_organization_id, p_actor_user_id, 'review_period.' || v_status::text,
    'csf_review_period', v_period.id, p_term_id, v_before, pg_catalog.to_jsonb(v_period)
  );

  RETURN pg_catalog.to_jsonb(v_period);
END;
$$;

-- ---------------------------------------------------------------------------
-- B. Assign ranges
--
-- Rewrites the complete set for one period and cohort. Writing the whole set
-- in one statement pair is what guarantees the ranges stay contiguous and
-- non-overlapping; there is deliberately no single-range update.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_assign_review_ranges(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_period_id uuid,
  p_cohort_id uuid,
  p_assignments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_entry jsonb;
  v_expected_start integer := 1;
  v_inserted integer := 0;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_review_periods') THEN
    RAISE EXCEPTION 'Not authorized to assign CSF review ranges.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF pg_catalog.jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Assignments must be an array.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_period
  FROM plugin_data.csf_review_periods
  WHERE organization_id = p_organization_id AND id = p_period_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review period not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_period.status = 'closed' THEN
    RAISE EXCEPTION 'This review period is closed.' USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM plugin_data.csf_review_assignments
   WHERE organization_id = p_organization_id
     AND period_id = p_period_id
     AND coalesce(cohort_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_cohort_id, '00000000-0000-0000-0000-000000000000'::uuid);

  FOR v_entry IN SELECT * FROM pg_catalog.jsonb_array_elements(p_assignments)
  LOOP
    IF (v_entry->>'startIndex')::integer <> v_expected_start THEN
      RAISE EXCEPTION 'Review ranges must be contiguous and start at 1; expected % but got %.',
        v_expected_start, (v_entry->>'startIndex')::integer
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO plugin_data.csf_review_assignments (
      organization_id, period_id, cohort_id, reviewer_user_id,
      start_index, end_index, from_label, to_label, assigned_by
    )
    VALUES (
      p_organization_id, p_period_id, p_cohort_id, (v_entry->>'reviewerUserId')::uuid,
      (v_entry->>'startIndex')::integer, (v_entry->>'endIndex')::integer,
      v_entry->>'fromLabel', v_entry->>'toLabel', p_actor_user_id
    );

    v_expected_start := (v_entry->>'endIndex')::integer + 1;
    v_inserted := v_inserted + 1;
  END LOOP;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id, after_data
  )
  VALUES (
    p_organization_id, p_actor_user_id, 'review_period.assign_ranges',
    'csf_review_period', p_period_id, v_period.term_id,
    pg_catalog.jsonb_build_object('cohortId', p_cohort_id, 'ranges', v_inserted)
  );

  RETURN pg_catalog.jsonb_build_object('periodId', p_period_id, 'ranges', v_inserted, 'updatedAt', v_now);
END;
$$;

-- ---------------------------------------------------------------------------
-- C. Record a decision
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

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- D. Per-member submission-freeze override
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_set_review_submission_override(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_period_id uuid,
  p_subject_id uuid,
  p_enabled boolean,
  p_reason text
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
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'verify_submissions') THEN
    RAISE EXCEPTION 'Not authorized to change the CSF submission lock.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_enabled AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Unlocking a member needs a reason.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_period
  FROM plugin_data.csf_review_periods
  WHERE organization_id = p_organization_id AND id = p_period_id AND kind = 'member_points';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member point verification period not found.' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO plugin_data.csf_review_decisions (
    organization_id, period_id, subject_kind, subject_id,
    submission_lock_override, override_reason, override_by, override_at
  )
  VALUES (
    p_organization_id, p_period_id, 'profile', p_subject_id,
    p_enabled,
    CASE WHEN p_enabled THEN v_reason ELSE NULL END,
    CASE WHEN p_enabled THEN p_actor_user_id ELSE NULL END,
    CASE WHEN p_enabled THEN v_now ELSE NULL END
  )
  ON CONFLICT (organization_id, period_id, subject_kind, subject_id)
  DO UPDATE SET
    submission_lock_override = EXCLUDED.submission_lock_override,
    override_reason = EXCLUDED.override_reason,
    override_by = EXCLUDED.override_by,
    override_at = EXCLUDED.override_at,
    updated_at = v_now
  RETURNING * INTO v_row;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id, after_data, reason_code
  )
  VALUES (
    p_organization_id, p_actor_user_id,
    CASE WHEN p_enabled THEN 'review_decision.unlock' ELSE 'review_decision.relock' END,
    'csf_review_decision', v_row.id, v_period.term_id, pg_catalog.to_jsonb(v_row), v_reason
  );

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- E. Notes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_add_review_note(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_period_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_review_notes%ROWTYPE;
  v_body text := nullif(pg_catalog.btrim(coalesce(p_body, '')), '');
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'verify_submissions') THEN
    RAISE EXCEPTION 'Not authorized to write CSF review notes.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'A note needs a body.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO plugin_data.csf_review_notes (
    organization_id, period_id, subject_kind, subject_id, body, author_user_id
  )
  VALUES (
    p_organization_id, p_period_id, p_subject_kind::plugin_data.csf_review_subject_kind,
    p_subject_id, v_body, p_actor_user_id
  )
  RETURNING * INTO v_row;

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- F. Execution grants
--
-- service_role only. The plugin's server-only client is the sole caller.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION plugin_data.csf_set_review_period(uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_assign_review_ranges(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_record_review_decision(uuid, uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_set_review_submission_override(uuid, uuid, uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_add_review_note(uuid, uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_set_review_period(uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assign_review_ranges(uuid, uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_review_decision(uuid, uuid, uuid, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_review_submission_override(uuid, uuid, uuid, uuid, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_add_review_note(uuid, uuid, uuid, text, uuid, text) TO service_role;

COMMIT;
