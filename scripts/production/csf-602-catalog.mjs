// This append verifies that scoped application imports reserve the ordinary
// approval request coordinate and refuse an existing batch before mutation.
export function csf602Catalog(previous) {
  const predecessor = previous
    .trim()
    .replace(/;$/u, "")
    .replace(
      "a452eea82e258fe4351689c79d7acc93",
      "42874a1ae35c55cd10b8f6ddd68d2835",
    );

  return `SELECT CASE WHEN (${predecessor}) = 1
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'plugin_data'
        AND p.proname = 'csf_queue_scoped_application_import'
        AND pg_catalog.pg_get_function_identity_arguments(p.oid)
          = 'p_organization_id uuid, p_parent_row_id uuid, p_actor_user_id uuid, p_expected_profile_id uuid, p_expected_resolved_at timestamp with time zone, p_request_id uuid, p_reason text'
        AND pg_catalog.strpos(p.prosrc, 'csf_import_approval_batch:') > 0
        AND pg_catalog.strpos(
          p.prosrc, 'This request ID already belongs to another import approval.'
        ) > 0
        AND pg_catalog.strpos(p.prosrc, 'csf_staff_access_lock_key')
          < pg_catalog.strpos(p.prosrc, 'csf_assert_import_actor_for_job')
        AND pg_catalog.strpos(p.prosrc, 'csf_assert_import_actor_for_job')
          < pg_catalog.strpos(p.prosrc, 'csf_import_approval_batch:')
        AND pg_catalog.strpos(p.prosrc, 'csf_import_approval_batch:')
          < pg_catalog.strpos(p.prosrc, 'csf_lock_identity_mutation')
        AND pg_catalog.strpos(p.prosrc, 'csf_lock_identity_mutation')
          < pg_catalog.strpos(p.prosrc, 'csf_lock_import_commit_coordinate')
        AND pg_catalog.strpos(p.prosrc, 'csf_import_approval_batch:')
          < pg_catalog.strpos(p.prosrc, 'INSERT INTO plugin_data.csf_sheet_import_jobs')
        AND pg_catalog.strpos(
          p.prosrc, 'This request ID already belongs to another import approval.'
        ) < pg_catalog.strpos(p.prosrc, 'INSERT INTO plugin_data.csf_sheet_import_jobs')
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
