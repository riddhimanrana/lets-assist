// This append verifies the scoped import relation and its reviewed functions
// without changing any earlier catalog fingerprint.
export function csf599Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'plugin_data'
        AND c.relname = 'csf_scoped_application_imports'
        AND c.relkind = 'r' AND c.relrowsecurity
        AND NOT has_table_privilege('anon', c.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
        AND has_table_privilege('service_role', c.oid, 'SELECT')
        AND NOT has_table_privilege('service_role', c.oid, 'INSERT')
        AND (SELECT count(*) = 1 FROM pg_catalog.pg_constraint k
          WHERE k.conrelid = c.oid AND k.contype = 'p')
        AND (SELECT count(*) = 3 FROM pg_catalog.pg_constraint k
          WHERE k.conrelid = c.oid AND k.contype = 'u')
        AND (SELECT count(*) = 6 FROM pg_catalog.pg_constraint k
          WHERE k.conrelid = c.oid AND k.contype = 'f')
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'expected_profile_id'
            AND a.atttypid = 'uuid'::regtype AND a.attnotnull
        )
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'expected_resolved_at'
            AND a.atttypid = 'timestamp with time zone'::regtype AND a.attnotnull
        )
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure(
        'plugin_data.csf_queue_scoped_application_import(uuid,uuid,uuid,uuid,timestamp with time zone,uuid,text)'
      )
        AND p.proowner = 'postgres'::regrole AND p.prosecdef
        AND p.prorettype = 'jsonb'::regtype AND l.lanname = 'plpgsql'
        AND p.prokind = 'f' AND p.provolatile = 'v' AND p.proparallel = 'u'
        AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
        AND p.pronargdefaults = 0 AND p.proconfig = ARRAY['search_path=""']
        AND md5(p.prosrc) = '0846142ab0a3a7cfd1e169cbb117c011'
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND (SELECT count(*) = 1 AND bool_and(
          a.grantee = 'service_role'::regrole
          AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable
          AND a.grantor = 'postgres'::regrole
        ) FROM pg_catalog.aclexplode(p.proacl) a)
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('plugin_data.csf_purge_import_recovery(uuid)')
        AND p.proowner = 'postgres'::regrole AND p.prosecdef
        AND p.prorettype = 'jsonb'::regtype AND l.lanname = 'plpgsql'
        AND p.prokind = 'f' AND p.provolatile = 'v' AND p.proparallel = 'u'
        AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
        AND p.pronargdefaults = 0 AND p.proconfig = ARRAY['search_path=""']
        AND md5(p.prosrc) = '336d3c82799ef2acc9c2756ff5fb22fc'
        AND has_function_privilege('postgres', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND (SELECT count(*) = 1 AND bool_and(
          a.grantee = 'postgres'::regrole
          AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable
          AND a.grantor = 'postgres'::regrole
        ) FROM pg_catalog.aclexplode(p.proacl) a)
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
