#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=require-supabase-cli-version.sh
source "${SCRIPT_DIR}/require-supabase-cli-version.sh"
SUPABASE_PROJECT_ID="$(node "${SCRIPT_DIR}/supabase-project-id.mjs" "$@")"
export SUPABASE_PROJECT_ID
export SUPABASE_NETWORK_ID=""
unset SUPABASE_WORKDIR
require_supabase_cli_version
if [[ "${1:-}" == start || ( "${1:-}" == db && "${2:-}" == start ) ]]; then
  exec supabase "$@" --network-id=
fi
exec supabase "$@"
