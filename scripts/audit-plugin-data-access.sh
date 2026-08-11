#!/usr/bin/env bash
set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Plugin Data Access Audit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) is required to run plugin data access audits." >&2
  exit 1
fi

failures=0

fail_if_matches() {
  local title="$1"
  local matches="$2"

  if [[ -n "$matches" ]]; then
    echo "FAIL: $title"
    echo "$matches"
    failures=$((failures + 1))
  fi
}

browser_plugin_schema_access="$(
  find app lib -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 \
    | xargs -0 rg -l "^['\"]use client['\"]|^\"use client\"|^'use client'" \
    | xargs rg -n "schema\\(['\"]plugin_data|@/lib/plugins/supabase|getPluginSupabase|createPluginClient|createDualClient" \
    || true
)"
fail_if_matches "client components importing or constructing plugin_data access" "$browser_plugin_schema_access"

legacy_browser_helper="$(
  rg -n "@/lib/supabase/client|schema\\(['\"]plugin_data" lib/plugins/supabase-client.ts 2>/dev/null || true
)"
fail_if_matches "legacy browser plugin_data helper still exists" "$legacy_browser_helper"

unexpected_plugin_schema_access="$(
  rg -n "schema\\(['\"]plugin_data" app lib \
    --glob '!lib/plugins/supabase.ts' \
    --glob '!lib/plugins/private/**' \
    --glob '!node_modules/**' \
    || true
)"
fail_if_matches "plugin_data schema access outside server helper/private plugins" "$unexpected_plugin_schema_access"

server_helper_contract_failure="$(
  if rg -q 'createPluginClient|createDualClient|LETS_ASSIST_ENABLE_LEGACY_PLUGIN_DATA_API' lib/plugins/supabase.ts; then
    echo "lib/plugins/supabase.ts: legacy authenticated plugin_data helper remains"
  fi
  if ! rg -q 'getAdminClient\(\)\.schema\("plugin_data"\)' lib/plugins/supabase.ts; then
    echo "lib/plugins/supabase.ts: service-role plugin_data helper is missing"
  fi
)"
fail_if_matches "server plugin_data helper contract drift" "$server_helper_contract_failure"

if [[ "$failures" -gt 0 ]]; then
  echo "FAIL: Plugin data access audit found $failures blocking issue group(s)."
  exit 1
fi

echo "PASS: plugin_data access is restricted to server/private plugin paths and tests/fixtures."
