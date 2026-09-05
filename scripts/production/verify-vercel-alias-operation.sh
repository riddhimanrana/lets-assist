#!/usr/bin/env bash

set -euo pipefail

for variable in EXPECTED_ALIAS_OPERATION EXPECTED_ALIAS_OPERATION_DEPLOYMENT_ID VERCEL_TOKEN VERCEL_TEAM_ID VERCEL_ROOT_PROJECT_ID; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required to verify the Vercel alias operation." >&2
    exit 1
  fi
done

if [[ "${EXPECTED_ALIAS_OPERATION}" != "promote" && "${EXPECTED_ALIAS_OPERATION}" != "rollback" ]]; then
  echo "EXPECTED_ALIAS_OPERATION must be promote or rollback." >&2
  exit 1
fi
if [[ ! "${EXPECTED_ALIAS_OPERATION_DEPLOYMENT_ID}" =~ ^dpl_[A-Za-z0-9]+$ ]]; then
  echo "EXPECTED_ALIAS_OPERATION_DEPLOYMENT_ID is malformed." >&2
  exit 1
fi

verification_timeout_seconds="${VERCEL_ALIAS_OPERATION_TIMEOUT_SECONDS:-50}"
if [[ ! "${verification_timeout_seconds}" =~ ^[0-9]+$ ]] ||
  ((verification_timeout_seconds < 5 || verification_timeout_seconds > 1200)); then
  echo "VERCEL_ALIAS_OPERATION_TIMEOUT_SECONDS must be between 5 and 1200." >&2
  exit 1
fi

verification_deadline=$((SECONDS + verification_timeout_seconds))
settled_absent_observations=0
while ((SECONDS < verification_deadline)); do
  project_payload=""
  if project_payload="$(curl --fail --silent --show-error \
    --connect-timeout 5 \
    --max-time 8 \
    --header "Authorization: Bearer ${VERCEL_TOKEN}" \
    "https://api.vercel.com/v9/projects/${VERCEL_ROOT_PROJECT_ID}?teamId=${VERCEL_TEAM_ID}")"; then
    operation_record="$(jq -r \
      --arg account "${VERCEL_TEAM_ID}" \
      --arg deployment "${EXPECTED_ALIAS_OPERATION_DEPLOYMENT_ID}" \
      --arg operation "${EXPECTED_ALIAS_OPERATION}" \
      --arg project "${VERCEL_ROOT_PROJECT_ID}" \
      'if .id != $project or .accountId != $account then
       "binding-error"
       elif .lastAliasRequest == null then
         "absent"
       elif (.lastAliasRequest.type // "") == $operation
         and (.lastAliasRequest.toDeploymentId // "") == $deployment then
         (.lastAliasRequest.jobStatus // "missing")
       else
         "different-operation"
       end' \
      <<<"${project_payload}")"
    if [[ "${operation_record}" != "absent" ]]; then
      settled_absent_observations=0
    fi
    case "${operation_record}" in
      absent)
        if PRODUCTION_DEPLOYMENT_ID="${EXPECTED_ALIAS_OPERATION_DEPLOYMENT_ID}" \
          VERCEL_ALIAS_VERIFY_TIMEOUT_SECONDS=5 \
          VERCEL_ALIAS_CONNECT_TIMEOUT_SECONDS=2 \
          VERCEL_ALIAS_HTTP_TIMEOUT_SECONDS=5 \
          bash "$(dirname "${BASH_SOURCE[0]}")/verify-vercel-alias.sh" >/dev/null 2>&1 &&
          curl --fail --silent --show-error --connect-timeout 5 --max-time 8 \
            --header "Authorization: Bearer ${VERCEL_TOKEN}" \
            "https://api.vercel.com/v9/projects/${VERCEL_ROOT_PROJECT_ID}?teamId=${VERCEL_TEAM_ID}" |
            jq -e --arg account "${VERCEL_TEAM_ID}" --arg project "${VERCEL_ROOT_PROJECT_ID}" \
              '.id == $project and .accountId == $account and .lastAliasRequest == null' >/dev/null; then
          settled_absent_observations=$((settled_absent_observations + 1))
          if ((settled_absent_observations >= 2)); then
            echo 'No Vercel alias operation is recorded; the exact Production alias is settled.'
            echo 'alias_operation_outcome=alias-settled'
            exit 0
          fi
        else
          settled_absent_observations=0
        fi
        ;;
      succeeded | failed | skipped)
        echo "The expected Vercel ${EXPECTED_ALIAS_OPERATION} operation is terminal."
        exit 0
        ;;
      pending | in-progress | missing | different-operation)
        ;;
      binding-error)
        echo "The Vercel project binding changed while checking alias operation state." >&2
        exit 1
        ;;
      *)
        echo "Vercel returned an unknown alias operation state." >&2
        exit 1
        ;;
    esac
  else
    settled_absent_observations=0
  fi
  sleep 2
done

echo "The expected Vercel ${EXPECTED_ALIAS_OPERATION} operation did not reach a terminal state." >&2
exit 1
