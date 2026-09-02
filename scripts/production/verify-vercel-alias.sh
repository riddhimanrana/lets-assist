#!/usr/bin/env bash

set -euo pipefail

production_alias="lets-assist.com"
for variable in PRODUCTION_DEPLOYMENT_ID VERCEL_TOKEN VERCEL_TEAM_ID VERCEL_ROOT_PROJECT_ID; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required to verify the Production Vercel alias." >&2
    exit 1
  fi
done

if [[ ! "${PRODUCTION_DEPLOYMENT_ID}" =~ ^dpl_[A-Za-z0-9]+$ ]]; then
  echo "PRODUCTION_DEPLOYMENT_ID is malformed." >&2
  exit 1
fi

verification_timeout_seconds="${VERCEL_ALIAS_VERIFY_TIMEOUT_SECONDS:-180}"
connect_timeout_seconds="${VERCEL_ALIAS_CONNECT_TIMEOUT_SECONDS:-10}"
http_timeout_seconds="${VERCEL_ALIAS_HTTP_TIMEOUT_SECONDS:-20}"
if [[ ! "${verification_timeout_seconds}" =~ ^[0-9]+$ ]] ||
  ((verification_timeout_seconds < 5 || verification_timeout_seconds > 180)); then
  echo "VERCEL_ALIAS_VERIFY_TIMEOUT_SECONDS must be between 5 and 180." >&2
  exit 1
fi
if [[ ! "${connect_timeout_seconds}" =~ ^[0-9]+$ ]] ||
  ((connect_timeout_seconds < 1 || connect_timeout_seconds > 10)); then
  echo "VERCEL_ALIAS_CONNECT_TIMEOUT_SECONDS must be between 1 and 10." >&2
  exit 1
fi
if [[ ! "${http_timeout_seconds}" =~ ^[0-9]+$ ]] ||
  ((http_timeout_seconds < 1 || http_timeout_seconds > 20)); then
  echo "VERCEL_ALIAS_HTTP_TIMEOUT_SECONDS must be between 1 and 20." >&2
  exit 1
fi

verification_deadline=$((SECONDS + verification_timeout_seconds))
while ((SECONDS < verification_deadline)); do
  alias_payload=""
  deployment_payload=""
  if alias_payload="$(curl --fail --silent --show-error \
    --connect-timeout "${connect_timeout_seconds}" \
    --max-time "${http_timeout_seconds}" \
    --get \
    --header "Authorization: Bearer ${VERCEL_TOKEN}" \
    --data-urlencode "domain=${production_alias}" \
    --data-urlencode "projectId=${VERCEL_ROOT_PROJECT_ID}" \
    --data-urlencode "teamId=${VERCEL_TEAM_ID}" \
    https://api.vercel.com/v4/aliases)"; then
    resolved_deployment_id="$(jq -r \
      --arg alias "${production_alias}" \
      --arg project "${VERCEL_ROOT_PROJECT_ID}" \
      '[.aliases[]? | select(.alias == $alias and .projectId == $project)]
       | if length == 1 then .[0].deploymentId else "" end' \
      <<<"${alias_payload}")"
    if [[ "${resolved_deployment_id}" == "${PRODUCTION_DEPLOYMENT_ID}" ]] && \
      deployment_payload="$(curl --fail --silent --show-error \
        --connect-timeout "${connect_timeout_seconds}" \
        --max-time "${http_timeout_seconds}" \
        --header "Authorization: Bearer ${VERCEL_TOKEN}" \
        "https://api.vercel.com/v13/deployments/${PRODUCTION_DEPLOYMENT_ID}?teamId=${VERCEL_TEAM_ID}")" && \
      jq -e \
        --arg alias "${production_alias}" \
        --arg deployment "${PRODUCTION_DEPLOYMENT_ID}" \
        --arg project "${VERCEL_ROOT_PROJECT_ID}" \
        '.id == $deployment
         and .readyState == "READY"
         and .target == "production"
         and ((.aliasAssigned == true)
           or ((.aliasAssigned | type) == "number" and .aliasAssigned > 0))
         and ((.projectId // .project.id // "") == $project)
         and ((.alias // []) | index($alias) != null)' \
        <<<"${deployment_payload}" >/dev/null; then
      exit 0
    fi
  fi
  sleep 5
done

echo "The Production alias did not settle on the verified release deployment within ${verification_timeout_seconds} seconds." >&2
exit 1
