-- Keep historical class profiles visible while projecting one selected term
-- and replace per-class count fanout with one bounded service-only read.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_list_class_directory_page(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_view text DEFAULT 'directory',
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
SET search_path = ''
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
  selected_cohort AS (
    SELECT cohort.id, cohort.label, cohort.graduation_year
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = p_organization_id
      AND cohort.id = p_cohort_id
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
      selected_cohort.label AS cohort_label,
      selected_cohort.graduation_year,
      coalesce(account.status, 'unlinked') AS account_status,
      application.id AS application_id,
      application.submission_status,
      application.eligibility_status,
      application.decision_status,
      dues.status AS dues_status,
      membership.id AS term_membership_id,
      coalesce(membership.override_status, membership.status)
        AS membership_status,
      selected_term.school_year,
      selected_term.total_points_required,
      selected_term.required_meetings,
      selected_term.dues_required,
      coalesce(credit_totals.verified_points, 0::numeric) AS verified_points,
      coalesce(credit_totals.pending_points, 0::numeric) AS pending_points,
      coalesce(attendance.meetings_attended, 0::bigint)
        AS meetings_attended
    FROM selected_term
    CROSS JOIN selected_cohort
    JOIN plugin_data.csf_profiles AS profile
      ON profile.organization_id = p_organization_id
     AND profile.record_status = 'active'
    JOIN LATERAL (
      SELECT profile_cohort.id
      FROM plugin_data.csf_profile_cohort_memberships AS profile_cohort
      WHERE profile_cohort.organization_id = p_organization_id
        AND profile_cohort.profile_id = profile.id
        AND profile_cohort.cohort_id = selected_cohort.id
        AND profile_cohort.status <> 'archived'
      ORDER BY profile_cohort.created_at DESC, profile_cohort.id DESC
      LIMIT 1
    ) AS profile_cohort ON true
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
        AND term_application.cohort_id = selected_cohort.id
      ORDER BY
        term_application.submitted_at DESC NULLS LAST,
        term_application.created_at DESC,
        term_application.id DESC
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
        term_membership.id,
        term_membership.status,
        term_membership.override_status
      FROM plugin_data.csf_term_memberships AS term_membership
      WHERE term_membership.organization_id = p_organization_id
        AND term_membership.profile_id = profile.id
        AND term_membership.term_id = selected_term.id
        AND term_membership.cohort_id = selected_cohort.id
      ORDER BY term_membership.updated_at DESC, term_membership.id DESC
      LIMIT 1
    ) AS membership ON true
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
        membership_status IN ('accepted', 'active', 'completed', 'not_completed')
      ) AS is_current_member,
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
      (
        term_membership_id IS NULL
        OR coalesce(membership_status, 'pending')
          NOT IN (
            'accepted', 'active', 'completed', 'not_completed',
            'withdrawn', 'revoked'
          )
      ) AS membership_needs
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
  directory_counts AS (
    SELECT
      count(*) AS directory_count,
      count(*) FILTER (WHERE is_current_member) AS current_count,
      count(*) FILTER (WHERE is_senior) AS senior_count,
      count(*) FILTER (WHERE account_status = 'verified') AS connected_count,
      count(*) FILTER (WHERE needs_attention) AS attention_count
    FROM derived
  ),
  filtered AS (
    SELECT derived.*
    FROM derived
    WHERE
      (
        p_view = 'directory'
        OR (p_view = 'current' AND is_current_member)
        OR (p_view = 'seniors' AND is_senior)
      )
      AND (
        p_account IS NULL OR p_account = 'all'
        OR (p_account = 'verified' AND account_status = 'verified')
        OR (p_account = 'unlinked' AND account_status = 'unlinked')
        OR (
          p_account = 'pending'
          AND account_status NOT IN ('verified', 'unlinked')
        )
      )
      AND (
        p_standing IS NULL OR p_standing = 'all'
        OR (p_standing = 'attention' AND needs_attention)
        OR (p_standing = 'application' AND application_needs)
        OR (p_standing = 'eligibility' AND eligibility_needs)
        OR (p_standing = 'dues' AND dues_needs)
        OR (
          p_standing = 'membership_complete'
          AND membership_status = 'completed'
        )
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
          submission_status, eligibility_status, dues_status,
          membership_status
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
        WHEN 'updated' THEN coalesce(
          after_cursor.updated_at, after_cursor.created_at
        )::text
        WHEN 'class' THEN after_cursor.graduation_year::text
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

REVOKE ALL ON FUNCTION plugin_data.csf_list_class_directory_page(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_class_directory_page(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, integer
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_list_class_directory_page(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, integer
) IS 'Returns one service-only, tenant-scoped class directory page with selected-term state and both durable-directory and accepted-term-member counts.';

CREATE OR REPLACE FUNCTION plugin_data.csf_count_cohort_term_members(
  p_organization_id uuid,
  p_cohort_ids uuid[],
  p_term_id uuid
)
RETURNS TABLE (
  cohort_id uuid,
  member_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_cohort_ids IS NULL OR coalesce(cardinality(p_cohort_ids), 0) = 0 THEN
    RETURN;
  END IF;

  IF cardinality(p_cohort_ids) > 100 THEN
    RAISE EXCEPTION 'CSF cohort count scope exceeds 100 classes.'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested_cohorts AS (
    SELECT DISTINCT requested.cohort_id
    FROM unnest(p_cohort_ids) AS requested(cohort_id)
    WHERE requested.cohort_id IS NOT NULL
  ),
  selected_term AS (
    SELECT term.id
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = p_term_id
  ),
  selected_cohorts AS (
    SELECT cohort.id
    FROM plugin_data.csf_cohorts AS cohort
    JOIN requested_cohorts AS requested
      ON requested.cohort_id = cohort.id
    WHERE cohort.organization_id = p_organization_id
  )
  SELECT
    cohort.id AS cohort_id,
    count(profile.id)::bigint AS member_count
  FROM selected_cohorts AS cohort
  CROSS JOIN selected_term
  LEFT JOIN plugin_data.csf_term_memberships AS membership
    ON membership.organization_id = p_organization_id
   AND membership.term_id = selected_term.id
   AND membership.cohort_id = cohort.id
   AND coalesce(membership.override_status, membership.status)
     IN ('accepted', 'active', 'completed', 'not_completed')
  LEFT JOIN plugin_data.csf_profiles AS profile
    ON profile.organization_id = p_organization_id
   AND profile.id = membership.profile_id
   AND profile.record_status = 'active'
   AND EXISTS (
     SELECT 1
     FROM plugin_data.csf_profile_cohort_memberships AS profile_cohort
     WHERE profile_cohort.organization_id = p_organization_id
       AND profile_cohort.profile_id = profile.id
       AND profile_cohort.cohort_id = cohort.id
       AND profile_cohort.status <> 'archived'
   )
  GROUP BY cohort.id
  ORDER BY cohort.id;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_count_cohort_term_members(
  uuid, uuid[], uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_count_cohort_term_members(
  uuid, uuid[], uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_count_cohort_term_members(
  uuid, uuid[], uuid
) IS 'Returns selected-term member counts for at most 100 tenant-scoped classes in one service-only read.';

COMMIT;
