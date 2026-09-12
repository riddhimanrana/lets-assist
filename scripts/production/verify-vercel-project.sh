#!/usr/bin/env bash

set -euo pipefail

for variable in EXPECTED_GITHUB_REPOSITORY_ID VERCEL_TOKEN VERCEL_TEAM_ID VERCEL_ROOT_PROJECT_ID; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required to verify the Production Vercel project." >&2
    exit 1
  fi
done

if [[ ! "${EXPECTED_GITHUB_REPOSITORY_ID}" =~ ^[1-9][0-9]*$ ]]; then
  echo "EXPECTED_GITHUB_REPOSITORY_ID must be a numeric GitHub repository id." >&2
  exit 1
fi

response_file="$(mktemp)"
trap 'rm -f "${response_file}"' EXIT

request_endpoint() {
  local endpoint_label="$1"
  local endpoint_url="$2"
  local http_status
  local provider_error_code

  : >"${response_file}"
  if ! http_status="$(curl --silent --output "${response_file}" --write-out '%{http_code}' \
    --connect-timeout 10 \
    --max-time 20 \
    --header "Authorization: Bearer ${VERCEL_TOKEN}" \
    "${endpoint_url}" 2>/dev/null)"; then
    echo "Vercel API endpoint=${endpoint_label} status=network-error" >&2
    exit 1
  fi

  if [[ ! "${http_status}" =~ ^[0-9]{3}$ ]]; then
    echo "Vercel API endpoint=${endpoint_label} status=invalid" >&2
    exit 1
  fi

  if [[ "${http_status}" -lt 200 || "${http_status}" -ge 300 ]]; then
    provider_error_code="$(jq -er '.error.code | strings' "${response_file}" 2>/dev/null || true)"
    case "${provider_error_code}" in
      forbidden | unauthorized | invalid_token | token_expired | not_found | missing_scope | insufficient_permissions) ;;
      *) provider_error_code="unrecognized" ;;
    esac
    echo "Vercel API endpoint=${endpoint_label} status=${http_status} error.code=${provider_error_code}" >&2
    exit 1
  fi

  echo "Vercel API endpoint=${endpoint_label} status=${http_status}" >&2
  response_payload="$(<"${response_file}")"
  if ! jq -e . >/dev/null 2>&1 <<<"${response_payload}"; then
    echo "Vercel API endpoint=${endpoint_label} response=malformed-json" >&2
    exit 1
  fi
}

request_endpoint \
  "project" \
  "https://api.vercel.com/v9/projects/${VERCEL_ROOT_PROJECT_ID}?teamId=${VERCEL_TEAM_ID}"
project_payload="${response_payload}"

request_endpoint \
  "rolling-release-config" \
  "https://api.vercel.com/v1/projects/${VERCEL_ROOT_PROJECT_ID}/rolling-release/config?teamId=${VERCEL_TEAM_ID}"
rolling_release_config_payload="${response_payload}"

request_endpoint \
  "rolling-release-state" \
  "https://api.vercel.com/v1/projects/${VERCEL_ROOT_PROJECT_ID}/rolling-release?teamId=${VERCEL_TEAM_ID}"
rolling_release_payload="${response_payload}"

jq -e \
  --arg project "${VERCEL_ROOT_PROJECT_ID}" \
  --arg repository_id "${EXPECTED_GITHUB_REPOSITORY_ID}" \
  --arg team "${VERCEL_TEAM_ID}" \
  '.id == $project
   and .accountId == $team
   and .link.type == "github"
   and ((.link.repoId | tostring) == $repository_id)
   and .link.productionBranch == "main"
   and .autoExposeSystemEnvs == true' \
  <<<"${project_payload}" >/dev/null || {
  echo "The configured Vercel project, GitHub binding, Production Branch, or System Environment Variables setting is invalid." >&2
  exit 1
}

jq -e \
  'type == "object" and has("rollingRelease") and .rollingRelease == null' \
  <<<"${rolling_release_config_payload}" >/dev/null || {
  echo "Vercel Rolling Releases must be disabled before a Production cutover." >&2
  exit 1
}

jq -e \
  'type == "object"
   and has("rollingRelease")
   and ((.rollingRelease == null) or (.rollingRelease.state == "ABORTED") or (.rollingRelease.state == "COMPLETE"))' \
  <<<"${rolling_release_payload}" >/dev/null || {
  echo "An active Vercel Rolling Release blocks the Production cutover." >&2
  exit 1
}
