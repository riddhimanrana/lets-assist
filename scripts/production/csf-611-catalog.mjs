// Require organization-scoped claims and two-phase Storage teardown.
export function csf611Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_indexes AS index_record
      WHERE index_record.schemaname = 'plugin_data'
        AND index_record.tablename = 'csf_storage_deletion_queue'
        AND index_record.indexname = 'csf_storage_deletion_queue_org_unclaimed_idx'
        AND index_record.indexdef LIKE '%(organization_id, enqueued_at, id)%'
        AND index_record.indexdef LIKE '%WHERE (claim_token IS NULL)%'
    )
    AND (
      SELECT count(*) = 2 AND bool_and(
        procedure_record.proowner = 'postgres'::regrole
        AND procedure_record.prosecdef
        AND procedure_record.proconfig = ARRAY['search_path=""']
        AND pg_catalog.has_function_privilege(
          'service_role', procedure_record.oid, 'EXECUTE'
        )
        AND NOT pg_catalog.has_function_privilege(
          'anon', procedure_record.oid, 'EXECUTE'
        )
        AND NOT pg_catalog.has_function_privilege(
          'authenticated', procedure_record.oid, 'EXECUTE'
        )
        AND (
          SELECT count(*) = 2
            AND bool_and(
              acl.grantee IN (
                'postgres'::regrole, 'service_role'::regrole
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
              AND acl.grantor = 'postgres'::regrole
            )
          FROM pg_catalog.aclexplode(procedure_record.proacl) AS acl
        )
      )
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid IN (
        'plugin_data.csf_claim_organization_storage_deletion_queue(uuid,integer)'::regprocedure,
        'plugin_data.csf_purge_storage_deletion_queue(uuid)'::regprocedure
      )
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'plugin_data.csf_claim_organization_storage_deletion_queue(uuid,integer)'::regprocedure
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'pg_catalog.pg_advisory_xact_lock'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'queue.organization_id = p_organization_id'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'FOR UPDATE SKIP LOCKED'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'csf_announcement_attachments'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'claim_token = v_claim_token'
        ) > 0
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'plugin_data.csf_purge_storage_deletion_queue(uuid)'::regprocedure
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'DELETE FROM plugin_data.csf_announcement_attachments'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'FOR UPDATE'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          '''status'', ''cleanup_required'''
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          '''claimedQueueRows'', v_claimed_queue_rows'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'IF v_queue_rows > 0 THEN'
        ) < pg_catalog.strpos(
          procedure_record.prosrc,
          'DELETE FROM plugin_data.csf_attachment_restore_preparations'
        )
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'DELETE FROM plugin_data.csf_attachment_restore_preparations'
        ) < pg_catalog.strpos(
          procedure_record.prosrc,
          'DELETE FROM plugin_data.csf_storage_deletion_receipts'
        )
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'DELETE FROM plugin_data.csf_storage_deletion_queue'
        ) = 0
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
