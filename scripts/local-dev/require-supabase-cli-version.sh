#!/usr/bin/env bash

# Keep disposable CSF stacks reproducible and isolated from ambient toolchains.
# This file is sourced by start/stop/replay scripts and may also be run directly.

SUPABASE_CLI_REQUIRED_VERSION="2.120.0"

configure_supabase_cli_environment() {
  # The resource oracle covers the legacy Docker backend only.
  export SUPABASE_EXPERIMENTAL_STACK=0
  # CLI tracing applies to legacy calls too. Do not inherit export destinations.
  unset SUPABASE_TRACE_FILE SUPABASE_OTLP_ENDPOINT SUPABASE_OTLP_HEADERS
}

configure_supabase_cli_environment

require_supabase_cli_version() {
  configure_supabase_cli_environment
  if ! command -v supabase >/dev/null 2>&1; then
    echo "Supabase CLI ${SUPABASE_CLI_REQUIRED_VERSION} is required, but supabase was not found in PATH." >&2
    return 1
  fi

  local actual_version
  actual_version="$(supabase --version 2>/dev/null | head -n 1 | tr -d '[:space:]')"
  if [[ "${actual_version}" != "${SUPABASE_CLI_REQUIRED_VERSION}" ]]; then
    echo "Supabase CLI ${SUPABASE_CLI_REQUIRED_VERSION} is required; found ${actual_version:-unknown}." >&2
    return 1
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  require_supabase_cli_version
  echo "Supabase CLI ${SUPABASE_CLI_REQUIRED_VERSION} verified."
fi
