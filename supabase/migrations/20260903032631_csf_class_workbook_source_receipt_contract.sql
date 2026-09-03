-- Keep the generation-bound registrar owner-only and expose the same closed
-- five-field receipt used by every other sheet-source registration path.

ALTER FUNCTION plugin_data.csf_register_class_workbook_sheet_source(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
) RENAME TO csf_register_class_workbook_sheet_source_generation_bound_v1;

REVOKE ALL ON FUNCTION
  plugin_data.csf_register_class_workbook_sheet_source_generation_bound_v1(
    uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
  ) FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION
  plugin_data.csf_register_class_workbook_sheet_source_generation_bound_v1(
    uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
  ) TO postgres;

COMMENT ON FUNCTION
  plugin_data.csf_register_class_workbook_sheet_source_generation_bound_v1(
    uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
  ) IS
  'Owner-only generation-fenced class source registrar. Its legacy extra receipt field is removed by the reviewed service wrapper.';

CREATE FUNCTION plugin_data.csf_register_class_workbook_sheet_source(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_source_type text,
  p_registration jsonb,
  p_refresh_job_id uuid,
  p_refresh_lease_token uuid,
  p_workbook_id uuid,
  p_cohort_id uuid,
  p_drive_file_id text,
  p_provider_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN plugin_data.csf_register_class_workbook_sheet_source_generation_bound_v1(
    p_organization_id,
    p_actor_user_id,
    p_source_id,
    p_source_type,
    p_registration,
    p_refresh_job_id,
    p_refresh_lease_token,
    p_workbook_id,
    p_cohort_id,
    p_drive_file_id,
    p_provider_version
  ) - 'workbookGenerationBound';
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_register_class_workbook_sheet_source(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
) IS
  'Service-only class-workbook source mutation. It preserves the generation fence and returns the closed source-registration receipt accepted by the worker.';

REVOKE ALL ON FUNCTION plugin_data.csf_register_class_workbook_sheet_source(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_register_class_workbook_sheet_source(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
) TO service_role;

