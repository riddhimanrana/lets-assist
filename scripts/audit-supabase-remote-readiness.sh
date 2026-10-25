#!/usr/bin/env bash
set -euo pipefail
set +x

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${SUPABASE_DB_URL:-$(node "$ROOT_DIR/scripts/local-dev/dv-local-env.mjs" --db-url)}"
CONFIG_FILE="$ROOT_DIR/supabase/config.toml"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to run Supabase access audits." >&2
  exit 1
fi

if ! command -v rg >/dev/null 2>&1; then
  echo "rg is required to check source access boundaries." >&2
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Supabase Service-Only Access Audit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

failures=0

fail() {
  echo "FAIL: $1"
  failures=$((failures + 1))
}

if [[ ! -f "$CONFIG_FILE" ]]; then
  fail "Missing Supabase config: $CONFIG_FILE"
else
  api_schemas_line="$(grep -E '^schemas = ' "$CONFIG_FILE" || true)"
  if [[ "$api_schemas_line" != *'"plugin_data"'* && "$api_schemas_line" != *"'plugin_data'"* ]]; then
    fail "plugin_data is missing from api.schemas; the reviewed service-role PostgREST client requires it."
  fi
fi

if ! psql "$DB_URL" -X -v ON_ERROR_STOP=1 -Atc "select 1" >/dev/null 2>&1; then
  fail "Unable to connect to the configured Supabase database. Connection details are withheld."
else
  schema_access_violations="$(
    psql "$DB_URL" -X -v ON_ERROR_STOP=1 -AtF $'\t' -c "
      -- service_only_schema_access
      select client_role, 'unexpected schema usage'
      from pg_namespace
      cross join (values ('anon'), ('authenticated')) clients(client_role)
      where nspname = 'plugin_data'
        and has_schema_privilege(client_role, oid, 'USAGE')
      union all
      select 'service_role', 'missing schema usage'
      where not exists (
        select 1 from pg_namespace
        where nspname = 'plugin_data'
          and has_schema_privilege('service_role', oid, 'USAGE')
      );
    "
  )"
  if [[ -n "$schema_access_violations" ]]; then
    fail "plugin_data schema access differs from the service-only contract."
    echo "$schema_access_violations"
  fi

  client_relation_grants="$(
    psql "$DB_URL" -X -v ON_ERROR_STOP=1 -AtF $'\t' -c "
      -- service_only_relation_access
      select distinct client_role, relation.relname
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join (values ('anon'), ('authenticated')) clients(client_role)
      where namespace.nspname = 'plugin_data'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and (
          has_table_privilege(client_role, relation.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_any_column_privilege(client_role, relation.oid,
            'SELECT,INSERT,UPDATE,REFERENCES')
        )
      order by client_role, relation.relname;
    "
  )"
  if [[ -n "$client_relation_grants" ]]; then
    fail "Browser roles have effective plugin_data relation or column grants."
    echo "$client_relation_grants"
  fi

  client_sequence_grants="$(
    psql "$DB_URL" -X -v ON_ERROR_STOP=1 -AtF $'\t' -c "
      -- service_only_sequence_access
      select client_role, relation.relname
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join (values ('anon'), ('authenticated')) clients(client_role)
      where namespace.nspname = 'plugin_data' and relation.relkind = 'S'
        and has_sequence_privilege(client_role, relation.oid, 'USAGE,SELECT,UPDATE')
      order by client_role, relation.relname;
    "
  )"
  if [[ -n "$client_sequence_grants" ]]; then
    fail "Browser roles have effective plugin_data sequence grants."
    echo "$client_sequence_grants"
  fi

  rls_client_contracts="$(
    psql "$DB_URL" -X -v ON_ERROR_STOP=1 -AtF $'\t' -c "
      select plugin_key, data_access::text
      from public.plugin_runtime_contracts
      where data_access::text ~ '\"access\"[[:space:]]*:[[:space:]]*\"rls-client\"'
      order by plugin_key;
    "
  )"

  if [[ -n "$rls_client_contracts" ]]; then
    fail "plugin runtime contracts still declare rls-client access."
    echo "$rls_client_contracts"
  fi
fi

source_scan_status=0
direct_plugin_builders="$(
  cd "$ROOT_DIR"
  rg -n "schema\\([\\\"']plugin_data[\\\"']\\)" app components lib \
    --glob '!**/*.test.*' \
    --glob '!**/*.fixture.*' \
    --glob '!lib/plugins/private/**' \
    --glob '!lib/plugins/supabase.ts' \
    --glob '!lib/plugins/audit.ts' \
    --glob '!lib/plugins/runtime-contracts.ts' \
    2>&1
)" || source_scan_status=$?
if ((source_scan_status > 1)); then
  fail "Unable to scan source access boundaries."
  exit 1
fi

if [[ -n "$direct_plugin_builders" ]]; then
  fail "Non-private app/lib code still creates plugin_data schema builders outside the approved server helper."
  echo "$direct_plugin_builders"
fi

if [[ "$failures" -gt 0 ]]; then
  echo
  echo "Service-only access checks failed for the configured database. No deployment readiness is implied."
  exit 1
fi

echo "PASS: Supabase service-only access contract passed for the configured database. Hosted deployment and runtime acceptance remain separate checks."
