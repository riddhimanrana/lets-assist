-- Allow the existing audited profile merge to recognize two unclaimed records
-- as one identity only when both originate from the same official class-history
-- workbook. Every relationship, semester, account, and recovery conflict from
-- the existing preview remains authoritative.

ALTER FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  RENAME TO csf_profile_merge_preview_source_identity_base;

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
  v_source_backed_identity boolean := false;
BEGIN
  v_preview := plugin_data.csf_profile_merge_preview_source_identity_base(
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

  SELECT pg_catalog.count(*) > 0
  INTO v_source_backed_identity
  FROM plugin_data.csf_profiles AS source_profile
  JOIN plugin_data.csf_profiles AS target_profile
    ON target_profile.organization_id = source_profile.organization_id
   AND target_profile.id = p_target_profile_id
  JOIN plugin_data.csf_sheet_import_rows AS source_row
    ON source_row.organization_id = source_profile.organization_id
   AND source_row.id = CASE
     WHEN source_profile.source_summary ->> 'importRowId'
       ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     THEN (source_profile.source_summary ->> 'importRowId')::uuid
     ELSE NULL
   END
  JOIN plugin_data.csf_sheet_import_rows AS target_row
    ON target_row.organization_id = target_profile.organization_id
   AND target_row.id = CASE
     WHEN target_profile.source_summary ->> 'importRowId'
       ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     THEN (target_profile.source_summary ->> 'importRowId')::uuid
     ELSE NULL
   END
  JOIN plugin_data.csf_sheet_import_jobs AS source_job
    ON source_job.organization_id = source_row.organization_id
   AND source_job.id = source_row.job_id
  JOIN plugin_data.csf_sheet_import_jobs AS target_job
    ON target_job.organization_id = target_row.organization_id
   AND target_job.id = target_row.job_id
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
    AND source_profile.normalized_school_email IS NULL
    AND source_profile.normalized_personal_email IS NULL
    AND target_profile.normalized_school_email IS NULL
    AND target_profile.normalized_personal_email IS NULL
    AND source_job.mode = 'preview'
    AND target_job.mode = 'preview'
    AND source_job.source_type = 'class_history'
    AND target_job.source_type = 'class_history'
    AND NULLIF(source_job.source_file_id, '') IS NOT NULL
    AND source_job.source_file_id = target_job.source_file_id
    AND (
      source_row.sheet_tab_name IS DISTINCT FROM target_row.sheet_tab_name
      OR source_row.row_number = target_row.row_number
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

  IF v_source_backed_identity THEN
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
    '{identityEvidence,sourceBackedWorkbookMatch}',
    pg_catalog.to_jsonb(v_source_backed_identity),
    true
  );
  RETURN v_preview || pg_catalog.jsonb_build_object(
    'conflicts', v_conflicts,
    'canMerge', pg_catalog.jsonb_array_length(v_conflicts) = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview_source_identity_base(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview_source_identity_base(uuid, uuid, uuid) IS
  'Internal profile merge preview before exact class-workbook identity corroboration. Not client executable.';
COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid) IS
  'Returns the canonical CSF profile merge preview. Exact same-workbook class-history provenance may replace only the missing-email identity blocker; every other conflict remains authoritative.';
