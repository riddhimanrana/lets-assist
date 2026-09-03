BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

CREATE TEMP TABLE expected_csf_queue_table_acl (
  relation_name text PRIMARY KEY,
  expected_service_privileges text[] NOT NULL
);

INSERT INTO expected_csf_queue_table_acl (
  relation_name,
  expected_service_privileges
) VALUES
  (
    'csf_class_workbooks',
    ARRAY['SELECT']::text[]
  ),
  (
    'csf_class_workbook_refresh_jobs',
    ARRAY['SELECT']::text[]
  ),
  (
    'csf_import_approval_batches',
    ARRAY[]::text[]
  ),
  (
    'csf_import_commit_queue',
    ARRAY['SELECT']::text[]
  ),
  (
    'csf_import_approval_batch_items',
    ARRAY[]::text[]
  ),
  (
    'csf_import_row_batches',
    ARRAY[]::text[]
  ),
  (
    'csf_import_row_batch_outcomes',
    ARRAY[]::text[]
  );

SELECT extensions.is(
  ARRAY(
    SELECT privilege_name
    FROM unnest(
      ARRAY[
        'DELETE', 'INSERT', 'REFERENCES', 'SELECT',
        'TRIGGER', 'TRUNCATE', 'UPDATE'
      ]::text[]
    ) AS privilege_name
    WHERE has_table_privilege(
      'service_role',
      format('plugin_data.%I', expected.relation_name),
      privilege_name
    )
    ORDER BY privilege_name
  ),
  expected.expected_service_privileges,
  format(
    'service_role keeps only the reviewed privileges on plugin_data.%I',
    expected.relation_name
  )
)
FROM expected_csf_queue_table_acl AS expected
ORDER BY expected.relation_name;

SELECT extensions.ok(
  (
    SELECT bool_and(relation.relrowsecurity)
    FROM expected_csf_queue_table_acl AS expected
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = 'plugin_data'
    JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid
     AND relation.relname = expected.relation_name
     AND relation.relkind IN ('r', 'p')
  ),
  'every repaired queue table keeps row-level security enabled'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM expected_csf_queue_table_acl AS expected
    CROSS JOIN unnest(
      ARRAY['anon', 'authenticated']::text[]
    ) AS client_role
    CROSS JOIN unnest(
      ARRAY[
        'DELETE', 'INSERT', 'REFERENCES', 'SELECT',
        'TRIGGER', 'TRUNCATE', 'UPDATE'
      ]::text[]
    ) AS privilege_name
    WHERE has_table_privilege(
      client_role,
      format('plugin_data.%I', expected.relation_name),
      privilege_name
    )
  ),
  'browser roles have no privilege on the repaired queue tables'
);

SELECT * FROM extensions.finish();
ROLLBACK;
