#!/usr/bin/env bash

set -euo pipefail

development_status_url="https://dev.lets-assist.com/api/status"
for variable in ACCEPTED_SHA VERCEL_AUTOMATION_BYPASS_SECRET; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required to verify hosted Development." >&2
    exit 1
  fi
done

if [[ ! "${ACCEPTED_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ACCEPTED_SHA must be a full lowercase commit SHA." >&2
  exit 1
fi
status_payload="$(curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 30 \
  --max-redirs 0 \
  --get \
  --header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}" \
  --header "Cache-Control: no-cache" \
  --data-urlencode "deep=0" \
  --data-urlencode "development_gate=${ACCEPTED_SHA}" \
  "${development_status_url}")"
jq -e \
  --arg sha "${ACCEPTED_SHA}" \
  '.service == "lets-assist"
   and .environment == "preview"
   and .version == $sha
   and .status != "outage"
   and (([.checks[]? | select(.critical == true)] | length) > 0)
   and ([.checks[]? | select(.critical == true)] | all(.state == "pass"))' \
  <<<"${status_payload}" >/dev/null || {
  echo "The Development domain is not serving the exact accepted Preview deployment." >&2
  exit 1
}
