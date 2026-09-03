#!/usr/bin/env bash

set -euo pipefail

development_domain="dev.lets-assist.com"
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

domain_payload="$(curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --header "Authorization: Bearer ${VERCEL_TOKEN}" \
  "https://api.vercel.com/v9/projects/${VERCEL_ROOT_PROJECT_ID}/domains?teamId=${VERCEL_TEAM_ID}")"
jq -e \
  --arg domain "${development_domain}" \
  --arg project "${VERCEL_ROOT_PROJECT_ID}" \
  '[.domains[]?
    | select(
        .name == $domain
        and .projectId == $project
        and .gitBranch == "development"
        and .verified == true
        and .redirect == null
      )]
   | length == 1' \
  <<<"${domain_payload}" >/dev/null || {
  echo "The Development domain is not assigned to the Development branch." >&2
  exit 1
}

deployments_payload="$(curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --get \
  --header "Authorization: Bearer ${VERCEL_TOKEN}" \
  --data-urlencode "projectId=${VERCEL_ROOT_PROJECT_ID}" \
  --data-urlencode "sha=${ACCEPTED_SHA}" \
  --data-urlencode "branch=development" \
  --data-urlencode "limit=10" \
  --data-urlencode "teamId=${VERCEL_TEAM_ID}" \
  https://api.vercel.com/v7/deployments)"
deployment_id="$(jq -er \
  --arg project "${VERCEL_ROOT_PROJECT_ID}" \
  --arg repository_id "${EXPECTED_GITHUB_REPOSITORY_ID}" \
  --arg sha "${ACCEPTED_SHA}" \
  '[.deployments[]?
    | select(
        .projectId == $project
        and (.target == "preview" or .target == null)
        and ((.readyState // .state) == "READY")
        and ((.meta.githubCommitRepoId | tostring) == $repository_id)
        and .meta.githubCommitSha == $sha
        and .meta.githubCommitRef == "development"
      )]
   | sort_by(.createdAt)
   | if length > 0 then last.uid
     else error("No ready Development deployment matched the accepted commit")
     end' <<<"${deployments_payload}")"

deployment_payload="$(curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --header "Authorization: Bearer ${VERCEL_TOKEN}" \
  "https://api.vercel.com/v13/deployments/${deployment_id}?withGitRepoInfo=true&teamId=${VERCEL_TEAM_ID}")"
jq -e \
  --arg deployment "${deployment_id}" \
  --arg project "${VERCEL_ROOT_PROJECT_ID}" \
  --arg repository_id "${EXPECTED_GITHUB_REPOSITORY_ID}" \
  --arg sha "${ACCEPTED_SHA}" \
  '.id == $deployment
   and (.target == "preview" or .target == null)
   and .readyState == "READY"
   and ((.projectId // .project.id // "") == $project)
   and (.gitSource.type == "github")
   and ((.gitSource.repoId | tostring) == $repository_id)
   and (.gitSource.sha == $sha)
   and (.gitSource.ref == "development")' \
  <<<"${deployment_payload}" >/dev/null || {
  echo "The Development domain is not serving the exact accepted deployment." >&2
  exit 1
}
