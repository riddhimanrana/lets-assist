-- Group member Home context and stream decoration into two bounded reads.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_member_home_context_snapshot(
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
  v_profile_id uuid;
  v_cohort_id uuid;
  v_cohort_label text;
  v_current_term_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_actor_user_id
        AND member.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.user_id = p_actor_user_id
        AND account.status IN ('pending', 'verified')
    )
  ) THEN
    RAISE EXCEPTION 'CSF member dashboard access denied.'
      USING ERRCODE = '42501';
  END IF;

  SELECT account.profile_id
  INTO v_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_actor_user_id
    AND account.status = 'verified'
  ORDER BY account.is_primary DESC, account.linked_at DESC, account.id DESC
  LIMIT 1;

  IF v_profile_id IS NOT NULL THEN
    SELECT membership.cohort_id, cohort.label
    INTO v_cohort_id, v_cohort_label
    FROM plugin_data.csf_profile_cohort_memberships AS membership
    JOIN plugin_data.csf_cohorts AS cohort
      ON cohort.organization_id = membership.organization_id
     AND cohort.id = membership.cohort_id
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = v_profile_id
      AND membership.status = 'active'
    ORDER BY membership.updated_at DESC, membership.id DESC
    LIMIT 1;
  END IF;

  SELECT term.id
  INTO v_current_term_id
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.is_current = true
  ORDER BY term.updated_at DESC, term.id DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'viewer', CASE WHEN v_profile_id IS NULL THEN NULL ELSE jsonb_build_object(
      'profileId', v_profile_id,
      'cohortId', v_cohort_id,
      'cohortLabel', v_cohort_label
    ) END,
    'cohorts', coalesce((
      SELECT jsonb_agg(to_jsonb(cohort_row) ORDER BY cohort_row.graduation_year, cohort_row.id)
      FROM (
        SELECT id, graduation_year, label, status, created_at, updated_at
        FROM plugin_data.csf_cohorts
        WHERE organization_id = p_organization_id
        ORDER BY graduation_year, id
        LIMIT 50
      ) AS cohort_row
    ), '[]'::jsonb),
    'terms', coalesce((
      SELECT jsonb_agg(to_jsonb(term_row) ORDER BY term_row.school_year DESC, term_row.semester, term_row.id)
      FROM (
        SELECT id, code, label, school_year, semester, starts_at, ends_at,
          application_opens_at, application_closes_at, application_form_url,
          is_current, lifecycle_status, closed_at, closure_policy_version,
          updated_at
        FROM plugin_data.csf_terms
        WHERE organization_id = p_organization_id
        ORDER BY school_year DESC, semester, id
        LIMIT 50
      ) AS term_row
    ), '[]'::jsonb),
    'classmateCount', CASE
      WHEN v_cohort_id IS NULL OR v_current_term_id IS NULL THEN NULL
      ELSE (
        SELECT count(*)
        FROM plugin_data.csf_term_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.term_id = v_current_term_id
          AND membership.cohort_id = v_cohort_id
          AND membership.status IN (
            'accepted', 'active', 'completed', 'not_completed'
          )
      )
    END,
    'activities', CASE
      WHEN v_profile_id IS NULL
        OR v_current_term_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM plugin_data.csf_term_memberships AS membership
          WHERE membership.organization_id = p_organization_id
            AND membership.term_id = v_current_term_id
            AND membership.profile_id = v_profile_id
            AND membership.status IN ('accepted', 'active', 'completed')
        )
      THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(activity_row) ORDER BY activity_row.starts_at, activity_row.id)
      FROM (
        SELECT id, title, starts_at, point_value, point_type
        FROM plugin_data.csf_opportunities AS opportunity
        WHERE opportunity.organization_id = p_organization_id
          AND opportunity.status = 'published'
          AND opportunity.starts_at >= p_lower_instant
          AND opportunity.starts_at <= p_upper_instant
          AND (
            opportunity.cohort_id IS NULL
            OR opportunity.cohort_id = v_cohort_id
          )
        ORDER BY opportunity.starts_at, opportunity.id
        LIMIT 100
      ) AS activity_row
    ), '[]'::jsonb) END,
    'meetingSessions', CASE WHEN v_profile_id IS NULL THEN '[]'::jsonb ELSE coalesce((
      WITH eligible_terms AS (
        SELECT term.id
        FROM plugin_data.csf_terms AS term
        WHERE term.organization_id = p_organization_id
          AND term.lifecycle_status IN ('planned', 'open')
          AND EXISTS (
            SELECT 1
            FROM plugin_data.csf_term_memberships AS membership
            WHERE membership.organization_id = term.organization_id
              AND membership.term_id = term.id
              AND membership.profile_id = v_profile_id
              AND membership.status IN ('accepted', 'active', 'completed')
          )
      )
      SELECT jsonb_agg(to_jsonb(session_row) ORDER BY session_row.session_date, session_row.starts_at, session_row.id)
      FROM (
        SELECT session.id, session.session_date, session.starts_at,
          meeting.label AS meeting_label
        FROM plugin_data.csf_meeting_sessions AS session
        JOIN plugin_data.csf_meetings AS meeting
          ON meeting.organization_id = session.organization_id
         AND meeting.id = session.meeting_id
        JOIN eligible_terms ON eligible_terms.id = meeting.term_id
        WHERE session.organization_id = p_organization_id
          AND session.status IN ('scheduled', 'open')
          AND meeting.status = 'active'
          AND (
            session.starts_at >= p_lower_instant
            OR session.session_date >= p_lower_date
          )
        ORDER BY session.session_date, session.starts_at, session.id
        LIMIT 100
      ) AS session_row
    ), '[]'::jsonb) END,
    'deadlines', CASE WHEN v_profile_id IS NULL THEN '[]'::jsonb ELSE coalesce((
      WITH eligible_terms AS (
        SELECT term.id
        FROM plugin_data.csf_terms AS term
        WHERE term.organization_id = p_organization_id
          AND term.lifecycle_status IN ('planned', 'open')
          AND EXISTS (
            SELECT 1
            FROM plugin_data.csf_term_memberships AS membership
            WHERE membership.organization_id = term.organization_id
              AND membership.term_id = term.id
              AND membership.profile_id = v_profile_id
              AND membership.status IN ('accepted', 'active', 'completed')
          )
      )
      SELECT jsonb_agg(to_jsonb(deadline_row) ORDER BY deadline_row.due_at, deadline_row.id)
      FROM (
        SELECT deadline.id, deadline.title, deadline.due_at
        FROM plugin_data.csf_term_deadlines AS deadline
        JOIN eligible_terms ON eligible_terms.id = deadline.term_id
        WHERE deadline.organization_id = p_organization_id
          AND deadline.status IN ('planned', 'open')
          AND deadline.audience IN ('members', 'applicants', 'all')
          AND deadline.due_at >= p_lower_instant
          AND deadline.due_at <= p_upper_instant
        ORDER BY deadline.due_at, deadline.id
        LIMIT 100
      ) AS deadline_row
    ), '[]'::jsonb) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_member_stream_enrichment(
  p_organization_id uuid,
  p_announcement_ids uuid[],
  p_activity_ids uuid[],
  p_cohort_ids uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH requested_posts AS (
    SELECT DISTINCT value AS id
    FROM unnest(coalesce(p_announcement_ids, ARRAY[]::uuid[])) AS value
    LIMIT 100
  ),
  requested_activities AS (
    SELECT DISTINCT value AS id
    FROM unnest(coalesce(p_activity_ids, ARRAY[]::uuid[])) AS value
    LIMIT 100
  ),
  requested_cohorts AS (
    SELECT DISTINCT value AS id
    FROM unnest(coalesce(p_cohort_ids, ARRAY[]::uuid[])) AS value
    LIMIT 100
  ),
  reply_previews AS (
    SELECT preview.*
    FROM plugin_data.csf_post_reply_previews(
      p_organization_id,
      ARRAY(SELECT id FROM requested_posts),
      3
    ) AS preview
  ),
  allowed_authors AS (
    SELECT announcement.created_by AS user_id
    FROM plugin_data.csf_announcements AS announcement
    JOIN requested_posts ON requested_posts.id = announcement.id
    WHERE announcement.organization_id = p_organization_id
      AND announcement.created_by IS NOT NULL
    UNION
    SELECT nullif(reply_value ->> 'created_by', '')::uuid
    FROM reply_previews
    CROSS JOIN LATERAL jsonb_array_elements(reply_previews.replies) AS reply_value
    WHERE nullif(reply_value ->> 'created_by', '') IS NOT NULL
    UNION
    SELECT opportunity.created_by_user_id
    FROM plugin_data.csf_opportunities AS opportunity
    JOIN requested_activities ON requested_activities.id = opportunity.id
    WHERE opportunity.organization_id = p_organization_id
      AND opportunity.created_by_user_id IS NOT NULL
  ),
  authors AS (
    SELECT profile.id,
      coalesce(nullif(btrim(profile.full_name), ''), nullif(btrim(profile.username), '')) AS name,
      nullif(btrim(profile.avatar_url), '') AS avatar_url,
      position.display_title
    FROM public.profiles AS profile
    JOIN allowed_authors ON allowed_authors.user_id = profile.id
    LEFT JOIN LATERAL (
      SELECT staff_position.display_title
      FROM plugin_data.csf_staff_positions AS staff_position
      WHERE staff_position.organization_id = p_organization_id
        AND staff_position.user_id = profile.id
        AND staff_position.status = 'active'
        AND (staff_position.starts_at IS NULL OR staff_position.starts_at <= plugin_data.csf_chapter_today())
        AND (staff_position.ends_at IS NULL OR staff_position.ends_at >= plugin_data.csf_chapter_today())
      ORDER BY staff_position.school_year DESC, staff_position.created_at DESC
      LIMIT 1
    ) AS position ON true
    WHERE coalesce(nullif(btrim(profile.full_name), ''), nullif(btrim(profile.username), '')) IS NOT NULL
  )
  SELECT jsonb_build_object(
    'replyPreviews', coalesce((
      SELECT jsonb_agg(to_jsonb(reply_previews) ORDER BY reply_previews.announcement_id)
      FROM reply_previews
    ), '[]'::jsonb),
    'cohorts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', cohort.id, 'label', cohort.label) ORDER BY cohort.id)
      FROM plugin_data.csf_cohorts AS cohort
      JOIN requested_cohorts ON requested_cohorts.id = cohort.id
      WHERE cohort.organization_id = p_organization_id
    ), '[]'::jsonb),
    'authors', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', authors.id,
        'name', authors.name,
        'title', authors.display_title,
        'avatarUrl', authors.avatar_url
      ) ORDER BY authors.id)
      FROM authors
    ), '[]'::jsonb),
    'linkPreviews', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'announcementId', preview.announcement_id,
        'url', preview.url,
        'title', preview.title,
        'description', preview.description,
        'siteName', preview.site_name,
        'imageUrl', preview.image_url
      ) ORDER BY preview.announcement_id)
      FROM plugin_data.csf_announcement_link_previews AS preview
      JOIN requested_posts ON requested_posts.id = preview.announcement_id
      WHERE preview.organization_id = p_organization_id
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_member_home_context_snapshot(
  uuid, uuid, timestamptz, timestamptz, date
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_member_stream_enrichment(
  uuid, uuid[], uuid[], uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_home_context_snapshot(
  uuid, uuid, timestamptz, timestamptz, date
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_stream_enrichment(
  uuid, uuid[], uuid[], uuid[]
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_member_home_context_snapshot(
  uuid, uuid, timestamptz, timestamptz, date
) IS 'Returns bounded class, term, member, count, and agenda context for Member Home in one server-only read.';
COMMENT ON FUNCTION plugin_data.csf_member_stream_enrichment(
  uuid, uuid[], uuid[], uuid[]
) IS 'Returns bounded reply, cohort, author, and link decoration for one authorized Member Home stream page.';

COMMIT;
