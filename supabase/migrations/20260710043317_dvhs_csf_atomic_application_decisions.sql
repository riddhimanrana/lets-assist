-- Atomically review one CSF application, synchronize its term membership,
-- grant platform membership only to a verified linked account, and audit it.

BEGIN;

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
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_previous_status text;
  v_membership_status text;
  v_linked_user_id uuid;
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

  UPDATE plugin_data.csf_term_applications
  SET
    status = p_decision,
    reviewed_by = p_actor_user_id,
    reviewed_at = v_now,
    review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
    updated_at = v_now
  WHERE id = p_application_id;

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
        'applicationStatus', p_decision,
        'currentGradeLevel', v_application.current_grade_level,
        'returningStatus', v_application.returning_status,
        'listIPoints', v_application.list_i_points,
        'listIAndIIPoints', v_application.list_i_ii_points,
        'grandTotalPoints', v_application.grand_total_points,
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

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data
  )
  VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.' || p_decision,
    'csf_term_applications',
    p_application_id,
    v_application.term_id,
    jsonb_build_object('status', v_previous_status),
    jsonb_build_object(
      'status', p_decision,
      'reviewNotes', nullif(btrim(coalesce(p_review_notes, '')), ''),
      'termMembershipStatus', v_membership_status,
      'platformMemberUserId', v_linked_user_id
    )
  );

  RETURN jsonb_build_object(
    'applicationId', p_application_id,
    'applicationStatus', p_decision,
    'termMembershipStatus', v_membership_status,
    'platformMemberUserId', v_linked_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid) IS
  'Atomic officer decision for a CSF application, term membership, verified platform membership, and audit history.';

COMMIT;
