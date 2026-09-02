-- Put both class-code connection paths behind the shared organization identity
-- lock. The historical bodies keep their existing validation and settlement
-- behavior, but only the service-only wrappers remain callable outside the
-- owning role.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_revalidate_class_code_connection_replay(
  p_organization_id uuid,
  p_user_id uuid,
  p_profile_id uuid,
  p_request_id uuid,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_account plugin_data.csf_profile_accounts%ROWTYPE;
  v_blockers text[] := ARRAY[]::text[];
  v_active_cohort_ids uuid[] := ARRAY[]::uuid[];
  v_request_found boolean := false;
  v_account_found boolean := false;
  v_class_scope_valid boolean := false;
  v_profile_active boolean := false;
  v_organization_membership_active boolean := false;
  v_active_class_valid boolean := false;
  v_success_audit_exists boolean := false;
  v_verified_email_audit_exists boolean := false;
  v_request_owns_current_link boolean := false;
  v_core_link_valid boolean := false;
  v_link_revoked_count integer := 0;
  v_request_reopened boolean := false;
  v_correlation_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF NOT coalesce((p_result ->> 'connected')::boolean, false) THEN
    RETURN p_result;
  END IF;

  SELECT request.*
  INTO v_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.id = p_request_id
    AND request.user_id = p_user_id
  FOR UPDATE;
  v_request_found := FOUND;

  IF NOT v_request_found
    OR v_request.class_join_code_id IS NULL
    OR v_request.cohort_id IS NULL
    OR v_request.matched_profile_id IS DISTINCT FROM p_profile_id
    OR v_request.match_status NOT IN ('auto_linked', 'resolved')
  THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'request_state_changed');
  END IF;

  IF v_request_found
    AND v_request.class_join_code_id IS NOT NULL
    AND v_request.cohort_id IS NOT NULL
  THEN
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_class_join_codes AS code
      WHERE code.organization_id = p_organization_id
        AND code.id = v_request.class_join_code_id
        AND code.cohort_id = v_request.cohort_id
        AND code.status = 'active'
    )
    INTO v_class_scope_valid;
    IF NOT v_class_scope_valid THEN
      v_blockers := pg_catalog.array_append(v_blockers, 'class_scope_changed');
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
      AND profile.record_status = 'active'
  )
  INTO v_profile_active;
  IF NOT v_profile_active THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'profile_not_active');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_user_id
      AND member.status = 'active'
  )
  INTO v_organization_membership_active;
  IF NOT v_organization_membership_active THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'organization_membership_not_active');
  END IF;

  SELECT coalesce(
    pg_catalog.array_agg(membership.cohort_id ORDER BY membership.cohort_id),
    ARRAY[]::uuid[]
  )
  INTO v_active_cohort_ids
  FROM plugin_data.csf_profile_cohort_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = p_profile_id
    AND membership.status = 'active';

  v_active_class_valid := v_request_found
    AND v_request.cohort_id IS NOT NULL
    AND pg_catalog.cardinality(v_active_cohort_ids) = 1
    AND v_active_cohort_ids[1] IS NOT DISTINCT FROM v_request.cohort_id;
  IF NOT v_active_class_valid THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'active_class_changed');
  END IF;

  SELECT account.*
  INTO v_account
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_user_id
    AND account.profile_id = p_profile_id
    AND account.status = 'verified'
  FOR UPDATE;
  v_account_found := FOUND;
  IF NOT v_account_found THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'verified_link_changed');
  END IF;

  IF v_request_found THEN
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.target_type = 'csf_profile_link_requests'
        AND audit.target_id = v_request.id
        AND (
          (
            v_request.match_status = 'auto_linked'
            AND audit.actor_user_id = p_user_id
            AND audit.actor_profile_id = p_profile_id
            AND audit.action IN (
              'class.join_code.connected',
              'profile.account_name_connected'
            )
            AND audit.correlation_id = v_request.claim_correlation_id
            AND audit.after_data ->> 'matchStatus' = 'auto_linked'
            AND audit.after_data ->> 'cohortId' = v_request.cohort_id::text
            AND audit.after_data ->> 'classCodeId' = v_request.class_join_code_id::text
          )
          OR (
            v_request.match_status = 'resolved'
            AND audit.actor_user_id = v_request.resolved_by
            AND audit.action = 'profile.link_request_resolved'
            AND audit.after_data ->> 'decision' = 'connect'
            AND audit.after_data ->> 'profileId' = p_profile_id::text
            AND audit.created_at = v_request.resolved_at
          )
        )
    )
    INTO v_success_audit_exists;

    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.target_type = 'csf_profile_link_requests'
        AND audit.target_id = v_request.id
        AND audit.actor_user_id = p_user_id
        AND audit.actor_profile_id = p_profile_id
        AND audit.action = 'class.join_code.connected'
        AND audit.reason_code = 'verified_email_class_join'
        AND audit.correlation_id = v_request.claim_correlation_id
        AND audit.after_data ->> 'matchStatus' = 'auto_linked'
        AND audit.after_data ->> 'cohortId' = v_request.cohort_id::text
        AND audit.after_data ->> 'classCodeId' = v_request.class_join_code_id::text
    )
    INTO v_verified_email_audit_exists;
  END IF;

  IF v_request_found
    AND v_request.match_status IN ('auto_linked', 'resolved')
    AND NOT v_success_audit_exists
  THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'success_audit_missing');
  END IF;

  IF v_account_found AND v_request_found AND v_success_audit_exists THEN
    v_request_owns_current_link := CASE v_request.match_status
      WHEN 'auto_linked' THEN
        v_request.resolved_at IS NOT NULL
        AND v_account.linked_at = v_request.resolved_at
        AND v_account.linked_by = p_user_id
        AND v_account.notes IN (
          'Connected by one exact verified-email class match.',
          'Connected after the member confirmed the account-name match.'
        )
      WHEN 'resolved' THEN
        v_request.resolved_at IS NOT NULL
        AND v_request.resolved_by IS NOT NULL
        AND v_account.linked_at = v_request.resolved_at
        AND v_account.linked_by = v_request.resolved_by
        AND v_account.notes = 'Resolved by a CSF officer.'
      ELSE false
    END;
  END IF;

  v_core_link_valid := v_account_found
    AND v_class_scope_valid
    AND v_profile_active
    AND v_organization_membership_active
    AND v_active_class_valid;

  IF pg_catalog.cardinality(v_blockers) = 0 OR v_core_link_valid THEN
    IF v_request_found
      AND v_request.match_status = 'auto_linked'
      AND v_verified_email_audit_exists
      AND v_account_found
      AND v_account.notes = 'Connected by one exact verified-email class match.'
      AND v_request.resolution_notes =
        'Connected by one exact verified-email match in the selected class.'
    THEN
      RETURN p_result || pg_catalog.jsonb_build_object(
        'connectionBasis', 'verified_email',
        'verifiedEmailMatch', true
      );
    END IF;
    RETURN p_result;
  END IF;

  IF v_request_owns_current_link THEN
    UPDATE plugin_data.csf_profile_accounts
    SET status = 'revoked',
        is_primary = false,
        revoked_at = v_now,
        notes = 'Automatic safety hold after the class connection changed.'
    WHERE id = v_account.id
      AND status = 'verified';
    GET DIAGNOSTICS v_link_revoked_count = ROW_COUNT;
  END IF;

  IF v_request_found AND v_request.match_status IN ('auto_linked', 'resolved') THEN
    UPDATE plugin_data.csf_profile_link_requests
    SET match_status = 'needs_review',
        resolution_notes =
          'The previous account connection changed and requires officer review.',
        resolved_by = NULL,
        resolved_at = NULL,
        updated_at = v_now
    WHERE id = v_request.id;
    v_request_reopened := true;
  END IF;

  IF v_request_reopened THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, actor_profile_id, action, target_type,
      target_id, before_data, after_data, correlation_id, source_type,
      source_id, reason_code
    ) VALUES (
      p_organization_id, p_user_id, p_profile_id,
      'profile.link_request_revalidation_failed',
      'csf_profile_link_requests', v_request.id,
      pg_catalog.jsonb_build_object(
        'matchStatus', v_request.match_status,
        'profileLinkStatus', CASE WHEN v_account_found THEN 'verified' ELSE 'missing' END
      ),
      pg_catalog.jsonb_build_object(
        'matchStatus', CASE
          WHEN v_request_reopened THEN 'needs_review'
          ELSE v_request.match_status
        END,
        'profileLinkStatus', CASE
          WHEN v_link_revoked_count > 0 THEN 'revoked'
          ELSE 'unchanged'
        END,
        'blockerCodes', pg_catalog.to_jsonb(v_blockers),
        'classCodeId', v_request.class_join_code_id,
        'cohortId', v_request.cohort_id
      ),
      v_correlation_id, 'profile_connection_revalidation',
      coalesce(v_request.id::text, p_user_id::text),
      'profile_connection_revalidation_required'
    );
  END IF;

  RETURN p_result || pg_catalog.jsonb_build_object(
    'connected', false,
    'needsReview', v_request_reopened OR coalesce(v_request.match_status IN ('pending', 'needs_review'), false),
    'rejected', coalesce(v_request.match_status = 'rejected', false),
    'termMembershipCreated', false,
    'replayed', coalesce((p_result ->> 'replayed')::boolean, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_revalidate_class_code_connection_replay(
  uuid, uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_revalidate_class_code_connection_replay(
  uuid, uuid, uuid, uuid, jsonb
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_revalidate_class_code_connection_replay(
  uuid, uuid, uuid, uuid, jsonb
) IS
  'Owner-internal postcondition for class connections. It appends verified-email proof only when the locked request, link note, and exact audit lineage agree. A stale replay revokes only a link proved to belong to that request; newer or independent links remain unchanged.';

ALTER FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) RENAME TO csf_join_class_by_code_identity_base;

REVOKE ALL ON FUNCTION plugin_data.csf_join_class_by_code_identity_base(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_join_class_by_code_identity_base(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_join_class_by_code(
  p_organization_id uuid,
  p_code text,
  p_user_id uuid,
  p_verified_email text,
  p_first_name text,
  p_last_name text,
  p_preferred_name text DEFAULT NULL,
  p_confirmed_profile_id uuid DEFAULT NULL,
  p_declined_profile_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  v_result := plugin_data.csf_join_class_by_code_identity_base(
    p_organization_id,
    p_code,
    p_user_id,
    p_verified_email,
    p_first_name,
    p_last_name,
    p_preferred_name,
    p_confirmed_profile_id,
    p_declined_profile_id
  );
  RETURN plugin_data.csf_revalidate_class_code_connection_replay(
    p_organization_id,
    p_user_id,
    nullif(v_result ->> 'profileId', '')::uuid,
    nullif(v_result ->> 'requestId', '')::uuid,
    v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_join_class_by_code_identity_base(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) IS
  'Owner-internal class-code connection body. Callers must enter through the service-only wrapper, which takes the organization identity lock first.';

COMMENT ON FUNCTION plugin_data.csf_join_class_by_code(
  uuid, text, uuid, text, text, text, text, uuid, uuid
) IS
  'Service-only class-code connection boundary. Takes the organization identity lock before delegating to the preserved connection body.';

ALTER FUNCTION plugin_data.csf_confirm_class_code_account_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text
) RENAME TO csf_confirm_class_code_account_name_match_identity_base;

REVOKE ALL ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match_identity_base(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match_identity_base(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text
) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_confirm_class_code_account_name_match(
  p_organization_id uuid,
  p_profile_id uuid,
  p_user_id uuid,
  p_verified_email text,
  p_class_join_code_id uuid,
  p_cohort_id uuid,
  p_normalized_first_name text,
  p_normalized_last_name text,
  p_account_name_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
  v_email text := pg_catalog.lower(
    nullif(pg_catalog.btrim(coalesce(p_verified_email, '')), '')
  );
  v_result jsonb;
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  -- Preserve the public boundary's validation order before resolving the
  -- signed class-code identifier. The owner base rechecks this email against
  -- auth.users before it can connect or create a review request.
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'A verified account email is required.';
  END IF;

  SELECT code.code
  INTO v_code
  FROM plugin_data.csf_class_join_codes AS code
  WHERE code.organization_id = p_organization_id
    AND code.id = p_class_join_code_id
    AND code.cohort_id = p_cohort_id
    AND code.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF class code is no longer active.';
  END IF;

  v_result := plugin_data.csf_join_class_by_code_identity_base(
    p_organization_id,
    v_code,
    p_user_id,
    p_verified_email,
    p_normalized_first_name,
    p_normalized_last_name,
    NULL,
    NULL,
    NULL
  );
  RETURN plugin_data.csf_revalidate_class_code_connection_replay(
    p_organization_id,
    p_user_id,
    nullif(v_result ->> 'profileId', '')::uuid,
    nullif(v_result ->> 'requestId', '')::uuid,
    v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match_identity_base(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text
) IS
  'Deprecated owner-internal passive name-link body retained only for migration compatibility. No callable wrapper delegates to it.';

COMMENT ON FUNCTION plugin_data.csf_confirm_class_code_account_name_match(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text
) IS
  'Service-only passive class-code confirmation boundary. A name-only confirmation creates or replays one officer-review request; only an exact verified-email match can connect automatically.';

-- Officer search must accept the exact name shown in the roster. When a
-- preferred name exists, the UI shows preferred name plus last name. Otherwise
-- it shows first, middle, and last name. Keep the original individual fields in
-- the search document so partial first-name, preferred-name, and email searches
-- continue to work.
CREATE OR REPLACE FUNCTION plugin_data.csf_list_profiles_page(
  p_organization_id uuid,
  p_view text DEFAULT 'directory',
  p_search text DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL,
  p_account text DEFAULT NULL,
  p_standing text DEFAULT NULL,
  p_sort text DEFAULT 'name',
  p_cursor_primary text DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 51
)
RETURNS TABLE (
  profile_id uuid,
  cursor_primary text,
  cursor_id uuid,
  total_count bigint,
  directory_count bigint,
  current_count bigint,
  senior_count bigint,
  connected_count bigint,
  attention_count bigint,
  verified_points numeric,
  pending_points numeric,
  meetings_attended bigint,
  required_points numeric,
  required_meetings integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, plugin_data
AS $$
  WITH current_term AS (
    SELECT
      term.id,
      term.school_year,
      policy.total_points_required,
      policy.required_meetings,
      policy.dues_required
    FROM plugin_data.csf_terms term
    LEFT JOIN LATERAL (
      SELECT total_points_required, required_meetings, dues_required
      FROM plugin_data.csf_term_policies
      WHERE organization_id = p_organization_id
        AND term_id = term.id
      ORDER BY policy_version DESC
      LIMIT 1
    ) policy ON true
    WHERE term.organization_id = p_organization_id
      AND term.is_current = true
    ORDER BY term.updated_at DESC, term.id
    LIMIT 1
  ),
  base AS (
    SELECT
      profile.id,
      profile.first_name,
      profile.middle_name,
      profile.last_name,
      profile.preferred_name,
      profile.school_email,
      profile.personal_email,
      profile.created_at,
      profile.updated_at,
      lower(concat_ws(' ', profile.last_name, profile.first_name, profile.preferred_name, profile.id::text)) AS name_sort,
      cohort_membership.cohort_id,
      cohort.label AS cohort_label,
      cohort.graduation_year,
      coalesce(account.status, 'unlinked') AS account_status,
      application.id AS application_id,
      application.submission_status,
      application.eligibility_status,
      application.decision_status,
      dues.status AS dues_status,
      term_membership.id AS term_membership_id,
      coalesce(term_membership.override_status, term_membership.status) AS membership_status,
      current_term.id AS current_term_id,
      current_term.school_year,
      current_term.total_points_required,
      current_term.required_meetings,
      current_term.dues_required,
      coalesce(credit_totals.verified_points, 0::numeric) AS verified_points,
      coalesce(credit_totals.pending_points, 0::numeric) AS pending_points,
      coalesce(attendance.meetings_attended, 0::bigint) AS meetings_attended
    FROM plugin_data.csf_profiles profile
    LEFT JOIN current_term ON true
    LEFT JOIN LATERAL (
      SELECT membership.cohort_id
      FROM plugin_data.csf_profile_cohort_memberships membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = profile.id
        AND membership.status <> 'archived'
      ORDER BY membership.created_at DESC, membership.id DESC
      LIMIT 1
    ) cohort_membership ON true
    LEFT JOIN plugin_data.csf_cohorts cohort
      ON cohort.organization_id = p_organization_id
     AND cohort.id = cohort_membership.cohort_id
    LEFT JOIN LATERAL (
      SELECT profile_account.status
      FROM plugin_data.csf_profile_accounts profile_account
      WHERE profile_account.organization_id = p_organization_id
        AND profile_account.profile_id = profile.id
      ORDER BY
        (profile_account.status = 'verified' AND profile_account.is_primary) DESC,
        (profile_account.status = 'verified') DESC,
        profile_account.is_primary DESC,
        profile_account.linked_at DESC NULLS LAST,
        profile_account.id DESC
      LIMIT 1
    ) account ON true
    LEFT JOIN LATERAL (
      SELECT
        term_application.id,
        term_application.submission_status,
        term_application.eligibility_status,
        term_application.decision_status
      FROM plugin_data.csf_term_applications term_application
      WHERE term_application.organization_id = p_organization_id
        AND term_application.profile_id = profile.id
        AND term_application.term_id = current_term.id
      ORDER BY term_application.submitted_at DESC NULLS LAST, term_application.created_at DESC
      LIMIT 1
    ) application ON true
    LEFT JOIN LATERAL (
      SELECT dues_record.status
      FROM plugin_data.csf_dues_records dues_record
      WHERE dues_record.organization_id = p_organization_id
        AND dues_record.profile_id = profile.id
        AND dues_record.term_id = current_term.id
      ORDER BY dues_record.updated_at DESC, dues_record.id DESC
      LIMIT 1
    ) dues ON true
    LEFT JOIN LATERAL (
      SELECT membership.id, membership.status, membership.override_status
      FROM plugin_data.csf_term_memberships membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = profile.id
        AND membership.term_id = current_term.id
      ORDER BY membership.updated_at DESC, membership.id DESC
      LIMIT 1
    ) term_membership ON true
    LEFT JOIN LATERAL (
      SELECT
        coalesce(sum(credit.points) FILTER (WHERE credit.status = 'verified'), 0::numeric) AS verified_points,
        coalesce(sum(credit.points) FILTER (WHERE credit.status = 'pending'), 0::numeric) AS pending_points
      FROM plugin_data.csf_credit_records credit
      WHERE credit.organization_id = p_organization_id
        AND credit.profile_id = profile.id
        AND credit.term_id = current_term.id
    ) credit_totals ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE meeting_attendance.status = 'attended') AS meetings_attended
      FROM plugin_data.csf_meeting_attendance meeting_attendance
      WHERE meeting_attendance.organization_id = p_organization_id
        AND meeting_attendance.profile_id = profile.id
        AND meeting_attendance.term_id = current_term.id
    ) attendance ON true
    WHERE profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
  ),
  enriched AS (
    SELECT
      base.*,
      (application_id IS NOT NULL OR term_membership_id IS NOT NULL) AS has_current_record,
      (
        graduation_year IS NOT NULL
        AND graduation_year = nullif(substring(coalesce(school_year, '') from '([0-9]{4})$'), '')::integer
      ) AS is_senior,
      (cohort_id IS NULL) AS needs_class,
      (account_status <> 'verified') AS needs_link,
      (
        application_id IS NULL
        OR coalesce(decision_status, 'pending') = 'pending'
        OR coalesce(submission_status, 'imported') IN ('imported', 'missing_information', 'ready', 'under_review')
      ) AS application_needs,
      (
        application_id IS NULL
        OR coalesce(eligibility_status, 'pending') NOT IN ('eligible', 'adviser_override')
      ) AS eligibility_needs,
      (
        application_id IS NULL
        OR (
          coalesce(dues_required, true)
          AND coalesce(dues_status, 'not_recorded') NOT IN ('verified', 'waived', 'not_required')
        )
      ) AS dues_needs,
      (
        term_membership_id IS NULL
        OR coalesce(membership_status, 'pending') NOT IN ('accepted', 'active', 'completed')
      ) AS membership_needs
    FROM base
  ),
  derived AS (
    SELECT
      enriched.*,
      (
        needs_class
        OR needs_link
        OR application_needs
        OR eligibility_needs
        OR dues_needs
        OR membership_needs
        OR pending_points > 0
      ) AS needs_attention
    FROM enriched
  ),
  directory_counts AS (
    SELECT
      count(*) AS directory_count,
      count(*) FILTER (WHERE has_current_record) AS current_count,
      count(*) FILTER (WHERE is_senior) AS senior_count,
      count(*) FILTER (WHERE account_status = 'verified') AS connected_count,
      count(*) FILTER (WHERE needs_attention) AS attention_count
    FROM derived
    WHERE p_cohort_id IS NULL OR cohort_id = p_cohort_id
  ),
  filtered AS (
    SELECT derived.*
    FROM derived
    WHERE
      (p_view = 'directory' OR (p_view = 'current' AND has_current_record) OR (p_view = 'seniors' AND is_senior))
      AND (p_cohort_id IS NULL OR cohort_id = p_cohort_id)
      AND (
        p_account IS NULL OR p_account = 'all'
        OR (p_account = 'verified' AND account_status = 'verified')
        OR (p_account = 'unlinked' AND account_status = 'unlinked')
        OR (p_account = 'pending' AND account_status NOT IN ('verified', 'unlinked'))
      )
      AND (
        p_standing IS NULL OR p_standing = 'all'
        OR (p_standing = 'attention' AND needs_attention)
        OR (p_standing = 'application' AND application_needs)
        OR (p_standing = 'eligibility' AND eligibility_needs)
        OR (p_standing = 'dues' AND dues_needs)
        OR (p_standing = 'membership_complete' AND membership_status = 'completed')
        OR (p_standing = 'pending_points' AND pending_points > 0)
        OR (p_standing = 'unlinked' AND needs_link)
      )
      AND (
        nullif(btrim(p_search), '') IS NULL
        OR lower(concat_ws(
          ' ',
          coalesce(
            nullif(btrim(preferred_name), ''),
            nullif(btrim(first_name), '')
          ),
          CASE
            WHEN nullif(btrim(preferred_name), '') IS NULL
              THEN nullif(btrim(middle_name), '')
            ELSE NULL
          END,
          nullif(btrim(last_name), ''),
          first_name, preferred_name, middle_name,
          school_email, personal_email, cohort_label, account_status,
          submission_status, eligibility_status, dues_status, membership_status
        )) LIKE '%' || lower(btrim(p_search)) || '%'
      )
  ),
  numbered AS (
    SELECT filtered.*, count(*) OVER () AS unpaged_count
    FROM filtered
  ),
  after_cursor AS (
    SELECT numbered.*
    FROM numbered
    WHERE p_cursor_primary IS NULL OR p_cursor_id IS NULL OR (
      (p_sort = 'updated' AND (
        coalesce(updated_at, created_at) < p_cursor_primary::timestamptz
        OR (coalesce(updated_at, created_at) = p_cursor_primary::timestamptz AND id > p_cursor_id)
      ))
      OR (p_sort = 'class' AND (
        coalesce(graduation_year, 9999) > p_cursor_primary::integer
        OR (coalesce(graduation_year, 9999) = p_cursor_primary::integer AND id > p_cursor_id)
      ))
      OR (p_sort NOT IN ('updated', 'class') AND (
        name_sort > p_cursor_primary
        OR (name_sort = p_cursor_primary AND id > p_cursor_id)
      ))
    )
  ),
  paged AS (
    SELECT
      after_cursor.id AS profile_id,
      CASE p_sort
        WHEN 'updated' THEN coalesce(after_cursor.updated_at, after_cursor.created_at)::text
        WHEN 'class' THEN coalesce(after_cursor.graduation_year, 9999)::text
        ELSE after_cursor.name_sort
      END AS cursor_primary,
      after_cursor.id AS cursor_id,
      after_cursor.unpaged_count AS total_count,
      directory_counts.directory_count,
      directory_counts.current_count,
      directory_counts.senior_count,
      directory_counts.connected_count,
      directory_counts.attention_count,
      after_cursor.verified_points,
      after_cursor.pending_points,
      after_cursor.meetings_attended,
      after_cursor.total_points_required AS required_points,
      after_cursor.required_meetings
    FROM after_cursor
    CROSS JOIN directory_counts
    ORDER BY
      CASE WHEN p_sort = 'updated' THEN coalesce(after_cursor.updated_at, after_cursor.created_at) END DESC,
      CASE WHEN p_sort = 'class' THEN coalesce(after_cursor.graduation_year, 9999) END ASC,
      CASE WHEN p_sort NOT IN ('updated', 'class') THEN after_cursor.name_sort END ASC,
      after_cursor.id ASC
    LIMIT least(greatest(p_page_size, 1), 101)
  )
  SELECT * FROM paged
  UNION ALL
  SELECT
    NULL::uuid,
    NULL::text,
    NULL::uuid,
    (SELECT count(*) FROM filtered)::bigint,
    directory_counts.directory_count,
    directory_counts.current_count,
    directory_counts.senior_count,
    directory_counts.connected_count,
    directory_counts.attention_count,
    0::numeric,
    0::numeric,
    0::bigint,
    NULL::numeric,
    NULL::integer
  FROM directory_counts
  WHERE NOT EXISTS (SELECT 1 FROM paged);
$$;


REVOKE ALL ON FUNCTION plugin_data.csf_list_profiles_page(uuid, text, text, uuid, text, text, text, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_profiles_page(uuid, text, text, uuid, text, text, text, text, uuid, integer)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_list_profiles_page(uuid, text, text, uuid, text, text, text, text, uuid, integer) IS
  'Returns tenant-scoped member-directory IDs, current-semester progress, cohort-scoped view counts when a class is selected, and a keyset cursor without loading historical relations.';


CREATE OR REPLACE FUNCTION plugin_data.csf_list_class_profiles_page(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_search text DEFAULT NULL,
  p_account text DEFAULT NULL,
  p_standing text DEFAULT NULL,
  p_sort text DEFAULT 'name',
  p_cursor_primary text DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 51
)
RETURNS TABLE (
  profile_id uuid,
  cursor_primary text,
  cursor_id uuid,
  total_count bigint,
  directory_count bigint,
  current_count bigint,
  senior_count bigint,
  connected_count bigint,
  attention_count bigint,
  verified_points numeric,
  pending_points numeric,
  meetings_attended bigint,
  required_points numeric,
  required_meetings integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, plugin_data
AS $$
  WITH selected_term AS (
    SELECT
      term.id,
      term.school_year,
      policy.total_points_required,
      policy.required_meetings,
      policy.dues_required
    FROM plugin_data.csf_terms AS term
    LEFT JOIN LATERAL (
      SELECT
        term_policy.total_points_required,
        term_policy.required_meetings,
        term_policy.dues_required
      FROM plugin_data.csf_term_policies AS term_policy
      WHERE term_policy.organization_id = p_organization_id
        AND term_policy.term_id = term.id
      ORDER BY term_policy.policy_version DESC
      LIMIT 1
    ) AS policy ON true
    WHERE term.organization_id = p_organization_id
      AND term.id = p_term_id
  ),
  base AS (
    SELECT
      profile.id,
      profile.first_name,
      profile.middle_name,
      profile.last_name,
      profile.preferred_name,
      profile.school_email,
      profile.personal_email,
      profile.created_at,
      profile.updated_at,
      lower(concat_ws(
        ' ', profile.last_name, profile.first_name,
        profile.preferred_name, profile.id::text
      )) AS name_sort,
      cohort.graduation_year,
      coalesce(account.status, 'unlinked') AS account_status,
      application.id AS application_id,
      application.submission_status,
      application.eligibility_status,
      application.decision_status,
      dues.status AS dues_status,
      coalesce(membership.override_status, membership.status) AS membership_status,
      selected_term.school_year,
      selected_term.total_points_required,
      selected_term.required_meetings,
      selected_term.dues_required,
      coalesce(credit_totals.verified_points, 0::numeric) AS verified_points,
      coalesce(credit_totals.pending_points, 0::numeric) AS pending_points,
      coalesce(attendance.meetings_attended, 0::bigint) AS meetings_attended
    FROM selected_term
    JOIN plugin_data.csf_term_memberships AS membership
      ON membership.organization_id = p_organization_id
     AND membership.term_id = selected_term.id
     AND membership.cohort_id = p_cohort_id
     AND coalesce(membership.override_status, membership.status)
       IN ('accepted', 'active', 'completed', 'not_completed')
    JOIN plugin_data.csf_profiles AS profile
      ON profile.organization_id = p_organization_id
     AND profile.id = membership.profile_id
     AND profile.record_status = 'active'
    JOIN plugin_data.csf_cohorts AS cohort
      ON cohort.organization_id = p_organization_id
     AND cohort.id = p_cohort_id
    LEFT JOIN LATERAL (
      SELECT profile_account.status
      FROM plugin_data.csf_profile_accounts AS profile_account
      WHERE profile_account.organization_id = p_organization_id
        AND profile_account.profile_id = profile.id
      ORDER BY
        (profile_account.status = 'verified' AND profile_account.is_primary) DESC,
        (profile_account.status = 'verified') DESC,
        profile_account.is_primary DESC,
        profile_account.linked_at DESC NULLS LAST,
        profile_account.id DESC
      LIMIT 1
    ) AS account ON true
    LEFT JOIN LATERAL (
      SELECT
        term_application.id,
        term_application.submission_status,
        term_application.eligibility_status,
        term_application.decision_status
      FROM plugin_data.csf_term_applications AS term_application
      WHERE term_application.organization_id = p_organization_id
        AND term_application.profile_id = profile.id
        AND term_application.term_id = selected_term.id
        AND term_application.cohort_id = p_cohort_id
      ORDER BY
        term_application.submitted_at DESC NULLS LAST,
        term_application.created_at DESC
      LIMIT 1
    ) AS application ON true
    LEFT JOIN LATERAL (
      SELECT dues_record.status
      FROM plugin_data.csf_dues_records AS dues_record
      WHERE dues_record.organization_id = p_organization_id
        AND dues_record.profile_id = profile.id
        AND dues_record.term_id = selected_term.id
      ORDER BY dues_record.updated_at DESC, dues_record.id DESC
      LIMIT 1
    ) AS dues ON true
    LEFT JOIN LATERAL (
      SELECT
        coalesce(sum(credit.points) FILTER (
          WHERE credit.status = 'verified'
        ), 0::numeric) AS verified_points,
        coalesce(sum(credit.points) FILTER (
          WHERE credit.status = 'pending'
        ), 0::numeric) AS pending_points
      FROM plugin_data.csf_credit_records AS credit
      WHERE credit.organization_id = p_organization_id
        AND credit.profile_id = profile.id
        AND credit.term_id = selected_term.id
    ) AS credit_totals ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (
        WHERE meeting_attendance.status = 'attended'
      ) AS meetings_attended
      FROM plugin_data.csf_meeting_attendance AS meeting_attendance
      WHERE meeting_attendance.organization_id = p_organization_id
        AND meeting_attendance.profile_id = profile.id
        AND meeting_attendance.term_id = selected_term.id
    ) AS attendance ON true
  ),
  enriched AS (
    SELECT
      base.*,
      (
        graduation_year = nullif(
          substring(coalesce(school_year, '') from '([0-9]{4})$'),
          ''
        )::integer
      ) AS is_senior,
      (account_status <> 'verified') AS needs_link,
      (
        application_id IS NULL
        OR coalesce(decision_status, 'pending') = 'pending'
        OR coalesce(submission_status, 'imported')
          IN ('imported', 'missing_information', 'ready', 'under_review')
      ) AS application_needs,
      (
        application_id IS NULL
        OR coalesce(eligibility_status, 'pending')
          NOT IN ('eligible', 'adviser_override')
      ) AS eligibility_needs,
      (
        application_id IS NULL
        OR (
          coalesce(dues_required, true)
          AND coalesce(dues_status, 'not_recorded')
            NOT IN ('verified', 'waived', 'not_required')
        )
      ) AS dues_needs,
      (membership_status NOT IN ('accepted', 'active', 'completed'))
        AS membership_needs
    FROM base
  ),
  derived AS (
    SELECT
      enriched.*,
      (
        needs_link OR application_needs OR eligibility_needs
        OR dues_needs OR membership_needs OR pending_points > 0
      ) AS needs_attention
    FROM enriched
  ),
  filtered AS (
    SELECT derived.*
    FROM derived
    WHERE
      (
        p_account IS NULL OR p_account = 'all'
        OR (p_account = 'verified' AND account_status = 'verified')
        OR (p_account = 'unlinked' AND account_status = 'unlinked')
        OR (p_account = 'pending' AND account_status NOT IN ('verified', 'unlinked'))
      )
      AND (
        p_standing IS NULL OR p_standing = 'all'
        OR (p_standing = 'attention' AND needs_attention)
        OR (p_standing = 'application' AND application_needs)
        OR (p_standing = 'eligibility' AND eligibility_needs)
        OR (p_standing = 'dues' AND dues_needs)
        OR (p_standing = 'membership_complete' AND membership_status = 'completed')
        OR (p_standing = 'pending_points' AND pending_points > 0)
        OR (p_standing = 'unlinked' AND needs_link)
      )
      AND (
        nullif(btrim(p_search), '') IS NULL
        OR lower(concat_ws(
          ' ',
          coalesce(
            nullif(btrim(preferred_name), ''),
            nullif(btrim(first_name), '')
          ),
          CASE
            WHEN nullif(btrim(preferred_name), '') IS NULL
              THEN nullif(btrim(middle_name), '')
            ELSE NULL
          END,
          nullif(btrim(last_name), ''),
          first_name, preferred_name, middle_name,
          school_email, personal_email, account_status,
          submission_status, eligibility_status, dues_status,
          membership_status
        )) LIKE '%' || lower(btrim(p_search)) || '%'
      )
  ),
  counts AS (
    SELECT
      count(*) AS member_count,
      count(*) FILTER (WHERE is_senior) AS senior_count,
      count(*) FILTER (WHERE account_status = 'verified') AS connected_count,
      count(*) FILTER (WHERE needs_attention) AS attention_count
    FROM derived
  ),
  numbered AS (
    SELECT filtered.*, count(*) OVER () AS unpaged_count
    FROM filtered
  ),
  after_cursor AS (
    SELECT numbered.*
    FROM numbered
    WHERE p_cursor_primary IS NULL OR p_cursor_id IS NULL OR (
      (p_sort = 'updated' AND (
        coalesce(updated_at, created_at) < p_cursor_primary::timestamptz
        OR (
          coalesce(updated_at, created_at) = p_cursor_primary::timestamptz
          AND id > p_cursor_id
        )
      ))
      OR (p_sort = 'class' AND (
        graduation_year > p_cursor_primary::integer
        OR (graduation_year = p_cursor_primary::integer AND id > p_cursor_id)
      ))
      OR (p_sort NOT IN ('updated', 'class') AND (
        name_sort > p_cursor_primary
        OR (name_sort = p_cursor_primary AND id > p_cursor_id)
      ))
    )
  ),
  paged AS (
    SELECT
      after_cursor.id AS profile_id,
      CASE p_sort
        WHEN 'updated' THEN coalesce(after_cursor.updated_at, after_cursor.created_at)::text
        WHEN 'class' THEN after_cursor.graduation_year::text
        ELSE after_cursor.name_sort
      END AS cursor_primary,
      after_cursor.id AS cursor_id,
      after_cursor.unpaged_count AS total_count,
      counts.member_count AS directory_count,
      counts.member_count AS current_count,
      counts.senior_count,
      counts.connected_count,
      counts.attention_count,
      after_cursor.verified_points,
      after_cursor.pending_points,
      after_cursor.meetings_attended,
      after_cursor.total_points_required AS required_points,
      after_cursor.required_meetings
    FROM after_cursor
    CROSS JOIN counts
    ORDER BY
      CASE WHEN p_sort = 'updated'
        THEN coalesce(after_cursor.updated_at, after_cursor.created_at) END DESC,
      CASE WHEN p_sort = 'class' THEN after_cursor.graduation_year END ASC,
      CASE WHEN p_sort NOT IN ('updated', 'class')
        THEN after_cursor.name_sort END ASC,
      after_cursor.id ASC
    LIMIT least(greatest(p_page_size, 1), 101)
  )
  SELECT * FROM paged
  UNION ALL
  SELECT
    NULL::uuid,
    NULL::text,
    NULL::uuid,
    (SELECT count(*) FROM filtered)::bigint,
    counts.member_count,
    counts.member_count,
    counts.senior_count,
    counts.connected_count,
    counts.attention_count,
    0::numeric,
    0::numeric,
    0::bigint,
    NULL::numeric,
    NULL::integer
  FROM counts
  WHERE NOT EXISTS (SELECT 1 FROM paged);
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_list_class_profiles_page(
  uuid, uuid, uuid, text, text, text, text, text, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_class_profiles_page(
  uuid, uuid, uuid, text, text, text, text, text, uuid, integer
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_list_class_profiles_page(
  uuid, uuid, uuid, text, text, text, text, text, uuid, integer
) IS 'Server-only, organization/class/term-scoped CSF member page projection.';



COMMIT;
