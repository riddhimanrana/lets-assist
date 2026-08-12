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

public_client_relation_acl_drift="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with expected as (
      select relation_name, role_name, privilege, null::text as column_name
      from app_private.client_relation_grant_catalog()
      where columns is null
      union all
      select c.relation_name, c.role_name, c.privilege, col.column_name
      from app_private.client_relation_grant_catalog() c
      cross join lateral unnest(c.columns) as col(column_name)
      where c.columns is not null
    ),
    actual_relation as (
      select table_name as relation_name, grantee as role_name, privilege_type as privilege, null::text as column_name
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated')
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    ),
    actual_column as (
      select cp.table_name as relation_name, cp.grantee as role_name, cp.privilege_type as privilege, cp.column_name
      from information_schema.column_privileges cp
      where cp.table_schema = 'public'
        and cp.grantee in ('anon', 'authenticated')
        and cp.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        and not exists (
          select 1
          from information_schema.role_table_grants rt
          where rt.table_schema = cp.table_schema
            and rt.table_name = cp.table_name
            and rt.grantee = cp.grantee
            and rt.privilege_type = cp.privilege_type
        )
    ),
    actual as (
      select * from actual_relation
      union all
      select * from actual_column
    ),
    drift as (
      select 'missing'::text as drift_kind, e.relation_name, e.role_name, e.privilege, e.column_name
      from expected e
      where not exists (
        select 1
        from actual a
        where a.relation_name = e.relation_name
          and a.role_name = e.role_name
          and a.privilege = e.privilege
          and app_private.client_relation_grant_expected_satisfied_by_actual(
            e.column_name,
            a.column_name
          )
      )
      union all
      select 'unexpected'::text, a.relation_name, a.role_name, a.privilege, a.column_name
      from actual a
      where not exists (
        select 1
        from expected e
        where e.relation_name = a.relation_name
          and e.role_name = a.role_name
          and e.privilege = e.privilege
          and app_private.client_relation_grant_actual_covered_by_expected(
            a.column_name,
            e.column_name
          )
      )
    )
    select drift_kind, relation_name, role_name, privilege, column_name
    from drift
    order by drift_kind, relation_name, role_name, privilege, column_name;
  "
)"
fail_if_rows "public client relation ACL drift from reviewed catalog" "$public_client_relation_acl_drift"

public_client_relation_dangerous_grants="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select n.nspname, c.relname, grantee.rolname, acl.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) acl(grantor_oid, grantee_oid, privilege_type, is_grantable)
    join pg_roles grantee on grantee.oid = acl.grantee_oid
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and grantee.rolname in ('anon', 'authenticated')
      and acl.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    order by c.relname, grantee.rolname, acl.privilege_type;
  "
)"
fail_if_rows "public relations grant anon/authenticated non-DML privileges" "$public_client_relation_dangerous_grants"

public_client_relation_public_grants="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select n.nspname, c.relname, acl.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) acl(grantor_oid, grantee_oid, privilege_type, is_grantable)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and acl.grantee_oid = 0
      and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    order by c.relname, acl.privilege_type;
  "
)"
fail_if_rows "PUBLIC role still holds public relation DML or dangerous privileges" "$public_client_relation_public_grants"

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
    with expected as (
      select bucket_id, is_public, file_size_limit, allowed_mime_types, posture
      from app_private.storage_bucket_posture_catalog()
    ),
    actual as (
      select
        b.id as bucket_id,
        b.public as is_public,
        b.file_size_limit,
        b.allowed_mime_types
      from storage.buckets b
    ),
    drift as (
      select
        'missing'::text as drift_kind,
        e.bucket_id,
        e.is_public as expected_public,
        null::boolean as actual_public,
        e.file_size_limit as expected_file_size_limit,
        null::bigint as actual_file_size_limit,
        e.allowed_mime_types as expected_allowed_mime_types,
        null::text[] as actual_allowed_mime_types,
        e.posture as expected_posture,
        null::text as actual_posture
      from expected e
      left join actual a on a.bucket_id = e.bucket_id
      where a.bucket_id is null
      union all
      select
        'unexpected'::text,
        a.bucket_id,
        null::boolean,
        a.is_public,
        null::bigint,
        a.file_size_limit,
        null::text[],
        a.allowed_mime_types,
        null::text,
        null::text
      from actual a
      left join expected e on e.bucket_id = a.bucket_id
      where e.bucket_id is null
      union all
      select
        'property_drift'::text,
        e.bucket_id,
        e.is_public,
        a.is_public,
        e.file_size_limit,
        a.file_size_limit,
        e.allowed_mime_types,
        a.allowed_mime_types,
        e.posture,
        null::text
      from expected e
      join actual a on a.bucket_id = e.bucket_id
      where e.is_public is distinct from a.is_public
         or e.file_size_limit is distinct from a.file_size_limit
         or coalesce(e.allowed_mime_types, array[]::text[])
           is distinct from coalesce(a.allowed_mime_types, array[]::text[])
    )
    select
      drift_kind,
      bucket_id,
      expected_public,
      actual_public,
      expected_file_size_limit,
      actual_file_size_limit,
      expected_allowed_mime_types,
      actual_allowed_mime_types,
      expected_posture
    from drift
    order by drift_kind, bucket_id;
  "
)"
fail_if_rows "storage buckets missing, unexpected, or with catalog property drift" "$storage_bucket_drift"

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
    with catalog as (
      select bucket_id
      from app_private.storage_bucket_posture_catalog()
      where posture = 'server-only'
    )
    select c.bucket_id, p.policyname, p.roles::text, p.cmd
    from catalog c
    join pg_policies p
      on p.schemaname = 'storage'
     and p.tablename = 'objects'
    where (
      'public' = any(p.roles)
      or 'anon' = any(p.roles)
      or 'authenticated' = any(p.roles)
    )
    and (
      coalesce(p.qual, '') like ('%bucket_id = ''' || c.bucket_id || '''%')
      or coalesce(p.with_check, '') like ('%bucket_id = ''' || c.bucket_id || '''%')
    )
    order by c.bucket_id, p.policyname, p.cmd;
  "
)"
fail_if_rows "server-only storage buckets exposed through client storage.objects policies" "$server_only_storage_client_policies"

private_client_storage_policy_gaps="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with catalog as (
      select bucket_id
      from app_private.storage_bucket_posture_catalog()
      where posture = 'private-client'
    ),
    missing_authenticated as (
      select c.bucket_id, 'missing_authenticated_policy'::text as issue
      from catalog c
      where not exists (
        select 1
        from pg_policies p
        where p.schemaname = 'storage'
          and p.tablename = 'objects'
          and 'authenticated' = any(p.roles)
          and (
            coalesce(p.qual, '') like ('%bucket_id = ''' || c.bucket_id || '''%')
            or coalesce(p.with_check, '') like ('%bucket_id = ''' || c.bucket_id || '''%')
          )
      )
    ),
    public_or_anon_policies as (
      select c.bucket_id, 'public_or_anon_policy'::text as issue, p.policyname, p.roles::text, p.cmd
      from catalog c
      join pg_policies p
        on p.schemaname = 'storage'
       and p.tablename = 'objects'
      where (
        'public' = any(p.roles)
        or 'anon' = any(p.roles)
      )
      and (
        coalesce(p.qual, '') like ('%bucket_id = ''' || c.bucket_id || '''%')
        or coalesce(p.with_check, '') like ('%bucket_id = ''' || c.bucket_id || '''%')
      )
    )
    select bucket_id, issue, null::text as policyname, null::text as roles, null::text as cmd
    from missing_authenticated
    union all
    select bucket_id, issue, policyname, roles, cmd
    from public_or_anon_policies
    order by bucket_id, issue, policyname, cmd;
  "
)"
fail_if_rows "private-client storage buckets missing authenticated policies or exposed to public/anon" "$private_client_storage_policy_gaps"

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
        and not (
          p.proname = 'publish_volunteer_hours_transactional'
          and pg_get_function_identity_arguments(p.oid) =
            'p_project_id uuid, p_schedule_id text, p_entries jsonb, p_request_key text'
          and r.rolname = 'authenticated'
        )
    )
    select g.nspname, g.proname, g.identity_arguments, g.rolname
    from grants g
    order by g.nspname, g.proname, g.identity_arguments, g.rolname;
  "
)"
fail_if_rows "client EXECUTE grants on public SECURITY DEFINER functions" "$unexpected_security_definer_exec"

public_client_function_acl_drift="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with expected(signature, role_name) as (
      values
        ('public.can_insert_project(uuid)', 'authenticated'),
        ('public.can_insert_project(uuid,text,uuid)', 'authenticated'),
        ('public.can_keep_or_set_public_visibility(uuid,uuid)', 'authenticated'),
        ('public.get_public_attendees(uuid)', 'anon'),
        ('public.get_public_attendees(uuid)', 'authenticated'),
        ('public.is_project_organizer(uuid,uuid)', 'authenticated'),
        ('public.is_super_admin()', 'authenticated'),
        ('public.is_trusted_member(uuid)', 'authenticated'),
        ('public.publish_volunteer_hours_transactional(uuid,text,jsonb,text)', 'authenticated')
    ),
    actual as (
      select
        format(
          'public.%I(%s)',
          p.proname,
          replace(pg_catalog.oidvectortypes(p.proargtypes), ', ', ',')
        ) as signature,
        client.role_name
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) client(role_name)
      where n.nspname = 'public'
        and has_function_privilege(client.role_name, p.oid, 'EXECUTE')
    ),
    drift as (
      select 'unexpected'::text as drift, actual.signature, actual.role_name
      from actual
      where not exists (
        select 1
        from expected
        where expected.signature = actual.signature
          and expected.role_name = actual.role_name
      )
      union all
      select 'missing'::text, expected.signature, expected.role_name
      from expected
      where not exists (
        select 1
        from actual
        where actual.signature = expected.signature
          and actual.role_name = expected.role_name
      )
    )
    select drift, signature, role_name
    from drift
    order by drift, signature, role_name;
  "
)"
fail_if_rows "public client-callable function ACL drift" "$public_client_function_acl_drift"

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
