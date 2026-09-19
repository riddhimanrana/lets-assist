// Require bounded takeover and token fencing for abandoned Storage deletions.
export function csf613Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND (
      SELECT count(*) = 2 AND bool_and(
        index_record.indexdef LIKE '%claimed_at%'
        AND index_record.indexdef LIKE '%enqueued_at%'
        AND index_record.indexdef LIKE '%WHERE (claim_token IS NOT NULL)%'
      )
      FROM pg_catalog.pg_indexes AS index_record
      WHERE index_record.schemaname = 'plugin_data'
        AND index_record.tablename = 'csf_storage_deletion_queue'
        AND index_record.indexname IN (
          'csf_storage_deletion_queue_stale_claim_idx',
          'csf_storage_deletion_queue_org_stale_claim_idx'
        )
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
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'queue.claimed_at <= now() - interval ''15 minutes'''
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'v_claim_token := gen_random_uuid()'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'FOR UPDATE SKIP LOCKED'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'Storage deletion claim lease expired.'
        ) > 0
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
        'plugin_data.csf_claim_storage_deletion_queue(integer)'::regprocedure,
        'plugin_data.csf_claim_organization_storage_deletion_queue(uuid,integer)'::regprocedure
      )
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
