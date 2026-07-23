#!/usr/bin/env bash

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=require-supabase-cli-version.sh
source "${SCRIPT_DIR}/require-supabase-cli-version.sh"
require_supabase_cli_version

RUN_ID="${CSF_ISOLATED_RUN_ID:-$(date +%m%d%H%M%S)-$(( $$ % 100000 ))}"
# Supabase project IDs are capped at 40 characters. The fixed
# `lets-assist-csf-browser-` prefix consumes 24, so fail before the CLI can
# silently truncate the project label and invalidate our ownership marker.
if [[ ! "${RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$ ]]; then
  echo "CSF_ISOLATED_RUN_ID must contain only 1-16 letters, numbers, dots, underscores, or hyphens." >&2
  exit 1
fi
PROJECT_ID="lets-assist-csf-browser-${RUN_ID}"
WORK_DIR="${CSF_ISOLATED_WORK_DIR:-${TMPDIR:-/tmp}/${PROJECT_ID}}"
BASE_PORT="${CSF_ISOLATED_BASE_PORT:-56350}"
if [[ ! "${BASE_PORT}" =~ ^[0-9]+$ ]] || ((BASE_PORT < 1024 || BASE_PORT > 65526)); then
  echo "CSF_ISOLATED_BASE_PORT must be an integer between 1024 and 65526." >&2
  exit 1
fi
ENV_FILE="${WORK_DIR}/supabase-browser.env"
APP_ENV_FILE="${WORK_DIR}/lets-assist-browser.sh"
START_LOG="${WORK_DIR}/supabase-start.log"
MARKER_FILE="${WORK_DIR}/.lets-assist-csf-isolated-stack"

if [[ -e "${WORK_DIR}" ]]; then
  echo "Isolated work directory already exists: ${WORK_DIR}" >&2
  exit 1
fi

for offset in 0 1 2 3 4 5 6 7 9; do
  port=$((BASE_PORT + offset))
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port ${port} is already in use; choose another CSF_ISOLATED_BASE_PORT." >&2
    exit 1
  fi
done

mkdir -p "${WORK_DIR}"
rsync -a \
  --exclude '.temp' \
  --exclude '.branches' \
  --exclude '.env*' \
  supabase/ "${WORK_DIR}/supabase/"
chmod -R go-rwx "${WORK_DIR}"

node - "${WORK_DIR}/supabase/config.toml" "${PROJECT_ID}" "${BASE_PORT}" <<'NODE'
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

{
  printf 'project_id=%s\n' "${PROJECT_ID}"
  printf 'base_port=%s\n' "${BASE_PORT}"
} >"${MARKER_FILE}"
chmod 600 "${MARKER_FILE}"

on_error() {
  supabase stop \
    --workdir "${WORK_DIR}" \
    --project-id "${PROJECT_ID}" \
    --no-backup \
    --yes >/dev/null 2>&1 || true
  echo "Isolated stack startup failed. Its temporary files remain at ${WORK_DIR}." >&2
}
trap on_error ERR

if ! supabase start --workdir "${WORK_DIR}" --yes >"${START_LOG}" 2>&1; then
  on_error
  trap - ERR
  exit 1
fi
supabase status --workdir "${WORK_DIR}" -o env >"${ENV_FILE}" 2>>"${START_LOG}"
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
{
  printf 'export API_URL=%q\n' "${API_URL}"
  printf 'export ANON_KEY=%q\n' "${ANON_KEY}"
  printf 'export SERVICE_ROLE_KEY=%q\n' "${SERVICE_ROLE_KEY}"
  printf 'export DB_URL=%q\n' "${DB_URL}"
  printf 'export SUPABASE_URL=%q\n' "${API_URL}"
  printf 'export SUPABASE_ANON_KEY=%q\n' "${ANON_KEY}"
  printf 'export SUPABASE_DB_URL=%q\n' "${DB_URL}"
  printf 'export NEXT_PUBLIC_SUPABASE_URL=%q\n' "${API_URL}"
  printf 'export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=%q\n' "${PUBLISHABLE_KEY}"
  printf 'export NEXT_PUBLIC_SUPABASE_ANON_KEY=%q\n' "${ANON_KEY}"
  printf 'export SUPABASE_SECRET_KEY=%q\n' "${SECRET_KEY}"
  printf 'export SUPABASE_SERVICE_ROLE_KEY=%q\n' "${SERVICE_ROLE_KEY}"
  printf 'export NEXT_PUBLIC_SITE_URL=%q\n' "http://localhost:3001"
  printf 'export SITE_URL=%q\n' "http://localhost:3001"
  printf 'export NEXT_PUBLIC_VERCEL_URL=%q\n' "localhost:3001"
  printf 'export CSF_ISOLATED_WORK_DIR=%q\n' "${WORK_DIR}"
} >"${APP_ENV_FILE}"
chmod 600 "${ENV_FILE}" "${APP_ENV_FILE}" "${START_LOG}"

trap - ERR

echo "Isolated Let’s Assist Supabase is running."
echo "Project: ${PROJECT_ID}"
echo "Work directory: ${WORK_DIR}"
echo "API: http://127.0.0.1:$((BASE_PORT + 1))"
echo "Environment file: ${ENV_FILE}"
echo "App environment: ${APP_ENV_FILE}"
echo "Startup log: ${START_LOG}"
echo "App command: source '${APP_ENV_FILE}' && bun run dev -- --port 3001"
echo "Stop command: scripts/local-dev/stop-dvhs-csf-isolated-stack.sh '${WORK_DIR}'"
