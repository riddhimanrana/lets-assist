// This append verifies that officer deletion detaches the actor from a scoped
// import receipt without weakening the receipt's other immutable coordinates.
export function csf600Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = c.oid AND a.attname = 'actor_user_id'
      JOIN pg_catalog.pg_constraint k
        ON k.conrelid = c.oid
       AND k.conname = 'csf_scoped_application_imports_actor_user_id_fkey'
      WHERE n.nspname = 'plugin_data'
        AND c.relname = 'csf_scoped_application_imports'
        AND c.relkind = 'r'
        AND a.atttypid = 'uuid'::regtype
        AND NOT a.attnotnull
        AND k.contype = 'f'
        AND k.confrelid = 'auth.users'::regclass
        AND k.confdeltype = 'n'
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
