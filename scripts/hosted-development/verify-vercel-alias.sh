#!/usr/bin/env bash

set -euo pipefail

development_alias="dev.lets-assist.com"
for variable in ACCEPTED_SHA VERCEL_TOKEN VERCEL_TEAM_ID VERCEL_ROOT_PROJECT_ID; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required to verify hosted Development." >&2
    exit 1
  fi
done

if [[ ! "${ACCEPTED_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ACCEPTED_SHA must be a full lowercase commit SHA." >&2
  exit 1
fi

alias_payload="$(curl --fail --silent --show-error \
  --get \
  --header "Authorization: Bearer ${VERCEL_TOKEN}" \
  --data-urlencode "domain=${development_alias}" \
  --data-urlencode "projectId=${VERCEL_ROOT_PROJECT_ID}" \
  --data-urlencode "teamId=${VERCEL_TEAM_ID}" \
  https://api.vercel.com/v4/aliases)"
deployment_id="$(jq -er \
  --arg alias "${development_alias}" \
  --arg project "${VERCEL_ROOT_PROJECT_ID}" \
  '[.aliases[] | select(.alias == $alias and .projectId == $project)]
   | if length == 1 then .[0].deploymentId
     else error("Development alias did not resolve to one expected deployment")
     end' <<<"${alias_payload}")"

deployment_payload="$(curl --fail --silent --show-error \
  --header "Authorization: Bearer ${VERCEL_TOKEN}" \
  "https://api.vercel.com/v13/deployments/${deployment_id}?withGitRepoInfo=true&teamId=${VERCEL_TEAM_ID}")"
jq -e \
  --arg alias "${development_alias}" \
  --arg project "${VERCEL_ROOT_PROJECT_ID}" \
  --arg sha "${ACCEPTED_SHA}" \
  '.readyState == "READY"
   and ((.aliasAssigned == true)
     or ((.aliasAssigned | type) == "number" and .aliasAssigned > 0))
   and ((.projectId // .project.id // "") == $project)
   and ((.alias // []) | index($alias) != null)
   and ((.meta.githubCommitSha // .gitSource.sha // "") == $sha)
   and ((.meta.githubCommitRef // .gitSource.ref // "") == "development")' \
  <<<"${deployment_payload}" >/dev/null || {
  echo "The Development alias is not serving the exact accepted deployment." >&2
  exit 1
}
