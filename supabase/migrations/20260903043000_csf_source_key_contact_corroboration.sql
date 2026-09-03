-- Refuse automatic class-history profile reuse when a workbook key is only a
-- normalized student name and the current row has no contact corroboration.

BEGIN;

ALTER FUNCTION plugin_data.csf_class_history_source_key_target(uuid, uuid)
  RENAME TO csf_class_history_source_key_target_name_only_v1;

REVOKE ALL ON FUNCTION
  plugin_data.csf_class_history_source_key_target_name_only_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  plugin_data.csf_class_history_source_key_target_name_only_v1(uuid, uuid)
  TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_class_history_source_key_target(
  p_organization_id uuid,
  p_import_row_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_school_email text;
  v_personal_email text;
  v_candidate_profile_id uuid;
BEGIN
  SELECT
    pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(
      import_row.normalized_data #>> '{record,contact,schoolEmail}',
      import_row.normalized_data #>> '{contact,schoolEmail}',
      ''
    )), '')),
    pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(
      import_row.normalized_data #>> '{record,contact,personalEmail}',
      import_row.normalized_data #>> '{contact,personalEmail}',
      ''
    )), ''))
  INTO v_school_email, v_personal_email
  FROM plugin_data.csf_sheet_import_rows AS import_row
  JOIN plugin_data.csf_sheet_import_jobs AS job
    ON job.organization_id = import_row.organization_id
   AND job.id = import_row.job_id
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND job.mode = 'preview'
    AND job.source_type = 'class_history';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_candidate_profile_id :=
    plugin_data.csf_class_history_source_key_target_name_only_v1(
    p_organization_id,
    p_import_row_id
  );

  IF v_school_email IS NULL AND v_personal_email IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_candidate_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION
  plugin_data.csf_class_history_source_key_target(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  plugin_data.csf_class_history_source_key_target(uuid, uuid)
  TO postgres;

COMMENT ON FUNCTION
  plugin_data.csf_class_history_source_key_target_name_only_v1(uuid, uuid) IS
  'Legacy owner-internal source-key resolver. Call only through the contact-corroborating csf_class_history_source_key_target wrapper.';
COMMENT ON FUNCTION
  plugin_data.csf_class_history_source_key_target(uuid, uuid) IS
  'Owner-internal lookup for one active profile established by the same organization, workbook, class, stable source key, immutable normalized name, and matching school or personal email. Name-only rows return null for officer review.';

COMMIT;
