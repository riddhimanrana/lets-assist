#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=require-supabase-cli-version.sh
source "${SCRIPT_DIR}/require-supabase-cli-version.sh"
require_supabase_cli_version

usage() {
  cat <<'USAGE'
Usage:
  scripts/local-dev/stop-dvhs-csf-isolated-stack.sh [--dry-run] [--delete-workdir] WORK_DIR

Stops exactly one generated DVHS CSF Supabase stack. WORK_DIR may instead be
provided through CSF_ISOLATED_WORK_DIR. The temporary files are retained unless
--delete-workdir is supplied.
USAGE
}

die() {
  echo "$1" >&2
  exit 1
}

DRY_RUN=false
DELETE_WORKDIR=false
WORK_DIR_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --delete-workdir)
      DELETE_WORKDIR=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -* )
      die "Unknown option: $1"
      ;;
    *)
      if [[ -n "${WORK_DIR_ARG}" ]]; then
        die "Provide exactly one isolated WORK_DIR."
      fi
      WORK_DIR_ARG="$1"
      ;;
  esac
  shift
done

ENV_WORK_DIR="${CSF_ISOLATED_WORK_DIR:-}"
if [[ -n "${WORK_DIR_ARG}" && -n "${ENV_WORK_DIR}" && "${WORK_DIR_ARG}" != "${ENV_WORK_DIR}" ]]; then
  die "WORK_DIR conflicts with CSF_ISOLATED_WORK_DIR; provide only one target."
fi

REQUESTED_WORK_DIR="${WORK_DIR_ARG:-${ENV_WORK_DIR}}"
if [[ -z "${REQUESTED_WORK_DIR}" ]]; then
  usage >&2
  die "An explicit isolated WORK_DIR is required."
fi
if [[ ! -d "${REQUESTED_WORK_DIR}" ]]; then
  die "Isolated work directory does not exist: ${REQUESTED_WORK_DIR}"
fi

WORK_DIR="$(cd "${REQUESTED_WORK_DIR}" && pwd -P)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

case "${WORK_DIR}" in
  / | "${HOME}" | "${TMPDIR:-/tmp}" | /tmp)
    die "Refusing unsafe work directory: ${WORK_DIR}"
    ;;
esac

if [[ -n "${REPO_ROOT}" ]]; then
  REPO_ROOT="$(cd "${REPO_ROOT}" && pwd -P)"
  case "${WORK_DIR}" in
    "${REPO_ROOT}" | "${REPO_ROOT}/supabase")
      die "Refusing to stop the shared repository stack: ${WORK_DIR}"
      ;;
  esac
fi

CONFIG_FILE="${WORK_DIR}/supabase/config.toml"
if [[ ! -f "${CONFIG_FILE}" ]]; then
  die "Missing isolated Supabase config: ${CONFIG_FILE}"
fi

PROJECT_ID="$(sed -nE 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "${CONFIG_FILE}")"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == *$'\n'* ]]; then
  die "Could not derive one project_id from ${CONFIG_FILE}."
fi
if [[ ! "${PROJECT_ID}" =~ ^lets-assist-csf-browser-[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  die "Refusing non-isolated Supabase project_id: ${PROJECT_ID}"
fi

MARKER_FILE="${WORK_DIR}/.lets-assist-csf-isolated-stack"
if [[ ! -f "${MARKER_FILE}" ]]; then
  die "Missing generated isolated stack marker: ${MARKER_FILE}"
fi
MARKER_PROJECT_ID="$(sed -nE 's/^project_id=(.+)$/\1/p' "${MARKER_FILE}")"
if [[ "${MARKER_PROJECT_ID}" != "${PROJECT_ID}" ]]; then
  die "Isolated stack marker does not match config project_id."
fi

echo "Isolated project: ${PROJECT_ID}"
echo "Work directory: ${WORK_DIR}"

if [[ "${DRY_RUN}" == true ]]; then
  echo "Dry run: no containers, volumes, networks, or files were changed."
  if [[ "${DELETE_WORKDIR}" == true ]]; then
    echo "Dry run: ${WORK_DIR} would be deleted after the stack stopped."
  fi
  exit 0
fi

# Both selectors are intentional: --workdir loads only this generated config,
# and --project-id filters Docker resources to the same validated project label.
supabase stop \
  --workdir "${WORK_DIR}" \
  --project-id "${PROJECT_ID}" \
  --no-backup \
  --yes

if command -v docker >/dev/null 2>&1; then
  REMAINING_CONTAINERS="$(docker ps -aq --filter "label=com.supabase.cli.project=${PROJECT_ID}")"
  if [[ -n "${REMAINING_CONTAINERS}" ]]; then
    die "Supabase reported success, but isolated containers still remain for ${PROJECT_ID}."
  fi
  REMAINING_VOLUMES="$(docker volume ls -q --filter "label=com.supabase.cli.project=${PROJECT_ID}")"
  if [[ -n "${REMAINING_VOLUMES}" ]]; then
    die "Supabase reported success, but isolated volumes still remain for ${PROJECT_ID}."
  fi
  REMAINING_NETWORKS="$(docker network ls -q --filter "label=com.supabase.cli.project=${PROJECT_ID}")"
  if [[ -n "${REMAINING_NETWORKS}" ]]; then
    die "Supabase reported success, but isolated networks still remain for ${PROJECT_ID}."
  fi
fi

if [[ "${DELETE_WORKDIR}" == true ]]; then
  rm -rf -- "${WORK_DIR}"
  echo "Deleted isolated work directory: ${WORK_DIR}"
else
  echo "Retained isolated work directory: ${WORK_DIR}"
fi

echo "Stopped isolated Supabase project: ${PROJECT_ID}"
