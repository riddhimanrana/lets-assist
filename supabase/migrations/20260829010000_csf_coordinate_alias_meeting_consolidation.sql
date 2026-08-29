-- A legacy profile can retain only its original class-sheet coordinate while a
-- later committed preview of that coordinate carries the official roster key.
-- Prove that alias in the database, then consolidate identical meeting rows in
-- the same audited transaction as equivalent term memberships.

CREATE TABLE plugin_data.csf_profile_merge_meeting_attendance_consolidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  consolidation_id uuid NOT NULL,
  source_profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id),
  target_profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id),
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id),
  meeting_key text NOT NULL,
  source_attendance_id uuid NOT NULL,
  target_attendance_id uuid NOT NULL,
  source_snapshot jsonb NOT NULL,
  target_snapshot jsonb NOT NULL,
  merge_review_id uuid REFERENCES plugin_data.csf_profile_merge_reviews(id),
  consolidated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consolidation_id, term_id, meeting_key)
);

CREATE INDEX csf_meeting_attendance_merge_audit_org_created_idx
  ON plugin_data.csf_profile_merge_meeting_attendance_consolidations (
    organization_id, consolidated_at DESC
  );
CREATE INDEX csf_meeting_attendance_merge_audit_source_idx
  ON plugin_data.csf_profile_merge_meeting_attendance_consolidations (
    organization_id, source_profile_id
  );
CREATE INDEX csf_meeting_attendance_merge_audit_target_idx
  ON plugin_data.csf_profile_merge_meeting_attendance_consolidations (
    organization_id, target_profile_id
  );
CREATE INDEX csf_meeting_attendance_merge_audit_review_idx
  ON plugin_data.csf_profile_merge_meeting_attendance_consolidations (
    merge_review_id
  );

ALTER TABLE plugin_data.csf_profile_merge_meeting_attendance_consolidations
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_profile_merge_meeting_attendance_consolidations
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_profile_merge_meeting_attendance_consolidations
  TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_class_source_keys(
  p_organization_id uuid,
  p_profile_id uuid
)
RETURNS TABLE (
  source_file_id text,
  sheet_tab_name text,
  row_number integer,
  source_key text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH profile AS (
    SELECT p.*
    FROM plugin_data.csf_profiles AS p
    WHERE p.organization_id = p_organization_id
      AND p.id = p_profile_id
      AND p.record_status = 'active'
  ),
  origin AS (
    SELECT import_row.sheet_tab_name, import_row.row_number,
      import_row.normalized_data, import_job.source_file_id
    FROM plugin_data.csf_sheet_import_rows AS import_row
    JOIN plugin_data.csf_sheet_import_jobs AS import_job
      ON import_job.organization_id = import_row.organization_id
     AND import_job.id = import_row.job_id
    CROSS JOIN profile AS p
    WHERE import_row.organization_id = p_organization_id
      AND import_row.import_status IN ('created', 'updated')
      AND import_job.mode = 'preview'
      AND import_job.source_type = 'class_history'
      AND NULLIF(import_job.source_file_id, '') IS NOT NULL
      AND (
        import_row.matched_profile_id = p.id
        OR import_row.id = CASE
          WHEN p.source_summary ->> 'importRowId'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (p.source_summary ->> 'importRowId')::uuid
          ELSE NULL
        END
      )
  ),
  candidates AS (
    SELECT origin.source_file_id, origin.sheet_tab_name, origin.row_number,
      COALESCE(
        origin.normalized_data #>> '{record,identity,sourceStudentKey}',
        origin.normalized_data #>> '{identity,sourceStudentKey}'
      ) AS candidate_key,
      COALESCE(
        origin.normalized_data #>> '{record,identity,firstName}',
        origin.normalized_data #>> '{identity,firstName}'
      ) AS candidate_first_name,
      COALESCE(
        origin.normalized_data #>> '{record,identity,lastName}',
        origin.normalized_data #>> '{identity,lastName}'
      ) AS candidate_last_name,
      false AS requires_name_match
    FROM origin
    UNION ALL
    SELECT origin.source_file_id, origin.sheet_tab_name, origin.row_number,
      COALESCE(
        alias_row.normalized_data #>> '{record,identity,sourceStudentKey}',
        alias_row.normalized_data #>> '{identity,sourceStudentKey}'
      ),
      COALESCE(
        alias_row.normalized_data #>> '{record,identity,firstName}',
        alias_row.normalized_data #>> '{identity,firstName}'
      ),
      COALESCE(
        alias_row.normalized_data #>> '{record,identity,lastName}',
        alias_row.normalized_data #>> '{identity,lastName}'
      ),
      true
    FROM origin
    JOIN plugin_data.csf_sheet_import_jobs AS alias_job
      ON alias_job.organization_id = p_organization_id
     AND alias_job.mode = 'preview'
     AND alias_job.source_type = 'class_history'
     AND alias_job.source_file_id = origin.source_file_id
    JOIN plugin_data.csf_sheet_import_rows AS alias_row
      ON alias_row.organization_id = alias_job.organization_id
     AND alias_row.job_id = alias_job.id
     AND alias_row.sheet_tab_name = origin.sheet_tab_name
     AND alias_row.row_number = origin.row_number
     AND alias_row.import_status IN ('created', 'updated')
  ),
  normalized AS (
    SELECT candidates.source_file_id, candidates.sheet_tab_name,
      candidates.row_number,
      pg_catalog.lower(pg_catalog.regexp_replace(
        COALESCE(candidates.candidate_key, ''), '[[:space:]]+', '', 'g'
      )) AS source_key,
      plugin_data.csf_normalize_identity_part(candidates.candidate_first_name)
        AS first_name,
      plugin_data.csf_normalize_identity_part(candidates.candidate_last_name)
        AS last_name,
      candidates.requires_name_match
    FROM candidates
  )
  SELECT DISTINCT normalized.source_file_id, normalized.sheet_tab_name,
    normalized.row_number, normalized.source_key
  FROM normalized
  CROSS JOIN profile AS p
  WHERE normalized.source_key <> ''
    AND (
      NOT normalized.requires_name_match
      OR (
        normalized.first_name = p.normalized_first_name
        AND normalized.last_name = p.normalized_last_name
      )
    )
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_profiles_share_class_source_key(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profiles AS source
    JOIN plugin_data.csf_profiles AS target
      ON target.organization_id = source.organization_id
    JOIN plugin_data.csf_profile_class_source_keys(
      p_organization_id, p_source_profile_id
    ) AS source_key ON true
    JOIN plugin_data.csf_profile_class_source_keys(
      p_organization_id, p_target_profile_id
    ) AS target_key
      ON target_key.source_file_id = source_key.source_file_id
    CROSS JOIN LATERAL (
      SELECT
        pg_catalog.lower(pg_catalog.regexp_replace(
          source.normalized_first_name || source.normalized_last_name,
          '[[:space:]]+', '', 'g'
        )) AS source_first_last_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          source.normalized_last_name || source.normalized_first_name,
          '[[:space:]]+', '', 'g'
        )) AS source_last_first_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          target.normalized_first_name || target.normalized_last_name,
          '[[:space:]]+', '', 'g'
        )) AS target_first_last_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          target.normalized_last_name || target.normalized_first_name,
          '[[:space:]]+', '', 'g'
        )) AS target_last_first_key
    ) AS names
    WHERE source.organization_id = p_organization_id
      AND source.id = p_source_profile_id
      AND target.id = p_target_profile_id
      AND source_key.source_key IN (
        names.source_first_last_key, names.source_last_first_key,
        names.target_first_last_key, names.target_last_first_key
      )
      AND target_key.source_key IN (
        names.source_first_last_key, names.source_last_first_key,
        names.target_first_last_key, names.target_last_first_key
      )
      AND (
        source_key.sheet_tab_name IS DISTINCT FROM target_key.sheet_tab_name
        OR source_key.row_number = target_key.row_number
      )
  )
$$;

ALTER FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  RENAME TO csf_profile_merge_reference_plan_coordinate_alias_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_merge_reference_plan(
  p_organization_id uuid,
  p_source_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_plan jsonb;
  v_history jsonb;
BEGIN
  v_plan := plugin_data.csf_profile_merge_reference_plan_coordinate_alias_base(
    p_organization_id, p_source_profile_id
  );
  v_history := COALESCE(v_plan -> 'immutableHistoryRetentions', '[]'::jsonb)
    || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_merge_meeting_attendance_consolidations.source_profile_id',
        'scope', 'immutable identical-attendance consolidation source snapshot',
        'sourceCount', (
          SELECT pg_catalog.count(*)
          FROM plugin_data.csf_profile_merge_meeting_attendance_consolidations AS evidence
          WHERE evidence.organization_id = p_organization_id
            AND evidence.source_profile_id = p_source_profile_id
        )
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_merge_meeting_attendance_consolidations.target_profile_id',
        'scope', 'immutable identical-attendance consolidation target snapshot',
        'sourceCount', (
          SELECT pg_catalog.count(*)
          FROM plugin_data.csf_profile_merge_meeting_attendance_consolidations AS evidence
          WHERE evidence.organization_id = p_organization_id
            AND evidence.target_profile_id = p_source_profile_id
        )
      )
    );
  RETURN pg_catalog.jsonb_set(
    v_plan, '{immutableHistoryRetentions}', v_history, true
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  RENAME TO csf_profile_merge_preview_coordinate_alias_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_merge_preview(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_preview jsonb;
  v_conflicts jsonb;
  v_exact_source_key_identity boolean := false;
  v_term_conflict_count integer := 0;
  v_term_overlap_count integer := 0;
  v_unsafe_term_count integer := 0;
  v_meeting_conflict_count integer := 0;
  v_meeting_overlap_count integer := 0;
  v_unsafe_meeting_count integer := 0;
  v_other_conflict_count integer := 0;
  v_can_consolidate boolean := false;
BEGIN
  v_preview := plugin_data.csf_profile_merge_preview_coordinate_alias_base(
    p_organization_id, p_source_profile_id, p_target_profile_id
  );
  IF v_preview IS NULL OR pg_catalog.jsonb_typeof(v_preview) <> 'object' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return a canonical object.';
  END IF;
  v_conflicts := v_preview -> 'conflicts';
  IF pg_catalog.jsonb_typeof(v_conflicts) <> 'array' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return canonical conflicts.';
  END IF;

  v_exact_source_key_identity := plugin_data.csf_profiles_share_class_source_key(
    p_organization_id, p_source_profile_id, p_target_profile_id
  );
  SELECT
    pg_catalog.count(*) FILTER (WHERE entry.conflict ->> 'type' = 'term_membership')::integer,
    pg_catalog.count(*) FILTER (WHERE entry.conflict ->> 'type' = 'meeting_attendance')::integer,
    pg_catalog.count(*) FILTER (
      WHERE entry.conflict ->> 'type' NOT IN (
        'term_membership', 'meeting_attendance', 'identity_email_missing',
        'identity_name_mismatch'
      )
    )::integer
  INTO v_term_conflict_count, v_meeting_conflict_count, v_other_conflict_count
  FROM pg_catalog.jsonb_array_elements(v_conflicts) AS entry(conflict);

  SELECT pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (
      WHERE source_membership.status IS DISTINCT FROM target_membership.status
        OR source_membership.override_status IS DISTINCT FROM target_membership.override_status
        OR (
          source_membership.override_status IS NOT NULL
          AND (
            source_membership.override_reason IS DISTINCT FROM target_membership.override_reason
            OR source_membership.overridden_by IS DISTINCT FROM target_membership.overridden_by
            OR source_membership.overridden_at IS DISTINCT FROM target_membership.overridden_at
          )
        )
        OR (
          source_membership.cohort_id IS NOT NULL
          AND target_membership.cohort_id IS NOT NULL
          AND source_membership.cohort_id <> target_membership.cohort_id
        )
        OR (
          source_membership.application_id IS NOT NULL
          AND target_membership.application_id IS NOT NULL
          AND source_membership.application_id <> target_membership.application_id
        )
    )::integer
  INTO v_term_overlap_count, v_unsafe_term_count
  FROM plugin_data.csf_term_memberships AS source_membership
  JOIN plugin_data.csf_term_memberships AS target_membership
    ON target_membership.organization_id = source_membership.organization_id
   AND target_membership.term_id = source_membership.term_id
   AND target_membership.profile_id = p_target_profile_id
  WHERE source_membership.organization_id = p_organization_id
    AND source_membership.profile_id = p_source_profile_id;

  SELECT pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (
      WHERE source_attendance.status IS DISTINCT FROM target_attendance.status
    )::integer
  INTO v_meeting_overlap_count, v_unsafe_meeting_count
  FROM plugin_data.csf_meeting_attendance AS source_attendance
  JOIN plugin_data.csf_meeting_attendance AS target_attendance
    ON target_attendance.organization_id = source_attendance.organization_id
   AND target_attendance.term_id = source_attendance.term_id
   AND target_attendance.meeting_key = source_attendance.meeting_key
   AND target_attendance.profile_id = p_target_profile_id
  WHERE source_attendance.organization_id = p_organization_id
    AND source_attendance.profile_id = p_source_profile_id;

  v_can_consolidate := v_exact_source_key_identity
    AND v_other_conflict_count = 0
    AND v_term_overlap_count = v_term_conflict_count
    AND v_unsafe_term_count = 0
    AND v_meeting_overlap_count = v_meeting_conflict_count
    AND v_unsafe_meeting_count = 0;

  IF v_exact_source_key_identity THEN
    SELECT COALESCE(
      pg_catalog.jsonb_agg(entry.conflict ORDER BY entry.ordinal), '[]'::jsonb
    )
    INTO v_conflicts
    FROM pg_catalog.jsonb_array_elements(v_conflicts)
      WITH ORDINALITY AS entry(conflict, ordinal)
    WHERE entry.conflict ->> 'type' NOT IN (
        'identity_email_missing', 'identity_name_mismatch'
      )
      AND NOT (
        v_can_consolidate
        AND entry.conflict ->> 'type' IN ('term_membership', 'meeting_attendance')
      );
  END IF;

  RETURN v_preview || pg_catalog.jsonb_build_object(
    'conflicts', v_conflicts,
    'canMerge', pg_catalog.jsonb_array_length(v_conflicts) = 0,
    'profileReferencePlan', plugin_data.csf_profile_merge_reference_plan(
      p_organization_id, p_source_profile_id
    ),
    'consolidatedMeetingAttendance', CASE
      WHEN v_can_consolidate THEN v_meeting_overlap_count ELSE 0
    END
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  RENAME TO csf_merge_profiles_coordinate_alias_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview jsonb;
  v_pair record;
  v_consolidation_id uuid := gen_random_uuid();
  v_consolidation_count integer := 0;
  v_result jsonb;
  v_review_id uuid;
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id IN (p_source_profile_id, p_target_profile_id)
  ORDER BY profile.id
  FOR UPDATE;
  PERFORM 1
  FROM plugin_data.csf_meeting_attendance AS attendance
  WHERE attendance.organization_id = p_organization_id
    AND attendance.profile_id IN (p_source_profile_id, p_target_profile_id)
  ORDER BY attendance.term_id, attendance.meeting_key, attendance.profile_id,
    attendance.id
  FOR UPDATE;

  v_preview := plugin_data.csf_profile_merge_preview(
    p_organization_id, p_source_profile_id, p_target_profile_id
  );
  IF COALESCE((v_preview ->> 'canMerge')::boolean, false) = false THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These CSF student records have conflicts that must be resolved before merging.',
      DETAIL = (v_preview -> 'conflicts')::text,
      HINT = 'Review the duplicate semester, attendance, signup, class, point claim, appeal, staff assignment, verified-account, or outstanding import recovery records.';
  END IF;

  FOR v_pair IN
    SELECT source_attendance.id AS source_id,
      target_attendance.id AS target_id,
      source_attendance.term_id,
      source_attendance.meeting_key,
      pg_catalog.to_jsonb(source_attendance) AS source_snapshot,
      pg_catalog.to_jsonb(target_attendance) AS target_snapshot
    FROM plugin_data.csf_meeting_attendance AS source_attendance
    JOIN plugin_data.csf_meeting_attendance AS target_attendance
      ON target_attendance.organization_id = source_attendance.organization_id
     AND target_attendance.term_id = source_attendance.term_id
     AND target_attendance.meeting_key = source_attendance.meeting_key
     AND target_attendance.profile_id = p_target_profile_id
    WHERE source_attendance.organization_id = p_organization_id
      AND source_attendance.profile_id = p_source_profile_id
    ORDER BY source_attendance.term_id, source_attendance.meeting_key,
      source_attendance.id, target_attendance.id
  LOOP
    INSERT INTO plugin_data.csf_profile_merge_meeting_attendance_consolidations (
      organization_id, consolidation_id, source_profile_id, target_profile_id,
      term_id, meeting_key, source_attendance_id, target_attendance_id,
      source_snapshot, target_snapshot
    ) VALUES (
      p_organization_id, v_consolidation_id, p_source_profile_id,
      p_target_profile_id, v_pair.term_id, v_pair.meeting_key,
      v_pair.source_id, v_pair.target_id, v_pair.source_snapshot,
      v_pair.target_snapshot
    );
    DELETE FROM plugin_data.csf_meeting_attendance
    WHERE organization_id = p_organization_id
      AND id = v_pair.source_id
      AND profile_id = p_source_profile_id;
    v_consolidation_count := v_consolidation_count + 1;
  END LOOP;

  v_result := plugin_data.csf_merge_profiles_coordinate_alias_base(
    p_organization_id, p_source_profile_id, p_target_profile_id,
    p_reason, p_actor_user_id
  );
  v_review_id := NULLIF(v_result ->> 'reviewId', '')::uuid;
  IF v_review_id IS NOT NULL THEN
    UPDATE plugin_data.csf_profile_merge_meeting_attendance_consolidations
    SET merge_review_id = v_review_id
    WHERE organization_id = p_organization_id
      AND consolidation_id = v_consolidation_id;
  END IF;
  RETURN v_result || pg_catalog.jsonb_build_object(
    'consolidatedMeetingAttendance', v_consolidation_count
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_class_source_keys(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_class_source_keys(uuid, uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan_coordinate_alias_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview_coordinate_alias_base(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_coordinate_alias_base(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  TO postgres;
ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  SET search_path = '';
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMENT ON TABLE plugin_data.csf_profile_merge_meeting_attendance_consolidations IS
  'Private immutable evidence for identical meeting-attendance rows consolidated during an exact roster-key profile merge.';
COMMENT ON FUNCTION plugin_data.csf_profile_class_source_keys(uuid, uuid) IS
  'Owner-internal roster-key evidence, including a committed same-coordinate alias only when normalized names agree.';
COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid) IS
  'Returns the canonical merge preview and permits exact-key consolidation only when overlapping term and meeting outcomes agree.';
