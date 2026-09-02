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

project_payload="$(curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --header "Authorization: Bearer ${VERCEL_TOKEN}" \
  "https://api.vercel.com/v9/projects/${VERCEL_ROOT_PROJECT_ID}?teamId=${VERCEL_TEAM_ID}")"

rolling_release_config_payload="$(curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --header "Authorization: Bearer ${VERCEL_TOKEN}" \
  "https://api.vercel.com/v1/projects/${VERCEL_ROOT_PROJECT_ID}/rolling-release/config?teamId=${VERCEL_TEAM_ID}")"

rolling_release_payload="$(curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --header "Authorization: Bearer ${VERCEL_TOKEN}" \
  "https://api.vercel.com/v1/projects/${VERCEL_ROOT_PROJECT_ID}/rolling-release?teamId=${VERCEL_TEAM_ID}")"

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

jq -e '.rollingRelease == null' <<<"${rolling_release_config_payload}" >/dev/null || {
  echo "Vercel Rolling Releases must be disabled before a Production cutover." >&2
  exit 1
}

jq -e \
  '(.rollingRelease == null) or (.rollingRelease.state == "ABORTED") or (.rollingRelease.state == "COMPLETE")' \
  <<<"${rolling_release_payload}" >/dev/null || {
  echo "An active Vercel Rolling Release blocks the Production cutover." >&2
  exit 1
}
