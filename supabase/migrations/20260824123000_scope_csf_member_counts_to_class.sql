-- Class workspaces pass a cohort filter to the shared member directory.
-- Rows honored that filter, but the header counters were computed across the
-- whole chapter. Keep organization-wide counts when no class is selected and
-- scope every counter to the selected class when one is.

BEGIN;

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
          ' ', first_name, preferred_name, last_name, school_email, personal_email,
          cohort_label, account_status, submission_status, eligibility_status, dues_status, membership_status
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

COMMIT;
