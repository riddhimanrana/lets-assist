-- Older imported profiles can point to an origin row created before roster
-- keys were stored. Later committed previews keep the key and the matched
-- profile id. Let the canonical merge preview use either immutable origin or
-- committed matched-row lineage from the same official workbook.

ALTER FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  RENAME TO csf_profile_merge_preview_committed_lineage_base;

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
  v_committed_source_key_identity boolean := false;
BEGIN
  v_preview := plugin_data.csf_profile_merge_preview_committed_lineage_base(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id
  );
  IF v_preview IS NULL OR pg_catalog.jsonb_typeof(v_preview) <> 'object' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return a canonical object.';
  END IF;
  v_conflicts := v_preview -> 'conflicts';
  IF pg_catalog.jsonb_typeof(v_conflicts) <> 'array' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return canonical conflicts.';
  END IF;

  WITH source_evidence AS (
    SELECT
      import_row.sheet_tab_name,
      import_row.row_number,
      import_row.normalized_data,
      import_job.source_file_id
    FROM plugin_data.csf_sheet_import_rows AS import_row
    JOIN plugin_data.csf_sheet_import_jobs AS import_job
      ON import_job.organization_id = import_row.organization_id
     AND import_job.id = import_row.job_id
    JOIN plugin_data.csf_profiles AS profile
      ON profile.organization_id = import_row.organization_id
     AND profile.id = p_source_profile_id
    WHERE import_row.organization_id = p_organization_id
      AND import_row.import_status IN ('created', 'updated')
      AND import_job.mode = 'preview'
      AND import_job.source_type = 'class_history'
      AND NULLIF(import_job.source_file_id, '') IS NOT NULL
      AND (
        import_row.matched_profile_id = profile.id
        OR import_row.id = CASE
          WHEN profile.source_summary ->> 'importRowId'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (profile.source_summary ->> 'importRowId')::uuid
          ELSE NULL
        END
      )
  ),
  target_evidence AS (
    SELECT
      import_row.sheet_tab_name,
      import_row.row_number,
      import_row.normalized_data,
      import_job.source_file_id
    FROM plugin_data.csf_sheet_import_rows AS import_row
    JOIN plugin_data.csf_sheet_import_jobs AS import_job
      ON import_job.organization_id = import_row.organization_id
     AND import_job.id = import_row.job_id
    JOIN plugin_data.csf_profiles AS profile
      ON profile.organization_id = import_row.organization_id
     AND profile.id = p_target_profile_id
    WHERE import_row.organization_id = p_organization_id
      AND import_row.import_status IN ('created', 'updated')
      AND import_job.mode = 'preview'
      AND import_job.source_type = 'class_history'
      AND NULLIF(import_job.source_file_id, '') IS NOT NULL
      AND (
        import_row.matched_profile_id = profile.id
        OR import_row.id = CASE
          WHEN profile.source_summary ->> 'importRowId'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (profile.source_summary ->> 'importRowId')::uuid
          ELSE NULL
        END
      )
  )
  SELECT pg_catalog.count(*) > 0
  INTO v_committed_source_key_identity
  FROM plugin_data.csf_profiles AS source_profile
  JOIN plugin_data.csf_profiles AS target_profile
    ON target_profile.organization_id = source_profile.organization_id
   AND target_profile.id = p_target_profile_id
  JOIN source_evidence ON true
  JOIN target_evidence
    ON target_evidence.source_file_id = source_evidence.source_file_id
  CROSS JOIN LATERAL (
    SELECT
      pg_catalog.lower(pg_catalog.regexp_replace(
        COALESCE(
          source_evidence.normalized_data #>> '{record,identity,sourceStudentKey}',
          source_evidence.normalized_data #>> '{identity,sourceStudentKey}'
        ),
        '[[:space:]]+', '', 'g'
      )) AS source_key,
      pg_catalog.lower(pg_catalog.regexp_replace(
        COALESCE(
          target_evidence.normalized_data #>> '{record,identity,sourceStudentKey}',
          target_evidence.normalized_data #>> '{identity,sourceStudentKey}'
        ),
        '[[:space:]]+', '', 'g'
      )) AS target_key,
      pg_catalog.lower(pg_catalog.regexp_replace(
        source_profile.normalized_first_name || source_profile.normalized_last_name,
        '[[:space:]]+', '', 'g'
      )) AS first_last_key,
      pg_catalog.lower(pg_catalog.regexp_replace(
        source_profile.normalized_last_name || source_profile.normalized_first_name,
        '[[:space:]]+', '', 'g'
      )) AS last_first_key
  ) AS keys
  WHERE source_profile.organization_id = p_organization_id
    AND source_profile.id = p_source_profile_id
    AND source_profile.record_status = 'active'
    AND target_profile.record_status = 'active'
    AND source_profile.source_summary ->> 'importedFrom' = 'csf_sheet_sync'
    AND target_profile.source_summary ->> 'importedFrom' = 'csf_sheet_sync'
    AND source_profile.normalized_first_name IS NOT NULL
    AND source_profile.normalized_last_name IS NOT NULL
    AND source_profile.normalized_first_name = target_profile.normalized_first_name
    AND source_profile.normalized_last_name = target_profile.normalized_last_name
    AND keys.source_key IS NOT NULL
    AND keys.source_key <> ''
    AND keys.target_key IS NOT NULL
    AND keys.target_key <> ''
    AND keys.source_key IN (keys.first_last_key, keys.last_first_key)
    AND keys.target_key IN (keys.first_last_key, keys.last_first_key)
    AND (
      source_evidence.sheet_tab_name IS DISTINCT FROM target_evidence.sheet_tab_name
      OR source_evidence.row_number = target_evidence.row_number
    )
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_cohort_memberships AS source_membership
      JOIN plugin_data.csf_profile_cohort_memberships AS target_membership
        ON target_membership.organization_id = source_membership.organization_id
       AND target_membership.cohort_id = source_membership.cohort_id
       AND target_membership.profile_id = p_target_profile_id
       AND target_membership.status = 'active'
      WHERE source_membership.organization_id = p_organization_id
        AND source_membership.profile_id = p_source_profile_id
        AND source_membership.status = 'active'
    );

  IF v_committed_source_key_identity THEN
    SELECT COALESCE(
      pg_catalog.jsonb_agg(entry.conflict ORDER BY entry.ordinal),
      '[]'::jsonb
    )
    INTO v_conflicts
    FROM pg_catalog.jsonb_array_elements(v_conflicts)
      WITH ORDINALITY AS entry(conflict, ordinal)
    WHERE entry.conflict ->> 'type' <> 'identity_email_missing';
  END IF;

  v_preview := pg_catalog.jsonb_set(
    v_preview,
    '{identityEvidence,committedSourceStudentKeyMatch}',
    pg_catalog.to_jsonb(v_committed_source_key_identity),
    true
  );
  RETURN v_preview || pg_catalog.jsonb_build_object(
    'conflicts', v_conflicts,
    'canMerge', pg_catalog.jsonb_array_length(v_conflicts) = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview_committed_lineage_base(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO service_role;

ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  SET search_path = '';
ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  SET search_path = '';

REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview_committed_lineage_base(uuid, uuid, uuid) IS
  'Internal merge preview before committed class-workbook roster-key lineage corroboration. Not client executable.';
COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid) IS
  'Returns the canonical CSF profile merge preview. Immutable origin or committed matched-row lineage may prove an exact name-derived roster key from one official class workbook; concrete identity and relationship conflicts remain authoritative.';
