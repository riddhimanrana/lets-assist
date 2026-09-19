// Require publication recovery requests to survive officer account deletion.
export function csf612Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS actor_column
      WHERE actor_column.attrelid =
        'plugin_data.csf_post_publication_requests'::regclass
        AND actor_column.attname = 'actor_user_id'
        AND actor_column.atttypid = 'uuid'::regtype
        AND NOT actor_column.attnotnull
        AND actor_column.attnum > 0
        AND NOT actor_column.attisdropped
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS actor_constraint
      JOIN pg_catalog.pg_attribute AS actor_column
        ON actor_column.attrelid = actor_constraint.conrelid
       AND actor_column.attname = 'actor_user_id'
       AND actor_column.attnum = actor_constraint.conkey[1]
      WHERE actor_constraint.conrelid =
        'plugin_data.csf_post_publication_requests'::regclass
        AND actor_constraint.conname =
          'csf_post_publication_requests_actor_user_id_fkey'
        AND actor_constraint.contype = 'f'
        AND actor_constraint.confrelid = 'auth.users'::regclass
        AND actor_constraint.confdeltype = 'n'
        AND actor_constraint.convalidated
        AND pg_catalog.cardinality(actor_constraint.conkey) = 1
        AND pg_catalog.cardinality(actor_constraint.confkey) = 1
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
