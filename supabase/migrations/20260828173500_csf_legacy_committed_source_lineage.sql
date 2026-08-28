-- Accept immutable committed workbook rows as source identity even when a
-- legacy profile predates the profile-level sheet-import summary marker.

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
  WITH source_profile AS (
    SELECT profile.*
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_source_profile_id
      AND profile.record_status = 'active'
  ),
  target_profile AS (
    SELECT profile.*
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_target_profile_id
      AND profile.record_status = 'active'
  ),
  source_evidence AS (
    SELECT import_row.sheet_tab_name, import_row.row_number,
      import_row.normalized_data, import_job.source_file_id
    FROM plugin_data.csf_sheet_import_rows AS import_row
    JOIN plugin_data.csf_sheet_import_jobs AS import_job
      ON import_job.organization_id = import_row.organization_id
     AND import_job.id = import_row.job_id
    CROSS JOIN source_profile AS profile
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
    SELECT import_row.sheet_tab_name, import_row.row_number,
      import_row.normalized_data, import_job.source_file_id
    FROM plugin_data.csf_sheet_import_rows AS import_row
    JOIN plugin_data.csf_sheet_import_jobs AS import_job
      ON import_job.organization_id = import_row.organization_id
     AND import_job.id = import_row.job_id
    CROSS JOIN target_profile AS profile
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
  SELECT EXISTS (
    SELECT 1
    FROM source_profile AS source
    JOIN target_profile AS target
      ON target.organization_id = source.organization_id
     AND target.normalized_first_name = source.normalized_first_name
     AND target.normalized_last_name = source.normalized_last_name
    JOIN source_evidence ON true
    JOIN target_evidence
      ON target_evidence.source_file_id = source_evidence.source_file_id
    CROSS JOIN LATERAL (
      SELECT
        pg_catalog.lower(pg_catalog.regexp_replace(
          COALESCE(
            source_evidence.normalized_data #>> '{record,identity,sourceStudentKey}',
            source_evidence.normalized_data #>> '{identity,sourceStudentKey}'
          ), '[[:space:]]+', '', 'g'
        )) AS source_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          COALESCE(
            target_evidence.normalized_data #>> '{record,identity,sourceStudentKey}',
            target_evidence.normalized_data #>> '{identity,sourceStudentKey}'
          ), '[[:space:]]+', '', 'g'
        )) AS target_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          source.normalized_first_name || source.normalized_last_name,
          '[[:space:]]+', '', 'g'
        )) AS first_last_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          source.normalized_last_name || source.normalized_first_name,
          '[[:space:]]+', '', 'g'
        )) AS last_first_key
    ) AS keys
    WHERE keys.source_key IS NOT NULL
      AND keys.source_key <> ''
      AND keys.target_key IS NOT NULL
      AND keys.target_key <> ''
      AND keys.source_key IN (keys.first_last_key, keys.last_first_key)
      AND keys.target_key IN (keys.first_last_key, keys.last_first_key)
      AND (
        source_evidence.sheet_tab_name IS DISTINCT FROM target_evidence.sheet_tab_name
        OR source_evidence.row_number = target_evidence.row_number
      )
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid) IS
  'Returns true when two active same-name profiles have exact name-derived roster keys in committed rows from one class workbook. Immutable matched-row lineage is sufficient for legacy profiles without a profile-level import marker.';
