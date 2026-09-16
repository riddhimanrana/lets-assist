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
  v_snapshot jsonb;
  v_profile_id uuid;
  v_cohort_id uuid;
  v_current_term_id uuid;
  v_has_current_membership boolean := false;
  v_activities jsonb := '[]'::jsonb;
  v_reminders jsonb;
  v_sessions jsonb;
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

  SELECT coalesce(jsonb_agg(to_jsonb(reminder) ORDER BY reminder.due_at, reminder.id), '[]'::jsonb)
  INTO v_reminders
  FROM (
    SELECT deadline.id, deadline.title, deadline.due_at
    FROM plugin_data.csf_term_deadlines AS deadline
    JOIN plugin_data.csf_terms AS term
      ON term.organization_id = deadline.organization_id AND term.id = deadline.term_id
    WHERE deadline.organization_id = p_organization_id
      AND term.lifecycle_status IN ('planned', 'open')
      AND deadline.status IN ('planned', 'open')
      AND deadline.due_at >= p_lower_instant AND deadline.due_at <= p_upper_instant
      AND (
        deadline.audience = 'all'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(v_snapshot -> 'deadlines', '[]'::jsonb)) AS existing(value)
          WHERE existing.value ->> 'id' = deadline.id::text
        )
      )
    ORDER BY deadline.due_at, deadline.id
    LIMIT 100
  ) AS reminder;

  SELECT coalesce(jsonb_agg(to_jsonb(session_row) ORDER BY session_row.session_date, session_row.starts_at, session_row.id), '[]'::jsonb)
  INTO v_sessions
  FROM (
    SELECT session.id, session.session_date, session.starts_at,
      meeting.label || CASE WHEN nullif(btrim(session.location), '') IS NULL THEN '' ELSE ' · ' || btrim(session.location) END AS meeting_label, session.location
    FROM plugin_data.csf_meeting_sessions AS session
    JOIN plugin_data.csf_meetings AS meeting
      ON meeting.organization_id = session.organization_id AND meeting.id = session.meeting_id
    JOIN plugin_data.csf_terms AS term
      ON term.organization_id = meeting.organization_id AND term.id = meeting.term_id
    WHERE session.organization_id = p_organization_id
      AND term.lifecycle_status IN ('planned', 'open')
      AND meeting.status = 'active'
      AND session.status IN ('scheduled', 'open')
      AND (session.starts_at >= p_lower_instant OR session.session_date >= p_lower_date)
      AND coalesce(session.session_date, (session.starts_at AT TIME ZONE 'America/Los_Angeles')::date)
        <= (p_upper_instant AT TIME ZONE 'America/Los_Angeles')::date
    ORDER BY session.session_date, session.starts_at, session.id
    LIMIT 100
  ) AS session_row;

  v_snapshot := jsonb_set(v_snapshot, '{deadlines}', v_reminders, true);
  v_snapshot := jsonb_set(v_snapshot, '{meetingSessions}', v_sessions, true);
  RETURN jsonb_set(v_snapshot, '{activities}', v_activities, true);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_member_home_context_snapshot(
  uuid, uuid, timestamptz, timestamptz, date
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_home_context_snapshot(
  uuid, uuid, timestamptz, timestamptz, date
) TO service_role, postgres;


COMMIT;
