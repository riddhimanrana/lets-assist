// Require the complete CSF Storage cleanup claim and restoration fence.
export function csf610Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS attribute_record
      WHERE attribute_record.attrelid = 'plugin_data.csf_storage_deletion_queue'::regclass
        AND attribute_record.attname = 'claim_token'
        AND attribute_record.atttypid = 'uuid'::regtype
        AND attribute_record.attnum > 0 AND NOT attribute_record.attisdropped
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS attribute_record
      WHERE attribute_record.attrelid = 'plugin_data.csf_announcement_attachments'::regclass
        AND attribute_record.attname = 'restore_request_id'
        AND attribute_record.atttypid = 'uuid'::regtype
        AND attribute_record.attnum > 0 AND NOT attribute_record.attisdropped
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_record
      WHERE constraint_record.conrelid = 'plugin_data.csf_announcement_attachments'::regclass
        AND constraint_record.conname = 'csf_announcement_attachments_object_path_scope_check'
        AND pg_catalog.pg_get_constraintdef(constraint_record.oid) LIKE '%/dvhs-csf/post-images/%'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation_record
      WHERE relation_record.oid = 'plugin_data.csf_storage_deletion_receipts'::regclass
        AND relation_record.relrowsecurity
        AND NOT pg_catalog.has_table_privilege('service_role', relation_record.oid, 'SELECT')
        AND NOT pg_catalog.has_table_privilege('service_role', relation_record.oid, 'INSERT')
        AND NOT pg_catalog.has_table_privilege('service_role', relation_record.oid, 'UPDATE')
        AND NOT pg_catalog.has_table_privilege('service_role', relation_record.oid, 'DELETE')
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation_record
      WHERE relation_record.oid = 'plugin_data.csf_attachment_restore_preparations'::regclass
        AND relation_record.relrowsecurity
        AND NOT pg_catalog.has_table_privilege('service_role', relation_record.oid, 'SELECT')
        AND NOT pg_catalog.has_table_privilege('service_role', relation_record.oid, 'INSERT')
        AND NOT pg_catalog.has_table_privilege('service_role', relation_record.oid, 'UPDATE')
        AND NOT pg_catalog.has_table_privilege('service_role', relation_record.oid, 'DELETE')
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role', 'plugin_data.csf_storage_deletion_queue', 'SELECT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role', 'plugin_data.csf_storage_deletion_queue', 'INSERT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role', 'plugin_data.csf_storage_deletion_queue', 'UPDATE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role', 'plugin_data.csf_storage_deletion_queue', 'DELETE'
    )
    AND pg_catalog.has_table_privilege(
      'service_role', 'plugin_data.csf_announcement_attachments', 'SELECT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role', 'plugin_data.csf_announcement_attachments', 'INSERT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role', 'plugin_data.csf_announcement_attachments', 'UPDATE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role', 'plugin_data.csf_announcement_attachments', 'DELETE'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_record
      WHERE trigger_record.tgrelid = 'plugin_data.csf_announcement_attachments'::regclass
        AND trigger_record.tgname = 'csf_reconcile_attachment_restore_cleanup'
        AND NOT trigger_record.tgisinternal
        AND trigger_record.tgenabled = 'O'
    )
    AND (
      SELECT count(*) = 4 AND bool_and(
        p.proowner = 'postgres'::regrole
        AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=""']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND (
          SELECT count(*) = 2
            AND bool_and(
              acl.grantee IN ('postgres'::regrole, 'service_role'::regrole)
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
              AND acl.grantor = 'postgres'::regrole
            )
          FROM pg_catalog.aclexplode(p.proacl) AS acl
        )
      )
      FROM pg_catalog.pg_proc AS p
      WHERE p.oid IN (
        'plugin_data.csf_claim_storage_deletion_queue(integer)'::regprocedure,
        'plugin_data.csf_ack_storage_deletion_claim(uuid,uuid,boolean)'::regprocedure,
        'plugin_data.csf_prepare_announcement_attachment_restore(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
        'plugin_data.csf_purge_storage_deletion_queue(uuid)'::regprocedure
      )
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = 'plugin_data.csf_claim_storage_deletion_queue(integer)'::regprocedure
        AND pg_catalog.strpos(p.prosrc, 'FOR UPDATE SKIP LOCKED') > 0
        AND pg_catalog.strpos(p.prosrc, 'csf_announcement_attachments') > 0
        AND pg_catalog.strpos(p.prosrc, 'claim_token = v_claim_token') > 0
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = 'plugin_data.csf_ack_storage_deletion_claim(uuid,uuid,boolean)'::regprocedure
        AND pg_catalog.strpos(p.prosrc, 'queue.claim_token = p_claim_token') > 0
        AND pg_catalog.strpos(p.prosrc, 'csf_storage_deletion_receipts') > 0
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = 'plugin_data.csf_prepare_announcement_attachment_restore(uuid,uuid,uuid,uuid,text,text)'::regprocedure
        AND pg_catalog.strpos(p.prosrc, 'v_request.actor_user_id IS DISTINCT FROM p_actor_user_id') > 0
        AND pg_catalog.strpos(p.prosrc, 'v_request.attachment_status IS DISTINCT FROM ''pending''') > 0
        AND pg_catalog.strpos(p.prosrc, 'v_queue.claim_token IS NOT NULL') > 0
        AND pg_catalog.strpos(p.prosrc, 'csf_attachment_restore_preparations') > 0
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = 'plugin_data.csf_purge_storage_deletion_queue(uuid)'::regprocedure
        AND pg_catalog.strpos(p.prosrc, 'DELETE FROM plugin_data.csf_announcement_attachments') > 0
        AND pg_catalog.strpos(p.prosrc, 'DELETE FROM plugin_data.csf_announcement_attachments')
          < pg_catalog.strpos(p.prosrc, 'DELETE FROM plugin_data.csf_storage_deletion_queue')
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = 'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)'::regprocedure
        AND p.proowner = 'postgres'::regrole AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=""']
        AND pg_catalog.strpos(p.prosrc, 'v_request.actor_user_id IS DISTINCT FROM p_actor_user_id') > 0
        AND pg_catalog.strpos(p.prosrc, 'v_mutation_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id') > 0
        AND pg_catalog.strpos(p.prosrc, 'csf_validate_attachment_restore_preparation') > 0
        AND pg_catalog.strpos(p.prosrc, 'restore_request_id') > 0
        AND pg_catalog.strpos(p.prosrc, 'csf_validate_attachment_restore_preparation')
          < pg_catalog.strpos(p.prosrc, 'INSERT INTO plugin_data.csf_announcement_attachments')
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
