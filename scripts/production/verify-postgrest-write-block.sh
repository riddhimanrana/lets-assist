#!/usr/bin/env bash

set -euo pipefail

for variable in EXPECTED_SUPABASE_PROJECT_REF NEXT_PUBLIC_SUPABASE_URL; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required to verify the Production application write block." >&2
    exit 1
  fi
done

application_secret_key="${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
if [[ -z "${application_secret_key}" ]]; then
  echo "A Production Supabase server key is required to verify the application write block." >&2
  exit 1
fi

expected_project_url="https://${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co"
if [[ "${NEXT_PUBLIC_SUPABASE_URL%/}" != "${expected_project_url}" && "${NEXT_PUBLIC_SUPABASE_URL%/}" != "https://api.lets-assist.com" ]]; then
  echo "The Production application points at an unexpected Supabase endpoint." >&2
  exit 1
fi

response_file="$(mktemp)"
trap 'rm -f "${response_file}"' EXIT

authorization_headers=(--header "apikey: ${application_secret_key}")
if [[ "${application_secret_key}" == eyJ* ]]; then
  authorization_headers+=(--header "Authorization: Bearer ${application_secret_key}")
fi

status_code="$(curl --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --output "${response_file}" \
  --write-out '%{http_code}' \
  --request PATCH \
  "${authorization_headers[@]}" \
  --header 'Content-Type: application/json' \
  --data '{"is_active":false}' \
  "${NEXT_PUBLIC_SUPABASE_URL%/}/rest/v1/system_banners?and=(id.eq.00000000-0000-0000-0000-000000000000,id.neq.00000000-0000-0000-0000-000000000000)")"

if [[ "${status_code}" == 2* ]] || ! jq -e '.code == "25006"' "${response_file}" >/dev/null; then
  echo "A fresh PostgREST mutation was not rejected by the database read-only transaction guard." >&2
  exit 1
fi

echo "A fresh PostgREST mutation is blocked."
