#!/usr/bin/env bash
set -euo pipefail
exec bunx vercel@59.3.0 --token="${VERCEL_TOKEN:?VERCEL_TOKEN is required}" curl "$@"
