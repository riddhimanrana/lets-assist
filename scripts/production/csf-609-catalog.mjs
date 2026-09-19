// Require publication recovery to prove request ownership and the matching
// immutable post mutation receipt before it can bind an unbound request.
export function csf609Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE p.oid = pg_catalog.to_regprocedure(
        'plugin_data.csf_resolve_post_publication_completion(uuid,uuid,uuid,uuid)'
      )
        AND p.proowner = 'postgres'::regrole
        AND p.prosecdef
        AND p.prorettype = 'jsonb'::regtype
        AND l.lanname = 'plpgsql'
        AND p.prokind = 'f'
        AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=""']
        AND pg_catalog.strpos(
          p.prosrc,
          'v_request.actor_user_id IS DISTINCT FROM p_actor_user_id'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'FROM plugin_data.csf_admin_audit_events AS audit'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'audit.source_type = ''post_mutation_request'''
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'v_mutation_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'v_mutation_receipt.target_type IS DISTINCT FROM ''csf_announcement'''
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'v_mutation_receipt.target_id IS DISTINCT FROM p_announcement_id'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'FROM plugin_data.csf_admin_audit_events AS audit'
        ) < pg_catalog.strpos(
          p.prosrc,
          'UPDATE plugin_data.csf_post_publication_requests AS request'
        )
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
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
