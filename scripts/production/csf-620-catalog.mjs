// Pin request-scoped post-image generations and immediate teardown cancellation
// of unfinished restore leases.
export function csf620Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
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
      )
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid IN (
        'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)'::regprocedure,
        'plugin_data.csf_purge_storage_deletion_queue(uuid)'::regprocedure
      )
    )
    AND (
      SELECT procedure_record.proowner = 'postgres'::regrole
        AND procedure_record.prosecdef
        AND procedure_record.proconfig = ARRAY['search_path=""']
        AND NOT pg_catalog.has_function_privilege(
          'service_role', procedure_record.oid, 'EXECUTE'
        )
        AND NOT pg_catalog.has_function_privilege(
          'anon', procedure_record.oid, 'EXECUTE'
        )
        AND NOT pg_catalog.has_function_privilege(
          'authenticated', procedure_record.oid, 'EXECUTE'
        )
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'plugin_data.csf_reconcile_attachment_restore_cleanup()'::regprocedure
    )
    AND (
      SELECT pg_catalog.strpos(
          procedure_record.prosrc,
          'p_request_id::text || ''/'' || v_checksum'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'IF NOT FOUND'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'v_mutation_receipt.target_type IS DISTINCT FROM ''csf_announcement'''
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'That post image already exists. Keep the existing image instead.'
        ) > 0
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)'::regprocedure
    )
    AND (
      SELECT pg_catalog.strpos(
          procedure_record.prosrc,
          'NEW.restore_request_id::text || ''/'''
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'preparation.request_id = NEW.restore_request_id'
        ) > 0
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'plugin_data.csf_reconcile_attachment_restore_cleanup()'::regprocedure
    )
    AND (
      SELECT pg_catalog.strpos(
          procedure_record.prosrc,
          'DELETE FROM plugin_data.csf_attachment_restore_preparations'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'DELETE FROM plugin_data.csf_attachment_restore_preparations'
        ) < pg_catalog.strpos(
          procedure_record.prosrc,
          'FROM plugin_data.csf_storage_deletion_queue AS queue'
        )
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'consumed_at IS NULL'
        ) > 0
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'plugin_data.csf_purge_storage_deletion_queue(uuid)'::regprocedure
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_record
      WHERE constraint_record.conrelid =
          'plugin_data.csf_announcement_attachments'::regclass
        AND constraint_record.conname =
          'csf_announcement_attachments_object_path_scope_check'
        AND constraint_record.convalidated
        AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
          LIKE '%restore_request_id%'
        AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
          LIKE '%object_path%'
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
