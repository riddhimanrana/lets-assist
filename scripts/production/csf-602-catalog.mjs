// This append verifies that scoped application imports reserve the ordinary
// approval request coordinate and refuse an existing batch before mutation.
export function csf602Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'plugin_data'
        AND p.proname = 'csf_queue_scoped_application_import'
        AND pg_catalog.pg_get_function_identity_arguments(p.oid)
          = 'p_organization_id uuid, p_parent_row_id uuid, p_actor_user_id uuid, p_expected_profile_id uuid, p_expected_resolved_at timestamp with time zone, p_request_id uuid, p_reason text'
        AND pg_catalog.position('csf_import_approval_batch:' IN p.prosrc) > 0
        AND pg_catalog.position(
          'This request ID already belongs to another import approval.' IN p.prosrc
        ) > 0
        AND pg_catalog.position('csf_staff_access_lock_key' IN p.prosrc)
          < pg_catalog.position('csf_assert_import_actor_for_job' IN p.prosrc)
        AND pg_catalog.position('csf_assert_import_actor_for_job' IN p.prosrc)
          < pg_catalog.position('csf_import_approval_batch:' IN p.prosrc)
        AND pg_catalog.position('csf_import_approval_batch:' IN p.prosrc)
          < pg_catalog.position('csf_lock_identity_mutation' IN p.prosrc)
        AND pg_catalog.position('csf_lock_identity_mutation' IN p.prosrc)
          < pg_catalog.position('csf_lock_import_commit_coordinate' IN p.prosrc)
        AND pg_catalog.position('csf_import_approval_batch:' IN p.prosrc)
          < pg_catalog.position('INSERT INTO plugin_data.csf_sheet_import_jobs' IN p.prosrc)
        AND pg_catalog.position(
          'This request ID already belongs to another import approval.' IN p.prosrc
        ) < pg_catalog.position('INSERT INTO plugin_data.csf_sheet_import_jobs' IN p.prosrc)
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
