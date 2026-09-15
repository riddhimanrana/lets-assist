BEGIN;
SELECT extensions.plan(1);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_definition
    JOIN pg_catalog.pg_attribute AS leading_column
      ON leading_column.attrelid = index_definition.indrelid
      AND leading_column.attnum = index_definition.indkey[0]
    WHERE index_definition.indrelid = 'plugin_data.csf_publication_notification_deliveries'::regclass
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indpred IS NULL
      AND leading_column.attname = 'organization_id'
  ),
  'notification deliveries have a full organization-leading index'
);
SELECT extensions.finish();
ROLLBACK;
