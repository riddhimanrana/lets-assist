// This append pins the service-only transaction that updates one CSF post and
// its attachment metadata together. The wrapper delegates to the two existing
// receipt-owning functions so exact retries retain their established identity.
export function csf605Catalog(previous) {
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
          'v_mutation := plugin_data.csf_mutate_post('
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'PERFORM plugin_data.csf_replace_post_attachments('
        ) > pg_catalog.strpos(
          p.prosrc,
          'v_mutation := plugin_data.csf_mutate_post('
        )
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
