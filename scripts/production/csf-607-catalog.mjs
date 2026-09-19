// Require the atomic wrapper to join the organization lock order before the
// post mutation can lock the announcement row.
export function csf607Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE p.oid = pg_catalog.to_regprocedure(
        'plugin_data.csf_update_post_with_attachments(uuid,uuid,jsonb,jsonb,uuid,uuid)'
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
          'PERFORM pg_catalog.pg_advisory_xact_lock('
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'plugin_data.csf_staff_access_lock_key(p_organization_id)'
        ) > pg_catalog.strpos(
          p.prosrc,
          'PERFORM pg_catalog.pg_advisory_xact_lock('
        )
        AND pg_catalog.strpos(
          p.prosrc,
          'PERFORM pg_catalog.pg_advisory_xact_lock('
        ) < pg_catalog.strpos(
          p.prosrc,
          'v_mutation := plugin_data.csf_mutate_post('
        )
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
