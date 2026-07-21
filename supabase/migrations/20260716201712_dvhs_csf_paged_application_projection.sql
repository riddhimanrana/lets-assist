BEGIN;

ALTER TABLE plugin_data.csf_sheet_sources
  ADD COLUMN IF NOT EXISTS source_type text;

UPDATE plugin_data.csf_sheet_sources
SET source_type = COALESCE(NULLIF(settings ->> 'sourceKind', ''), 'class_history')
WHERE source_type IS NULL;

ALTER TABLE plugin_data.csf_sheet_sources
  ALTER COLUMN source_type SET DEFAULT 'class_history',
  ALTER COLUMN source_type SET NOT NULL;

ALTER TABLE plugin_data.csf_sheet_sources
  DROP CONSTRAINT IF EXISTS csf_sheet_sources_source_type_check;

ALTER TABLE plugin_data.csf_sheet_sources
  ADD CONSTRAINT csf_sheet_sources_source_type_check CHECK (
    source_type IN (
      'application_responses',
      'student_roster',
      'class_history',
      'meeting_attendance',
      'partner_club_audit'
    )
  );

CREATE INDEX IF NOT EXISTS csf_sheet_sources_org_type_updated_idx
  ON plugin_data.csf_sheet_sources (organization_id, source_type, updated_at DESC);

ALTER FUNCTION plugin_data.csf_install_default_roles(uuid)
  RENAME TO csf_install_default_roles_projection_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_install_default_roles(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base_result jsonb;
  v_permission_count integer;
BEGIN
  v_base_result := plugin_data.csf_install_default_roles_projection_base(p_organization_id);

  INSERT INTO plugin_data.csf_role_permissions (
    organization_id,
    role_id,
    permission_key,
    enabled,
    updated_at
  )
  SELECT
    p_organization_id,
    role.id,
    permission.permission_key,
    CASE permission.permission_key
      WHEN 'import_applications' THEN role.key IN ('owner', 'advisor', 'co-president', 'vice-president-membership', 'data-management')
      WHEN 'import_members' THEN role.key IN ('owner', 'advisor', 'co-president', 'vice-president-membership', 'secretary', 'data-management')
      WHEN 'import_meetings' THEN role.key IN ('owner', 'advisor', 'co-president', 'vice-president-membership', 'secretary', 'data-management')
      WHEN 'import_partner_clubs' THEN role.key IN ('owner', 'advisor', 'co-president', 'vice-president-clubs', 'data-management')
      WHEN 'export_membership_reports' THEN role.key IN ('owner', 'advisor', 'co-president', 'vice-president-membership', 'secretary', 'data-management')
      WHEN 'export_dues_reports' THEN role.key IN ('owner', 'advisor', 'co-president', 'vice-president-membership', 'treasurer')
      WHEN 'export_service_reports' THEN role.key IN ('owner', 'advisor', 'co-president', 'vice-president-membership', 'secretary', 'data-management')
      WHEN 'export_club_reports' THEN role.key IN ('owner', 'advisor', 'co-president', 'vice-president-clubs', 'data-management')
      ELSE false
    END,
    now()
  FROM plugin_data.csf_roles AS role
  CROSS JOIN (
    VALUES
      ('import_applications'),
      ('import_members'),
      ('import_meetings'),
      ('import_partner_clubs'),
      ('export_membership_reports'),
      ('export_dues_reports'),
      ('export_service_reports'),
      ('export_club_reports')
  ) AS permission(permission_key)
  WHERE role.organization_id = p_organization_id
    AND role.is_system = true
  ON CONFLICT (role_id, permission_key) DO UPDATE
  SET
    organization_id = EXCLUDED.organization_id,
    enabled = EXCLUDED.enabled,
    updated_at = now();

  UPDATE plugin_data.csf_role_permissions AS permission
  SET enabled = false, updated_at = now()
  FROM plugin_data.csf_roles AS role
  WHERE permission.organization_id = p_organization_id
    AND permission.role_id = role.id
    AND role.organization_id = p_organization_id
    AND role.is_system = true
    AND permission.permission_key IN ('manage_sheet_sync', 'resolve_imports', 'export_reports');

  SELECT count(*)::integer
  INTO v_permission_count
  FROM plugin_data.csf_role_permissions
  WHERE organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'roleCount', coalesce((v_base_result ->> 'roleCount')::integer, 0),
    'permissionCount', v_permission_count
  );
END;
$$;

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

CREATE OR REPLACE FUNCTION plugin_data.csf_create_custom_role(
  p_organization_id uuid,
  p_public_title text,
  p_responsibility_label text,
  p_description text,
  p_permission_keys text[],
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_public_title text := nullif(btrim(coalesce(p_public_title, '')), '');
  v_responsibility_label text := nullif(btrim(coalesce(p_responsibility_label, '')), '');
  v_display_name text;
  v_key text;
  v_permissions text[] := coalesce(p_permission_keys, ARRAY[]::text[]);
  v_catalog constant text[] := ARRAY[
    'manage_roles','manage_cohorts_terms','manage_schedule','manage_profiles',
    'review_applications','view_applications','review_application_checks',
    'decide_applications','assign_applications','write_application_notes',
    'manage_restrictions','manage_opportunities','manage_partner_clubs',
    'verify_participation','process_points','verify_submissions','manage_meetings',
    'reconcile_meeting_attendance','close_term','reopen_term','edit_point_rules',
    'manage_payment_review','import_applications','import_members','import_meetings',
    'import_partner_clubs','manage_sheet_sync','resolve_imports','manage_settings',
    'export_membership_reports','export_dues_reports','export_service_reports',
    'export_club_reports','export_reports','export_sensitive_reports','view_audit_history'
  ];
BEGIN
  IF NOT plugin_data.csf_actor_can_manage_staff(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF staff access.';
  END IF;
  IF v_public_title IS NULL THEN
    RAISE EXCEPTION 'Public title is required.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_permissions) AS requested(permission_key)
    WHERE NOT (requested.permission_key = ANY(v_catalog))
  ) THEN
    RAISE EXCEPTION 'One or more CSF permissions are invalid.';
  END IF;

  v_display_name := concat_ws(' — ', v_public_title, v_responsibility_label);
  v_key := left(trim(both '-' FROM regexp_replace(lower(v_display_name), '[^a-z0-9]+', '-', 'g')), 64);
  IF v_key = '' THEN
    RAISE EXCEPTION 'Use letters or numbers in the position name.';
  END IF;

  INSERT INTO plugin_data.csf_roles (
    id, organization_id, key, display_name, public_title,
    responsibility_label, description, role_type, is_system, sort_order
  ) VALUES (
    v_role_id, p_organization_id, v_key, v_display_name, v_public_title,
    v_responsibility_label, nullif(btrim(coalesce(p_description, '')), ''),
    'custom', false, 500
  );

  INSERT INTO plugin_data.csf_role_permissions (
    organization_id, role_id, permission_key, enabled
  )
  SELECT p_organization_id, v_role_id, permission_key, true
  FROM unnest(ARRAY(SELECT DISTINCT unnest(v_permissions))) AS permission_key;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'role.create', 'csf_roles', v_role_id,
    jsonb_build_object(
      'publicTitle', v_public_title,
      'responsibilityLabel', v_responsibility_label,
      'permissions', to_jsonb(v_permissions)
    ),
    v_correlation_id, 'staff_access', v_role_id::text, 'custom_role_created'
  );

  RETURN jsonb_build_object(
    'roleId', v_role_id,
    'correlationId', v_correlation_id,
    'displayName', v_display_name
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A CSF position with this title and responsibility already exists.';
END;
$$;

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
  p_include_check_summary boolean DEFAULT false
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
      AND (p_view = 'all' OR application.decision_status::text = 'pending')
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

REVOKE ALL ON FUNCTION plugin_data.csf_install_default_roles_projection_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_install_default_roles(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_create_custom_role(uuid, text, text, text, text[], uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_list_applications_page(uuid, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_list_profiles_page(uuid, text, text, uuid, text, text, text, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_install_default_roles(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_custom_role(uuid, text, text, text, text[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_applications_page(uuid, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, integer, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_profiles_page(uuid, text, text, uuid, text, text, text, text, uuid, integer)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_list_applications_page(uuid, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, integer, boolean) IS
  'Returns a tenant-scoped, filtered, keyset-paged application summary projection. Full review details remain separate.';

COMMENT ON FUNCTION plugin_data.csf_list_profiles_page(uuid, text, text, uuid, text, text, text, text, uuid, integer) IS
  'Returns tenant-scoped member-directory IDs, current-semester progress, global view counts, and a keyset cursor without loading historical relations.';

DO $$
DECLARE
  v_organization_id uuid;
BEGIN
  FOR v_organization_id IN
    SELECT DISTINCT organization_id FROM plugin_data.csf_roles
  LOOP
    PERFORM plugin_data.csf_install_default_roles(v_organization_id);
  END LOOP;
END;
$$;

COMMIT;
