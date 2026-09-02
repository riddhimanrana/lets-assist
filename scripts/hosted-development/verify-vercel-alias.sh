#!/usr/bin/env bash

set -euo pipefail

development_alias="dev.lets-assist.com"
for variable in ACCEPTED_SHA EXPECTED_GITHUB_REPOSITORY_ID VERCEL_TOKEN VERCEL_TEAM_ID VERCEL_ROOT_PROJECT_ID; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required to verify hosted Development." >&2
    exit 1
  fi
done

if [[ ! "${ACCEPTED_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ACCEPTED_SHA must be a full lowercase commit SHA." >&2
  exit 1
fi
if [[ ! "${EXPECTED_GITHUB_REPOSITORY_ID}" =~ ^[1-9][0-9]*$ ]]; then
  echo "EXPECTED_GITHUB_REPOSITORY_ID must be a numeric GitHub repository id." >&2
  exit 1
fi

alias_payload="$(curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
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
  --connect-timeout 10 \
  --max-time 20 \
  --header "Authorization: Bearer ${VERCEL_TOKEN}" \
  "https://api.vercel.com/v13/deployments/${deployment_id}?withGitRepoInfo=true&teamId=${VERCEL_TEAM_ID}")"
jq -e \
  --arg alias "${development_alias}" \
  --arg project "${VERCEL_ROOT_PROJECT_ID}" \
  --arg repository_id "${EXPECTED_GITHUB_REPOSITORY_ID}" \
  --arg sha "${ACCEPTED_SHA}" \
  '(.target == "preview" or .target == null)
   and .readyState == "READY"
   and ((.aliasAssigned == true)
     or ((.aliasAssigned | type) == "number" and .aliasAssigned > 0))
   and ((.projectId // .project.id // "") == $project)
   and ((.alias // []) | index($alias) != null)
   and (.gitSource.type == "github")
   and ((.gitSource.repoId | tostring) == $repository_id)
   and (.gitSource.sha == $sha)
   and (.gitSource.ref == "development")' \
  <<<"${deployment_payload}" >/dev/null || {
  echo "The Development alias is not serving the exact accepted deployment." >&2
  exit 1
}
