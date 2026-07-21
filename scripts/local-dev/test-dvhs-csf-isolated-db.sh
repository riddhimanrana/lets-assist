#!/usr/bin/env bash

set -euo pipefail

RUN_ID="${CSF_REPLAY_RUN_ID:-$(date +%Y%m%d%H%M%S)-$$}"
PROJECT_ID="lets-assist-csf-replay-${RUN_ID}"
TMP_DIR="${TMPDIR:-/tmp}/${PROJECT_ID}"
BASE_PORT=$((55000 + ($$ % 700)))

cleanup() {
  bunx supabase stop --workdir "$TMP_DIR" --no-backup --yes >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TMP_DIR"
rsync -a --exclude '.temp' supabase/ "$TMP_DIR/supabase/"

node - "$TMP_DIR/supabase/config.toml" "$PROJECT_ID" "$BASE_PORT" <<'NODE'
const fs = require("node:fs");
const [path, projectId, rawBase] = process.argv.slice(2);
const base = Number(rawBase);
let source = fs.readFileSync(path, "utf8");
const replacements = new Map([
  ['project_id = "lets-assist"', `project_id = "${projectId}"`],
  ["port = 54321", `port = ${base + 1}`],
  ["port = 54322", `port = ${base + 2}`],
  ["shadow_port = 54320", `shadow_port = ${base}`],
  ["port = 54329", `port = ${base + 9}`],
  ["port = 54323", `port = ${base + 3}`],
  ["port = 54324", `port = ${base + 4}`],
  ["smtp_port = 54325", `smtp_port = ${base + 5}`],
  ["inspector_port = 8083", `inspector_port = ${base + 6}`],
  ["port = 54327", `port = ${base + 7}`],
]);
for (const [before, after] of replacements) {
  if (!source.includes(before)) throw new Error(`Missing config token: ${before}`);
  source = source.replace(before, after);
}
fs.writeFileSync(path, source);
NODE

echo "Starting isolated Supabase project ${PROJECT_ID} on database port $((BASE_PORT + 2))"
bunx supabase db start --workdir "$TMP_DIR" --yes
bunx supabase test db --workdir "$TMP_DIR"

MIGRATION_COUNT=$(PGPASSWORD=postgres psql \
  "postgresql://postgres:postgres@127.0.0.1:$((BASE_PORT + 2))/postgres" \
  -Atc 'select count(*) from supabase_migrations.schema_migrations')
CSF_TABLE_COUNT=$(PGPASSWORD=postgres psql \
  "postgresql://postgres:postgres@127.0.0.1:$((BASE_PORT + 2))/postgres" \
  -Atc "select count(*) from information_schema.tables where table_schema = 'plugin_data' and table_name like 'csf_%'")

echo "Isolated replay passed: ${MIGRATION_COUNT} migrations, ${CSF_TABLE_COUNT} CSF tables"
