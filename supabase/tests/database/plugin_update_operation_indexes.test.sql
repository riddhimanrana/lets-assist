BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(2);

SELECT extensions.has_index(
  'private',
  'plugin_update_operations',
  'plugin_update_operations_release_idx',
  'update operations have a covering release foreign-key index'
);

SELECT extensions.is(
  (
    SELECT string_agg(attributes.attname, ',' ORDER BY keys.ordinality)
    FROM pg_catalog.pg_class AS indexes
    JOIN pg_catalog.pg_namespace AS index_namespaces
      ON index_namespaces.oid = indexes.relnamespace
    JOIN pg_catalog.pg_index AS definitions
      ON definitions.indexrelid = indexes.oid
    CROSS JOIN LATERAL unnest(definitions.indkey)
      WITH ORDINALITY AS keys(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS attributes
      ON attributes.attrelid = definitions.indrelid
      AND attributes.attnum = keys.attnum
    WHERE index_namespaces.nspname = 'private'
      AND indexes.relname = 'plugin_update_operations_release_idx'
  ),
  'plugin_key,target_version',
  'the release index covers both the plugin and composite release foreign keys'
);

SELECT * FROM extensions.finish();
ROLLBACK;
