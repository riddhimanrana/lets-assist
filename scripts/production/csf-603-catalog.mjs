// This append verifies the private post-image relation and service-only
// mutation boundary. Its request-receipt index also moves the reviewed
// csf_admin_audit_events relation fingerprint.
export function csf603Catalog(previous) {
  const predecessor = previous
    .trim()
    .replace(/;$/u, "")
    .replace(
      "317cf813aa3f7dfdedaa8a21ac872343",
      "fb4732ca4e5263b59a48b344b72c05a9",
    );

  return `SELECT CASE WHEN (${predecessor}) = 1
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'plugin_data'
        AND c.relname = 'csf_announcement_attachments'
        AND c.relkind = 'r' AND c.relrowsecurity
        AND NOT has_table_privilege('anon', c.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
        AND has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint k
          WHERE k.conrelid = c.oid
            AND k.conname = 'csf_announcement_attachments_object_path_scope_check'
            AND k.contype = 'c' AND k.convalidated
        )
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = c.oid
            AND t.tgname = 'csf_announcement_attachment_cleanup'
            AND NOT t.tgisinternal AND t.tgenabled = 'O'
        )
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'plugin_data'
        AND c.relname = 'csf_post_publication_requests'
        AND c.relkind = 'r' AND c.relrowsecurity
        AND NOT has_table_privilege('anon', c.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
        AND has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure(
        'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)'
      )
        AND p.proowner = 'postgres'::regrole AND p.prosecdef
        AND p.prorettype = 'jsonb'::regtype AND l.lanname = 'plpgsql'
        AND p.prokind = 'f' AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=""']
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND pg_catalog.strpos(p.prosrc, 'csf_actor_has_permission') > 0
        AND pg_catalog.strpos(p.prosrc, 'post_attachments_replaced') > 0
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure(
        'plugin_data.csf_begin_post_publication_request(uuid,uuid,uuid,integer,bigint,boolean)'
      )
        AND p.proowner = 'postgres'::regrole AND p.prosecdef
        AND p.prorettype = 'void'::regtype
        AND p.proconfig = ARRAY['search_path=""']
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND pg_catalog.strpos(p.prosrc, 'csf_staff_access_lock_key') > 0
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure(
        'plugin_data.csf_resolve_post_publication_completion(uuid,uuid,uuid,uuid)'
      )
        AND p.proowner = 'postgres'::regrole AND p.prosecdef
        AND p.prorettype = 'jsonb'::regtype
        AND p.proconfig = ARRAY['search_path=""']
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND pg_catalog.strpos(p.prosrc, 'attachments_not_saved') > 0
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure(
        'plugin_data.csf_post_attachments_ready_for_email(uuid,uuid,uuid)'
      )
        AND p.proowner = 'postgres'::regrole AND p.prosecdef
        AND p.prorettype = 'boolean'::regtype
        AND p.proconfig = ARRAY['search_path=""']
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND pg_catalog.strpos(p.prosrc, 'attachment_status') > 0
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
