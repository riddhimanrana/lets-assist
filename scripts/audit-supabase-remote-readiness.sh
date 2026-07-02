#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
CONFIG_FILE="$ROOT_DIR/supabase/config.toml"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to run Supabase remote-readiness audits." >&2
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Supabase Remote Server-Only Readiness Audit"
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
  if [[ "$api_schemas_line" == *'"plugin_data"'* || "$api_schemas_line" == *"'plugin_data'"* ]]; then
    fail "plugin_data is still listed in supabase/config.toml api.schemas. Final server-only posture requires removing plugin_data from exposed Data API schemas after server/RPC cutover."
    echo "$api_schemas_line"
  fi
fi

if ! psql "$DB_URL" -Atc "select 1" >/dev/null 2>&1; then
  fail "Unable to connect to local Supabase Postgres at: $DB_URL"
else
  authenticated_plugin_grants="$(
    psql "$DB_URL" -AtF $'\t' -c "
      select privilege_type, count(*)
      from information_schema.role_table_grants
      where table_schema = 'plugin_data'
        and grantee = 'authenticated'
      group by privilege_type
      order by privilege_type;
    "
  )"

  if [[ -n "$authenticated_plugin_grants" ]]; then
    fail "authenticated still has direct plugin_data table grants. Final server-only posture requires service-role/private RPC/read-model replacements first."
    echo "$authenticated_plugin_grants"
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
    fail "authenticated still has plugin_data schema USAGE."
    echo "$authenticated_schema_usage"
  fi

  rls_client_contracts="$(
    psql "$DB_URL" -AtF $'\t' -c "
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

direct_plugin_builders="$(
  rg -n "schema\\([\\\"']plugin_data[\\\"']\\)" "$ROOT_DIR/app" "$ROOT_DIR/components" "$ROOT_DIR/lib" \
    --glob '!lib/plugins/private/**' \
    --glob '!lib/plugins/supabase.ts' \
    --glob '!lib/plugins/audit.ts' \
    --glob '!lib/plugins/runtime-contracts.ts' \
    2>/dev/null || true
)"

if [[ -n "$direct_plugin_builders" ]]; then
  fail "Non-private app/lib code still creates plugin_data schema builders outside the approved server helper."
  echo "$direct_plugin_builders"
fi

if [[ "$failures" -gt 0 ]]; then
  echo
  echo "Remote server-only readiness is not complete. This is expected until plugin_data reads/writes are moved behind server-only RPCs, route handlers, or direct Postgres/service-role helpers and plugin_data is removed from exposed schemas."
  exit 1
fi

echo "PASS: Supabase remote server-only readiness audit passed."
