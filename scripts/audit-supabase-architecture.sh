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

# organization_id is normally a live tenant reference. The one cataloged
# snapshot-ledger exception must retain its named immutable check and separately
# validated live ON DELETE SET NULL reference or it fails as invalid_exception.
missing_org_fk="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with tenant_fk_exceptions(
      table_schema,
      table_name,
      snapshot_column_name,
      live_column_name,
      snapshot_constraint_name,
      live_fk_constraint_name
    ) as (
      values (
        'public',
        'project_cancellation_jobs',
        'organization_id_snapshot',
        'live_organization_id',
        'project_cancellation_jobs_snapshot_identifiers_match',
        'project_cancellation_jobs_live_organization_id_fkey'
      )
    ),
    org_tables as (
      select c.table_schema, c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema
       and t.table_name = c.table_name
      where c.table_schema in ('public', 'plugin_data')
        and c.column_name = 'organization_id'
        and t.table_type = 'BASE TABLE'
    ),
    direct_tenant_fks as (
      select distinct n.nspname as table_schema, rel.relname as table_name
      from pg_constraint constraints
      join pg_class rel on rel.oid = constraints.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join unnest(constraints.conkey) key_columns(attnum) on true
      join pg_attribute attributes
        on attributes.attrelid = rel.oid
       and attributes.attnum = key_columns.attnum
      where constraints.contype = 'f'
        and n.nspname in ('public', 'plugin_data')
        and attributes.attname = 'organization_id'
    ),
    violations as (
      select
        'missing_fk'::text as violation_kind,
        org_tables.table_schema,
        org_tables.table_name
      from org_tables
      where not exists (
        select 1
        from direct_tenant_fks
        where direct_tenant_fks.table_schema = org_tables.table_schema
          and direct_tenant_fks.table_name = org_tables.table_name
      )
        and not exists (
          select 1
          from tenant_fk_exceptions exception
          where exception.table_schema = org_tables.table_schema
            and exception.table_name = org_tables.table_name
        )

      union all

      select
        'invalid_exception'::text,
        exception.table_schema,
        exception.table_name
      from tenant_fk_exceptions exception
      where not exists (
        select 1
        from org_tables
        where org_tables.table_schema = exception.table_schema
          and org_tables.table_name = exception.table_name
      )
        or exists (
          select 1
          from direct_tenant_fks
          where direct_tenant_fks.table_schema = exception.table_schema
            and direct_tenant_fks.table_name = exception.table_name
        )
        or not exists (
          select 1
          from information_schema.columns columns
          where columns.table_schema = exception.table_schema
            and columns.table_name = exception.table_name
            and columns.column_name = exception.snapshot_column_name
        )
        or not exists (
          select 1
          from information_schema.columns columns
          where columns.table_schema = exception.table_schema
            and columns.table_name = exception.table_name
            and columns.column_name = exception.live_column_name
        )
        or not exists (
          select 1
          from pg_constraint constraints
          join pg_class relations on relations.oid = constraints.conrelid
          join pg_namespace namespaces on namespaces.oid = relations.relnamespace
          where namespaces.nspname = exception.table_schema
            and relations.relname = exception.table_name
            and constraints.contype = 'c'
            and constraints.convalidated
            and constraints.conname = exception.snapshot_constraint_name
            and pg_get_expr(constraints.conbin, constraints.conrelid)
              like '%NOT (organization_id_snapshot IS DISTINCT FROM organization_id)%'
        )
        or not exists (
          select 1
          from pg_constraint constraints
          join pg_class relations on relations.oid = constraints.conrelid
          join pg_namespace namespaces on namespaces.oid = relations.relnamespace
          join pg_class parent_relations
            on parent_relations.oid = constraints.confrelid
          join pg_namespace parent_namespace
            on parent_namespace.oid = parent_relations.relnamespace
          join unnest(constraints.conkey) with ordinality
            live_keys(attnum, key_ordinality) on true
          join unnest(constraints.confkey) with ordinality
            parent_keys(attnum, key_ordinality)
            on parent_keys.key_ordinality = live_keys.key_ordinality
          join pg_attribute live_attributes
            on live_attributes.attrelid = relations.oid
           and live_attributes.attnum = live_keys.attnum
          join pg_attribute parent_attributes
            on parent_attributes.attrelid = parent_relations.oid
           and parent_attributes.attnum = parent_keys.attnum
          where namespaces.nspname = exception.table_schema
            and relations.relname = exception.table_name
            and constraints.contype = 'f'
            and constraints.convalidated
            and constraints.conname = exception.live_fk_constraint_name
            and constraints.confdeltype = 'n'
            and cardinality(constraints.conkey) = 1
            and live_attributes.attname = exception.live_column_name
            and parent_namespace.nspname = 'public'
            and parent_relations.relname = 'organizations'
            and parent_attributes.attname = 'id'
        )
    )
    select violation_kind, table_schema, table_name
    from violations
    order by violation_kind, table_schema, table_name;
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
    client_roles as (
      select oid, rolname::text as role_name
      from pg_roles
      where rolname in ('anon', 'authenticated')
    ),
    relations as (
      select relation.oid, relation.relname::text as relation_name, relation.relacl
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p', 'v', 'm')
    ),
    dml_privileges(privilege) as (
      values ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)
    ),
    direct_actual as (
      select
        relations.relation_name,
        grantee.rolname::text as role_name,
        acl.privilege_type as privilege,
        null::text as column_name
      from relations
      cross join lateral aclexplode(relations.relacl) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where grantee.rolname in ('anon', 'authenticated')
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      union all
      select
        relations.relation_name,
        grantee.rolname::text,
        acl.privilege_type,
        attribute.attname::text
      from relations
      join pg_attribute attribute
        on attribute.attrelid = relations.oid
       and attribute.attnum > 0
       and not attribute.attisdropped
      cross join lateral aclexplode(attribute.attacl) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where grantee.rolname in ('anon', 'authenticated')
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE')
    ),
    effective_actual as (
      select
        relations.relation_name,
        client_roles.role_name,
        dml_privileges.privilege,
        null::text as column_name
      from relations
      cross join client_roles
      cross join dml_privileges
      where has_table_privilege(client_roles.oid, relations.oid, dml_privileges.privilege)
      union all
      select
        relations.relation_name,
        client_roles.role_name,
        dml_privileges.privilege,
        attribute.attname::text
      from relations
      join pg_attribute attribute
        on attribute.attrelid = relations.oid
       and attribute.attnum > 0
       and not attribute.attisdropped
      cross join client_roles
      cross join dml_privileges
      where dml_privileges.privilege in ('SELECT', 'INSERT', 'UPDATE')
        and not has_table_privilege(client_roles.oid, relations.oid, dml_privileges.privilege)
        and has_column_privilege(
          client_roles.oid,
          relations.oid,
          attribute.attnum,
          dml_privileges.privilege
        )
    ),
    drift as (
      select 'direct_missing'::text as drift_kind, expected.*
      from expected
      where not exists (
        select 1
        from direct_actual
        where direct_actual.relation_name = expected.relation_name
          and direct_actual.role_name = expected.role_name
          and direct_actual.privilege = expected.privilege
          and direct_actual.column_name is not distinct from expected.column_name
      )
      union all
      select 'direct_unexpected'::text, direct_actual.*
      from direct_actual
      where not exists (
        select 1
        from expected
        where expected.relation_name = direct_actual.relation_name
          and expected.role_name = direct_actual.role_name
          and expected.privilege = direct_actual.privilege
          and expected.column_name is not distinct from direct_actual.column_name
      )
      union all
      select 'effective_missing'::text, expected.*
      from expected
      where not exists (
        select 1
        from effective_actual
        where effective_actual.relation_name = expected.relation_name
          and effective_actual.role_name = expected.role_name
          and effective_actual.privilege = expected.privilege
          and effective_actual.column_name is not distinct from expected.column_name
      )
      union all
      select 'effective_unexpected'::text, effective_actual.*
      from effective_actual
      where not exists (
        select 1
        from expected
        where expected.relation_name = effective_actual.relation_name
          and expected.role_name = effective_actual.role_name
          and expected.privilege = effective_actual.privilege
          and expected.column_name is not distinct from effective_actual.column_name
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
    with client_roles as (
      select oid, rolname::text as role_name
      from pg_roles
      where rolname in ('anon', 'authenticated')
    ),
    relations as (
      select relation.oid, relation.relname::text as relation_name
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p', 'v', 'm')
    ),
    dangerous_table_privileges(privilege) as (
      values ('TRUNCATE'::text), ('REFERENCES'::text), ('TRIGGER'::text), ('MAINTAIN'::text)
    ),
    dangerous as (
      select
        relations.relation_name,
        client_roles.role_name,
        dangerous_table_privileges.privilege,
        null::text as column_name
      from relations
      cross join client_roles
      cross join dangerous_table_privileges
      where has_table_privilege(
        client_roles.oid,
        relations.oid,
        dangerous_table_privileges.privilege
      )
      union all
      select
        relations.relation_name,
        client_roles.role_name,
        'REFERENCES'::text,
        attribute.attname::text
      from relations
      join pg_attribute attribute
        on attribute.attrelid = relations.oid
       and attribute.attnum > 0
       and not attribute.attisdropped
      cross join client_roles
      where not has_table_privilege(client_roles.oid, relations.oid, 'REFERENCES')
        and has_column_privilege(client_roles.oid, relations.oid, attribute.attnum, 'REFERENCES')
    )
    select relation_name, role_name, privilege, column_name
    from dangerous
    order by relation_name, role_name, privilege, column_name;
  "
)"
fail_if_rows "public relations grant anon/authenticated effective non-DML privileges" "$public_client_relation_dangerous_grants"

public_client_relation_public_grants="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with public_grants as (
      select
        relation.relname::text as relation_name,
        acl.privilege_type,
        null::text as column_name
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral aclexplode(relation.relacl) acl
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p', 'v', 'm')
        and acl.grantee = 0
      union all
      select
        relation.relname::text,
        acl.privilege_type,
        attribute.attname::text
      from pg_attribute attribute
      join pg_class relation on relation.oid = attribute.attrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral aclexplode(attribute.attacl) acl
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p', 'v', 'm')
        and attribute.attnum > 0
        and not attribute.attisdropped
        and acl.grantee = 0
    )
    select relation_name, privilege_type, column_name
    from public_grants
    order by relation_name, privilege_type, column_name;
  "
)"
fail_if_rows "PUBLIC role still holds public relation or column privileges" "$public_client_relation_public_grants"

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

storage_objects_rls_disabled="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select namespace.nspname, relation.relname
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
      and relation.relkind in ('r', 'p')
      and not relation.relrowsecurity;
  "
)"
fail_if_rows "storage.objects does not enforce row-level security" "$storage_objects_rls_disabled"

storage_object_policy_drift="$(
  psql "$DB_URL" -AtF $'\t' -c "
    select
      drift_kind,
      policy_name,
      command,
      role_names,
      is_permissive,
      using_expression,
      with_check_expression
    from app_private.storage_object_policy_contract_violations()
    order by drift_kind, policy_name, command;
  "
)"
fail_if_rows "client-reachable storage.objects policies drift from the exact reviewed contract" "$storage_object_policy_drift"

storage_object_policy_posture_gaps="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with bucket_catalog as (
      select bucket_id, posture
      from app_private.storage_bucket_posture_catalog()
    ),
    policy_catalog as (
      select *
      from app_private.storage_object_policy_catalog()
    ),
    gaps as (
      select
        policy_catalog.bucket_id,
        policy_catalog.policy_name,
        'policy_bucket_missing_from_posture_catalog'::text as issue
      from policy_catalog
      left join bucket_catalog using (bucket_id)
      where bucket_catalog.bucket_id is null
      union all
      select
        policy_catalog.bucket_id,
        policy_catalog.policy_name,
        'server_only_bucket_has_client_policy'::text
      from policy_catalog
      join bucket_catalog using (bucket_id)
      where bucket_catalog.posture = 'server-only'
      union all
      select
        policy_catalog.bucket_id,
        policy_catalog.policy_name,
        'policy_roles_are_not_exactly_authenticated'::text
      from policy_catalog
      where policy_catalog.role_names <> array['authenticated']::text[]
      union all
      select
        policy_catalog.bucket_id,
        policy_catalog.policy_name,
        'reviewed_policy_is_restrictive'::text
      from policy_catalog
      where not policy_catalog.is_permissive
      union all
      select
        bucket_catalog.bucket_id,
        null::text,
        'private_client_bucket_has_no_reviewed_policy'::text
      from bucket_catalog
      where bucket_catalog.posture = 'private-client'
        and not exists (
          select 1
          from policy_catalog
          where policy_catalog.bucket_id = bucket_catalog.bucket_id
        )
    )
    select bucket_id, policy_name, issue
    from gaps
    order by bucket_id, policy_name, issue;
  "
)"
fail_if_rows "storage policy catalog violates bucket posture or exact client-role shape" "$storage_object_policy_posture_gaps"

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
    with reviewed(function_oid, role_name) as (
      values
        (pg_catalog.to_regprocedure('public.get_csf_application_role_context(uuid,text)')::oid, 'authenticated'::text),
        (pg_catalog.to_regprocedure('public.get_plugin_application_access_context(uuid,text,text)')::oid, 'authenticated'::text),
        (pg_catalog.to_regprocedure('public.get_plugin_application_access_context_by_identifier(text,text,text)')::oid, 'authenticated'::text),
        (pg_catalog.to_regprocedure('public.get_plugin_application_route_target_by_identifier(text,text,text)')::oid, 'authenticated'::text),
        (pg_catalog.to_regprocedure('public.get_plugin_application_asset_route_target_by_identifier(text,text,text,text)')::oid, 'authenticated'::text)
    ),
    grants as (
      select p.oid as function_oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as identity_arguments, r.rolname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('public'), ('anon'), ('authenticated')) r(rolname)
      where n.nspname = 'public'
        and p.prosecdef
        and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    )
    select g.nspname, g.proname, g.identity_arguments, g.rolname
    from grants g
    where not exists (
      select 1
      from reviewed
      where reviewed.function_oid = g.function_oid
        and reviewed.role_name = g.rolname
    )
    order by g.nspname, g.proname, g.identity_arguments, g.rolname;
  "
)"
fail_if_rows "unreviewed client EXECUTE grants on public SECURITY DEFINER functions" "$unexpected_security_definer_exec"

public_client_function_acl_drift="$(
  psql "$DB_URL" -AtF $'\t' -c "
    with expected(signature, role_name) as (
      values
        ('public.can_insert_project(uuid)', 'authenticated'),
        ('public.can_insert_project(uuid,text,uuid)', 'authenticated'),
        ('public.can_keep_or_set_public_visibility(uuid,uuid)', 'authenticated'),
        ('public.cancel_project_transactional(uuid,text)', 'authenticated'),
        ('public.end_recurring_project_series_transactional(uuid)', 'authenticated'),
        ('public.end_recurring_project_series_transactional(uuid,jsonb)', 'authenticated'),
        ('public.get_csf_application_role_context(uuid,text)', 'authenticated'),
        ('public.get_plugin_application_access_context(uuid,text,text)', 'authenticated'),
        ('public.get_plugin_application_access_context_by_identifier(text,text,text)', 'authenticated'),
        ('public.get_plugin_application_route_target_by_identifier(text,text,text)', 'authenticated'),
        ('public.get_plugin_application_asset_route_target_by_identifier(text,text,text,text)', 'authenticated'),
        ('public.get_public_attendees(uuid)', 'anon'),
        ('public.get_public_attendees(uuid)', 'authenticated'),
        ('public.is_project_organizer(uuid,uuid)', 'authenticated'),
        ('public.is_super_admin()', 'authenticated'),
        ('public.is_trusted_member(uuid)', 'authenticated'),
        ('public.reject_project_signup(uuid)', 'authenticated'),
        ('public.transition_project_status_transactional(uuid,text)', 'authenticated'),
        ('public.unreject_project_signup_with_capacity(uuid)', 'authenticated')
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
