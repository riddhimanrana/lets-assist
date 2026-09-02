#!/usr/bin/env bash

set -euo pipefail

mode="${1:-}"
if [[ "${mode}" != "enable" && "${mode}" != "disable" ]]; then
  echo "Usage: $0 <enable|disable>" >&2
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

if [[ "${mode}" == "enable" ]]; then
  # Commit the role default before taking the session snapshot. New
  # authenticator sessions then inherit read-only mode during termination.
  run_linked_query "ALTER ROLE authenticator SET default_transaction_read_only TO 'on';"
  run_linked_query "DO \$\$ DECLARE captured_pids integer[]; remaining_pids integer; termination_deadline timestamptz := clock_timestamp() + interval '20 seconds'; BEGIN SELECT coalesce(array_agg(pid), ARRAY[]::integer[]) INTO captured_pids FROM pg_stat_activity WHERE usename = 'authenticator' AND pid <> pg_backend_pid(); PERFORM pg_terminate_backend(target.target_pid, 0) FROM unnest(captured_pids) AS target(target_pid); LOOP SELECT count(*) INTO remaining_pids FROM pg_stat_activity WHERE pid = ANY (captured_pids); EXIT WHEN remaining_pids = 0; IF clock_timestamp() >= termination_deadline THEN RAISE EXCEPTION 'Could not terminate every captured pre-guard authenticator session'; END IF; PERFORM pg_sleep(0.1); END LOOP; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator' AND 'default_transaction_read_only=on' = ANY (coalesce(rolconfig, ARRAY[]::text[]))) THEN RAISE EXCEPTION 'Production application write block is not active'; END IF; END \$\$;"
  echo "Production application writes are blocked."
  exit 0
fi

run_linked_query "ALTER ROLE authenticator RESET default_transaction_read_only;"
run_linked_query "DO \$\$ DECLARE captured_pids integer[]; remaining_pids integer; termination_deadline timestamptz := clock_timestamp() + interval '20 seconds'; BEGIN SELECT coalesce(array_agg(pid), ARRAY[]::integer[]) INTO captured_pids FROM pg_stat_activity WHERE usename = 'authenticator' AND pid <> pg_backend_pid(); PERFORM pg_terminate_backend(target.target_pid, 0) FROM unnest(captured_pids) AS target(target_pid); LOOP SELECT count(*) INTO remaining_pids FROM pg_stat_activity WHERE pid = ANY (captured_pids); EXIT WHEN remaining_pids = 0; IF clock_timestamp() >= termination_deadline THEN RAISE EXCEPTION 'Could not terminate every captured guarded authenticator session'; END IF; PERFORM pg_sleep(0.1); END LOOP; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator' AND EXISTS (SELECT 1 FROM unnest(coalesce(rolconfig, ARRAY[]::text[])) AS setting WHERE setting LIKE 'default_transaction_read_only=%')) THEN RAISE EXCEPTION 'Production application write block is still active'; END IF; END \$\$;"
echo "Production application writes are open."
