// Require durable, leased restore preparation until attachment metadata commits.
export function csf614Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_record
      WHERE column_record.table_schema = 'plugin_data'
        AND column_record.table_name = 'csf_attachment_restore_preparations'
        AND column_record.column_name = 'lease_expires_at'
        AND column_record.data_type = 'timestamp with time zone'
        AND column_record.is_nullable = 'NO'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_indexes AS index_record
      WHERE index_record.schemaname = 'plugin_data'
        AND index_record.tablename = 'csf_attachment_restore_preparations'
        AND index_record.indexname =
          'csf_attachment_restore_preparations_active_lease_idx'
        AND index_record.indexdef LIKE '%lease_expires_at%'
        AND index_record.indexdef LIKE '%WHERE (consumed_at IS NULL)%'
    )
    AND (
      SELECT count(*) = 5 AND bool_and(
        procedure_record.proowner = 'postgres'::regrole
        AND procedure_record.prosecdef
        AND procedure_record.proconfig = ARRAY['search_path=""']
        AND NOT pg_catalog.has_function_privilege(
          'anon', procedure_record.oid, 'EXECUTE'
        )
        AND NOT pg_catalog.has_function_privilege(
          'authenticated', procedure_record.oid, 'EXECUTE'
        )
      )
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid IN (
        'plugin_data.csf_prepare_announcement_attachment_restore(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
        'plugin_data.csf_validate_attachment_restore_preparation(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
        'plugin_data.csf_reconcile_attachment_restore_cleanup()'::regprocedure,
        'plugin_data.csf_claim_storage_deletion_queue(integer)'::regprocedure,
        'plugin_data.csf_claim_organization_storage_deletion_queue(uuid,integer)'::regprocedure
      )
    )
    AND (
      SELECT pg_catalog.strpos(p.prosrc, 'lease_expires_at > now()') > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'INSERT INTO plugin_data.csf_storage_deletion_queue'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'Post attachment restoration is already being prepared.'
        ) > 0
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      FROM pg_catalog.pg_proc AS p
      WHERE p.oid =
        'plugin_data.csf_prepare_announcement_attachment_restore(uuid,uuid,uuid,uuid,text,text)'::regprocedure
    )
    AND (
      SELECT pg_catalog.strpos(p.prosrc, 'lease_expires_at > now()') > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'DELETE FROM plugin_data.csf_storage_deletion_queue'
        ) > 0
        AND pg_catalog.strpos(p.prosrc, 'SET consumed_at = now()') > 0
      FROM pg_catalog.pg_proc AS p
      WHERE p.oid =
        'plugin_data.csf_reconcile_attachment_restore_cleanup()'::regprocedure
    )
    AND (
      SELECT count(*) = 2 AND bool_and(
        pg_catalog.strpos(
          p.prosrc,
          'preparation.lease_expires_at > now()'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'preparation.lease_expires_at <= now()'
        ) > 0
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      )
      FROM pg_catalog.pg_proc AS p
      WHERE p.oid IN (
        'plugin_data.csf_claim_storage_deletion_queue(integer)'::regprocedure,
        'plugin_data.csf_claim_organization_storage_deletion_queue(uuid,integer)'::regprocedure
      )
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
