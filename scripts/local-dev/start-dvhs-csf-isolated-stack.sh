#!/usr/bin/env bash

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=require-supabase-cli-version.sh
source "${SCRIPT_DIR}/require-supabase-cli-version.sh"
require_supabase_cli_version

fail() {
  echo "$1" >&2
  exit 1
}

# A genuinely new database volume is the only thing that makes the Supabase CLI
# rerun SetupLocalDatabase -> apply.MigrateAndSeed, so every identity below is
# derived from RUN_ID and must be unique. Keep it inside the 1-16 character
# contract (the CLI silently truncates project labels past 40 characters) while
# staying collision-resistant across concurrent CI jobs.
generate_run_id() {
  local suffix
  suffix="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(7).toString("hex"));')"
  if [[ ! "${suffix}" =~ ^[0-9a-f]{14}$ ]]; then
    echo "Failed to generate a collision-resistant isolated run ID." >&2
    return 1
  fi
  printf 'dv%s' "${suffix}"
}

RUN_ID="${CSF_ISOLATED_RUN_ID:-$(generate_run_id)}"
if [[ ! "${RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$ ]]; then
  fail "CSF_ISOLATED_RUN_ID must contain only 1-16 letters, numbers, dots, underscores, or hyphens."
fi
PROJECT_ID="lets-assist-csf-browser-${RUN_ID}"
WORK_DIR="${CSF_ISOLATED_WORK_DIR:-${TMPDIR:-/tmp}/${PROJECT_ID}}"
# The DVHS CSF recovery topology: app 3000, isolated Supabase base 55320
# (API 55321, DB 55322, Studio 55323, Mailpit UI 55324, SMTP 55325, edge
# inspector 55326, analytics 55327, pooler 55329). An explicit
# CSF_ISOLATED_BASE_PORT still wins, and the allocator below still refuses a
# collision rather than sharing a bundle with another stack.
BASE_PORT="${CSF_ISOLATED_BASE_PORT:-55320}"
if [[ ! "${BASE_PORT}" =~ ^[0-9]+$ ]] || ((BASE_PORT < 1024 || BASE_PORT > 65526)); then
  fail "CSF_ISOLATED_BASE_PORT must be an integer between 1024 and 65526."
fi

# Logflare analytics is not part of the CSF product/runtime contract. Keep it
# enabled by default for parity with the root Supabase config, but allow an
# explicit local-only recovery run to omit that optional container when Docker
# cannot keep it healthy. The analytics port remains claimed with the bundle so
# a second stack can never move into the reserved topology while this run lives.
CSF_ISOLATED_ANALYTICS_MODE="${CSF_ISOLATED_ANALYTICS_MODE:-enabled}"
case "${CSF_ISOLATED_ANALYTICS_MODE}" in
  enabled) ;;
  disabled) ;;
  *) fail "CSF_ISOLATED_ANALYTICS_MODE must be exactly enabled or disabled." ;;
esac

# The exact bundle this launcher writes into the generated config.toml.
PORT_OFFSETS=(0 1 2 3 4 5 6 7 9)
# The app port is fixed independently and is deliberately not a base-relative
# offset: the isolated Supabase bundle and the isolated app are separate
# resources, and deriving one from the other would move the app whenever the base
# moved. It is preflighted below, before the first mutation of any kind.
APP_PORT=3000
PROJECT_LABEL_KEY="com.supabase.cli.project"
PROJECT_LABEL="${PROJECT_LABEL_KEY}=${PROJECT_ID}"
DB_VOLUME_NAME="supabase_db_${PROJECT_ID}"

ENV_FILE="${WORK_DIR}/supabase-browser.env"
APP_ENV_FILE="${WORK_DIR}/lets-assist-browser.sh"
START_LOG="${WORK_DIR}/supabase-start.log"
MARKER_FILE="${WORK_DIR}/.lets-assist-csf-isolated-stack"
PROFILE_CLAIM_SECRET_FILE="${WORK_DIR}/csf-profile-claim-secret"

# The allocator must be global for this user. It is deliberately not derived from
# TMPDIR: two shells with different TMPDIR values still have to contend for the
# same project ID and the same host ports. The override below exists only so
# hermetic tests can contend inside their own sandbox, and it must be requested
# explicitly.
CLAIM_ROOT="/tmp/lets-assist-csf-isolated-claims-$(id -u)"
if [[ -n "${CSF_ISOLATED_CLAIM_ROOT:-}" ]]; then
  if [[ "${CSF_ISOLATED_TEST_CLAIM_ROOT:-}" != "hermetic-test" ]]; then
    fail "CSF_ISOLATED_CLAIM_ROOT is a test-only override; it requires CSF_ISOLATED_TEST_CLAIM_ROOT=hermetic-test."
  fi
  CLAIM_ROOT="${CSF_ISOLATED_CLAIM_ROOT}"
  echo "WARNING: using the test-only isolated claim root ${CLAIM_ROOT}." >&2
fi
ALLOCATOR_LOCK="${CLAIM_ROOT}/allocator.lock"
PROJECT_CLAIM="${CLAIM_ROOT}/project-${PROJECT_ID}"
CLAIM_RECOVERY_FILE="${PROJECT_CLAIM}/recovery"

PROJECT_CLAIM_HELD=false
PORT_CLAIMS_HELD=false
ALLOCATOR_LOCK_HELD=false
WORK_DIR_CREATED=false
START_ATTEMPTED=false
STACK_READY=false
CLEANUP_ATTEMPTED=false
PORT_CLAIMS=()
RETAINED_CLAIMS=""
RECORDED_DB_VOLUME=""
RECORDED_DB_VOLUME_LABEL=""

assert_private_directory() {
  if ! node - "$1" <<'NODE'; then
const { lstatSync } = require("node:fs");
const target = process.argv[2];
const stats = lstatSync(target);
if (stats.isSymbolicLink()) throw new Error(`Refusing a symlinked path: ${target}`);
if (!stats.isDirectory()) throw new Error(`Refusing a non-directory path: ${target}`);
if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
  throw new Error(`Refusing a directory owned by another user: ${target}`);
}
if ((stats.mode & 0o077) !== 0) {
  throw new Error(`Refusing a group/world-accessible directory: ${target}`);
}
NODE
    fail "Unsafe isolated directory posture: $1"
  fi
}

# Check the exact loopback endpoint the isolated services will bind. `lsof -i`
# still walks mounted filesystems on macOS and can block indefinitely on an
# unavailable Time Machine/SMB volume, even though this check only cares about a
# TCP listener. A short-lived bind is both narrower and independent of unrelated
# mounts. The lsof branch is reachable only from the existing hermetic launcher
# harness, where the executable is a test fake and no socket access is allowed.
probe_loopback_port() {
  local port="$1"
  local probe_status=0

  if [[ "${CSF_ISOLATED_TEST_CLAIM_ROOT:-}" == "hermetic-test" ]]; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1 || probe_status=$?
    case "${probe_status}" in
      0) return 1 ;;
      1) return 0 ;;
      *) return 2 ;;
    esac
  fi

  node - "${port}" <<'NODE'
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

assert_loopback_port_free() {
  local port="$1"
  local occupied_message="$2"
  local probe_status=0

  probe_loopback_port "${port}" || probe_status=$?
  case "${probe_status}" in
    0) return 0 ;;
    1) fail "${occupied_message}" ;;
    *) fail "Could not verify whether loopback port ${port} is available; refusing to start." ;;
  esac
}

# One pinned, test-owned contract of exact names for Supabase CLI 2.111.0, typed
# by Docker resource kind and shared with the stop script. Exact names only:
# `supabase_*_<project>` style globs both miss real CLI resources
# (realtime-dev.supabase_realtime_<project>) and would accept an unexpected
# third-party name that merely looks like ours. The kinds are separate because
# Docker namespaces names per kind: a volume named like the canonical Kong
# container is not ours and must never satisfy the ownership proof.
if ! CANONICAL_CONTAINER_NAMES="$(node "${SCRIPT_DIR}/dv-local-env.mjs" --canonical-docker-names container "${PROJECT_ID}")"; then
  fail "Unable to derive the pinned canonical Docker container names for ${PROJECT_ID}."
fi
if ! CANONICAL_VOLUME_NAMES="$(node "${SCRIPT_DIR}/dv-local-env.mjs" --canonical-docker-names volume "${PROJECT_ID}")"; then
  fail "Unable to derive the pinned canonical Docker volume names for ${PROJECT_ID}."
fi
if ! CANONICAL_NETWORK_NAMES="$(node "${SCRIPT_DIR}/dv-local-env.mjs" --canonical-docker-names network "${PROJECT_ID}")"; then
  fail "Unable to derive the pinned canonical Docker network names for ${PROJECT_ID}."
fi

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

# ---------------------------------------------------------------------------
# Atomic project and port-bundle ownership
#
# Two launches must never share a derived Docker project ID or any port in the
# derived bundle, even when they pass different explicit work directories. Each
# claim is one atomic `mkdir` (never `mkdir -p`), acquired before the work
# directory exists, before the read-only Docker preflight, and before
# `supabase start`. The whole bundle is acquired inside one globally serialized
# allocator boundary so a partial bundle can never be observed by a peer.
# ---------------------------------------------------------------------------

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

# Read-only enumeration only: this never deletes, prunes, or adopts a resource.
# It reports the union of (a) the pinned exact names for this project and (b)
# resources carrying the exact project label, so a canonical name with a missing
# or wrong label and a labeled resource with an unexpected name both surface.
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

acquire_allocator_lock() {
  local attempt
  for attempt in $(seq 1 300); do
    if mkdir "${ALLOCATOR_LOCK}" 2>/dev/null; then
      ALLOCATOR_LOCK_HELD=true
      if ! printf '%s\n' "$$" >"${ALLOCATOR_LOCK}/owner-pid"; then
        echo "Failed to record the allocator lock owner pid in ${ALLOCATOR_LOCK}." >&2
      fi
      return 0
    fi
    sleep 0.1
  done
  echo "Timed out waiting for the isolated port allocator lock at ${ALLOCATOR_LOCK}." >&2
  echo "Remove it only after confirming no isolated launcher is running." >&2
  return 1
}

release_allocator_lock() {
  if [[ "${ALLOCATOR_LOCK_HELD}" != true ]]; then
    return 0
  fi
  if [[ -f "${ALLOCATOR_LOCK}/owner-pid" ]]; then
    rm -f -- "${ALLOCATOR_LOCK}/owner-pid"
  fi
  if ! rmdir "${ALLOCATOR_LOCK}"; then
    echo "Failed to release the isolated port allocator lock ${ALLOCATOR_LOCK}." >&2
    return 1
  fi
  ALLOCATOR_LOCK_HELD=false
  return 0
}

# Returns 0 when the whole bundle is owned, 1 when a conflicting peer owns part
# of it and the partial claim was fully rolled back, and 2 when the rollback
# itself failed and this launch still owns recoverable claims.
claim_port_bundle() {
  local offset port claim index rollback_failed=0
  local acquired=()

  for offset in "${PORT_OFFSETS[@]}"; do
    port=$((BASE_PORT + offset))
    claim="${CLAIM_ROOT}/port-${port}"
    if mkdir "${claim}" 2>/dev/null; then
      acquired[${#acquired[@]}]="${claim}"
      continue
    fi

    echo "Port ${port} is already claimed by another isolated launch; choose another CSF_ISOLATED_BASE_PORT." >&2
    if ((${#acquired[@]} > 0)); then
      # Roll the partial bundle back so an overlapping peer bundle is not blocked
      # by ports this launch never owned. Every release is checked.
      RETAINED_CLAIMS=""
      for index in "${acquired[@]}"; do
        if ! rmdir "${index}"; then
          echo "Failed to roll back the partial isolated port claim ${index}." >&2
          RETAINED_CLAIMS="${RETAINED_CLAIMS}${index}"$'\n'
          rollback_failed=1
        fi
      done
      if ((rollback_failed != 0)); then
        PORT_CLAIMS=("${acquired[@]}")
        return 2
      fi
    fi
    return 1
  done

  PORT_CLAIMS=("${acquired[@]}")
  return 0
}

release_claims() {
  local claim failed=0 remaining=""

  if [[ "${PORT_CLAIMS_HELD}" == true ]]; then
    if ((${#PORT_CLAIMS[@]} > 0)); then
      for claim in "${PORT_CLAIMS[@]}"; do
        if [[ ! -d "${claim}" ]]; then
          continue
        fi
        if rmdir "${claim}"; then
          continue
        fi
        echo "Failed to release the isolated port claim ${claim}." >&2
        remaining="${remaining}${claim}"$'\n'
        failed=1
      done
    fi
    if ((failed == 0)); then
      PORT_CLAIMS_HELD=false
    fi
  fi

  # A port that could not be released keeps this identity owned: the project
  # claim stays so no peer can adopt the ports that are still ours.
  if ((failed != 0)); then
    RETAINED_CLAIMS="${remaining}${PROJECT_CLAIM}"$'\n'
    return 1
  fi

  if [[ "${PROJECT_CLAIM_HELD}" == true ]]; then
    if ! rmdir "${PROJECT_CLAIM}"; then
      echo "Failed to release the isolated project claim ${PROJECT_CLAIM}." >&2
      RETAINED_CLAIMS="${PROJECT_CLAIM}"$'\n'
      return 1
    fi
    PROJECT_CLAIM_HELD=false
  fi

  return 0
}

retain_claims() {
  local reason="$1"

  if [[ "${PROJECT_CLAIM_HELD}" != true ]]; then
    return 0
  fi
  if [[ -z "${RETAINED_CLAIMS}" ]]; then
    RETAINED_CLAIMS="${PROJECT_CLAIM}"$'\n'
    local claim
    if ((${#PORT_CLAIMS[@]} > 0)) && [[ "${PORT_CLAIMS_HELD}" == true ]]; then
      for claim in "${PORT_CLAIMS[@]}"; do
        if [[ -d "${claim}" ]]; then
          RETAINED_CLAIMS="${RETAINED_CLAIMS}${claim}"$'\n'
        fi
      done
    fi
  fi
  if ! {
    printf 'project_id=%s\n' "${PROJECT_ID}"
    printf 'base_port=%s\n' "${BASE_PORT}"
    printf 'work_dir=%s\n' "${WORK_DIR}"
    printf 'reason=%s\n' "${reason}"
    printf 'retained_claims=%s\n' "$(printf '%s' "${RETAINED_CLAIMS}" | tr '\n' ' ')"
  } >"${CLAIM_RECOVERY_FILE}"; then
    echo "Failed to write the isolated claim recovery marker ${CLAIM_RECOVERY_FILE}." >&2
  fi
  echo "Retained these exact isolated claims because cleanup could not prove the namespace clean:" >&2
  printf '%s' "${RETAINED_CLAIMS}" >&2
  echo "Recovery marker: ${CLAIM_RECOVERY_FILE}" >&2
  echo "No other launch may adopt this identity until the leftover resources are reviewed." >&2
}

# ---------------------------------------------------------------------------
# Ownership marker and bounded cleanup
# ---------------------------------------------------------------------------

# Atomic marker writes: an owner-only temp file in the same directory, then one
# rename. A reader never observes a half-written marker.
write_marker() {
  local state="$1"
  local temp_marker="${MARKER_FILE}.tmp.$$"

  {
    printf 'state=%s\n' "${state}"
    printf 'project_id=%s\n' "${PROJECT_ID}"
    printf 'base_port=%s\n' "${BASE_PORT}"
    printf 'work_dir=%s\n' "${WORK_DIR}"
    if [[ -n "${RECORDED_DB_VOLUME}" ]]; then
      printf 'db_volume=%s\n' "${RECORDED_DB_VOLUME}"
      printf 'db_volume_project_label=%s\n' "${RECORDED_DB_VOLUME_LABEL}"
    fi
  } >"${temp_marker}"
  chmod 600 "${temp_marker}"
  mv -f "${temp_marker}" "${MARKER_FILE}"
}

stop_owned_stack() {
  local marker_project_id failed=0 leftovers

  if [[ ! -f "${MARKER_FILE}" ]]; then
    echo "Refusing cleanup without this launcher's own ownership marker ${MARKER_FILE}." >&2
    return 1
  fi
  marker_project_id="$(sed -nE 's/^project_id=(.+)$/\1/p' "${MARKER_FILE}")"
  if [[ "${marker_project_id}" != "${PROJECT_ID}" ]]; then
    echo "Refusing cleanup: marker project ${marker_project_id} does not match ${PROJECT_ID}." >&2
    return 1
  fi

  # Both selectors are intentional: --workdir loads only this generated config
  # and --project-id bounds Docker cleanup to the same validated project label.
  if ! supabase stop \
    --workdir "${WORK_DIR}" \
    --project-id "${PROJECT_ID}" \
    --no-backup \
    --yes >>"${START_LOG}" 2>&1; then
    echo "Bounded cleanup failed: supabase stop returned nonzero for ${PROJECT_ID} (see ${START_LOG})." >&2
    failed=1
  fi

  # Residual checks use the same exact-name-or-label union, so a resource whose
  # label was lost is still caught by its canonical name.
  if ! leftovers="$(collect_project_resources)"; then
    echo "Bounded cleanup could not enumerate Docker resources for ${PROJECT_ID}." >&2
    return 1
  fi
  if [[ -n "${leftovers}" ]]; then
    echo "Bounded cleanup left Docker resources for ${PROJECT_ID}:" >&2
    printf '%s\n' "${leftovers}" >&2
    failed=1
  fi

  return "${failed}"
}

on_exit() {
  local status=$?
  local cleanup_status=0

  # Capture the primary status first, then disable recursive traps so cleanup is
  # attempted exactly once and the final status is chosen deterministically.
  trap - EXIT HUP INT TERM

  if [[ "${STACK_READY}" == true || "${CLEANUP_ATTEMPTED}" == true ]]; then
    exit "${status}"
  fi
  CLEANUP_ATTEMPTED=true

  if ((status == 0)); then
    echo "Isolated stack never reached its ready marker; failing closed." >&2
    status=1
  fi

  if ! release_allocator_lock; then
    cleanup_status=1
  fi

  # Anything already started stays owned here: stop it exactly once, then prove
  # the namespace clean before any claim is released.
  if [[ "${START_ATTEMPTED}" == true ]]; then
    if ! stop_owned_stack; then
      cleanup_status=1
    fi
  fi

  if ((cleanup_status == 0)); then
    if ! release_claims; then
      cleanup_status=1
    fi
  fi
  if ((cleanup_status != 0)); then
    retain_claims "startup or post-start validation failed and cleanup could not prove the project namespace clean"
  fi

  if [[ "${WORK_DIR_CREATED}" == true ]]; then
    echo "Isolated stack startup failed. Its temporary files remain at ${WORK_DIR}." >&2
  fi
  if ((cleanup_status != 0)); then
    echo "Isolated stack cleanup also failed; primary status ${status} is preserved." >&2
    echo "Stop it explicitly with scripts/local-dev/stop-dvhs-csf-isolated-stack.sh '${WORK_DIR}'." >&2
  fi

  exit "${status}"
}
trap on_exit EXIT
trap 'exit 130' HUP INT
trap 'exit 143' TERM

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  fail "The isolated launcher requires the docker CLI to prove project ${PROJECT_ID} is unused."
fi

# ---------------------------------------------------------------------------
# Fixed app port 3000 — checked first, before any persistent mutation.
#
# This runs ahead of the claim root, the project claim, the port bundle, the work
# directory, and `supabase start`. A stack whose app port is already taken is a
# stack that cannot be driven, and discovering that after Docker has a database
# volume means tearing the whole thing down again. It is also independent of the
# Supabase bundle on purpose: 3000 is never one of the base-relative offsets.
# ---------------------------------------------------------------------------
for offset in "${PORT_OFFSETS[@]}"; do
  if ((BASE_PORT + offset == APP_PORT)); then
    fail "CSF_ISOLATED_BASE_PORT ${BASE_PORT} would place a Supabase service on the fixed app port ${APP_PORT}."
  fi
done
assert_loopback_port_free \
  "${APP_PORT}" \
  "The fixed isolated app port ${APP_PORT} is already in use; free it before starting the isolated stack."

# Fail before any claim when the caller pointed at an existing directory.
if [[ -e "${WORK_DIR}" || -L "${WORK_DIR}" ]]; then
  fail "Isolated work directory already exists: ${WORK_DIR}"
fi
WORK_DIR_PARENT="$(dirname "${WORK_DIR}")"
if [[ ! -d "${WORK_DIR_PARENT}" ]]; then
  fail "Isolated work directory parent does not exist: ${WORK_DIR_PARENT}"
fi

if ! mkdir -p "${CLAIM_ROOT}"; then
  fail "Unable to create the isolated claim root: ${CLAIM_ROOT}"
fi
assert_private_directory "${CLAIM_ROOT}"

if ! mkdir "${PROJECT_CLAIM}" 2>/dev/null; then
  echo "Another isolated launch already owns project ${PROJECT_ID}." >&2
  echo "Claim directory: ${PROJECT_CLAIM}" >&2
  exit 1
fi
PROJECT_CLAIM_HELD=true
assert_private_directory "${PROJECT_CLAIM}"

if ! acquire_allocator_lock; then
  exit 1
fi
PORT_CLAIM_STATUS=0
claim_port_bundle || PORT_CLAIM_STATUS=$?
if ((PORT_CLAIM_STATUS == 0)); then
  PORT_CLAIMS_HELD=true
elif ((PORT_CLAIM_STATUS == 2)); then
  PORT_CLAIMS_HELD=true
fi
if ! release_allocator_lock; then
  exit 1
fi
if ((PORT_CLAIM_STATUS != 0)); then
  exit 1
fi

if ! PREFLIGHT_RESOURCES="$(collect_project_resources)"; then
  fail "Read-only Docker preflight failed for project ${PROJECT_ID}; refusing to start."
fi
if [[ -n "${PREFLIGHT_RESOURCES}" ]]; then
  echo "Refusing to start: Docker already holds resources for project ${PROJECT_ID}." >&2
  printf '%s\n' "${PREFLIGHT_RESOURCES}" >&2
  echo "A pre-existing ${DB_VOLUME_NAME} is not fresh-replay evidence and is never adopted or deleted here." >&2
  exit 1
fi

for offset in "${PORT_OFFSETS[@]}"; do
  port=$((BASE_PORT + offset))
  assert_loopback_port_free \
    "${port}" \
    "Port ${port} is already in use; choose another CSF_ISOLATED_BASE_PORT."
done

# ---------------------------------------------------------------------------
# Generated workdir
# ---------------------------------------------------------------------------

# Atomic: plain mkdir fails closed against a concurrent launch, an existing
# directory, or a symlink planted at this exact pathname.
if ! mkdir "${WORK_DIR}"; then
  fail "Unable to atomically create the isolated work directory: ${WORK_DIR}"
fi
WORK_DIR_CREATED=true
assert_private_directory "${WORK_DIR}"

rsync -a \
  --exclude '.temp' \
  --exclude '.branches' \
  --exclude '.env*' \
  supabase/ "${WORK_DIR}/supabase/"
chmod -R go-rwx "${WORK_DIR}"

node - "${WORK_DIR}/supabase/config.toml" "${PROJECT_ID}" "${BASE_PORT}" "${CSF_ISOLATED_ANALYTICS_MODE}" <<'NODE'
const fs = require("node:fs");
const [path, projectId, rawBase, analyticsMode] = process.argv.slice(2);
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

if (analyticsMode === "disabled") {
  const analyticsSections = [...source.matchAll(/^\[analytics\][ \t]*$/gmu)];
  if (analyticsSections.length !== 1) {
    throw new Error(`Expected exactly one [analytics] section, found ${analyticsSections.length}.`);
  }
  const analyticsHeader = analyticsSections[0];
  const analyticsBodyStart = analyticsHeader.index + analyticsHeader[0].length;
  const afterAnalyticsHeader = source.slice(analyticsBodyStart);
  const nextAnalyticsSection = /^[ \t]*\[/mu.exec(afterAnalyticsHeader);
  const analyticsBodyEnd = nextAnalyticsSection
    ? analyticsBodyStart + nextAnalyticsSection.index
    : source.length;
  const analyticsBody = source.slice(analyticsBodyStart, analyticsBodyEnd);
  const enabledTokens = analyticsBody.match(/^enabled = true[ \t]*$/gmu) ?? [];
  if (enabledTokens.length !== 1) {
    throw new Error(
      `Expected exactly one enabled = true token in [analytics], found ${enabledTokens.length}.`,
    );
  }
  source =
    source.slice(0, analyticsBodyStart) +
    analyticsBody.replace(/^enabled = true[ \t]*$/mu, "enabled = false") +
    source.slice(analyticsBodyEnd);
}

// ---------------------------------------------------------------------------
// Provider-disabled by construction.
//
// The copied root config enables Google and points client_id/secret/redirect_uri
// at `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_*)`. Left alone, a generated isolated
// stack would resolve those against whatever the operator's shell exports, which
// is a real provider credential on a runtime whose entire premise is that it
// touches nothing real. Replace exactly that one block with literal empty
// values; no ambient value is read here, and nothing is copied.
//
// This must match CSF_DISABLED_GOOGLE_AUTH_BLOCK in dv-local-env.mjs, which is
// what re-validates the written file. scripts/local-dev/dv-local-env.test.ts
// asserts the two agree, so a change here that is not made there fails closed.
// ---------------------------------------------------------------------------
const DISABLED_GOOGLE_AUTH_BLOCK = [
  "[auth.external.google]",
  "enabled = false",
  'client_id = ""',
  'secret = ""',
  'redirect_uri = ""',
  "skip_nonce_check = false",
].join("\n");

const googleSections = [...source.matchAll(/^\[auth\.external\.google\][ \t]*$/gmu)];
if (googleSections.length !== 1) {
  throw new Error(
    `Expected exactly one [auth.external.google] section, found ${googleSections.length}.`,
  );
}
const googleHeader = googleSections[0];
const afterHeader = source.slice(googleHeader.index + googleHeader[0].length);
const nextSection = /^[ \t]*\[/mu.exec(afterHeader);
if (!nextSection) {
  throw new Error(
    "[auth.external.google] is not followed by another section; refusing an unbounded rewrite.",
  );
}
source =
  source.slice(0, googleHeader.index) +
  DISABLED_GOOGLE_AUTH_BLOCK +
  "\n\n" +
  afterHeader.slice(nextSection.index);

if (source.includes("SUPABASE_AUTH_EXTERNAL_GOOGLE")) {
  throw new Error(
    "Generated isolated config still references SUPABASE_AUTH_EXTERNAL_GOOGLE_*; refusing to write it.",
  );
}

fs.writeFileSync(path, source);
NODE

node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"));' \
  >"${PROFILE_CLAIM_SECRET_FILE}"
chmod 600 "${PROFILE_CLAIM_SECRET_FILE}"

# Transitional marker: this launcher owns cleanup until the exact database
# volume is recorded and the marker is promoted to ready.
write_marker starting

# ---------------------------------------------------------------------------
# One start, then exact database-volume identity
# ---------------------------------------------------------------------------

START_ATTEMPTED=true
run_supabase_start() {
  if [[ "${CSF_ISOLATED_ANALYTICS_MODE}" == "disabled" ]]; then
    supabase start --workdir "${WORK_DIR}" --exclude analytics --yes
  else
    supabase start --workdir "${WORK_DIR}" --yes
  fi
}
if ! run_supabase_start >"${START_LOG}" 2>&1; then
  fail "supabase start failed for isolated project ${PROJECT_ID}; see ${START_LOG}."
fi
supabase status --workdir "${WORK_DIR}" -o env >"${ENV_FILE}" 2>>"${START_LOG}"
chmod 600 "${ENV_FILE}" "${START_LOG}"

# Every project-labeled resource must belong to the pinned allowlist for its own
# kind. A labeled volume named like a canonical container, or a labeled container
# named like a canonical volume, is ambiguity rather than ownership proof.
assert_labeled_kind_is_canonical() {
  local kind="$1" labeled="$2"
  local allowlist name unexpected=""

  allowlist="$(canonical_names_for_kind "${kind}")" || return 1
  while IFS= read -r name; do
    if [[ -z "${name}" ]]; then
      continue
    fi
    if ! printf '%s\n' "${allowlist}" | grep -Fxq -- "${name}"; then
      unexpected="${unexpected}${name}"$'\n'
    fi
  done <<LABELED_RESOURCES
${labeled}
LABELED_RESOURCES

  if [[ -n "${unexpected}" ]]; then
    echo "Ambiguous isolated ownership: ${kind}s carry label ${PROJECT_LABEL} under names outside the canonical ${kind} set:" >&2
    printf '%s' "${unexpected}" >&2
    return 1
  fi
  return 0
}

record_database_volume() {
  local labeled_containers labeled_volumes labeled_networks label

  labeled_containers="$(docker ps -a --filter "label=${PROJECT_LABEL}" --format '{{.Names}}' | tr ',' '\n')" || return 1
  labeled_volumes="$(docker volume ls --filter "label=${PROJECT_LABEL}" --format '{{.Name}}')" || return 1
  labeled_networks="$(docker network ls --filter "label=${PROJECT_LABEL}" --format '{{.Name}}')" || return 1

  assert_labeled_kind_is_canonical container "${labeled_containers}" || return 1
  assert_labeled_kind_is_canonical volume "${labeled_volumes}" || return 1
  assert_labeled_kind_is_canonical network "${labeled_networks}" || return 1

  # The database volume proof is bounded to the volume kind only.
  if ! printf '%s\n' "${labeled_volumes}" | grep -Fxq -- "${DB_VOLUME_NAME}"; then
    echo "Isolated project ${PROJECT_ID} has no labeled database volume ${DB_VOLUME_NAME} after start." >&2
    return 1
  fi
  if ! printf '%s\n' "${CANONICAL_VOLUME_NAMES}" | grep -Fxq -- "${DB_VOLUME_NAME}"; then
    echo "Database volume ${DB_VOLUME_NAME} is not in the canonical volume set." >&2
    return 1
  fi

  label="$(docker volume inspect --format "{{index .Labels \"${PROJECT_LABEL_KEY}\"}}" "${DB_VOLUME_NAME}")" || return 1
  if [[ "${label}" != "${PROJECT_ID}" ]]; then
    echo "Database volume ${DB_VOLUME_NAME} does not carry the exact label ${PROJECT_LABEL}." >&2
    return 1
  fi

  RECORDED_DB_VOLUME="${DB_VOLUME_NAME}"
  RECORDED_DB_VOLUME_LABEL="${label}"
  return 0
}

if ! record_database_volume; then
  fail "Refusing to record isolated ownership without exactly one labeled ${DB_VOLUME_NAME}."
fi

# ---------------------------------------------------------------------------
# Generated app environment
# ---------------------------------------------------------------------------

# Read the CLI status snapshot without executing it. `supabase status -o env`
# output is data, not a script, so no launch path sources it.
read_status_value() {
  local key="$1" value
  value="$(sed -nE "s/^${key}=\"?([^\"]*)\"?$/\1/p" "${ENV_FILE}")"
  if [[ -z "${value}" || "${value}" == *$'\n'* ]]; then
    echo "Isolated Supabase status did not report exactly one ${key}." >&2
    return 1
  fi
  printf '%s' "${value}"
}

API_URL="$(read_status_value API_URL)"
ANON_KEY="$(read_status_value ANON_KEY)"
SERVICE_ROLE_KEY="$(read_status_value SERVICE_ROLE_KEY)"
DB_URL="$(read_status_value DB_URL)"
PUBLISHABLE_KEY="$(read_status_value PUBLISHABLE_KEY)"
SECRET_KEY="$(read_status_value SECRET_KEY)"
CSF_PROFILE_CLAIM_SECRET="$(<"${PROFILE_CLAIM_SECRET_FILE}")"
if [[ ! "${CSF_PROFILE_CLAIM_SECRET}" =~ ^[a-f0-9]{64}$ ]]; then
  fail "Generated CSF profile-claim secret is invalid."
fi

# One exact grammar for the generated app environment: `export KEY='value'` with
# a value charset that cannot carry a command substitution, so the file can be
# validated and loaded without ever being executed.
emit_app_env_value() {
  local key="$1" value="$2"
  if [[ -z "${value}" ]]; then
    fail "Refusing to write an empty ${key} into ${APP_ENV_FILE}."
  fi
  if [[ ! "${value}" =~ ^[A-Za-z0-9._:/@%+~,=-]+$ ]]; then
    fail "Refusing to write ${key} with characters outside the isolated app-environment allowlist."
  fi
  printf "export %s='%s'\n" "${key}" "${value}"
}

{
  emit_app_env_value API_URL "${API_URL}"
  emit_app_env_value ANON_KEY "${ANON_KEY}"
  emit_app_env_value SERVICE_ROLE_KEY "${SERVICE_ROLE_KEY}"
  emit_app_env_value DB_URL "${DB_URL}"
  emit_app_env_value SUPABASE_URL "${API_URL}"
  emit_app_env_value SUPABASE_ANON_KEY "${ANON_KEY}"
  emit_app_env_value SUPABASE_DB_URL "${DB_URL}"
  emit_app_env_value NEXT_PUBLIC_SUPABASE_URL "${API_URL}"
  emit_app_env_value NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "${PUBLISHABLE_KEY}"
  emit_app_env_value NEXT_PUBLIC_SUPABASE_ANON_KEY "${ANON_KEY}"
  emit_app_env_value SUPABASE_SECRET_KEY "${SECRET_KEY}"
  emit_app_env_value SUPABASE_SERVICE_ROLE_KEY "${SERVICE_ROLE_KEY}"
  emit_app_env_value CSF_PROFILE_CLAIM_SECRET "${CSF_PROFILE_CLAIM_SECRET}"
  emit_app_env_value NEXT_PUBLIC_SITE_URL "http://localhost:3000"
  emit_app_env_value SITE_URL "http://localhost:3000"
  emit_app_env_value NEXT_PUBLIC_VERCEL_URL "localhost:3000"
  emit_app_env_value CSF_ISOLATED_WORK_DIR "${WORK_DIR}"
} >"${APP_ENV_FILE}"
chmod 600 "${APP_ENV_FILE}"

# Promote the transitional marker only now that the exact database volume is
# known, then prove marker, config, and app environment agree on one identity.
write_marker ready
if ! CSF_ISOLATED_WORK_DIR="${WORK_DIR}" node "${SCRIPT_DIR}/dv-local-env.mjs" --validate-app-env >/dev/null; then
  fail "Generated isolated marker, config, and app environment do not agree on one identity."
fi

# Only now can Docker make reuse fail closed: the read-only preflight refuses
# this project ID while ${DB_VOLUME_NAME} exists and the bundle ports are bound.
# The stack is not handed off until that release actually succeeds, so a failed
# release still runs this launcher's own bounded cleanup.
if ! release_claims; then
  fail "Isolated stack started, but its atomic claims could not be released; refusing to hand off an unowned stack."
fi
STACK_READY=true

echo "Isolated Let’s Assist Supabase is running."
echo "Project: ${PROJECT_ID}"
echo "Work directory: ${WORK_DIR}"
echo "Database volume: ${RECORDED_DB_VOLUME}"
echo "API: http://127.0.0.1:$((BASE_PORT + 1))"
echo "Status snapshot: ${ENV_FILE}"
echo "App environment: ${APP_ENV_FILE}"
echo "Startup log: ${START_LOG}"
echo "Optional local analytics: ${CSF_ISOLATED_ANALYTICS_MODE}"
echo "This new volume applied the current migrations and the configured SQL seed paths."
echo "Fictional platform/DV records still require bun run csf:seed:platform:isolated and bun run dv:fixtures."
echo "Load command: export CSF_ISOLATED_WORK_DIR='${WORK_DIR}', then read"
echo "  node scripts/local-dev/dv-local-env.mjs --print-app-env"
echo "  one KEY=VALUE line at a time (see scripts/local-dev/README.md). Never source or eval the file."
echo "App command: bun run dev  (owns port ${APP_PORT}, provider-disabled child environment)"
echo "Stop dry run: scripts/local-dev/stop-dvhs-csf-isolated-stack.sh --dry-run '${WORK_DIR}'"
echo "Stop command: scripts/local-dev/stop-dvhs-csf-isolated-stack.sh '${WORK_DIR}'"
