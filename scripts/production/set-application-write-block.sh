#!/usr/bin/env bash

set -euo pipefail

mode="${1:-}"
if [[ "${mode}" != "enable" && "${mode}" != "disable" && "${mode}" != "barrier" ]]; then
  echo "Usage: $0 <enable|disable|barrier>" >&2
  exit 1
fi

for variable in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required to change the Production application write block." >&2
    exit 1
  fi
done

run_linked_query() {
  timeout 60s supabase db query --linked "$1" >/dev/null
}

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
request_guard_sql="$(node "${script_directory}/request-write-fence.mjs" "${mode}")"
run_linked_query "${request_guard_sql}"

if [[ "${mode}" == "barrier" ]]; then
  echo "Previously admitted request transactions have settled."
else
  echo "Production request guard state changed through the transaction gate. Fresh API verification is required."
fi
