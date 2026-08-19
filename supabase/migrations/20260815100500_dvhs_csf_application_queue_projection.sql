-- Applications become an officer work queue. The queue vocabulary (mine,
-- unassigned, needs_review, waiting, completed) is one server-derived
-- predicate inside the paged projection, so every officer surface shares the
-- same membership rule instead of re-deriving it in the browser.
--
-- Adding parameters changes the function signature, so the previous overload
-- is dropped first; the ledger stays append-only by replacing forward.

BEGIN;

DROP FUNCTION IF EXISTS plugin_data.csf_list_applications_page(
  uuid, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, integer, boolean
);

CREATE OR REPLACE FUNCTION plugin_data.csf_list_applications_page(
  p_organization_id uuid,
  p_view text DEFAULT 'review',
  p_search text DEFAULT NULL,
  p_submission_status text DEFAULT NULL,
  p_eligibility_status text DEFAULT NULL,
  p_dues_status text DEFAULT NULL,
  p_decision_status text DEFAULT NULL,
  p_assignee text DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL,
  p_term_id uuid DEFAULT NULL,
  p_sort text DEFAULT 'oldest',
  p_cursor_primary text DEFAULT NULL,
  p_cursor_secondary text DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 50,
  p_include_check_summary boolean DEFAULT false,
  p_queue text DEFAULT NULL,
  p_queue_actor uuid DEFAULT NULL
)
RETURNS TABLE (
  item jsonb,
  cursor_primary text,
  cursor_secondary text,
  cursor_id uuid,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH base AS (
    SELECT
      application.*,
      profile.first_name,
      profile.preferred_name,
      profile.last_name,
      profile.school_email,
      profile.personal_email,
      profile.normalized_first_name,
      profile.normalized_last_name,
      term.code AS term_code,
      term.label AS term_label,
      cohort.label AS cohort_label,
      cohort.graduation_year,
      membership.membership_record,
      dues.dues_record,
      coalesce(
        dues.dues_status,
        CASE WHEN policy.dues_required = false THEN 'not_required' ELSE 'not_recorded' END
      ) AS resolved_dues_status,
      blocker.blocker_record,
      coalesce(application.submitted_at, application.created_at) AS sort_time,
      count(*) OVER () AS unpaged_count
    FROM plugin_data.csf_term_applications AS application
    JOIN plugin_data.csf_profiles AS profile
      ON profile.organization_id = application.organization_id
     AND profile.id = application.profile_id
    JOIN plugin_data.csf_terms AS term
      ON term.organization_id = application.organization_id
     AND term.id = application.term_id
    JOIN plugin_data.csf_cohorts AS cohort
      ON cohort.organization_id = application.organization_id
     AND cohort.id = application.cohort_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', member.id,
        'status', member.status,
        'status_reason', member.status_reason,
        'accepted_at', member.accepted_at,
        'activated_at', member.activated_at
      ) AS membership_record
      FROM plugin_data.csf_term_memberships AS member
      WHERE member.organization_id = application.organization_id
        AND member.application_id = application.id
      LIMIT 1
    ) AS membership ON true
    LEFT JOIN LATERAL (
      SELECT
        record.status::text AS dues_status,
        jsonb_build_object(
          'id', record.id,
          'status', record.status,
          'required_amount', record.required_amount,
          'paid_amount', record.paid_amount,
          'currency', record.currency,
          'verified_at', record.verified_at,
          'waived_at', record.waived_at
        ) AS dues_record
      FROM plugin_data.csf_dues_records AS record
      WHERE record.organization_id = application.organization_id
        AND record.application_id = application.id
      ORDER BY record.updated_at DESC, record.id
      LIMIT 1
    ) AS dues ON true
    LEFT JOIN LATERAL (
      SELECT term_policy.dues_required
      FROM plugin_data.csf_term_policies AS term_policy
      WHERE term_policy.organization_id = application.organization_id
        AND term_policy.term_id = application.term_id
      ORDER BY term_policy.policy_version DESC, term_policy.created_at DESC
      LIMIT 1
    ) AS policy ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', application_check.id,
        'check_type', application_check.check_type,
        'status', application_check.status,
        'mandatory', application_check.mandatory,
        'reason_code', application_check.reason_code,
        'summary', application_check.summary
      ) AS blocker_record
      FROM plugin_data.csf_application_checks AS application_check
      WHERE application_check.organization_id = application.organization_id
        AND application_check.application_id = application.id
        AND application_check.mandatory = true
        AND application_check.status::text NOT IN ('passed', 'waived', 'not_required')
      ORDER BY
        CASE application_check.status::text WHEN 'failed' THEN 0 ELSE 1 END,
        application_check.updated_at DESC,
        application_check.id
      LIMIT 1
    ) AS blocker ON true
    WHERE application.organization_id = p_organization_id
      AND (
        p_view = 'all'
        OR p_queue = 'completed'
        OR application.decision_status::text = 'pending'
      )
      AND (p_submission_status IS NULL OR application.submission_status::text = p_submission_status)
      AND (p_eligibility_status IS NULL OR application.eligibility_status::text = p_eligibility_status)
      AND (p_decision_status IS NULL OR application.decision_status::text = p_decision_status)
      AND (
        p_assignee IS NULL
        OR (p_assignee = 'assigned' AND application.assigned_to IS NOT NULL)
        OR (p_assignee = 'unassigned' AND application.assigned_to IS NULL)
        OR application.assigned_to::text = p_assignee
      )
      AND (p_cohort_id IS NULL OR application.cohort_id = p_cohort_id)
      AND (p_term_id IS NULL OR application.term_id = p_term_id)
      AND (
        p_queue IS NULL
        OR (
          p_queue = 'mine'
          AND p_queue_actor IS NOT NULL
          AND application.assigned_to = p_queue_actor
          AND application.decision_status::text = 'pending'
        )
        OR (
          p_queue = 'unassigned'
          AND application.assigned_to IS NULL
          AND application.decision_status::text = 'pending'
        )
        OR (
          p_queue = 'needs_review'
          AND application.decision_status::text = 'pending'
          AND application.submission_status::text IN ('ready', 'under_review')
        )
        OR (
          p_queue = 'waiting'
          AND application.decision_status::text = 'pending'
          AND application.submission_status::text IN ('imported', 'missing_information')
        )
        OR (
          p_queue = 'completed'
          AND application.decision_status::text <> 'pending'
        )
      )
      AND (
        p_search IS NULL
        OR btrim(p_search) = ''
        OR concat_ws(
          ' ',
          profile.normalized_first_name,
          profile.normalized_last_name,
          profile.normalized_school_email,
          profile.normalized_personal_email,
          lower(term.label),
          lower(cohort.label),
          lower(coalesce(application.source_file_name, ''))
        ) ILIKE '%' || lower(btrim(p_search)) || '%'
      )
      AND (
        p_dues_status IS NULL
        OR coalesce(
          dues.dues_status,
          CASE WHEN policy.dues_required = false THEN 'not_required' ELSE 'not_recorded' END
        ) = p_dues_status
      )
  ),
  after_cursor AS (
    SELECT *
    FROM base
    WHERE p_cursor_id IS NULL
      OR CASE p_sort
        WHEN 'newest' THEN (sort_time, id) < (p_cursor_primary::timestamptz, p_cursor_id)
        WHEN 'name' THEN (normalized_last_name, normalized_first_name, id) > (
          coalesce(p_cursor_primary, ''), coalesce(p_cursor_secondary, ''), p_cursor_id
        )
        ELSE (sort_time, id) > (p_cursor_primary::timestamptz, p_cursor_id)
      END
  )
  SELECT
    jsonb_build_object(
      'id', id,
      'profile_id', profile_id,
      'term_id', term_id,
      'cohort_id', cohort_id,
      'status', status,
      'submission_status', submission_status,
      'eligibility_status', eligibility_status,
      'decision_status', decision_status,
      'decision_reason_code', decision_reason_code,
      'decision_reason', decision_reason,
      'assigned_to', assigned_to,
      'source', source,
      'source_file_name', source_file_name,
      'current_grade_level', current_grade_level,
      'returning_status', returning_status,
      'list_i_points', list_i_points,
      'list_i_ii_points', list_i_ii_points,
      'grand_total_points', grand_total_points,
      'submitted_at', submitted_at,
      'reviewed_at', reviewed_at,
      'created_at', created_at,
      'profile', jsonb_build_object(
        'id', profile_id,
        'first_name', first_name,
        'preferred_name', preferred_name,
        'last_name', last_name,
        'school_email', school_email,
        'personal_email', personal_email
      ),
      'term', jsonb_build_object('id', term_id, 'code', term_code, 'label', term_label),
      'cohort', jsonb_build_object(
        'id', cohort_id,
        'label', cohort_label,
        'graduation_year', graduation_year
      ),
      'membership', membership_record,
      'dues', coalesce(
        dues_record,
        jsonb_build_object('status', resolved_dues_status)
      ),
      'checks', CASE
        WHEN p_include_check_summary AND blocker_record IS NOT NULL
          THEN jsonb_build_array(blocker_record)
        ELSE '[]'::jsonb
      END,
      'current_blocker', CASE WHEN p_include_check_summary THEN blocker_record ELSE NULL END
    ) AS item,
    CASE p_sort
      WHEN 'name' THEN normalized_last_name
      ELSE sort_time::text
    END AS cursor_primary,
    CASE p_sort WHEN 'name' THEN normalized_first_name ELSE NULL END AS cursor_secondary,
    id AS cursor_id,
    unpaged_count AS total_count
  FROM after_cursor
  ORDER BY
    CASE WHEN p_sort = 'oldest' THEN sort_time END ASC,
    CASE WHEN p_sort = 'oldest' THEN id END ASC,
    CASE WHEN p_sort = 'newest' THEN sort_time END DESC,
    CASE WHEN p_sort = 'newest' THEN id END DESC,
    CASE WHEN p_sort = 'name' THEN normalized_last_name END ASC,
    CASE WHEN p_sort = 'name' THEN normalized_first_name END ASC,
    CASE WHEN p_sort = 'name' THEN id END ASC
  LIMIT least(greatest(p_page_size, 1), 101);
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_list_applications_page(
  uuid, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, integer, boolean, text, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_list_applications_page(
  uuid, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, integer, boolean, text, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_list_applications_page(
  uuid, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, integer, boolean, text, uuid
) IS
  'Paged application projection with the officer work-queue predicate. p_queue in (mine, unassigned, needs_review, waiting, completed) is authoritative queue membership; mine additionally requires p_queue_actor and matches only that assignee. An unknown p_queue matches nothing rather than silently widening the queue.';

COMMIT;
