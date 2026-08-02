#!/usr/bin/env bash

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=require-supabase-cli-version.sh
source "${SCRIPT_DIR}/require-supabase-cli-version.sh"
require_supabase_cli_version

RUN_ID="${CSF_REPLAY_RUN_ID:-$(date +%m%d%H%M%S)-$(( $$ % 100000 ))}"
# Keep the generated Supabase project label at or below its 40-character
# limit. A longer label is silently truncated by the CLI, weakening exact
# ownership checks during cleanup.
if [[ ! "${RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$ ]]; then
  echo "CSF_REPLAY_RUN_ID must contain only 1-16 letters, numbers, dots, underscores, or hyphens." >&2
  exit 1
fi
PROJECT_ID="lets-assist-csf-replay-${RUN_ID}"
BASE_PORT="${CSF_REPLAY_BASE_PORT:-$((55000 + ($$ % 700)))}"
if [[ ! "${BASE_PORT}" =~ ^[0-9]+$ ]] || ((BASE_PORT < 1024 || BASE_PORT > 65526)); then
  echo "CSF_REPLAY_BASE_PORT must be an integer between 1024 and 65526." >&2
  exit 1
fi

REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"
REPLAY_ROOT_RAW="${CSF_REPLAY_TMP_ROOT:-${TMPDIR:-/tmp}/lets-assist-csf-replays}"
REPLAY_ROOT="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "${REPLAY_ROOT_RAW}")"
assert_safe_replay_root() {
  case "$1" in
    / | "${HOME}" | "${REPO_ROOT}" | "${REPO_ROOT}"/*)
      echo "Refusing unsafe CSF replay root: $1" >&2
      exit 1
      ;;
  esac
}
assert_safe_replay_root "${REPLAY_ROOT}"
mkdir -p "${REPLAY_ROOT}"
REPLAY_ROOT="$(cd "${REPLAY_ROOT}" && pwd -P)"
# Resolve symlinks and enforce the boundary again. A path that looks temporary
# before mkdir may traverse a symlink into the repository.
assert_safe_replay_root "${REPLAY_ROOT}"

TMP_DIR="${REPLAY_ROOT}/${PROJECT_ID}"
if [[ -e "${TMP_DIR}" ]]; then
  echo "Refusing to reuse an existing CSF replay directory: ${TMP_DIR}" >&2
  exit 1
fi
OWNERSHIP_MARKER="${TMP_DIR}/.lets-assist-csf-replay-owned"

probe_loopback_port() {
  node - "$1" <<'NODE'
const { createServer } = require("node:net");

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(2);

const probe = createServer();
probe.once("error", (error) => {
  process.exitCode = error?.code === "EADDRINUSE" ? 1 : 2;
});
probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
  probe.close((error) => {
    process.exitCode = error ? 2 : 0;
  });
});
NODE
}

ports_are_available() {
  local candidate="$1"
  local offset port probe_status

  for offset in 0 1 2 3 4 5 6 7 9; do
    port=$((candidate + offset))
    probe_status=0
    probe_loopback_port "${port}" || probe_status=$?
    case "${probe_status}" in
      0) ;;
      1) return 1 ;;
      *)
        echo "Could not verify whether loopback port ${port} is available; refusing to start." >&2
        return 2
        ;;
    esac
  done

  return 0
}

if [[ -z "${CSF_REPLAY_BASE_PORT:-}" ]]; then
  for _attempt in $(seq 1 50); do
    port_status=0
    ports_are_available "${BASE_PORT}" || port_status=$?
    if ((port_status == 0)); then
      break
    fi
    if ((port_status != 1)); then
      exit "${port_status}"
    fi
    BASE_PORT=$((BASE_PORT + 10))
  done
fi

port_status=0
ports_are_available "${BASE_PORT}" || port_status=$?
if ((port_status != 0)); then
  if ((port_status != 1)); then
    exit "${port_status}"
  fi
  echo "No free isolated Supabase port range was found near ${BASE_PORT}." >&2
  echo "Set CSF_REPLAY_BASE_PORT to an unused base port and retry." >&2
  exit 1
fi

cleanup() {
  if [[ ! -f "${OWNERSHIP_MARKER}" ]]; then
    return
  fi
  local owned_project_id owned_parent cleanup_failed
  owned_project_id="$(sed -nE 's/^project_id=(.+)$/\1/p' "${OWNERSHIP_MARKER}")"
  owned_parent="$(cd "$(dirname "${TMP_DIR}")" && pwd -P)"
  if [[ "${owned_project_id}" != "${PROJECT_ID}" || "${owned_parent}" != "${REPLAY_ROOT}" ]]; then
    echo "Refusing cleanup outside the owned CSF replay root." >&2
    return
  fi
  cleanup_failed=0
  if ! supabase stop \
    --workdir "${TMP_DIR}" \
    --project-id "${PROJECT_ID}" \
    --no-backup \
    --yes >/dev/null 2>&1; then
    echo "Failed to stop the owned CSF replay stack; preserving ${TMP_DIR}." >&2
    cleanup_failed=1
  fi

  if command -v docker >/dev/null 2>&1; then
    if [[ -n "$(docker ps -aq --filter "label=com.supabase.cli.project=${PROJECT_ID}")" ]]; then
      echo "Owned CSF replay containers remain after Supabase cleanup; preserving ${TMP_DIR}." >&2
      cleanup_failed=1
    fi
    if [[ -n "$(docker volume ls -q --filter "label=com.supabase.cli.project=${PROJECT_ID}")" ]]; then
      echo "Owned CSF replay volumes remain after Supabase cleanup; preserving ${TMP_DIR}." >&2
      cleanup_failed=1
    fi
    if [[ -n "$(docker network ls -q --filter "label=com.supabase.cli.project=${PROJECT_ID}")" ]]; then
      echo "Owned CSF replay networks remain after Supabase cleanup; preserving ${TMP_DIR}." >&2
      cleanup_failed=1
    fi
  fi

  if ((cleanup_failed != 0)); then
    return 1
  fi
  rm -rf -- "${TMP_DIR}"
}
trap cleanup EXIT

mkdir "${TMP_DIR}"
printf 'project_id=%s\n' "${PROJECT_ID}" >"${OWNERSHIP_MARKER}"
chmod 600 "${OWNERSHIP_MARKER}"
rsync -a \
  --exclude '.temp' \
  --exclude '.branches' \
  --exclude '.env*' \
  supabase/ "$TMP_DIR/supabase/"
chmod -R go-rwx "${TMP_DIR}"

node - "$TMP_DIR/supabase/config.toml" "$PROJECT_ID" "$BASE_PORT" <<'NODE'
const fs = require("node:fs");
const [path, projectId, rawBase] = process.argv.slice(2);
const base = Number(rawBase);
let source = fs.readFileSync(path, "utf8");
const replacements = new Map([
  ['project_id = "lets-assist"', `project_id = "${projectId}"`],
  ["port = 54321", `port = ${base + 1}`],
  ["port = 54322", `port = ${base + 2}`],
  ["shadow_port = 54320", `shadow_port = ${base}`],
  ["port = 54329", `port = ${base + 9}`],
  ["port = 54323", `port = ${base + 3}`],
  ["port = 54324", `port = ${base + 4}`],
  ["smtp_port = 54325", `smtp_port = ${base + 5}`],
  ["inspector_port = 8083", `inspector_port = ${base + 6}`],
  ["port = 54327", `port = ${base + 7}`],
]);
for (const [before, after] of replacements) {
  if (!source.includes(before)) throw new Error(`Missing config token: ${before}`);
  source = source.replace(before, after);
}
fs.writeFileSync(path, source);
NODE

echo "Starting isolated Supabase project ${PROJECT_ID} on database port $((BASE_PORT + 2))"
supabase db start --workdir "$TMP_DIR" --yes
supabase test db --workdir "$TMP_DIR"

DB_URL=$(supabase status --workdir "$TMP_DIR" -o env \
  | sed -n 's/^DB_URL="\([^"]*\)"$/\1/p')
if [[ -z "$DB_URL" ]]; then
  echo "Unable to resolve the isolated database URL from Supabase status." >&2
  exit 1
fi

MIGRATION_COUNT=$(psql "$DB_URL" \
  -Atc 'select count(*) from supabase_migrations.schema_migrations')
CSF_TABLE_COUNT=$(psql "$DB_URL" \
  -Atc "select count(*) from information_schema.tables where table_schema = 'plugin_data' and table_name like 'csf_%'")

echo "Isolated replay passed: ${MIGRATION_COUNT} migrations, ${CSF_TABLE_COUNT} CSF tables"

# Run cleanup as part of the successful command, not only through EXIT, so a
# leaked container/volume/network makes the replay fail instead of being hidden
# behind a passing pgTAP result.
trap - EXIT
cleanup
