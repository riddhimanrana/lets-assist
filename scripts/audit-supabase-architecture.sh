#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${SUPABASE_DB_URL:-$(node "$ROOT_DIR/scripts/local-dev/dv-local-env.mjs" --db-url)}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to run Supabase architecture audits." >&2
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Supabase Architecture Audit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! psql "$DB_URL" -Atc "select 1" >/dev/null 2>&1; then
  echo "Unable to connect to local Supabase Postgres at: $DB_URL" >&2
  echo "Run bun run supabase first, or set SUPABASE_DB_URL." >&2
  exit 1
fi

failures=0

fail_if_rows() {
  local title="$1"
  local rows="$2"

  if [[ -n "$rows" ]]; then
    echo "FAIL: $title"
    echo "$rows"
    failures=$((failures + 1))
  fi
}

warn_if_rows() {
  local title="$1"
  local rows="$2"

  if [[ -n "$rows" ]]; then
    echo "WARN: $title"
    echo "$rows"
  fi
}

missing_rls="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'plugin_data')
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
    order by n.nspname, c.relname;
  "
)"
fail_if_rows "public/plugin_data base tables without RLS" "$missing_rls"

public_plugin_policies="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select schemaname, tablename, policyname, roles::text
    from pg_policies
    where schemaname = 'plugin_data'
      and 'public' = any(roles)
    order by tablename, policyname;
  "
)"
fail_if_rows "plugin_data policies targeting PUBLIC" "$public_plugin_policies"

unexpected_public_org_policies="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select schemaname, tablename, policyname, cmd, roles::text
    from pg_policies
    where schemaname = 'public'
      and (
        tablename = 'organizations'
        or tablename like 'organization\_%'
      )
      and 'public' = any(roles)
    order by tablename, policyname;
  "
)"
fail_if_rows "organization-domain policies targeting PUBLIC" "$unexpected_public_org_policies"

anon_org_write_grants="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select table_schema, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
      and (
        table_name = 'organizations'
        or table_name like 'organization\_%'
      )
    order by table_name, privilege_type;
  "
)"
fail_if_rows "anonymous organization-domain write grants" "$anon_org_write_grants"

missing_org_read_models="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with expected(view_name) as (
      values
        ('organization_public_read_model'),
        ('organization_public_member_read_model'),
        ('organization_invitation_acceptance_read_model')
    )
    select e.view_name
    from expected e
    where not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'v'
        and c.relname = e.view_name
        and coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true']
    )
    order by e.view_name;
  "
)"
fail_if_rows "organization public/read models missing or not security_invoker=true" "$missing_org_read_models"

write_policies_missing_checks="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select schemaname, tablename, policyname, cmd
    from pg_policies
    where schemaname in ('public', 'plugin_data')
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and with_check is null
    order by schemaname, tablename, policyname;
  "
)"
fail_if_rows "write-capable RLS policies missing explicit WITH CHECK" "$write_policies_missing_checks"

unsafe_metadata_policies="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select schemaname, tablename, policyname, cmd
    from pg_policies
    where schemaname in ('public', 'plugin_data')
      and (
        coalesce(qual, '') ~* 'user_metadata|raw_user_meta_data'
        or coalesce(with_check, '') ~* 'user_metadata|raw_user_meta_data'
      )
    order by schemaname, tablename, policyname;
  "
)"
fail_if_rows "RLS policies using user-editable metadata for authorization" "$unsafe_metadata_policies"

unwrapped_auth_uid="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select schemaname, tablename, policyname, cmd
    from pg_policies
    where schemaname in ('public', 'plugin_data')
      and (
        coalesce(qual, '') ~ 'auth\.uid\(\)'
        or coalesce(with_check, '') ~ 'auth\.uid\(\)'
      )
      and not (
        coalesce(qual, '') ~ '\( SELECT auth\.uid\(\)'
        or coalesce(qual, '') ~ '\(SELECT auth\.uid\(\)'
        or coalesce(with_check, '') ~ '\( SELECT auth\.uid\(\)'
        or coalesce(with_check, '') ~ '\(SELECT auth\.uid\(\)'
      )
    order by schemaname, tablename, policyname;
  "
)"
fail_if_rows "RLS policies with unwrapped auth.uid() calls" "$unwrapped_auth_uid"

missing_org_fk="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with org_tables as (
      select c.table_schema, c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema
       and t.table_name = c.table_name
      where c.table_schema in ('public', 'plugin_data')
        and c.column_name = 'organization_id'
        and t.table_type = 'BASE TABLE'
    )
    select ot.table_schema, ot.table_name
    from org_tables ot
    where not exists (
      select 1
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join unnest(con.conkey) k(attnum) on true
      join pg_attribute a on a.attrelid = rel.oid and a.attnum = k.attnum
      where n.nspname = ot.table_schema
        and rel.relname = ot.table_name
        and con.contype = 'f'
        and a.attname = 'organization_id'
    )
    order by ot.table_schema, ot.table_name;
  "
)"
fail_if_rows "organization_id columns without tenant FK constraints" "$missing_org_fk"

missing_org_index="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with org_tables as (
      select c.table_schema, c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema
       and t.table_name = c.table_name
      where c.table_schema in ('public', 'plugin_data')
        and c.column_name = 'organization_id'
        and t.table_type = 'BASE TABLE'
    )
    select ot.table_schema, ot.table_name
    from org_tables ot
    where not exists (
      select 1
      from pg_index i
      join pg_class rel on rel.oid = i.indrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_attribute a on a.attrelid = rel.oid and a.attnum = i.indkey[0]
      where n.nspname = ot.table_schema
        and rel.relname = ot.table_name
        and a.attname = 'organization_id'
    )
    order by ot.table_schema, ot.table_name;
  "
)"
fail_if_rows "organization_id tenant tables without leading tenant indexes" "$missing_org_index"

missing_fk_leading_index="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with fk_cols as (
      select
        n.nspname as schema_name,
        c.relname as table_name,
        con.conname,
        a.attname as column_name
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join unnest(con.conkey) with ordinality k(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
      where con.contype = 'f'
        and n.nspname in ('public', 'plugin_data')
        and k.ord = 1
    )
    select schema_name, table_name, conname, column_name
    from fk_cols f
    where not exists (
      select 1
      from pg_index i
      join pg_class rel on rel.oid = i.indrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_attribute a on a.attrelid = rel.oid and a.attnum = i.indkey[0]
      where n.nspname = f.schema_name
        and rel.relname = f.table_name
        and a.attname = f.column_name
    )
    order by schema_name, table_name, column_name;
  "
)"
warn_if_rows "foreign-key columns without leading indexes; confirm workload before adding blanket indexes" "$missing_fk_leading_index"

sensitive_org_table_api_exposure="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select table_schema, table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and table_name in (
        'organizations',
        'organization_invitations',
        'organization_sheet_syncs',
        'organization_calendar_syncs',
        'organization_plugin_installs',
        'organization_plugin_entitlements',
        'organization_plugin_feature_flags',
        'organization_plugin_data_boundaries',
        'organization_data_isolation_profiles'
      )
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    group by table_schema, table_name, grantee
    order by table_schema, table_name, grantee;
  "
)"
warn_if_rows "sensitive organization tables still have direct Data API grants; migrate remaining call sites before revoking" "$sensitive_org_table_api_exposure"

read_models_not_security_invoker="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and c.relname like '%\_read\_model'
      and not coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true']
    order by c.relname;
  "
)"
fail_if_rows "public read-model views without security_invoker=true" "$read_models_not_security_invoker"

storage_bucket_drift="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with expected(id, is_public, file_size_limit, allowed_mime_types) as (
      values
        ('avatars', true, 10485760::bigint, array['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[]),
        ('organization-logos', true, 10485760::bigint, array['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[]),
        ('project-images', true, 20971520::bigint, array['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[]),
        ('project-documents', true, 20971520::bigint, array['application/pdf']::text[]),
        ('waiver-uploads', true, 20971520::bigint, array['application/pdf']::text[]),
        ('waivers', true, 20971520::bigint, array['application/pdf']::text[]),
        ('data-exports', false, 52428800::bigint, array['application/zip']::text[]),
        ('plugin_form_uploads', false, 10485760::bigint, array['application/pdf', 'image/jpeg', 'image/png']::text[]),
        ('waiver-signatures', false, 10485760::bigint, array['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']::text[])
    )
    select
      e.id,
      e.is_public as expected_public,
      b.public as actual_public,
      e.file_size_limit as expected_file_size_limit,
      b.file_size_limit as actual_file_size_limit,
      e.allowed_mime_types as expected_allowed_mime_types,
      b.allowed_mime_types as actual_allowed_mime_types
    from expected e
    left join storage.buckets b on b.id = e.id
    where b.id is null
       or b.public is distinct from e.is_public
       or b.file_size_limit is distinct from e.file_size_limit
       or coalesce(b.allowed_mime_types, array[]::text[]) <> e.allowed_mime_types
    order by e.id;
  "
)"
fail_if_rows "storage buckets missing or with unexpected public/private/MIME/size posture" "$storage_bucket_drift"

public_storage_listing_policies="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select policyname, roles::text, qual
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'SELECT'
      and ('public' = any(roles) or 'anon' = any(roles))
    order by policyname;
  "
)"
fail_if_rows "public/anon storage.objects SELECT policies that can expose object listings" "$public_storage_listing_policies"

server_only_storage_client_policies="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select policyname, roles::text, cmd, coalesce(qual, with_check, '')
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') like '%data-exports%'
        or coalesce(with_check, '') like '%data-exports%'
        or coalesce(qual, '') like '%waiver-signatures%'
        or coalesce(with_check, '') like '%waiver-signatures%'
      )
      and (
        'public' = any(roles)
        or 'anon' = any(roles)
        or 'authenticated' = any(roles)
      )
    order by policyname, cmd;
  "
)"
fail_if_rows "server-only storage buckets exposed through client storage.objects policies" "$server_only_storage_client_policies"

unexpected_auth_schema_grants="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select table_schema, table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants
    where table_schema = 'auth'
      and grantee in ('anon', 'authenticated')
    group by table_schema, table_name, grantee
    order by table_schema, table_name, grantee;
  "
)"
fail_if_rows "auth schema tables directly granted to anon/authenticated roles" "$unexpected_auth_schema_grants"

unexpected_security_definer_exec="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with grants as (
      select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as identity_arguments, r.rolname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('public'), ('anon'), ('authenticated')) r(rolname)
      where n.nspname = 'public'
        and p.prosecdef
        and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    )
    select g.nspname, g.proname, g.identity_arguments, g.rolname
    from grants g
    order by g.nspname, g.proname, g.identity_arguments, g.rolname;
  "
)"
fail_if_rows "client EXECUTE grants on public SECURITY DEFINER functions" "$unexpected_security_definer_exec"

allowed_security_definer_exec="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) r(rolname)
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), r.rolname;
  "
)"
fail_if_rows "client-callable public SECURITY DEFINER functions" "$allowed_security_definer_exec"

summary="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select 'base_tables_with_rls', count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'plugin_data')
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
    union all
    select 'tenant_tables_with_org_id', count(*)
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema in ('public', 'plugin_data')
      and c.column_name = 'organization_id'
      and t.table_type = 'BASE TABLE'
    union all
    select 'read_model_views', count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and c.relname like '%\_read\_model'
    union all
    select 'storage_buckets', count(*)
    from storage.buckets;
  "
)"

echo "Audit summary:"
echo "$summary"

if [[ "$failures" -gt 0 ]]; then
  echo "FAIL: Supabase architecture audit found $failures blocking issue group(s)."
  exit 1
fi

echo "PASS: Supabase architecture audit hard checks passed."
