BEGIN;

CREATE FUNCTION plugin_data.csf_class_import_review_rows(
  p_organization_id uuid,
  p_job_id uuid,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  sheet_tab_name text,
  row_number integer,
  import_status text,
  normalized_data jsonb,
  warnings text[],
  errors text[],
  review_reason text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT r.id, r.sheet_tab_name, r.row_number, r.import_status,
    r.normalized_data, r.warnings, r.errors,
    CASE WHEN r.import_status = 'pending' THEN 'identity_review'::text END
  FROM plugin_data.csf_sheet_import_rows AS r
  JOIN plugin_data.csf_sheet_import_jobs AS j
    ON j.id = r.job_id AND j.organization_id = r.organization_id
  WHERE r.organization_id = p_organization_id
    AND r.job_id = p_job_id
    AND j.mode = 'preview'
    AND j.source_type = 'class_history'
    AND (
      r.import_status IN ('ambiguous', 'conflict', 'duplicate', 'error')
      OR (
        r.import_status = 'pending'
        AND r.matched_profile_id IS NULL
        AND (
          NOT plugin_data.csf_class_history_has_stable_source_key(r.normalized_data)
          OR plugin_data.csf_class_history_source_key_requires_review(
            r.organization_id, r.id
          )
        )
      )
    )
  ORDER BY r.row_number NULLS LAST, r.id
  LIMIT greatest(1, least(50, coalesce(p_limit, 25)));
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_class_import_review_rows(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_import_review_rows(uuid,uuid,integer)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_class_import_review_rows(uuid,uuid,integer) IS
  'Service-only class preview review rows, including pending identities blocked by authoritative source lineage. Does not change source or profile records.';

COMMIT;
