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
# Reject the supplied pathname itself before resolving it: a symlink would let a
# validated marker describe a directory the caller never named.
if [[ -L "${REQUESTED_WORK_DIR}" ]]; then
  die "Refusing a symlinked isolated work directory: ${REQUESTED_WORK_DIR}"
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

# One shared, non-executing validator for the marker and the generated config.
# It proves owner-only regular files with a single hard link, the exact marker
# schema, canonical work_dir/project/run-ID agreement, the whole nine-port
# bundle and every generated config mapping, and — for a ready marker — the exact
# typed database volume identity. It then emits a bounded exact-key record from
# the same held descriptors it validated. Nothing here is evaluated or sourced,
# and it all runs before any supabase stop, Docker call, or deletion.
STACK_HANDOFF="$(CSF_ISOLATED_WORK_DIR="${WORK_DIR}" node "${SCRIPT_DIR}/dv-local-env.mjs" --validate-stack-target)" ||
  die "Refusing to act on an isolated work directory that failed strict validation: ${WORK_DIR}"

MARKER_STATE=""
PROJECT_ID=""
MARKER_RUN_ID=""
MARKER_BASE_PORT=""
MARKER_WORK_DIR=""
MARKER_FILE=""
CONFIG_FILE=""
MARKER_DB_VOLUME=""
MARKER_DB_VOLUME_LABEL=""

while IFS= read -r handoff_line; do
  [[ -n "${handoff_line}" ]] || continue
  handoff_key="${handoff_line%%=*}"
  handoff_value="${handoff_line#*=}"
  case "${handoff_key}" in
    state) MARKER_STATE="${handoff_value}" ;;
    project_id) PROJECT_ID="${handoff_value}" ;;
    run_id) MARKER_RUN_ID="${handoff_value}" ;;
    base_port) MARKER_BASE_PORT="${handoff_value}" ;;
    work_dir) MARKER_WORK_DIR="${handoff_value}" ;;
    marker_path) MARKER_FILE="${handoff_value}" ;;
    config_path) CONFIG_FILE="${handoff_value}" ;;
    db_volume) MARKER_DB_VOLUME="${handoff_value}" ;;
    db_volume_project_label) MARKER_DB_VOLUME_LABEL="${handoff_value}" ;;
    *)
      die "Refusing an unexpected isolated stack handoff key: ${handoff_key}"
      ;;
  esac
done <<HANDOFF
${STACK_HANDOFF}
HANDOFF

# Re-check the bounded record in this shell so a truncated or partial handoff can
# never reach a stop, a Docker call, or a deletion.
if [[ "${PROJECT_ID}" != "lets-assist-csf-browser-${MARKER_RUN_ID}" ]]; then
  die "Isolated stack handoff project/run-ID pair is inconsistent: ${PROJECT_ID:-<missing>}"
fi
if [[ ! "${MARKER_BASE_PORT}" =~ ^[0-9]+$ ]]; then
  die "Isolated stack handoff has an invalid base_port: ${MARKER_BASE_PORT:-<missing>}"
fi
if [[ "${MARKER_WORK_DIR}" != "${WORK_DIR}" ]]; then
  die "Isolated stack handoff work_dir ${MARKER_WORK_DIR:-<missing>} is not this directory: ${WORK_DIR}"
fi
if [[ "${MARKER_FILE}" != "${WORK_DIR}/.lets-assist-csf-isolated-stack" ||
  "${CONFIG_FILE}" != "${WORK_DIR}/supabase/config.toml" ]]; then
  die "Isolated stack handoff points outside this work directory."
fi
case "${MARKER_STATE}" in
  ready)
    if [[ "${MARKER_DB_VOLUME}" != "supabase_db_${PROJECT_ID}" ||
      "${MARKER_DB_VOLUME_LABEL}" != "${PROJECT_ID}" ]]; then
      die "Isolated stack handoff does not record the canonical database volume identity."
    fi
    ;;
  starting)
    if [[ -n "${MARKER_DB_VOLUME}" || -n "${MARKER_DB_VOLUME_LABEL}" ]]; then
      die "Transitional isolated stack handoff must not record a database volume."
    fi
    ;;
  *)
    die "Isolated stack handoff has an unknown state: ${MARKER_STATE:-<missing>}"
    ;;
esac

# One pinned, test-owned contract of exact resource names for Supabase CLI
# 2.111.0, typed by kind and shared with the launcher so preflight and residual
# checks stay identical.
CANONICAL_CONTAINER_NAMES="$(node "${SCRIPT_DIR}/dv-local-env.mjs" --canonical-docker-names container "${PROJECT_ID}")" ||
  die "Unable to derive the pinned canonical Docker container names for ${PROJECT_ID}."
CANONICAL_VOLUME_NAMES="$(node "${SCRIPT_DIR}/dv-local-env.mjs" --canonical-docker-names volume "${PROJECT_ID}")" ||
  die "Unable to derive the pinned canonical Docker volume names for ${PROJECT_ID}."
CANONICAL_NETWORK_NAMES="$(node "${SCRIPT_DIR}/dv-local-env.mjs" --canonical-docker-names network "${PROJECT_ID}")" ||
  die "Unable to derive the pinned canonical Docker network names for ${PROJECT_ID}."
PROJECT_LABEL_KEY="com.supabase.cli.project"
PROJECT_LABEL="${PROJECT_LABEL_KEY}=${PROJECT_ID}"

canonical_names_for_kind() {
  case "$1" in
    container) printf '%s\n' "${CANONICAL_CONTAINER_NAMES}" ;;
    volume) printf '%s\n' "${CANONICAL_VOLUME_NAMES}" ;;
    network) printf '%s\n' "${CANONICAL_NETWORK_NAMES}" ;;
    *)
      echo "Unknown canonical Docker resource kind: $1" >&2
      return 1
      ;;
  esac
}

prefix_lines() {
  local kind="$1"
  local selector="$2"
  local line
  while IFS= read -r line; do
    if [[ -n "${line}" ]]; then
      printf '%s\t%s\t%s\n' "${kind}" "${selector}" "${line}"
    fi
  done
}

# Matches only against the allowlist for the kind being enumerated.
canonical_named_resources() {
  local kind="$1"
  local allowlist name
  allowlist="$(canonical_names_for_kind "${kind}")" || return 1
  while IFS= read -r name; do
    if [[ -z "${name}" ]]; then
      continue
    fi
    if printf '%s\n' "${allowlist}" | grep -Fxq -- "${name}"; then
      printf '%s\n' "${name}"
    fi
  done
}

collect_project_resources() {
  local labeled_containers labeled_volumes labeled_networks
  local all_containers all_volumes all_networks

  labeled_containers="$(docker ps -a --filter "label=${PROJECT_LABEL}" --format '{{.Names}}')" || return 1
  labeled_volumes="$(docker volume ls --filter "label=${PROJECT_LABEL}" --format '{{.Name}}')" || return 1
  labeled_networks="$(docker network ls --filter "label=${PROJECT_LABEL}" --format '{{.Name}}')" || return 1
  all_containers="$(docker ps -a --format '{{.Names}}')" || return 1
  all_volumes="$(docker volume ls --format '{{.Name}}')" || return 1
  all_networks="$(docker network ls --format '{{.Name}}')" || return 1

  printf '%s\n' "${labeled_containers}" | tr ',' '\n' | prefix_lines container label
  printf '%s\n' "${labeled_volumes}" | prefix_lines volume label
  printf '%s\n' "${labeled_networks}" | prefix_lines network label
  printf '%s\n' "${all_containers}" | tr ',' '\n' | canonical_named_resources container | prefix_lines container name
  printf '%s\n' "${all_volumes}" | canonical_named_resources volume | prefix_lines volume name
  printf '%s\n' "${all_networks}" | canonical_named_resources network | prefix_lines network name
}

# ---------------------------------------------------------------------------
# Pre-stop ownership validation.
#
# Enumerating resources is not the same as recognizing them. The union above
# reports anything that either carries the exact project label or matches a
# canonical name, which is what makes a *residual* check useful after stopping —
# but before stopping, a non-empty union was previously treated as ordinary. That
# left three ways to stop something this launcher does not own:
#
#   - a resource carrying the exact label under a name outside the canonical set
#     for its own kind (an unexpected labeled resource);
#   - a canonical name in the wrong resource kind, or carrying no label or the
#     wrong one (a same-name collision, which is exactly what a stale or foreign
#     volume looks like);
#   - a ready marker whose recorded database volume is absent from the volume
#     namespace, or present without the exact label.
#
# Every one of those is now invalid, and every invalid state makes zero stop and
# zero deletion calls while retaining the marker and the rest of the evidence.
# Names and labels still come from dv-local-env.mjs; nothing here re-derives a
# looser model of either.
# ---------------------------------------------------------------------------

# Reports the exact label a resource carries, or the empty string when it carries
# none. An inspection failure is a validation failure, never a pass.
inspect_resource_label() {
  local kind="$1" name="$2" label
  case "${kind}" in
    container) label="$(docker inspect --format "{{index .Config.Labels \"${PROJECT_LABEL_KEY}\"}}" "${name}" 2>/dev/null)" || return 1 ;;
    volume) label="$(docker volume inspect --format "{{index .Labels \"${PROJECT_LABEL_KEY}\"}}" "${name}" 2>/dev/null)" || return 1 ;;
    network) label="$(docker network inspect --format "{{index .Labels \"${PROJECT_LABEL_KEY}\"}}" "${name}" 2>/dev/null)" || return 1 ;;
    *) return 1 ;;
  esac
  # Docker prints the Go zero value for an absent key.
  case "${label}" in
    "<no value>" | "<nil>") label="" ;;
  esac
  printf '%s' "${label}"
}

validate_owned_inventory() {
  local inventory="$1"
  local kind selector name allowlist label invalid=0
  local -a present_containers=() present_volumes=() present_networks=()

  while IFS=$'\t' read -r kind selector name; do
    [[ -n "${name}" ]] || continue

    if ! allowlist="$(canonical_names_for_kind "${kind}")"; then
      echo "Pre-stop validation could not derive the canonical ${kind} names." >&2
      return 1
    fi

    # 1. Name must be canonical for this exact kind. A labeled resource under any
    #    other name, and a canonical name that belongs to another kind, both land
    #    here.
    if ! printf '%s\n' "${allowlist}" | grep -Fxq -- "${name}"; then
      echo "Pre-stop validation refused an unexpected ${kind} for ${PROJECT_ID}: ${name} (via ${selector})" >&2
      invalid=1
      continue
    fi

    # 2. And it must carry the exact project label, whichever way it surfaced.
    if ! label="$(inspect_resource_label "${kind}" "${name}")"; then
      echo "Pre-stop validation could not inspect the ${kind} ${name}." >&2
      invalid=1
      continue
    fi
    if [[ "${label}" != "${PROJECT_ID}" ]]; then
      echo "Pre-stop validation refused ${kind} ${name}: label '${label:-<none>}' is not ${PROJECT_ID}." >&2
      invalid=1
      continue
    fi

    case "${kind}" in
      container) present_containers[${#present_containers[@]}]="${name}" ;;
      volume) present_volumes[${#present_volumes[@]}]="${name}" ;;
      network) present_networks[${#present_networks[@]}]="${name}" ;;
    esac
  done <<INVENTORY
${inventory}
INVENTORY

  if ((invalid != 0)); then
    return 1
  fi

  # 3. A ready marker claims a specific database volume. That volume must be
  #    present in the volume namespace, under its exact label, or the marker is
  #    describing something this stop would not actually be stopping.
  if [[ "${MARKER_STATE}" == "ready" ]]; then
    if ! printf '%s\n' "${present_volumes[@]+"${present_volumes[@]}"}" |
      grep -Fxq -- "${MARKER_DB_VOLUME}"; then
      echo "Pre-stop validation refused ${PROJECT_ID}: the recorded database volume ${MARKER_DB_VOLUME} is not present with the exact label." >&2
      return 1
    fi
  fi

  return 0
}

echo "Isolated project: ${PROJECT_ID}"
echo "Marker state: ${MARKER_STATE}"
echo "Work directory: ${WORK_DIR}"

# Evidence retention message, printed on every path that keeps the directory.
retention_notice() {
  echo "Retained isolated work directory: ${WORK_DIR}"
  echo "  marker, generated config, start log, and allocator recovery evidence are preserved there."
}

# ---------------------------------------------------------------------------
# Docker capability preflight — strictly before any supabase stop.
#
# The previous shape made residual enumeration conditional on `command -v
# docker`, which meant a host without Docker took the stop path, skipped the
# proof entirely, and then deleted the work directory. That is exactly backwards:
# the case where we can prove least is the case where we destroyed most. Nothing
# stops here until we have shown we can read Docker's answer afterwards.
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  retention_notice >&2
  die "Refusing to stop ${PROJECT_ID}: docker is required to prove residual state after stopping."
fi

if ! PRE_STOP_RESOURCES="$(collect_project_resources)"; then
  retention_notice >&2
  die "Refusing to stop ${PROJECT_ID}: read-only Docker enumeration failed before any stop was attempted."
fi
PRE_STOP_COUNT="$(printf '%s' "${PRE_STOP_RESOURCES}" | grep -c . || true)"
echo "Docker residual enumeration: available (${PRE_STOP_COUNT} pre-stop row(s) for ${PROJECT_ID})"

# Validated before dry-run handling, so a dry run performs the full check and a
# real run cannot reach `supabase stop` on an inventory that failed it.
if ! validate_owned_inventory "${PRE_STOP_RESOURCES}"; then
  retention_notice >&2
  die "Refusing to stop ${PROJECT_ID}: its live Docker inventory is not an exact, exclusively owned match."
fi
echo "Pre-stop ownership validation: every present resource is canonical for its kind and carries ${PROJECT_LABEL}."

if [[ "${DRY_RUN}" == true ]]; then
  echo "Dry run: no containers, volumes, networks, or files were changed."
  if [[ "${DELETE_WORKDIR}" == true ]]; then
    echo "Dry run: ${WORK_DIR} would be deleted only after the stack stopped AND"
    echo "         exact-name and exact-label container/volume/network residual proof succeeded."
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

# Residual proof. Only a complete, successful pass through every check below may
# set this, and only this may authorize deletion.
RESIDUAL_PROOF_COMPLETE=false

# Residual checks use the same union the launcher uses: the pinned exact names
# for this project plus the exact project label. A resource whose label was
# lost still holds the replayed database, so a label-only check would miss it.
if ! RESIDUAL_RESOURCES="$(collect_project_resources)"; then
  retention_notice >&2
  die "Could not enumerate Docker resources for ${PROJECT_ID} after stopping it."
fi
if [[ -n "${RESIDUAL_RESOURCES}" ]]; then
  printf '%s\n' "${RESIDUAL_RESOURCES}" >&2
  retention_notice >&2
  die "Supabase reported success, but isolated resources still remain for ${PROJECT_ID}."
fi
if [[ -n "${MARKER_DB_VOLUME}" ]] && docker volume inspect "${MARKER_DB_VOLUME}" >/dev/null 2>&1; then
  retention_notice >&2
  die "Supabase reported success, but the recorded database volume ${MARKER_DB_VOLUME} still exists."
fi
RESIDUAL_PROOF_COMPLETE=true
echo "Docker residual proof: no container, volume, or network remains for ${PROJECT_ID}."

if [[ "${DELETE_WORKDIR}" == true ]]; then
  # Deliberately re-checked rather than assumed: deletion authority must be
  # unreachable on any path that did not complete the proof above.
  if [[ "${RESIDUAL_PROOF_COMPLETE}" != true ]]; then
    retention_notice >&2
    die "Refusing --delete-workdir without completed Docker residual proof for ${PROJECT_ID}."
  fi
  rm -rf -- "${WORK_DIR}"
  echo "Deleted isolated work directory: ${WORK_DIR}"
else
  retention_notice
fi

echo "Stopped isolated Supabase project: ${PROJECT_ID}"
