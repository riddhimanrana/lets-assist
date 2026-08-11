#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="${SUPABASE_DB_URL:-$(node "$ROOT_DIR/scripts/local-dev/dv-local-env.mjs" --db-url)}"

# Fix the bad event_type rows seeded with "event" instead of "oneTime"
psql "$DB_URL" << 'SQL'
UPDATE projects SET
  event_type = 'oneTime',
  schedule = '{"oneTime": {"date": "2026-11-14", "startTime": "08:00", "endTime": "17:00"}}'::jsonb
WHERE id = 'd0000000-0000-4000-8000-000000000020';

UPDATE projects SET
  event_type = 'oneTime',
  schedule = '{"oneTime": {"date": "2026-12-05", "startTime": "09:00", "endTime": "13:00"}}'::jsonb
WHERE id = 'd0000000-0000-4000-8000-000000000022';

UPDATE projects SET
  event_type = 'oneTime',
  schedule = '{"oneTime": {"date": "2026-10-24", "startTime": "08:30", "endTime": "15:30"}}'::jsonb
WHERE id = 'd0000000-0000-4000-8000-000000000023';

SELECT id, title, event_type, schedule->'oneTime'->>'date' as date FROM projects
WHERE id IN (
  'd0000000-0000-4000-8000-000000000020',
  'd0000000-0000-4000-8000-000000000022',
  'd0000000-0000-4000-8000-000000000023'
);
SQL
