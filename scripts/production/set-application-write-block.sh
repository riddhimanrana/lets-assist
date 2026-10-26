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

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
timeout 60s node "${script_directory}/set-application-write-block.mjs" "${mode}" >/dev/null

if [[ "${mode}" == "barrier" ]]; then
  echo "Previously admitted request transactions have settled."
else
  echo "Production request guard state changed through the transaction gate. Fresh API verification is required."
fi
