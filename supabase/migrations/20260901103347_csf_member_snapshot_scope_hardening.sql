-- Keep pending identity links and term-scoped member data inside their proven
-- authorization boundary without rewriting the historical migration ledger.

BEGIN;

ALTER FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid)
  RENAME TO csf_member_profile_snapshot_verified_projection;

REVOKE ALL ON FUNCTION plugin_data.csf_member_profile_snapshot_verified_projection(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_member_profile_snapshot(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account_status text;
  v_current_term_id uuid;
BEGIN
  SELECT account.status
  INTO v_account_status
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_actor_user_id
    AND account.status IN ('pending', 'verified')
  ORDER BY account.is_primary DESC, account.linked_at DESC, account.id DESC
  LIMIT 1;

  IF v_account_status = 'pending' THEN
    SELECT term.id
    INTO v_current_term_id
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.is_current = true
    ORDER BY term.updated_at DESC, term.id DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'profile', NULL,
      'accountStatus', 'pending',
      'currentTermId', v_current_term_id
    );
  END IF;

  RETURN plugin_data.csf_member_profile_snapshot_verified_projection(
    p_organization_id,
    p_actor_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid)
  TO service_role;

ALTER FUNCTION plugin_data.csf_member_home_context_snapshot(
  uuid, uuid, timestamptz, timestamptz, date
)
  RENAME TO csf_member_home_context_snapshot_unscoped;

REVOKE ALL ON FUNCTION plugin_data.csf_member_home_context_snapshot_unscoped(
  uuid, uuid, timestamptz, timestamptz, date
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_member_home_context_snapshot(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_lower_instant timestamptz,
  p_upper_instant timestamptz,
  p_lower_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot jsonb;
  v_profile_id uuid;
  v_cohort_id uuid;
  v_current_term_id uuid;
  v_has_current_membership boolean := false;
  v_activities jsonb := '[]'::jsonb;
BEGIN
  v_snapshot := plugin_data.csf_member_home_context_snapshot_unscoped(
    p_organization_id,
    p_actor_user_id,
    p_lower_instant,
    p_upper_instant,
    p_lower_date
  );

  v_profile_id := NULLIF(v_snapshot -> 'viewer' ->> 'profileId', '')::uuid;
  v_cohort_id := NULLIF(v_snapshot -> 'viewer' ->> 'cohortId', '')::uuid;

  SELECT term.id
  INTO v_current_term_id
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.is_current = true
  ORDER BY term.updated_at DESC, term.id DESC
  LIMIT 1;

  IF v_profile_id IS NOT NULL
    AND v_cohort_id IS NOT NULL
    AND v_current_term_id IS NOT NULL
  THEN
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_term_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = v_profile_id
        AND membership.term_id = v_current_term_id
        AND membership.cohort_id = v_cohort_id
        AND membership.status IN (
          'accepted', 'active', 'completed', 'not_completed'
        )
    ) INTO v_has_current_membership;
  END IF;

  IF NOT v_has_current_membership THEN
    v_snapshot := jsonb_set(
      v_snapshot,
      '{classmateCount}',
      'null'::jsonb,
      true
    );
  END IF;

  IF v_profile_id IS NOT NULL THEN
    SELECT coalesce(
      jsonb_agg(activity.value ORDER BY activity.ordinality),
      '[]'::jsonb
    )
    INTO v_activities
    FROM jsonb_array_elements(
      coalesce(v_snapshot -> 'activities', '[]'::jsonb)
    ) WITH ORDINALITY AS activity(value, ordinality)
    JOIN plugin_data.csf_opportunities AS opportunity
      ON opportunity.organization_id = p_organization_id
     AND opportunity.id = NULLIF(activity.value ->> 'id', '')::uuid
    WHERE opportunity.term_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_term_memberships AS membership
        WHERE membership.organization_id = opportunity.organization_id
          AND membership.profile_id = v_profile_id
          AND membership.term_id = opportunity.term_id
          AND membership.status IN ('accepted', 'active', 'completed')
      );
  END IF;

  RETURN jsonb_set(v_snapshot, '{activities}', v_activities, true);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_member_home_context_snapshot(
  uuid, uuid, timestamptz, timestamptz, date
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_home_context_snapshot(
  uuid, uuid, timestamptz, timestamptz, date
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_member_profile_snapshot_verified_projection(
  uuid, uuid
) IS 'Owner-internal bounded profile projection used only after a verified account check.';
COMMENT ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid) IS
  'Returns connection status only for pending links and the bounded profile projection for verified links.';
COMMENT ON FUNCTION plugin_data.csf_member_home_context_snapshot_unscoped(
  uuid, uuid, timestamptz, timestamptz, date
) IS 'Owner-internal bounded Home projection before current membership filtering.';
COMMENT ON FUNCTION plugin_data.csf_member_home_context_snapshot(
  uuid, uuid, timestamptz, timestamptz, date
) IS 'Returns bounded Member Home data filtered to the viewer qualifying term memberships.';

COMMIT;
