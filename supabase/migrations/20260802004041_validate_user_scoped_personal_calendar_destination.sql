-- Personal calendar destinations are intentionally one-per-user across every
-- organization. Keep that product invariant while making the direct user
-- scope mechanically auditable and every internal ownership edge user-safe.

BEGIN;

ALTER TABLE public.user_calendar_connections
  ADD CONSTRAINT user_calendar_connections_id_user_key
  UNIQUE (id, user_id);

ALTER TABLE plugin_data.csf_personal_calendar_destination_operations
  DROP CONSTRAINT csf_personal_calendar_destination_operations_connection_id_fkey,
  ADD CONSTRAINT csf_personal_calendar_destination_operations_id_user_key
  UNIQUE (id, user_id),
  ADD CONSTRAINT csf_personal_cal_dest_ops_connection_user_fkey
  FOREIGN KEY (connection_id, user_id)
  REFERENCES public.user_calendar_connections (id, user_id)
  ON DELETE SET NULL (connection_id);

ALTER TABLE plugin_data.csf_personal_calendar_destinations
  DROP CONSTRAINT csf_personal_calendar_destinations_connection_id_fkey,
  DROP CONSTRAINT csf_personal_calendar_destinations_inflight_fkey,
  ADD CONSTRAINT csf_personal_calendar_destinations_connection_user_fkey
  FOREIGN KEY (connection_id, user_id)
  REFERENCES public.user_calendar_connections (id, user_id)
  ON DELETE SET NULL (connection_id),
  ADD CONSTRAINT csf_personal_calendar_destinations_inflight_user_fkey
  FOREIGN KEY (inflight_operation_id, user_id)
  REFERENCES plugin_data.csf_personal_calendar_destination_operations (id, user_id)
  ON DELETE SET NULL (inflight_operation_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX csf_personal_cal_dest_ops_connection_user_idx
  ON plugin_data.csf_personal_calendar_destination_operations (connection_id, user_id)
  WHERE connection_id IS NOT NULL;

CREATE INDEX csf_personal_calendar_destinations_connection_user_idx
  ON plugin_data.csf_personal_calendar_destinations (connection_id, user_id)
  WHERE connection_id IS NOT NULL;

CREATE INDEX csf_personal_calendar_destinations_inflight_user_idx
  ON plugin_data.csf_personal_calendar_destinations (inflight_operation_id, user_id)
  WHERE inflight_operation_id IS NOT NULL;

COMMENT ON TABLE plugin_data.csf_personal_calendar_destinations IS
  'Server-only direct-user-scope claim for the one app-created personal Google Calendar shared across the user''s organizations.';
COMMENT ON TABLE plugin_data.csf_personal_calendar_destination_operations IS
  'Server-only direct-user-scope provider receipts. Connection and in-flight references are structurally bound to the same user.';

-- This is a validated catalog contract, not a name allowlist. A named table
-- qualifies only while its user coordinate is non-null, directly references
-- auth.users(id), leads a valid index, and remains a forced-RLS surface with
-- neither browser grants nor policies.
CREATE OR REPLACE VIEW private.plugin_data_user_scope_contracts
WITH (security_invoker = true)
AS
SELECT
  namespace.nspname AS schema_name,
  class.relname AS table_name,
  'user'::text AS scope_kind
FROM pg_catalog.pg_class AS class
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = class.relnamespace
JOIN pg_catalog.pg_attribute AS user_column
  ON user_column.attrelid = class.oid
 AND user_column.attname = 'user_id'
 AND user_column.attnum > 0
 AND NOT user_column.attisdropped
WHERE namespace.nspname = 'plugin_data'
  AND class.relkind IN ('r', 'p')
  AND class.relname IN (
    'csf_personal_calendar_destinations',
    'csf_personal_calendar_destination_operations'
  )
  AND class.relrowsecurity
  AND class.relforcerowsecurity
  AND user_column.attnotnull
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS user_fkey
    WHERE user_fkey.conrelid = class.oid
      AND user_fkey.contype = 'f'
      AND user_fkey.confrelid = 'auth.users'::regclass
      AND user_fkey.conkey = ARRAY[user_column.attnum]::smallint[]
      AND user_fkey.confkey = ARRAY[
        (
          SELECT auth_user_id.attnum
          FROM pg_catalog.pg_attribute AS auth_user_id
          WHERE auth_user_id.attrelid = 'auth.users'::regclass
            AND auth_user_id.attname = 'id'
            AND auth_user_id.attnum > 0
            AND NOT auth_user_id.attisdropped
        )
      ]::smallint[]
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS user_index
    WHERE user_index.indrelid = class.oid
      AND user_index.indisvalid
      AND user_index.indisready
      AND user_index.indkey[0] = user_column.attnum
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS client_grant
    WHERE client_grant.table_schema = namespace.nspname
      AND client_grant.table_name = class.relname
      AND client_grant.grantee IN ('PUBLIC', 'anon', 'authenticated')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = namespace.nspname
      AND policy.tablename = class.relname
  );

COMMENT ON VIEW private.plugin_data_user_scope_contracts IS
  'Validated direct-user-scope plugin tables. Names alone never qualify: non-null auth ownership, a leading user index, forced RLS, and a server-only surface are mandatory.';

REVOKE ALL ON private.plugin_data_user_scope_contracts
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW private.plugin_data_security_audit
WITH (security_invoker = true)
AS
WITH plugin_tables AS (
  SELECT
    class.oid,
    namespace.nspname AS schema_name,
    class.relname AS table_name,
    class.relrowsecurity AS rls_enabled,
    class.relforcerowsecurity AS force_rls
  FROM pg_catalog.pg_class AS class
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'plugin_data'
    AND class.relkind IN ('r', 'p')
), tenant_columns AS (
  SELECT
    table_schema,
    table_name,
    bool_or(column_name = 'organization_id') AS has_organization_id
  FROM information_schema.columns
  WHERE table_schema = 'plugin_data'
  GROUP BY table_schema, table_name
), anon_grants AS (
  SELECT
    table_schema,
    table_name,
    array_agg(privilege_type ORDER BY privilege_type) AS anon_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'plugin_data'
    AND grantee = 'anon'
  GROUP BY table_schema, table_name
), authenticated_grants AS (
  SELECT
    table_schema,
    table_name,
    array_agg(privilege_type ORDER BY privilege_type) AS authenticated_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'plugin_data'
    AND grantee = 'authenticated'
  GROUP BY table_schema, table_name
)
SELECT
  plugin_table.schema_name,
  plugin_table.table_name,
  plugin_table.rls_enabled,
  plugin_table.force_rls,
  coalesce(tenant_column.has_organization_id, false) AS has_organization_id,
  coalesce(anon_grant.anon_privileges, ARRAY[]::text[]) AS anon_privileges,
  coalesce(authenticated_grant.authenticated_privileges, ARRAY[]::text[])
    AS authenticated_privileges,
  CASE
    WHEN NOT plugin_table.rls_enabled THEN 'missing_rls'
    WHEN coalesce(array_length(anon_grant.anon_privileges, 1), 0) > 0 THEN 'anon_grant'
    WHEN NOT coalesce(tenant_column.has_organization_id, false)
      AND user_scope.table_name IS NULL
      AND plugin_table.table_name NOT IN (
        'dv_sd_communication_deliveries',
        'dv_sd_family_service_ledger',
        'dv_sd_household_guardians',
        'dv_sd_household_students',
        'dv_sd_membership_requirements',
        'dv_sd_registration_entries',
        'dv_sd_tabroom_snapshots'
      ) THEN 'missing_tenant_column'
    ELSE 'ok'
  END AS audit_status
FROM plugin_tables AS plugin_table
LEFT JOIN tenant_columns AS tenant_column
  ON tenant_column.table_schema = plugin_table.schema_name
 AND tenant_column.table_name = plugin_table.table_name
LEFT JOIN anon_grants AS anon_grant
  ON anon_grant.table_schema = plugin_table.schema_name
 AND anon_grant.table_name = plugin_table.table_name
LEFT JOIN authenticated_grants AS authenticated_grant
  ON authenticated_grant.table_schema = plugin_table.schema_name
 AND authenticated_grant.table_name = plugin_table.table_name
LEFT JOIN private.plugin_data_user_scope_contracts AS user_scope
  ON user_scope.schema_name = plugin_table.schema_name
 AND user_scope.table_name = plugin_table.table_name;

COMMENT ON VIEW private.plugin_data_security_audit IS
  'Internal audit view for plugin_data RLS, validated organization or user scope, and direct API grants. Not exposed through Supabase Data API.';

COMMIT;
