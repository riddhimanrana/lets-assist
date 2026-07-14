-- Keep CSF semester requirement updates and their audit history in one transaction.

BEGIN;

ALTER TABLE plugin_data.csf_term_policies
  ADD CONSTRAINT csf_term_policies_drive_cap_check
  CHECK (max_drive_points <= total_points_required) NOT VALID;

ALTER TABLE plugin_data.csf_term_policies
  ADD CONSTRAINT csf_term_policies_absence_allowance_check
  CHECK (required_meetings = 0 OR allowed_absences <= required_meetings) NOT VALID;

ALTER TABLE plugin_data.csf_term_policies
  VALIDATE CONSTRAINT csf_term_policies_drive_cap_check;

ALTER TABLE plugin_data.csf_term_policies
  VALIDATE CONSTRAINT csf_term_policies_absence_allowance_check;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_term_policy(
  p_organization_id uuid,
  p_term_id uuid,
  p_total_points_required numeric,
  p_max_drive_points numeric,
  p_max_points_per_activity numeric,
  p_required_meetings integer,
  p_allowed_absences integer,
  p_allow_point_carryover boolean,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_before plugin_data.csf_term_policies%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF semester not found.';
  END IF;

  IF p_total_points_required < 0
    OR p_max_drive_points < 0
    OR p_max_points_per_activity <= 0
    OR p_required_meetings < 0
    OR p_allowed_absences < 0 THEN
    RAISE EXCEPTION 'CSF semester requirements cannot be negative.';
  END IF;
  IF p_max_drive_points > p_total_points_required THEN
    RAISE EXCEPTION 'The drive-point cap cannot exceed the total point requirement.';
  END IF;
  IF p_required_meetings > 0 AND p_allowed_absences > p_required_meetings THEN
    RAISE EXCEPTION 'Allowed absences cannot exceed required meetings.';
  END IF;

  SELECT policy.*
  INTO v_before
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id
  FOR UPDATE;

  INSERT INTO plugin_data.csf_term_policies (
    organization_id,
    term_id,
    policy_version,
    total_points_required,
    max_drive_points,
    max_points_per_activity,
    required_meetings,
    allowed_absences,
    allow_point_carryover,
    created_by,
    updated_by,
    updated_at
  ) VALUES (
    p_organization_id,
    p_term_id,
    1,
    p_total_points_required,
    p_max_drive_points,
    p_max_points_per_activity,
    p_required_meetings,
    p_allowed_absences,
    coalesce(p_allow_point_carryover, false),
    p_actor_user_id,
    p_actor_user_id,
    v_now
  )
  ON CONFLICT (organization_id, term_id)
  DO UPDATE SET
    policy_version = plugin_data.csf_term_policies.policy_version + 1,
    total_points_required = EXCLUDED.total_points_required,
    max_drive_points = EXCLUDED.max_drive_points,
    max_points_per_activity = EXCLUDED.max_points_per_activity,
    required_meetings = EXCLUDED.required_meetings,
    allowed_absences = EXCLUDED.allowed_absences,
    allow_point_carryover = EXCLUDED.allow_point_carryover,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_policy;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'term_policy.update',
    'csf_term_policies',
    v_policy.id,
    p_term_id,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE jsonb_build_object(
      'policyVersion', v_before.policy_version,
      'totalPointsRequired', v_before.total_points_required,
      'maxDrivePoints', v_before.max_drive_points,
      'maxPointsPerActivity', v_before.max_points_per_activity,
      'requiredMeetings', v_before.required_meetings,
      'allowedAbsences', v_before.allowed_absences,
      'allowPointCarryover', v_before.allow_point_carryover
    ) END,
    jsonb_build_object(
      'termCode', v_term.code,
      'termLabel', v_term.label,
      'policyVersion', v_policy.policy_version,
      'totalPointsRequired', v_policy.total_points_required,
      'maxDrivePoints', v_policy.max_drive_points,
      'maxPointsPerActivity', v_policy.max_points_per_activity,
      'requiredMeetings', v_policy.required_meetings,
      'allowedAbsences', v_policy.allowed_absences,
      'allowPointCarryover', v_policy.allow_point_carryover
    )
  );

  RETURN jsonb_build_object(
    'policyId', v_policy.id,
    'policyVersion', v_policy.policy_version,
    'termCode', v_term.code,
    'termLabel', v_term.label
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_update_term_policy(
  uuid, uuid, numeric, numeric, numeric, integer, integer, boolean, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_term_policy(
  uuid, uuid, numeric, numeric, numeric, integer, integer, boolean, uuid
) TO service_role;

COMMIT;
