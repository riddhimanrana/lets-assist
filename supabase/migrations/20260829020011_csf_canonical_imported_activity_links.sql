-- Class-history rows are per-member awards, not independent activities. Give
-- every imported title one canonical semester opportunity, link each award and
-- profile event to it, and link imported attendance to canonical meetings.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_normalize_imported_activity_key(
  p_title text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.lower(
    pg_catalog.regexp_replace(pg_catalog.btrim(p_title), '[[:space:]]+', ' ', 'g')
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_normalize_imported_activity_key(text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_normalize_imported_activity_key(text) IS
  'Owner-internal identity normalizer for exact imported activity titles. It folds case and whitespace only, so distinct source labels remain distinct activities.';

ALTER TABLE plugin_data.csf_opportunities
  ADD COLUMN IF NOT EXISTS record_origin text NOT NULL DEFAULT 'staff'
    CHECK (record_origin IN ('staff', 'class_history_import')),
  ADD COLUMN IF NOT EXISTS source_identity_key text
    CHECK (
      source_identity_key IS NULL
      OR source_identity_key = pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.btrim(source_identity_key),
          '[[:space:]]+',
          ' ',
          'g'
        )
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS csf_opportunities_import_identity_idx
  ON plugin_data.csf_opportunities (
    organization_id,
    term_id,
    source_identity_key
  )
  WHERE record_origin = 'class_history_import'
    AND term_id IS NOT NULL
    AND source_identity_key IS NOT NULL;

COMMENT ON COLUMN plugin_data.csf_opportunities.record_origin IS
  'How the canonical activity entered CSF. Staff activities keep their normal publication lifecycle; class_history_import rows are historical semester activities generated from reviewed workbook evidence.';
COMMENT ON COLUMN plugin_data.csf_opportunities.source_identity_key IS
  'Case-and-whitespace-normalized exact title used only to reuse one canonical imported activity within an organization semester.';

WITH historical AS (
  SELECT
    event.organization_id,
    event.term_id,
    plugin_data.csf_normalize_imported_activity_key(event.title) AS activity_key,
    min(pg_catalog.btrim(event.title)) AS title,
    max(coalesce(event.counted_points, event.raw_points, 0)) AS point_value,
    min(event.created_at) AS created_at,
    max(event.updated_at) AS updated_at
  FROM plugin_data.csf_profile_activity_events AS event
  WHERE event.term_id IS NOT NULL
    AND event.source = 'sheet'
    AND event.event_type = 'legacy_import'
    AND event.source_ref @> '{"processor":"class_history_import"}'::jsonb
    AND nullif(pg_catalog.btrim(event.title), '') IS NOT NULL
  GROUP BY
    event.organization_id,
    event.term_id,
    plugin_data.csf_normalize_imported_activity_key(event.title)
)
INSERT INTO plugin_data.csf_opportunities (
  organization_id,
  term_id,
  title,
  body,
  point_value,
  point_cap,
  point_type,
  signup_mode,
  requires_point_submission,
  evidence_policy,
  status,
  archived_at,
  record_origin,
  source_identity_key,
  created_at,
  updated_at
)
SELECT
  historical.organization_id,
  historical.term_id,
  historical.title,
  'Historical activity imported from a reviewed CSF class workbook.',
  historical.point_value,
  historical.point_value,
  'non_drive',
  'none',
  false,
  'none',
  'archived',
  historical.updated_at,
  'class_history_import',
  historical.activity_key,
  historical.created_at,
  historical.updated_at
FROM historical
ON CONFLICT (organization_id, term_id, source_identity_key)
  WHERE record_origin = 'class_history_import'
    AND term_id IS NOT NULL
    AND source_identity_key IS NOT NULL
DO UPDATE SET
  point_value = greatest(
    plugin_data.csf_opportunities.point_value,
    EXCLUDED.point_value
  ),
  point_cap = greatest(
    coalesce(plugin_data.csf_opportunities.point_cap, 0),
    EXCLUDED.point_cap
  ),
  updated_at = greatest(
    plugin_data.csf_opportunities.updated_at,
    EXCLUDED.updated_at
  );

UPDATE plugin_data.csf_profile_activity_events AS event
SET opportunity_id = activity.id
FROM plugin_data.csf_opportunities AS activity
WHERE event.organization_id = activity.organization_id
  AND event.term_id = activity.term_id
  AND activity.record_origin = 'class_history_import'
  AND activity.source_identity_key =
    plugin_data.csf_normalize_imported_activity_key(event.title)
  AND event.source = 'sheet'
  AND event.event_type = 'legacy_import'
  AND event.source_ref @> '{"processor":"class_history_import"}'::jsonb
  AND event.opportunity_id IS DISTINCT FROM activity.id;

UPDATE plugin_data.csf_credit_records AS credit
SET opportunity_id = activity.id
FROM plugin_data.csf_opportunities AS activity
WHERE credit.organization_id = activity.organization_id
  AND credit.term_id = activity.term_id
  AND activity.record_origin = 'class_history_import'
  AND activity.source_identity_key =
    plugin_data.csf_normalize_imported_activity_key(credit.evidence ->> 'title')
  AND credit.source = 'sheet'
  AND credit.evidence @> '{"processor":"class_history_import"}'::jsonb
  AND credit.opportunity_id IS DISTINCT FROM activity.id;

WITH event_credit AS (
  SELECT DISTINCT ON (event.id)
    event.id AS event_id,
    credit.id AS credit_id
  FROM plugin_data.csf_profile_activity_events AS event
  JOIN plugin_data.csf_credit_records AS credit
    ON credit.organization_id = event.organization_id
   AND credit.profile_id = event.profile_id
   AND credit.term_id = event.term_id
   AND credit.evidence ->> 'processor' = event.source_ref ->> 'processor'
   AND credit.evidence ->> 'sourceId' = event.source_ref ->> 'sourceId'
   AND credit.evidence ->> 'importRowId' = event.source_ref ->> 'importRowId'
   AND credit.evidence ->> 'slot' = event.source_ref ->> 'slot'
  WHERE event.source = 'sheet'
    AND event.event_type = 'legacy_import'
    AND event.source_ref @> '{"processor":"class_history_import"}'::jsonb
  ORDER BY event.id, credit.id
)
UPDATE plugin_data.csf_profile_activity_events AS event
SET credit_record_id = event_credit.credit_id
FROM event_credit
WHERE event.id = event_credit.event_id
  AND event.credit_record_id IS DISTINCT FROM event_credit.credit_id;

-- Historical attendance already has a stable term key. Materialize that key as
-- the shared meeting record and reuse the existing logical/session model.
INSERT INTO plugin_data.csf_term_meetings (
  organization_id,
  term_id,
  meeting_key,
  label,
  required,
  status,
  settings,
  created_at,
  updated_at
)
SELECT
  attendance.organization_id,
  attendance.term_id,
  attendance.meeting_key,
  min(attendance.meeting_label),
  true,
  'active',
  '{"recordOrigin":"class_history_import"}'::jsonb,
  min(attendance.created_at),
  max(attendance.updated_at)
FROM plugin_data.csf_meeting_attendance AS attendance
WHERE attendance.source = 'sheet'
  AND attendance.match_details @> '{"processor":"class_history_import"}'::jsonb
  AND nullif(pg_catalog.btrim(attendance.meeting_key), '') IS NOT NULL
GROUP BY attendance.organization_id, attendance.term_id, attendance.meeting_key
ON CONFLICT (organization_id, term_id, meeting_key) DO UPDATE SET
  label = EXCLUDED.label,
  updated_at = greatest(
    plugin_data.csf_term_meetings.updated_at,
    EXCLUDED.updated_at
  );

INSERT INTO plugin_data.csf_meetings (
  organization_id,
  term_id,
  meeting_key,
  label,
  required,
  status,
  created_at,
  updated_at
)
SELECT
  legacy.organization_id,
  legacy.term_id,
  legacy.meeting_key,
  legacy.label,
  legacy.required,
  legacy.status,
  legacy.created_at,
  legacy.updated_at
FROM plugin_data.csf_term_meetings AS legacy
WHERE legacy.settings @> '{"recordOrigin":"class_history_import"}'::jsonb
ON CONFLICT (organization_id, term_id, meeting_key) DO UPDATE SET
  label = EXCLUDED.label,
  updated_at = greatest(
    plugin_data.csf_meetings.updated_at,
    EXCLUDED.updated_at
  );

INSERT INTO plugin_data.csf_meeting_sessions (
  organization_id,
  meeting_id,
  legacy_term_meeting_id,
  session_date,
  starts_at,
  location,
  attendance_source_url,
  status,
  settings,
  created_by,
  created_at,
  updated_at
)
SELECT
  legacy.organization_id,
  meeting.id,
  legacy.id,
  legacy.meeting_date,
  legacy.starts_at,
  legacy.location,
  legacy.attendance_source_url,
  CASE legacy.status
    WHEN 'active' THEN 'scheduled'
    WHEN 'inactive' THEN 'cancelled'
    ELSE 'archived'
  END,
  legacy.settings,
  legacy.created_by,
  legacy.created_at,
  legacy.updated_at
FROM plugin_data.csf_term_meetings AS legacy
JOIN plugin_data.csf_meetings AS meeting
  ON meeting.organization_id = legacy.organization_id
 AND meeting.term_id = legacy.term_id
 AND meeting.meeting_key = legacy.meeting_key
WHERE legacy.settings @> '{"recordOrigin":"class_history_import"}'::jsonb
ON CONFLICT (legacy_term_meeting_id) DO UPDATE SET
  meeting_id = EXCLUDED.meeting_id,
  updated_at = greatest(
    plugin_data.csf_meeting_sessions.updated_at,
    EXCLUDED.updated_at
  );

UPDATE plugin_data.csf_meeting_attendance AS attendance
SET
  term_meeting_id = legacy.id,
  meeting_id = meeting.id,
  meeting_session_id = session.id
FROM plugin_data.csf_term_meetings AS legacy
JOIN plugin_data.csf_meetings AS meeting
  ON meeting.organization_id = legacy.organization_id
 AND meeting.term_id = legacy.term_id
 AND meeting.meeting_key = legacy.meeting_key
LEFT JOIN plugin_data.csf_meeting_sessions AS session
  ON session.organization_id = legacy.organization_id
 AND session.meeting_id = meeting.id
 AND session.legacy_term_meeting_id = legacy.id
WHERE attendance.organization_id = legacy.organization_id
  AND attendance.term_id = legacy.term_id
  AND attendance.meeting_key = legacy.meeting_key
  AND attendance.source = 'sheet'
  AND attendance.match_details @> '{"processor":"class_history_import"}'::jsonb
  AND (
    attendance.term_meeting_id IS DISTINCT FROM legacy.id
    OR attendance.meeting_id IS DISTINCT FROM meeting.id
    OR attendance.meeting_session_id IS DISTINCT FROM session.id
  );

ALTER FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
)
  RENAME TO csf_import_class_history_row_v2_canonical_activity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_class_history_row_v2(
  p_organization_id uuid,
  p_profile_id uuid,
  p_first_name text,
  p_last_name text,
  p_school_email text,
  p_personal_email text,
  p_normalized_first_name text,
  p_normalized_last_name text,
  p_normalized_school_email text,
  p_normalized_personal_email text,
  p_cohort_id uuid,
  p_term_id uuid,
  p_source_id uuid,
  p_import_row_id uuid,
  p_row_hash text,
  p_activities jsonb,
  p_meetings jsonb,
  p_all_requirements_met boolean,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_activity jsonb;
  v_meeting jsonb;
  v_activity_id uuid;
  v_term_meeting_id uuid;
  v_meeting_id uuid;
  v_session_id uuid;
  v_title text;
  v_activity_key text;
  v_points numeric(8,2);
BEGIN
  v_result := plugin_data.csf_import_class_history_row_v2_canonical_activity_base(
    p_organization_id, p_profile_id, p_first_name, p_last_name,
    p_school_email, p_personal_email, p_normalized_first_name,
    p_normalized_last_name, p_normalized_school_email,
    p_normalized_personal_email, p_cohort_id, p_term_id, p_source_id,
    p_import_row_id, p_row_hash, p_activities, p_meetings,
    p_all_requirements_met, p_actor_user_id
  );

  FOR v_activity IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(coalesce(p_activities, '[]'::jsonb))
  LOOP
    v_title := coalesce(
      nullif(pg_catalog.btrim(v_activity ->> 'label'), ''),
      nullif(pg_catalog.btrim(v_activity ->> 'value'), '')
    );
    v_activity_key := plugin_data.csf_normalize_imported_activity_key(v_title);
    v_points := (v_activity ->> 'points')::numeric;

    INSERT INTO plugin_data.csf_opportunities (
      organization_id, term_id, title, body, point_value, point_cap,
      point_type, signup_mode, requires_point_submission, evidence_policy,
      status, archived_at, record_origin, source_identity_key
    ) VALUES (
      p_organization_id, p_term_id, v_title,
      'Historical activity imported from a reviewed CSF class workbook.',
      v_points, v_points, 'non_drive', 'none', false, 'none', 'archived',
      pg_catalog.now(), 'class_history_import', v_activity_key
    )
    ON CONFLICT (organization_id, term_id, source_identity_key)
      WHERE record_origin = 'class_history_import'
        AND term_id IS NOT NULL
        AND source_identity_key IS NOT NULL
    DO UPDATE SET
      point_value = greatest(
        plugin_data.csf_opportunities.point_value,
        EXCLUDED.point_value
      ),
      point_cap = greatest(
        coalesce(plugin_data.csf_opportunities.point_cap, 0),
        EXCLUDED.point_cap
      ),
      updated_at = pg_catalog.now()
    RETURNING id INTO v_activity_id;

    UPDATE plugin_data.csf_credit_records AS credit
    SET opportunity_id = v_activity_id,
        updated_at = pg_catalog.now()
    WHERE credit.organization_id = p_organization_id
      AND credit.profile_id = (v_result ->> 'profileId')::uuid
      AND credit.term_id = p_term_id
      AND credit.source = 'sheet'
      AND credit.evidence @> pg_catalog.jsonb_build_object(
        'processor', 'class_history_import',
        'sourceId', p_source_id,
        'importRowId', p_import_row_id,
        'slot', v_activity ->> 'slot'
      );

    UPDATE plugin_data.csf_profile_activity_events AS event
    SET
      opportunity_id = v_activity_id,
      credit_record_id = credit.id,
      updated_at = pg_catalog.now()
    FROM plugin_data.csf_credit_records AS credit
    WHERE event.organization_id = p_organization_id
      AND event.profile_id = (v_result ->> 'profileId')::uuid
      AND event.term_id = p_term_id
      AND event.source_ref @> pg_catalog.jsonb_build_object(
        'processor', 'class_history_import',
        'sourceId', p_source_id,
        'importRowId', p_import_row_id,
        'slot', v_activity ->> 'slot'
      )
      AND credit.organization_id = event.organization_id
      AND credit.profile_id = event.profile_id
      AND credit.term_id = event.term_id
      AND credit.evidence ->> 'processor' = event.source_ref ->> 'processor'
      AND credit.evidence ->> 'sourceId' = event.source_ref ->> 'sourceId'
      AND credit.evidence ->> 'importRowId' = event.source_ref ->> 'importRowId'
      AND credit.evidence ->> 'slot' = event.source_ref ->> 'slot';
  END LOOP;

  FOR v_meeting IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(coalesce(p_meetings, '[]'::jsonb))
  LOOP
    INSERT INTO plugin_data.csf_term_meetings (
      organization_id, term_id, meeting_key, label, required, status,
      settings, created_by
    ) VALUES (
      p_organization_id, p_term_id, v_meeting ->> 'key',
      coalesce(nullif(pg_catalog.btrim(v_meeting ->> 'label'), ''), v_meeting ->> 'key'),
      true, 'active', '{"recordOrigin":"class_history_import"}'::jsonb,
      p_actor_user_id
    )
    ON CONFLICT (organization_id, term_id, meeting_key) DO UPDATE SET
      label = EXCLUDED.label,
      updated_at = pg_catalog.now()
    RETURNING id INTO v_term_meeting_id;

    INSERT INTO plugin_data.csf_meetings (
      organization_id, term_id, meeting_key, label, required, status,
      created_by
    ) VALUES (
      p_organization_id, p_term_id, v_meeting ->> 'key',
      coalesce(nullif(pg_catalog.btrim(v_meeting ->> 'label'), ''), v_meeting ->> 'key'),
      true, 'active', p_actor_user_id
    )
    ON CONFLICT (organization_id, term_id, meeting_key) DO UPDATE SET
      label = EXCLUDED.label,
      updated_at = pg_catalog.now()
    RETURNING id INTO v_meeting_id;

    INSERT INTO plugin_data.csf_meeting_sessions (
      organization_id, meeting_id, legacy_term_meeting_id, status, settings,
      created_by
    ) VALUES (
      p_organization_id, v_meeting_id, v_term_meeting_id, 'scheduled',
      '{"recordOrigin":"class_history_import"}'::jsonb, p_actor_user_id
    )
    ON CONFLICT (legacy_term_meeting_id) DO UPDATE SET
      meeting_id = EXCLUDED.meeting_id,
      updated_at = pg_catalog.now()
    RETURNING id INTO v_session_id;

    UPDATE plugin_data.csf_meeting_attendance AS attendance
    SET
      term_meeting_id = v_term_meeting_id,
      meeting_id = v_meeting_id,
      meeting_session_id = v_session_id,
      updated_at = pg_catalog.now()
    WHERE attendance.organization_id = p_organization_id
      AND attendance.profile_id = (v_result ->> 'profileId')::uuid
      AND attendance.term_id = p_term_id
      AND attendance.meeting_key = v_meeting ->> 'key'
      AND attendance.source = 'sheet'
      AND attendance.match_details @> pg_catalog.jsonb_build_object(
        'processor', 'class_history_import',
        'sourceId', p_source_id,
        'importRowId', p_import_row_id
      );
  END LOOP;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'canonicalActivityCount', pg_catalog.jsonb_array_length(coalesce(p_activities, '[]'::jsonb)),
    'canonicalMeetingCount', pg_catalog.jsonb_array_length(coalesce(p_meetings, '[]'::jsonb))
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2_canonical_activity_base(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_list_historical_activity_summaries(
  p_organization_id uuid,
  p_term_id uuid DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 250
)
RETURNS TABLE (
  activity_key text,
  title text,
  term_id uuid,
  term_code text,
  term_label text,
  cohort_id uuid,
  cohort_label text,
  member_count bigint,
  record_count bigint,
  minimum_points numeric,
  maximum_points numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    activity.source_identity_key AS activity_key,
    activity.title,
    activity.term_id,
    term.code AS term_code,
    coalesce(nullif(pg_catalog.btrim(term.label), ''), term.code) AS term_label,
    source.cohort_id,
    cohort.label AS cohort_label,
    pg_catalog.count(DISTINCT credit.profile_id) AS member_count,
    pg_catalog.count(credit.id) AS record_count,
    min(credit.points) AS minimum_points,
    max(credit.points) AS maximum_points
  FROM plugin_data.csf_opportunities AS activity
  JOIN plugin_data.csf_terms AS term
    ON term.organization_id = activity.organization_id
   AND term.id = activity.term_id
  JOIN plugin_data.csf_credit_records AS credit
    ON credit.organization_id = activity.organization_id
   AND credit.term_id = activity.term_id
   AND credit.opportunity_id = activity.id
  LEFT JOIN plugin_data.csf_sheet_sources AS source
    ON source.organization_id = credit.organization_id
   AND source.id::text = credit.evidence ->> 'sourceId'
  LEFT JOIN plugin_data.csf_cohorts AS cohort
    ON cohort.organization_id = source.organization_id
   AND cohort.id = source.cohort_id
  WHERE activity.organization_id = p_organization_id
    AND activity.record_origin = 'class_history_import'
    AND activity.source_identity_key IS NOT NULL
    AND credit.source = 'sheet'
    AND credit.evidence @> '{"processor":"class_history_import"}'::jsonb
    AND (p_term_id IS NULL OR activity.term_id = p_term_id)
    AND (p_cohort_id IS NULL OR source.cohort_id = p_cohort_id)
  GROUP BY
    activity.id,
    activity.source_identity_key,
    activity.title,
    activity.term_id,
    term.code,
    term.label,
    source.cohort_id,
    cohort.label
  ORDER BY term.code DESC, activity.title ASC, activity.source_identity_key ASC
  LIMIT greatest(1, least(coalesce(p_limit, 250), 500));
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_list_historical_activity_summaries(
  uuid, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_list_historical_activity_summaries(
  uuid, uuid, uuid, integer
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) IS
  'Imports one reviewed class-history row, reuses one canonical semester activity per exact normalized title, links each member award and event to that activity, and links attendance to canonical meetings.';

COMMENT ON FUNCTION plugin_data.csf_list_historical_activity_summaries(
  uuid, uuid, uuid, integer
) IS
  'Returns bounded officer-only semester activity summaries from canonical imported activities and their linked member awards.';

COMMIT;
