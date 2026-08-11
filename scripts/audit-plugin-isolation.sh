#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${SUPABASE_DB_URL:-$(node "$ROOT_DIR/scripts/local-dev/dv-local-env.mjs" --db-url)}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to run plugin isolation audits." >&2
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Plugin Data Isolation Audit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! psql "$DB_URL" -Atc "select 1" >/dev/null 2>&1; then
  echo "Unable to connect to local Supabase Postgres at: $DB_URL" >&2
  echo "Run bun run supabase first, or set SUPABASE_DB_URL." >&2
  exit 1
fi

anon_grants="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'plugin_data'
      and grantee = 'anon'
    order by table_name, privilege_type;
  "
)"

if [[ -n "$anon_grants" ]]; then
  echo "FAIL: anon still has direct plugin_data privileges:"
  echo "$anon_grants"
  exit 1
fi

anon_schema_usage="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select nspname
    from pg_namespace
    where nspname = 'plugin_data'
      and has_schema_privilege('anon', oid, 'USAGE');
  "
)"

if [[ -n "$anon_schema_usage" ]]; then
  echo "FAIL: anon still has plugin_data schema USAGE:"
  echo "$anon_schema_usage"
  exit 1
fi

anon_default_privileges="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select
      n.nspname,
      d.defaclobjtype,
      d.defaclacl::text
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'plugin_data'
      and d.defaclacl::text ~ 'anon=';
  "
)"

if [[ -n "$anon_default_privileges" ]]; then
  echo "FAIL: plugin_data default privileges still grant anon:"
  echo "$anon_default_privileges"
  exit 1
fi

missing_rls="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'plugin_data'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
    order by c.relname;
  "
)"

if [[ -n "$missing_rls" ]]; then
  echo "FAIL: plugin_data tables without RLS:"
  echo "$missing_rls"
  exit 1
fi

broad_policy_roles="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select schemaname, tablename, policyname, roles::text
    from pg_policies
    where schemaname = 'plugin_data'
      and 'public' = any(roles)
    order by tablename, policyname;
  "
)"

if [[ -n "$broad_policy_roles" ]]; then
  echo "FAIL: plugin_data policies still target PUBLIC:"
  echo "$broad_policy_roles"
  exit 1
fi

unexpected_missing_tenant="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select table_schema, table_name
    from information_schema.tables t
    where table_schema = 'plugin_data'
      and table_type = 'BASE TABLE'
      and table_name not in (
        'dv_sd_communication_deliveries',
        'dv_sd_family_service_ledger',
        'dv_sd_household_guardians',
        'dv_sd_household_students',
        'dv_sd_membership_requirements',
        'dv_sd_registration_entries',
        'dv_sd_tabroom_snapshots'
      )
      and not exists (
        select 1
        from private.plugin_data_user_scope_contracts user_scope
        where user_scope.schema_name = t.table_schema
          and user_scope.table_name = t.table_name
      )
      and not exists (
        select 1
        from information_schema.columns c
        where c.table_schema = t.table_schema
          and c.table_name = t.table_name
          and c.column_name = 'organization_id'
      )
    order by table_name;
  "
)"

if [[ -n "$unexpected_missing_tenant" ]]; then
  echo "FAIL: plugin_data tables missing organization_id:"
  echo "$unexpected_missing_tenant"
  exit 1
fi

boundary_gaps="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select opi.organization_id, opi.plugin_key
    from public.organization_plugin_installs opi
    left join public.organization_plugin_data_boundaries b
      on b.organization_id = opi.organization_id
     and b.plugin_key = opi.plugin_key
    where b.id is null
    order by opi.organization_id, opi.plugin_key;
  "
)"

if [[ -n "$boundary_gaps" ]]; then
  echo "FAIL: plugin installs without data-boundary records:"
  echo "$boundary_gaps"
  exit 1
fi

profile_gaps="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select o.id, o.name
    from public.organizations o
    left join public.organization_data_isolation_profiles p
      on p.organization_id = o.id
    where p.organization_id is null
    order by o.id;
  "
)"

if [[ -n "$profile_gaps" ]]; then
  echo "FAIL: organizations without data-isolation profiles:"
  echo "$profile_gaps"
  exit 1
fi

direct_client_boundaries="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select organization_id, plugin_key, direct_client_access
    from public.organization_plugin_data_boundaries
    where direct_client_access = 'rls_allowed'
    order by organization_id, plugin_key;
  "
)"

if [[ -n "$direct_client_boundaries" ]]; then
  echo "FAIL: plugin data boundaries allow raw rls-client access:"
  echo "$direct_client_boundaries"
  exit 1
fi

authenticated_grants="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'plugin_data'
      and grantee = 'authenticated'
    order by table_name, privilege_type;
  "
)"

if [[ -n "$authenticated_grants" ]]; then
  echo "FAIL: authenticated still has direct plugin_data table privileges:"
  echo "$authenticated_grants"
  exit 1
fi

authenticated_schema_usage="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select nspname
    from pg_namespace
    where nspname = 'plugin_data'
      and has_schema_privilege('authenticated', oid, 'USAGE');
  "
)"

if [[ -n "$authenticated_schema_usage" ]]; then
  echo "FAIL: authenticated still has plugin_data schema USAGE:"
  echo "$authenticated_schema_usage"
  exit 1
fi

audit_summary="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select audit_status, count(*)
    from private.plugin_data_security_audit
    group by audit_status
    order by audit_status;
  "
)"

echo "Audit summary:"
echo "$audit_summary"
echo "PASS: plugin_data has no anon/authenticated direct grants, RLS is enabled, and installed plugins have boundaries."
